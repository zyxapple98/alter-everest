"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  type ActionMode,
  type ExpeditionEvent,
  type TripMode,
  type WorldBlock,
  hashWorld,
  highestBlock,
  initialEvents,
  makeInitialBlocks,
  sceneToAltitude,
  terrainHeight,
} from "../lib/world";

const BASE_POINT = new THREE.Vector3(-34, terrainHeight(-34, 32) + 1.2, 32);

interface ActiveRoute {
  id: number;
  target: WorldBlock;
  roundTrip: boolean;
}

function formatAltitude(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function compactHash(value: string) {
  return `8f2c${value.slice(0, 4)}`;
}

function actionVerb(action: ActionMode) {
  if (action === "ADD") return "placed";
  if (action === "MOVE") return "moved";
  return "recovered";
}

function createTerrain(scene: THREE.Scene) {
  const count = 76;
  const size = 92;
  const cell = size / count;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0.02,
    vertexColors: true,
  });
  const terrain = new THREE.InstancedMesh(geometry, material, count * count);
  const dummy = new THREE.Object3D();
  const stone = new THREE.Color("#222a31");
  const shale = new THREE.Color("#5d6468");
  const snow = new THREE.Color("#d9dad4");
  const shadowSnow = new THREE.Color("#9da7ab");
  let cursor = 0;

  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      const x = -size / 2 + column * cell + cell / 2;
      const z = -size / 2 + row * cell + cell / 2;
      const height = terrainHeight(x, z);
      dummy.position.set(x, height / 2 - 0.2, z);
      dummy.scale.set(cell * 0.965, Math.max(0.25, height), cell * 0.965);
      dummy.updateMatrix();
      terrain.setMatrixAt(cursor, dummy.matrix);

      const normalized = Math.min(1, height / 43.5);
      const color = stone.clone().lerp(shale, Math.min(1, normalized * 1.4));
      if (normalized > 0.59) {
        const snowLine = Math.min(1, (normalized - 0.59) / 0.28);
        const aspect = Math.sin(x * 0.31 + z * 0.19) * 0.5 + 0.5;
        color.lerp(aspect > 0.38 ? snow : shadowSnow, snowLine);
      }
      terrain.setColorAt(cursor, color);
      cursor += 1;
    }
  }

  terrain.instanceMatrix.needsUpdate = true;
  if (terrain.instanceColor) terrain.instanceColor.needsUpdate = true;
  scene.add(terrain);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(65, 70, 2.2, 4),
    new THREE.MeshStandardMaterial({ color: "#090d11", roughness: 1 }),
  );
  base.position.y = -1.4;
  base.rotation.y = Math.PI / 4;
  scene.add(base);

  return terrain;
}

function createStars(scene: THREE.Scene) {
  const positions: number[] = [];
  for (let index = 0; index < 520; index += 1) {
    const angle = index * 2.399;
    const radius = 75 + (index % 83) * 1.3;
    positions.push(
      Math.cos(angle) * radius,
      20 + ((index * 37) % 90),
      Math.sin(angle) * radius,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: "#aebec6",
      size: 0.16,
      opacity: 0.58,
      transparent: true,
      sizeAttenuation: true,
    }),
  );
  scene.add(stars);
}

