import { CLIMBER, TERRAIN } from "./constants";
import { voxelCenter, voxelKey } from "./mutation";
import { baseTopVoxel, isSolidTerrainVoxel } from "./surface";
import type { TerrainOracle } from "./terrain";
import type {
  LocomotionMode,
  MicroMovement,
  PhysicsSnapshot,
  RouteSample,
  RouteStance,
  StoneState,
  Vec3,
  VoxelCoordinate,
} from "./types";

export interface MovementWorldView {
  world: PhysicsSnapshot;
  terrain: TerrainOracle;
  stonesByCell: ReadonlyMap<string, StoneState>;
  stoneBucketsByX: ReadonlyMap<number, ReadonlySet<number>>;
  removed: ReadonlySet<string>;
}

export type MovementFailureCode =
  | "OUTSIDE_TERRAIN"
  | "ROUTE_UNSUPPORTED"
  | "ROUTE_OBSTRUCTED"
  | "VERTICAL_STEP_EXCEEDED"
  | "SLOPE_EXCEEDED";

export interface StanceVerdict {
  valid: boolean;
  code: "STANCE_VALID" | MovementFailureCode;
  sample: RouteSample | null;
  supportCell: VoxelCoordinate | null;
  supportStone: StoneState | null;
  obstacle: string | null;
}

export interface MovementVerdict {
  valid: boolean;
  code: "MOVEMENT_VALID" | MovementFailureCode;
  obstacle: string | null;
  mode: LocomotionMode;
  slopeDegrees: number;
  effectiveSlopeDegrees: number;
  geometricSlopeDegrees: number;
  stepHeightM: number;
  effectiveSpeedMps: number;
  walkStep: boolean;
}

export function createMovementWorldView(
  world: PhysicsSnapshot,
  terrain: TerrainOracle,
): MovementWorldView {
  const stoneBucketsByX = new Map<number, Set<number>>();
  for (const stone of world.stones) {
    const bucketX = Math.floor(
      stone.cell.x / STONE_CLEARANCE_BUCKET_EDGE_CELLS,
    );
    const bucketZ = Math.floor(
      stone.cell.z / STONE_CLEARANCE_BUCKET_EDGE_CELLS,
    );
    const zBuckets = stoneBucketsByX.get(bucketX) ?? new Set<number>();
    zBuckets.add(bucketZ);
    stoneBucketsByX.set(bucketX, zBuckets);
  }
  return {
    world,
    terrain,
    stonesByCell: new Map(
      world.stones.map((stone) => [voxelKey(stone.cell), stone]),
    ),
    stoneBucketsByX,
    removed: new Set(world.removedTerrainVoxels.map(voxelKey)),
  };
}

export function stancePoint(cell: VoxelCoordinate): Vec3 {
  return {
    x: (cell.x + 0.5) * TERRAIN.voxelEdgeM,
    y: cell.y * TERRAIN.voxelEdgeM,
    z: (cell.z + 0.5) * TERRAIN.voxelEdgeM,
  };
}

export function stanceSupportCell(cell: VoxelCoordinate): VoxelCoordinate {
  return { x: cell.x, y: cell.y - 1, z: cell.z };
}

export function solidAt(view: MovementWorldView, cell: VoxelCoordinate) {
  return (
    view.stonesByCell.has(voxelKey(cell)) ||
    isSolidTerrainVoxel(view.terrain, view.removed, cell)
  );
}

function stoneAt(view: MovementWorldView, cell: VoxelCoordinate) {
  return view.stonesByCell.get(voxelKey(cell)) ?? null;
}

const STONE_CLEARANCE_BUCKET_EDGE_CELLS = 32;

