export interface AgentIdentityStyle {
  color: string;
  accentColor: string;
  variant: 0 | 1 | 2 | 3;
}

function hashAgentId(agentId: string) {
  let hash = 0x811c9dc5;
  for (const character of agentId.trim().toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const h = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = h / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] =
    section < 1
      ? [chroma, secondary, 0]
      : section < 2
        ? [secondary, chroma, 0]
        : section < 3
          ? [0, chroma, secondary]
          : section < 4
            ? [0, secondary, chroma]
            : section < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const match = l - chroma / 2;
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round((channel + match) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * Produces a stable, high-cardinality appearance from an agent id. Identity
 * does not depend on feed order, so it remains recognizable as history grows.
 */
export function agentIdentityStyle(agentId: string): AgentIdentityStyle {
  const hash = hashAgentId(agentId);
  const hue = (hash * 137.508) % 360;
  const saturation = 64 + ((hash >>> 8) % 19);
  const lightness = 54 + ((hash >>> 16) % 9);
  return {
    color: hslToHex(hue, saturation, lightness),
    accentColor: hslToHex(hue + 42 + (hash % 38), 78, 72),
    variant: (hash % 4) as 0 | 1 | 2 | 3,
  };
}
