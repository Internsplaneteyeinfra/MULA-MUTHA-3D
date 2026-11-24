import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";

/**
 * Dedicated Rainfall Simulation particle system (NOT weather riverRain).
 * InstancedMesh streaks — visible on Windows/ANGLE where gl_PointSize is unreliable.
 *
 * Density is driven by instantaneous model intensity (mm/hr), not rainfall total.
 * Emission stops when rainfall ends; in-flight drops finish falling.
 * Subtle impact ripples on water; short sparks on land. No flood / puddles.
 */

const MAX_DROPS = 2200;
const MAX_IMPACTS = 80;

/**
 * Intensity bands → emission (drops/sec). Performance-capped.
 * 0–2 light · 2–15 moderate · 15–50 heavy · 50+ very heavy
 */
export function emissionRateFromIntensity(mmHr) {
  const i = Math.max(0, Number(mmHr) || 0);
  if (i <= 0) return 0;
  if (i <= 2) return 35 + i * 40; // ~35–115
  if (i <= 15) return 120 + (i - 2) * 28; // ~120–484
  if (i <= 50) return 500 + (i - 15) * 12; // ~500–920
  return Math.min(1100, 920 + (i - 50) * 4);
}

/** Fall speed — subtle visual range; not tied aggressively to intensity. */
function fallSpeedFromIntensity(mmHr) {
  const i = Math.max(0, Number(mmHr) || 0);
  const base = i <= 2 ? 26 : i <= 15 ? 30 : i <= 50 ? 34 : 36;
  return base + Math.random() * 8;
}

/** Streak length — denser rain → slightly longer streaks, still realistic. */
function streakLenFromIntensity(mmHr) {
  const i = Math.max(0, Number(mmHr) || 0);
  if (i <= 2) return 0.45 + Math.random() * 0.25;
  if (i <= 15) return 0.65 + Math.random() * 0.35;
  if (i <= 50) return 0.85 + Math.random() * 0.4;
  return 1.0 + Math.random() * 0.45;
}

/** Impact spawn chance scales with intensity band. */
export function impactChanceFromIntensity(mmHr) {
  const i = Math.max(0, Number(mmHr) || 0);
  if (i <= 2) return 0.08;
  if (i <= 15) return 0.18;
  if (i <= 50) return 0.35;
  return 0.5;
}

