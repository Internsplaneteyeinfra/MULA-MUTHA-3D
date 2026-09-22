import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { state } from "../state.js";

const COUNT = 900;
const BURST_EVERY_S = 60;
const BURST_DURATION_S = 2.6;

/**
 * Short rain bursts over the river corridor — 2–3 s every ~1 min.
 * Intensity follows live weather (clear = light mist; rain/storm = denser).
 */
export function createRiverRain(dataset) {
  const stations = dataset?.corridor?.stations || [];
  const group = new THREE.Group();
  group.name = "riverRain";
  group.visible = true;

  const pos = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT);
  const life = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    life[i] = -1;
    pos[i * 3 + 1] = -999;
    vel[i] = 18 + Math.random() * 22;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(28.0 / -mv.z, 1.2, 4.5);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5, 0.15);
        float d = length(c * vec2(1.8, 0.55));
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.05, d) * uOpacity;
        gl_FragColor = vec4(0.78, 0.88, 0.98, a);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 12;
  group.add(points);

  let intensity = 0.35; // 0..1 from live weather
  let windX = 0.15;
  let windZ = 0.05;
  let burstAge = BURST_EVERY_S - 2; // first burst soon after load
  let raining = false;
  let activeOpacity = 0;

  function pickStationXZ() {
    if (!stations.length) return { x: 0, z: 0, half: 40 };
    const s = stations[Math.floor(Math.random() * stations.length)];
    const u = Math.random() * 2 - 1;
    const half = Math.max(12, (s.halfWidth || 40) * 0.92);
    const px = -(s.flowZ || 0);
    const pz = s.flowX || 1;
    const plen = Math.hypot(px, pz) || 1;
    return {
      x: s.x + (px / plen) * u * half,
      z: s.z + (pz / plen) * u * half,
      half,
    };
  }

  function respawn(i) {
    const p = pickStationXZ();
    pos[i * 3] = p.x + (Math.random() - 0.5) * 6;
    pos[i * 3 + 1] = SURFACE_Y + 28 + Math.random() * 55;
    pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 6;
    vel[i] = 22 + Math.random() * 28 + intensity * 18;
    life[i] = 0.6 + Math.random() * 1.1;
  }

  function applyLiveWeather(weather) {
    if (!weather) return;
    const code = Number(weather.code);
    const precip = Number(weather.precipitation);
    const cloud = Number(weather.cloudCover);

    let next = 0.28;
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) next = 0.85;
    else if ([51, 53, 55, 56, 57].includes(code)) next = 0.55;
    else if ([95, 96, 99].includes(code)) next = 1;
    else if (Number.isFinite(precip) && precip > 0.2) next = 0.5 + Math.min(0.4, precip * 0.08);
    else if (Number.isFinite(cloud) && cloud > 70) next = 0.4;
    else if (code === 0) next = 0.18;
    else if ([1, 2, 3].includes(code)) next = 0.28;

    intensity = THREE.MathUtils.clamp(next, 0.12, 1);

    const wind = Number(weather.wind);
    if (Number.isFinite(wind)) {
      const a = ((Number(weather.windDir) || 220) * Math.PI) / 180;
      const w = THREE.MathUtils.clamp(wind / 40, 0.05, 0.55);
      windX = Math.sin(a) * w;
      windZ = Math.cos(a) * w;
    }
  }

  function update(dt) {
    if (state.cinematicActive) {
      mat.uniforms.uOpacity.value = 0;
      return;
    }

    burstAge += dt;
    if (!raining && burstAge >= BURST_EVERY_S) {
      raining = true;
      burstAge = 0;
      // Seed a wave of drops at burst start
      const seedN = Math.floor(120 + intensity * 280);
      for (let i = 0; i < seedN && i < COUNT; i++) respawn(i);
    }
    if (raining && burstAge >= BURST_DURATION_S) {
      raining = false;
      burstAge = 0;
    }

    const targetOpacity = raining ? 0.35 + intensity * 0.55 : 0;
    activeOpacity += (targetOpacity - activeOpacity) * Math.min(1, dt * 6);
    mat.uniforms.uOpacity.value = activeOpacity;

    if (activeOpacity < 0.02 && !raining) return;

    const spawnRate = raining ? 180 + intensity * 420 : 0;
    let toSpawn = spawnRate * dt;
    for (let i = 0; i < COUNT; i++) {
      if (life[i] < 0) {
        if (toSpawn > 0 && raining) {
          respawn(i);
          toSpawn -= 1;
        }
        continue;
      }
      life[i] -= dt;
      pos[i * 3] += windX * vel[i] * dt * 0.35;
      pos[i * 3 + 1] -= vel[i] * dt;
      pos[i * 3 + 2] += windZ * vel[i] * dt * 0.35;
      if (pos[i * 3 + 1] <= SURFACE_Y + 0.4 || life[i] <= 0) {
        if (raining && toSpawn > 0) {
          respawn(i);
          toSpawn -= 1;
        } else {
          life[i] = -1;
          pos[i * 3 + 1] = -999;
        }
      }
    }
    geo.attributes.position.needsUpdate = true;
  }

  return {
    group,
    update,
    applyLiveWeather,
    dispose() {
      geo.dispose();
      mat.dispose();
      group.removeFromParent();
    },
  };
}
