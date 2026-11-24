import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { state } from "../state.js";

/** Cap for performance — density scales with intensity, not max count. */
const COUNT = 1400;

/**
 * Rain particle system over the river corridor / catchment.
 * - Live weather: light ambient rain bursts
 * - Rainfall Simulation: continuous catchment rain driven by model intensity (mm/hr)
 *   Particles stop when the rainfall event ends (sim intensity → 0).
 * Clearly rainfall droplets — not river spray. Does not modify terrain or floodwater.
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
      uSimMode: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uSimMode;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float base = mix(28.0, 36.0, uSimMode);
        gl_PointSize = clamp(base / -mv.z, 1.4, mix(4.5, 6.2, uSimMode));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uSimMode;
      void main() {
        // Elongated droplet silhouette (not circular spray)
        vec2 c = gl_PointCoord - vec2(0.5, 0.12);
        float d = length(c * vec2(2.4, mix(0.55, 0.42, uSimMode)));
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.04, d) * uOpacity;
        vec3 col = mix(vec3(0.78, 0.88, 0.98), vec3(0.72, 0.86, 1.0), uSimMode);
        gl_FragColor = vec4(col, a);
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
  let raining = false;
  let activeOpacity = 0;

  /** Rainfall Simulation override: intensity 0–1, or null = weather-driven. */
  let simOverride = null;
  /** Model rainfall intensity mm/hr (for density scaling). */
  let simMmHr = 0;
  /** Freeze particle motion (simulation pause). */
  let simPaused = false;

  function pickStationXZ(catchmentSpread) {
    if (!stations.length) return { x: 0, z: 0, half: 40 };
    const s = stations[Math.floor(Math.random() * stations.length)];
    const u = Math.random() * 2 - 1;
    const half = Math.max(12, (s.halfWidth || 40) * (catchmentSpread ? 2.8 : 0.92));
    const px = -(s.flowZ || 0);
    const pz = s.flowX || 1;
    const plen = Math.hypot(px, pz) || 1;
    const along = catchmentSpread ? (Math.random() - 0.5) * 48 : (Math.random() - 0.5) * 6;
    return {
      x: s.x + (px / plen) * u * half + along * (pz / plen),
      z: s.z + (pz / plen) * u * half - along * (px / plen),
      half,
    };
  }

  function respawn(i, catchment) {
    const p = pickStationXZ(catchment);
    const heightBoost = catchment ? 40 + Math.random() * 70 : 28 + Math.random() * 55;
    pos[i * 3] = p.x;
    pos[i * 3 + 1] = SURFACE_Y + heightBoost;
    pos[i * 3 + 2] = p.z;
    const fallBoost = catchment ? 8 + Math.min(24, simMmHr * 4) : intensity * 18;
    vel[i] = 22 + Math.random() * 28 + fallBoost;
    life[i] = catchment ? 0.9 + Math.random() * 1.4 : 0.6 + Math.random() * 1.1;
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
    if (simPaused) {
      mat.uniforms.uOpacity.value = activeOpacity;
      return;
    }

    const simActive = simOverride != null && simOverride > 0.02;
    mat.uniforms.uSimMode.value = simActive ? 1 : 0;

    let forcedIntensity = 0;
    if (state.skyPreset === "raining") forcedIntensity = 0.8;
    else if (state.skyPreset === "drizzle") forcedIntensity = 0.4;
    if (simOverride != null) forcedIntensity = simOverride;

    const currentIntensity = simActive
      ? simOverride
      : Math.max(intensity, forcedIntensity);
    raining = currentIntensity > 0.02;

    const targetOpacity = raining
      ? (simActive ? 0.42 + currentIntensity * 0.5 : 0.35 + currentIntensity * 0.55)
      : 0;
    activeOpacity += (targetOpacity - activeOpacity) * Math.min(1, dt * 6);
    mat.uniforms.uOpacity.value = activeOpacity;

    if (activeOpacity < 0.02 && !raining) {
      // Hard-clear particles when rainfall event ends
      if (!raining && simOverride === 0) {
        for (let i = 0; i < COUNT; i++) {
          if (life[i] >= 0) {
            life[i] = -1;
            pos[i * 3 + 1] = -999;
          }
        }
        geo.attributes.position.needsUpdate = true;
      }
      return;
    }

    // Density from rainfall intensity (cap for performance)
    const spawnRate = simActive
      ? 40 + Math.min(220, simMmHr * 55 + currentIntensity * 100)
      : raining
        ? 80 + currentIntensity * 120
        : 0;
    let toSpawn = spawnRate * dt;
    for (let i = 0; i < COUNT; i++) {
      if (life[i] < 0) {
        if (toSpawn > 0 && raining) {
          respawn(i, simActive);
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
          respawn(i, simActive);
          toSpawn -= 1;
        } else {
          life[i] = -1;
          pos[i * 3 + 1] = -999;
        }
      }
    }
    geo.attributes.position.needsUpdate = true;
  }

  /**
   * Rainfall Simulation intensity.
   * @param {number|null} v 0–1 override, or null to release to weather
   * @param {number} [mmHr] model intensity for density
   */
  function setIntensity(v, mmHr) {
    if (v == null || !Number.isFinite(Number(v))) {
      simOverride = null;
      simMmHr = 0;
      simPaused = false;
      return;
    }
    const n = Number(v);
    if (n <= 0.02) {
      simOverride = 0;
      simMmHr = 0;
      return;
    }
    simOverride = THREE.MathUtils.clamp(n, 0, 1);
    simMmHr = Number.isFinite(Number(mmHr)) ? Math.max(0, Number(mmHr)) : simOverride * 25;
    intensity = Math.max(intensity, simOverride);
  }

  function setPaused(v) {
    simPaused = !!v;
  }

  return {
    group,
    update,
    applyLiveWeather,
    setIntensity,
    setPaused,
    dispose() {
      geo.dispose();
      mat.dispose();
      group.removeFromParent();
    },
  };
}
