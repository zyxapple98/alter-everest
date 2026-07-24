import { PHYSICS } from "./constants";
import {
  mutationReleasePose,
  mutationStoneId,
  voxelCenter,
} from "./mutation";
import {
  IDENTITY_QUATERNION,
  type PhysicsSnapshot,
  type PhysicsVerdict,
  type Pose,
  type MatterMutation,
  type StoneState,
} from "./types";

type Rapier = (typeof import("@dimforge/rapier3d-deterministic-compat"))["default"];

let rapierReady: Promise<Rapier> | null = null;

export async function loadPhysicsRuntime() {
  if (!rapierReady) {
    rapierReady = (async () => {
      const rapierPackage = await import(
        "@dimforge/rapier3d-deterministic-compat"
      );
      const rapier = rapierPackage.default;
      await rapier.init();
      return rapier;
    })();
  }
  return rapierReady;
}

function snap(value: number) {
  return Math.round(value / PHYSICS.releaseSnapM) * PHYSICS.releaseSnapM;
}

export function snapReleasePose(pose: Pose): Pose {
  return {
    translation: {
      x: snap(pose.translation.x),
      y: snap(pose.translation.y),
      z: snap(pose.translation.z),
    },
    // A cube has 24 equivalent axis-aligned orientations. Canonicalizing the
    // release orientation avoids platform-dependent trigonometric initialization.
    rotation: IDENTITY_QUATERNION,
  };
}

function distance(a: Pose["translation"], b: Pose["translation"]) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function canonicalCell(point: Pose["translation"]) {
  return {
    x: Math.floor(point.x / PHYSICS.stoneEdgeM),
    y: Math.floor(point.y / PHYSICS.stoneEdgeM),
    z: Math.floor(point.z / PHYSICS.stoneEdgeM),
  };
}

function vectorMagnitude(vector: { x: number; y: number; z: number }) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function contactIslandIds(
  snapshot: PhysicsSnapshot,
  mutation: MatterMutation,
) {
  const anchors: Pose["translation"][] = [];
  const sourceStoneId =
    mutation.source.kind === "STONE" ? mutation.source.stoneId : null;
  const existing = sourceStoneId
    ? snapshot.stones.find((stone) => stone.id === sourceStoneId)
    : null;
  if (existing) anchors.push(existing.pose.translation);
  if (mutation.source.kind === "TERRAIN") {
    anchors.push(voxelCenter(mutation.source.voxel));
  }
  const releasePose = mutationReleasePose(mutation);
  if (releasePose) anchors.push(releasePose.translation);

  const selected = new Set<string>();
  const frontier = [...anchors];
  const maximumDistance = PHYSICS.contactIslandLinkM;
  const cellSize = maximumDistance;
  const buckets = new Map<string, StoneState[]>();
  const bucketCoordinate = (value: number) => Math.floor(value / cellSize);
  const bucketKey = (x: number, y: number, z: number) => `${x}:${y}:${z}`;
  for (const stone of snapshot.stones) {
    const point = stone.pose.translation;
    const key = bucketKey(
      bucketCoordinate(point.x),
      bucketCoordinate(point.y),
      bucketCoordinate(point.z),
    );
    const bucket = buckets.get(key);
    if (bucket) bucket.push(stone);
    else buckets.set(key, [stone]);
  }

  for (let index = 0; index < frontier.length; index += 1) {
    const point = frontier[index];
    const bx = bucketCoordinate(point.x);
    const by = bucketCoordinate(point.y);
    const bz = bucketCoordinate(point.z);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          for (const stone of buckets.get(bucketKey(bx + dx, by + dy, bz + dz)) ?? []) {
            if (selected.has(stone.id)) continue;
            if (distance(point, stone.pose.translation) <= maximumDistance) {
              selected.add(stone.id);
              frontier.push(stone.pose.translation);
              if (selected.size > PHYSICS.maxContactIslandStones) {
                return { ids: selected, exceeded: true };
              }
            }
          }
        }
      }
    }
  }
  return { ids: selected, exceeded: false };
}

