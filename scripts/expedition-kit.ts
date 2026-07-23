import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDemTerrainOracle } from "../engine/terrain";
import {
  IDENTITY_QUATERNION,
  type CandidateCommit,
  type CanonicalWorld,
  type RouteSample,
  type TerrainMesh,
} from "../engine/types";
import { PROTOCOL_VERSION } from "../lib/protocol";

interface DemMetadata {
  width: number;
  height: number;
  sampleSpacingArcSeconds: number;
  sha256: string;
  bounds: {
    north: number;
    south: number;
    west: number;
    east: number;
  };
}

export interface TerrainConfig {
  terrainHash: string;
  metadataPath: string;
  elevationPath: string;
  registration: {
    originLatitude: number;
    originLongitude: number;
    verticalDatumM: number;
    originRow: number;
    originColumn: number;
  };
}

export interface DemBundle {
  metadata: DemMetadata;
  elevations: Int16Array;
  config: TerrainConfig;
  oracle: ReturnType<typeof createDemTerrainOracle>;
}

const METERS_PER_DEGREE_LATITUDE = 111_320;

export async function loadTerrainConfig(): Promise<TerrainConfig> {
  return JSON.parse(
    await readFile(resolve("world", "terrain.json"), "utf8"),
  ) as TerrainConfig;
}

export async function loadCanonicalWorld(): Promise<CanonicalWorld> {
  return JSON.parse(
    await readFile(resolve("world", "snapshot.json"), "utf8"),
  ) as CanonicalWorld;
}

export async function loadDemBundle(): Promise<DemBundle> {
  const config = await loadTerrainConfig();
  const [metadataText, bytes] = await Promise.all([
    readFile(resolve(config.metadataPath), "utf8"),
    readFile(resolve(config.elevationPath)),
  ]);
  const metadata = JSON.parse(metadataText) as DemMetadata;
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== config.terrainHash || hash !== metadata.sha256) {
    throw new Error("The terrain bytes do not match the canonical terrain hash.");
  }
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const elevations = new Int16Array(bytes.byteLength / 2);
  for (let index = 0; index < elevations.length; index += 1) {
    elevations[index] = view.getInt16(index * 2, true);
  }
  return {
    metadata,
    elevations,
    config,
    oracle: createDemTerrainOracle(metadata, elevations, config.registration),
  };
}

function horizontalCellSize(bundle: DemBundle) {
  const degrees = bundle.metadata.sampleSpacingArcSeconds / 3600;
  const latitudeRadians =
    (bundle.config.registration.originLatitude * Math.PI) / 180;
  return {
    x: degrees *
      METERS_PER_DEGREE_LATITUDE *
      Math.cos(latitudeRadians),
    z: degrees * METERS_PER_DEGREE_LATITUDE,
  };
}

function worldXZ(bundle: DemBundle, row: number, column: number) {
  const cell = horizontalCellSize(bundle);
  return {
    x: (column - bundle.config.registration.originColumn) * cell.x,
    z: (row - bundle.config.registration.originRow) * cell.z,
  };
}

function routeSampleAt(
  bundle: DemBundle,
  row: number,
  column: number,
  carrying: boolean,
): RouteSample {
  const position = worldXZ(bundle, row, column);
  const truth = bundle.oracle.sample(position.x, position.z);
  if (!truth) throw new Error(`DEM sample ${row}:${column} is outside terrain.`);
  const walkLimit = carrying ? 32 : 35;
  const scrambleLimit = carrying ? 48 : 55;
  const mode =
    truth.slopeDegrees <= walkLimit
      ? "WALK"
      : truth.slopeDegrees <= scrambleLimit
        ? "SCRAMBLE"
        : "CLIMB";
  return {
    x: position.x,
    y: truth.y,
    z: position.z,
    altitudeM: truth.altitudeM,
    slopeDegrees: truth.slopeDegrees,
    surface: truth.surface,
    mode,
    protected: mode === "CLIMB" ? true : undefined,
  };
}

class MinHeap {
  private values: Array<{ index: number; priority: number }> = [];

  get size() {
    return this.values.length;
  }

