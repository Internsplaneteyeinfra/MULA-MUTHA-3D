import * as THREE from "three";
import { FISH_CATEGORIES, loadFishAssetLibrary } from "./FishAssetLibrary.js";
import {
  pointInRing,
  waterSurfaceYAt,
  bedYAt,
} from "./FishingZoneSystem.js";
import { state } from "../../state.js";
import { SURFACE_Y } from "../../scene/river.js";

const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _look = new THREE.Quaternion();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _ndc = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _corner = new THREE.Vector3();

const JUMP_SIDES = [
  { id: "left", lat: -4.5 },
  { id: "center", lat: 0 },
  { id: "right", lat: 4.5 },
  { id: "center-left", lat: -2.2 },
  { id: "right-2", lat: 3.5 },
];

/** Camera-aligned presentation bands (metres along look). */
const BAND = {
  fg: { min: 6, max: 11, minPx: 40 },
  mid: { min: 12, max: 20, minPx: 25 },
  bg: { min: 21, max: 32, minPx: 18 },
};

const MIN_JUMP_PX = 60;
const EXCLUSION_M = 4.0;

/**
 * Guaranteed on-screen fish + jumps at every Fishing_Locations.kml point.
 * Visibility = projected AABB pixels, not frustum.contains(position).
 */
export async function createFishingPointFishSystem(dataset, zones, opts = {}) {
  const group = new THREE.Group();
  group.name = "fishingPointFish";

  const ringLocal = dataset.ringLocal || [];
  const library = opts.library || (await loadFishAssetLibrary());
  bindFishingSplashTargets(opts.ripples || null, opts.waterEffects || null);

  const debug = createFishDebugOverlay(opts.uiRoot || document.getElementById("ui-root"));
  state.showFishDebug = state.showFishDebug ?? true;

  if (!zones?.length) {
    return { group, pointZones: [], update() {}, dispose() {}, getScreenVisibleCount: () => 0 };
  }

  const pointZones = [];

  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi];
    const fishCount = 25; // 5 species × 5
    const half = z.halfWidth || 30;
    const radius = Math.min(Math.max(16, half * 0.55), 32);
    const point = {
      id: z.id,
      name: z.name || z.id,
      label: `FP-${String(zi + 1).padStart(2, "0")}`,
      lon: z.lon,
      lat: z.lat,
      x: z.x,
      z: z.z,
      flowX: z.flowX || 0,
      flowZ: z.flowZ || 1,
      halfWidth: half,
      radius,
      fishCount,
      visibleFishMinimum: 8,
      jumpEnabled: true,
      activationDistance: 220,
      approachDistance: 420,
      presentation: false,
      scheduleT: 0,
      nextJumpIdx: 0,
      lastJumpAt: -1,
      lastLogMs: 0,
      fish: [],
      jumpSchedule: [],
    };

    const depthPlan = buildDepthPlan(fishCount);
    const bandPlan = [];
    for (let i = 0; i < fishCount; i++) {
      if (i < 3) bandPlan.push("fg");
      else if (i < 14) bandPlan.push("mid");
      else bandPlan.push("bg");
    }

    let fi = 0;
    for (const cat of FISH_CATEGORIES) {
      for (let s = 0; s < 5; s++) {
        const i = fi++;
        const lengthBoost = bandPlan[i] === "fg" ? 1.3 : bandPlan[i] === "mid" ? 1.1 : 1.0;
        const mesh = library.createInstance(cat.id, { lengthM: cat.lengthM * lengthBoost });
        const fixedScale = mesh.scale.x;
        mesh.userData.fixedScale = fixedScale;
        mesh.renderOrder = 12;
        mesh.frustumCulled = false;
        group.add(mesh);

        const slot = homeSlot(i, fishCount, radius);
        const orientRole = ["flow", "flow", "side", "cross", "camera"][s];
        const agent = {
          id: `Fish-${String(i + 1).padStart(2, "0")}`,
          mesh,
          pointId: point.id,
          categoryId: cat.id,
          layer: depthPlan[i],
          band: bandPlan[i],
          orientRole,
          homeLat: slot.lat,
          homeAlong: slot.along,
          depthBelow: shallowDepth(depthPlan[i]),
          phaseOffset: Math.random() * Math.PI * 2,
          wiggleSpeed: 5 + Math.random() * 3.5,
          tailAmplitude: 0.22 + Math.random() * 0.2,
          turnSpeed: 2.2 + Math.random() * 1.2,
          swimSpeed: 0.55 + Math.random() * 0.45,
          wanderT: Math.random() * 20,
          targetDir: new THREE.Vector3(point.flowX, 0, point.flowZ).normalize(),
          fixedScale,
          jumpState: "swim",
          jumpT: 0,
          jumpDuration: 1.05,
          jumpHeight: 2.6 + Math.random() * 1.1,
          jumpStart: new THREE.Vector3(),
          jumpCtrl1: new THREE.Vector3(),
          jumpCtrl2: new THREE.Vector3(),
          jumpEnd: new THREE.Vector3(),
          presentationSlot: i < 12 ? i : -1,
          screen: null,
        };
        placeAtHome(agent, point, ringLocal, dataset, 0);
        point.fish.push(agent);
      }
    }

    z.dominant = [...new Set(point.fish.slice(0, 5).map((f) => f.categoryId))];
    z.fishCount = fishCount;
    z.pointZone = point;
    pointZones.push(point);
  }

  console.info("Fishing point fish system", {
    points: pointZones.length,
    fishTotal: pointZones.reduce((n, p) => n + p.fish.length, 0),
  });

  function update(dt, camera) {
    if (!state.showFish) {
      group.visible = false;
      debug.hide();
      return;
    }
    group.visible = true;
    const time = state.elapsed || 0;
    const camPos = camera?.position;
    const focusId = state.cinematicFishingPointFocus?.id;
    const fishingShot = state.cinematicPhase === "fishing_points" || !!focusId;

    let activePoint = null;

    for (const point of pointZones) {
      const dist = camPos
        ? Math.hypot(camPos.x - point.x, camPos.z - point.z)
        : Infinity;
      const dist3 = camPos
        ? Math.hypot(camPos.x - point.x, (camPos.y - SURFACE_Y) * 0.45, camPos.z - point.z)
        : Infinity;

      const wantPresentation =
        focusId === point.id ||
        dist3 < point.activationDistance ||
        (dist < point.approachDistance && (camPos?.y ?? 999) < 40);

      if (wantPresentation && !point.presentation) {
        point.presentation = true;
        point.scheduleT = 0;
        point.nextJumpIdx = 0;
      } else if (!wantPresentation && point.presentation && focusId !== point.id) {
        point.presentation = false;
      }

      if (point.presentation) {
        activePoint = point;
        updateCameraPresentationVolume(point, camera, time, dt, ringLocal, dataset);
        // Screen-space correction until ≥5 actually visible
        const vis = measurePointVisibility(point, camera);
        if (vis.screenVisible < point.visibleFishMinimum) {
          activatePresentationCorrection(point, camera, time, dt, ringLocal, dataset, vis);
        }
        if (point.jumpEnabled) {
          updateJumpScheduler(point, camera, time, dt, ringLocal, dataset, fishingShot);
        }
      } else {
        updateAmbient(point, time, dt, ringLocal, dataset);
      }

      for (const a of point.fish) {
        if (a.jumpState !== "swim") updateJumpArc(a, point, camera, time, dt, ringLocal, dataset);
        // Keep exclusion
        if (camPos && a.jumpState === "swim") {
          const d = a.mesh.position.distanceTo(camPos);
          if (d < EXCLUSION_M) {
            camera.getWorldDirection(_camDir);
            a.mesh.position.addScaledVector(_camDir, EXCLUSION_M - d + 0.5);
          }
        }
      }
    }

    if (activePoint && camera) {
      const vis = measurePointVisibility(activePoint, camera);
      const now = performance.now();
      if (now - activePoint.lastLogMs > 900) {
        activePoint.lastLogMs = now;
        logVisibilityReport(activePoint, camera, vis);
      }
      if (state.showFishDebug) debug.update(activePoint, camera, vis);
      else debug.hide();
    } else {
      debug.hide();
    }
  }

  function getScreenVisibleCount(camera, pointId) {
    const point = pointId
      ? pointZones.find((p) => p.id === pointId)
      : pointZones.find((p) => p.presentation);
    if (!point || !camera) return 0;
    return measurePointVisibility(point, camera).screenVisible;
  }

  function dispose() {
    debug.dispose();
    for (const point of pointZones) {
      for (const a of point.fish) {
        a.mesh.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
            else obj.material.dispose();
          }
        });
        group.remove(a.mesh);
      }
    }
  }

  return { group, pointZones, update, dispose, getScreenVisibleCount };
}

