import {
  CANDIDATE_LIMITS,
  CLIMBER,
  ENDURANCE_MODEL,
  PHYSICS,
  TERRAIN,
} from "./constants";
import {
  stancePoint,
  walkSafeSupport,
} from "./movement";
import { isInsideBaseCamp } from "./mutation";
import { decodeRouteProgram } from "./route-codec";
import type { TerrainOracle } from "./terrain";
import type {
  ExpeditionProof,
  LocomotionMode,
  MicroMovement,
  RouteFailureCode,
  RouteSample,
  RouteStance,
  RouteVerdict,
  SurfaceKind,
  Vec3,
} from "./types";
import type { MovementVerdict } from "./movement";

export interface DecodedCandidateRoute {
  stances: RouteStance[];
  movements: MicroMovement[];
}

export interface EnduranceSegment {
  fromStep: number;
  toStep: number;
  distanceM: number;
  ascentM: number;
  carrying: boolean;
  mode: LocomotionMode;
  surface: SurfaceKind;
  altitudeM: number;
  speedMps: number;
  elapsedSeconds: number;
  energyKj: number;
  endurance: number;
}

function horizontalDistance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function surfaceMultiplier(surface: SurfaceKind) {
  return ENDURANCE_MODEL.surfaceMultipliers[surface];
}

function altitudeMultiplier(altitudeM: number) {
  const model = ENDURANCE_MODEL.altitudeMultiplier;
  if (altitudeM <= model.minimumAltitudeM) return 1;
  if (altitudeM >= model.maximumAltitudeM) {
    return model.maximumMultiplier;
  }
  return (
    1 +
    ((altitudeM - model.minimumAltitudeM) /
      (model.maximumAltitudeM - model.minimumAltitudeM)) *
      (model.maximumMultiplier - 1)
  );
}

export function validateActionSteps(proof: ExpeditionProof) {
  if (
    proof.actions.length < 1 ||
    proof.actions.length > CANDIDATE_LIMITS.maximumActions
  ) {
    return false;
  }
  let availableAt = 0;
  for (const action of proof.actions) {
    if (
      !Number.isSafeInteger(action.pickupStep) ||
      !Number.isSafeInteger(action.releaseStep) ||
      action.pickupStep < availableAt ||
      action.pickupStep >= action.releaseStep ||
      action.releaseStep > proof.route.stepCount
    ) {
      return false;
    }
    availableAt = action.releaseStep;
  }
  return true;
}

export function decodeCandidateRoute(
  proof: ExpeditionProof,
): DecodedCandidateRoute {
  return decodeRouteProgram(proof.route, {
    maximumSteps: CANDIDATE_LIMITS.maximumDecodedRouteSteps,
    requireCanonical: true,
  });
}

function invalid(
  code: RouteFailureCode,
  failureStep: number | null,
  diagnostics: Partial<RouteVerdict> = {},
): RouteVerdict {
  const enduranceUsed = diagnostics.enduranceUsed ?? 0;
  return {
    valid: false,
    code,
    failureStep,
    obstacle: diagnostics.obstacle ?? null,
    outcome: "DEAD",
    enduranceUsed,
    enduranceRemaining: Math.max(
      0,
      CLIMBER.enduranceCapacity - enduranceUsed,
    ),
    energyKj: diagnostics.energyKj ?? 0,
    elapsedSeconds: diagnostics.elapsedSeconds ?? 0,
    distanceM: diagnostics.distanceM ?? 0,
    distanceMillimeters:
      diagnostics.distanceMillimeters ??
      Math.round((diagnostics.distanceM ?? 0) * 1000),
    loadedDistanceM: diagnostics.loadedDistanceM ?? 0,
    terminalDistanceFromBaseM:
      diagnostics.terminalDistanceFromBaseM ??
      Number.POSITIVE_INFINITY,
    maximumAltitudeM:
      diagnostics.maximumAltitudeM ?? Number.NEGATIVE_INFINITY,
    terminalAltitudeM:
      diagnostics.terminalAltitudeM ?? Number.NEGATIVE_INFINITY,
  };
}

export function routeFailure(
  code: RouteFailureCode,
  step: number,
  diagnostics: Partial<RouteVerdict> = {},
) {
  return invalid(code, step, diagnostics);
}

