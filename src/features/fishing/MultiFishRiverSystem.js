import * as THREE from "three";
import { FISH_CATEGORIES, loadFishAssetLibrary } from "./FishAssetLibrary.js";
import {
  pointInRing,
  nearestStation,
  waterSurfaceYAt,
  bedYAt,
} from "./FishingZoneSystem.js";
import { state } from "../../state.js";
import { SURFACE_Y } from "../../scene/river.js";

const _fwd = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _look = new THREE.Quaternion();
const _pt = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _projMat = new THREE.Matrix4();
const _camPos = new THREE.Vector3();

const CAMERA_EXCLUSION_M = 4.0;
const VISIBLE_MIN_UW = 14;

/** Natural staggered school — NOT a straight row. */
const PRESENTATION = buildNaturalSchoolSlots();

const JUMP_TIMES = [22.2, 22.8, 23.3, 23.7, 24.0];
let jumpIndex = 0;
let lastVisibleLog = -1;
let nextAmbientJumpAt = 0;
let ambientJumpPick = 0;

/**
 * Global river school — visible swimming band under water surface.
 * Underwater cinematic targets ≥14–18 screen-readable fish.
 */
export async function createMultiFishRiverSystem(dataset) {
  const group = new THREE.Group();
  group.name = "multiFishRiver";

  const stations = dataset.corridor?.stations || [];
  const ringLocal = dataset.ringLocal || [];
  if (stations.length < 4) {
    return { group, update() {}, dispose() {}, agents: [], getVisibleCount: () => 0 };
  }

  const curve = buildRiverCurve(stations);
  const library = await loadFishAssetLibrary();
  const agents = [];

  // 5 species × 5 = 25 fish
  const spawnPlan = [];
  const depthCycle = ["surface", "surface", "mid", "mid", "deep"];
  const orientCycle = ["flow", "flow", "side", "cross", "camera"];
  for (const cat of FISH_CATEGORIES) {
    for (let i = 0; i < 5; i++) {
      spawnPlan.push({
        categoryId: cat.id,
        layer: depthCycle[i],
        orientRole: orientCycle[i],
        school: cat.id,
      });
    }
  }

  for (let i = 0; i < spawnPlan.length; i++) {
    const plan = spawnPlan[i];
    const cat = FISH_CATEGORIES.find((c) => c.id === plan.categoryId) || FISH_CATEGORIES[0];
    const slot = PRESENTATION[i % PRESENTATION.length];
    const sizeMul = slot.band === "fg" ? 1.35 : slot.band === "mid" ? 1.15 : 1.0;
    const mesh = library.createInstance(plan.categoryId, {
      lengthM: cat.lengthM * sizeMul,
    });
    const fixedScale = mesh.scale.x;
    mesh.userData.fixedScale = fixedScale;
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    group.add(mesh);

    agents.push({
      mesh,
      categoryId: plan.categoryId,
      layer: plan.layer,
      orientRole: plan.orientRole,
      band: slot.band,
      fixedScale,
      progress: (0.04 + (i / spawnPlan.length) * 0.9 + Math.random() * 0.02) % 1,
      speed: 0.003 + Math.random() * 0.007,
      swimDir: Math.random() < 0.65 ? 1 : -1,
      latOffset: slot.lat,
      depthBelow: depthForLayer(plan.layer),
      targetDir: new THREE.Vector3(0, 0, 1),
      phaseOffset: Math.random() * Math.PI * 2,
      wiggleSpeed: 4.5 + Math.random() * 4,
      tailAmplitude: 0.22 + Math.random() * 0.22,
      turnSpeed: 1.8 + Math.random() * 1.4,
      wanderT: Math.random() * 40,
      schoolId: plan.school,
      slot,
      minSep: slot.band === "fg" ? 2.5 : slot.band === "mid" ? 1.8 : 1.3,
      canJump: true,
      jumpState: "swim",
      jumpT: 0,
      jumpHeight: 2.4 + Math.random() * 1.2,
      jumpStart: new THREE.Vector3(),
      jumpCtrl1: new THREE.Vector3(),
      jumpCtrl2: new THREE.Vector3(),
      jumpEnd: new THREE.Vector3(),
    });
  }

  console.info("Multi-fish river system", {
    count: agents.length,
    bySpecies: Object.fromEntries(
      FISH_CATEGORIES.map((c) => [c.id, agents.filter((a) => a.categoryId === c.id).length]),
    ),
  });

  function update(dt, camera) {
    if (!state.showFish) {
      group.visible = false;
      return;
    }
    group.visible = true;
    const time = state.elapsed || 0;
    const cam = state._cinematicCam;
    const fishScene = state.cinematicFishScene;
    const jumpSeq = state.cinematicJumpSequence;
    const underwater = state.cinematicUnderwater;
    const cineT = (state.cinematicProgress || 0) * 30;
    const usePresentation = (fishScene || jumpSeq || underwater) && cam;

    if (jumpSeq && jumpIndex < JUMP_TIMES.length && cineT >= JUMP_TIMES[jumpIndex]) {
      const jumper = agents.find((a) => a.canJump && a.jumpState === "swim");
      if (jumper) beginJump(jumper, stations, cam, ringLocal, dataset, time);
      jumpIndex++;
    }
    if (!jumpSeq) jumpIndex = 0;

    // ~every second: one fish leaps above water then returns
    if (time >= nextAmbientJumpAt && !agents.some((a) => a.jumpState !== "swim")) {
      const jumpers = agents.filter((a) => a.canJump);
      if (jumpers.length) {
        const jumper = jumpers[ambientJumpPick % jumpers.length];
        ambientJumpPick++;
        beginJump(jumper, stations, cam || camera, ringLocal, dataset, time);
        nextAmbientJumpAt = time + 1.0;
      }
    }

    resolveCamPos(camera, cam, _camPos);

    for (const a of agents) {
      a.mesh.scale.setScalar(a.fixedScale);
      if (a.jumpState !== "swim") {
        updateJump(a, dt, time, ringLocal);
        enforceExclusion(a, _camPos, dt);
        continue;
      }
      if (usePresentation) {
        placeInNaturalSchool(a, cam, time, dt, ringLocal, dataset);
        enforceExclusion(a, _camPos, dt);
        continue;
      }
      updateAmbientSwim(a, curve, stations, ringLocal, dataset, time, dt);
    }

    if (usePresentation) {
      applySeparation(agents, dt);
      // Guarantee ≥14 readable fish during underwater
      if ((fishScene || underwater) && camera) {
        const vis = countVisibleFish(agents, camera);
        if (vis < VISIBLE_MIN_UW) pullIntoVisibleBand(agents, cam, camera, time, dt, ringLocal, dataset, vis);
      }
    }

    if ((fishScene || underwater) && camera) {
      const sec = Math.floor(cineT);
      if (sec !== lastVisibleLog && sec >= 16 && sec <= 24) {
        lastVisibleLog = sec;
        const visible = countVisibleFish(agents, camera);
        console.info(`Time: ${sec}.0 | River school screen-visible: ${visible} (need ≥${VISIBLE_MIN_UW})`);
      }
    }
  }

  function getVisibleCount(camera) {
    return camera ? countVisibleFish(agents, camera) : 0;
  }

  function dispose() {
    for (const a of agents) {
      a.mesh.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    }
  }

  return { group, update, dispose, agents, curve, getVisibleCount };
}

