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
  rotation?: Quaternion;
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
  maxAngularSpeed: number;
  contactModel: "RAPIER_COULOMB_FRICTION";
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

export type IdentityOutcome = "ACTIVE" | "DEAD";

export type RouteFailureCode =
  | "ROUTE_TOO_SHORT"
  | "START_OUTSIDE_BASE"
  | "ROUTE_OBSTRUCTED"
  | "SEGMENT_TOO_LONG"
  | "VERTICAL_STEP_EXCEEDED"
  | "SLOPE_EXCEEDED"
  | "CLIMB_UNPROTECTED"
  | "ACTION_INDEX_INVALID"
  | "ACTION_POSITION_MISMATCH"
  | "RECOVERY_MUST_RETURN"
  | "UNSAFE_TERMINAL"
  | "OUTSIDE_TERRAIN"
  | "TERRAIN_MISMATCH"
  | "OXYGEN_EXHAUSTED"
  | "ENERGY_BUDGET_EXCEEDED";

export interface RouteVerdict {
  valid: boolean;
  code: "ROUTE_VALID" | RouteFailureCode;
  outcome: IdentityOutcome;
  energyKj: number;
  elapsedSeconds: number;
  distanceM: number;
  loadedDistanceM: number;
  oxygenUsed: number;
  oxygenRemaining: number;
  terminalDistanceFromBaseM: number;
}

export interface IdentityState {
  id: string;
  status: IdentityOutcome;
}

export interface CandidateCommit {
  protocol: string;
  id: string;
  parentWorldHash: string;
  terrainHash: string;
  agentId: string;
  proof: ExpeditionProof;
}

export interface TombstoneState {
  id: string;
  agentId: string;
  expeditionId: string;
  position: Vec3;
  altitudeM: number;
  oxygenUsed: number;
}

export interface ExpeditionRecord {
  id: string;
  agentId: string;
  action: StoneMutation["kind"];
  outcome: IdentityOutcome;
  altitudeM: number;
  oxygenUsed: number;
  energyKj: number;
  score: number;
}

export interface CanonicalWorld extends PhysicsSnapshot {
  terrainHash: string;
  baseCamp: Vec3;
  extractionZones: Vec3[];
  identities: IdentityState[];
  tombstones: TombstoneState[];
  expeditions: ExpeditionRecord[];
}

export interface CommitVerdict {
  accepted: boolean;
  code:
    | "ACCEPTED"
    | "CANDIDATE_ALREADY_APPLIED"
    | "IDENTITY_DEAD"
    | "ROUTE_INVALID"
    | "PHYSICS_INVALID"
    | "STALE_CONFLICT";
  canonicalParent: string;
  revalidatedAgainstHead: boolean;
  route: RouteVerdict | null;
  physics: PhysicsVerdict | null;
  nextIdentityStatus: IdentityOutcome | null;
  score: number | null;
}

export const IDENTITY_QUATERNION: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
