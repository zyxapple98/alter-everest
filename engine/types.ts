export type Vec3 = Readonly<{ x: number; y: number; z: number }>;

export interface VoxelCoordinate {
  x: number;
  y: number;
  z: number;
}

export interface StoneState {
  id: string;
  cell: VoxelCoordinate;
}

export interface PhysicsSnapshot {
  worldHash: string;
  stones: StoneState[];
  removedTerrainVoxels: VoxelCoordinate[];
}

export type MatterSource =
  | { kind: "BASE" }
  | { kind: "STONE"; stoneId: string }
  | { kind: "TERRAIN"; voxel: VoxelCoordinate };

export type MatterDestination =
  | { kind: "BASE" }
  | { kind: "WORLD"; cell: VoxelCoordinate };

export interface MatterMutation {
  kind: "RELOCATE";
  matterId: string;
  source: MatterSource;
  destination: MatterDestination;
}

export type LegacyActionKind = "ADD" | "MOVE" | "RECOVER";
export type MutationOperation = LegacyActionKind | "QUARRY";

export type PhysicsFailureCode =
  | "STONE_ALREADY_EXISTS"
  | "STONE_NOT_FOUND"
  | "TERRAIN_VOXEL_NOT_EXPOSED"
  | "NO_STATE_CHANGE"
  | "SPAWN_CORE_PROTECTED"
  | "DESTINATION_OCCUPIED"
  | "DESTINATION_HAS_NO_FACE_CONTACT"
  | "STONE_UNANCHORED"
  | "STONE_IMBALANCED"
  | "STONE_SPAN_EXCEEDED"
  | "STONE_COMPRESSION_EXCEEDED"
  | "STONE_LATERAL_OVERTURNING"
  | "TUNNEL_ROOF_TOO_THIN"
  | "TUNNEL_RADIUS_EXCEEDED"
  | "AFFECTED_STONES_TOO_LARGE"
  | "STRUCTURE_TOO_TALL_FOR_FULL_RECHECK"
  | "CAVITY_WINDOW_TOO_LARGE"
  | "TOO_MANY_CHUNKS_TOUCHED"
  | "TERRAIN_CONTEXT_MISSING"
  | "WORLD_BOUNDS_EXCEEDED";

export interface PhysicsVerdict {
  valid: boolean;
  code: "STABLE" | PhysicsFailureCode;
  finalStones: StoneState[];
  affectedStoneIds: string[];
  evaluatedStoneCells: number;
  cavityCellsChecked: number;
  contactModel: "VOXEL_STATIC_V2_1";
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
  mutation: MatterMutation;
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
  | "SPAWN_CORE_PROTECTED"
  | "BASE_IMPORT_INSIDE_CAMP"
  | "BASE_DELIVERY_MUST_RETURN"
  | "UNSAFE_TERMINAL"
  | "OUTSIDE_TERRAIN"
  | "TERRAIN_MISMATCH"
  | "ENDURANCE_EXHAUSTED";

export interface RouteVerdict {
  valid: boolean;
  code: "ROUTE_VALID" | RouteFailureCode;
  outcome: IdentityOutcome;
  enduranceUsed: number;
  enduranceRemaining: number;
  energyKj: number;
  elapsedSeconds: number;
  distanceM: number;
  loadedDistanceM: number;
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
  enduranceUsed: number;
}

export interface ExpeditionRecord {
  id: string;
  agentId: string;
  action: MutationOperation;
  outcome: IdentityOutcome;
  altitudeM: number;
  enduranceUsed?: number;
  oxygenUsed?: number;
  energyKj: number;
  score: number;
}

export interface ModifiedChunkState {
  id: string;
  x: number;
  z: number;
  removedTerrainVoxels: VoxelCoordinate[];
  stoneIds: string[];
  hash: string;
}

export interface ModifiedTileState {
  id: string;
  x: number;
  z: number;
  chunkHashes: string[];
  hash: string;
}

export interface CanonicalWorld extends PhysicsSnapshot {
  sequence: number;
  terrainHash: string;
  baseCamp: Vec3;
  extractionZones: Vec3[];
  modifiedChunks: ModifiedChunkState[];
  modifiedTiles: ModifiedTileState[];
  identities: IdentityState[];
  tombstones: TombstoneState[];
  expeditions: ExpeditionRecord[];
}

export interface CanonicalExpeditionEvent {
  eventVersion: "1.0.0";
  sequence: number;
  eventHash: string;
  candidateId: string;
  candidateHash: string;
  agentId: string;
  parentWorldHash: string;
  worldHash: string;
  terrainHash: string;
  engineHash: string;
  action: MutationOperation;
  stoneId: string;
  outcome: IdentityOutcome;
  altitudeM: number;
  enduranceUsed?: number;
  oxygenUsed?: number;
  energyKj: number;
  score: number;
  proofArtifact: string;
  traceArtifact: string | null;
  receiptKeyId: string | null;
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
