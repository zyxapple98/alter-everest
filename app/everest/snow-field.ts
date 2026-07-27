import * as THREE from "three";

export type SnowScaleMode = "work" | "mountain" | "overview";

export interface SnowVisualProfile {
  mode: SnowScaleMode;
  visibleCount: number;
  pointPixels: number;
  opacity: number;
  depthM: number;
  fallRate: number;
  windRate: number;
  turbulence: number;
}

interface SnowFieldUpdate {
  camera: THREE.PerspectiveCamera;
  distanceM: number;
  deltaSeconds: number;
  elapsedSeconds: number;
  reducedMotion: boolean;
}

const MAX_SNOW_PARTICLES = 680;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function smoothstep(minimum: number, maximum: number, value: number) {
  const normalized = clamp(
    (value - minimum) / Math.max(0.0001, maximum - minimum),
    0,
    1,
  );
  return normalized * normalized * (3 - 2 * normalized);
}

function wrapUnit(value: number) {
  return ((value % 1) + 1) % 1;
}

export function snowVisualProfile(
  distanceM: number,
  reducedMotion = false,
): SnowVisualProfile {
  const distance = Math.max(0, distanceM);
  const mountainMix = smoothstep(90, 900, distance);
  const overviewMix = smoothstep(2_200, 12_000, distance);
  const betweenScales = <T extends number>(
    work: T,
    mountain: T,
    overview: T,
  ) =>
    lerp(
      lerp(work, mountain, mountainMix),
      overview,
      overviewMix,
    );
  const baseProfile: SnowVisualProfile = {
    mode:
      distance < 260
        ? "work"
        : distance < 4_800
          ? "mountain"
          : "overview",
    visibleCount: Math.round(betweenScales(680, 560, 480)),
    pointPixels: betweenScales(4, 2.6, 1.85),
    opacity: betweenScales(0.84, 0.72, 0.6),
    depthM: clamp(28 + distance * 1.12, 32, 24_000),
    fallRate: betweenScales(0.12, 0.073, 0.036),
    windRate: betweenScales(0.022, 0.013, 0.007),
    turbulence: betweenScales(0.012, 0.008, 0.004),
  };

  if (!reducedMotion) return baseProfile;
  return {
    ...baseProfile,
    visibleCount: Math.max(
      64,
      Math.round(baseProfile.visibleCount * 0.32),
    ),
    pointPixels: baseProfile.pointPixels * 0.82,
    opacity: baseProfile.opacity * 0.42,
    fallRate: baseProfile.fallRate * 0.12,
    windRate: baseProfile.windRate * 0.12,
    turbulence: baseProfile.turbulence * 0.1,
  };
}

function createSnowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Snow texture canvas is unavailable.");
  }
  const center = canvas.width / 2;
  const glow = context.createRadialGradient(
    center,
    center,
    1,
    center,
    center,
    28,
  );
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.18, "rgba(246,253,255,0.96)");
  glow.addColorStop(0.52, "rgba(222,244,255,0.44)");
  glow.addColorStop(1, "rgba(205,238,255,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(center, center);
  context.strokeStyle = "rgba(255,255,255,0.76)";
  context.lineWidth = 2;
  for (let arm = 0; arm < 3; arm += 1) {
    context.rotate(Math.PI / 3);
    context.beginPath();
    context.moveTo(-18, 0);
    context.lineTo(18, 0);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function deterministicRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

export function createSnowField(worldUnitsPerMeter: number) {
  const random = deterministicRandom(0x45_56_45_52);
  const normalized = new Float32Array(MAX_SNOW_PARTICLES * 3);
  const character = new Float32Array(MAX_SNOW_PARTICLES * 3);
  const positions = new Float32Array(MAX_SNOW_PARTICLES * 3);
  const colors = new Float32Array(MAX_SNOW_PARTICLES * 3);
  const color = new THREE.Color();
  for (let index = 0; index < MAX_SNOW_PARTICLES; index += 1) {
    const offset = index * 3;
    normalized[offset] = random();
    normalized[offset + 1] = random();
    normalized[offset + 2] = random();
    character[offset] = random();
    character[offset + 1] = random();
    character[offset + 2] = random();
    const brightness = 0.72 + character[offset] * 0.28;
    color.setRGB(
      brightness * 0.88,
      brightness * 0.96,
      brightness,
    );
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setDrawRange(0, MAX_SNOW_PARTICLES);
  const texture = createSnowTexture();
  const material = new THREE.PointsMaterial({
    color: "#effaff",
    map: texture,
    size: 2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.5,
    alphaTest: 0.015,
    depthTest: true,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 32;
  const root = new THREE.Group();
  root.add(points);
  const cameraDirection = new THREE.Vector3();
  const horizontalDirection = new THREE.Vector3();

  return {
    root,
    update({
      camera,
      distanceM,
      deltaSeconds,
      elapsedSeconds,
      reducedMotion,
    }: SnowFieldUpdate) {
      const profile = snowVisualProfile(distanceM, reducedMotion);
      const frameSeconds = clamp(deltaSeconds, 0, 0.1);
      const depthM = profile.depthM;
      const heightM =
        depthM *
          Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) *
          2.35 +
        12;
      const widthM = heightM * Math.max(1, camera.aspect) * 1.08;

      camera.getWorldDirection(cameraDirection);
      root.position
        .copy(camera.position)
        .addScaledVector(
          cameraDirection,
          depthM * worldUnitsPerMeter * 0.5,
        );
      horizontalDirection
        .set(cameraDirection.x, 0, cameraDirection.z)
        .normalize();
      if (horizontalDirection.lengthSq() < 0.01) {
        horizontalDirection.set(0, 0, -1);
      }
      root.rotation.set(
        0,
        Math.atan2(horizontalDirection.x, horizontalDirection.z),
        0,
      );

      for (let index = 0; index < profile.visibleCount; index += 1) {
        const offset = index * 3;
        const fallVariation = 0.72 + character[offset] * 0.62;
        const windVariation = 0.62 + character[offset + 1] * 0.74;
        normalized[offset + 1] = wrapUnit(
          normalized[offset + 1] -
            frameSeconds * profile.fallRate * fallVariation,
        );
        normalized[offset] = wrapUnit(
          normalized[offset] +
            frameSeconds *
              (profile.windRate * windVariation +
                Math.sin(
                  elapsedSeconds * 0.58 +
                    character[offset + 2] * Math.PI * 2,
                ) *
                  profile.turbulence),
        );
        normalized[offset + 2] = wrapUnit(
          normalized[offset + 2] +
            frameSeconds *
              profile.turbulence *
              (character[offset + 1] - 0.5) *
              0.42,
        );
        positions[offset] =
          (normalized[offset] - 0.5) *
          widthM *
          worldUnitsPerMeter;
        positions[offset + 1] =
          (normalized[offset + 1] - 0.5) *
          heightM *
          worldUnitsPerMeter;
        positions[offset + 2] =
          (normalized[offset + 2] - 0.5) *
          depthM *
          worldUnitsPerMeter;
      }

      geometry.setDrawRange(0, profile.visibleCount);
      positionAttribute.needsUpdate = true;
      material.size = profile.pointPixels;
      material.opacity = profile.opacity;
      return profile;
    },
    dispose() {
      root.remove(points);
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