function nearbyBodyCellBounds(point: Vec3) {
  const edge = TERRAIN.voxelEdgeM;
  return {
    minimumX: Math.floor((point.x - CLIMBER.clearanceRadiusM) / edge),
    maximumX: Math.floor((point.x + CLIMBER.clearanceRadiusM) / edge),
    minimumZ: Math.floor((point.z - CLIMBER.clearanceRadiusM) / edge),
    maximumZ: Math.floor((point.z + CLIMBER.clearanceRadiusM) / edge),
    minimumY: Math.floor((point.y + 1e-7) / edge),
    maximumY: Math.floor(
      (point.y + CLIMBER.clearanceHeightM - 1e-7) / edge,
    ),
  };
}

function stoneBucketMayOverlap(
  view: MovementWorldView,
  bounds: ReturnType<typeof nearbyBodyCellBounds>,
) {
  const minimumBucketX = Math.floor(
    bounds.minimumX / STONE_CLEARANCE_BUCKET_EDGE_CELLS,
  );
  const maximumBucketX = Math.floor(
    bounds.maximumX / STONE_CLEARANCE_BUCKET_EDGE_CELLS,
  );
  const minimumBucketZ = Math.floor(
    bounds.minimumZ / STONE_CLEARANCE_BUCKET_EDGE_CELLS,
  );
  const maximumBucketZ = Math.floor(
    bounds.maximumZ / STONE_CLEARANCE_BUCKET_EDGE_CELLS,
  );
  for (
    let bucketX = minimumBucketX;
    bucketX <= maximumBucketX;
    bucketX += 1
  ) {
    const zBuckets = view.stoneBucketsByX.get(bucketX);
    if (!zBuckets) continue;
    for (
      let bucketZ = minimumBucketZ;
      bucketZ <= maximumBucketZ;
      bucketZ += 1
    ) {
      if (zBuckets.has(bucketZ)) return true;
    }
  }
  return false;
}

function nearbyBodyCells(
  point: Vec3,
  bounds = nearbyBodyCellBounds(point),
) {
  const edge = TERRAIN.voxelEdgeM;
  const result: VoxelCoordinate[] = [];
  for (let x = bounds.minimumX; x <= bounds.maximumX; x += 1) {
    for (let z = bounds.minimumZ; z <= bounds.maximumZ; z += 1) {
      const centerX = (x + 0.5) * edge;
      const centerZ = (z + 0.5) * edge;
      const closestX = Math.max(
        x * edge,
        Math.min(point.x, (x + 1) * edge),
      );
      const closestZ = Math.max(
        z * edge,
        Math.min(point.z, (z + 1) * edge),
      );
      if (
        Math.hypot(point.x - closestX, point.z - closestZ) >
        CLIMBER.clearanceRadiusM + 1e-9
      ) {
        continue;
      }
      // Keep the cell centre calculation explicit for deterministic bounds.
      void centerX;
      void centerZ;
      for (let y = bounds.minimumY; y <= bounds.maximumY; y += 1) {
        result.push({ x, y, z });
      }
    }
  }
  return result;
}

function pointClearance(
  view: MovementWorldView,
  point: Vec3,
  checkTerrain: boolean,
) {
  const bounds = nearbyBodyCellBounds(point);
  const checkStones = stoneBucketMayOverlap(view, bounds);
  if (!checkStones && !checkTerrain) {
    return { clear: true, obstacle: null };
  }
  for (const cell of nearbyBodyCells(point, bounds)) {
    if (checkStones) {
      const stone = stoneAt(view, cell);
      const stoneTopM = (cell.y + 1) * TERRAIN.voxelEdgeM;
      const walkableLowContact =
        stoneTopM <= point.y + CLIMBER.maxWalkStepM + 1e-9;
      if (stone && !walkableLowContact) {
        return { clear: false, obstacle: stone.id };
      }
    }
    if (
      checkTerrain &&
      isSolidTerrainVoxel(view.terrain, view.removed, cell)
    ) {
      return { clear: false, obstacle: `terrain:${voxelKey(cell)}` };
    }
  }
  return { clear: true, obstacle: null };
}

function stanceInsideExcavation(
  view: MovementWorldView,
  stance: RouteStance,
) {
  const nativeTop = baseTopVoxel(
    view.terrain,
    stance.cell.x,
    stance.cell.z,
  );
  return nativeTop !== null && stance.cell.y <= nativeTop;
}

