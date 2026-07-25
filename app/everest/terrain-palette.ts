import * as THREE from "three";

export const MOUNTAIN_MATERIALS = {
  valleyRock: new THREE.Color("#343a3a"),
  weatheredGranite: new THREE.Color("#57534e"),
  summitGranite: new THREE.Color("#6c655e"),
  sedimentBand: new THREE.Color("#3b4141"),
  sunWarmedBand: new THREE.Color("#75695e"),
  blueIce: new THREE.Color("#8c9695"),
  snow: new THREE.Color("#d0d8d6"),
  placedGranite: "#8b8982",
  freshCut: "#786c62",
  summitSignal: "#ffc86b",
} as const;

export const TERRAIN_COLOR_SCRATCH = new THREE.Color();

function hashNoise(x: number, z: number, seed = 0) {
  let value = Math.imul(x + seed * 1013, 374761393);
  value = Math.imul(
    value ^ Math.imul(z - seed * 733, 668265263),
    1274126177,
  );
  value ^= value >>> 13;
  return ((value >>> 0) % 10000) / 10000;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = THREE.MathUtils.clamp(
    (value - edge0) / Math.max(0.0001, edge1 - edge0),
    0,
    1,
  );
  return t * t * (3 - 2 * t);
}

export function terrainColor(
  elevationM: number,
  slopeDegrees: number,
  x: number,
  z: number,
  shade: number,
) {
  const broadStrata =
    Math.sin(x * 0.005 + z * 0.0025) * 0.55 +
    Math.sin(z * 0.004 - x * 0.0018) * 0.45;
  const sedimentAmount =
    smoothstep(0.58, 0.9, Math.abs(broadStrata)) *
    (1 - smoothstep(7_650, 8_400, elevationM)) *
    0.2;
  const altitudeRock = TERRAIN_COLOR_SCRATCH
    .copy(MOUNTAIN_MATERIALS.valleyRock)
    .lerp(
      MOUNTAIN_MATERIALS.weatheredGranite,
      smoothstep(4_900, 6_900, elevationM),
    )
    .lerp(
      MOUNTAIN_MATERIALS.summitGranite,
      smoothstep(7_200, 8_650, elevationM) * 0.42,
    )
    .lerp(MOUNTAIN_MATERIALS.sedimentBand, sedimentAmount)
    .lerp(
      MOUNTAIN_MATERIALS.sunWarmedBand,
      smoothstep(0.45, 0.95, broadStrata) *
        smoothstep(6_200, 8_100, elevationM) *
        0.13,
    );
  const localSnowLine = 6_050 + broadStrata * 95;
  const snowAltitude = smoothstep(localSnowLine, 7_900, elevationM);
  const snowRetention = 1 - smoothstep(34, 57, slopeDegrees);
  const snowAmount = THREE.MathUtils.clamp(
    snowAltitude * (0.25 + snowRetention * 0.58),
    0,
    0.84,
  );
  const iceAmount =
    smoothstep(5_900, 7_250, elevationM) *
    (1 - smoothstep(48, 63, slopeDegrees)) *
    (1 - snowAmount) *
    0.68;
  const color = altitudeRock
    .lerp(MOUNTAIN_MATERIALS.blueIce, iceAmount)
    .lerp(MOUNTAIN_MATERIALS.snow, snowAmount);
  const mineralVariation =
    (hashNoise(x, z, 19) - 0.5) * 0.026 +
    broadStrata * 0.009;
  color.offsetHSL(
    mineralVariation * 0.08,
    mineralVariation * 0.1,
    mineralVariation,
  );
  return color.multiplyScalar(shade);
}
