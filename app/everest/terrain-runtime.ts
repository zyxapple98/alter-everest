import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface NavigationBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface NavigationSnapshot {
  distanceM: number;
  inputActive: boolean;
  inputIdleMs: number;
}

interface FocusFlight {
  startedAt: number;
  durationMs: number;
  fromPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
}

interface SurfaceNavigationOptions {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  domElement: HTMLElement;
  bounds: NavigationBounds;
  worldUnitsPerMeter: number;
  sampleSurfaceY(x: number, z: number): number;
}

const MOVEMENT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
]);

function smoothFlight(value: number) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

export class SurfaceNavigationController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly domElement: HTMLElement;
  private readonly bounds: NavigationBounds;
  private readonly worldUnitsPerMeter: number;
  private readonly sampleSurfaceY: (x: number, z: number) => number;
  private readonly pressedKeys = new Set<string>();
  private focusFlight: FocusFlight | null = null;
  private pointerActive = false;
  private transientInputUntil = 0;
  private lastInputAt = performance.now();
  private lastUpdateAt = performance.now();

  constructor(options: SurfaceNavigationOptions) {
    this.camera = options.camera;
    this.controls = options.controls;
    this.domElement = options.domElement;
    this.bounds = options.bounds;
    this.worldUnitsPerMeter = options.worldUnitsPerMeter;
    this.sampleSurfaceY = options.sampleSurfaceY;

    this.controls.addEventListener("start", this.handleControlStart);
    this.controls.addEventListener("end", this.handleControlEnd);
    this.domElement.addEventListener("wheel", this.handleWheel, {
      passive: true,
    });
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
  }

  private readonly handleControlStart = () => {
    this.pointerActive = true;
    this.lastInputAt = performance.now();
    this.cancelFocus();
  };

  private readonly handleControlEnd = () => {
    this.pointerActive = false;
    this.lastInputAt = performance.now();
  };

  private readonly handleWheel = () => {
    const now = performance.now();
    this.lastInputAt = now;
    this.transientInputUntil = now + 220;
    this.cancelFocus();
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (!MOVEMENT_KEYS.has(event.code)) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    event.preventDefault();
    this.pressedKeys.add(event.code);
    this.lastInputAt = performance.now();
    this.cancelFocus();
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    if (!MOVEMENT_KEYS.has(event.code)) return;
    this.pressedKeys.delete(event.code);
    this.lastInputAt = performance.now();
  };

  private readonly handleBlur = () => {
    this.pressedKeys.clear();
    this.pointerActive = false;
  };

  focus(target: THREE.Vector3, distanceM = 900) {
    const now = performance.now();
    const currentHorizontal = this.camera.position
      .clone()
      .sub(this.controls.target)
      .setY(0);
    if (currentHorizontal.lengthSq() < 0.0001) {
      currentHorizontal.set(0.72, 0, 0.69);
    }
    currentHorizontal.normalize();
    const targetSurface = target.clone();
    targetSurface.y = this.sampleSurfaceY(target.x, target.z);
    const horizontalM = distanceM * 0.78;
    const verticalM = distanceM * 0.62;
    const destination = targetSurface
      .clone()
      .addScaledVector(
        currentHorizontal,
        horizontalM * this.worldUnitsPerMeter,
      );
    destination.y += verticalM * this.worldUnitsPerMeter;
    this.focusFlight = {
      startedAt: now,
      durationMs: 720,
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition: destination,
      toTarget: targetSurface,
    };
    this.controls.enabled = false;
    this.lastInputAt = now;
  }

  nudge(forwardAmount: number, rightAmount: number) {
    const distanceM =
      this.camera.position.distanceTo(this.controls.target) /
      this.worldUnitsPerMeter;
    const stepM = THREE.MathUtils.clamp(distanceM * 0.09, 6, 420);
    this.translateOnGround(forwardAmount, rightAmount, stepM);
    this.lastInputAt = performance.now();
    this.cancelFocus();
  }

  targetPlanarDistanceM(point: THREE.Vector3) {
    return (
      Math.hypot(
        this.controls.target.x - point.x,
        this.controls.target.z - point.z,
      ) / this.worldUnitsPerMeter
    );
  }

  private cancelFocus() {
    if (!this.focusFlight) return;
    this.focusFlight = null;
    this.controls.enabled = true;
  }

  private translateOnGround(
    forwardAmount: number,
    rightAmount: number,
    distanceM: number,
  ) {
    const forward = this.controls.target
      .clone()
      .sub(this.camera.position)
      .setY(0);
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const movement = forward
      .multiplyScalar(forwardAmount)
      .addScaledVector(right, rightAmount);
    if (movement.lengthSq() > 1) movement.normalize();
    movement.multiplyScalar(distanceM * this.worldUnitsPerMeter);
    this.camera.position.add(movement);
    this.controls.target.add(movement);
  }

  update(time: number, clearanceM: number): NavigationSnapshot {
    const elapsedSeconds = THREE.MathUtils.clamp(
      (time - this.lastUpdateAt) / 1000,
      0,
      0.05,
    );
    this.lastUpdateAt = time;

    if (this.focusFlight) {
      const progress =
        (time - this.focusFlight.startedAt) /
        this.focusFlight.durationMs;
      const eased = smoothFlight(progress);
      this.camera.position.lerpVectors(
        this.focusFlight.fromPosition,
        this.focusFlight.toPosition,
        eased,
      );
      this.controls.target.lerpVectors(
        this.focusFlight.fromTarget,
        this.focusFlight.toTarget,
        eased,
      );
      this.camera.lookAt(this.controls.target);
      if (progress >= 1) {
        this.focusFlight = null;
        this.controls.enabled = true;
      }
    } else {
      this.controls.update();
    }

    const forwardAmount =
      Number(
        this.pressedKeys.has("KeyW") ||
          this.pressedKeys.has("ArrowUp"),
      ) -
      Number(
        this.pressedKeys.has("KeyS") ||
          this.pressedKeys.has("ArrowDown"),
      );
    const rightAmount =
      Number(
        this.pressedKeys.has("KeyD") ||
          this.pressedKeys.has("ArrowRight"),
      ) -
      Number(
        this.pressedKeys.has("KeyA") ||
          this.pressedKeys.has("ArrowLeft"),
      );
    if (forwardAmount || rightAmount) {
      const distanceM =
        this.camera.position.distanceTo(this.controls.target) /
        this.worldUnitsPerMeter;
      const speedMPerSecond = THREE.MathUtils.clamp(
        distanceM * 0.72,
        8,
        1_100,
      );
      this.translateOnGround(
        forwardAmount,
        rightAmount,
        speedMPerSecond * elapsedSeconds,
      );
      this.lastInputAt = time;
    }

    const clampedTargetX = THREE.MathUtils.clamp(
      this.controls.target.x,
      this.bounds.minX,
      this.bounds.maxX,
    );
    const clampedTargetZ = THREE.MathUtils.clamp(
      this.controls.target.z,
      this.bounds.minZ,
      this.bounds.maxZ,
    );
    this.camera.position.x += clampedTargetX - this.controls.target.x;
    this.camera.position.z += clampedTargetZ - this.controls.target.z;
    this.controls.target.x = clampedTargetX;
    this.controls.target.z = clampedTargetZ;

    const targetSurfaceY = this.sampleSurfaceY(
      this.controls.target.x,
      this.controls.target.z,
    );
    const targetYShift = targetSurfaceY - this.controls.target.y;
    this.controls.target.y = targetSurfaceY;
    this.camera.position.y += targetYShift;

    const cameraInsideBounds =
      this.camera.position.x >= this.bounds.minX &&
      this.camera.position.x <= this.bounds.maxX &&
      this.camera.position.z >= this.bounds.minZ &&
      this.camera.position.z <= this.bounds.maxZ;
    if (cameraInsideBounds) {
      const cameraSurfaceY = this.sampleSurfaceY(
        this.camera.position.x,
        this.camera.position.z,
      );
      const minimumCameraY =
        cameraSurfaceY +
        Math.max(0.65, clearanceM) * this.worldUnitsPerMeter;
      this.camera.position.y = Math.max(
        this.camera.position.y,
        minimumCameraY,
      );
    }

    const minimumDistance =
      Math.max(1.6, clearanceM * 1.15) *
      this.worldUnitsPerMeter;
    const viewOffset = this.camera.position
      .clone()
      .sub(this.controls.target);
    if (viewOffset.lengthSq() < minimumDistance * minimumDistance) {
      if (viewOffset.lengthSq() < 0.000001) {
        viewOffset.set(0, 0.55, 0.84);
      }
      this.camera.position
        .copy(this.controls.target)
        .add(viewOffset.setLength(minimumDistance));
    }

    // Keep the whole camera boom above the heightfield, not only its two end
    // points. On a convex ridge both the camera and target may be legal while
    // the sight line still cuts through an intervening voxel column.
    const boom = this.camera.position
      .clone()
      .sub(this.controls.target);
    let boomLift = 0;
    for (let step = 1; step <= 7; step += 1) {
      const fraction = step / 8;
      const sampleX =
        this.controls.target.x + boom.x * fraction;
      const sampleZ =
        this.controls.target.z + boom.z * fraction;
      if (
        sampleX < this.bounds.minX ||
        sampleX > this.bounds.maxX ||
        sampleZ < this.bounds.minZ ||
        sampleZ > this.bounds.maxZ
      ) {
        continue;
      }
      const sightY =
        this.controls.target.y + boom.y * fraction;
      const requiredY =
        this.sampleSurfaceY(sampleX, sampleZ) +
        Math.max(0.7, clearanceM * 0.55) *
          this.worldUnitsPerMeter;
      boomLift = Math.max(boomLift, requiredY - sightY);
    }
    if (boomLift > 0) {
      this.camera.position.y += boomLift;
    }

    const distanceM =
      this.camera.position.distanceTo(this.controls.target) /
      this.worldUnitsPerMeter;
    const inputActive =
      this.pointerActive ||
      this.pressedKeys.size > 0 ||
      this.focusFlight !== null ||
      time < this.transientInputUntil;
    return {
      distanceM,
      inputActive,
      inputIdleMs: Math.max(0, time - this.lastInputAt),
    };
  }

  dispose() {
    this.controls.removeEventListener("start", this.handleControlStart);
    this.controls.removeEventListener("end", this.handleControlEnd);
    this.domElement.removeEventListener("wheel", this.handleWheel);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.pressedKeys.clear();
  }
}