function buildDepthPlan(n) {
  const plan = [];
  // Surface / mid / deep layers for visible band
  for (let i = 0; i < n; i++) {
    if (i < 8) plan.push("surface");
    else if (i < 17) plan.push("mid");
    else plan.push("bottom");
  }
  return plan;
}

function shallowDepth(layer) {
  // Swim a little higher so fish read near the surface
  if (layer === "surface") return 0.15 + Math.random() * 0.25;
  if (layer === "bottom") return 1.1 + Math.random() * 0.8;
  return 0.5 + Math.random() * 0.45;
}

function homeSlot(i, n, radius) {
  const ring = i < 4 ? 0.32 : i < 7 ? 0.5 : 0.68;
  const ang = (i / n) * Math.PI * 2 + (i % 3) * 0.35;
  return {
    along: Math.cos(ang) * radius * ring,
    lat: Math.sin(ang) * radius * ring,
  };
}

function flowBasis(point) {
  let fx = point.flowX;
  let fz = point.flowZ;
  const len = Math.hypot(fx, fz) || 1;
  fx /= len;
  fz /= len;
  return { fx, fz, px: -fz, pz: fx };
}

function clampInRiver(x, z, ringLocal, point) {
  if (pointInRing(x, z, ringLocal)) return { x, z };
  return {
    x: THREE.MathUtils.lerp(x, point.x, 0.7),
    z: THREE.MathUtils.lerp(z, point.z, 0.7),
  };
}

