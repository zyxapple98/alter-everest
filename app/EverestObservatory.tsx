"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { recentExpeditions } from "../lib/world";

interface DemMetadata {
  id: string;
  lod: "core" | "mid" | "far";
  source: string;
  sourceResolutionM: number;
  displayResolutionM: number;
  sampleSpacingArcSeconds: number;
  width: number;
  height: number;
  bounds: DemBounds;
  minimumM: number;
  maximumM: number;
  attribution: string;
}

interface DemBounds {
  north: number;
  south: number;
  west: number;
  east: number;
}

interface DemLayer {
  metadata: DemMetadata;
  elevations: Int16Array;
}

interface VoxelTerrain {
  mesh: THREE.Mesh;
  levels: Int16Array;
  width: number;
  height: number;
  blockSize: number;
  baseElevationM: number;
  verticalStepM: number;
  peakColumn: number;
  peakRow: number;
  xOrigin: number;
  zOrigin: number;
}

interface TerrainOptions {
  holeBounds?: DemBounds;
  overlapCells?: number;
  yOffset?: number;
  detailedSides?: boolean;
  edgeFeatherCells?: number;
}

const BASE_ELEVATION_M = 0;
const CORE_BLOCK_SIZE = 0.235;
const WORLD_PER_ARC_SECOND = CORE_BLOCK_SIZE;
const VERTICAL_EXAGGERATION = 1.5;
const ORIGIN_LATITUDE = 27.9881;
const ORIGIN_LONGITUDE = 86.925;

function hashNoise(x: number, z: number, seed = 0) {
  let value = Math.imul(x + seed * 1013, 374761393);
  value = Math.imul(value ^ Math.imul(z - seed * 733, 668265263), 1274126177);
  value ^= value >>> 13;
  return ((value >>> 0) % 10000) / 10000;
}

function terrainColor(
  elevationM: number,
  x: number,
  z: number,
  shade: number,
) {
  const variation = (hashNoise(x, z, 19) - 0.5) * 0.055;
  const patch =
    Math.sin(x * 0.052 + z * 0.021) * 0.52 +
    Math.sin(z * 0.061 - x * 0.018) * 0.34 +
    Math.sin((x + z) * 0.027) * 0.22;
  let color: THREE.Color;

  if (elevationM > 7_800 || (elevationM > 6_850 && patch > 0.42)) {
    color = new THREE.Color("#dce5e2");
  } else if (elevationM > 6_100 && patch < 0.08) {
    color = new THREE.Color("#6f9da8");
  } else if (elevationM > 5_750) {
    color = new THREE.Color("#686c69");
  } else {
    color = new THREE.Color("#3d4848");
  }

  color.offsetHSL(variation * 0.08, variation * 0.15, variation);
  return color.multiplyScalar(shade);
}

