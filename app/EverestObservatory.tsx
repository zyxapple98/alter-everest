"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { recentExpeditions } from "../lib/world";

interface DemMetadata {
  id: string;
  source: string;
  sourceResolutionM: number;
  width: number;
  height: number;
  minimumM: number;
  maximumM: number;
  attribution: string;
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
}

const BASE_ELEVATION_M = 5_000;
const VERTICAL_STEP_M = 20;
const BLOCK_SIZE = 0.235;

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
): VoxelTerrain {
  const { width, height } = metadata;
  const levels = new Int16Array(elevations.length);
  let peakIndex = 0;

  for (let index = 0; index < elevations.length; index += 1) {
    const row = Math.floor(index / width);
    const column = index % width;
    const syntheticDetail =
      (hashNoise(column, row, 101) - 0.5) * 0.34 +
      Math.sin(column * 0.31 + row * 0.19) * 0.08;
    levels[index] = Math.max(
      0,
      Math.round(
        (elevations[index] - BASE_ELEVATION_M) / VERTICAL_STEP_M +
          syntheticDetail,
      ),
    );
    if (elevations[index] > elevations[peakIndex]) peakIndex = index;
  }

  let faceCount = width * height;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const level = levels[index];
      const east = column < width - 1 ? levels[index + 1] : 0;
      const west = column > 0 ? levels[index - 1] : 0;
      const south = row < height - 1 ? levels[index + width] : 0;
      const north = row > 0 ? levels[index - width] : 0;
      faceCount += Math.max(0, level - east);
      faceCount += Math.max(0, level - west);
      faceCount += Math.max(0, level - south);
      faceCount += Math.max(0, level - north);
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
      const level = levels[index];
      const x0 = (column - width / 2) * BLOCK_SIZE;
      const x1 = x0 + BLOCK_SIZE;
      const z0 = (row - height / 2) * BLOCK_SIZE;
      const z1 = z0 + BLOCK_SIZE;
      const yTop = (level + 1) * BLOCK_SIZE;
      const elevationM = elevations[index];

      writeFace(
        [x0, yTop, z0, x0, yTop, z1, x1, yTop, z1, x1, yTop, z0],
        terrainColor(elevationM, column, row, 1),
      );

      const sides = [
        {
          neighbor: column < width - 1 ? levels[index + 1] : 0,
          shade: 0.72,
          vertices: (y0: number, y1: number) =>
            [x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1] as const,
        },
        {
          neighbor: column > 0 ? levels[index - 1] : 0,
          shade: 0.56,
          vertices: (y0: number, y1: number) =>
            [x0, y0, z1, x0, y1, z1, x0, y1, z0, x0, y0, z0] as const,
        },
        {
          neighbor: row < height - 1 ? levels[index + width] : 0,
          shade: 0.64,
          vertices: (y0: number, y1: number) =>
            [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1] as const,
        },
        {
          neighbor: row > 0 ? levels[index - width] : 0,
          shade: 0.48,
          vertices: (y0: number, y1: number) =>
            [x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0] as const,
        },
      ];

      for (const side of sides) {
        for (let layer = side.neighbor + 1; layer <= level; layer += 1) {
          const y0 = layer * BLOCK_SIZE;
          const y1 = (layer + 1) * BLOCK_SIZE;
          writeFace(
            side.vertices(y0, y1),
            terrainColor(elevationM, column, row, side.shade),
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
    blockSize: BLOCK_SIZE,
    baseElevationM: BASE_ELEVATION_M,
    verticalStepM: VERTICAL_STEP_M,
    peakColumn: peakIndex % width,
    peakRow: Math.floor(peakIndex / width),
  };
}

function createDistantRanges(scene: THREE.Scene) {
  const placements: Array<{
    x: number;
    y: number;
    z: number;
    color: THREE.Color;
  }> = [];
  const cubeSize = 1.7;
  const peaks = 18;

  for (let peak = 0; peak < peaks; peak += 1) {
    const angle = (peak / peaks) * Math.PI * 2;
    const radius = 104 + hashNoise(peak, 1, 5) * 16;
    const centerX = Math.cos(angle) * radius;
    const centerZ = Math.sin(angle) * radius;
    const footprint = 7 + Math.floor(hashNoise(peak, 2, 7) * 5);
    const peakHeight = 11 + Math.floor(hashNoise(peak, 3, 11) * 10);

    for (let localZ = -footprint; localZ <= footprint; localZ += 1) {
      for (let localX = -footprint; localX <= footprint; localX += 1) {
        const distance = Math.hypot(localX, localZ) / footprint;
        if (distance > 1) continue;
        const columnHeight = Math.max(
          1,
          Math.floor(
            (1 - distance) * peakHeight +
              hashNoise(localX + peak * 31, localZ, 29) * 2,
          ),
        );
        for (let y = 0; y < columnHeight; y += 1) {
          const snow = y > columnHeight * 0.72;
          placements.push({
            x: centerX + localX * cubeSize,
            y: -5 + y * cubeSize,
            z: centerZ + localZ * cubeSize,
            color: new THREE.Color(snow ? "#7e9da4" : "#223942").multiplyScalar(
              0.62 + hashNoise(localX, y + peak, 47) * 0.18,
            ),
          });
        }
      }
    }
  }

  const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
  const material = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    fog: true,
  });
  const ranges = new THREE.InstancedMesh(
    geometry,
    material,
    placements.length,
  );
  const dummy = new THREE.Object3D();
  placements.forEach((placement, index) => {
    dummy.position.set(placement.x, placement.y, placement.z);
    dummy.updateMatrix();
    ranges.setMatrixAt(index, dummy.matrix);
    ranges.setColorAt(index, placement.color);
  });
  ranges.instanceMatrix.needsUpdate = true;
  if (ranges.instanceColor) ranges.instanceColor.needsUpdate = true;
  scene.add(ranges);
  return { ranges, geometry, material };
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
    (safeColumn + 0.5 - terrain.width / 2) * terrain.blockSize,
    (level + 1 + lift) * terrain.blockSize,
    (safeRow + 0.5 - terrain.height / 2) * terrain.blockSize,
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

async function loadDem(signal: AbortSignal) {
  const [metadataResponse, elevationResponse] = await Promise.all([
    fetch("/data/everest-dem.json", { signal }),
    fetch("/data/everest-dem.int16", { signal }),
  ]);
  if (!metadataResponse.ok || !elevationResponse.ok) {
    throw new Error("Everest DEM assets could not be loaded.");
  }
  const metadata = (await metadataResponse.json()) as DemMetadata;
  const buffer = await elevationResponse.arrayBuffer();
  const view = new DataView(buffer);
  const elevations = new Int16Array(buffer.byteLength / 2);
  for (let index = 0; index < elevations.length; index += 1) {
    elevations[index] = view.getInt16(index * 2, true);
  }
  if (elevations.length !== metadata.width * metadata.height) {
    throw new Error("Everest DEM dimensions do not match the source manifest.");
  }
  return { metadata, elevations };
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
      const { metadata, elevations } = await loadDem(abortController.signal);
      if (disposed) return;

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2("#102c3a", 0.0088);

      const camera = new THREE.PerspectiveCamera(
        43,
        host.clientWidth / host.clientHeight,
        0.1,
        420,
      );
      camera.position.set(60, 54, 100);

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

      const terrain = createVoxelTerrain(elevations, metadata);
      scene.add(terrain.mesh);
      const distant = createDistantRanges(scene);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(420, 420),
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
      controls.minDistance = 46;
      controls.maxDistance = 145;
      controls.minPolarAngle = 0.48;
      controls.maxPolarAngle = 1.42;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.16;

      const stopAutoRotate = () => {
        controls.autoRotate = false;
      };
      renderer.domElement.addEventListener("pointerdown", stopAutoRotate);
      renderer.domElement.addEventListener("wheel", stopAutoRotate, {
        passive: true,
      });

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
        renderer.domElement.removeEventListener("pointerdown", stopAutoRotate);
        renderer.domElement.removeEventListener("wheel", stopAutoRotate);
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
        terrain.mesh.geometry.dispose();
        (terrain.mesh.material as THREE.Material).dispose();
        distant.geometry.dispose();
        distant.material.dispose();
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
        COPERNICUS GLO-30 · SYNTHETIC SUBGRID DETAIL
      </div>
    </main>
  );
}
