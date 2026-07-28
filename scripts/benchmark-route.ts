import { performance } from "node:perf_hooks";
import { CANDIDATE_LIMITS } from "../engine/constants";
import {
  iterateRouteTransitions,
  validateRouteProgram,
} from "../engine/route-codec";
import type { ExactRoute } from "../engine/types";

function unsigned(value: number) {
  const bytes: number[] = [];
  let remaining = value;
  do {
    const low = remaining % 128;
    remaining = Math.floor(remaining / 128);
    bytes.push(low | (remaining > 0 ? 0x80 : 0));
  } while (remaining > 0);
  return bytes;
}

function measured<T>(operation: () => T) {
  const before = process.memoryUsage().heapUsed;
  let peak = before;
  const started = performance.now();
  const value = operation();
  peak = Math.max(peak, process.memoryUsage().heapUsed);
  return {
    value,
    elapsedMs: performance.now() - started,
    heapGrowthBytes: peak - before,
  };
}

const maximumSteps = CANDIDATE_LIMITS.maximumDecodedRouteSteps;
const maximumRoute: ExactRoute = {
  codec: "ae-microtrace-v2",
  start: { x: 0, y: 1, z: 0 },
  stepCount: maximumSteps,
  // RUN, east/dy=0 movement opcode, canonical ULEB128 count.
  program: Buffer.from([136, 68, ...unsigned(maximumSteps)]).toString(
    "base64url",
  ),
};

const maximumDecode = measured(() => {
  let count = 0;
  let terminalX = maximumRoute.start.x;
  for (const transition of iterateRouteTransitions(maximumRoute, {
    maximumSteps,
    requireCanonical: true,
  })) {
    count += 1;
    terminalX = transition.to.cell.x;
  }
  return { count, terminalX };
});

const nearLimitBytes = Math.floor(
  (CANDIDATE_LIMITS.maximumBytes - 1024) * 0.75,
);
const alternatingBytes = Uint8Array.from(
  { length: nearLimitBytes },
  (_, index) => (index % 2 === 0 ? 68 : 67),
);
const nearLimitRoute: ExactRoute = {
  codec: "ae-microtrace-v2",
  start: { x: 0, y: 1, z: 0 },
  stepCount: alternatingBytes.length,
  program: Buffer.from(alternatingBytes).toString("base64url"),
};
const nearLimitCandidate = {
  protocol: "0.8.0",
  id: "route-benchmark",
  parentWorldHash: "benchmark",
  terrainHash: "a".repeat(64),
  agentId: "benchmark",
  proof: {
    route: nearLimitRoute,
    actions: [
      {
        kind: "RELOCATE",
        matterId: "benchmark-stone",
        source: { kind: "BASE" },
        destination: {
          kind: "WORLD",
          cell: { x: 1, y: 1, z: 1 },
        },
        pickupStep: 0,
        releaseStep: 1,
      },
    ],
  },
};
const nearLimitCandidateBytes = Buffer.byteLength(
  JSON.stringify(nearLimitCandidate),
);
const nearLimitScan = measured(() =>
  validateRouteProgram(nearLimitRoute, {
    maximumSteps,
    requireCanonical: true,
  }),
);

let malformedRejected = false;
try {
  validateRouteProgram(
    {
      ...maximumRoute,
      stepCount: 3,
      program: Buffer.from([136, 68, 0x83, 0]).toString("base64url"),
    },
    { maximumSteps, requireCanonical: true },
  );
} catch {
  malformedRejected = true;
}

const report = {
  target: {
    maximumVerifierMs: 4_000,
    maximumMemoryBytes: 256 * 1024 * 1024,
    maximumCandidateBytes: CANDIDATE_LIMITS.maximumBytes,
    maximumDecodedSteps: maximumSteps,
  },
  maximumDecode: {
    steps: maximumDecode.value.count,
    programBytes: Buffer.from(
      maximumRoute.program,
      "base64url",
    ).byteLength,
    elapsedMs: Number(maximumDecode.elapsedMs.toFixed(3)),
    heapGrowthBytes: maximumDecode.heapGrowthBytes,
  },
  nearAdmissionLimit: {
    decodedSteps: nearLimitScan.value.decodedSteps,
    programBytes: nearLimitScan.value.programBytes,
    candidateBytes: nearLimitCandidateBytes,
    elapsedMs: Number(nearLimitScan.elapsedMs.toFixed(3)),
    heapGrowthBytes: nearLimitScan.heapGrowthBytes,
  },
  malformedRepeatRejected: malformedRejected,
};

if (
  maximumDecode.value.count !== maximumSteps ||
  maximumDecode.value.terminalX !== maximumSteps ||
  !malformedRejected ||
  nearLimitCandidateBytes > CANDIDATE_LIMITS.maximumBytes ||
  nearLimitCandidateBytes <
    CANDIDATE_LIMITS.maximumBytes * 0.98 ||
  maximumDecode.elapsedMs > report.target.maximumVerifierMs ||
  nearLimitScan.elapsedMs > report.target.maximumVerifierMs ||
  maximumDecode.heapGrowthBytes > report.target.maximumMemoryBytes ||
  nearLimitScan.heapGrowthBytes > report.target.maximumMemoryBytes
) {
  throw new Error(`Route benchmark failed:\n${JSON.stringify(report, null, 2)}`);
}

console.log(JSON.stringify(report, null, 2));
