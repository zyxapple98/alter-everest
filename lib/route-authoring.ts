import { CANDIDATE_LIMITS } from "../engine/constants";
import { exactRouteFromStances } from "../engine/route-codec";
import type {
  ExactRoute,
  LocomotionMode,
  RouteStance,
  VoxelCoordinate,
} from "../engine/types";

const MODES = new Set<LocomotionMode>(["WALK", "SCRAMBLE", "CLIMB"]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface AuthoringStance {
  label?: string;
  cell: VoxelCoordinate;
  mode: LocomotionMode;
  protected: boolean;
}

export interface AuthoringRoute {
  stances: AuthoringStance[];
  safeStop: boolean;
}

function parseCell(value: unknown, index: number): VoxelCoordinate {
  if (!value || typeof value !== "object") {
    throw new Error(`stance ${index} cell must be an object.`);
  }
  const cell = value as Record<string, unknown>;
  if (
    Object.keys(cell).some((key) => !["x", "y", "z"].includes(key)) ||
    !Number.isSafeInteger(cell.x) ||
    !Number.isSafeInteger(cell.y) ||
    !Number.isSafeInteger(cell.z)
  ) {
    throw new Error(
      `stance ${index} cell requires exact integer x/y/z voxel coordinates.`,
    );
  }
  return {
    x: cell.x as number,
    y: cell.y as number,
    z: cell.z as number,
  };
}

export function parseAuthoringRoute(value: unknown): AuthoringRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("route must be an object containing exact stances.");
  }
  const route = value as Record<string, unknown>;
  if (
    Object.keys(route).some(
      (key) => !["stances", "safeStop"].includes(key),
    ) ||
    (route.safeStop !== undefined && typeof route.safeStop !== "boolean") ||
    !Array.isArray(route.stances) ||
    route.stances.length < 2 ||
    route.stances.length >
      CANDIDATE_LIMITS.maximumDecodedRouteSteps + 1
  ) {
    throw new Error(
      `route requires 2–${CANDIDATE_LIMITS.maximumDecodedRouteSteps + 1} exact stances and optional safeStop.`,
    );
  }

  const labels = new Set<string>();
  const stances = route.stances.map((entry, index): AuthoringStance => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`stance ${index} must be an object.`);
    }
    const stance = entry as Record<string, unknown>;
    if (
      Object.keys(stance).some(
        (key) => !["label", "cell", "mode", "protected"].includes(key),
      )
    ) {
      throw new Error(`stance ${index} contains unsupported properties.`);
    }
    const label =
      stance.label === undefined ? undefined : String(stance.label);
    if (label && (!SAFE_IDENTIFIER.test(label) || label.length > 128)) {
      throw new Error(`stance ${index} label is not a safe identifier.`);
    }
    if (label && labels.has(label)) {
      throw new Error(`stance label "${label}" is duplicated.`);
    }
    if (label) labels.add(label);
    if (!MODES.has(stance.mode as LocomotionMode)) {
      throw new Error(
        `stance ${index} mode must be WALK, SCRAMBLE or CLIMB.`,
      );
    }
    if (
      stance.protected !== undefined &&
      typeof stance.protected !== "boolean"
    ) {
      throw new Error(`stance ${index} protected must be boolean.`);
    }
    return {
      ...(label ? { label } : {}),
      cell: parseCell(stance.cell, index),
      mode: stance.mode as LocomotionMode,
      protected: stance.protected === true,
    };
  });

  if (stances[0].mode !== "WALK" || stances[0].protected) {
    throw new Error(
      "stance 0 must use the codec initial state WALK with protected false.",
    );
  }
  return { stances, safeStop: route.safeStop === true };
}

export function compileAuthoringRoute(value: unknown): {
  route: ExactRoute;
  labelSteps: Record<string, number>;
  stances: RouteStance[];
} {
  const parsed = parseAuthoringRoute(value);
  const labelSteps: Record<string, number> = {};
  const stances = parsed.stances.map((stance, step): RouteStance => {
    if (stance.label) labelSteps[stance.label] = step;
    return {
      step,
      cell: { ...stance.cell },
      mode: stance.mode,
      protected: stance.protected,
    };
  });
  return {
    route: exactRouteFromStances(stances, parsed.safeStop),
    labelSteps,
    stances,
  };
}