export interface LodBand<T extends string> {
  value: T;
  maximumDistanceM: number;
}

export class StableLodSelector<T extends string> {
  private readonly bands: ReadonlyArray<LodBand<T>>;
  private current: T;
  private candidate: T | null = null;
  private candidateSince = 0;

  constructor(bands: ReadonlyArray<LodBand<T>>, initial: T) {
    this.bands = bands;
    this.current = initial;
  }

  private rawSelection(distanceM: number) {
    return (
      this.bands.find(
        ({ maximumDistanceM }) => distanceM < maximumDistanceM,
      )?.value ?? this.bands[this.bands.length - 1].value
    );
  }

  update(distanceM: number, time: number, inputActive: boolean) {
    let desired = this.rawSelection(distanceM);
    const currentIndex = this.bands.findIndex(
      ({ value }) => value === this.current,
    );
    const desiredIndex = this.bands.findIndex(
      ({ value }) => value === desired,
    );
    if (desiredIndex < currentIndex) {
      const closerBoundary =
        this.bands[desiredIndex].maximumDistanceM * 0.9;
      if (distanceM >= closerBoundary) desired = this.current;
    } else if (desiredIndex > currentIndex) {
      const fartherBoundary =
        this.bands[currentIndex].maximumDistanceM * 1.12;
      if (distanceM <= fartherBoundary) desired = this.current;
    }

    if (desired === this.current) {
      this.candidate = null;
      return this.current;
    }
    if (desired !== this.candidate) {
      this.candidate = desired;
      this.candidateSince = time;
      return this.current;
    }
    const settleMs = inputActive ? 180 : 70;
    if (time - this.candidateSince >= settleMs) {
      this.current = desired;
      this.candidate = null;
    }
    return this.current;
  }
}

