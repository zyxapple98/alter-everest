import { PHYSICS, TERRAIN } from "./constants";
import {
  mutationDestinationCell,
  parseVoxelKey,
  voxelCenter,
  voxelKey,
} from "./mutation";
import {
  FACE_NEIGHBOURS,
  addVoxel,
  isExposedTerrainVoxel,
  isSolidTerrainVoxel,
} from "./surface";
import type { TerrainOracle } from "./terrain";
import type {
  MatterMutation,
  PhysicsFailureCode,
  PhysicsSnapshot,
  PhysicsVerdict,
  StoneState,
  VoxelCoordinate,
} from "./types";

export interface StaticServiceLoad {
  supportCell: VoxelCoordinate;
  stoneWeightEquivalent: number;
}

export interface StaticPhysicsContext {
  terrain: TerrainOracle;
  serviceLoads?: readonly StaticServiceLoad[];
}

interface Point2 {
  x: number;
  z: number;
}

const stableVerdict = (
  stones: StoneState[],
  affectedStoneIds: string[],
  evaluatedStoneCells: number,
  cavityCellsChecked: number,
): PhysicsVerdict => ({
  valid: true,
  code: "STABLE",
  finalStones: stones,
  affectedStoneIds,
  evaluatedStoneCells,
  cavityCellsChecked,
  contactModel: "VOXEL_STATIC_V2_1",
});

const rejectedVerdict = (
  snapshot: PhysicsSnapshot,
  code: PhysicsFailureCode,
): PhysicsVerdict => ({
  valid: false,
  code,
  finalStones: snapshot.stones,
  affectedStoneIds: [],
  evaluatedStoneCells: 0,
  cavityCellsChecked: 0,
  contactModel: "VOXEL_STATIC_V2_1",
});

function cellIndex(stones: readonly StoneState[]) {
  const index = new Map<string, StoneState>();
  for (const stone of stones) {
    const key = voxelKey(stone.cell);
    if (index.has(key)) throw new Error(`Duplicate stone cell ${key}.`);
    index.set(key, stone);
  }
  return index;
}

function compareCells(left: VoxelCoordinate, right: VoxelCoordinate) {
  return (
    left.x - right.x ||
    left.y - right.y ||
    left.z - right.z
  );
}

function componentFrom(
  first: string,
  stones: ReadonlyMap<string, StoneState>,
  visited: Set<string>,
) {
  const component: string[] = [];
  const frontier = [first];
  visited.add(first);
  for (let index = 0; index < frontier.length; index += 1) {
    const key = frontier[index];
    component.push(key);
    const cell = stones.get(key)!.cell;
    for (const offset of FACE_NEIGHBOURS) {
      const neighbourKey = voxelKey(addVoxel(cell, offset));
      if (!stones.has(neighbourKey) || visited.has(neighbourKey)) continue;
      visited.add(neighbourKey);
      frontier.push(neighbourKey);
    }
  }
  return component;
}