function clampInZone(x, z, point, maxR) {
  const dx = x - point.x;
  const dz = z - point.z;
  const r = Math.hypot(dx, dz);
  const lim = maxR ?? point.radius;
  if (r <= lim) return { x, z };
  const s = lim / r;
  return { x: point.x + dx * s, z: point.z + dz * s };
}

function placeAtHome(a, point, ringLocal, dataset, time) {
  const { fx, fz, px, pz } = flowBasis(point);
  let x = point.x + fx * a.homeAlong + px * a.homeLat;
  let z = point.z + fz * a.homeAlong + pz * a.homeLat;
  ({ x, z } = clampInRiver(x, z, ringLocal, point));
  const surface = waterSurfaceYAt(x, z, time);
  const bed = bedYAt(x, z, dataset);
  // Keep ambient fish in the readable band just under the surface
  const depth = THREE.MathUtils.clamp(a.depthBelow, 0.35, 1.6);
  const y = THREE.MathUtils.clamp(surface - depth, bed + 0.3, surface - 0.2);
  a.mesh.position.set(x, y, z);
  a.mesh.scale.setScalar(a.fixedScale);
}

function updateAmbient(point, time, dt, ringLocal, dataset) {
  const { fx, fz, px, pz } = flowBasis(point);
  for (const a of point.fish) {
    if (a.jumpState !== "swim") continue;
    a.mesh.scale.setScalar(a.fixedScale);
    a.wanderT += dt * a.swimSpeed;
    const along = a.homeAlong + Math.sin(a.wanderT * 0.55 + a.phaseOffset) * 1.1;
    const lat = a.homeLat + Math.cos(a.wanderT * 0.4 + a.phaseOffset) * 0.9;
    let x = point.x + fx * along + px * lat;
    let z = point.z + fz * along + pz * lat;
    ({ x, z } = clampInZone(x, z, point));
    ({ x, z } = clampInRiver(x, z, ringLocal, point));
    const surface = waterSurfaceYAt(x, z, time);
    const bed = bedYAt(x, z, dataset);
    const y = THREE.MathUtils.clamp(surface - a.depthBelow, bed + 0.3, surface - 0.2);
    a.mesh.position.lerp(_tmp.set(x, y, z), 1 - Math.exp(-dt * 2.2));
    orientMesh(a, fx, fz, time, dt);
  }
}

/**
 * Presentation volume: camera-forward staggered bands, clamped to fishing zone + river.
 * FG 6–11 m · Mid 12–20 m · BG 21–32 m · depth 0.3–1.6 m below surface.
 */