export interface ScreenSpaceLod<T extends string> {
  value: T;
  cellM: number;
}

/**
 * Selects a voxel size by its projected screen footprint. The same camera
 * produces the same visual density on a phone, a laptop, or a large display;
 * hysteresis keeps a level from oscillating while the wheel is still moving.
 */
export class ScreenSpaceLodSelector<T extends string> {
  private readonly levels: ReadonlyArray<ScreenSpaceLod<T>>;
  private readonly targetCellPixels: number;
  private current: T;
  private candidate: T | null = null;
  private candidateSince = 0;

  constructor(
    levels: ReadonlyArray<ScreenSpaceLod<T>>,
    initial: T,
    targetCellPixels = 11,
  ) {
    this.levels = levels;
    this.current = initial;
    this.targetCellPixels = targetCellPixels;
  }

  private projectedPixels(
    cellM: number,
    distanceM: number,
    viewportHeight: number,
    verticalFovRadians: number,
  ) {
    const focalPixels =
      viewportHeight /
      (2 * Math.tan(Math.max(0.01, verticalFovRadians) / 2));
    return (
      (cellM * focalPixels) / Math.max(cellM * 0.5, distanceM)
    );
  }

  private rawSelection(
    distanceM: number,
    viewportHeight: number,
    verticalFovRadians: number,
  ) {
    let selected = this.levels[0];
    let bestError = Number.POSITIVE_INFINITY;
    this.levels.forEach((level) => {
      const pixels = this.projectedPixels(
        level.cellM,
        distanceM,
        viewportHeight,
        verticalFovRadians,
      );
      const error = Math.abs(
        Math.log2(Math.max(0.001, pixels) / this.targetCellPixels),
      );
      if (error < bestError) {
        bestError = error;
        selected = level;
      }
    });
    return selected.value;
  }