function resolveCamPos(camera, camHint, out) {
  if (camera?.position?.isVector3) out.copy(camera.position);
  else if (camHint && Number.isFinite(camHint.x)) out.set(camHint.x, camHint.y, camHint.z);
  else out.set(0, SURFACE_Y - 2, 0);
}

function depthForLayer(layer) {
  // Keep fish a little higher — readable just under / breaking surface
  if (layer === "surface") return 0.18 + Math.random() * 0.28;
  if (layer === "deep" || layer === "bottom") return 0.9 + Math.random() * 0.9;
  return 0.45 + Math.random() * 0.4;
}

function clampFishY(x, z, depthBelow, dataset, time) {
  const surface = waterSurfaceYAt(x, z, time);
  const bed = bedYAt(x, z, dataset);
  const lo = Math.max(surface - 2.2, bed + 0.35);
  const hi = surface - 0.12;
  return THREE.MathUtils.clamp(surface - depthBelow, lo, hi);
}

function updateAmbientSwim(a, curve, stations, ringLocal, dataset, time, dt) {
  a.progress = (a.progress + a.speed * a.swimDir * dt * 12 + 1) % 1;
  a.wanderT += dt;
  curve.getPointAt(a.progress, _pt);
  curve.getTangentAt(a.progress, _tan).normalize();
  if (a.swimDir < 0) _tan.multiplyScalar(-1);
  const px = -_tan.z;
  const pz = _tan.x;
  const half = sampleHalf(stations, a.progress) * 0.5;
  const wander = Math.sin(a.wanderT * 0.55 + a.phaseOffset) * 0.55
    + Math.sin(a.wanderT * 1.1 + a.phaseOffset * 1.7) * 0.25;
  a.latOffset = THREE.MathUtils.clamp(
    a.latOffset + Math.sin(a.wanderT * 0.3 + a.phaseOffset) * 0.4 * dt,
    -half,
    half,
  );
  _desired
    .set(
      _tan.x * Math.cos(wander * 0.4) - _tan.z * Math.sin(wander * 0.4),
      0,
      _tan.x * Math.sin(wander * 0.4) + _tan.z * Math.cos(wander * 0.4),
    )
    .normalize();
  applyOrientRole(_desired, a, _tan, px, pz);
  a.targetDir.lerp(_desired, 1 - Math.exp(-dt * 1.8)).normalize();
  let x = _pt.x + px * a.latOffset;
  let z = _pt.z + pz * a.latOffset;
  if (!pointInRing(x, z, ringLocal)) {
    const st = nearestStation(x, z, stations);
    x = THREE.MathUtils.lerp(x, st.x, 0.45);
    z = THREE.MathUtils.lerp(z, st.z, 0.45);
  }
  const y = clampFishY(x, z, a.depthBelow, dataset, time);
  a.mesh.position.set(x, y, z);
  orientMesh(a, a.targetDir.x, a.targetDir.z, time, dt);
}