export function createRainfallSimulationParticles(dataset) {
  const stations = dataset?.corridor?.stations || [];
  const group = new THREE.Group();
  group.name = "rainfallSimulationParticles";
  group.visible = false;

  // —— Droplet streaks (thin boxes, world-aligned fall) ——
  const streakGeo = new THREE.BoxGeometry(0.035, 1, 0.035);
  streakGeo.translate(0, -0.5, 0); // origin at top of streak
  const streakMat = new THREE.MeshBasicMaterial({
    color: 0xb8dcf0,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    toneMapped: false,
  });
  const drops = new THREE.InstancedMesh(streakGeo, streakMat, MAX_DROPS);
  drops.frustumCulled = false;
  drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  drops.count = MAX_DROPS;
  drops.renderOrder = 14;
  group.add(drops);

  const alive = new Uint8Array(MAX_DROPS);
  const px = new Float32Array(MAX_DROPS);
  const py = new Float32Array(MAX_DROPS);
  const pz = new Float32Array(MAX_DROPS);
  const vy = new Float32Array(MAX_DROPS);
  const vx = new Float32Array(MAX_DROPS);
  const vz = new Float32Array(MAX_DROPS);
  const len = new Float32Array(MAX_DROPS);
  const hitY = new Float32Array(MAX_DROPS);
  const onWater = new Uint8Array(MAX_DROPS);

  const dummy = new THREE.Object3D();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX_DROPS; i++) {
    alive[i] = 0;
    drops.setMatrixAt(i, hidden);
  }
  drops.instanceMatrix.needsUpdate = true;

  // —— Impact ripples (water) + land sparks ——
  const rippleGeo = new THREE.RingGeometry(0.15, 0.55, 24);
  rippleGeo.rotateX(-Math.PI / 2);
  const rippleMat = new THREE.MeshBasicMaterial({
    color: 0xd0eefc,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const ripples = new THREE.InstancedMesh(rippleGeo, rippleMat, MAX_IMPACTS);
  ripples.frustumCulled = false;
  ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ripples.renderOrder = 13;
  group.add(ripples);

  const rAlive = new Uint8Array(MAX_IMPACTS);
  const rX = new Float32Array(MAX_IMPACTS);
  const rY = new Float32Array(MAX_IMPACTS);
  const rZ = new Float32Array(MAX_IMPACTS);
  const rAge = new Float32Array(MAX_IMPACTS);
  const rMax = new Float32Array(MAX_IMPACTS);
  const rScale = new Float32Array(MAX_IMPACTS);
  for (let i = 0; i < MAX_IMPACTS; i++) {
    rAlive[i] = 0;
    ripples.setMatrixAt(i, hidden);
  }
  ripples.instanceMatrix.needsUpdate = true;

  let mmHr = 0;
  let emitting = false;
  let paused = false;
  let windX = 0.12;
  let windZ = 0.04;
  let spawnCarry = 0;
  let waterSurfaceY = SURFACE_Y;
  let activeCount = 0;

  function pickSpawn() {
    if (!stations.length) {
      return { x: (Math.random() - 0.5) * 80, z: (Math.random() - 0.5) * 80, water: true };
    }
    const s = stations[Math.floor(Math.random() * stations.length)];
    const across = (Math.random() * 2 - 1) * Math.max(18, (s.halfWidth || 40) * 2.4);
    const along = (Math.random() - 0.5) * 36;
    const px_ = -(s.flowZ || 0);
    const pz_ = s.flowX || 1;
    const plen = Math.hypot(px_, pz_) || 1;
    const fx = s.flowX || 0;
    const fz = s.flowZ || 1;
    const flen = Math.hypot(fx, fz) || 1;
    const x = s.x + (px_ / plen) * across + (fx / flen) * along;
    const z = s.z + (pz_ / plen) * across + (fz / flen) * along;
    const water = Math.abs(across) < (s.halfWidth || 40) * 1.05;
    return { x, z, water };
  }

  function groundYAt(x, z, preferWater) {
    if (preferWater) return waterSurfaceY;
    try {
      const ty = terrainHeightAt(x, z, stations);
      if (Number.isFinite(ty)) return Math.max(ty, waterSurfaceY - 0.5);
    } catch {
      /* fall through */
    }
    return waterSurfaceY + 0.5;
  }

  function spawnOne() {
    let idx = -1;
    for (let i = 0; i < MAX_DROPS; i++) {
      if (!alive[i]) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;

    const p = pickSpawn();
    const top = waterSurfaceY + 55 + Math.random() * 70;
    px[idx] = p.x;
    py[idx] = top;
    pz[idx] = p.z;
    vy[idx] = fallSpeedFromIntensity(mmHr);
    vx[idx] = windX * (0.6 + Math.random() * 0.8);
    vz[idx] = windZ * (0.6 + Math.random() * 0.8);
    len[idx] = streakLenFromIntensity(mmHr) * (0.75 + Math.random() * 0.5);
    onWater[idx] = p.water ? 1 : 0;
    hitY[idx] = groundYAt(p.x, p.z, p.water);
    alive[idx] = 1;
    activeCount += 1;
  }

  function spawnImpact(x, y, z, waterHit) {
    let idx = -1;
    for (let i = 0; i < MAX_IMPACTS; i++) {
      if (!rAlive[i]) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      // Recycle oldest
      idx = 0;
      let oldest = rAge[0];
      for (let i = 1; i < MAX_IMPACTS; i++) {
        if (rAge[i] > oldest) {
          oldest = rAge[i];
          idx = i;
        }
      }
    }
    rAlive[idx] = 1;
    rX[idx] = x;
    rY[idx] = y + 0.04;
    rZ[idx] = z;
    rAge[idx] = 0;
    rMax[idx] = waterHit ? 0.45 + Math.random() * 0.35 : 0.22 + Math.random() * 0.18;
    rScale[idx] = waterHit ? 0.8 + Math.random() * 0.9 : 0.35 + Math.random() * 0.35;
  }

  function writeDropMatrix(i) {
    dummy.position.set(px[i], py[i], pz[i]);
    dummy.scale.set(1, len[i], 1);
    // Slight tilt with wind
    dummy.rotation.set(vx[i] * 0.02, 0, -vz[i] * 0.02);
    dummy.updateMatrix();
    drops.setMatrixAt(i, dummy.matrix);
  }

  function writeRippleMatrix(i, opacityScale) {
    const t = rAge[i] / Math.max(1e-3, rMax[i]);
    const s = rScale[i] * (0.35 + t * 2.4);
    dummy.position.set(rX[i], rY[i], rZ[i]);
    dummy.scale.set(s, 1, s);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    ripples.setMatrixAt(i, dummy.matrix);
    // opacity via material is global — scale down by shrinking early; fade by scale→0 at end
    if (opacityScale < 0.08) {
      ripples.setMatrixAt(i, hidden);
    }
  }

  /**
   * Drive from rainfall simulation clock sample.
   * @param {number} intensityMmHr instantaneous model intensity (0 when rain ended)
   * @param {{ waterY?: number, windX?: number, windZ?: number }} [opts]
   */
  function setFromIntensity(intensityMmHr, opts = {}) {
    mmHr = Math.max(0, Number(intensityMmHr) || 0);
    emitting = mmHr > 1e-4;
    if (Number.isFinite(opts.waterY)) waterSurfaceY = opts.waterY;
    if (Number.isFinite(opts.windX)) windX = opts.windX;
    if (Number.isFinite(opts.windZ)) windZ = opts.windZ;
    group.visible = emitting || activeCount > 0;
    streakMat.opacity = emitting
      ? Math.min(0.85, 0.4 + Math.min(mmHr, 18) * 0.025)
      : Math.max(0.15, streakMat.opacity * 0.98);
  }

  function setPaused(v) {
    paused = !!v;
  }

  function clear() {
    emitting = false;
    mmHr = 0;
    spawnCarry = 0;
    activeCount = 0;
    for (let i = 0; i < MAX_DROPS; i++) {
      alive[i] = 0;
      drops.setMatrixAt(i, hidden);
    }
    for (let i = 0; i < MAX_IMPACTS; i++) {
      rAlive[i] = 0;
      ripples.setMatrixAt(i, hidden);
    }
    drops.instanceMatrix.needsUpdate = true;
    ripples.instanceMatrix.needsUpdate = true;
    group.visible = false;
  }

  function update(dt) {
    if (paused) return;
    if (!group.visible && !emitting) return;

    // Emit new drops only while rainfall event is active
    if (emitting) {
      const rate = emissionRateFromIntensity(mmHr);
      spawnCarry += rate * dt;
      while (spawnCarry >= 1) {
        spawnOne();
        spawnCarry -= 1;
        if (activeCount >= MAX_DROPS * 0.95) break;
      }
    } else {
      spawnCarry = 0;
    }

    let stillActive = 0;
    for (let i = 0; i < MAX_DROPS; i++) {
      if (!alive[i]) continue;
      py[i] -= vy[i] * dt;
      px[i] += vx[i] * dt;
      pz[i] += vz[i] * dt;
      if (py[i] <= hitY[i] + 0.05) {
        const chance = impactChanceFromIntensity(mmHr);
        if (Math.random() < chance || (!emitting && Math.random() < 0.35)) {
          spawnImpact(px[i], hitY[i], pz[i], !!onWater[i]);
        }
        alive[i] = 0;
        drops.setMatrixAt(i, hidden);
        continue;
      }
      writeDropMatrix(i);
      stillActive += 1;
    }
    activeCount = stillActive;

    for (let i = 0; i < MAX_IMPACTS; i++) {
      if (!rAlive[i]) continue;
      rAge[i] += dt;
      const u = rAge[i] / rMax[i];
      if (u >= 1) {
        rAlive[i] = 0;
        ripples.setMatrixAt(i, hidden);
        continue;
      }
      writeRippleMatrix(i, 1 - u);
    }

    drops.instanceMatrix.needsUpdate = true;
    ripples.instanceMatrix.needsUpdate = true;

    if (!emitting && activeCount === 0) {
      group.visible = false;
    }
  }

  function dispose() {
    clear();
    streakGeo.dispose();
    streakMat.dispose();
    rippleGeo.dispose();
    rippleMat.dispose();
    group.removeFromParent();
  }

  return {
    group,
    update,
    setFromIntensity,
    setPaused,
    clear,
    dispose,
    /** @returns {number} */
    getActiveCount: () => activeCount,
    getIntensityMmHr: () => mmHr,
  };
}