function updateCameraPresentationVolume(point, camera, time, dt, ringLocal, dataset) {
  if (!camera) {
    updateAmbient(point, time, dt, ringLocal, dataset);
    return;
  }

  camera.getWorldDirection(_camDir);
  let fx = _camDir.x;
  let fy = _camDir.y;
  let fz = _camDir.z;
  const horiz = Math.hypot(fx, fz) || 1;
  // Prefer horizontal look for placement; slight downward ok
  fx /= horiz;
  fz /= horiz;
  const px = -fz;
  const pz = fx;

  // Anchor presentation on the fishing point, pulled into camera view corridor
  const toPoint = _tmp.set(point.x - camera.position.x, 0, point.z - camera.position.z);
  const alongToPoint = toPoint.dot(_tmp2.set(fx, 0, fz));
  const anchorAlong = THREE.MathUtils.clamp(alongToPoint, BAND.fg.min, BAND.bg.max);

  const slots = cameraPresentationSlots();
  const presenters = point.fish
    .filter((a) => a.presentationSlot >= 0)
    .sort((a, b) => a.presentationSlot - b.presentationSlot);

  for (let i = 0; i < presenters.length; i++) {
    const a = presenters[i];
    if (a.jumpState !== "swim") continue;
    const slot = slots[i % slots.length];
    a.band = slot.band;

    // Place along camera look, then snap into fishing zone if needed
    let along = THREE.MathUtils.clamp(slot.dist, BAND[slot.band].min, BAND[slot.band].max);
    // Bias toward fishing-point distance so geographic link holds
    along = THREE.MathUtils.lerp(along, anchorAlong, 0.35);
    along = Math.max(EXCLUSION_M + 1.5, along);

    let x = camera.position.x + fx * along + px * slot.lat;
    let z = camera.position.z + fz * along + pz * slot.lat;

    // Keep near fishing point (expanded radius for presentation)
    const zoneR = Math.max(point.radius, Math.min(point.halfWidth * 0.7, 40));
    ({ x, z } = clampInZone(x, z, point, zoneR));
    ({ x, z } = clampInRiver(x, z, ringLocal, point));

    // Re-check camera distance after clamp
    let dCam = Math.hypot(x - camera.position.x, z - camera.position.z);
    if (dCam < EXCLUSION_M + 1) {
      x = camera.position.x + fx * (EXCLUSION_M + 2) + px * slot.lat * 0.5;
      z = camera.position.z + fz * (EXCLUSION_M + 2) + pz * slot.lat * 0.5;
      ({ x, z } = clampInRiver(x, z, ringLocal, point));
      dCam = Math.hypot(x - camera.position.x, z - camera.position.z);
    }

    const surface = waterSurfaceYAt(x, z, time);
    const bed = bedYAt(x, z, dataset);
    const depth = THREE.MathUtils.clamp(slot.depth, 0.3, 1.7);
    const y = THREE.MathUtils.clamp(surface - depth, bed + 0.25, surface - 0.18);

    a.mesh.scale.setScalar(a.fixedScale);
    a.mesh.position.lerp(_tmp.set(x, y, z), 1 - Math.exp(-dt * 4.2));
    // Mixed headings — not all face the same way
    let dx = fx;
    let dz = fz;
    const role = a.orientRole || "flow";
    if (role === "side") {
      dx = fx * 0.5 + px * 0.8;
      dz = fz * 0.5 + pz * 0.8;
    } else if (role === "cross") {
      dx = px * (slot.lat >= 0 ? 1 : -1);
      dz = pz * (slot.lat >= 0 ? 1 : -1);
    } else if (role === "camera") {
      dx = -fx * 0.9 + px * 0.15;
      dz = -fz * 0.9 + pz * 0.15;
    } else {
      dx = fx + px * Math.sin(time * 0.45 + a.phaseOffset) * 0.3;
      dz = fz + pz * Math.sin(time * 0.45 + a.phaseOffset) * 0.3;
    }
    a.targetDir.set(dx, 0, dz).normalize();
    orientMesh(a, a.targetDir.x, a.targetDir.z, time, dt);
    void fy;
  }

  // Remaining fish stay shallow in zone
  for (const a of point.fish) {
    if (a.presentationSlot >= 0 || a.jumpState !== "swim") continue;
    a.mesh.scale.setScalar(a.fixedScale);
    placeAtHome(a, point, ringLocal, dataset, time);
    a.mesh.position.y = waterSurfaceYAt(a.mesh.position.x, a.mesh.position.z, time) - Math.min(a.depthBelow, 1.4);
    orientMesh(a, fx, fz, time, dt);
  }
}

function cameraPresentationSlots() {
  // Irregular staggered school — not a straight row
  return [
    { band: "fg", dist: 7.0, lat: -3.8, depth: 0.4 },
    { band: "fg", dist: 8.5, lat: 2.5, depth: 0.55 },
    { band: "fg", dist: 9.5, lat: -0.8, depth: 0.45 },
    { band: "mid", dist: 12.0, lat: -4.5, depth: 0.75 },
    { band: "mid", dist: 13.5, lat: 1.2, depth: 0.95 },
    { band: "mid", dist: 14.5, lat: 4.2, depth: 0.8 },
    { band: "mid", dist: 15.5, lat: -2.0, depth: 1.1 },
    { band: "mid", dist: 16.5, lat: 3.0, depth: 0.9 },
    { band: "mid", dist: 17.5, lat: -5.0, depth: 1.2 },
    { band: "bg", dist: 22.0, lat: -3.2, depth: 1.4 },
    { band: "bg", dist: 25.0, lat: 2.0, depth: 1.6 },
    { band: "bg", dist: 28.0, lat: 4.5, depth: 1.8 },
  ];
}

