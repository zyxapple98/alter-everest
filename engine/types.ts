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
  | { kind: "STONE" }
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

export interface ExpeditionAction extends MatterMutation {
  pickupStep: number;
  releaseStep: number;
}

export type MatterOperation = "ADD" | "MOVE" | "RECOVER" | "QUARRY";
export type MutationOperation = MatterOperation;
export type ExpeditionOperation = MutationOperation | "MULTI";

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
  | "EXPEDITION_PHYSICS_BUDGET_EXCEEDED"
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
export type SupportKind = "NATURAL" | "STONE";

export interface MicroMovement {
  dx: number;
  dy: number;
  dz: number;
}

export interface RouteStance {
  step: number;
  cell: VoxelCoordinate;
}

export interface ExactRoute {
  codec: "ae-microtrace-v2";
  start: VoxelCoordinate;
  stepCount: number;
  program: string;
  acceptOneWayDeath?: boolean;
}

// Derived verifier state. These fields are never candidate-supplied claims.
export interface RouteSample extends Vec3 {
  step: number;
  cell: VoxelCoordinate;
  altitudeM: number;
  slopeDegrees: number;
  surface: SurfaceKind;
  supportKind: SupportKind;
}

export interface ExpeditionProof {
  route: ExactRoute;
  actions: ExpeditionAction[];
}

export type IdentityOutcome = "ACTIVE" | "DEAD";

export type RouteFailureCode =
  | "ROUTE_PROGRAM_INVALID"
  | "ROUTE_UNSUPPORTED"
  | "START_OUTSIDE_BASE"
  | "ROUTE_OBSTRUCTED"
  | "VERTICAL_STEP_EXCEEDED"
  | "SLOPE_EXCEEDED"
  | "ACTION_INDEX_INVALID"
  | "ACTION_POSITION_MISMATCH"
  | "ACTION_OCCLUDED"
  | "ROUTE_NEVER_LEFT_BASE"
  | "BASE_REDEPARTURE_FORBIDDEN"
  | "ACTION_AFTER_BASE_RETURN"
  | "BASE_WITHDRAWAL_LIMIT_EXCEEDED"
  | "BASE_PICKUP_AFTER_DEPARTURE"
  | "SPAWN_CORE_PROTECTED"
  | "BASE_IMPORT_INSIDE_CAMP"
  | "BASE_PICKUP_OUTSIDE_CAMP"
  | "BASE_RELEASE_OUTSIDE_CAMP"
  | "UNSAFE_TERMINAL"
  | "OUTSIDE_TERRAIN"
  | "ENDURANCE_EXHAUSTED";

export interface RouteVerdict {
  valid: boolean;
  code: "ROUTE_VALID" | RouteFailureCode;
  failureStep: number | null;
  obstacle: string | null;
  outcome: IdentityOutcome;
  enduranceUsed: number;
  enduranceRemaining: number;
  energyKj: number;
  elapsedSeconds: number;
  distanceM: number;
  distanceMillimeters: number;
  loadedDistanceM: number;
  terminalDistanceFromBaseM: number;
  maximumAltitudeM: number;
  terminalAltitudeM: number;
}

export interface IdentityState {
  id: string;
  status: IdentityOutcome;
}

export interface TerrainRemovalFact {
  cell: VoxelCoordinate;
  agentId: string;
  expeditionId: string;
}

export interface StonePlacementFact {
  stoneId: string;
  cell: VoxelCoordinate;
  agentId: string;
  expeditionId: string;
}

export interface IdentityFootprint {
  agentId: string;
  acceptedExpeditions: number;
  totalDistanceMillimeters: number;
  activeTerrainRemovals: number;
  activeStonePlacements: number;
  activeAlterations: number;
}

export interface AlterationState {
  terrainRemovals: TerrainRemovalFact[];
  stonePlacements: StonePlacementFact[];
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
  action: ExpeditionOperation;
  actions: MutationOperation[];
  actionCount: number;
  outcome: IdentityOutcome;
  altitudeM: number;
  enduranceUsed: number;
  energyKj: number;
  distanceMillimeters: number;
  alterationDelta: FootprintDelta;
}

export interface FootprintDelta {
  terrainRemovalsCreated: number;
  stonePlacementsCreated: number;
  stonePlacementsRemoved: number;
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
  alterations: AlterationState;
  footprints: IdentityFootprint[];
}

export interface CanonicalExpeditionEvent {
  eventVersion: "1.2.0";
  sequence: number;
  eventHash: string;
  candidateId: string;
  candidateHash: string;
  agentId: string;
  parentWorldHash: string;
  worldHash: string;
  terrainHash: string;
  engineHash: string;
  action: ExpeditionOperation;
  actions: MutationOperation[];
  actionCount: number;
  stoneIds: string[];
  outcome: IdentityOutcome;
  altitudeM: number;
  enduranceUsed: number;
  energyKj: number;
  distanceMillimeters: number;
  alterationDelta: FootprintDelta;
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
  footprintDelta: FootprintDelta | null;
  failureContext?: {
    stage:
      | "ROUTE"
      | "PICKUP_PHYSICS"
      | "RELEASE_PHYSICS"
      | "SERVICE_LOAD"
      | "FINAL_STATE";
    actionIndex: number | null;
    step: number | null;
  } | null;
}
