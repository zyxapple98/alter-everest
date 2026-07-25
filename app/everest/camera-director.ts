export interface CameraDirectorPoint {
  x: number;
  y: number;
  z: number;
}

export function dampDirectorValue(
  current: number,
  target: number,
  deltaSeconds: number,
  responseSeconds: number,
) {
  const safeDelta = Math.max(0, deltaSeconds);
  const safeResponse = Math.max(0.000_001, responseSeconds);
  return (
    target +
    (current - target) * Math.exp(-safeDelta / safeResponse)
  );
}

export function dampDirectorValueAsymmetric(
  current: number,
  target: number,
  deltaSeconds: number,
  riseResponseSeconds: number,
  fallResponseSeconds: number,
) {
  return dampDirectorValue(
    current,
    target,
    deltaSeconds,
    target > current ? riseResponseSeconds : fallResponseSeconds,
  );
}

/**
 * Returns the vertical lift needed to keep a camera-sized corridor between
 * the subject and the proposed camera clear of terrain and constructed matter.
 */
export function requiredCameraLift(
  subject: CameraDirectorPoint,
  camera: CameraDirectorPoint,
  sampleSolidTopY: (x: number, z: number) => number,
  clearance: number,
  sampleStep: number,
) {
  const distance = Math.hypot(
    camera.x - subject.x,
    camera.y - subject.y,
    camera.z - subject.z,
  );
  const sampleCount = Math.min(
    96,
    Math.max(4, Math.ceil(distance / Math.max(0.000_001, sampleStep))),
  );
  let requiredLift = 0;
  for (let index = 1; index <= sampleCount; index += 1) {
    const progress = index / sampleCount;
    const x = subject.x + (camera.x - subject.x) * progress;
    const y = subject.y + (camera.y - subject.y) * progress;
    const z = subject.z + (camera.z - subject.z) * progress;
    requiredLift = Math.max(
      requiredLift,
      sampleSolidTopY(x, z) + clearance - y,
    );
  }
  return Math.max(0, requiredLift);
}
