import { CLIMBER, PHYSICS } from "./constants";
import protocolManifest from "../protocol/manifest.json";
import { isInsideBaseCamp } from "./mutation";
import type {
  ExpeditionProof,
  LocomotionMode,
  RouteFailureCode,
  RouteSample,
  RouteVerdict,
  SurfaceKind,
  Vec3,
} from "./types";

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function horizontalDistance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function validIndex(index: number | undefined, length: number) {
  return Number.isInteger(index) && index! >= 0 && index! < length;
}

function segmentMinimumHorizontalDistance(
  from: Vec3,
  to: Vec3,
  point: Vec3,
) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) {
    return Math.hypot(from.x - point.x, from.z - point.z);
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - from.x) * dx + (point.z - from.z) * dz) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    from.x + projection * dx - point.x,
    from.z + projection * dz - point.z,
  );
}

function invalid(
  code: RouteFailureCode,
  terminalDistanceFromBaseM = Number.POSITIVE_INFINITY,
  diagnostics: Partial<
    Pick<
      RouteVerdict,
      | "energyKj"
      | "elapsedSeconds"
      | "distanceM"
      | "loadedDistanceM"
      | "enduranceUsed"
    >
  > = {},
): RouteVerdict {
  const enduranceUsed = diagnostics.enduranceUsed ?? 0;
  return {
    valid: false,
    code,
    outcome: "DEAD",
    enduranceUsed,
    enduranceRemaining: Math.max(
      0,
      CLIMBER.enduranceCapacity - enduranceUsed,
    ),
    energyKj: diagnostics.energyKj ?? 0,
    elapsedSeconds: diagnostics.elapsedSeconds ?? 0,
    distanceM: diagnostics.distanceM ?? 0,
    loadedDistanceM: diagnostics.loadedDistanceM ?? 0,
    terminalDistanceFromBaseM,
  };
}

function speedFor(mode: LocomotionMode) {
  if (mode === "WALK") return CLIMBER.walkSpeedMps;
  if (mode === "SCRAMBLE") return CLIMBER.scrambleSpeedMps;
  return CLIMBER.climbSpeedMps;
}

function terrainFactor(surface: SurfaceKind) {
  if (surface === "SNOW") return CLIMBER.snowTerrainFactor;
  if (surface === "ICE") return CLIMBER.iceTerrainFactor;
  return CLIMBER.rockTerrainFactor;
}

function altitudeMultiplier(altitudeM: number) {
  // A deterministic lookup-like approximation keeps physiology monotonic
  // without platform-dependent barometric exponentiation.
  if (altitudeM <= 2500) return 1;
  if (altitudeM >= 9000) return 1.85;
  return 1 + ((altitudeM - 2500) / 6500) * 0.85;
}

function pandolfWatts(
  bodyMassKg: number,
  loadMassKg: number,
  speedMps: number,
  gradePercent: number,
  factor: number,
) {
  const totalMass = bodyMassKg + loadMassKg;
  const loadRatio = loadMassKg / bodyMassKg;
  const base =
    1.5 * bodyMassKg +
    2 * totalMass * loadRatio * loadRatio;
  const terrain =
    factor *
    totalMass *
    (1.5 * speedMps * speedMps +
      0.35 * speedMps * Math.max(-20, Math.min(100, gradePercent)));
  return Math.max(95, base + terrain);
}

export function isCarryingStone(
  proof: ExpeditionProof,
  segmentIndex: number,
) {
  return proof.actions.some(
    (action) =>
      segmentIndex >= action.pickupIndex &&
      segmentIndex < action.releaseIndex,
  );
}

function allowedSlope(
  sample: RouteSample,
  carrying: boolean,
) {
  if (sample.mode === "WALK") {
    return carrying
      ? CLIMBER.maxLoadedWalkSlopeDegrees
      : CLIMBER.maxWalkSlopeDegrees;
  }
  if (sample.mode === "SCRAMBLE") {
    return carrying
      ? CLIMBER.maxLoadedScrambleSlopeDegrees
      : CLIMBER.maxScrambleSlopeDegrees;
  }
  return CLIMBER.maxClimbSlopeDegrees;
}