/** Pull invisible fish into guaranteed screen slots until ≥5 screen-visible. */
function activatePresentationCorrection(point, camera, time, dt, ringLocal, dataset, vis) {
  camera.getWorldDirection(_camDir);
  const horiz = Math.hypot(_camDir.x, _camDir.z) || 1;
  const fx = _camDir.x / horiz;
  const fz = _camDir.z / horiz;
  const px = -fz;
  const pz = fx;

  const need = point.visibleFishMinimum - vis.screenVisible;
  if (need <= 0) return;

  const rescueSlots = [
    { dist: 8, lat: -2.5, depth: 0.4 },
    { dist: 9.5, lat: 2.2, depth: 0.5 },
    { dist: 12, lat: 0, depth: 0.65 },
    { dist: 14, lat: -3.5, depth: 0.8 },
    { dist: 16, lat: 3.2, depth: 0.75 },
  ];

  let rescued = 0;
  for (const a of point.fish) {
    if (rescued >= need + 2) break;
    if (a.jumpState !== "swim") continue;
    const ok = a.screen?.actuallyVisible;
    if (ok) continue;
    const slot = rescueSlots[rescued % rescueSlots.length];
    let x = camera.position.x + fx * slot.dist + px * slot.lat;
    let z = camera.position.z + fz * slot.dist + pz * slot.lat;
    ({ x, z } = clampInZone(x, z, point, Math.max(point.radius, 36)));
    ({ x, z } = clampInRiver(x, z, ringLocal, point));
    const surface = waterSurfaceYAt(x, z, time);
    const y = surface - slot.depth;
    a.mesh.position.lerp(_tmp.set(x, y, z), 1 - Math.exp(-dt * 6));
    a.mesh.scale.setScalar(a.fixedScale * 1.15);
    rescued++;
  }
}

/**
 * Real screen-space visibility from projected AABB.
 */
function projectFishToScreen(mesh, camera) {
  mesh.updateWorldMatrix(true, false);
  _box.setFromObject(mesh);
  if (_box.isEmpty()) {
    return { visible: false, reason: "empty", widthPx: 0, heightPx: 0, x: 0.5, y: 0.5, inFrustum: false };
  }

  const w = window.innerWidth || 1280;
  const h = window.innerHeight || 720;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let anyFront = false;
  let anyInNdc = false;

  const min = _box.min;
  const max = _box.max;
  for (let i = 0; i < 8; i++) {
    _corner.set(
      i & 1 ? max.x : min.x,
      i & 2 ? max.y : min.y,
      i & 4 ? max.z : min.z,
    );
    _corner.project(camera);
    if (_corner.z < -1 || _corner.z > 1) continue;
    anyFront = true;
    const sx = (_corner.x * 0.5 + 0.5);
    const sy = (-_corner.y * 0.5 + 0.5);
    if (sx > -0.05 && sx < 1.05 && sy > -0.05 && sy < 1.05) anyInNdc = true;
    minX = Math.min(minX, sx);
    maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy);
    maxY = Math.max(maxY, sy);
  }

  if (!anyFront || !Number.isFinite(minX)) {
    return { visible: false, reason: "behind", widthPx: 0, heightPx: 0, x: 0.5, y: 0.5, inFrustum: false };
  }

  const widthPx = Math.max(0, (maxX - minX) * w);
  const heightPx = Math.max(0, (maxY - minY) * h);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const intersectsScreen = maxX > 0 && minX < 1 && maxY > 0 && minY < 1 && anyInNdc;

  // Water occlusion heuristic: deep below opaque water
  const surface = SURFACE_Y;
  const depthBelow = surface - mesh.position.y;
  const waterOpaque = !(state.cinematicPhase === "fishing_points" || state.cinematicUnderwater || state.cinematicFishScene);
  const occludedByWater = waterOpaque && depthBelow > 1.6;

  const band = mesh.userData.band || "mid";
  const minPx = BAND[band]?.minPx || 22;
  const largeEnough = heightPx >= minPx && widthPx >= minPx * 0.35;
  const tooSmall = intersectsScreen && !largeEnough;
  const actuallyVisible = intersectsScreen && largeEnough && !occludedByWater;

  return {
    visible: actuallyVisible,
    actuallyVisible,
    inFrustum: anyFront && intersectsScreen,
    tooSmall,
    occluded: occludedByWater,
    widthPx,
    heightPx,
    x: cx,
    y: cy,
    left: minX,
    top: minY,
    right: maxX,
    bottom: maxY,
    reason: actuallyVisible ? "ok" : occludedByWater ? "water" : tooSmall ? "small" : "offscreen",
  };
}

