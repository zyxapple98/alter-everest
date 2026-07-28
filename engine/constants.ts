import playerRules from "../protocol/player-rules.json";

export const CANDIDATE_LIMITS = playerRules.candidate;

export const PHYSICS = playerRules.physics;

export const CLIMBER = {
  bodyMassKg: playerRules.climber.bodyMassKg,
  clearanceRadiusM: playerRules.climber.clearanceRadiusM,
  clearanceHeightM: playerRules.climber.clearanceHeightM,
  baseCampRadiusM: playerRules.lifecycle.baseCampRadiusM,
  baseCampMaximumHeightFromNaturalSurfaceM:
    playerRules.lifecycle.baseCampMaximumHeightFromNaturalSurfaceM,
  protectedSpawnRadiusM: playerRules.lifecycle.protectedSpawnRadiusM,
  maximumInteractionHorizontalReachM:
    playerRules.climber.maximumInteractionHorizontalReachM,
  minimumInteractionHeightM:
    playerRules.climber.minimumInteractionHeightM,
  maximumInteractionHeightM:
    playerRules.climber.maximumInteractionHeightM,
  interactionVisibilitySampleM:
    playerRules.climber.interactionVisibilitySampleM,
  carriedLoadSlopePenaltyDegrees:
    playerRules.climber.carriedLoadSlopePenaltyDegrees,
  surfaceSlopePenaltyDegrees:
    playerRules.climber.surfaceSlopePenaltyDegrees,
  maxWalkStepM: playerRules.climber.locomotion.WALK.maximumStepM,
  maxScrambleStepM:
    playerRules.climber.locomotion.SCRAMBLE.maximumStepM,
  maxClimbStepM: playerRules.climber.locomotion.CLIMB.maximumStepM,
  maxWalkSlopeDegrees:
    playerRules.climber.locomotion.WALK.maximumSlopeDegrees,
  maxScrambleSlopeDegrees:
    playerRules.climber.locomotion.SCRAMBLE.maximumSlopeDegrees,
  maxClimbSlopeDegrees:
    playerRules.climber.locomotion.CLIMB.maximumSlopeDegrees,
  walkSpeedMps: playerRules.climber.locomotion.WALK.speedMps,
  walkStepSpeedMps:
    playerRules.climber.locomotion.WALK.stepSpeedMps,
  scrambleSpeedMps:
    playerRules.climber.locomotion.SCRAMBLE.speedMps,
  climbSpeedMps: playerRules.climber.locomotion.CLIMB.speedMps,
  enduranceCapacity: playerRules.climber.endurance.capacity,
  kilojoulesPerEndurance:
    playerRules.climber.endurance.kilojoulesPerUnit,
} as const;

export const ENDURANCE_MODEL = playerRules.climber.endurance;

export const TERRAIN = playerRules.terrain;

export const ROUTE = playerRules.route;