export interface EnduranceSegment {
  fromIndex: number;
  toIndex: number;
  distanceM: number;
  ascentM: number;
  carrying: boolean;
  mode: LocomotionMode;
  surface: SurfaceKind;
  altitudeM: number;
  energyKj: number;
  endurance: number;
}

function enduranceSegment(
  proof: ExpeditionProof,
  index: number,
): EnduranceSegment {
  const from = proof.route[index - 1];
  const to = proof.route[index];
  const distanceM = distance(from, to);
  const horizontalM = Math.max(0.05, horizontalDistance(from, to));
  const carrying = isCarryingStone(proof, index - 1);
  const speedMps = speedFor(to.mode);
  const seconds = distanceM / speedMps;
  const gradePercent = ((to.y - from.y) / horizontalM) * 100;
  const watts = pandolfWatts(
    CLIMBER.bodyMassKg,
    carrying ? PHYSICS.stoneMassKg : 0,
    speedMps,
    gradePercent,
    terrainFactor(to.surface),
  );
  const altitudeM = (from.altitudeM + to.altitudeM) / 2;
  const energyKj =
    (watts * altitudeMultiplier(altitudeM) * seconds) / 1000;
  return {
    fromIndex: index - 1,
    toIndex: index,
    distanceM,
    ascentM: to.y - from.y,
    carrying,
    mode: to.mode,
    surface: to.surface,
    altitudeM,
    energyKj,
    endurance: energyKj / CLIMBER.kilojoulesPerEndurance,
  };
}

export function evaluateRouteEndurance(proof: ExpeditionProof) {
  const segments = proof.route
    .slice(1)
    .map((_, index) => enduranceSegment(proof, index + 1));
  const energyKj = segments.reduce(
    (total, segment) => total + segment.energyKj,
    0,
  );
  const enduranceUsed = energyKj / CLIMBER.kilojoulesPerEndurance;
  return {
    capacity: CLIMBER.enduranceCapacity,
    kilojoulesPerEndurance: CLIMBER.kilojoulesPerEndurance,
    energyKj,
    enduranceUsed,
    enduranceRemaining: CLIMBER.enduranceCapacity - enduranceUsed,
    segments,
  };
}

function validateActionIndices(proof: ExpeditionProof) {
  const length = proof.route.length;
  if (
    proof.actions.length < 1 ||
    proof.actions.length > protocolManifest.candidate.maximumActions
  ) {
    return false;
  }
  let availableAt = 0;
  for (const action of proof.actions) {
    if (
      !validIndex(action.pickupIndex, length) ||
      !validIndex(action.releaseIndex, length) ||
      action.pickupIndex < availableAt ||
      action.pickupIndex >= action.releaseIndex
    ) {
      return false;
    }
    availableAt = action.releaseIndex;
  }
  return true;
}

function validateExpeditionLifecycle(
  proof: ExpeditionProof,
  baseCamp: Vec3,
): RouteFailureCode | null {
  const departureIndex = proof.route.findIndex(
    (sample) => !isInsideBaseCamp(sample, { baseCamp }),
  );
  if (departureIndex === -1) return "ROUTE_NEVER_LEFT_BASE";

  const baseWithdrawals = proof.actions.filter(
    (action) => action.source.kind === "BASE",
  );
  if (
    baseWithdrawals.length >
    protocolManifest.candidate.maximumBaseWithdrawals
  ) {
    return "BASE_WITHDRAWAL_LIMIT_EXCEEDED";
  }
  if (
    baseWithdrawals.some(
      (action) => action.pickupIndex >= departureIndex,
    )
  ) {
    return "BASE_PICKUP_AFTER_DEPARTURE";
  }

  let returnIndex: number | null = null;
  for (
    let index = departureIndex;
    index < proof.route.length - 1;
    index += 1
  ) {
    const from = proof.route[index];
    const to = proof.route[index + 1];
    if (returnIndex !== null) {
      if (!isInsideBaseCamp(to, { baseCamp })) {
        return "BASE_REDEPARTURE_FORBIDDEN";
      }
      continue;
    }
    if (isInsideBaseCamp(to, { baseCamp })) {
      returnIndex = index + 1;
      continue;
    }
    if (
      segmentMinimumHorizontalDistance(from, to, baseCamp) <
      CLIMBER.baseCampRadiusM - 1e-6
    ) {
      return "BASE_REDEPARTURE_FORBIDDEN";
    }
  }
  if (
    returnIndex !== null &&
    proof.actions.some(
      (action) =>
        action.pickupIndex >= returnIndex! ||
        (action.releaseIndex >= returnIndex! &&
          action.destination.kind !== "BASE"),
    )
  ) {
    return "ACTION_AFTER_BASE_RETURN";
  }
  return null;
}

