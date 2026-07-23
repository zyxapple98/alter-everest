export const EVEREST_ALTITUDE_M = 8848.86;
export const BASE_ALTITUDE_M = 5200;
export const SCENE_PEAK_HEIGHT = 43.5;

export interface ObservatoryStone {
  id: string;
  x: number;
  y: number;
  z: number;
  commit: string;
}

export interface ObservatoryExpedition {
  id: string;
  agent: string;
  action: "ADDED" | "MOVED" | "RECOVERED";
  altitudeM: number;
  commit: string;
  color: string;
  target: { x: number; y: number; z: number };
  returned: boolean;
}

function gaussian(value: number, width: number) {
  return Math.exp(-(value * value) / width);
}

export function terrainHeight(x: number, z: number) {
  const rotatedRidge = x * 0.72 + z * 0.69;
  const opposingRidge = x * 0.76 - z * 0.65;
  const massif = 25 * gaussian(Math.hypot(x * 0.82, z), 1350);
  const summit = 22.8 * gaussian(Math.hypot(x * 1.08, z * 1.03), 120);
  const westRidge =
    9.2 * gaussian(rotatedRidge + 2, 32) * gaussian(Math.hypot(x, z), 950);
  const northRidge =
    6.4 * gaussian(opposingRidge - 1, 44) *
    gaussian(Math.hypot(x, z), 1120);
  const erosion =
    Math.sin(x * 0.72 + z * 0.21) * 0.72 +
    Math.sin(z * 0.58 - x * 0.17) * 0.55 +
    Math.sin((x + z) * 1.31) * 0.18;
  const southFace = z > 0 ? -z * 0.025 : 0;

  return Math.max(
    0.4,
    massif + summit + westRidge + northRidge + erosion + southFace,
  );
}

export function sceneToAltitude(y: number) {
  const metresPerSceneUnit =
    (EVEREST_ALTITUDE_M - BASE_ALTITUDE_M) / SCENE_PEAK_HEIGHT;
  return Math.round(BASE_ALTITUDE_M + y * metresPerSceneUnit);
}

export function observatoryStones(): ObservatoryStone[] {
  const positions = [
    [-0.9, -0.2],
    [-0.48, 0.18],
    [-0.12, -0.42],
    [0.2, 0.12],
    [0.5, -0.08],
    [0.82, 0.28],
    [1.1, -0.3],
    [-1.2, 0.36],
    [-0.25, 0.62],
    [0.35, 0.7],
    [0.72, 0.84],
    [-0.7, 0.93],
  ] as const;

  return positions.map(([x, z], index) => ({
    id: `stone-${String(6310 + index).padStart(6, "0")}`,
    x,
    y: terrainHeight(x, z) + 0.19,
    z,
    commit: ["8f2c91a", "a4106be", "c91ff30"][index % 3],
  }));
}

export function recentExpeditions(): ObservatoryExpedition[] {
  const targets = [
    { x: 0.72, z: 0.84 },
    { x: -0.7, z: 0.93 },
    { x: 0.35, z: 0.7 },
  ];
  const records = [
    {
      id: "EX-006318",
      agent: "northstar-17",
      action: "ADDED" as const,
      commit: "8f2c91a",
      color: "#ff7a3d",
      returned: false,
    },
    {
      id: "EX-006317",
      agent: "sherpa-03",
      action: "MOVED" as const,
      commit: "a4106be",
      color: "#d8e6e7",
      returned: true,
    },
    {
      id: "EX-006316",
      agent: "contour-9",
      action: "RECOVERED" as const,
      commit: "c91ff30",
      color: "#8dc9cf",
      returned: true,
    },
  ];

  return records.map((record, index) => {
    const target = targets[index];
    const y = terrainHeight(target.x, target.z) + 0.5;
    return {
      ...record,
      altitudeM: sceneToAltitude(y),
      target: { x: target.x, y, z: target.z },
    };
  });
}