  push(value: { index: number; priority: number }) {
    this.values.push(value);
    let child = this.values.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.values[parent].priority <= value.priority) break;
      this.values[child] = this.values[parent];
      child = parent;
    }
    this.values[child] = value;
  }

  pop() {
    const root = this.values[0];
    const tail = this.values.pop();
    if (!tail || this.values.length === 0) return root;
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child =
        right < this.values.length &&
        this.values[right].priority < this.values[left].priority
          ? right
          : left;
      if (this.values[child].priority >= tail.priority) break;
      this.values[parent] = this.values[child];
      parent = child;
    }
    this.values[parent] = tail;
    return root;
  }
}

function localSlopeDegrees(
  bundle: DemBundle,
  row: number,
  column: number,
) {
  const { width, height } = bundle.metadata;
  if (row < 1 || column < 1 || row >= height - 1 || column >= width - 1) {
    return Number.POSITIVE_INFINITY;
  }
  const cell = horizontalCellSize(bundle);
  const index = row * width + column;
  const east =
    (bundle.elevations[index + 1] - bundle.elevations[index - 1]) /
    (cell.x * 2);
  const south =
    (bundle.elevations[index + width] -
      bundle.elevations[index - width]) /
    (cell.z * 2);
  return (Math.atan(Math.hypot(east, south)) * 180) / Math.PI;
}

function findPath(
  bundle: DemBundle,
  targetRow: number,
  targetColumn: number,
) {
  const { width, height } = bundle.metadata;
  const start =
    bundle.config.registration.originRow * width +
    bundle.config.registration.originColumn;
  const target = targetRow * width + targetColumn;
  const scores = new Float64Array(width * height);
  scores.fill(Number.POSITIVE_INFINITY);
  scores[start] = 0;
  const parents = new Int32Array(width * height);
  parents.fill(-1);
  const queue = new MinHeap();
  queue.push({ index: start, priority: 0 });
  const cell = horizontalCellSize(bundle);
  const directions = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ];

  while (queue.size > 0) {
    const current = queue.pop()!;
    if (current.index === target) break;
    const row = Math.floor(current.index / width);
    const column = current.index % width;
    const currentElevation = bundle.elevations[current.index];

    for (const [rowDelta, columnDelta] of directions) {
      const nextRow = row + rowDelta;
      const nextColumn = column + columnDelta;
      if (
        nextRow < 1 ||
        nextColumn < 1 ||
        nextRow >= height - 1 ||
        nextColumn >= width - 1 ||
        localSlopeDegrees(bundle, nextRow, nextColumn) > 82
      ) {
        continue;
      }
      const nextIndex = nextRow * width + nextColumn;
      const horizontalM = Math.hypot(
        columnDelta * cell.x,
        rowDelta * cell.z,
      );
      const riseM = bundle.elevations[nextIndex] - currentElevation;
      if (
        (Math.atan2(Math.abs(riseM), horizontalM) * 180) / Math.PI >
        82
      ) {
        continue;
      }
      const stepCost =
        horizontalM +
        Math.max(0, riseM) * 1.8 +
        Math.abs(riseM) * 0.15;
      const nextScore = scores[current.index] + stepCost;
      if (nextScore >= scores[nextIndex]) continue;
      scores[nextIndex] = nextScore;
      parents[nextIndex] = current.index;
      const targetDistance = Math.hypot(
        (targetColumn - nextColumn) * cell.x,
        (targetRow - nextRow) * cell.z,
      );
      queue.push({
        index: nextIndex,
        priority: nextScore + targetDistance,
      });
    }
  }

  if (parents[target] === -1) {
    throw new Error("No traversable path to the selected terrain cell.");
  }
  const path: number[] = [];
  for (let index = target; index !== -1; index = parents[index]) {
    path.push(index);
    if (index === start) break;
  }
  path.reverse();
  return path.map((index) => ({
    row: Math.floor(index / width),
    column: index % width,
  }));
}

function highestStableCandidates(bundle: DemBundle) {
  const candidates: Array<{
    row: number;
    column: number;
    altitudeM: number;
  }> = [];
  for (let row = 2; row < bundle.metadata.height - 2; row += 1) {
    for (let column = 2; column < bundle.metadata.width - 2; column += 1) {
      const index = row * bundle.metadata.width + column;
      if (localSlopeDegrees(bundle, row, column) <= 8) {
        candidates.push({
          row,
          column,
          altitudeM: bundle.elevations[index],
        });
      }
    }
  }
  return candidates.sort((a, b) => b.altitudeM - a.altitudeM);
}