export function validateRoute(
  proof: ExpeditionProof,
  baseCamp: Vec3,
): RouteVerdict {
  if (proof.route.length < 2) return invalid("ROUTE_TOO_SHORT");
  const terminalDistanceFromBaseM = horizontalDistance(
    proof.route.at(-1)!,
    baseCamp,
  );
  if (!isInsideBaseCamp(proof.route[0], { baseCamp })) {
    return invalid("START_OUTSIDE_BASE", terminalDistanceFromBaseM);
  }
  if (!validateActionIndices(proof)) {
    return invalid("ACTION_INDEX_INVALID", terminalDistanceFromBaseM);
  }
  const lifecycleFailure = validateExpeditionLifecycle(proof, baseCamp);
  if (lifecycleFailure) {
    return invalid(lifecycleFailure, terminalDistanceFromBaseM);
  }

  const returnsToBase =
    isInsideBaseCamp(proof.route.at(-1)!, { baseCamp });
  const terminal = proof.route.at(-1)!;
  if (
    !returnsToBase &&
    (!terminal.safeStop ||
      terminal.slopeDegrees > CLIMBER.maxWalkSlopeDegrees)
  ) {
    return invalid("UNSAFE_TERMINAL", terminalDistanceFromBaseM);
  }

  let energyKj = 0;
  let elapsedSeconds = 0;
  let distanceM = 0;
  let loadedDistanceM = 0;

  for (let index = 1; index < proof.route.length; index += 1) {
    const from = proof.route[index - 1];
    const to = proof.route[index];
    const lengthM = distance(from, to);
    const horizontalM = Math.max(0.05, horizontalDistance(from, to));
    if (horizontalM > CLIMBER.maxProofSegmentM + 1e-6) {
      return invalid("SEGMENT_TOO_LONG", terminalDistanceFromBaseM);
    }

    const carrying = isCarryingStone(proof, index - 1);
    const climb = to.y - from.y;
    if (
      to.mode === "WALK" &&
      horizontalM <= 1.01 &&
      climb > CLIMBER.maxWalkStepM
    ) {
      return invalid("VERTICAL_STEP_EXCEEDED", terminalDistanceFromBaseM);
    }
    if (to.slopeDegrees > allowedSlope(to, carrying)) {
      return invalid("SLOPE_EXCEEDED", terminalDistanceFromBaseM);
    }
    if (to.mode === "CLIMB" && !to.protected) {
      return invalid("CLIMB_UNPROTECTED", terminalDistanceFromBaseM);
    }

    const segment = enduranceSegment(proof, index);
    const seconds = lengthM / speedFor(to.mode);
    energyKj += segment.energyKj;
    elapsedSeconds += seconds;
    distanceM += lengthM;
    if (carrying) loadedDistanceM += lengthM;
    const enduranceUsed = energyKj / CLIMBER.kilojoulesPerEndurance;
    if (enduranceUsed > CLIMBER.enduranceCapacity + 1e-9) {
      return invalid("ENDURANCE_EXHAUSTED", terminalDistanceFromBaseM, {
        energyKj,
        elapsedSeconds,
        distanceM,
        loadedDistanceM,
        enduranceUsed,
      });
    }
  }

  const enduranceUsed = energyKj / CLIMBER.kilojoulesPerEndurance;

  return {
    valid: true,
    code: "ROUTE_VALID",
    outcome: returnsToBase ? "ACTIVE" : "DEAD",
    enduranceUsed,
    enduranceRemaining: CLIMBER.enduranceCapacity - enduranceUsed,
    energyKj,
    elapsedSeconds,
    distanceM,
    loadedDistanceM,
    terminalDistanceFromBaseM,
  };
}
