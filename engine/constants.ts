import playerRules from "../protocol/player-rules.json";

export const CANDIDATE_LIMITS = playerRules.candidate;

export const PHYSICS = playerRules.physics;

export const CLIMBER = {
  bodyMassKg: playerRules.climber.bodyMassKg,
  clearanceRadiusM: playerRules.climber.clearanceRadiusM,
  clearanceHeightM: playerRules.climber.clearanceHeightM,
  baseCampRadiusM: playerRules.lifecycle.baseCampRadiusM,
  protectedSpawnRadiusM: playerRules.lifecycle.protectedSpawnRadiusM,
  interactionReachM: playerRules.climber.interactionReachM,
  maxWalkStepM: playerRules.climber.maximumWalkStepM,
  maxWalkSlopeDegrees:
    playerRules.climber.locomotion.WALK.maximumSlopeDegrees,
  maxLoadedWalkSlopeDegrees:
    playerRules.climber.locomotion.WALK.maximumLoadedSlopeDegrees,
  maxScrambleSlopeDegrees:
    playerRules.climber.locomotion.SCRAMBLE.maximumSlopeDegrees,
  maxLoadedScrambleSlopeDegrees:
    playerRules.climber.locomotion.SCRAMBLE.maximumLoadedSlopeDegrees,
  maxClimbSlopeDegrees:
    playerRules.climber.locomotion.CLIMB.maximumSlopeDegrees,
  walkSpeedMps: playerRules.climber.locomotion.WALK.speedMps,
  scrambleSpeedMps:
    playerRules.climber.locomotion.SCRAMBLE.speedMps,
  climbSpeedMps: playerRules.climber.locomotion.CLIMB.speedMps,
  enduranceCapacity: playerRules.climber.endurance.capacity,
  kilojoulesPerEndurance:
    playerRules.climber.endurance.kilojoulesPerUnit,
  rockTerrainFactor:
    playerRules.climber.endurance.terrainFactors.ROCK,
  snowTerrainFactor:
    playerRules.climber.endurance.terrainFactors.SNOW,
  iceTerrainFactor:
    playerRules.climber.endurance.terrainFactors.ICE,
} as const;

export const ENDURANCE_MODEL = playerRules.climber.endurance;

export const LOCOMOTION = playerRules.climber.locomotion;

export const TERRAIN = playerRules.terrain;

export const ROUTE = playerRules.route;