function supportDistances(
  component: readonly string[],
  anchors: readonly string[],
) {
  const componentSet = new Set(component);
  const distance = new Map<string, number>();
  const capacity = Math.max(64, component.length * 12);
  const deque = new Array<string>(capacity);
  let head = Math.floor(capacity / 2);
  let tail = head;
  for (const anchor of anchors) {
    if (distance.has(anchor)) continue;
    distance.set(anchor, 0);
    deque[tail++] = anchor;
  }
  while (head < tail) {
    const key = deque[head++];
    const cell = parseVoxelKey(key);
    const current = distance.get(key)!;
    for (const offset of FACE_NEIGHBOURS) {
      const neighbour = addVoxel(cell, offset);
      const neighbourKey = voxelKey(neighbour);
      if (!componentSet.has(neighbourKey)) continue;
      const horizontal = neighbour.y === cell.y ? 1 : 0;
      const candidate = current + horizontal;
      if (candidate >= (distance.get(neighbourKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }
      distance.set(neighbourKey, candidate);
      if (horizontal === 0) deque[--head] = neighbourKey;
      else deque[tail++] = neighbourKey;
    }
  }
  return distance;
}

function contiguousVerticalThickness(component: readonly string[]) {
  const componentSet = new Set(component);
  const thickness = new Map<string, number>();
  for (const key of component) {
    if (thickness.has(key)) continue;
    const cell = parseVoxelKey(key);
    let bottom = cell.y;
    while (
      componentSet.has(voxelKey({ x: cell.x, y: bottom - 1, z: cell.z }))
    ) {
      bottom -= 1;
    }
    const run: string[] = [];
    for (let y = bottom; ; y += 1) {
      const runKey = voxelKey({ x: cell.x, y, z: cell.z });
      if (!componentSet.has(runKey)) break;
      run.push(runKey);
    }
    for (const runKey of run) thickness.set(runKey, run.length);
  }
  return thickness;
}

function cross(origin: Point2, a: Point2, b: Point2) {
  return (
    (a.x - origin.x) * (b.z - origin.z) -
    (a.z - origin.z) * (b.x - origin.x)
  );
}

function convexHull(points: readonly Point2[]) {
  const unique = new Map(points.map((point) => [`${point.x}:${point.z}`, point]));
  const sorted = [...unique.values()].sort(
    (a, b) => a.x - b.x || a.z - b.z,
  );
  if (sorted.length <= 1) return sorted;
  const lower: Point2[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower.at(-2)!, lower.at(-1)!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Point2[] = [];
  for (const point of [...sorted].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper.at(-2)!, upper.at(-1)!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function anchorFootprintHull(anchors: readonly VoxelCoordinate[]) {
  const corners = anchors.flatMap((cell) => [
    { x: cell.x, z: cell.z },
    { x: cell.x + 1, z: cell.z },
    { x: cell.x + 1, z: cell.z + 1 },
    { x: cell.x, z: cell.z + 1 },
  ]);
  return convexHull(corners);
}

function pointInsideAnchorHull(
  point: Point2,
  hull: readonly Point2[],
) {
  if (hull.length < 3) return false;
  for (let index = 0; index < hull.length; index += 1) {
    const from = hull[index];
    const to = hull[(index + 1) % hull.length];
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length === 0) continue;
    const signed =
      ((to.x - from.x) * (point.z - from.z) -
        (to.z - from.z) * (point.x - from.x)) /
      length;
    if (signed < PHYSICS.balanceMarginCells - 1e-9) return false;
  }
  return true;
}

function chunksTouched(cells: readonly VoxelCoordinate[]) {
  const cellsPerChunk = TERRAIN.physicsChunkEdgeM / TERRAIN.voxelEdgeM;
  return new Set(
    cells.map(
      (cell) =>
        `${Math.floor(cell.x / cellsPerChunk)}:${Math.floor(cell.z / cellsPerChunk)}`,
    ),
  ).size;
}

function validateComponents(
  stones: ReadonlyMap<string, StoneState>,
  seeds: readonly VoxelCoordinate[],
  removed: ReadonlySet<string>,
  context: StaticPhysicsContext,
  alternativeLoadCases?: readonly (readonly StaticServiceLoad[])[],
) {
  const visited = new Set<string>();
  const componentKeys: string[][] = [];
  for (const seed of seeds) {
    const key = voxelKey(seed);
    if (!stones.has(key) || visited.has(key)) continue;
    componentKeys.push(componentFrom(key, stones, visited));
  }
  const affectedKeys = componentKeys.flat();
  const boundedGroups = alternativeLoadCases
    ? componentKeys
    : [affectedKeys];
  for (const group of boundedGroups) {
    if (group.length > PHYSICS.maximumAffectedStoneCells) {
      return {
        code: "AFFECTED_STONES_TOO_LARGE" as const,
        affectedKeys,
      };
    }
    const groupCells = group.map(parseVoxelKey);
    if (
      new Set(groupCells.map((cell) => cell.y)).size >
      PHYSICS.maximumDistinctStoneLevels
    ) {
      return {
        code: "STRUCTURE_TOO_TALL_FOR_FULL_RECHECK" as const,
        affectedKeys,
      };
    }
    if (chunksTouched(groupCells) > PHYSICS.maximumTouchedPhysicsChunks) {
      return {
        code: "TOO_MANY_CHUNKS_TOUCHED" as const,
        affectedKeys,
      };
    }
  }

  for (const component of componentKeys) {
    const componentSet = new Set(component);
    const cells = component.map(parseVoxelKey);
    const anchors = component.filter((key) => {
      const cell = parseVoxelKey(key);
      return isSolidTerrainVoxel(
        context.terrain,
        removed,
        { x: cell.x, y: cell.y - 1, z: cell.z },
      );
    });
    if (anchors.length === 0) {
      return { code: "STONE_UNANCHORED" as const, affectedKeys };
    }
    const distance = supportDistances(component, anchors);
    const thickness = contiguousVerticalThickness(component);
    for (const key of component) {
      const localThickness = thickness.get(key) ?? 1;
      const limit = Math.min(
        PHYSICS.maximumHorizontalReachCells,
        PHYSICS.baseHorizontalReachCells +
          Math.floor(Math.log2(localThickness)) *
            PHYSICS.thicknessReachBonusPerDoublingCells,
      );
      if ((distance.get(key) ?? Number.POSITIVE_INFINITY) > limit) {
        return { code: "STONE_SPAN_EXCEEDED" as const, affectedKeys };
      }
    }

    const anchorCells = anchors.map(parseVoxelKey);
    const anchorHull = anchorFootprintHull(anchorCells);
    const minimumX = Math.min(...anchorCells.map((cell) => cell.x));
    const maximumX = Math.max(...anchorCells.map((cell) => cell.x));
    const minimumY = Math.min(...anchorCells.map((cell) => cell.y));
    const minimumZ = Math.min(...anchorCells.map((cell) => cell.z));
    const maximumZ = Math.max(...anchorCells.map((cell) => cell.z));
    const maximumY = Math.max(...cells.map((cell) => cell.y));
    const widthX = maximumX - minimumX + 1;
    const widthZ = maximumZ - minimumZ + 1;
    if (
      maximumY - minimumY + 1 >
      Math.min(widthX, widthZ) * PHYSICS.maximumSlendernessRatio
    ) {
      return {
        code: "STONE_LATERAL_OVERTURNING" as const,
        affectedKeys,
      };
    }

    const rawCases =
      alternativeLoadCases ??
      (context.serviceLoads ? [context.serviceLoads] : []);
    const relevantCases = rawCases
      .map((loadCase) =>
        loadCase.filter((load) =>
          componentSet.has(voxelKey(load.supportCell)),
        ),
      )
      .filter((loadCase) => loadCase.length > 0);
    const loadCases = [[], ...relevantCases] as readonly (
      readonly StaticServiceLoad[]
    )[];
    const stoneMomentX = cells.reduce(
      (total, cell) => total + cell.x + 0.5,
      0,
    );
    const stoneMomentZ = cells.reduce(
      (total, cell) => total + cell.z + 0.5,
      0,
    );
    for (const componentLoads of loadCases) {
      const serviceWeight = componentLoads.reduce(
        (total, load) => total + load.stoneWeightEquivalent,
        0,
      );
      const totalWeight = component.length + serviceWeight;
      const centre = {
        x:
          (stoneMomentX +
            componentLoads.reduce(
              (total, load) =>
                total +
                (load.supportCell.x + 0.5) *
                  load.stoneWeightEquivalent,
              0,
            )) /
          totalWeight,
        z:
          (stoneMomentZ +
            componentLoads.reduce(
              (total, load) =>
                total +
                (load.supportCell.z + 0.5) *
                  load.stoneWeightEquivalent,
              0,
            )) /
          totalWeight,
      };
      if (!pointInsideAnchorHull(centre, anchorHull)) {
        return { code: "STONE_IMBALANCED" as const, affectedKeys };
      }
      if (
        totalWeight / anchors.length >
        PHYSICS.maximumLoadPerAnchorCell
      ) {
        return {
          code: "STONE_COMPRESSION_EXCEEDED" as const,
          affectedKeys,
        };
      }
    }
  }
  return { code: null, affectedKeys };
}

function isSolid(
  cell: VoxelCoordinate,
  stones: ReadonlyMap<string, StoneState>,
  removed: ReadonlySet<string>,
  terrain: TerrainOracle,
) {
  return (
    stones.has(voxelKey(cell)) ||
    isSolidTerrainVoxel(terrain, removed, cell)
  );
}

function relevantCavityCells(
  removed: ReadonlySet<string>,
  changed: readonly VoxelCoordinate[],
) {
  if (changed.length === 0) return [];
  const result: VoxelCoordinate[] = [];
  for (const key of removed) {
    const cell = parseVoxelKey(key);
    if (
      changed.some(
        (origin) =>
          Math.abs(cell.x - origin.x) <=
            PHYSICS.maximumTunnelRadiusCells + 1 &&
          Math.abs(cell.z - origin.z) <=
            PHYSICS.maximumTunnelRadiusCells + 1 &&
          Math.abs(cell.y - origin.y) <=
            PHYSICS.minimumTunnelRoofCells + 1,
      )
    ) {
      result.push(cell);
    }
  }
  return result.sort(compareCells);
}

function validateCavities(
  stones: ReadonlyMap<string, StoneState>,
  removed: ReadonlySet<string>,
  changed: readonly VoxelCoordinate[],
  terrain: TerrainOracle,
) {
  const cells = relevantCavityCells(removed, changed);
  if (cells.length > PHYSICS.maximumCavityWindowCells) {
    return {
      code: "CAVITY_WINDOW_TOO_LARGE" as const,
      checked: cells.length,
    };
  }
  for (const cell of cells) {
    const above = { x: cell.x, y: cell.y + 1, z: cell.z };
    if (!isSolid(above, stones, removed, terrain)) continue;
    let roofThickness = 0;
    let cursor = above;
    while (
      roofThickness <= PHYSICS.minimumTunnelRoofCells &&
      isSolid(cursor, stones, removed, terrain)
    ) {
      roofThickness += 1;
      cursor = { x: cursor.x, y: cursor.y + 1, z: cursor.z };
    }
    if (roofThickness < PHYSICS.minimumTunnelRoofCells) {
      return {
        code: "TUNNEL_ROOF_TOO_THIN" as const,
        checked: cells.length,
      };
    }
    let nearest = Number.POSITIVE_INFINITY;
    for (
      let distance = 1;
      distance <= PHYSICS.maximumTunnelRadiusCells + 1;
      distance += 1
    ) {
      for (let dx = -distance; dx <= distance; dx += 1) {
        const dzMagnitude = distance - Math.abs(dx);
        for (const dz of new Set([dzMagnitude, -dzMagnitude])) {
          if (
            isSolid(
              { x: cell.x + dx, y: cell.y, z: cell.z + dz },
              stones,
              removed,
              terrain,
            )
          ) {
            nearest = distance;
            break;
          }
        }
        if (nearest !== Number.POSITIVE_INFINITY) break;
      }
      if (nearest !== Number.POSITIVE_INFINITY) break;
    }
    if (nearest > PHYSICS.maximumTunnelRadiusCells) {
      return {
        code: "TUNNEL_RADIUS_EXCEEDED" as const,
        checked: cells.length,
      };
    }
  }
  return { code: null, checked: cells.length };
}

function withinWorld(cell: VoxelCoordinate) {
  const center = voxelCenter(cell);
  return (
    Math.abs(center.x) <= PHYSICS.worldBoundsM &&
    Math.abs(center.y) <= PHYSICS.worldBoundsM &&
    Math.abs(center.z) <= PHYSICS.worldBoundsM
  );
}

export function validateStaticServiceLoads(
  snapshot: PhysicsSnapshot,
  loads: readonly StaticServiceLoad[],
  terrain: TerrainOracle,
): PhysicsVerdict {
  const stones = cellIndex(snapshot.stones);
  const removed = new Set(snapshot.removedTerrainVoxels.map(voxelKey));
  const normalizedLoads = loads
    .filter(
      (load) =>
        Number.isFinite(load.stoneWeightEquivalent) &&
        load.stoneWeightEquivalent > 0 &&
        stones.has(voxelKey(load.supportCell)),
    )
    .map((load) => ({
      supportCell: { ...load.supportCell },
      stoneWeightEquivalent: load.stoneWeightEquivalent,
    }));
  if (normalizedLoads.length === 0) {
    return stableVerdict([...snapshot.stones], [], 0, 0);
  }
  const components = validateComponents(
    stones,
    normalizedLoads.map((load) => load.supportCell),
    removed,
    { terrain, serviceLoads: normalizedLoads },
  );
  if (components.code) return rejectedVerdict(snapshot, components.code);
  const affectedStoneIds = components.affectedKeys
    .map((key) => stones.get(key)?.id)
    .filter((id): id is string => Boolean(id))
    .sort();
  return stableVerdict(
    [...snapshot.stones],
    affectedStoneIds,
    components.affectedKeys.length,
    0,
  );
}

export function validateStaticServiceLoadCases(
  snapshot: PhysicsSnapshot,
  loads: readonly StaticServiceLoad[],
  terrain: TerrainOracle,
): PhysicsVerdict {
  const stones = cellIndex(snapshot.stones);
  const normalizedLoads = loads
    .filter(
      (load) =>
        Number.isFinite(load.stoneWeightEquivalent) &&
        load.stoneWeightEquivalent > 0 &&
        stones.has(voxelKey(load.supportCell)),
    )
    .map((load) => ({
      supportCell: { ...load.supportCell },
      stoneWeightEquivalent: load.stoneWeightEquivalent,
    }));
  if (normalizedLoads.length === 0) {
    return stableVerdict([...snapshot.stones], [], 0, 0);
  }
  const removed = new Set(snapshot.removedTerrainVoxels.map(voxelKey));
  const components = validateComponents(
    stones,
    normalizedLoads.map((load) => load.supportCell),
    removed,
    { terrain },
    normalizedLoads.map((load) => [load]),
  );
  if (components.code) return rejectedVerdict(snapshot, components.code);
  return stableVerdict(
    [...snapshot.stones],
    [],
    components.affectedKeys.length,
    0,
  );
}

export async function simulateMutation(
  snapshot: PhysicsSnapshot,
  mutation: MatterMutation,
  context?: StaticPhysicsContext,
): Promise<PhysicsVerdict> {
  if (!context) {
    return rejectedVerdict(snapshot, "TERRAIN_CONTEXT_MISSING");
  }
  const sourceStoneId =
    mutation.source.kind === "STONE" ? mutation.matterId : null;
  const sourceStone = sourceStoneId
    ? snapshot.stones.find((stone) => stone.id === sourceStoneId)
    : null;
  if (mutation.source.kind === "STONE" && !sourceStone) {
    return rejectedVerdict(snapshot, "STONE_NOT_FOUND");
  }
  if (
    mutation.source.kind === "TERRAIN" &&
    !isExposedTerrainVoxel(
      context.terrain,
      snapshot.removedTerrainVoxels,
      mutation.source.voxel,
    )
  ) {
    return rejectedVerdict(snapshot, "TERRAIN_VOXEL_NOT_EXPOSED");
  }
  if (
    mutation.source.kind === "BASE" &&
    snapshot.stones.some((stone) => stone.id === mutation.matterId)
  ) {
    return rejectedVerdict(snapshot, "STONE_ALREADY_EXISTS");
  }

  const sourceCell =
    mutation.source.kind === "STONE"
      ? sourceStone!.cell
      : mutation.source.kind === "TERRAIN"
        ? mutation.source.voxel
        : null;
  const destination = mutationDestinationCell(mutation);
  if (
    sourceCell &&
    destination &&
    voxelKey(sourceCell) === voxelKey(destination)
  ) {
    return rejectedVerdict(snapshot, "NO_STATE_CHANGE");
  }
  if (destination && !withinWorld(destination)) {
    return rejectedVerdict(snapshot, "WORLD_BOUNDS_EXCEEDED");
  }

  const candidateStones = snapshot.stones
    .filter(
      (stone) =>
        mutation.source.kind !== "STONE" ||
        stone.id !== mutation.matterId,
    )
    .map((stone) => ({ id: stone.id, cell: { ...stone.cell } }));
  const candidateRemoved = new Set(
    snapshot.removedTerrainVoxels.map(voxelKey),
  );
  if (mutation.source.kind === "TERRAIN") {
    candidateRemoved.add(voxelKey(mutation.source.voxel));
  }
  const candidateIndex = cellIndex(candidateStones);

  if (destination) {
    const destinationKey = voxelKey(destination);
    if (
      candidateIndex.has(destinationKey) ||
      isSolidTerrainVoxel(context.terrain, candidateRemoved, destination)
    ) {
      return rejectedVerdict(snapshot, "DESTINATION_OCCUPIED");
    }
    if (candidateStones.some((stone) => stone.id === mutation.matterId)) {
      return rejectedVerdict(snapshot, "STONE_ALREADY_EXISTS");
    }
    const placed: StoneState = {
      id: mutation.matterId,
      cell: { ...destination },
    };
    candidateStones.push(placed);
    candidateIndex.set(destinationKey, placed);
    if (
      !FACE_NEIGHBOURS.some((offset) => {
        const neighbour = addVoxel(destination, offset);
        return (
          candidateIndex.has(voxelKey(neighbour)) ||
          isSolidTerrainVoxel(context.terrain, candidateRemoved, neighbour)
        );
      })
    ) {
      return rejectedVerdict(snapshot, "DESTINATION_HAS_NO_FACE_CONTACT");
    }
  }

  const seeds: VoxelCoordinate[] = [];
  if (sourceCell) {
    for (const offset of FACE_NEIGHBOURS) {
      const neighbour = addVoxel(sourceCell, offset);
      if (candidateIndex.has(voxelKey(neighbour))) seeds.push(neighbour);
    }
  }
  if (destination) seeds.push(destination);
  const components = validateComponents(
    candidateIndex,
    seeds,
    candidateRemoved,
    context,
  );
  if (components.code) {
    return rejectedVerdict(snapshot, components.code);
  }

  const changed = [
    ...(sourceCell ? [sourceCell] : []),
    ...(destination ? [destination] : []),
  ];
  const cavity = validateCavities(
    candidateIndex,
    candidateRemoved,
    changed,
    context.terrain,
  );
  if (cavity.code) return rejectedVerdict(snapshot, cavity.code);

  const affectedIds = new Set(
    components.affectedKeys
      .map((key) => candidateIndex.get(key)?.id)
      .filter((id): id is string => Boolean(id)),
  );
  if (sourceStone) affectedIds.add(sourceStone.id);
  if (destination) affectedIds.add(mutation.matterId);
  const finalStones = [...candidateStones].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  return stableVerdict(
    finalStones,
    [...affectedIds].sort(),
    components.affectedKeys.length,
    cavity.checked,
  );
}
