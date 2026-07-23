import { CLIMBER, PHYSICS } from "./constants";
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

function invalid(
  code: RouteFailureCode,
  terminalDistanceFromBaseM = Number.POSITIVE_INFINITY,
): RouteVerdict {
  return {
    valid: false,
    code,
    outcome: "RETIRED",
    energyKj: 0,
    elapsedSeconds: 0,
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

function isCarryingStone(proof: ExpeditionProof, segmentIndex: number) {
  const { mutation } = proof;
  if (mutation.kind === "ADD") {
    return segmentIndex < (proof.releaseIndex ?? -1);
  }
  if (mutation.kind === "MOVE") {
    return (
      segmentIndex >= (proof.pickupIndex ?? Number.POSITIVE_INFINITY) &&
      segmentIndex < (proof.releaseIndex ?? -1)
    );
  }
  return segmentIndex >= (proof.pickupIndex ?? Number.POSITIVE_INFINITY);
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

function validateActionIndices(proof: ExpeditionProof) {
  const length = proof.route.length;
  if (proof.mutation.kind === "ADD") {
    return validIndex(proof.releaseIndex, length);
  }
  if (proof.mutation.kind === "MOVE") {
    return (
      validIndex(proof.pickupIndex, length) &&
      validIndex(proof.releaseIndex, length) &&
      proof.pickupIndex! < proof.releaseIndex!
    );
  }
  return validIndex(proof.pickupIndex, length);
}

export function validateRoute(
  proof: ExpeditionProof,
  baseCamp: Vec3,
): RouteVerdict {
  if (proof.route.length < 2) return invalid("ROUTE_TOO_SHORT");
  const terminalDistanceFromBaseM = distance(
    proof.route.at(-1)!,
    baseCamp,
  );
  if (distance(proof.route[0], baseCamp) > CLIMBER.baseCampRadiusM) {
    return invalid("START_OUTSIDE_BASE", terminalDistanceFromBaseM);
  }
  if (!validateActionIndices(proof)) {
    return invalid("ACTION_INDEX_INVALID", terminalDistanceFromBaseM);
  }

  const returnsToBase =
    terminalDistanceFromBaseM <= CLIMBER.baseCampRadiusM;
  if (proof.mutation.kind === "RECOVER" && !returnsToBase) {
    return invalid("RECOVERY_MUST_RETURN", terminalDistanceFromBaseM);
  }

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

  for (let index = 1; index < proof.route.length; index += 1) {
    const from = proof.route[index - 1];
    const to = proof.route[index];
    const lengthM = distance(from, to);
    if (lengthM > CLIMBER.maxProofSegmentM + 1e-6) {
      return invalid("SEGMENT_TOO_LONG", terminalDistanceFromBaseM);
    }

    const carrying = isCarryingStone(proof, index - 1);
    const climb = to.y - from.y;
    if (
      to.mode === "WALK" &&
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

    const speedMps = speedFor(to.mode);
    const seconds = lengthM / speedMps;
    const horizontalM = Math.max(0.05, horizontalDistance(from, to));
    const gradePercent = ((to.y - from.y) / horizontalM) * 100;
    const loadMassKg = carrying ? PHYSICS.stoneMassKg : 0;
    const watts = pandolfWatts(
      CLIMBER.bodyMassKg,
      loadMassKg,
      speedMps,
      gradePercent,
      terrainFactor(to.surface),
    );
    const altitudeM = (from.altitudeM + to.altitudeM) / 2;
    energyKj +=
      (watts * altitudeMultiplier(altitudeM) * seconds) / 1000;
    elapsedSeconds += seconds;
  }

  if (energyKj > CLIMBER.maximumEnergyKj) {
    return invalid("ENERGY_BUDGET_EXCEEDED", terminalDistanceFromBaseM);
  }

  return {
    valid: true,
    code: "ROUTE_VALID",
    outcome: returnsToBase ? "ACTIVE" : "RETIRED",
    energyKj,
    elapsedSeconds,
    terminalDistanceFromBaseM,
  };
}