function createVoxelTerrain(
  elevations: Int16Array,
  metadata: DemMetadata,
  options: TerrainOptions = {},
): VoxelTerrain {
  const { width, height } = metadata;
  const {
    holeBounds,
    overlapCells = 1.25,
    yOffset = 0,
    detailedSides = true,
    edgeFeatherCells = 0,
  } = options;
  const blockSize =
    metadata.sampleSpacingArcSeconds * WORLD_PER_ARC_SECOND;
  const verticalStepM =
    metadata.displayResolutionM / VERTICAL_EXAGGERATION;
  const degreesPerSample = metadata.sampleSpacingArcSeconds / 3600;
  const xOrigin =
    (metadata.bounds.west - ORIGIN_LONGITUDE) *
    3600 *
    WORLD_PER_ARC_SECOND;
  const zOrigin =
    (ORIGIN_LATITUDE - metadata.bounds.north) *
    3600 *
    WORLD_PER_ARC_SECOND;
  const levels = new Int16Array(elevations.length);
  const included = new Uint8Array(elevations.length);
  let peakIndex = 0;

  for (let index = 0; index < elevations.length; index += 1) {
    const row = Math.floor(index / width);
    const column = index % width;
    const latitude =
      metadata.bounds.north - (row + 0.5) * degreesPerSample;
    const longitude =
      metadata.bounds.west + (column + 0.5) * degreesPerSample;
    const insideHole =
      holeBounds &&
      latitude < holeBounds.north - overlapCells * degreesPerSample &&
      latitude > holeBounds.south + overlapCells * degreesPerSample &&
      longitude < holeBounds.east - overlapCells * degreesPerSample &&
      longitude > holeBounds.west + overlapCells * degreesPerSample;
    const edgeDistance = Math.min(
      row,
      column,
      height - 1 - row,
      width - 1 - column,
    );
    const featheredOut =
      edgeFeatherCells > 0 &&
      edgeDistance < edgeFeatherCells &&
      hashNoise(column, row, metadata.lod === "core" ? 211 : 307) >
        (edgeDistance + 0.5) / edgeFeatherCells;
    included[index] = insideHole || featheredOut ? 0 : 1;
    const syntheticDetail =
      metadata.lod === "core"
        ? (hashNoise(column, row, 101) - 0.5) * 0.34 +
          Math.sin(column * 0.31 + row * 0.19) * 0.08
        : 0;
    levels[index] = Math.max(
      0,
      Math.round(
        (elevations[index] - BASE_ELEVATION_M) / verticalStepM +
          syntheticDetail,
      ),
    );
    if (elevations[index] > elevations[peakIndex]) peakIndex = index;
  }

  let faceCount = 0;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      if (!included[index]) continue;
      faceCount += 1;
      const level = levels[index];
      const neighborIndices = [
        column < width - 1 ? index + 1 : -1,
        column > 0 ? index - 1 : -1,
        row < height - 1 ? index + width : -1,
        row > 0 ? index - width : -1,
      ];
      for (const neighborIndex of neighborIndices) {
        if (neighborIndex < 0 || !included[neighborIndex]) continue;
        const difference = Math.max(0, level - levels[neighborIndex]);
        faceCount += detailedSides ? difference : Number(difference > 0);
      }
    }
  }

  const positions = new Float32Array(faceCount * 12);
  const colors = new Float32Array(faceCount * 12);
  const indices =
    faceCount * 4 > 65_535
      ? new Uint32Array(faceCount * 6)
      : new Uint16Array(faceCount * 6);
  let face = 0;

  const writeFace = (
    vertices: ArrayLike<number>,
    color: THREE.Color,
  ) => {
    const positionOffset = face * 12;
    positions.set(vertices, positionOffset);
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const colorOffset = positionOffset + vertex * 3;
      colors[colorOffset] = color.r;
      colors[colorOffset + 1] = color.g;
      colors[colorOffset + 2] = color.b;
    }
    const vertexOffset = face * 4;
    const indexOffset = face * 6;
    indices.set(
      [
        vertexOffset,
        vertexOffset + 1,
        vertexOffset + 2,
        vertexOffset,
        vertexOffset + 2,
        vertexOffset + 3,
      ],
      indexOffset,
    );
    face += 1;
  };

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      if (!included[index]) continue;
      const level = levels[index];
      const x0 = xOrigin + column * blockSize;
      const x1 = x0 + blockSize;
      const z0 = zOrigin + row * blockSize;
      const z1 = z0 + blockSize;
      const yTop = (level + 1) * blockSize + yOffset;
      const elevationM = elevations[index];
      const noiseColumn = Math.round(
        (metadata.bounds.west + column * degreesPerSample) * 3600,
      );
      const noiseRow = Math.round(
        (metadata.bounds.north - row * degreesPerSample) * 3600,
      );

      writeFace(
        [x0, yTop, z0, x0, yTop, z1, x1, yTop, z1, x1, yTop, z0],
        terrainColor(elevationM, noiseColumn, noiseRow, 1),
      );

      const sides = [
        {
          neighborIndex: column < width - 1 ? index + 1 : -1,
          shade: 0.72,
          vertices: (y0: number, y1: number) =>
            [x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1] as const,
        },
        {
          neighborIndex: column > 0 ? index - 1 : -1,
          shade: 0.56,
          vertices: (y0: number, y1: number) =>
            [x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0] as const,
        },
        {
          neighborIndex: row < height - 1 ? index + width : -1,
          shade: 0.64,
          vertices: (y0: number, y1: number) =>
            [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1] as const,
        },
        {
          neighborIndex: row > 0 ? index - width : -1,
          shade: 0.48,
          vertices: (y0: number, y1: number) =>
            [x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0] as const,
        },
      ];

      for (const side of sides) {
        if (
          side.neighborIndex < 0 ||
          !included[side.neighborIndex] ||
          levels[side.neighborIndex] >= level
        ) {
          continue;
        }
        const neighborLevel = levels[side.neighborIndex];
        if (detailedSides) {
          for (let layer = neighborLevel + 1; layer <= level; layer += 1) {
            const y0 = layer * blockSize + yOffset;
            const y1 = (layer + 1) * blockSize + yOffset;
            writeFace(
              side.vertices(y0, y1),
              terrainColor(
                elevationM,
                noiseColumn,
                noiseRow,
                side.shade,
              ),
            );
          }
        } else {
          const y0 = (neighborLevel + 1) * blockSize + yOffset;
          writeFace(
            side.vertices(y0, yTop),
            terrainColor(
              elevationM,
              noiseColumn,
              noiseRow,
              side.shade,
            ),
          );
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: true,
    }),
  );

  return {
    mesh,
    levels,
    width,
    height,
    blockSize,
    baseElevationM: BASE_ELEVATION_M,
    verticalStepM,
    peakColumn: peakIndex % width,
    peakRow: Math.floor(peakIndex / width),
    xOrigin,
    zOrigin,
  };
}