function applyOrientRole(desired, a, tan, px, pz) {
  const r = a.orientRole;
  if (r === "side") {
    desired.set(tan.x * 0.75 + px * 0.55, 0, tan.z * 0.75 + pz * 0.55).normalize();
  } else if (r === "cross") {
    desired.set(px * (a.swimDir > 0 ? 1 : -1) * 0.85 + tan.x * 0.2, 0, pz * (a.swimDir > 0 ? 1 : -1) * 0.85 + tan.z * 0.2).normalize();
  } else if (r === "camera") {
    // slight toward +Z of lateral — refined in presentation with cam forward
    desired.set(tan.x * 0.5 - px * 0.7, 0, tan.z * 0.5 - pz * 0.7).normalize();
  }
}

/**
 * Natural staggered school ahead of camera — visible water band, mixed headings.
 */
function placeInNaturalSchool(a, cam, time, dt, ringLocal, dataset) {
  const slot = a.slot;
  const fx = cam.fx || 0;
  const fz = cam.fz || 1;
  const fl = Math.hypot(fx, fz) || 1;
  const nx = fx / fl;
  const nz = fz / fl;
  const px = -nz;
  const pz = nx;

  const noise =
    Math.sin(time * 0.35 + a.phaseOffset) * 0.7 +
    Math.sin(time * 0.9 + a.phaseOffset * 2.1) * 0.35;
  let along = Math.max(CAMERA_EXCLUSION_M + 1.5, slot.along + noise * 0.8);
  const lat = slot.lat + Math.sin(time * 0.5 + a.phaseOffset * 1.3) * slot.latAmp;

  let x = cam.x + nx * along + px * lat;
  let z = cam.z + nz * along + pz * lat;
  if (!pointInRing(x, z, ringLocal)) {
    x = THREE.MathUtils.lerp(x, cam.x + nx * along, 0.5);
    z = THREE.MathUtils.lerp(z, cam.z + nz * along, 0.5);
  }

  const depth = THREE.MathUtils.clamp(
    a.depthBelow + Math.sin(time * 0.6 + a.phaseOffset) * 0.12,
    0.35,
    2.4,
  );
  const y = clampFishY(x, z, depth, dataset, time);

  a.mesh.position.lerp(_tmp.set(x, y, z), 1 - Math.exp(-dt * 3.5));

  // Orientation mix — not all same direction
  let dx = nx;
  let dz = nz;
  if (a.orientRole === "side") {
    dx = nx * 0.55 + px * 0.75;
    dz = nz * 0.55 + pz * 0.75;
  } else if (a.orientRole === "cross") {
    dx = px * (slot.lat >= 0 ? 1 : -1);
    dz = pz * (slot.lat >= 0 ? 1 : -1);
  } else if (a.orientRole === "camera") {
    dx = -nx * 0.85 + px * 0.2;
    dz = -nz * 0.85 + pz * 0.2;
  } else {
    dx = nx + px * Math.sin(time * 0.4 + a.phaseOffset) * 0.25;
    dz = nz + pz * Math.sin(time * 0.4 + a.phaseOffset) * 0.25;
  }
  a.targetDir.set(dx, 0, dz).normalize();
  orientMesh(a, a.targetDir.x, a.targetDir.z, time, dt);
}