export function enduranceSegment(
  from: RouteSample,
  to: RouteSample,
  movement: MicroMovement,
  movementVerdict: Pick<
    MovementVerdict,
    "mode" | "effectiveSpeedMps"
  >,
  carrying: boolean,
): EnduranceSegment {
  const horizontalM =
    Math.hypot(movement.dx, movement.dz) * TERRAIN.voxelEdgeM;
  const ascentM = Math.max(0, to.y - from.y);
  const descentM = Math.max(0, from.y - to.y);
  const distanceM = Math.hypot(
    horizontalM,
    ascentM + descentM,
  );
  const speedMps = movementVerdict.effectiveSpeedMps;
  const seconds = distanceM / speedMps;
  const model = ENDURANCE_MODEL.additiveModel;
  const totalMassKg =
    CLIMBER.bodyMassKg + (carrying ? PHYSICS.stoneMassKg : 0);
  const baseKj =
    totalMassKg *
    (horizontalM * model.horizontalKilojoulesPerKgM +
      ascentM * model.ascentKilojoulesPerKgM +
      descentM * model.descentKilojoulesPerKgM);
  const altitudeM = (from.altitudeM + to.altitudeM) / 2;
  const energyKj =
    baseKj *
    model.locomotionMultipliers[movementVerdict.mode] *
    surfaceMultiplier(to.surface) *
    altitudeMultiplier(altitudeM);
  return {
    fromStep: from.step,
    toStep: to.step,
    distanceM,
    ascentM,
    carrying,
    mode: movementVerdict.mode,
    surface: to.surface,
    altitudeM,
    speedMps,
    elapsedSeconds: seconds,
    energyKj,
    endurance: energyKj / CLIMBER.kilojoulesPerEndurance,
  };
}

function segmentTouchesCamp(
  from: Vec3,
  to: Vec3,
  baseCamp: Vec3,
  terrain: TerrainOracle,
) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((baseCamp.x - from.x) * dx +
              (baseCamp.z - from.z) * dz) /
              lengthSquared,
          ),
        );
  const closestX = from.x + dx * projection;
  const closestZ = from.z + dz * projection;
  const closestY = from.y + (to.y - from.y) * projection;
  return isInsideBaseCamp(
    { x: closestX, y: closestY, z: closestZ },
    { baseCamp },
    terrain,
  );
}

export class ExactRouteLedger {
  private failure: RouteVerdict | null = null;
  private departed = false;
  private returned = false;
  private energyKj = 0;
  private elapsedSeconds = 0;
  private distanceM = 0;
  private loadedDistanceM = 0;
  private maximumAltitudeM: number;
  private terminal: RouteSample;

  constructor(
    private readonly proof: ExpeditionProof,
    first: RouteSample,
    private readonly baseCamp: Vec3,
    private readonly terrain: TerrainOracle,
  ) {
    this.maximumAltitudeM = first.altitudeM;
    this.terminal = first;
    if (!validateActionSteps(proof)) {
      this.failure = this.failureVerdict("ACTION_INDEX_INVALID", 0);
    } else if (!isInsideBaseCamp(first, { baseCamp }, terrain)) {
      this.failure = this.failureVerdict("START_OUTSIDE_BASE", 0);
    } else if (
      proof.actions.filter((action) => action.source.kind === "BASE")
        .length > CANDIDATE_LIMITS.maximumBaseWithdrawals
    ) {
      this.failure = this.failureVerdict(
        "BASE_WITHDRAWAL_LIMIT_EXCEEDED",
        0,
      );
    }
  }

  private diagnostics(): Partial<RouteVerdict> {
    const enduranceUsed =
      this.energyKj / CLIMBER.kilojoulesPerEndurance;
    return {
      energyKj: this.energyKj,
      enduranceUsed,
      elapsedSeconds: this.elapsedSeconds,
      distanceM: this.distanceM,
      distanceMillimeters: Math.round(this.distanceM * 1000),
      loadedDistanceM: this.loadedDistanceM,
      terminalDistanceFromBaseM: horizontalDistance(
        this.terminal,
        this.baseCamp,
      ),
      maximumAltitudeM: this.maximumAltitudeM,
      terminalAltitudeM: this.terminal.altitudeM,
    };
  }

  private failureVerdict(
    code: RouteFailureCode,
    step: number,
    obstacle: string | null = null,
  ) {
    return invalid(code, step, {
      ...this.diagnostics(),
      obstacle,
    });
  }

