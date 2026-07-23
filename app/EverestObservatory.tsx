"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  observatoryStones,
  recentExpeditions,
  terrainHeight,
} from "../lib/world";

const BASE_POINT = new THREE.Vector3(-34, terrainHeight(-34, 32) + 0.8, 32);

function createMountain(scene: THREE.Scene) {
  const divisions = 144;
  const size = 92;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const shadowRock = new THREE.Color("#172832");
  const warmRock = new THREE.Color("#746c62");
  const alpineIce = new THREE.Color("#8eabb1");
  const summitSnow = new THREE.Color("#f4f1e7");

  for (let row = 0; row <= divisions; row += 1) {
    for (let column = 0; column <= divisions; column += 1) {
      const x = -size / 2 + (column / divisions) * size;
      const z = -size / 2 + (row / divisions) * size;
      const y = terrainHeight(x, z);
      positions.push(x, y, z);

      const elevation = Math.min(1, y / 43.5);
      const ridgeLight = Math.max(
        0,
        Math.sin(x * 0.47 + z * 0.18) * 0.12 +
          Math.sin(z * 0.34 - x * 0.12) * 0.08,
      );
      const color = shadowRock.clone().lerp(warmRock, elevation * 0.82);
      if (elevation > 0.42) {
        color.lerp(
          alpineIce,
          Math.min(0.72, (elevation - 0.42) * 1.18 + ridgeLight),
        );
      }
      if (elevation > 0.68) {
        color.lerp(
          summitSnow,
          Math.min(1, (elevation - 0.68) * 2.8 + ridgeLight),
        );
      }
      colors.push(color.r, color.g, color.b);
    }
  }

  for (let row = 0; row < divisions; row += 1) {
    for (let column = 0; column < divisions; column += 1) {
      const first = row * (divisions + 1) + column;
      const second = first + divisions + 1;
      indices.push(first, second, first + 1, second, second + 1, first + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.93,
    metalness: 0.02,
  });
  const mountain = new THREE.Mesh(geometry, material);
  mountain.receiveShadow = true;
  scene.add(mountain);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(48, 54, 3.2, 96),
    new THREE.MeshStandardMaterial({
      color: "#101b21",
      roughness: 1,
      metalness: 0,
    }),
  );
  base.position.y = -1.22;
  scene.add(base);

  return { mountain, base };
}

function routePoints(
  target: { x: number; y: number; z: number },
  offset: number,
  returned: boolean,
) {
  const outward: THREE.Vector3[] = [];
  for (let index = 0; index <= 32; index += 1) {
    const t = index / 32;
    const x =
      THREE.MathUtils.lerp(BASE_POINT.x, target.x, t) +
      offset * Math.sin(t * Math.PI);
    const z =
      THREE.MathUtils.lerp(BASE_POINT.z, target.z, t) +
      Math.sin(t * Math.PI) * (5.6 + offset);
    const y =
      index === 32
        ? target.y
        : terrainHeight(x, z) + 0.7 + Math.sin(t * Math.PI) * 0.14;
    outward.push(new THREE.Vector3(x, y, z));
  }
  return returned
    ? [...outward, ...outward.slice(0, -1).reverse()]
    : outward;
}

function positiveModulo(value: number, modulus: number) {
  return ((value % modulus) + modulus) % modulus;
}