function measurePointVisibility(point, camera) {
  let inFrustum = 0;
  let screenVisible = 0;
  let tooSmall = 0;
  let occluded = 0;
  for (const a of point.fish) {
    a.mesh.userData.band = a.band;
    const s = projectFishToScreen(a.mesh, camera);
    a.screen = s;
    if (s.inFrustum) inFrustum++;
    if (s.tooSmall) tooSmall++;
    if (s.occluded) occluded++;
    if (s.actuallyVisible) screenVisible++;
  }
  return {
    world: point.fish.length,
    inFrustum,
    screenVisible,
    tooSmall,
    occluded,
  };
}

function logVisibilityReport(point, camera, vis) {
  const dist = camera.position.distanceTo(_tmp.set(point.x, SURFACE_Y, point.z));
  const jumper = point.fish.find((a) => a.jumpState !== "swim");
  let jumpLine = "none";
  if (jumper) {
    const s = jumper.screen || projectFishToScreen(jumper.mesh, camera);
    const prog = Math.round((jumper.jumpT / jumper.jumpDuration) * 100);
    jumpLine = `${jumper.id} ${prog}% screen=(${(s.x * 100).toFixed(0)}%,${(s.y * 100).toFixed(0)}%) visible=${s.actuallyVisible ? "YES" : "NO"}`;
  }
  console.info(
    [
      `FISHING POINT: ${point.label}`,
      `Camera distance: ${dist.toFixed(1)} m`,
      `Fish in world: ${vis.world}`,
      `Fish in frustum: ${vis.inFrustum}`,
      `Fish actually screen-visible: ${vis.screenVisible}`,
      `Fish occluded/too-small: ${vis.occluded}/${vis.tooSmall}`,
      `Current jump: ${jumpLine}`,
    ].join("\n"),
  );
}

function updateJumpScheduler(point, camera, time, dt, ringLocal, dataset, fishingShot) {
  if (!camera) return;
  point.scheduleT += dt;

  // One jump at a time; fire about once per second
  if (point.fish.some((a) => a.jumpState !== "swim")) return;
  if (point.lastJumpAt >= 0 && point.scheduleT - point.lastJumpAt < 1.0) return;

  const side = JUMP_SIDES[point.nextJumpIdx % JUMP_SIDES.length];
  const fishIndex = (point.nextJumpIdx * 3) % point.fish.length;
  const a = point.fish[fishIndex] || point.fish[0];
  if (!a || a.jumpState !== "swim") {
    point.nextJumpIdx++;
    return;
  }

  a.jumpHeight = 2.6 + Math.random() * 1.1;

  if (tryBeginVisibleJump(a, point, camera, side, ringLocal, dataset, time)) {
    point.nextJumpIdx++;
    point.lastJumpAt = point.scheduleT;
    return;
  }

  let ok = false;
  for (const s of JUMP_SIDES) {
    if (tryBeginVisibleJump(a, point, camera, s, ringLocal, dataset, time)) {
      ok = true;
      break;
    }
  }
  if (!ok) {
    for (const alt of point.fish) {
      if (alt.jumpState !== "swim") continue;
      alt.jumpHeight = 2.6 + Math.random() * 1.1;
      if (tryBeginVisibleJump(alt, point, camera, JUMP_SIDES[1], ringLocal, dataset, time)) {
        ok = true;
        break;
      }
    }
  }
  if (ok) {
    point.nextJumpIdx++;
    point.lastJumpAt = point.scheduleT;
  } else if (fishingShot) {
    // Retry soon during cinematic fishing focus
    point.lastJumpAt = point.scheduleT - 0.65;
  }
}

/**
 * Jump only if takeoff, peak, and landing project into the screen corridor.
 */