  reject(
    code: RouteFailureCode,
    step: number,
    obstacle: string | null = null,
  ) {
    if (!this.failure) {
      this.failure = this.failureVerdict(code, step, obstacle);
    }
    return this.failure;
  }

  failureOrNull() {
    return this.failure;
  }

  advance(
    from: RouteSample,
    to: RouteSample,
    movement: MicroMovement,
    movementVerdict: MovementVerdict,
    carrying: boolean,
  ) {
    if (this.failure) return this.failure;
    this.terminal = to;
    this.maximumAltitudeM = Math.max(
      this.maximumAltitudeM,
      to.altitudeM,
    );

    const fromInside = isInsideBaseCamp(
      from,
      { baseCamp: this.baseCamp },
      this.terrain,
    );
    const toInside = isInsideBaseCamp(
      to,
      { baseCamp: this.baseCamp },
      this.terrain,
    );
    if (!this.departed && !toInside) {
      this.departed = true;
      const lateWithdrawal = this.proof.actions.find(
        (action) =>
          action.source.kind === "BASE" &&
          action.pickupStep >= to.step,
      );
      if (lateWithdrawal) {
        return this.reject(
          "BASE_PICKUP_AFTER_DEPARTURE",
          lateWithdrawal.pickupStep,
        );
      }
    } else if (this.departed && !this.returned) {
      if (toInside) {
        this.returned = true;
      } else if (
        !fromInside &&
        segmentTouchesCamp(from, to, this.baseCamp, this.terrain)
      ) {
        return this.reject("BASE_REDEPARTURE_FORBIDDEN", to.step);
      }
      if (this.returned) {
        const lateAction = this.proof.actions.find(
          (action) =>
            action.pickupStep >= to.step ||
            (action.releaseStep >= to.step &&
              action.destination.kind !== "BASE"),
        );
        if (lateAction) {
          return this.reject(
            "ACTION_AFTER_BASE_RETURN",
            Math.max(lateAction.pickupStep, to.step),
          );
        }
      }
    } else if (this.returned && !toInside) {
      return this.reject("BASE_REDEPARTURE_FORBIDDEN", to.step);
    }

    const segment = enduranceSegment(
      from,
      to,
      movement,
      movementVerdict,
      carrying,
    );
    this.energyKj += segment.energyKj;
    this.elapsedSeconds += segment.elapsedSeconds;
    this.distanceM += segment.distanceM;
    if (carrying) this.loadedDistanceM += segment.distanceM;
    if (
      this.energyKj / CLIMBER.kilojoulesPerEndurance >
      CLIMBER.enduranceCapacity + 1e-9
    ) {
      return this.reject("ENDURANCE_EXHAUSTED", to.step);
    }
    return null;
  }

  finish(): RouteVerdict {
    if (this.failure) return this.failure;
    if (!this.departed) {
      return this.reject(
        "ROUTE_NEVER_LEFT_BASE",
        this.terminal.step,
      );
    }
    const returnsToBase = isInsideBaseCamp(
      this.terminal,
      { baseCamp: this.baseCamp },
      this.terrain,
    );
    if (
      !returnsToBase &&
      (!this.proof.route.acceptOneWayDeath ||
        !walkSafeSupport(this.terminal))
    ) {
      return this.reject("UNSAFE_TERMINAL", this.terminal.step);
    }
    const enduranceUsed =
      this.energyKj / CLIMBER.kilojoulesPerEndurance;
    return {
      valid: true,
      code: "ROUTE_VALID",
      failureStep: null,
      obstacle: null,
      outcome: returnsToBase ? "ACTIVE" : "DEAD",
      enduranceUsed,
      enduranceRemaining:
        CLIMBER.enduranceCapacity - enduranceUsed,
      energyKj: this.energyKj,
      elapsedSeconds: this.elapsedSeconds,
      distanceM: this.distanceM,
      distanceMillimeters: Math.round(this.distanceM * 1000),
      loadedDistanceM: this.loadedDistanceM,
      terminalDistanceFromBaseM: horizontalDistance(
        this.terminal,
        this.baseCamp,
      ),
      maximumAltitudeM: this.maximumAltitudeM,
      terminalAltitudeM: this.terminal.altitudeM,
    };
  }

}

export function startPointForProof(proof: ExpeditionProof) {
  return stancePoint(proof.route.start);
}
