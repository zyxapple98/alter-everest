import {
  kathmanduLocalHour,
  type AtmospherePalette,
} from "./atmosphere";

export type SkyPhase = "night" | "dawn" | "day" | "dusk";

export interface SkyPhasePalette {
  fog: string;
  exposure: number;
  terrainTint: string;
  atmosphere: AtmospherePalette;
}

export const SKY_PHASES: Record<SkyPhase, SkyPhasePalette> = {
  night: {
    fog: "#3d6073",
    exposure: 1.2,
    terrainTint: "#edf4f5",
    atmosphere: {
      top: "#0b1b2a",
      middle: "#234159",
      horizon: "#3d6073",
      nadir: "#17242d",
      celestial: "#d9edf5",
      celestialGlow: "#8cc7e4",
      celestialRadiusRadians: 0.011,
      starOpacity: 0.58,
    },
  },
  dawn: {
    fog: "#78909c",
    exposure: 1.08,
    terrainTint: "#f3e6d9",
    atmosphere: {
      top: "#1a3850",
      middle: "#5b788b",
      horizon: "#78909c",
      nadir: "#263238",
      celestial: "#ffd69a",
      celestialGlow: "#f0a06b",
      celestialRadiusRadians: 0.013,
      starOpacity: 0.03,
    },
  },
  day: {
    fog: "#66869a",
    exposure: 0.98,
    terrainTint: "#fff4e7",
    atmosphere: {
      top: "#31586f",
      middle: "#6c91a4",
      horizon: "#66869a",
      nadir: "#273033",
      celestial: "#fff3c9",
      celestialGlow: "#ffe5a1",
      celestialRadiusRadians: 0.013,
      starOpacity: 0,
    },
  },
  dusk: {
    fog: "#5f7380",
    exposure: 1.06,
    terrainTint: "#eadbd2",
    atmosphere: {
      top: "#15283a",
      middle: "#425971",
      horizon: "#5f7380",
      nadir: "#202a31",
      celestial: "#ffc86b",
      celestialGlow: "#e68c5c",
      celestialRadiusRadians: 0.013,
      starOpacity: 0.08,
    },
  },
};

const DAWN_START_HOUR = 5;
const DAY_START_HOUR = 6.5;
const DUSK_START_HOUR = 17.5;
const NIGHT_START_HOUR = 19.5;

export function kathmanduSkyPhase(date = new Date()): SkyPhase {
  const hour = kathmanduLocalHour(date);
  if (hour < DAWN_START_HOUR || hour >= NIGHT_START_HOUR) {
    return "night";
  }
  if (hour < DAY_START_HOUR) return "dawn";
  if (hour < DUSK_START_HOUR) return "day";
  return "dusk";
}