  update(
    distanceM: number,
    viewportHeight: number,
    verticalFovRadians: number,
    time: number,
    inputActive: boolean,
  ) {
    const desired = this.rawSelection(
      distanceM,
      viewportHeight,
      verticalFovRadians,
    );
    if (desired === this.current) {
      this.candidate = null;
      return this.current;
    }

    const currentLevel = this.levels.find(
      ({ value }) => value === this.current,
    );
    const desiredLevel = this.levels.find(
      ({ value }) => value === desired,
    );
    if (currentLevel && desiredLevel) {
      const currentPixels = this.projectedPixels(
        currentLevel.cellM,
        distanceM,
        viewportHeight,
        verticalFovRadians,
      );
      const desiredPixels = this.projectedPixels(
        desiredLevel.cellM,
        distanceM,
        viewportHeight,
        verticalFovRadians,
      );
      const currentError = Math.abs(
        Math.log2(
          Math.max(0.001, currentPixels) / this.targetCellPixels,
        ),
      );
      const desiredError = Math.abs(
        Math.log2(
          Math.max(0.001, desiredPixels) / this.targetCellPixels,
        ),
      );
      if (currentError - desiredError < 0.14) {
        this.candidate = null;
        return this.current;
      }
    }

    if (this.candidate !== desired) {
      this.candidate = desired;
      this.candidateSince = time;
      return this.current;
    }
    if (time - this.candidateSince >= (inputActive ? 150 : 65)) {
      this.current = desired;
      this.candidate = null;
    }
    return this.current;
  }
}
