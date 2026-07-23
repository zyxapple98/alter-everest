"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  observatoryStones,
  recentExpeditions,
  terrainHeight,
} from "../lib/world";

const BASE_POINT = new THREE.Vector3(-34, terrainHeight(-34, 32) + 0.8, 32);

function createMountain(scene: THREE.Scene) {
  const divisions = 112;
  const size = 92;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const deepRock = new THREE.Color("#11181c");
  const granite = new THREE.Color("#4c5354");
  const snow = new THREE.Color("#d4d4cc");

  for (let row = 0; row <= divisions; row += 1) {
    for (let column = 0; column <= divisions; column += 1) {
      const x = -size / 2 + (column / divisions) * size;
      const z = -size / 2 + (row / divisions) * size;
      const y = terrainHeight(x, z);
      positions.push(x, y, z);

      const normalized = Math.min(1, y / 43.5);
      const color = deepRock.clone().lerp(granite, Math.min(1, normalized * 1.6));
      if (normalized > 0.58) {
        const snowAmount = Math.min(1, (normalized - 0.58) / 0.3);
        const exposed = Math.sin(x * 0.7 + z * 0.24) * 0.18;
        color.lerp(snow, Math.max(0, snowAmount + exposed));
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

  const mountain = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.01,
      flatShading: true,
    }),
  );
  scene.add(mountain);
  return mountain;
}

function routePoints(
  target: { x: number; y: number; z: number },
  offset: number,
  returned: boolean,
) {
  const outward: THREE.Vector3[] = [];
  for (let index = 0; index <= 28; index += 1) {
    const t = index / 28;
    const x = THREE.MathUtils.lerp(BASE_POINT.x, target.x, t) + offset * Math.sin(t * Math.PI);
    const z =
      THREE.MathUtils.lerp(BASE_POINT.z, target.z, t) +
      Math.sin(t * Math.PI) * (5.6 + offset);
    const y =
      index === 28
        ? target.y
        : terrainHeight(x, z) + 0.64 + Math.sin(t * Math.PI) * 0.16;
    outward.push(new THREE.Vector3(x, y, z));
  }
  return returned
    ? [...outward, ...outward.slice(0, -1).reverse()]
    : outward;
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
    scene.fog = new THREE.FogExp2("#081117", 0.009);
    const camera = new THREE.PerspectiveCamera(
      33,
      host.clientWidth / host.clientHeight,
      0.1,
      360,
    );
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.88;
    renderer.domElement.setAttribute(
      "aria-label",
      "Live observatory rendering of the current ALTER EVEREST world",
    );
    renderer.domElement.setAttribute("role", "img");
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight("#aac6cf", "#030608", 1.35));
    const sunrise = new THREE.DirectionalLight("#ffb070", 4.8);
    sunrise.position.set(-45, 72, 18);
    scene.add(sunrise);
    const coldRim = new THREE.DirectionalLight("#7fb4c0", 2.1);
    coldRim.position.set(58, 28, -62);
    scene.add(coldRim);
    const summitGlow = new THREE.PointLight("#ff7338", 7.5, 28, 1.7);
    summitGlow.position.set(0, 47, 0);
    scene.add(summitGlow);

    createMountain(scene);

    const cubeGeometry = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const cubeMaterial = new THREE.MeshStandardMaterial({
      color: "#deded7",
      roughness: 0.86,
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
      const material = new THREE.LineBasicMaterial({
        color: expedition.color,
        transparent: true,
        opacity: index === 0 ? 0.8 : 0.33,
      });
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(260)),
        material,
      );
      scene.add(line);

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 16, 12),
        new THREE.MeshStandardMaterial({
          color: "#f4f1e8",
          emissive: expedition.color,
          emissiveIntensity: 2.4,
        }),
      );
      scene.add(marker);
      return { curve, line, marker, material };
    });

    const summitPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 3.8, 6),
      new THREE.MeshBasicMaterial({
        color: "#ff7138",
        transparent: true,
        opacity: 0.72,
      }),
    );
    summitPin.position.set(0, terrainHeight(0, 0) + 2, 0);
    scene.add(summitPin);

    const target = new THREE.Vector3(0, 18, 0);
    let frame = 0;
    const started = performance.now();

    const render = (time: number) => {
      const seconds = (time - started) / 1000;
      const orbit = -0.72 + Math.sin(seconds * 0.045) * 0.075;
      const distance = 118;
      camera.position.set(
        Math.cos(orbit) * distance,
        59 + Math.sin(seconds * 0.06) * 1.4,
        Math.sin(orbit) * distance,
      );
      camera.lookAt(target);

      routeObjects.forEach((route, index) => {
        const phase = (seconds * (0.026 + index * 0.003) + index * 0.29) % 1;
        route.marker.position.copy(route.curve.getPoint(phase));
        const isActive = Math.floor(seconds / 7) % expeditions.length === index;
        route.material.opacity = isActive ? 0.82 : 0.24;
        (route.marker.material as THREE.MeshStandardMaterial).opacity = isActive
          ? 1
          : 0.42;
        (route.marker.material as THREE.MeshStandardMaterial).transparent = true;
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
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
    });
    observer.observe(host);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      routeObjects.forEach(({ line, marker }) => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
        marker.geometry.dispose();
        (marker.material as THREE.Material).dispose();
      });
      cubeGeometry.dispose();
      cubeMaterial.dispose();
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
          LIVE WORLD
          <span>HEAD 8f2c91a</span>
        </div>
        <div className="header-meta">
          <span>27.9881° N</span>
          <span>86.9250° E</span>
        </div>
      </header>

      <section className="observatory-title" id="world">
        <p>THE MOUNTAIN, AS OF COMMIT 6,318</p>
        <h1>
          Matter moves.
          <span>History stays.</span>
        </h1>
        <div className="world-measure">
          <span>
            CURRENT EXTENSION
            <strong>+0.62 m</strong>
          </span>
          <span>
            HIGHEST STONE
            <strong>8,849.48 m</strong>
          </span>
        </div>
      </section>

      <aside className="recent-expeditions" aria-label="Recent expeditions">
        <p>RECENT EXPEDITIONS</p>
        <div className="active-expedition">
          <span
            className="route-swatch"
            style={{ background: active.color, boxShadow: `0 0 18px ${active.color}` }}
          />
          <div>
            <strong>{active.agent}</strong>
            <span>
              {active.action.toLowerCase()} one stone at{" "}
              {active.altitudeM.toLocaleString("en-US")} m
            </span>
          </div>
          <code>{active.commit}</code>
        </div>
        <div className="expedition-index">
          {expeditions.map((expedition, index) => (
            <div
              key={expedition.id}
              className={activeExpedition === index ? "active" : ""}
            >
              <span>{expedition.id}</span>
              <b>{expedition.agent}</b>
              <i style={{ background: expedition.color }} />
            </div>
          ))}
        </div>
      </aside>

      <footer className="observatory-footer">
        <span>PHYSICS v0.2 · 120 HZ · WORLD LOCKED</span>
        <span>
          Everest photograph by Slava Auchynnikau / Unsplash
        </span>
        <span>AUTONOMOUS EXPEDITIONS · PERMANENT PROVENANCE</span>
      </footer>
    </main>
  );
}

