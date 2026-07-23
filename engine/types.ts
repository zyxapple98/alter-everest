export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type Quaternion = Readonly<{ x: number; y: number; z: number; w: number }>;

export interface Pose {
  translation: Vec3;
  rotation: Quaternion;
}

export interface StoneState {
  id: string;
  pose: Pose;
}

export interface TerrainCuboid {
  kind: "cuboid";
  center: Vec3;
  halfExtents: Vec3;
  friction?: number;
}

export interface TerrainMesh {
  kind: "trimesh";
  vertices: Float32Array;
  indices: Uint32Array;
  friction?: number;
}

export type TerrainCollider = TerrainCuboid | TerrainMesh;

export interface PhysicsSnapshot {
  worldHash: string;
  stones: StoneState[];
  terrain: TerrainCollider[];
}

export type StoneMutation =
  | {
      kind: "ADD";
      stoneId: string;
      releasePose: Pose;
    }
  | {
      kind: "MOVE";
      stoneId: string;
      releasePose: Pose;
    }
  | {
      kind: "RECOVER";
      stoneId: string;
    };

export type PhysicsFailureCode =
  | "STONE_ALREADY_EXISTS"
  | "STONE_NOT_FOUND"
  | "PLACEMENT_DID_NOT_HOLD"
  | "SETTLING_TIMEOUT"
  | "WORLD_BOUNDS_EXCEEDED";

export interface PhysicsVerdict {
  valid: boolean;
  code: "STABLE" | PhysicsFailureCode;
  finalStones: StoneState[];
  affectedStoneIds: string[];
  simulatedSeconds: number;
  maxLinearSpeed: number;
}

export type LocomotionMode = "WALK" | "SCRAMBLE" | "CLIMB";
export type SurfaceKind = "ROCK" | "SNOW" | "ICE";

export interface RouteSample extends Vec3 {
  altitudeM: number;
  slopeDegrees: number;
  surface: SurfaceKind;
  mode: LocomotionMode;
  protected?: boolean;
  safeStop?: boolean;
}

export interface ExpeditionProof {
  route: RouteSample[];
  mutation: StoneMutation;
  pickupIndex?: number;
  releaseIndex?: number;
}

export type IdentityOutcome = "ACTIVE" | "RETIRED";

export type RouteFailureCode =
  | "ROUTE_TOO_SHORT"
  | "START_OUTSIDE_BASE"
  | "ROUTE_OBSTRUCTED"
  | "SEGMENT_TOO_LONG"
  | "VERTICAL_STEP_EXCEEDED"
  | "SLOPE_EXCEEDED"
  | "CLIMB_UNPROTECTED"
  | "ACTION_INDEX_INVALID"
  | "RECOVERY_MUST_RETURN"
  | "UNSAFE_TERMINAL"
  | "ENERGY_BUDGET_EXCEEDED";

export interface RouteVerdict {
  valid: boolean;
  code: "ROUTE_VALID" | RouteFailureCode;
  outcome: IdentityOutcome;
  energyKj: number;
  elapsedSeconds: number;
  terminalDistanceFromBaseM: number;
}

export interface IdentityState {
  id: string;
  status: IdentityOutcome;
}

export interface CandidateCommit {
  id: string;
  parentWorldHash: string;
  agentId: string;
  proof: ExpeditionProof;
}

export interface CanonicalWorld extends PhysicsSnapshot {
  identities: IdentityState[];
}

export interface CommitVerdict {
  accepted: boolean;
  code:
    | "ACCEPTED"
    | "IDENTITY_RETIRED"
    | "ROUTE_INVALID"
    | "PHYSICS_INVALID"
    | "STALE_CONFLICT";
  canonicalParent: string;
  revalidatedAgainstHead: boolean;
  route: RouteVerdict | null;
  physics: PhysicsVerdict | null;
  nextIdentityStatus: IdentityOutcome | null;
}

export const IDENTITY_QUATERNION: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