export function validateStance(
  view: MovementWorldView,
  stance: RouteStance,
): StanceVerdict {
  const point = stancePoint(stance.cell);
  const truth = view.terrain.sample(point.x, point.z);
  if (!truth) {
    return {
      valid: false,
      code: "OUTSIDE_TERRAIN",
      sample: null,
      supportCell: null,
      supportStone: null,
      obstacle: null,
    };
  }
  const supportCell = stanceSupportCell(stance.cell);
  if (!solidAt(view, supportCell) || solidAt(view, stance.cell)) {
    return {
      valid: false,
      code: solidAt(view, stance.cell)
        ? "ROUTE_OBSTRUCTED"
        : "ROUTE_UNSUPPORTED",
      sample: null,
      supportCell,
      supportStone: stoneAt(view, supportCell),
      obstacle: solidAt(view, stance.cell)
        ? stoneAt(view, stance.cell)?.id ??
          `terrain:${voxelKey(stance.cell)}`
        : null,
    };
  }

  const clearance = pointClearance(
    view,
    point,
    stanceInsideExcavation(view, stance),
  );
  if (!clearance.clear) {
    return {
      valid: false,
      code: "ROUTE_OBSTRUCTED",
      sample: null,
      supportCell,
      supportStone: stoneAt(view, supportCell),
      obstacle: clearance.obstacle,
    };
  }

  const altitudeM = truth.altitudeM + (point.y - truth.y);
  const supportStone = stoneAt(view, supportCell);
  const sample: RouteSample = {
    step: stance.step,
    cell: { ...stance.cell },
    ...point,
    altitudeM,
    slopeDegrees: supportStone ? 0 : truth.slopeDegrees,
    surface: supportStone ? "ROCK" : truth.surface,
    supportKind: supportStone ? "STONE" : "NATURAL",
  };
  return {
    valid: true,
    code: "STANCE_VALID",
    sample,
    supportCell,
    supportStone,
    obstacle: null,
  };
}

export function movementSpeedMps(
  mode: LocomotionMode,
  stepHeightM: number,
) {
  if (
    mode === "WALK" &&
    stepHeightM > 0 &&
    stepHeightM <= CLIMBER.maxWalkStepM + 1e-9
  ) {
    return CLIMBER.walkStepSpeedMps;
  }
  if (mode === "WALK") return CLIMBER.walkSpeedMps;
  if (mode === "SCRAMBLE") return CLIMBER.scrambleSpeedMps;
  return CLIMBER.climbSpeedMps;
}

function modeRank(mode: LocomotionMode) {
  if (mode === "WALK") return 0;
  if (mode === "SCRAMBLE") return 1;
  return 2;
}

function modeAtRank(rank: number): LocomotionMode {
  if (rank <= 0) return "WALK";
  if (rank === 1) return "SCRAMBLE";
  return "CLIMB";
}

function stepMode(stepHeightM: number): LocomotionMode | null {
  if (stepHeightM <= CLIMBER.maxWalkStepM + 1e-9) return "WALK";
  if (stepHeightM <= CLIMBER.maxScrambleStepM + 1e-9) {
    return "SCRAMBLE";
  }
  if (stepHeightM <= CLIMBER.maxClimbStepM + 1e-9) {
    return "CLIMB";
  }
  return null;
}

function surfacePenalty(sample: RouteSample) {
  return CLIMBER.surfaceSlopePenaltyDegrees[sample.surface];
}

export function effectiveSupportSlopeDegrees(
  from: RouteSample,
  to: RouteSample,
  carrying: boolean,
) {
  return (
    Math.max(
      from.slopeDegrees + surfacePenalty(from),
      to.slopeDegrees + surfacePenalty(to),
    ) + (carrying ? CLIMBER.carriedLoadSlopePenaltyDegrees : 0)
  );
}