function pathDistanceM(bundle: DemBundle, path: Array<{ row: number; column: number }>) {
  const cell = horizontalCellSize(bundle);
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += Math.hypot(
      (path[index].column - path[index - 1].column) * cell.x,
      (path[index].row - path[index - 1].row) * cell.z,
    );
  }
  return total;
}

export function planCandidate(
  bundle: DemBundle,
  world: CanonicalWorld,
  agentId: string,
  oneWay = false,
): CandidateCommit {
  let selectedPath: Array<{ row: number; column: number }> | null = null;
  for (const target of highestStableCandidates(bundle).slice(0, 80)) {
    try {
      const path = findPath(bundle, target.row, target.column);
      const distanceM = pathDistanceM(bundle, path);
      const oxygenUsed =
        (distanceM / 100) * (oneWay ? 2 : 3);
      if (oxygenUsed <= 400) {
        selectedPath = path;
        break;
      }
    } catch {
      // Try the next-highest stable target.
    }
  }
  if (!selectedPath) {
    throw new Error("No stable target can be reached with the oxygen budget.");
  }

  const ascent = selectedPath.map(({ row, column }) =>
    routeSampleAt(bundle, row, column, true),
  );
  const target = ascent.at(-1)!;
  const descent = oneWay
    ? []
    : selectedPath
        .slice(0, -1)
        .reverse()
        .map(({ row, column }) =>
          routeSampleAt(bundle, row, column, false),
        );
  const route = [...ascent, ...descent];
  route[route.length - 1] = {
    ...route[route.length - 1],
    safeStop: true,
  };
  const id = `expedition-${agentId}-${Date.now().toString(36)}`;

  return {
    protocol: PROTOCOL_VERSION,
    id,
    parentWorldHash: world.worldHash,
    terrainHash: world.terrainHash,
    agentId,
    proof: {
      route,
      mutation: {
        kind: "ADD",
        stoneId: `stone-${id}`,
        releasePose: {
          translation: {
            x: target.x,
            y: target.y + 0.11,
            z: target.z,
          },
          rotation: IDENTITY_QUATERNION,
        },
      },
      releaseIndex: ascent.length - 1,
    },
  };
}

export function terrainPatchForCandidate(
  bundle: DemBundle,
  candidate: CandidateCommit,
): TerrainMesh {
  const pose =
    candidate.proof.mutation.kind === "RECOVER"
      ? candidate.proof.route[candidate.proof.pickupIndex!]
      : candidate.proof.mutation.releasePose.translation;
  const cell = horizontalCellSize(bundle);
  const centerColumn = Math.round(
    pose.x / cell.x + bundle.config.registration.originColumn,
  );
  const centerRow = Math.round(
    pose.z / cell.z + bundle.config.registration.originRow,
  );
  const radius = 3;
  const side = radius * 2 + 1;
  const vertices = new Float32Array(side * side * 3);
  let vertex = 0;
  for (let row = centerRow - radius; row <= centerRow + radius; row += 1) {
    for (
      let column = centerColumn - radius;
      column <= centerColumn + radius;
      column += 1
    ) {
      const world = worldXZ(bundle, row, column);
      const elevation =
        bundle.elevations[row * bundle.metadata.width + column] -
        bundle.config.registration.verticalDatumM;
      vertices[vertex++] = world.x;
      vertices[vertex++] = elevation;
      vertices[vertex++] = world.z;
    }
  }
  const indices = new Uint32Array((side - 1) * (side - 1) * 6);
  let triangle = 0;
  for (let row = 0; row < side - 1; row += 1) {
    for (let column = 0; column < side - 1; column += 1) {
      const northWest = row * side + column;
      const northEast = northWest + 1;
      const southWest = northWest + side;
      const southEast = southWest + 1;
      indices[triangle++] = northWest;
      indices[triangle++] = southWest;
      indices[triangle++] = northEast;
      indices[triangle++] = northEast;
      indices[triangle++] = southWest;
      indices[triangle++] = southEast;
    }
  }
  return {
    kind: "trimesh",
    vertices,
    indices,
    friction: 0.78,
  };
}

export function worldForCandidate(
  world: CanonicalWorld,
  bundle: DemBundle,
  candidate: CandidateCommit,
): CanonicalWorld {
  return {
    ...world,
    terrain: [terrainPatchForCandidate(bundle, candidate)],
  };
}