function gridPoint(
  terrain: VoxelTerrain,
  column: number,
  row: number,
  lift = 0.7,
) {
  const safeColumn = THREE.MathUtils.clamp(
    Math.round(column),
    0,
    terrain.width - 1,
  );
  const safeRow = THREE.MathUtils.clamp(
    Math.round(row),
    0,
    terrain.height - 1,
  );
  const level = terrain.levels[safeRow * terrain.width + safeColumn];
  return new THREE.Vector3(
    terrain.xOrigin + (safeColumn + 0.5) * terrain.blockSize,
    (level + 1 + lift) * terrain.blockSize,
    terrain.zOrigin + (safeRow + 0.5) * terrain.blockSize,
  );
}

function createRoute(
  terrain: VoxelTerrain,
  lateralOffset: number,
  returned: boolean,
) {
  const startColumn = terrain.width * 0.25 + lateralOffset * 4;
  const startRow = terrain.height - 18;
  const route: THREE.Vector3[] = [];
  const steps = 104;

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const bend = Math.sin(t * Math.PI) * lateralOffset * 17;
    const column = THREE.MathUtils.lerp(
      startColumn,
      terrain.peakColumn,
      t,
    ) + bend;
    const row =
      THREE.MathUtils.lerp(startRow, terrain.peakRow, t) +
      Math.sin(t * Math.PI * 2) * lateralOffset * 4;
    route.push(gridPoint(terrain, column, row));
  }

  return returned
    ? [...route, ...route.slice(0, -1).reverse()]
    : route;
}

function positiveModulo(value: number, modulus: number) {
  return ((value % modulus) + modulus) % modulus;
}

async function loadDemLayer(
  stem: string,
  signal: AbortSignal,
): Promise<DemLayer> {
  const [metadataResponse, elevationResponse] = await Promise.all([
    fetch(`/data/${stem}.json`, { signal }),
    fetch(`/data/${stem}.int16`, { signal }),
  ]);
  if (!metadataResponse.ok || !elevationResponse.ok) {
    throw new Error(`Everest DEM layer ${stem} could not be loaded.`);
  }
  const metadata = (await metadataResponse.json()) as DemMetadata;
  const buffer = await elevationResponse.arrayBuffer();
  const view = new DataView(buffer);
  const elevations = new Int16Array(buffer.byteLength / 2);
  for (let index = 0; index < elevations.length; index += 1) {
    elevations[index] = view.getInt16(index * 2, true);
  }
  if (elevations.length !== metadata.width * metadata.height) {
    throw new Error(
      `Everest DEM layer ${stem} does not match its source manifest.`,
    );
  }
  return { metadata, elevations };
}

async function loadDem(signal: AbortSignal) {
  const [core, mid, far] = await Promise.all([
    loadDemLayer("everest-dem", signal),
    loadDemLayer("everest-dem-mid", signal),
    loadDemLayer("everest-dem-far", signal),
  ]);
  return { core, mid, far };
}

