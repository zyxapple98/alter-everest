import * as THREE from "three";

export interface AtmospherePalette {
  top: string;
  middle: string;
  horizon: string;
  nadir: string;
  celestial: string;
  celestialGlow: string;
  celestialRadiusRadians: number;
  starOpacity: number;
}

export interface CameraAtmosphere {
  root: THREE.Group;
  sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  lastCelestialMinute: number;
}

const KATHMANDU_OFFSET_MINUTES = 5 * 60 + 45;
const DAY_START_HOUR = 5.5;
const DAY_END_HOUR = 19.25;

const ATMOSPHERE_VERTEX_SHADER = `
  varying vec3 vSkyDirection;

  void main() {
    vSkyDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ATMOSPHERE_FRAGMENT_SHADER = `
  uniform vec3 topColor;
  uniform vec3 middleColor;
  uniform vec3 horizonColor;
  uniform vec3 nadirColor;
  uniform vec3 celestialColor;
  uniform vec3 celestialGlowColor;
  uniform vec3 celestialDirection;
  uniform float celestialRadius;
  varying vec3 vSkyDirection;

  void main() {
    vec3 direction = normalize(vSkyDirection);
    float altitude = direction.y;

    float middleMix = smoothstep(0.0, 0.3, altitude);
    float topMix = smoothstep(0.22, 0.86, altitude);
    vec3 upperSky = mix(horizonColor, middleColor, middleMix);
    upperSky = mix(upperSky, topColor, topMix);

    float belowHorizon = smoothstep(0.0, 0.58, -altitude);
    vec3 lowerSky = mix(horizonColor, nadirColor, belowHorizon);
    vec3 skyColor = altitude >= 0.0 ? upperSky : lowerSky;

    float alignment = dot(direction, normalize(celestialDirection));
    float disc = smoothstep(
      cos(celestialRadius),
      cos(celestialRadius * 0.78),
      alignment
    );
    float glow = smoothstep(
      cos(celestialRadius * 5.5),
      cos(celestialRadius),
      alignment
    );
    skyColor += celestialGlowColor * glow * (1.0 - disc) * 0.34;
    skyColor = mix(skyColor, celestialColor, disc);

    gl_FragColor = vec4(skyColor, 1.0);
  }
`;

export function kathmanduLocalHour(date = new Date()) {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (
    ((utcMinutes + KATHMANDU_OFFSET_MINUTES) % (24 * 60)) /
    60
  );
}

export function celestialDirectionAtKathmandu(date = new Date()) {
  const hour = kathmanduLocalHour(date);
  const daylight = hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
  const cycleDuration = daylight
    ? DAY_END_HOUR - DAY_START_HOUR
    : 24 - DAY_END_HOUR + DAY_START_HOUR;
  const elapsed = daylight
    ? hour - DAY_START_HOUR
    : hour >= DAY_END_HOUR
      ? hour - DAY_END_HOUR
      : hour + 24 - DAY_END_HOUR;
  const progress = THREE.MathUtils.clamp(
    elapsed / cycleDuration,
    0,
    1,
  );
  const minimumElevation = THREE.MathUtils.degToRad(
    daylight ? 4 : 8,
  );
  const peakElevation = THREE.MathUtils.degToRad(
    daylight ? 57 : 43,
  );
  const elevation =
    minimumElevation +
    Math.sin(progress * Math.PI) *
      (peakElevation - minimumElevation);
  // East -> south -> west in the canonical Everest coordinate frame.
  const azimuth = THREE.MathUtils.degToRad(90 + progress * 180);
  const horizontal = Math.cos(elevation);

  return new THREE.Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation),
    -Math.cos(azimuth) * horizontal,
  ).normalize();
}

function createStarGeometry(radius: number) {
  const positions = new Float32Array(96 * 3);
  let state = 0x5eeda11;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };

  for (let index = 0; index < 96; index += 1) {
    const azimuth = random() * Math.PI * 2;
    const y = 0.06 + random() * 0.9;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    positions[index * 3] = Math.sin(azimuth) * horizontal * radius;
    positions[index * 3 + 1] = y * radius;
    positions[index * 3 + 2] =
      Math.cos(azimuth) * horizontal * radius;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  return geometry;
}

export function createCameraAtmosphere(
  radius: number,
  palette: AtmospherePalette,
  date = new Date(),
): CameraAtmosphere {
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(palette.top) },
      middleColor: { value: new THREE.Color(palette.middle) },
      horizonColor: { value: new THREE.Color(palette.horizon) },
      nadirColor: { value: new THREE.Color(palette.nadir) },
      celestialColor: { value: new THREE.Color(palette.celestial) },
      celestialGlowColor: {
        value: new THREE.Color(palette.celestialGlow),
      },
      celestialDirection: {
        value: celestialDirectionAtKathmandu(date),
      },
      celestialRadius: { value: palette.celestialRadiusRadians },
    },
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  skyMaterial.toneMapped = false;

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 40, 24),
    skyMaterial,
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1_000;

  const starMaterial = new THREE.PointsMaterial({
    color: new THREE.Color("#d7eff6").multiplyScalar(
      palette.starOpacity,
    ),
    size: 1.15,
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  starMaterial.toneMapped = false;
  const stars = new THREE.Points(
    createStarGeometry(radius * 0.985),
    starMaterial,
  );
  stars.visible = palette.starOpacity > 0.01;
  stars.frustumCulled = false;
  stars.renderOrder = -999;

  const root = new THREE.Group();
  root.add(sky, stars);

  return {
    root,
    sky,
    stars,
    lastCelestialMinute: Math.floor(date.getTime() / 60_000),
  };
}

export function updateCameraAtmosphere(
  atmosphere: CameraAtmosphere,
  camera: THREE.Camera,
  date = new Date(),
) {
  atmosphere.root.position.copy(camera.position);
  const minute = Math.floor(date.getTime() / 60_000);
  if (minute === atmosphere.lastCelestialMinute) return;
  atmosphere.lastCelestialMinute = minute;
  (
    atmosphere.sky.material.uniforms.celestialDirection
      .value as THREE.Vector3
  ).copy(celestialDirectionAtKathmandu(date));
}

export function disposeCameraAtmosphere(
  atmosphere: CameraAtmosphere,
) {
  atmosphere.sky.geometry.dispose();
  atmosphere.sky.material.dispose();
  atmosphere.stars.geometry.dispose();
  atmosphere.stars.material.dispose();
}
