import assert from "node:assert/strict";
import test from "node:test";
import { agentIdentityStyle } from "../lib/agent-identity";

test("agent appearance is stable and case-insensitive", () => {
  assert.deepEqual(
    agentIdentityStyle("AlterEverest"),
    agentIdentityStyle("  altereverest  "),
  );
  assert.match(agentIdentityStyle("AlterEverest").color, /^#[0-9a-f]{6}$/);
});

test("many agents receive a broad range of recognizable styles", () => {
  const styles = Array.from({ length: 100 }, (_, index) =>
    agentIdentityStyle(`climber-${index}`),
  );
  assert.ok(new Set(styles.map(({ color }) => color)).size >= 90);
  assert.deepEqual(
    [...new Set(styles.map(({ variant }) => variant))].sort(),
    [0, 1, 2, 3],
  );
});
