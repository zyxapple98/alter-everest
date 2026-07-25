export interface ReplayActionWindow {
  pickupFraction: number;
  releaseFraction: number;
}

export type ReplayActionPhase =
  | "approaching"
  | "carrying"
  | "placing"
  | "complete";

export interface ReplayActionState {
  index: number;
  completed: number;
  phase: ReplayActionPhase;
}

export interface AgentVisualLod {
  physicalOpacity: number;
  physicalScale: number;
  signalOpacity: number;
  signalPixels: number;
  actionMarkerM: number;
  breadcrumbOpacity: number;
}

export interface ReplayDistanceKeyframe {
  progress: number;
  distanceM: number;
}

export interface ReplayTimelineSegment {
  startedAtSeconds: number;
  endedAtSeconds: number;
  startProgress: number;
  endProgress: number;
  moving: boolean;
  holdKind: "pickup" | "release" | null;
  actionIndex: number | null;
}

export interface ReplayTimeline {
  startProgress: number;
  endProgress: number;
  totalSeconds: number;
  segments: ReplayTimelineSegment[];
}

export interface ReplayTimelineSample {
  progress: number;
  moving: boolean;
  holdKind: "pickup" | "release" | null;
  actionIndex: number | null;
  segmentProgress: number;
  ended: boolean;
}

export type ReplayMatterPhase =
  | "waiting"
  | "picking-up"
  | "carrying"
  | "placing"
  | "placed";

export interface ReplayMatterState {
  phase: ReplayMatterPhase;
  phaseProgress: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(minimum: number, maximum: number, value: number) {
  const t = clamp(
    (value - minimum) / Math.max(0.000_001, maximum - minimum),
    0,
    1,
  );
  return t * t * (3 - 2 * t);
}

function distanceAtProgress(
  keyframes: ReplayDistanceKeyframe[],
  progress: number,
) {
  const safeProgress = clamp(progress, 0, 1);
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const start = keyframes[index];
    const end = keyframes[index + 1];
    if (safeProgress <= end.progress) {
      const mix = clamp(
        (safeProgress - start.progress) /
          Math.max(0.000_001, end.progress - start.progress),
        0,
        1,
      );
      return start.distanceM + (end.distanceM - start.distanceM) * mix;
    }
  }
  return keyframes.at(-1)?.distanceM ?? 0;
}

/**
 * Builds a real-time replay: route movement uses an ordinary walking pace,
 * while pickup and release are explicit human-scale pauses.
 */
export function createNormalReplayTimeline(
  keyframes: ReplayDistanceKeyframe[],
  actions: ReplayActionWindow[],
  range: { startProgress?: number; endProgress?: number } = {},
): ReplayTimeline {
  const startProgress = clamp(range.startProgress ?? 0, 0, 1);
  const endProgress = clamp(
    range.endProgress ?? 1,
    startProgress,
    1,
  );
  const events = actions
    .flatMap((action, actionIndex) => [
      {
        progress: action.pickupFraction,
        kind: "pickup" as const,
        actionIndex,
        holdSeconds: 1.5,
      },
      {
        progress: action.releaseFraction,
        kind: "release" as const,
        actionIndex,
        holdSeconds: 1.7,
      },
    ])
    .filter(
      ({ progress }) =>
        progress >= startProgress && progress <= endProgress,
    )
    .sort(
      (left, right) =>
        left.progress - right.progress ||
        (left.kind === "pickup" ? -1 : 1),
    );
  const segments: ReplayTimelineSegment[] = [];
  let routeCursor = startProgress;
  let timeCursor = 0;
  const walkingSpeedMps = 1.25;

  const addMovement = (toProgress: number) => {
    const distanceM = Math.max(
      0,
      distanceAtProgress(keyframes, toProgress) -
        distanceAtProgress(keyframes, routeCursor),
    );
    const duration = distanceM / walkingSpeedMps;
    if (duration > 0.000_1) {
      segments.push({
        startedAtSeconds: timeCursor,
        endedAtSeconds: timeCursor + duration,
        startProgress: routeCursor,
        endProgress: toProgress,
        moving: true,
        holdKind: null,
        actionIndex: null,
      });
      timeCursor += duration;
    }
    routeCursor = toProgress;
  };

  for (const event of events) {
    addMovement(event.progress);
    segments.push({
      startedAtSeconds: timeCursor,
      endedAtSeconds: timeCursor + event.holdSeconds,
      startProgress: event.progress,
      endProgress: event.progress,
      moving: false,
      holdKind: event.kind,
      actionIndex: event.actionIndex,
    });
    timeCursor += event.holdSeconds;
  }
  addMovement(endProgress);

  return {
    startProgress,
    endProgress,
    totalSeconds: Math.max(0.001, timeCursor),
    segments,
  };
}

