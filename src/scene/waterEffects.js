import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { state } from "../state.js";

const LOOP = 30;

/**
 * Cinematic water FX: source origin + droplets + splash rings + flow-front mist.
 * Uses existing corridor stations[0] as RiverPoint[0] — does not alter geometry.
 */
export function createWaterEffects(dataset) {
  const stations = dataset.corridor.stations;
  const group = new THREE.Group();
  group.name = "waterEffects";

  const src = stations[0];
  const fx0 = src.flowX;
  const fz0 = src.flowZ;
  const px0 = -fz0;
  const pz0 = fx0;

  // —— Source beacon (subtle glowing disc + vertical mist) ——
  const sourceGroup = new THREE.Group();
  sourceGroup.name = "waterSource";
  sourceGroup.position.set(src.x, SURFACE_Y + 0.05, src.z);

  const discGeo = new THREE.CircleGeometry(Math.min(14, src.halfWidth * 0.35), 32);
  discGeo.rotateX(-Math.PI / 2);
  const discMat = new THREE.MeshBasicMaterial({
    color: "#c8e8f4",
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.renderOrder = 8;
  sourceGroup.add(disc);

  const ringGeo = new THREE.RingGeometry(2.2, 3.4, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: "#e8f6fc",
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sourceRing = new THREE.Mesh(ringGeo, ringMat);
  sourceRing.renderOrder = 9;
  sourceGroup.add(sourceRing);
  group.add(sourceGroup);

  // —— Droplet / splash particles (pooled) ——
  const DROP_N = 280;
  const dropPos = new Float32Array(DROP_N * 3);
  const dropVel = new Float32Array(DROP_N * 3);
  const dropLife = new Float32Array(DROP_N);
  const dropMax = new Float32Array(DROP_N);
  const dropSize = new Float32Array(DROP_N);
  for (let i = 0; i < DROP_N; i++) {
    dropLife[i] = -1;
    dropPos[i * 3 + 1] = -999;
  }

  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute("position", new THREE.BufferAttribute(dropPos, 3));
  dropGeo.setAttribute("aSize", new THREE.BufferAttribute(dropSize, 1));
  const dropMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying float vA;
      void main(){
        vA = aSize;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * (220.0 / -mv.z), 1.5, 14.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.05, d) * 0.85;
        gl_FragColor = vec4(0.82, 0.94, 1.0, a);
      }
    `,
  });
  const drops = new THREE.Points(dropGeo, dropMat);
  drops.name = "waterDroplets";
  drops.frustumCulled = false;
  drops.renderOrder = 10;
  group.add(drops);

  // —— Expanding splash / ripple rings (instanced) ——
  const RING_MAX = 36;
  const rippleGeo = new THREE.RingGeometry(0.15, 0.45, 24);
  rippleGeo.rotateX(-Math.PI / 2);
  const rippleMat = new THREE.MeshBasicMaterial({
    color: "#d0ecf6",
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ripples = new THREE.InstancedMesh(rippleGeo, rippleMat, RING_MAX);
  ripples.frustumCulled = false;
  ripples.renderOrder = 9;
  ripples.count = 0;
  group.add(ripples);

  const ripplePool = Array.from({ length: RING_MAX }, () => ({
    active: false,
    x: 0,
    y: SURFACE_Y + 0.04,
    z: 0,
    age: 0,
    life: 1.2,
    scale: 1,
  }));
  const dummy = new THREE.Object3D();

  function spawnRipple(x, z, scale = 1) {
    const slot = ripplePool.find((r) => !r.active) || ripplePool[(Math.random() * RING_MAX) | 0];
    slot.active = true;
    slot.x = x;
    slot.y = SURFACE_Y + 0.04;
    slot.z = z;
    slot.age = 0;
    slot.life = 0.8 + Math.random() * 0.9;
    slot.scale = scale;
  }

  function spawnDroplet(x, y, z, vx, vy, vz, life, size) {
    let idx = -1;
    for (let i = 0; i < DROP_N; i++) {
      if (dropLife[i] < 0) {
        idx = i;
        break;
      }
    }
    if (idx < 0) idx = (Math.random() * DROP_N) | 0;
    dropPos[idx * 3] = x;
    dropPos[idx * 3 + 1] = y;
    dropPos[idx * 3 + 2] = z;
    dropVel[idx * 3] = vx;
    dropVel[idx * 3 + 1] = vy;
    dropVel[idx * 3 + 2] = vz;
    dropLife[idx] = 0;
    dropMax[idx] = life;
    dropSize[idx] = size;
  }

  function stationAtAlong(u) {
    const t = THREE.MathUtils.clamp(u, 0, 0.999);
    const f = t * (stations.length - 1);
    const i = Math.floor(f);
    const k = f - i;
    const a = stations[i];
    const b = stations[Math.min(stations.length - 1, i + 1)];
    let fx = a.flowX + (b.flowX - a.flowX) * k;
    let fz = a.flowZ + (b.flowZ - a.flowZ) * k;
    const len = Math.hypot(fx, fz) || 1;
    return {
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      fx: fx / len,
      fz: fz / len,
      half: a.halfWidth + (b.halfWidth - a.halfWidth) * k,
    };
  }

  let reveal = 1.2;
  let active = false;
  let burstT = 0;

  function setReveal(r) {
    reveal = r;
  }

  function setActive(v) {
    active = v;
    if (v) {
      burstT = 0;
      // Opening burst at exact source
      for (let i = 0; i < 28; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * Math.min(8, src.halfWidth * 0.25);
        spawnDroplet(
          src.x + Math.cos(ang) * r,
          SURFACE_Y + 0.2 + Math.random() * 0.8,
          src.z + Math.sin(ang) * r,
          fx0 * (1.5 + Math.random() * 2) + (Math.random() - 0.5) * 1.2,
          2.5 + Math.random() * 4.5,
          fz0 * (1.5 + Math.random() * 2) + (Math.random() - 0.5) * 1.2,
          0.6 + Math.random() * 0.7,
          2.5 + Math.random() * 3.5,
        );
      }
      spawnRipple(src.x, src.z, 2.2);
      spawnRipple(src.x + fx0 * 4, src.z + fz0 * 4, 1.6);
    }
  }

  function update(dt) {
    const t = state.elapsed;
    const loopT = t % LOOP;

    // Source visuals pulse
    const sourceBoost = active && reveal < 0.15 ? 1.4 : active ? 0.85 : 0.35;
    discMat.opacity = (0.22 + Math.sin(t * 2.2) * 0.08) * sourceBoost;
    const pulse = 1 + Math.sin(t * 1.8) * 0.08;
    sourceRing.scale.set(pulse * (1.2 + reveal * 0.4), 1, pulse * (1.2 + reveal * 0.4));
    ringMat.opacity = (0.35 + Math.sin(t * 3.1) * 0.12) * sourceBoost;
    sourceGroup.visible = state.showWater;

    burstT += dt;

    // Continuous soft droplets at source while cinematic / early reveal
    if (state.showWater && (active || reveal < 1.05)) {
      const sourceRate = active && reveal < 0.12 ? 18 : active ? 6 : 1.5;
      const nSpawn = Math.min(8, Math.floor(sourceRate * dt + Math.random()));
      for (let i = 0; i < nSpawn; i++) {
        const lat = (Math.random() - 0.5) * src.halfWidth * 0.4;
        const along = Math.random() * 6;
        spawnDroplet(
          src.x + px0 * lat + fx0 * along,
          SURFACE_Y + 0.15 + Math.random() * 0.5,
          src.z + pz0 * lat + fz0 * along,
          fx0 * (0.8 + Math.random() * 2.5) + (Math.random() - 0.5),
          1.2 + Math.random() * 3.8,
          fz0 * (0.8 + Math.random() * 2.5) + (Math.random() - 0.5),
          0.45 + Math.random() * 0.8,
          1.8 + Math.random() * 3.2,
        );
      }
      if (burstT > 0.35) {
        burstT = 0;
        spawnRipple(src.x + fx0 * Math.random() * 5, src.z + fz0 * Math.random() * 5, 1.1 + Math.random());
      }
    }

    // Flow-front droplets / foam streaks along reveal edge
    if (active && reveal > 0.02 && reveal < 1.05) {
      const frontRate = 22;
      const nFront = Math.min(10, Math.floor(frontRate * dt + Math.random() * 2));
      for (let i = 0; i < nFront; i++) {
        const u = reveal + (Math.random() - 0.55) * 0.035;
        const st = stationAtAlong(THREE.MathUtils.clamp(u, 0, 0.99));
        const lat = (Math.random() - 0.5) * st.half * 1.1;
        const px = -st.fz;
        const pz = st.fx;
        // More energy in narrow sections
        const narrowBoost = st.half < 35 ? 1.6 : 1;
        spawnDroplet(
          st.x + px * lat,
          SURFACE_Y + 0.1 + Math.random() * 0.6 * narrowBoost,
          st.z + pz * lat,
          st.fx * (2 + Math.random() * 3) * narrowBoost + (Math.random() - 0.5),
          (1.5 + Math.random() * 3.5) * narrowBoost,
          st.fz * (2 + Math.random() * 3) * narrowBoost + (Math.random() - 0.5),
          0.4 + Math.random() * 0.7,
          2 + Math.random() * 4 * narrowBoost,
        );
        if (Math.random() < 0.2) {
          spawnRipple(st.x + px * lat * 0.5, st.z + pz * lat * 0.5, 0.8 + Math.random() * 1.4);
        }
      }
    }

    // Integrate droplets
    for (let i = 0; i < DROP_N; i++) {
      if (dropLife[i] < 0) {
        dropPos[i * 3 + 1] = -999;
        dropSize[i] = 0;
        continue;
      }
      dropLife[i] += dt;
      if (dropLife[i] >= dropMax[i]) {
        // Land → ripple
        if (dropPos[i * 3 + 1] < SURFACE_Y + 1.5) {
          spawnRipple(dropPos[i * 3], dropPos[i * 3 + 2], 0.45 + Math.random() * 0.5);
        }
        dropLife[i] = -1;
        dropSize[i] = 0;
        continue;
      }
      dropVel[i * 3 + 1] -= 9.8 * dt;
      dropPos[i * 3] += dropVel[i * 3] * dt;
      dropPos[i * 3 + 1] += dropVel[i * 3 + 1] * dt;
      dropPos[i * 3 + 2] += dropVel[i * 3 + 2] * dt;
      if (dropPos[i * 3 + 1] <= SURFACE_Y + 0.02) {
        spawnRipple(dropPos[i * 3], dropPos[i * 3 + 2], 0.35 + dropSize[i] * 0.08);
        dropLife[i] = -1;
        dropSize[i] = 0;
        continue;
      }
      const lifeT = dropLife[i] / dropMax[i];
      dropSize[i] = (2.2 + (1 - lifeT) * 3.5) * (0.7 + Math.random() * 0.05);
    }
    dropGeo.attributes.position.needsUpdate = true;
    dropGeo.attributes.aSize.needsUpdate = true;

    // Ripple instances
    let count = 0;
    for (const r of ripplePool) {
      if (!r.active) continue;
      r.age += dt;
      if (r.age >= r.life) {
        r.active = false;
        continue;
      }
      const u = r.age / r.life;
      const s = r.scale * (0.4 + u * 5.5);
      dummy.position.set(r.x, r.y, r.z);
      dummy.scale.set(s, 1, s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      ripples.setMatrixAt(count, dummy.matrix);
      count++;
    }
    ripples.count = count;
    ripples.instanceMatrix.needsUpdate = true;
    rippleMat.opacity = 0.48 * (1 - count / (RING_MAX + 2) * 0.2);

    // Soft idle mist along river when water fully revealed (subtle continuous life)
    if (!active && reveal > 1.0 && state.showWater && Math.random() < dt * 4) {
      const st = stationAtAlong(Math.random());
      const lat = (Math.random() - 0.5) * st.half * 0.8;
      const px = -st.fz;
      const pz = st.fx;
      if (Math.random() < 0.35) {
        spawnDroplet(
          st.x + px * lat,
          SURFACE_Y + 0.2,
          st.z + pz * lat,
          st.fx * 1.5,
          1.5 + Math.random() * 2,
          st.fz * 1.5,
          0.4,
          1.5,
        );
      }
    }

    // Underwater dive + fish scene: bubbles / suspended particles
    if ((state.cinematicUnderwater || state.cinematicFishScene) && state._cinematicCam && state.showWater) {
      const cam = state._cinematicCam;
      const rate = state.cinematicFishScene ? 18 : 10;
      const nBub = Math.min(state.cinematicFishScene ? 8 : 5, Math.floor(rate * dt + Math.random() * 2));
      for (let i = 0; i < nBub; i++) {
        spawnDroplet(
          cam.x + (Math.random() - 0.5) * 4.5,
          cam.y + (Math.random() - 0.5) * 1.8,
          cam.z + (Math.random() - 0.5) * 4.5,
          (Math.random() - 0.5) * 0.6,
          0.4 + Math.random() * 1.6,
          (Math.random() - 0.5) * 0.6,
          0.7 + Math.random() * 1.1,
          1.2 + Math.random() * 2.8,
        );
      }
    }

    void loopT;
  }

  function spawnFishSplash(x, z, intensity = 1) {
    const n = Math.min(22, Math.floor(10 + intensity * 12));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 2.8 * intensity;
      spawnDroplet(
        x + Math.cos(ang) * 0.15,
        SURFACE_Y + 0.08 + Math.random() * 0.25,
        z + Math.sin(ang) * 0.15,
        Math.cos(ang) * sp,
        2.2 + Math.random() * 3.5 * intensity,
        Math.sin(ang) * sp,
        0.35 + Math.random() * 0.55,
        1.6 + Math.random() * 2.4 * intensity,
      );
    }
    spawnRipple(x, z, 0.7 + intensity * 0.55);
    spawnRipple(x + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.4, 0.45 + intensity * 0.3);
  }

  return {
    group,
    source: { x: src.x, z: src.z, flowX: fx0, flowZ: fz0 },
    setReveal,
    setActive,
    spawnFishSplash,
    spawnRipple,
    update,
  };
}