function tryBeginVisibleJump(a, point, camera, side, ringLocal, dataset, time) {
  camera.getWorldDirection(_camDir);
  const horiz = Math.hypot(_camDir.x, _camDir.z) || 1;
  const fx = _camDir.x / horiz;
  const fz = _camDir.z / horiz;
  const px = -fz;
  const pz = fx;

  const latCandidates = [side.lat, 0, -side.lat, 2.5, -2.5, 5, -5];
  const distCandidates = [10, 12, 14, 8, 16, 18];

  for (const dist of distCandidates) {
    for (const lat of latCandidates) {
      let sx = camera.position.x + fx * dist + px * lat;
      let sz = camera.position.z + fz * dist + pz * lat;
      // Prefer near fishing point
      sx = THREE.MathUtils.lerp(sx, point.x + px * lat, 0.45);
      sz = THREE.MathUtils.lerp(sz, point.z + pz * lat, 0.45);
      ({ x: sx, z: sz } = clampInZone(sx, sz, point, Math.max(point.radius, 34)));
      ({ x: sx, z: sz } = clampInRiver(sx, sz, ringLocal, point));
      if (!pointInRing(sx, sz, ringLocal)) continue;

      let ex = sx + fx * 5;
      let ez = sz + fz * 5;
      ({ x: ex, z: ez } = clampInRiver(ex, ez, ringLocal, point));
      if (!pointInRing(ex, ez, ringLocal)) continue;

      const surface = waterSurfaceYAt(sx, sz, time);
      const peakH = a.jumpHeight;
      const peak = _tmp.set(
        sx + fx * 2.5,
        surface + peakH,
        sz + fz * 2.5,
      );

      // Screen corridor check on peak
      peak.project(camera);
      const nx = peak.x * 0.5 + 0.5;
      const ny = -peak.y * 0.5 + 0.5;
      if (peak.z < -1 || peak.z > 1) continue;
      if (nx < 0.2 || nx > 0.8 || ny < 0.35 || ny > 0.85) continue;

      // Pixel size estimate at peak
      const dPeak = camera.position.distanceTo(_tmp2.set(sx + fx * 2.5, surface + peakH, sz + fz * 2.5));
      const approxPx = ((a.fixedScale * 1.3) / (dPeak * 0.85 + 1e-3)) * (window.innerHeight || 720);
      if (approxPx < MIN_JUMP_PX * 0.85) continue;

      // Validate takeoff & landing NDC
      if (!screenCorridorOk(camera, sx, surface + 0.3, sz)) continue;
      if (!screenCorridorOk(camera, ex, waterSurfaceYAt(ex, ez, time) + 0.2, ez)) continue;

      a.jumpStart.set(sx, surface - 0.12, sz);
      a.jumpEnd.set(ex, waterSurfaceYAt(ex, ez, time) - 0.4, ez);
      a.jumpCtrl1.set(sx + fx * 1.4, surface + peakH * 0.5, sz + fz * 1.4);
      a.jumpCtrl2.set(sx + fx * 2.8, surface + peakH, sz + fz * 2.8);
      a.mesh.position.copy(a.jumpStart);
      a.jumpState = "arc";
      a.jumpT = 0;
      a.jumpDuration = 0.85;
      a._splashExit = false;
      a._splashLand = false;
      // Boost scale during jump for readability
      a.mesh.scale.setScalar(a.fixedScale * 1.45);
      return true;
    }
  }
  return false;
}

function screenCorridorOk(camera, x, y, z) {
  _ndc.set(x, y, z).project(camera);
  if (_ndc.z < -1 || _ndc.z > 1) return false;
  const nx = _ndc.x * 0.5 + 0.5;
  const ny = -_ndc.y * 0.5 + 0.5;
  return nx > 0.15 && nx < 0.85 && ny > 0.2 && ny < 0.9;
}