export default function EverestObservatory() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const [activeExpedition, setActiveExpedition] = useState(0);
  const [sceneStatus, setSceneStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const expeditions = useMemo(() => recentExpeditions(), []);

  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;

    const abortController = new AbortController();
    let disposed = false;
    let cleanupScene = () => {};

    const start = async () => {
      const { core, mid, far } = await loadDem(abortController.signal);
      if (disposed) return;

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2("#102c3a", 0.0046);

      const camera = new THREE.PerspectiveCamera(
        43,
        host.clientWidth / host.clientHeight,
        0.1,
        1_400,
      );
      camera.position.set(50, 110, 124);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.55));
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.domElement.setAttribute(
        "aria-label",
        "Interactive voxel rendering of Mount Everest derived from Copernicus GLO-30 elevation data.",
      );
      renderer.domElement.setAttribute("role", "application");
      renderer.domElement.tabIndex = 0;
      host.appendChild(renderer.domElement);

      const farTerrain = createVoxelTerrain(
        far.elevations,
        far.metadata,
        {
          holeBounds: mid.metadata.bounds,
          overlapCells: 3.5,
          yOffset: -0.08,
          detailedSides: false,
        },
      );
      const midTerrain = createVoxelTerrain(
        mid.elevations,
        mid.metadata,
        {
          holeBounds: core.metadata.bounds,
          overlapCells: 5.5,
          yOffset: -0.035,
          detailedSides: false,
          edgeFeatherCells: 8,
        },
      );
      const terrain = createVoxelTerrain(
        core.elevations,
        core.metadata,
        { edgeFeatherCells: 12 },
      );
      const terrainLayers = [farTerrain, midTerrain, terrain];
      terrainLayers.forEach((layer) => scene.add(layer.mesh));

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1_600, 1_600),
        new THREE.MeshBasicMaterial({
          color: "#171d22",
          fog: true,
        }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0.15;
      scene.add(ground);

      const peakLevel =
        terrain.levels[terrain.peakRow * terrain.width + terrain.peakColumn];
      const target = gridPoint(
        terrain,
        terrain.peakColumn,
        terrain.peakRow,
        -Math.round(peakLevel * 0.42),
      );
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(target);
      controls.enableDamping = true;
      controls.dampingFactor = 0.055;
      controls.enablePan = false;
      controls.minDistance = 52;
      controls.maxDistance = 210;
      controls.minPolarAngle = 0.48;
      controls.maxPolarAngle = 1.42;
      controls.autoRotate = false;

      const traceObjects = expeditions.map((expedition, index) => {
        const points = createRoute(
          terrain,
          (index - 1) * 1.15,
          expedition.returned,
        );
        const material = new THREE.LineBasicMaterial({
          color: expedition.color,
          transparent: true,
          opacity: index === 0 ? 0.92 : 0.42,
          depthWrite: false,
        });
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          material,
        );
        scene.add(line);

        const breadcrumbGeometry = new THREE.BoxGeometry(0.22, 0.22, 0.22);
        const breadcrumbMaterial = new THREE.MeshBasicMaterial({
          color: expedition.color,
          transparent: true,
          opacity: index === 0 ? 0.9 : 0.42,
        });
        const breadcrumbPoints = points.filter(
          (_, pointIndex) => pointIndex % 3 === 0,
        );
        const breadcrumbs = new THREE.InstancedMesh(
          breadcrumbGeometry,
          breadcrumbMaterial,
          breadcrumbPoints.length,
        );
        const breadcrumbDummy = new THREE.Object3D();
        breadcrumbPoints.forEach((point, pointIndex) => {
          breadcrumbDummy.position.copy(point);
          breadcrumbDummy.updateMatrix();
          breadcrumbs.setMatrixAt(pointIndex, breadcrumbDummy.matrix);
        });
        breadcrumbs.instanceMatrix.needsUpdate = true;
        scene.add(breadcrumbs);

        const markerMaterial = new THREE.MeshBasicMaterial({
          color: expedition.color,
          transparent: true,
        });
        const marker = new THREE.Mesh(
          new THREE.BoxGeometry(0.58, 0.58, 0.58),
          markerMaterial,
        );
        scene.add(marker);
        return {
          points,
          line,
          material,
          breadcrumbs,
          breadcrumbGeometry,
          breadcrumbMaterial,
          marker,
          markerMaterial,
        };
      });

      const summit = gridPoint(
        terrain,
        terrain.peakColumn,
        terrain.peakRow,
        1.9,
      );
      const summitStone = new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 0.52, 0.52),
        new THREE.MeshBasicMaterial({ color: "#ff7a3d" }),
      );
      summitStone.position.copy(summit);
      scene.add(summitStone);

      controls.update();
      renderer.render(scene, camera);
      setSceneStatus("ready");

      let frame = 0;
      const started = performance.now();
      const render = (time: number) => {
        const seconds = Math.max(0, (time - started) / 1000);
        controls.update();

        traceObjects.forEach((trace, index) => {
          const phase = positiveModulo(
            seconds * (0.042 + index * 0.004) + index * 0.31,
            1,
          );
          const scaled = phase * (trace.points.length - 1);
          const pointIndex = Math.min(
            trace.points.length - 2,
            Math.floor(scaled),
          );
          trace.marker.position.lerpVectors(
            trace.points[pointIndex],
            trace.points[pointIndex + 1],
            scaled - pointIndex,
          );
          trace.marker.rotation.y = seconds * 1.2;
          const isActive =
            Math.floor(seconds / 7) % expeditions.length === index;
          trace.material.opacity = isActive ? 0.94 : 0.4;
          trace.breadcrumbMaterial.opacity = isActive ? 0.9 : 0.38;
          trace.markerMaterial.opacity = isActive ? 1 : 0.3;
          trace.marker.scale.setScalar(
            isActive ? 1 + Math.sin(seconds * 4.5) * 0.14 : 0.72,
          );
        });

        const nextActive = Math.floor(seconds / 7) % expeditions.length;
        setActiveExpedition((current) =>
          current === nextActive ? current : nextActive,
        );
        renderer.render(scene, camera);
        frame = requestAnimationFrame(render);
      };
      frame = requestAnimationFrame(render);

      const observer = new ResizeObserver(() => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (width === 0 || height === 0) return;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
      observer.observe(host);

      cleanupScene = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        traceObjects.forEach(
          ({
            line,
            material,
            breadcrumbGeometry,
            breadcrumbMaterial,
            marker,
            markerMaterial,
          }) => {
          line.geometry.dispose();
          material.dispose();
          breadcrumbGeometry.dispose();
          breadcrumbMaterial.dispose();
          marker.geometry.dispose();
          markerMaterial.dispose();
          },
        );
        terrainLayers.forEach((layer) => {
          layer.mesh.geometry.dispose();
          (layer.mesh.material as THREE.Material).dispose();
        });
        ground.geometry.dispose();
        (ground.material as THREE.Material).dispose();
        summitStone.geometry.dispose();
        (summitStone.material as THREE.Material).dispose();
        renderer.dispose();
        if (host.contains(renderer.domElement)) {
          host.removeChild(renderer.domElement);
        }
      };
    };

    start().catch((error: unknown) => {
      if (disposed || abortController.signal.aborted) return;
      console.error(error);
      setSceneStatus("error");
    });

    return () => {
      disposed = true;
      abortController.abort();
      cleanupScene();
    };
  }, [expeditions]);

  const active = expeditions[activeExpedition];

  return (
    <main className="observatory">
      <div className="voxel-sky" aria-hidden="true">
        <i />
      </div>
      <div className="observatory-canvas" ref={canvasHost} />

      <header className="observatory-header">
        <a className="wordmark" href="#world" aria-label="ALTER EVEREST">
          <span className="wordmark-symbol" aria-hidden="true">
            <i />
            <i />
          </span>
          <strong>ALTER EVEREST</strong>
        </a>
        <div className="live-state">
          <i />
          {sceneStatus === "ready"
            ? "LIVE"
            : sceneStatus === "error"
              ? "DEM ERROR"
              : "LOADING DEM"}
        </div>
      </header>

      <section className="world-id" id="world" aria-label="Current world">
        <span>WORLD 6,318</span>
        <strong>8,848.86 M</strong>
      </section>

      <aside className="last-trace" aria-label="Last expedition trace">
        <span
          className="route-swatch"
          style={{
            background: active.color,
            boxShadow: `0 0 18px ${active.color}`,
          }}
        />
        <div>
          <small>LAST TRACE</small>
          <strong>{active.agent}</strong>
        </div>
        <span>{active.action}</span>
      </aside>

      <div className="orbit-hint" aria-hidden="true">
        DRAG · ZOOM
      </div>

      <div
        className="dem-credit"
        title="produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved"
      >
        COPERNICUS GLO-30 · 30 / 90 / 300 M TERRAIN LOD
      </div>
    </main>
  );
}