function pullIntoVisibleBand(agents, cam, camera, time, dt, ringLocal, dataset, currentVis) {
  const need = VISIBLE_MIN_UW - currentVis;
  if (need <= 0 || !cam) return;
  const fx = cam.fx || 0;
  const fz = cam.fz || 1;
  const fl = Math.hypot(fx, fz) || 1;
  const nx = fx / fl;
  const nz = fz / fl;
  const px = -nz;
  const pz = nx;
  const rescue = [
    { along: 7, lat: -3.5, depth: 0.45 },
    { along: 8.5, lat: 2.8, depth: 0.55 },
    { along: 11, lat: -1.2, depth: 0.7 },
    { along: 13, lat: 4.0, depth: 0.85 },
    { along: 15, lat: -4.2, depth: 1.0 },
    { along: 10, lat: 0.5, depth: 0.5 },
  ];
  let n = 0;
  for (const a of agents) {
    if (n >= need + 2) break;
    if (a.jumpState !== "swim") continue;
    const slot = rescue[n % rescue.length];
    let x = cam.x + nx * slot.along + px * slot.lat;
    let z = cam.z + nz * slot.along + pz * slot.lat;
    if (!pointInRing(x, z, ringLocal)) continue;
    const y = clampFishY(x, z, slot.depth, dataset, time);
    a.mesh.position.lerp(_tmp.set(x, y, z), 1 - Math.exp(-dt * 5));
    a.depthBelow = slot.depth;
    n++;
  }
}

function enforceExclusion(a, camPos, dt) {
  const d = a.mesh.position.distanceTo(camPos);
  if (d >= CAMERA_EXCLUSION_M || d < 1e-4) return;
  _tmp.copy(a.mesh.position).sub(camPos).normalize();
  a.mesh.position.addScaledVector(_tmp, (CAMERA_EXCLUSION_M - d + 0.4) * Math.min(1, dt * 8));
}

