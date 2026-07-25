export interface RenderBudgetState {
  visible: boolean;
  highMotion: boolean;
  reducedMotion: boolean;
}

const ACTIVE_FPS = 60;
const AMBIENT_FPS = 24;
const REDUCED_ACTIVE_FPS = 24;
const REDUCED_AMBIENT_FPS = 12;
const HIDDEN_FPS = 2;

export function renderIntervalMs(state: RenderBudgetState) {
  const fps = !state.visible
    ? HIDDEN_FPS
    : state.reducedMotion
      ? state.highMotion
        ? REDUCED_ACTIVE_FPS
        : REDUCED_AMBIENT_FPS
      : state.highMotion
        ? ACTIVE_FPS
        : AMBIENT_FPS;
  return 1000 / fps;
}