export function sampleReplayTimeline(
  timeline: ReplayTimeline,
  elapsedSeconds: number,
): ReplayTimelineSample {
  const elapsed = Math.max(0, elapsedSeconds);
  const segment =
    timeline.segments.find(
      ({ endedAtSeconds }) => elapsed < endedAtSeconds,
    ) ?? timeline.segments.at(-1);
  if (!segment || elapsed >= timeline.totalSeconds) {
    return {
      progress: timeline.endProgress,
      moving: false,
      holdKind: null,
      actionIndex: null,
      segmentProgress: 1,
      ended: true,
    };
  }
  const segmentProgress = clamp(
    (elapsed - segment.startedAtSeconds) /
      Math.max(
        0.000_001,
        segment.endedAtSeconds - segment.startedAtSeconds,
      ),
    0,
    1,
  );
  return {
    progress:
      segment.startProgress +
      (segment.endProgress - segment.startProgress) * segmentProgress,
    moving: segment.moving,
    holdKind: segment.holdKind,
    actionIndex: segment.actionIndex,
    segmentProgress,
    ended: false,
  };
}

/**
 * Resolves a single action's material state from timeline time rather than
 * route progress. Holds do not advance route progress, so progress alone
 * cannot distinguish the frame before a release from the frame after it.
 */
export function sampleActionMatterState(
  timeline: ReplayTimeline,
  elapsedSeconds: number,
  action: ReplayActionWindow,
  actionIndex: number,
): ReplayMatterState {
  const elapsed = Math.max(0, elapsedSeconds);
  const pickup = timeline.segments.find(
    (segment) =>
      segment.actionIndex === actionIndex &&
      segment.holdKind === "pickup",
  );
  const release = timeline.segments.find(
    (segment) =>
      segment.actionIndex === actionIndex &&
      segment.holdKind === "release",
  );
  const segmentProgress = (segment: ReplayTimelineSegment) =>
    clamp(
      (elapsed - segment.startedAtSeconds) /
        Math.max(
          0.000_001,
          segment.endedAtSeconds - segment.startedAtSeconds,
        ),
      0,
      1,
    );

  if (action.releaseFraction < timeline.startProgress - 0.000_001) {
    return { phase: "placed", phaseProgress: 1 };
  }
  if (release && elapsed >= release.endedAtSeconds) {
    return { phase: "placed", phaseProgress: 1 };
  }
  if (release && elapsed >= release.startedAtSeconds) {
    return {
      phase: "placing",
      phaseProgress: segmentProgress(release),
    };
  }
  if (
    action.pickupFraction < timeline.startProgress - 0.000_001 &&
    action.releaseFraction >= timeline.startProgress - 0.000_001
  ) {
    return { phase: "carrying", phaseProgress: 1 };
  }
  if (pickup && elapsed >= pickup.endedAtSeconds) {
    return { phase: "carrying", phaseProgress: 1 };
  }
  if (pickup && elapsed >= pickup.startedAtSeconds) {
    return {
      phase: "picking-up",
      phaseProgress: segmentProgress(pickup),
    };
  }
  return { phase: "waiting", phaseProgress: 0 };
}

export function replayActionState(
  progress: number,
  actions: ReplayActionWindow[],
): ReplayActionState | null {
  if (actions.length === 0) return null;
  const routeProgress = clamp(progress, 0, 1);
  const completed = actions.filter(
    (action) => routeProgress > action.releaseFraction + 0.002,
  ).length;
  const index = Math.min(completed, actions.length - 1);
  const action = actions[index];
  const releaseDistance = Math.abs(
    routeProgress - action.releaseFraction,
  );
  const phase: ReplayActionPhase =
    completed >= actions.length
      ? "complete"
      : routeProgress < action.pickupFraction
        ? "approaching"
        : routeProgress < action.releaseFraction - 0.002
          ? "carrying"
          : releaseDistance <= 0.012
            ? "placing"
            : "complete";
  return { index, completed, phase };
}

/**
 * A physical climber is used at work scale. It cross-fades into a
 * camera-facing, constant-pixel signal for regional and mountain views.
 */
export function agentVisualLod(distanceM: number): AgentVisualLod {
  const distance = Math.max(0, distanceM);
  const signalMix = smoothstep(95, 310, distance);
  return {
    physicalOpacity: 1 - signalMix,
    physicalScale: 1 + smoothstep(70, 260, distance) * 0.55,
    signalOpacity: signalMix,
    signalPixels: 18 + smoothstep(250, 4_000, distance) * 8,
    actionMarkerM: clamp(distance * 0.006, 0.24, 3.2),
    breadcrumbOpacity: smoothstep(300, 1_200, distance),
  };
}