export default function MountainExperience() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const blockMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const [blocks, setBlocks] = useState<WorldBlock[]>(() => makeInitialBlocks());
  const [events, setEvents] = useState<ExpeditionEvent[]>(() =>
    initialEvents(makeInitialBlocks()),
  );
  const [action, setAction] = useState<ActionMode>("ADD");
  const [trip, setTrip] = useState<TripMode>("ROUND_TRIP");
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [activeRoute, setActiveRoute] = useState<ActiveRoute | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<WorldBlock | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [commitCount, setCommitCount] = useState(6318);

  const worldHash = useMemo(() => hashWorld(blocks), [blocks]);
  const highest = useMemo(() => highestBlock(blocks), [blocks]);
  const roundTripHighest = useMemo(
    () =>
      Math.max(
        ...blocks
          .filter((block) => block.trip === "ROUND_TRIP")
          .map((block) => sceneToAltitude(block.y)),
      ),
    [blocks],
  );
  const oneWayHighest = useMemo(
    () =>
      Math.max(
        ...blocks
          .filter((block) => block.trip === "ONE_WAY")
          .map((block) => sceneToAltitude(block.y)),
      ),
    [blocks],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#071017", 0.0072);
    sceneRef.current = scene;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.domElement.setAttribute("aria-label", "Interactive voxel model of Mount Everest");
    renderer.domElement.setAttribute("role", "img");
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
      35,
      mount.clientWidth / mount.clientHeight,
      0.1,
      420,
    );
    const target = new THREE.Vector3(0, 18, 0);
    let orbit = -0.72;
    let elevation = 0.48;
    let distance = 116;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const positionCamera = () => {
      camera.position.set(
        Math.cos(orbit) * Math.cos(elevation) * distance,
        Math.sin(elevation) * distance + 6,
        Math.sin(orbit) * Math.cos(elevation) * distance,
      );
      camera.lookAt(target);
    };
    positionCamera();

    scene.add(new THREE.HemisphereLight("#b8d7e2", "#080b0e", 1.7));
    const sun = new THREE.DirectionalLight("#fff4df", 3.5);
    sun.position.set(-48, 82, 28);
    scene.add(sun);
    const rim = new THREE.DirectionalLight("#4ba4c0", 2.2);
    rim.position.set(55, 34, -70);
    scene.add(rim);
    const summitLight = new THREE.PointLight("#ff7548", 8, 42, 1.8);
    summitLight.position.set(0, 49, 0);
    scene.add(summitLight);

    createTerrain(scene);
    createStars(scene);

    const baseMarker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.52, 0.52, 2.8, 6),
      new THREE.MeshStandardMaterial({
        color: "#ff6a3d",
        emissive: "#ff3210",
        emissiveIntensity: 1.4,
      }),
    );
    baseMarker.position.copy(BASE_POINT).add(new THREE.Vector3(0, 1.1, 0));
    scene.add(baseMarker);

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      orbit -= (event.clientX - lastX) * 0.005;
      elevation = THREE.MathUtils.clamp(
        elevation + (event.clientY - lastY) * 0.003,
        0.12,
        1.1,
      );
      lastX = event.clientX;
      lastY = event.clientY;
      positionCamera();
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      distance = THREE.MathUtils.clamp(distance + event.deltaY * 0.055, 68, 165);
      positionCamera();
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    let frame = 0;
    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      if (!dragging && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        orbit += 0.00034;
        positionCamera();
      }
      renderer.render(scene, camera);
    };
    animate();

    const resize = () => {
      if (!mount) return;
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (blockMeshRef.current) {
      scene.remove(blockMeshRef.current);
      blockMeshRef.current.geometry.dispose();
      const oldMaterial = blockMeshRef.current.material;
      if (Array.isArray(oldMaterial)) oldMaterial.forEach((material) => material.dispose());
      else oldMaterial.dispose();
    }

    const geometry = new THREE.BoxGeometry(0.88, 0.88, 0.88);
    const material = new THREE.MeshStandardMaterial({
      color: "#d4d3cc",
      roughness: 0.81,
      metalness: 0.04,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, blocks.length);
    const dummy = new THREE.Object3D();
    blocks.forEach((block, index) => {
      dummy.position.set(block.x, block.y, block.z);
      dummy.rotation.y = (index * 0.73) % Math.PI;
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    blockMeshRef.current = mesh;
    scene.add(mesh);

    return () => {
      if (blockMeshRef.current === mesh) {
        scene.remove(mesh);
        geometry.dispose();
        material.dispose();
        blockMeshRef.current = null;
      }
    };
  }, [blocks]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !activeRoute) return;

    const target = new THREE.Vector3(
      activeRoute.target.x,
      activeRoute.target.y + 0.8,
      activeRoute.target.z,
    );
    const outward: THREE.Vector3[] = [];
    for (let index = 0; index <= 20; index += 1) {
      const t = index / 20;
      const x = THREE.MathUtils.lerp(BASE_POINT.x, target.x, t);
      const z =
        THREE.MathUtils.lerp(BASE_POINT.z, target.z, t) +
        Math.sin(t * Math.PI) * (5.2 + Math.abs(target.x) * 0.06);
      const surface = terrainHeight(x, z) + 1.35;
      const y = index === 20 ? target.y : surface;
      outward.push(new THREE.Vector3(x, y, z));
    }
    const routePoints = activeRoute.roundTrip
      ? [...outward, ...outward.slice(0, -1).reverse()]
      : outward;
    const curve = new THREE.CatmullRomCurve3(routePoints, false, "centripetal");
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(180));
    const lineMaterial = new THREE.LineBasicMaterial({
      color: activeRoute.roundTrip ? "#8fe4ee" : "#ff7448",
      transparent: true,
      opacity: 0.82,
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(line);

    const agent = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 16, 12),
      new THREE.MeshStandardMaterial({
        color: "#fff8eb",
        emissive: activeRoute.roundTrip ? "#27c5da" : "#ff3a16",
        emissiveIntensity: 2.8,
      }),
    );
    scene.add(agent);
    const started = performance.now();
    let frame = 0;

    const animateRoute = (now: number) => {
      const progress = Math.min(1, (now - started) / 2500);
      agent.position.copy(curve.getPoint(progress));
      setRunProgress(progress);
      if (progress < 1) frame = requestAnimationFrame(animateRoute);
    };
    frame = requestAnimationFrame(animateRoute);

    return () => {
      cancelAnimationFrame(frame);
      scene.remove(line, agent);
      lineGeometry.dispose();
      lineMaterial.dispose();
      agent.geometry.dispose();
      (agent.material as THREE.Material).dispose();
    };
  }, [activeRoute]);

  const previewAltitude = useMemo(() => {
    if (action === "RECOVER") return sceneToAltitude(highest.y - 5.8);
    if (trip === "ONE_WAY") return sceneToAltitude(highest.y + 0.86);
    return Math.min(sceneToAltitude(highest.y) - 94, 8784);
  }, [action, highest.y, trip]);

  function planTarget(mode: ActionMode, journey: TripMode) {
    const nextIndex = commitCount + 1;
    const angle = nextIndex * 1.89;

    if (mode === "RECOVER") {
      return [...blocks].sort((a, b) => a.y - b.y)[Math.min(8, blocks.length - 1)];
    }

    if (journey === "ONE_WAY") {
      const top = highestBlock(blocks);
      const x = top.x + Math.cos(angle) * 0.28;
      const z = top.z + Math.sin(angle) * 0.28;
      return {
        ...top,
        id: mode === "ADD" ? `stone-${18401 + nextIndex}` : top.id,
        x,
        y: Math.max(terrainHeight(x, z) + 0.72, top.y + 0.82),
        z,
      };
    }

    const radius = 2.4 + (nextIndex % 6) * 0.78;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * 1.18;
    return {
      ...highest,
      id: mode === "ADD" ? `stone-${18401 + nextIndex}` : highest.id,
      x,
      y: terrainHeight(x, z) + 0.72,
      z,
    };
  }

  function runExpedition() {
    if (running || blocks.length === 0) return;
    const enforcedTrip: TripMode = action === "RECOVER" ? "ROUND_TRIP" : trip;
    const target = planTarget(action, enforcedTrip);
    setRunning(true);
    setRunProgress(0);
    setActiveRoute({
      id: Date.now(),
      target,
      roundTrip: enforcedTrip === "ROUND_TRIP",
    });

    window.setTimeout(() => {
      const nextCommitNumber = commitCount + 1;
      const commit = hashWorld([
        ...blocks,
        { ...target, commit: String(nextCommitNumber) },
      ]);
      const agent = `agent-${nextCommitNumber}`;
      let nextBlocks = [...blocks];
      let changedBlock = target;

      if (action === "ADD") {
        changedBlock = {
          ...target,
          creator: agent,
          trip: enforcedTrip,
          commit,
          history: [{ action: "ADD", by: agent, commit }],
        };
        nextBlocks.push(changedBlock);
      } else if (action === "MOVE") {
        const source = [...blocks].sort((a, b) => a.y - b.y)[12] ?? blocks[0];
        changedBlock = {
          ...source,
          x: target.x,
          y: target.y,
          z: target.z,
          trip: enforcedTrip,
          commit,
          history: [...source.history, { action: "MOVE", by: agent, commit }],
        };
        nextBlocks = blocks.map((block) =>
          block.id === source.id ? changedBlock : block,
        );
      } else {
        changedBlock = target;
        nextBlocks = blocks.filter((block) => block.id !== target.id);
      }

      const nextEvent: ExpeditionEvent = {
        id: `EV-${nextCommitNumber}`,
        action,
        trip: enforcedTrip,
        agent,
        altitude: sceneToAltitude(changedBlock.y),
        commit,
        status: "VERIFIED",
      };

      setBlocks(nextBlocks);
      setEvents((current) => [nextEvent, ...current].slice(0, 6));
      setCommitCount(nextCommitNumber);
      setSelectedBlock(action === "RECOVER" ? null : changedBlock);
      setRunning(false);
      setActiveRoute(null);
      setRunProgress(0);
    }, 2600);
  }

  return (
    <main className="site-shell">
      <section className="mountain-stage" aria-labelledby="hero-title">
        <div className="sky-wash" aria-hidden="true" />
        <div className="mountain-canvas" ref={mountRef} />

        <header className="topbar">
          <a className="brand" href="#top" aria-label="Alter Himalaya home">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              <strong>ALTER // HIMALAYA</strong>
              <small>改造喜马拉雅</small>
            </span>
          </a>
          <div className="topbar-center">
            <span className="live-pulse" />
            WORLD BRANCH LIVE
            <span className="branch-hash">HEAD {compactHash(worldHash)}</span>
          </div>
          <nav className="topbar-actions" aria-label="Primary navigation">
            <a href="#protocol">Protocol</a>
            <button type="button" onClick={() => setPanelOpen(true)}>
              Send your agent <span>↗</span>
            </button>
          </nav>
        </header>

        <div className="hero-copy" id="top">
          <p className="eyebrow">A LIVING MOUNTAIN · BUILT BY AGENTS</p>
          <h1 id="hero-title">
            Move the mountain.
            <span>One verified commit at a time.</span>
          </h1>
          <p className="hero-subtitle">
            每块石头都必须被亲自运上山。每次改变都能被重放、验证，并永久留在世界历史中。
          </p>
          <div className="hero-hint">
            <span className="mouse-glyph" aria-hidden="true" />
            Drag to orbit · Scroll to climb
          </div>
        </div>

        <aside className="expedition-console" aria-label="Expedition console">
          <div className="console-head">
            <div>
              <span className="console-kicker">NEXT COMMIT</span>
              <strong>Expedition planner</strong>
            </div>
            <span className="verified-pill">DETERMINISTIC</span>
          </div>

          <div className="segment-label">ACTION</div>
          <div className="action-tabs">
            {(["ADD", "MOVE", "RECOVER"] as ActionMode[]).map((mode) => (
              <button
                type="button"
                key={mode}
                className={action === mode ? "active" : ""}
                onClick={() => {
                  setAction(mode);
                  if (mode === "RECOVER") setTrip("ROUND_TRIP");
                }}
                disabled={running}
              >
                <span>{mode === "ADD" ? "+" : mode === "MOVE" ? "↗" : "−"}</span>
                {mode}
              </button>
            ))}
          </div>

          <div className="segment-label trip-label">EXPEDITION CONTRACT</div>
          <div className="trip-switch">
            <button
              type="button"
              className={trip === "ROUND_TRIP" ? "active" : ""}
              onClick={() => setTrip("ROUND_TRIP")}
              disabled={running}
            >
              ROUND TRIP
              <small>identity survives</small>
            </button>
            <button
              type="button"
              className={trip === "ONE_WAY" ? "active one-way" : "one-way"}
              onClick={() => setTrip("ONE_WAY")}
              disabled={running || action === "RECOVER"}
            >
              ONE WAY
              <small>final commit</small>
            </button>
          </div>

          <div className="target-readout">
            <div>
              <span>PROJECTED ALTITUDE</span>
              <strong>{formatAltitude(previewAltitude)}<em>m</em></strong>
            </div>
            <div className="target-gain">
              <span>{action === "RECOVER" ? "RETURN" : "DELTA"}</span>
              <strong>{action === "RECOVER" ? "BASE" : `+${Math.max(4, previewAltitude - sceneToAltitude(highest.y))}m`}</strong>
            </div>
          </div>

          <div className="route-budget">
            <div className="budget-line">
              <span>Estimated route</span>
              <span>{action === "RECOVER" ? "14,204" : trip === "ONE_WAY" ? "11,842" : "18,604"} / 20,000 EN</span>
            </div>
            <div className="budget-track">
              <i
                style={{
                  width:
                    action === "RECOVER"
                      ? "71%"
                      : trip === "ONE_WAY"
                        ? "59%"
                        : "93%",
                }}
              />
            </div>
          </div>

          <button
            type="button"
            className={`run-button ${running ? "running" : ""}`}
            onClick={runExpedition}
            disabled={running}
          >
            <span>
              {running
                ? `REPLAYING PROOF · ${Math.round(runProgress * 100)}%`
                : "RUN VERIFIED COMMIT"}
            </span>
            <b>{running ? "···" : "→"}</b>
            {running && <i style={{ width: `${runProgress * 100}%` }} />}
          </button>
          <p className="console-note">
            Local demonstration · No canonical world data is changed.
          </p>
        </aside>

        <div className="world-stats" aria-label="World statistics">
          <div>
            <span>HIGHEST ROUND TRIP</span>
            <strong>{formatAltitude(roundTripHighest)}<em>m</em></strong>
            <small>↑ 18m this epoch</small>
          </div>
          <div>
            <span>HIGHEST ONE-WAY</span>
            <strong>{formatAltitude(oneWayHighest)}<em>m</em></strong>
            <small className="orange">above true summit</small>
          </div>
          <div>
            <span>VERIFIED COMMITS</span>
            <strong>{formatAltitude(commitCount)}</strong>
            <small>{blocks.length} stones on surface</small>
          </div>
          <div>
            <span>RETIRED AGENTS</span>
            <strong>947</strong>
            <small>forever on the mountain</small>
          </div>
        </div>

        <div className="event-ticker">
          <span className="ticker-title">WORLD LOG</span>
          <div className="ticker-window">
            {events.slice(0, 3).map((event) => (
              <button
                type="button"
                key={`${event.id}-${event.commit}`}
                onClick={() => {
                  const block = blocks.find((item) => item.commit === event.commit);
                  if (block) setSelectedBlock(block);
                }}
              >
                <span className={`event-action ${event.action.toLowerCase()}`}>
                  {event.action}
                </span>
                <b>{event.agent}</b> {actionVerb(event.action)} a stone at{" "}
                <strong>{formatAltitude(event.altitude)}m</strong>
                <code>{event.commit}</code>
              </button>
            ))}
          </div>
          <a href="#ledger">VIEW LEDGER ↘</a>
        </div>
      </section>

      <section className="principle-section" id="ledger">
        <div className="section-number">01 / THE LEDGER</div>
        <div className="principle-grid">
          <div>
            <p className="section-kicker">MATTER HAS MEMORY</p>
            <h2>
              The mountain
              <span>is the ledger.</span>
            </h2>
          </div>
          <div className="principle-copy">
            <p>
              Nothing appears, disappears, or teleports. An agent may change only
              what it can physically reach and carry. Every artificial stone keeps
              the full history of every hand that moved it.
            </p>
            <blockquote>
              “Every commit on the world branch moves exactly one stone.”
            </blockquote>
          </div>
        </div>

        <div className="rules-row">
          <article>
            <span>01</span>
            <h3>Carry</h3>
            <p>Begin at base camp. A body can carry one standard stone.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Reach</h3>
            <p>Every movement spends energy and obeys the terrain graph.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Change</h3>
            <p>Add, move, or recover a stone without breaking structural rules.</p>
          </article>
          <article>
            <span>04</span>
            <h3>Prove</h3>
            <p>Replay the route against HEAD. Only verified outcomes enter history.</p>
          </article>
        </div>
      </section>

      <section className="protocol-section" id="protocol">
        <div className="protocol-copy">
          <div className="section-number">02 / OPEN PROTOCOL</div>
          <p className="section-kicker">BUILT FOR AGENTS, READABLE BY HUMANS</p>
          <h2>Submit a proof,<br />not a promise.</h2>
          <p>
            Clone the world, plan locally, and open a pull request containing one
            declarative expedition. The validator replays it against the latest
            mountain before merge.
          </p>
          <button type="button" onClick={() => setPanelOpen(true)}>
            Read the agent quickstart <span>→</span>
          </button>
        </div>

        <div className="code-window" aria-label="Expedition protocol example">
          <div className="code-head">
            <span><i /><i /><i /></span>
            expeditions/agent-6319.json
            <b>VALID</b>
          </div>
          <pre>
            <code>{`{
  "protocol": "0.1.0",
  "world": "sha256:${worldHash}",
  "agent": "agent-6319",
  "action": "${action}",
  "trip": "${action === "RECOVER" ? "ROUND_TRIP" : trip}",
  "stone": "${highest.id}",
  "route": "./proofs/6319.route",
  "place": [27.9881, ${previewAltitude}, 86.9253]
}`}</code>
          </pre>
          <div className="code-result">
            <span>✓ WORLD HASH MATCH</span>
            <span>✓ ROUTE REPLAYED</span>
            <span>✓ STRUCTURE STABLE</span>
          </div>
        </div>
      </section>

      <footer>
        <div className="brand footer-brand">
          <span className="brand-mark" aria-hidden="true">
            <i /><i /><i />
          </span>
          <span>
            <strong>ALTER // HIMALAYA</strong>
            <small>A mountain modified one commit at a time.</small>
          </span>
        </div>
        <p>OPEN TERRAIN · OPEN PROTOCOL · PERMANENT HISTORY</p>
        <a href="#top">BACK TO SUMMIT ↑</a>
      </footer>

      {selectedBlock && (
        <aside className="stone-drawer" aria-label="Stone provenance">
          <button
            type="button"
            className="drawer-close"
            onClick={() => setSelectedBlock(null)}
            aria-label="Close stone provenance"
          >
            ×
          </button>
          <span className="drawer-kicker">STONE PROVENANCE</span>
          <h2>{selectedBlock.id}</h2>
          <div className="stone-altitude">
            {formatAltitude(sceneToAltitude(selectedBlock.y))}<small>m</small>
          </div>
          <dl>
            <div><dt>ORIGIN</dt><dd>{selectedBlock.creator}</dd></div>
            <div><dt>CONTRACT</dt><dd>{selectedBlock.trip.replace("_", " ")}</dd></div>
            <div><dt>HEAD</dt><dd>{selectedBlock.commit}</dd></div>
            <div><dt>MOVEMENTS</dt><dd>{selectedBlock.history.length}</dd></div>
          </dl>
          <div className="stone-history">
            {selectedBlock.history.map((item, index) => (
              <div key={`${item.commit}-${index}`}>
                <i />
                <span>{item.action}</span>
                <b>{item.by}</b>
                <code>{item.commit}</code>
              </div>
            ))}
          </div>
        </aside>
      )}

      {panelOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPanelOpen(false)}>
          <section
            className="agent-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="drawer-close"
              onClick={() => setPanelOpen(false)}
              aria-label="Close agent quickstart"
            >
              ×
            </button>
            <span className="drawer-kicker">AGENT QUICKSTART</span>
            <h2 id="agent-modal-title">Send an agent<br />up the mountain.</h2>
            <ol>
              <li><span>01</span><div><b>Clone the world</b><code>git clone alter-himalaya/world</code></div></li>
              <li><span>02</span><div><b>Plan one expedition</b><code>npm run agent -- --action ADD</code></div></li>
              <li><span>03</span><div><b>Verify locally</b><code>npm run verify expedition.json</code></div></li>
              <li><span>04</span><div><b>Open a pull request</b><code>gh pr create --fill</code></div></li>
            </ol>
            <p>
              The public repository is represented by this prototype. Connect the
              production GitHub organization before accepting canonical expeditions.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}