export default function EverestObservatory() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const expeditions = useMemo(() => recentExpeditions(), []);
  const stones = useMemo(() => observatoryStones(), []);
  const [activeExpedition, setActiveExpedition] = useState(0);

  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#0b151c", 0.0068);

    const camera = new THREE.PerspectiveCamera(
      43,
      host.clientWidth / host.clientHeight,
      0.1,
      360,
    );
    camera.position.set(82, 56, 96);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive three-dimensional ALTER EVEREST world. Drag to orbit and scroll to zoom.",
    );
    renderer.domElement.setAttribute("role", "application");
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 22, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.045;
    controls.enablePan = false;
    controls.minDistance = 58;
    controls.maxDistance = 142;
    controls.minPolarAngle = 0.52;
    controls.maxPolarAngle = 1.43;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.22;

    const stopAutoRotate = () => {
      controls.autoRotate = false;
    };
    renderer.domElement.addEventListener("pointerdown", stopAutoRotate);
    renderer.domElement.addEventListener("wheel", stopAutoRotate, {
      passive: true,
    });

    scene.add(new THREE.HemisphereLight("#c4e2ec", "#071015", 2.25));
    const sunrise = new THREE.DirectionalLight("#ffc08a", 5.6);
    sunrise.position.set(-52, 76, 31);
    scene.add(sunrise);
    const coldRim = new THREE.DirectionalLight("#7dc4dc", 3.4);
    coldRim.position.set(56, 34, -63);
    scene.add(coldRim);
    const summitGlow = new THREE.PointLight("#ff6a2d", 9, 30, 1.55);
    summitGlow.position.set(0, 47, 1);
    scene.add(summitGlow);

    const { mountain, base } = createMountain(scene);

    const cubeGeometry = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    const cubeMaterial = new THREE.MeshStandardMaterial({
      color: "#fff7e6",
      emissive: "#ff7a3d",
      emissiveIntensity: 0.42,
      roughness: 0.78,
      metalness: 0.01,
    });
    const stoneMesh = new THREE.InstancedMesh(
      cubeGeometry,
      cubeMaterial,
      stones.length,
    );
    const dummy = new THREE.Object3D();
    stones.forEach((stone, index) => {
      dummy.position.set(stone.x, stone.y, stone.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      stoneMesh.setMatrixAt(index, dummy.matrix);
    });
    stoneMesh.instanceMatrix.needsUpdate = true;
    scene.add(stoneMesh);

    const routeObjects = expeditions.map((expedition, index) => {
      const points = routePoints(
        expedition.target,
        (index - 1) * 1.8,
        expedition.returned,
      );
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
      const material = new THREE.MeshBasicMaterial({
        color: expedition.color,
        transparent: true,
        opacity: index === 0 ? 0.92 : 0.36,
        depthWrite: false,
      });
      const trail = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 300, 0.075, 7, false),
        material,
      );
      scene.add(trail);

      const markerMaterial = new THREE.MeshStandardMaterial({
        color: "#fff9ed",
        emissive: expedition.color,
        emissiveIntensity: 3.2,
        transparent: true,
      });
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 18, 14),
        markerMaterial,
      );
      scene.add(marker);
      return { curve, trail, marker, material, markerMaterial };
    });

    const summitBeacon = new THREE.Group();
    const beaconLine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 4.3, 8),
      new THREE.MeshBasicMaterial({
        color: "#ff7138",
        transparent: true,
        opacity: 0.74,
      }),
    );
    const beaconRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.035, 10, 48),
      new THREE.MeshBasicMaterial({
        color: "#ffb18c",
        transparent: true,
        opacity: 0.76,
      }),
    );
    beaconRing.rotation.x = Math.PI / 2;
    summitBeacon.add(beaconLine, beaconRing);
    summitBeacon.position.set(0, terrainHeight(0, 0) + 2.1, 0);
    scene.add(summitBeacon);

    controls.update();
    renderer.render(scene, camera);

    let frame = 0;
    const started = performance.now();
    const render = (time: number) => {
      const seconds = Math.max(0, (time - started) / 1000);
      controls.update();

      routeObjects.forEach((route, index) => {
        const phase = positiveModulo(
          seconds * (0.028 + index * 0.003) + index * 0.29,
          1,
        );
        route.marker.position.copy(route.curve.getPoint(phase));
        const isActive =
          Math.floor(seconds / 7) % expeditions.length === index;
        route.material.opacity = isActive ? 0.94 : 0.26;
        route.markerMaterial.opacity = isActive ? 1 : 0.34;
        route.marker.scale.setScalar(
          isActive ? 1 + Math.sin(seconds * 4.2) * 0.12 : 0.72,
        );
      });

      const nextActive = Math.floor(seconds / 7) % expeditions.length;
      setActiveExpedition((current) =>
        current === nextActive ? current : nextActive,
      );
      summitBeacon.rotation.y = seconds * 0.22;
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

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", stopAutoRotate);
      renderer.domElement.removeEventListener("wheel", stopAutoRotate);
      controls.dispose();
      routeObjects.forEach(({ trail, marker, material, markerMaterial }) => {
        trail.geometry.dispose();
        material.dispose();
        marker.geometry.dispose();
        markerMaterial.dispose();
      });
      mountain.geometry.dispose();
      (mountain.material as THREE.Material).dispose();
      base.geometry.dispose();
      (base.material as THREE.Material).dispose();
      cubeGeometry.dispose();
      cubeMaterial.dispose();
      beaconLine.geometry.dispose();
      (beaconLine.material as THREE.Material).dispose();
      beaconRing.geometry.dispose();
      (beaconRing.material as THREE.Material).dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [expeditions, stones]);

  const active = expeditions[activeExpedition];

  return (
    <main className="observatory">
      <div className="everest-photo" aria-hidden="true" />
      <div className="atmosphere" aria-hidden="true" />
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
          LIVE
        </div>
      </header>

      <section className="world-id" id="world" aria-label="Current world">
        <span>WORLD 6,318</span>
        <strong>8,849.48 M</strong>
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
        <span>
          {active.action} · {active.altitudeM.toLocaleString("en-US")} M
        </span>
      </aside>

      <div className="orbit-hint" aria-hidden="true">
        DRAG · ZOOM
      </div>
    </main>
  );
}