function updateJumpArc(a, point, camera, time, dt, ringLocal, dataset) {
  a.jumpT += dt;
  const u = Math.min(1, a.jumpT / a.jumpDuration);
  cubicBezier(a.jumpStart, a.jumpCtrl1, a.jumpCtrl2, a.jumpEnd, u, a.mesh.position);

  if (!pointInRing(a.mesh.position.x, a.mesh.position.z, ringLocal)) {
    const c = clampInRiver(a.mesh.position.x, a.mesh.position.z, ringLocal, point);
    a.mesh.position.x = c.x;
    a.mesh.position.z = c.z;
  }

  const surface = waterSurfaceYAt(a.mesh.position.x, a.mesh.position.z, time);
  if (!a._splashExit && a.mesh.position.y >= surface - 0.05) {
    a._splashExit = true;
    spawnSplashAt(a.mesh.position.x, a.mesh.position.z, 1.15);
  }
  if (!a._splashLand && u > 0.7 && a.mesh.position.y <= surface + 0.2) {
    a._splashLand = true;
    spawnSplashAt(a.mesh.position.x, a.mesh.position.z, 1.25);
  }

  // Cancel if major part leaves corridor
  if (camera && u > 0.1 && u < 0.9) {
    const s = projectFishToScreen(a.mesh, camera);
    if (!s.inFrustum || s.x < 0.08 || s.x > 0.92) {
      // Soft pull toward look center
      camera.getWorldDirection(_camDir);
      const horiz = Math.hypot(_camDir.x, _camDir.z) || 1;
      a.mesh.position.x = THREE.MathUtils.lerp(
        a.mesh.position.x,
        camera.position.x + (_camDir.x / horiz) * 12,
        0.08,
      );
      a.mesh.position.z = THREE.MathUtils.lerp(
        a.mesh.position.z,
        camera.position.z + (_camDir.z / horiz) * 12,
        0.08,
      );
    }
  }

  cubicBezier(a.jumpStart, a.jumpCtrl1, a.jumpCtrl2, a.jumpEnd, Math.min(1, u + 0.04), _tmp2);
  _fwd.copy(_tmp2).sub(a.mesh.position);
  if (_fwd.lengthSq() > 1e-6) {
    orientMesh(a, _fwd.x, _fwd.z, time, dt);
    a.mesh.rotateX(THREE.MathUtils.lerp(0.4, -0.55, u));
  }

  if (u >= 1) {
    a.jumpState = "swim";
    a.mesh.scale.setScalar(a.fixedScale);
    const bed = bedYAt(a.mesh.position.x, a.mesh.position.z, dataset);
    a.mesh.position.y = THREE.MathUtils.clamp(surface - a.depthBelow, bed + 0.3, surface - 0.2);
  }
}

function spawnSplashAt(x, z, intensity) {
  const { ripples, waterEffects } = spawnSplashAt._targets || {};
  if (waterEffects?.spawnFishSplash) waterEffects.spawnFishSplash(x, z, intensity);
  if (ripples?.spawn) ripples.spawn(x, SURFACE_Y + 0.05, z, 0.4 * intensity);
}

export function bindFishingSplashTargets(ripples, waterEffects) {
  spawnSplashAt._targets = { ripples, waterEffects };
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
  a.mesh.rotateZ(Math.sin(time * 2.2 + a.phaseOffset) * 0.03);
}

function cubicBezier(p0, p1, p2, p3, t, out) {
  const u = 1 - t;
  out.set(
    u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
    u ** 3 * p0.z + 3 * u ** 2 * t * p1.z + 3 * u * t ** 2 * p2.z + t ** 3 * p3.z,
  );
}

/** Debug HUD: fishing-point visibility text report (no screen boxes). */
function createFishDebugOverlay(root) {
  if (!root) {
    return { update() {}, hide() {}, dispose() {} };
  }
  const panel = document.createElement("div");
  panel.className = "hud fish-debug-panel";
  panel.hidden = true;
  panel.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:60;max-width:340px;padding:10px 12px;" +
    "background:rgba(8,16,22,0.82);color:#d8eef4;font:11px/1.35 'IBM Plex Mono',monospace;" +
    "border:1px solid rgba(154,212,224,0.35);border-radius:8px;pointer-events:none;white-space:pre-wrap;";
  root.appendChild(panel);

  return {
    update(point, camera, vis) {
      panel.hidden = false;
      const jumper = point.fish.find((a) => a.jumpState !== "swim");
      const dist = camera.position.distanceTo(_tmp.set(point.x, SURFACE_Y, point.z));
      let jumpInfo = "none";
      if (jumper) {
        const s = jumper.screen || {};
        jumpInfo = `${jumper.id} ${Math.round((jumper.jumpT / jumper.jumpDuration) * 100)}% ` +
          `X=${((s.x || 0) * 100).toFixed(0)}% Y=${((s.y || 0) * 100).toFixed(0)}% ` +
          `vis=${s.actuallyVisible ? "YES" : "NO"}`;
      }
      panel.textContent = [
        `FISHING POINT: ${point.label}`,
        `Camera distance: ${dist.toFixed(1)} m`,
        `Fish in world: ${vis.world}`,
        `Fish in frustum: ${vis.inFrustum}`,
        `Fish actually screen-visible: ${vis.screenVisible}`,
        `Fish occluded: ${vis.occluded}  too-small: ${vis.tooSmall}`,
        `Current jump: ${jumpInfo}`,
      ].join("\n");
    },
    hide() {
      panel.hidden = true;
    },
    dispose() {
      panel.remove();
    },
  };
}
