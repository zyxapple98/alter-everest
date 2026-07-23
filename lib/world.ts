export const EVEREST_ALTITUDE = 8848.86;
export const BASE_ALTITUDE = 5200;
export const SCENE_PEAK_HEIGHT = 43.5;

export type ActionMode = "ADD" | "MOVE" | "RECOVER";
export type TripMode = "ROUND_TRIP" | "ONE_WAY";

export interface BlockHistory {
  action: ActionMode;
  by: string;
  commit: string;
}

export interface WorldBlock {
  id: string;
  x: number;
  y: number;
  z: number;
  creator: string;
  trip: TripMode;
  commit: string;
  history: BlockHistory[];
}

export interface ExpeditionEvent {
  id: string;
  action: ActionMode;
  trip: TripMode;
  agent: string;
  altitude: number;
  commit: string;
  status: "VERIFIED";
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
    6.4 * gaussian(opposingRidge - 1, 44) * gaussian(Math.hypot(x, z), 1120);
  const erosion =
    Math.sin(x * 0.72 + z * 0.21) * 0.72 +
    Math.sin(z * 0.58 - x * 0.17) * 0.55 +
    Math.sin((x + z) * 1.31) * 0.18;
  const southFace = z > 0 ? -z * 0.025 : 0;

  return Math.max(0.4, massif + summit + westRidge + northRidge + erosion + southFace);
}

export function sceneToAltitude(y: number) {
  const metresPerSceneUnit =
    (EVEREST_ALTITUDE - BASE_ALTITUDE) / SCENE_PEAK_HEIGHT;
  return Math.round(BASE_ALTITUDE + y * metresPerSceneUnit);
}

function seededUnit(seed: number) {
  const value = Math.sin(seed * 91.345 + 17.13) * 47453.5453;
  return value - Math.floor(value);
}

function shortHash(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}

export function makeInitialBlocks(): WorldBlock[] {
  const blocks: WorldBlock[] = [];

  for (let index = 0; index < 58; index += 1) {
    const angle = seededUnit(index + 3) * Math.PI * 2;
    const radius = 1.4 + seededUnit(index + 91) * 13;
    const x = Math.cos(angle) * radius * 0.72;
    const z = Math.sin(angle) * radius;
    const stack = index > 50 ? (index - 49) * 0.64 : seededUnit(index + 7) * 0.45;
    const y = terrainHeight(x, z) + 0.72 + stack;
    const commit = shortHash(`expedition-${index}-${x.toFixed(2)}-${z.toFixed(2)}`);
    const agent = `agent-${String(1240 + index * 19).padStart(4, "0")}`;
    const action: ActionMode = index % 9 === 0 ? "MOVE" : "ADD";

    blocks.push({
      id: `stone-${String(18401 + index).padStart(8, "0")}`,
      x,
      y,
      z,
      creator: agent,
      trip: index > 49 ? "ONE_WAY" : "ROUND_TRIP",
      commit,
      history: [{ action, by: agent, commit }],
    });
  }

  return blocks;
}

export function hashWorld(blocks: WorldBlock[]) {
  const state = [...blocks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((block) => `${block.id}:${block.x.toFixed(2)}:${block.y.toFixed(2)}:${block.z.toFixed(2)}`)
    .join("|");
  return shortHash(state);
}

export function highestBlock(blocks: WorldBlock[]) {
  return blocks.reduce((highest, block) => (block.y > highest.y ? block : highest));
}

export function initialEvents(blocks: WorldBlock[]): ExpeditionEvent[] {
  return [...blocks]
    .sort((a, b) => b.y - a.y)
    .slice(0, 4)
    .map((block, index) => ({
      id: `EV-${6321 - index}`,
      action: block.history.at(-1)?.action ?? "ADD",
      trip: block.trip,
      agent: block.creator,
      altitude: sceneToAltitude(block.y),
      commit: block.commit,
      status: "VERIFIED",
    }));
}

