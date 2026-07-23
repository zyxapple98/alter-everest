import type { ActionMode, TripMode } from "./world";

export const PROTOCOL_VERSION = "0.1.0";

export interface ExpeditionPayload {
  protocol: typeof PROTOCOL_VERSION;
  world: string;
  agent: string;
  action: ActionMode;
  trip: TripMode;
  stone: string;
  route: Array<[number, number, number]>;
  place?: [number, number, number];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  steps: number;
}

const actions: ActionMode[] = ["ADD", "MOVE", "RECOVER"];
const trips: TripMode[] = ["ROUND_TRIP", "ONE_WAY"];

export function validateExpedition(
  payload: Partial<ExpeditionPayload>,
  expectedWorld?: string,
): ValidationResult {
  const errors: string[] = [];

  if (payload.protocol !== PROTOCOL_VERSION) {
    errors.push(`protocol must equal ${PROTOCOL_VERSION}`);
  }
  if (!payload.agent || payload.agent.length > 80) {
    errors.push("agent must be a non-empty identifier under 80 characters");
  }
  if (!payload.world) errors.push("world hash is required");
  if (expectedWorld && payload.world !== expectedWorld) {
    errors.push("expedition is based on a stale world");
  }
  if (!payload.action || !actions.includes(payload.action)) {
    errors.push("action must be ADD, MOVE, or RECOVER");
  }
  if (!payload.trip || !trips.includes(payload.trip)) {
    errors.push("trip must be ROUND_TRIP or ONE_WAY");
  }
  if (!payload.stone) errors.push("stone id is required");
  if (!Array.isArray(payload.route) || payload.route.length < 2) {
    errors.push("route must contain at least two coordinates");
  }
  if (payload.action !== "RECOVER" && !payload.place) {
    errors.push("ADD and MOVE expeditions require a place coordinate");
  }
  if (payload.action === "RECOVER" && payload.trip === "ONE_WAY") {
    errors.push("RECOVER expeditions must return the stone to base camp");
  }

  const route = Array.isArray(payload.route) ? payload.route : [];
  for (const coordinate of route) {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length !== 3 ||
      coordinate.some((value) => !Number.isFinite(value))
    ) {
      errors.push("every route coordinate must be a finite [x,y,z] tuple");
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    steps: Math.max(0, route.length - 1),
  };
}