function changedStoneIds(before: StoneState[], after: StoneState[]) {
  const initial = new Map(before.map((stone) => [stone.id, stone]));
  const changed: string[] = [];

  for (const stone of after) {
    const previous = initial.get(stone.id);
    if (
      !previous ||
      distance(previous.pose.translation, stone.pose.translation) > 0.001
    ) {
      changed.push(stone.id);
    }
  }
  for (const stone of before) {
    if (!after.some((candidate) => candidate.id === stone.id)) {
      changed.push(stone.id);
    }
  }

  return [...new Set(changed)].sort();
}

function prepareMutation(
  snapshot: PhysicsSnapshot,
  mutation: MatterMutation,
):
  | { ok: true; stones: StoneState[]; intendedRelease: Pose | null }
  | {
      ok: false;
      verdict: PhysicsVerdict;
    } {
  const sourceStoneId =
    mutation.source.kind === "STONE" ? mutation.source.stoneId : null;
  const resultingStoneId = mutationStoneId(mutation);
  const sourceExists =
    sourceStoneId !== null &&
    snapshot.stones.some((stone) => stone.id === sourceStoneId);
  const resultExists = snapshot.stones.some(
    (stone) => stone.id === resultingStoneId,
  );

  if (mutation.source.kind !== "STONE" && resultExists) {
    return {
      ok: false,
      verdict: {
        valid: false,
        code: "STONE_ALREADY_EXISTS",
        finalStones: snapshot.stones,
        affectedStoneIds: [],
        simulatedSeconds: 0,
        maxLinearSpeed: 0,
        maxAngularSpeed: 0,
        contactModel: "RAPIER_COULOMB_FRICTION",
      },
    };
  }

  if (mutation.source.kind === "STONE" && !sourceExists) {
    return {
      ok: false,
      verdict: {
        valid: false,
        code: "STONE_NOT_FOUND",
        finalStones: snapshot.stones,
        affectedStoneIds: [],
        simulatedSeconds: 0,
        maxLinearSpeed: 0,
        maxAngularSpeed: 0,
        contactModel: "RAPIER_COULOMB_FRICTION",
      },
    };
  }

  const remaining = snapshot.stones.filter(
    (stone) => stone.id !== sourceStoneId,
  );

  if (mutation.destination.kind === "BASE") {
    return { ok: true, stones: remaining, intendedRelease: null };
  }

  const intendedRelease = snapReleasePose(mutation.destination.releasePose);
  if (
    mutation.source.kind === "STONE" &&
    (() => {
      const before = canonicalCell(
        snapshot.stones.find((stone) => stone.id === sourceStoneId)!.pose
          .translation,
      );
      const after = canonicalCell(intendedRelease.translation);
      return before.x === after.x && before.y === after.y && before.z === after.z;
    })()
  ) {
    return {
      ok: false,
      verdict: {
        valid: false,
        code: "NO_STATE_CHANGE",
        finalStones: snapshot.stones,
        affectedStoneIds: [],
        simulatedSeconds: 0,
        maxLinearSpeed: 0,
        maxAngularSpeed: 0,
        contactModel: "RAPIER_COULOMB_FRICTION",
      },
    };
  }
  if (mutation.source.kind === "TERRAIN") {
    const destinationCell = canonicalCell(intendedRelease.translation);
    const sourceCell = mutation.source.voxel;
    if (
      destinationCell.x === sourceCell.x &&
      destinationCell.y === sourceCell.y &&
      destinationCell.z === sourceCell.z
    ) {
      return {
        ok: false,
        verdict: {
          valid: false,
          code: "NO_STATE_CHANGE",
          finalStones: snapshot.stones,
          affectedStoneIds: [],
          simulatedSeconds: 0,
          maxLinearSpeed: 0,
          maxAngularSpeed: 0,
          contactModel: "RAPIER_COULOMB_FRICTION",
        },
      };
    }
  }
  const releasedStone: StoneState = {
    id: resultingStoneId,
    pose: intendedRelease,
  };

  return {
    ok: true,
    stones: [...remaining, releasedStone].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    intendedRelease,
  };
}