function slopeMode(effectiveSlopeDegrees: number): LocomotionMode | null {
  if (effectiveSlopeDegrees <= CLIMBER.maxWalkSlopeDegrees + 1e-9) {
    return "WALK";
  }
  if (
    effectiveSlopeDegrees <=
    CLIMBER.maxScrambleSlopeDegrees + 1e-9
  ) {
    return "SCRAMBLE";
  }
  if (effectiveSlopeDegrees <= CLIMBER.maxClimbSlopeDegrees + 1e-9) {
    return "CLIMB";
  }
  return null;
}

export function walkSafeSupport(sample: RouteSample) {
  return (
    sample.slopeDegrees + surfacePenalty(sample) <=
    CLIMBER.maxWalkSlopeDegrees + 1e-9
  );
}

export function validateMovement(
  view: MovementWorldView,
  from: RouteSample,
  to: RouteSample,
  movement: MicroMovement,
  carrying: boolean,
): MovementVerdict {
  const edge = TERRAIN.voxelEdgeM;
  const horizontalM =
    Math.hypot(movement.dx, movement.dz) * edge;
  const verticalM = movement.dy * edge;
  const stepHeightM = Math.abs(verticalM);
  const geometricSlopeDegrees =
    (Math.atan2(Math.abs(verticalM), horizontalM) * 180) / Math.PI;
  const slopeDegrees = Math.max(from.slopeDegrees, to.slopeDegrees);
  const effectiveSlopeDegrees = effectiveSupportSlopeDegrees(
    from,
    to,
    carrying,
  );
  const byStep = stepMode(stepHeightM);
  const bySlope = slopeMode(effectiveSlopeDegrees);
  const mode =
    byStep && bySlope
      ? modeAtRank(Math.max(modeRank(byStep), modeRank(bySlope)))
      : "CLIMB";
  const walkStep =
    mode === "WALK" &&
    movement.dy !== 0 &&
    stepHeightM <= CLIMBER.maxWalkStepM + 1e-9;
  const diagnostics = {
    mode,
    slopeDegrees,
    effectiveSlopeDegrees,
    geometricSlopeDegrees,
    stepHeightM,
    effectiveSpeedMps: movementSpeedMps(mode, stepHeightM),
    walkStep,
  };
  if (!byStep) {
    return {
      valid: false,
      code: "VERTICAL_STEP_EXCEEDED",
      obstacle: null,
      ...diagnostics,
    };
  }
  if (!bySlope) {
    return {
      valid: false,
      code: "SLOPE_EXCEEDED",
      obstacle: null,
      ...diagnostics,
    };
  }
  const fromPoint = stancePoint(from.cell);
  const toPoint = stancePoint(to.cell);
  const distanceM = Math.hypot(
    toPoint.x - fromPoint.x,
    toPoint.y - fromPoint.y,
    toPoint.z - fromPoint.z,
  );
  const subdivisions = Math.max(
    1,
    Math.ceil(distanceM / (edge * 0.5)),
  );
  const checkTerrain =
    stanceInsideExcavation(view, from) ||
    stanceInsideExcavation(view, to);
  for (let part = 1; part < subdivisions; part += 1) {
    const fraction = part / subdivisions;
    const point = {
      x: fromPoint.x + (toPoint.x - fromPoint.x) * fraction,
      y: fromPoint.y + (toPoint.y - fromPoint.y) * fraction,
      z: fromPoint.z + (toPoint.z - fromPoint.z) * fraction,
    };
    const clearance = pointClearance(view, point, checkTerrain);
    if (!clearance.clear) {
      return {
        valid: false,
        code: "ROUTE_OBSTRUCTED",
        obstacle: clearance.obstacle,
        ...diagnostics,
      };
    }
  }
  return {
    valid: true,
    code: "MOVEMENT_VALID",
    obstacle: null,
    ...diagnostics,
  };
}

export function stoneTopPoint(stone: StoneState) {
  const center = voxelCenter(stone.cell);
  return { ...center, y: center.y + TERRAIN.voxelEdgeM / 2 };
}