function applySeparation(agents, dt) {
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (a.jumpState !== "swim") continue;
    for (let j = i + 1; j < agents.length; j++) {
      const b = agents[j];
      if (b.jumpState !== "swim") continue;
      const minD = Math.max(a.minSep, b.minSep);
      const d = a.mesh.position.distanceTo(b.mesh.position);
      if (d >= minD || d < 1e-4) continue;
      _tmp.copy(a.mesh.position).sub(b.mesh.position).normalize();
      const push = ((minD - d) * 0.5) * Math.min(1, dt * 5);
      a.mesh.position.addScaledVector(_tmp, push);
      b.mesh.position.addScaledVector(_tmp, -push);
    }
  }
}

function beginJump(a, stations, cam, ringLocal, dataset, time) {
  const pos = a.mesh.position;
  const surface = waterSurfaceYAt(pos.x, pos.z, time);
  // Approach near surface first
  a.jumpStart.set(pos.x, surface - 0.08, pos.z);
  let nx = 0;
  let nz = 1;
  if (cam) {
    const fl = Math.hypot(cam.fx || 0, cam.fz || 1) || 1;
    nx = (cam.fx || 0) / fl;
    nz = (cam.fz || 1) / fl;
  } else {
    const st = nearestStation(pos.x, pos.z, stations);
    const fl = Math.hypot(st.flowX, st.flowZ) || 1;
    nx = st.flowX / fl;
    nz = st.flowZ / fl;
  }
  let ex = pos.x + nx * 5;
  let ez = pos.z + nz * 5;
  if (!pointInRing(ex, ez, ringLocal)) {
    ex = pos.x + nx * 2;
    ez = pos.z + nz * 2;
  }
  a.jumpEnd.set(ex, waterSurfaceYAt(ex, ez, time) - 0.35, ez);
  a.jumpCtrl1.set(pos.x + nx * 1.3, surface + a.jumpHeight * 0.5, pos.z + nz * 1.3);
  a.jumpCtrl2.set(pos.x + nx * 2.8, surface + a.jumpHeight, pos.z + nz * 2.8);
  a.mesh.position.copy(a.jumpStart);
  a.jumpState = "arc";
  a.jumpT = 0;
}

function updateJump(a, dt, time, ringLocal) {
  a.jumpT += dt;
  const u = Math.min(1, a.jumpT / 0.85);
  cubicBezier(a.jumpStart, a.jumpCtrl1, a.jumpCtrl2, a.jumpEnd, u, a.mesh.position);
  if (!pointInRing(a.mesh.position.x, a.mesh.position.z, ringLocal)) {
    a.mesh.position.x = THREE.MathUtils.lerp(a.mesh.position.x, a.jumpStart.x, 0.3);
    a.mesh.position.z = THREE.MathUtils.lerp(a.mesh.position.z, a.jumpStart.z, 0.3);
  }
  cubicBezier(a.jumpStart, a.jumpCtrl1, a.jumpCtrl2, a.jumpEnd, Math.min(1, u + 0.05), _tmp);
  _fwd.copy(_tmp).sub(a.mesh.position);
  _fwd.y = 0;
  if (_fwd.lengthSq() > 1e-6) orientMesh(a, _fwd.x, _fwd.z, time, dt);
  a.mesh.rotateX(THREE.MathUtils.lerp(0.35, -0.5, u));
  if (u >= 1) a.jumpState = "swim";
}

function cubicBezier(p0, p1, p2, p3, t, out) {
  const u = 1 - t;
  out.set(
    u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
    u ** 3 * p0.z + 3 * u ** 2 * t * p1.z + 3 * u * t ** 2 * p2.z + t ** 3 * p3.z,
  );
}

function orientMesh(a, dirX, dirZ, time, dt) {
  _fwd.set(dirX, 0, dirZ);
  if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, 1);
  else _fwd.normalize();
  const axis = a.mesh.userData.headingAxis || new THREE.Vector3(1, 0, 0);
  _look.setFromUnitVectors(axis, _fwd);
  a.mesh.quaternion.slerp(_look, 1 - Math.exp(-dt * a.turnSpeed));
  const phase = time * a.wiggleSpeed + a.phaseOffset;
  if (a.mesh.userData.tailGroup) {
    a.mesh.userData.tailGroup.rotation.y = Math.sin(phase) * a.tailAmplitude;
  }
  a.mesh.rotateZ(Math.sin(time * 2 + a.phaseOffset) * 0.03);
}

