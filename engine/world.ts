import type {
  CandidateCommit,
  CanonicalWorld,
  CommitVerdict,
  ExpeditionRecord,
  TombstoneState,
} from "./types";

function hex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function nextWorldHash(world: CanonicalWorld) {
  const canonical = JSON.stringify({
    sequence: world.sequence,
    terrainHash: world.terrainHash,
    stones: world.stones,
    identities: world.identities,
    tombstones: world.tombstones,
    expeditions: world.expeditions,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return hex(new Uint8Array(digest));
}

export async function applyAcceptedCandidate(
  candidate: CandidateCommit,
  currentWorld: CanonicalWorld,
  verdict: CommitVerdict,
): Promise<CanonicalWorld> {
  if (
    !verdict.accepted ||
    !verdict.route ||
    !verdict.physics ||
    !verdict.nextIdentityStatus ||
    verdict.score === null
  ) {
    throw new Error("Only an accepted, fully evaluated candidate can be applied.");
  }

  const terminal = candidate.proof.route.at(-1)!;
  const identities = currentWorld.identities.filter(
    (identity) => identity.id !== candidate.agentId,
  );
  identities.push({
    id: candidate.agentId,
    status: verdict.nextIdentityStatus,
  });
  identities.sort((a, b) => a.id.localeCompare(b.id));

  const tombstones = [...currentWorld.tombstones];
  if (verdict.nextIdentityStatus === "DEAD") {
    const tombstone: TombstoneState = {
      id: `tombstone-${candidate.id}`,
      agentId: candidate.agentId,
      expeditionId: candidate.id,
      position: { x: terminal.x, y: terminal.y, z: terminal.z },
      altitudeM: terminal.altitudeM,
      oxygenUsed: verdict.route.oxygenUsed,
    };
    tombstones.push(tombstone);
  }

  const actionIndex =
    candidate.proof.mutation.kind === "RECOVER"
      ? candidate.proof.pickupIndex!
      : candidate.proof.releaseIndex!;
  const actionSample = candidate.proof.route[actionIndex];
  const record: ExpeditionRecord = {
    id: candidate.id,
    agentId: candidate.agentId,
    action: candidate.proof.mutation.kind,
    outcome: verdict.nextIdentityStatus,
    altitudeM: actionSample.altitudeM,
    oxygenUsed: verdict.route.oxygenUsed,
    energyKj: verdict.route.energyKj,
    score: verdict.score,
  };

  const next: CanonicalWorld = {
    ...currentWorld,
    sequence: currentWorld.sequence + 1,
    stones: verdict.physics.finalStones,
    identities,
    tombstones,
    expeditions: [...currentWorld.expeditions, record],
    worldHash: "",
  };
  next.worldHash = await nextWorldHash(next);
  return next;
}