export async function simulateMutation(
  snapshot: PhysicsSnapshot,
  mutation: MatterMutation,
): Promise<PhysicsVerdict> {
  const rejected = prepareMutation(snapshot, mutation);
  if (!rejected.ok) return rejected.verdict;

  const island = contactIslandIds(snapshot, mutation);
  if (island.exceeded) {
    return {
      valid: false,
      code: "CONTACT_ISLAND_TOO_LARGE",
      finalStones: snapshot.stones,
      affectedStoneIds: [],
      simulatedSeconds: 0,
      maxLinearSpeed: 0,
      maxAngularSpeed: 0,
      contactModel: "RAPIER_COULOMB_FRICTION",
    };
  }
  const remoteStones = snapshot.stones.filter(
    (stone) => !island.ids.has(stone.id),
  );
  const localSnapshot = {
    ...snapshot,
    stones: snapshot.stones.filter((stone) => island.ids.has(stone.id)),
  };
  const prepared = prepareMutation(localSnapshot, mutation);
  if (!prepared.ok) return prepared.verdict;
  if (prepared.stones.length > PHYSICS.maxContactIslandStones) {
    return {
      valid: false,
      code: "CONTACT_ISLAND_TOO_LARGE",
      finalStones: snapshot.stones,
      affectedStoneIds: [],
      simulatedSeconds: 0,
      maxLinearSpeed: 0,
      maxAngularSpeed: 0,
      contactModel: "RAPIER_COULOMB_FRICTION",
    };
  }

  const RAPIER = await loadPhysicsRuntime();
  const world = new RAPIER.World({
    x: 0,
    y: -PHYSICS.gravityMps2,
    z: 0,
  });
  world.timestep = PHYSICS.fixedTimestepSeconds;

  for (const terrain of snapshot.terrain) {
    const descriptor =
      terrain.kind === "cuboid"
        ? RAPIER.ColliderDesc.cuboid(
            terrain.halfExtents.x,
            terrain.halfExtents.y,
            terrain.halfExtents.z,
          )
            .setTranslation(
              terrain.center.x,
              terrain.center.y,
              terrain.center.z,
            )
            .setRotation(terrain.rotation ?? IDENTITY_QUATERNION)
        : RAPIER.ColliderDesc.trimesh(terrain.vertices, terrain.indices);
    descriptor
      .setFriction(terrain.friction ?? PHYSICS.dryRockFriction)
      .setRestitution(PHYSICS.restitution)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
    world.createCollider(descriptor);
  }

  const bodies = new Map<string, import("@dimforge/rapier3d-deterministic-compat").RigidBody>();
  const halfEdge = PHYSICS.stoneEdgeM / 2;

  for (const stone of prepared.stones) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          stone.pose.translation.x,
          stone.pose.translation.y,
          stone.pose.translation.z,
        )
        .setRotation(stone.pose.rotation)
        .setCanSleep(true)
        .setCcdEnabled(true)
        .setLinearDamping(0.08)
        .setAngularDamping(0.08),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfEdge, halfEdge, halfEdge)
        .setDensity(PHYSICS.stoneDensityKgM3)
        .setFriction(PHYSICS.dryRockFriction)
        .setRestitution(PHYSICS.restitution)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
      body,
    );
    bodies.set(stone.id, body);
  }

  // The mutation may remove a support or introduce a new impact. Waking the
  // local island lets Rapier discover secondary movement and collapse.
  for (const body of bodies.values()) body.wakeUp();

  const maxSteps = Math.ceil(
    PHYSICS.maxSettlingSeconds / PHYSICS.fixedTimestepSeconds,
  );
  const minimumSteps = Math.ceil(
    PHYSICS.minimumSettlingSeconds / PHYSICS.fixedTimestepSeconds,
  );
  let quietFrames = 0;
  let settled = false;
  let completedSteps = 0;
  let maxLinearSpeed = 0;
  let maxAngularSpeed = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    world.step();
    completedSteps = step + 1;
    let frameQuiet = true;

    for (const body of bodies.values()) {
      const linearSpeed = vectorMagnitude(body.linvel());
      const angularSpeed = vectorMagnitude(body.angvel());
      maxLinearSpeed = Math.max(maxLinearSpeed, linearSpeed);
      maxAngularSpeed = Math.max(maxAngularSpeed, angularSpeed);
      if (
        linearSpeed > PHYSICS.linearSleepThresholdMps ||
        angularSpeed > PHYSICS.angularSleepThresholdRps
      ) {
        frameQuiet = false;
      }
    }

    quietFrames = frameQuiet ? quietFrames + 1 : 0;
    if (step >= minimumSteps && quietFrames >= 30) {
      settled = true;
      break;
    }
  }

  const localFinalStones = [...bodies.entries()]
    .map(([id, body]) => {
      const translation = body.translation();
      const rotation = body.rotation();
      return {
        id,
        pose: {
          translation: {
            x: translation.x,
            y: translation.y,
            z: translation.z,
          },
          rotation: {
            x: rotation.x,
            y: rotation.y,
            z: rotation.z,
            w: rotation.w,
          },
        },
      } satisfies StoneState;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const finalStones = [...remoteStones, ...localFinalStones].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const exceededBounds = localFinalStones.some((stone) => {
    const { x, y, z } = stone.pose.translation;
    return (
      Math.abs(x) > PHYSICS.worldBoundsM ||
      Math.abs(y) > PHYSICS.worldBoundsM ||
      Math.abs(z) > PHYSICS.worldBoundsM
    );
  });

  const placedStone =
    mutation.destination.kind === "BASE"
      ? null
      : finalStones.find((stone) => stone.id === mutationStoneId(mutation)) ?? null;
  const placementHeld =
    !prepared.intendedRelease ||
    (placedStone !== null &&
      distance(
        prepared.intendedRelease.translation,
        placedStone.pose.translation,
      ) <= PHYSICS.placementToleranceM);
  const affectedStoneIds = changedStoneIds(snapshot.stones, finalStones);
  const simulatedSeconds =
    completedSteps * PHYSICS.fixedTimestepSeconds;

  world.free();

  if (exceededBounds) {
    return {
      valid: false,
      code: "WORLD_BOUNDS_EXCEEDED",
      finalStones,
      affectedStoneIds,
      simulatedSeconds,
      maxLinearSpeed,
      maxAngularSpeed,
      contactModel: "RAPIER_COULOMB_FRICTION",
    };
  }
  if (!settled) {
    return {
      valid: false,
      code: "SETTLING_TIMEOUT",
      finalStones,
      affectedStoneIds,
      simulatedSeconds,
      maxLinearSpeed,
      maxAngularSpeed,
      contactModel: "RAPIER_COULOMB_FRICTION",
    };
  }
  if (!placementHeld) {
    return {
      valid: false,
      code: "PLACEMENT_DID_NOT_HOLD",
      finalStones,
      affectedStoneIds,
      simulatedSeconds,
      maxLinearSpeed,
      maxAngularSpeed,
      contactModel: "RAPIER_COULOMB_FRICTION",
    };
  }

  return {
    valid: true,
    code: "STABLE",
    finalStones,
    affectedStoneIds,
    simulatedSeconds,
    maxLinearSpeed,
    maxAngularSpeed,
    contactModel: "RAPIER_COULOMB_FRICTION",
  };
}