function countVisibleFish(agents, camera) {
  _projMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projMat);
  camera.getWorldDirection(_fwd);
  const h = window.innerHeight || 720;
  let n = 0;
  for (const a of agents) {
    if (!_frustum.containsPoint(a.mesh.position)) continue;
    _tmp.copy(a.mesh.position).sub(camera.position);
    if (_tmp.dot(_fwd) < 0.3) continue;
    const dist = _tmp.length();
    if (dist < CAMERA_EXCLUSION_M || dist > 45) continue;
    const approxPx = ((a.fixedScale || 0.8) / (dist * 0.85 + 1e-3)) * h;
    if (approxPx < 18) continue;
    n++;
  }
  return n;
}

/** Staggered natural school — irregular lattice, not a line. */
function buildNaturalSchoolSlots() {
  const slots = [];
  // Foreground ~2–3
  const fg = [
    { along: 6.2, lat: -3.8, yOff: 0.1 },
    { along: 7.5, lat: 1.2, yOff: -0.15 },
    { along: 8.8, lat: 4.0, yOff: 0.05 },
  ];
  for (const s of fg) slots.push({ ...s, band: "fg", latAmp: 0.35 });

  // Mid ~8–10 irregular
  const mid = [
    { along: 11.0, lat: -5.2, yOff: -0.2 },
    { along: 12.2, lat: -2.0, yOff: 0.15 },
    { along: 12.8, lat: 1.5, yOff: -0.1 },
    { along: 13.5, lat: 4.5, yOff: 0.2 },
    { along: 14.8, lat: -3.5, yOff: -0.25 },
    { along: 15.5, lat: 0.2, yOff: 0.05 },
    { along: 16.2, lat: 3.2, yOff: -0.15 },
    { along: 17.0, lat: -1.0, yOff: 0.1 },
    { along: 17.8, lat: 5.0, yOff: -0.05 },
  ];
  for (const s of mid) slots.push({ ...s, band: "mid", latAmp: 0.45 });

  // Background
  const bg = [
    { along: 21, lat: -4.5, yOff: -0.3 },
    { along: 22.5, lat: -1.2, yOff: -0.1 },
    { along: 23.5, lat: 2.5, yOff: -0.35 },
    { along: 25, lat: 5.2, yOff: -0.2 },
    { along: 26.5, lat: -3.0, yOff: -0.4 },
    { along: 28, lat: 1.0, yOff: -0.15 },
    { along: 29.5, lat: 4.0, yOff: -0.25 },
    { along: 24, lat: -5.5, yOff: -0.2 },
    { along: 27, lat: -0.5, yOff: -0.3 },
    { along: 30, lat: 3.0, yOff: -0.2 },
    { along: 22, lat: 3.8, yOff: -0.15 },
    { along: 26, lat: -4.8, yOff: -0.35 },
    { along: 29, lat: -2.2, yOff: -0.25 },
  ];
  for (const s of bg) slots.push({ ...s, band: "bg", latAmp: 0.55 });
  return slots;
}

function buildRiverCurve(stations) {
  const step = Math.max(1, Math.floor(stations.length / 90));
  const pts = [];
  for (let i = 0; i < stations.length; i += step) {
    pts.push(new THREE.Vector3(stations[i].x, SURFACE_Y, stations[i].z));
  }
  const last = stations[stations.length - 1];
  pts.push(new THREE.Vector3(last.x, SURFACE_Y, last.z));
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.12);
}

function sampleHalf(stations, progress) {
  const i = Math.floor(THREE.MathUtils.clamp(progress, 0, 0.999) * (stations.length - 1));
  return Math.max(12, stations[i].halfWidth || 20);
}
