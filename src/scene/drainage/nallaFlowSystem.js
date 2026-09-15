import * as THREE from "three";
import { state } from "../../state.js";
import { resolveNallaFlow, isRiverConnectedDrainage } from "./flowDirectionResolver.js";
import { createNallaWaterMaterial } from "./nallaWaterMaterial.js";
import { createJoiningStreamsEffects } from "./joiningStreamsEffects.js";
import { metersToStation } from "../chainageMarkers.js";
import { validateLonLat, formatDisplayName } from "./joiningStreamsController.js";
import { terrainHeightAt } from "../terrain.js";
import { SURFACE_Y } from "../river.js";
import { lonLatToLocal } from "../../geo/geoReference.js";

/** Clearance above terrain so pipes rest on ground without floating or burying (scene metres). */
const PIPE_CLEARANCE = 0.28;

/** Authoritative confluence meters along Mula–Mutha (never drainage-local 0). */
function getActualRiverChainageMeters(rec) {
  if (!rec) return Number.POSITIVE_INFINITY;
  const candidates = [
    rec.riverChainageMeters,
    rec.nearestChainageMeters,
    rec.connection?.riverChainage,
    rec.connection?.bankChainage,
    rec.connection?.alongM,
  ];
  for (const c of candidates) {
    if (Number.isFinite(c)) return c;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Oblique aerial camera from drainage curve — NOT main-river chainage.
 * Prefer mid-channel look-at with outlet/confluence in frame.
 * @param {object} rec
 * @param {"drainage-focus"|"overview"} mode
 */
export function computeDrainageFocusPose(rec, mode = "drainage-focus") {
  if (!rec?.curve?.getPointAt) {
    console.warn("[JoiningStreams] Drainage has insufficient camera points");
    return null;
  }

  let len = 0;
  try {
    len = rec.curve.getLength?.() || rec.curveLength || 0;
  } catch {
    len = rec.curveLength || 0;
  }

  const overview = mode === "overview";
  // Oblique aerial: focus mid-channel, look toward confluence (reference composition)
  const focusT = overview ? 0.48 : 0.62;
  const upstreamT = overview ? 0.2 : 0.32;
  const outletT = 1.0;

  let focusPoint;
  let upstreamPoint;
  let outletPoint;
  try {
    focusPoint = rec.curve.getPointAt(focusT);
    upstreamPoint = rec.curve.getPointAt(upstreamT);
    outletPoint = rec.curve.getPointAt(outletT);
  } catch {
    console.warn("[JoiningStreams] Drainage has insufficient camera points");
    return null;
  }

  // Prefer actual confluence as look bias when available
  const bank = rec.connection?.bankPoint;
  const river = rec.connection?.riverPoint;
  const confluence = bank || river || null;
  const lookTarget = confluence && Number.isFinite(confluence.x) && Number.isFinite(confluence.z)
    ? new THREE.Vector3(
        focusPoint.x * 0.45 + confluence.x * 0.55,
        (Number.isFinite(confluence.y) ? confluence.y : focusPoint.y),
        focusPoint.z * 0.45 + confluence.z * 0.55,
      )
    : focusPoint.clone().lerp(outletPoint, 0.55);

  const direction = new THREE.Vector3()
    .subVectors(outletPoint, upstreamPoint);
  direction.y = 0;
  if (direction.lengthSq() < 1e-6) {
    try {
      direction.copy(rec.curve.getTangentAt(focusT));
      direction.y = 0;
    } catch {
      /* ignore */
    }
  }
  if (direction.lengthSq() < 1e-6) direction.set(1, 0, 0);
  else direction.normalize();

  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, direction);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  else side.normalize();

  // Face so river / confluence stays in frame when possible
  if (confluence && Number.isFinite(confluence.x) && Number.isFinite(confluence.z)) {
    const toRiver = new THREE.Vector3(confluence.x - focusPoint.x, 0, confluence.z - focusPoint.z);
    if (toRiver.lengthSq() > 1e-6 && side.dot(toRiver) > 0) side.negate();
  }

  const scale = Math.max(40, len || 120);
  // Adaptive oblique distance / height (professional GIS inspection view)
  const distance = overview
    ? THREE.MathUtils.clamp(scale * 1.05, 160, 380)
    : THREE.MathUtils.clamp(scale * 0.48, 95, 175);
  const sideOffset = overview
    ? THREE.MathUtils.clamp(scale * 0.7, 100, 280)
    : THREE.MathUtils.clamp(scale * 0.38, 55, 130);
  const height = overview
    ? THREE.MathUtils.clamp(scale * 0.4, 80, 200)
    : THREE.MathUtils.clamp(scale * 0.26, 42, 85);

  const cameraPosition = focusPoint
    .clone()
    .addScaledVector(direction, -distance)
    .addScaledVector(side, sideOffset);
  cameraPosition.y = focusPoint.y + height;

  const horiz = Math.hypot(cameraPosition.x - lookTarget.x, cameraPosition.z - lookTarget.z);
  if (horiz < height * 0.9) {
    const need = height * 1.25;
    const s = need / Math.max(1, horiz);
    cameraPosition.x = lookTarget.x + (cameraPosition.x - lookTarget.x) * s;
    cameraPosition.z = lookTarget.z + (cameraPosition.z - lookTarget.z) * s;
  }

  const look = lookTarget.clone();
  look.y += 2.5;

  return { position: cameraPosition, target: look };
}

/**
 * Continuous nalla water surfaces (shader ribbons).
 * Open ground = surface channel cut into terrain; under buildings = recessed culvert.
 * Joining Streams mode adds slim pipes / arrows / confluence mist via effects child.
 */
export function createNallaFlowSystem(dataset, drainageGroup, opts = {}) {
  const group = new THREE.Group();
  group.name = "nallaFlowSystem";
  group.visible = false;

  const pickables = drainageGroup?.userData?.pickables || [];
  const stations = dataset.corridor?.stations || [];
  const chainagePts = [...(dataset.chainage || [])].sort(
    (a, b) => (a.meters ?? 0) - (b.meters ?? 0),
  );
  const material = createNallaWaterMaterial();
  const selectedMaterial = createNallaWaterMaterial();
  selectedMaterial.uniforms.uSelectedBoost.value = 1;
  selectedMaterial.uniforms.uJoiningStyle.value = 1;
  selectedMaterial.uniforms.uOpacity.value = 0.9;

  if (!pickables.length) {
    group.userData.update = () => {};
    group.userData.records = [];
    group.userData.stats = { nallas: 0, connected: 0, unknownDir: 0 };
    group.userData.playReveal = () => {};
    group.userData.setActive = () => {};
    group.userData.setSelected = () => {};
    group.userData.setHovered = () => {};
    group.userData.setJoiningStreamsMode = () => {};
    return group;
  }

  const records = [];
  let unknownDir = 0;
  let connected = 0;
  const meshes = [];

  for (let i = 0; i < pickables.length; i++) {
    const path = pickables[i];
    if (!path.pts || path.pts.length < 2) continue;
    const rec = resolveNallaFlow(path, stations);
    rec.index = i;

    let ordered = rec.flowTowardEnd ? path.pts.slice() : path.pts.slice().reverse();

    for (const p of ordered) {
      if (Number.isFinite(p.lon) && Number.isFinite(p.lat)) {
        const fixed = validateLonLat(p.lon, p.lat);
        if (fixed) {
          p.lon = fixed.lon;
          p.lat = fixed.lat;
        }
      }
    }

    enrichChainage(rec, chainagePts, ordered, dataset, stations);

    rec.openGroundShare =
      ordered.reduce((s, p) => s + ((p.under || 0) < 0.2 ? 1 : 0), 0) / Math.max(1, ordered.length);

    const radius = channelRadius(rec);
    rec.channelRadius = radius;

    ordered = snapOutletToBank(ordered, rec, stations);
    enrichChainage(rec, chainagePts, ordered, dataset, stations);

    const curvePts = buildGroundedCurvePts(ordered, stations, rec, radius);
    if (curvePts.length < 2) continue;

    // Smooth engineered channel path (centripetal — avoids overshoot at bends)
    const curve = new THREE.CatmullRomCurve3(curvePts, false, "centripetal", 0.22);
    const length = Math.max(1, curve.getLength());
    rec.curve = curve;
    rec.curveLength = length;
    rec.orderedPts = ordered;
    const endPt = curve.getPointAt(1);
    rec.outletPoint = endPt.clone();
    if (rec.connection?.bankPoint) {
      rec.connection.bankPoint.y = endPt.y;
    }

    if (rec.connectsToRiver) connected++;
    if (rec.flowDirectionConfidence === "unknown") unknownDir++;

    // Smooth TubeGeometry: enough radial + tubular segments for professional pipe look
    // Connected Joining Streams nallas get higher quality; others stay lighter
    const isConnected = !!rec.connectsToRiver;
    const tubular = isConnected
      ? Math.max(80, Math.min(200, Math.floor(length / 3.2)))
      : Math.max(24, Math.min(100, Math.floor(length / 6)));
    const radial = isConnected ? 14 : 6;
    let geo;
    try {
      geo = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
    } catch {
      continue;
    }

    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `nallaWater_${rec.id}`;
    mesh.renderOrder = 8;
    mesh.frustumCulled = true;
    mesh.userData.record = rec;
    group.add(mesh);
    meshes.push(mesh);
    records.push(rec);
  }

  // Stable dataset IDs from original pickable order — NEVER overwrite with river-nav order
  for (const r of records) {
    r.drainageId = `D-${(r.index ?? 0) + 1}`;
    r.displayId = r.drainageId;
    r.displayName = formatDisplayName(r);
  }

  // Joining Streams navigation: ONLY Mula–Mutha-connected drainages, river confluence order
  const riverOrderedRecords = [...records]
    .filter((r) => isRiverConnectedDrainage(r))
    .sort((a, b) => {
      const am = getActualRiverChainageMeters(a);
      const bm = getActualRiverChainageMeters(b);
      if (am !== bm) return am - bm;
      return String(a.drainageId).localeCompare(String(b.drainageId));
    });
  const navigationCount = riverOrderedRecords.length;
  riverOrderedRecords.forEach((r, i) => {
    r.navigationIndex = i;
    r.navigationNumber = i + 1;
    r.navigationCount = navigationCount;
    r.navIndex = i; // UI counter alias = river order
  });
  for (const r of records) {
    r.navigationCount = navigationCount;
    if (!isRiverConnectedDrainage(r)) {
      // Keep original drainageId; clear nav fields so they cannot enter Forward/Back
      r.navigationIndex = undefined;
      r.navigationNumber = undefined;
      r.navIndex = undefined;
    }
  }

  let revealT = 0;
  let active = false;
  let joiningMode = false;
  let activeNavIndex = 0;
  /** @type {null | { focusPose?: Function, startDrainageFlight?: Function, camera?: object, controls?: object, getCamera?: Function }} */
  let cameraSystem = null;
  /** @type {null | object} */
  let selectedRec = null;
  /** @type {null | object} */
  let hoveredRec = null;

  group.userData.records = records;
  group.userData.riverOrderedRecords = riverOrderedRecords;
  group.userData.material = material;
  group.userData.getRecords = () => riverOrderedRecords.slice();
  group.userData.getRecordByPickMeta = (meta) => {
    if (!meta) return null;
    return (
      records.find((r) => r.meta === meta) ||
      records.find((r) => r.meta?.osmId && r.meta.osmId === meta.osmId) ||
      records.find((r) => r.name === meta.name)
    );
  };

  group.userData.setCameraSystem = (sys) => {
    cameraSystem = sys || null;
  };

  group.userData.getNavigationRecords = () => riverOrderedRecords.slice();
  group.userData.getRiverOrderedRecords = () => riverOrderedRecords.slice();
  group.userData.getRecordByNavIndex = (index) => {
    if (!riverOrderedRecords.length) return null;
    const i = THREE.MathUtils.clamp(Math.round(Number(index) || 0), 0, riverOrderedRecords.length - 1);
    return riverOrderedRecords[i] || null;
  };
  group.userData.getNavigationIndex = (rec) => {
    if (rec == null) return activeNavIndex;
    if (Number.isFinite(rec.navigationIndex)) return rec.navigationIndex;
    return riverOrderedRecords.findIndex(
      (r) => r === rec || (r.drainageId && r.drainageId === rec.drainageId) || r.id === rec.id,
    );
  };
  group.userData.getRecord = (i) => group.userData.getRecordByNavIndex(i);
  group.userData.getCurrentRecord = () => selectedRec;
  group.userData.getNextRecord = () => {
    if (!riverOrderedRecords.length) return null;
    const i = Math.min(activeNavIndex + 1, riverOrderedRecords.length - 1);
    return riverOrderedRecords[i];
  };
  group.userData.getPreviousRecord = () => {
    if (!riverOrderedRecords.length) return null;
    const i = Math.max(activeNavIndex - 1, 0);
    return riverOrderedRecords[i];
  };
  group.userData.getNearestRecordToChainage = (meters) => {
    const m = Number(meters);
    if (!Number.isFinite(m) || !riverOrderedRecords.length) return null;
    let best = riverOrderedRecords[0];
    let bestD = Infinity;
    for (const r of riverOrderedRecords) {
      const cm = getActualRiverChainageMeters(r);
      if (!Number.isFinite(cm) || cm === Number.POSITIVE_INFINITY) continue;
      const d = Math.abs(cm - m);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  };

  group.userData.selectNavigationIndex = (index) => {
    if (!riverOrderedRecords.length) return null;
    const safeIndex = THREE.MathUtils.clamp(
      Math.round(Number(index) || 0),
      0,
      riverOrderedRecords.length - 1,
    );
    const record = riverOrderedRecords[safeIndex];
    if (!record) return null;
    activeNavIndex = safeIndex;
    group.userData.setSelected(record);
    return record;
  };

  /**
   * Select + fly camera to actual drainage curve. This is the ONLY camera entry for Joining Streams.
   * @param {object|number} recordOrIndex
   * @param {object} [_camera]
   * @param {object} [_controls]
   * @param {{ mode?: string }} [opts]
   */
  group.userData.focusRecord = (recordOrIndex, _camera, _controls, opts = {}) => {
    const record =
      typeof recordOrIndex === "number"
        ? group.userData.getRecordByNavIndex(recordOrIndex)
        : recordOrIndex;
    if (!record?.curve) {
      console.warn("[JoiningStreams] Drainage has insufficient camera points", recordOrIndex);
      return null;
    }
    if (!isRiverConnectedDrainage(record)) {
      console.warn("[JoiningStreams] Skipping non-connected drainage", record.drainageId || record.id);
      return null;
    }

    const index = Number.isFinite(record.navigationIndex)
      ? record.navigationIndex
      : group.userData.getNavigationIndex(record);
    activeNavIndex = Math.max(0, index);
    group.userData.setSelected(record);

    const mode = opts.mode || "drainage-focus";
    const pose = computeDrainageFocusPose(record, mode);
    if (!pose) {
      console.warn("[JoiningStreams] Drainage has insufficient camera points", record.drainageId || record.id);
      return null;
    }

    const sys = cameraSystem;
    if (sys?.startDrainageFlight) {
      sys.startDrainageFlight(pose.position, pose.target, {
        durMs: mode === "overview" ? 1100 : 900,
        fov: mode === "overview" ? 55 : 50,
      });
    } else if (sys?.focusPose) {
      sys.focusPose({
        toP: pose.position,
        toL: pose.target,
        dur: mode === "overview" ? 1.1 : 0.95,
        ease: "outCubic",
        fov: mode === "overview" ? 55 : 50,
      });
    } else {
      const camera = _camera || sys?.camera || sys?.getCamera?.();
      const controls = _controls || sys?.controls;
      if (camera && controls) {
        camera.userData.joiningStreamsFlight = {
          active: true,
          startPosition: camera.position.clone(),
          startTarget: controls.target.clone(),
          endPosition: pose.position.clone(),
          endTarget: pose.target.clone(),
          progress: 0,
          duration: mode === "overview" ? 1100 : 900,
        };
        controls.enabled = false;
      } else {
        console.warn("[JoiningStreams] No camera system bound — cannot fly to drainage");
      }
    }

    return {
      record,
      navigationIndex: activeNavIndex,
      navigationNumber: activeNavIndex + 1,
      chainageMeters: record.nearestChainageMeters ?? record.riverChainageMeters,
      chainageLabel: record.nearestChainageLabel || record.riverChainageLabel,
    };
  };
  group.userData.focusDrainage = group.userData.focusRecord;

  const effects = createJoiningStreamsEffects(group, {
    uiRoot: opts.uiRoot,
    getCamera: opts.getCamera,
  });
  group.add(effects);
  group.userData.effects = effects;
  group.userData.stats = {
    nallas: records.length,
    connected,
    joiningNavigable: riverOrderedRecords.length,
    unknownDir,
    style: "terrain-draped-channel",
    riverOrdered: riverOrderedRecords.length,
  };

  group.userData.setActive = (on) => {
    active = !!on;
    state.showNallaFlow = active;
    material.uniforms.uActive.value = active ? 1 : 0;
    selectedMaterial.uniforms.uActive.value = active ? 1 : 0;
    if (active) {
      revealT = 0;
      material.uniforms.uReveal.value = 0;
      selectedMaterial.uniforms.uReveal.value = 0;
      group.visible = true;
    } else {
      group.visible = false;
      material.uniforms.uReveal.value = 0;
      selectedMaterial.uniforms.uReveal.value = 0;
      effects.userData.setActive(false);
      selectedRec = null;
      hoveredRec = null;
    }
  };

  group.userData.playReveal = () => {
    revealT = 0;
    material.uniforms.uReveal.value = 0;
    selectedMaterial.uniforms.uReveal.value = 0;
    active = true;
    state.showNallaFlow = true;
    material.uniforms.uActive.value = 1;
    selectedMaterial.uniforms.uActive.value = 1;
    group.visible = true;
  };

  group.userData.setSelected = (recOrNull) => {
    selectedRec = recOrNull || null;
    if (selectedRec && Number.isFinite(selectedRec.navigationIndex)) {
      activeNavIndex = selectedRec.navigationIndex;
    }
    effects.userData.setSelected(selectedRec);
    for (const mesh of meshes) {
      const r = mesh.userData?.record;
      const isSel =
        selectedRec &&
        r &&
        (r === selectedRec ||
          (r.drainageId && selectedRec.drainageId && r.drainageId === selectedRec.drainageId) ||
          (r.id != null && selectedRec.id != null && String(r.id) === String(selectedRec.id)) ||
          (r.navigationIndex != null &&
            selectedRec.navigationIndex != null &&
            r.navigationIndex === selectedRec.navigationIndex));
      mesh.material = isSel ? selectedMaterial : material;
      mesh.renderOrder = isSel ? 10 : 8;
    }
  };

  group.userData.setHovered = (recOrNull) => {
    hoveredRec = recOrNull || null;
    effects.userData.setHovered?.(hoveredRec);
  };

  group.userData.setJoiningStreamsMode = (on) => {
    joiningMode = !!on;
    material.uniforms.uJoiningStyle.value = joiningMode ? 1 : 0;
    selectedMaterial.uniforms.uJoiningStyle.value = 1;
    material.uniforms.uOpacity.value = joiningMode ? 0.88 : 0.9;
    selectedMaterial.uniforms.uOpacity.value = 0.92;
    // Visibility + effects toggled only on mode change (not every frame)
    for (const mesh of meshes) {
      const r = mesh.userData?.record;
      mesh.visible = !joiningMode || isRiverConnectedDrainage(r);
    }
    effects.userData.setActive(joiningMode && active);
    const banks = drainageGroup?.userData?.staticBanks;
    if (banks) banks.visible = !joiningMode;
    const fill = drainageGroup?.userData?.staticFill;
    if (fill) fill.visible = false;
    if (!joiningMode) {
      selectedRec = null;
      hoveredRec = null;
      effects.userData.setSelected(null);
      effects.userData.setHovered?.(null);
      material.uniforms.uSelectedBoost.value = 0;
      for (const mesh of meshes) {
        mesh.visible = true;
        mesh.material = material;
      }
      if (banks) banks.visible = true;
    }
  };

  function update(dt, camera) {
    const want = !!state.showDrainage;
    if (want !== active) {
      if (want) group.userData.playReveal();
      else group.userData.setActive(false);
    }
    if (!want) {
      group.visible = false;
      if (joiningMode || state.joiningStreamsMode) effects.userData.setActive(false);
      return;
    }
    group.visible = true;
    const t = state.elapsed != null ? state.elapsed : material.uniforms.uTime.value + dt;
    material.uniforms.uTime.value = t;
    selectedMaterial.uniforms.uTime.value = t;
    const fxOn = !!(joiningMode || state.joiningStreamsMode);
    material.uniforms.uFlowSpeed.value = fxOn
      ? Math.min(0.38, state.nallaFlowSpeed ?? 0.38)
      : state.nallaFlowSpeed ?? 0.65;
    selectedMaterial.uniforms.uFlowSpeed.value = material.uniforms.uFlowSpeed.value;
    material.uniforms.uActive.value = 1;
    selectedMaterial.uniforms.uActive.value = 1;
    material.uniforms.uJoiningStyle.value = fxOn ? 1 : 0;
    selectedMaterial.uniforms.uJoiningStyle.value = 1;
    material.uniforms.uOpacity.value = fxOn ? 0.88 : 0.9;

    if (revealT < 1) {
      revealT = Math.min(1, revealT + dt * 1.4);
      material.uniforms.uReveal.value = revealT;
      selectedMaterial.uniforms.uReveal.value = revealT;
    } else {
      material.uniforms.uReveal.value = 1;
      selectedMaterial.uniforms.uReveal.value = 1;
    }

    // Effects update only while Joining Streams is on — no per-frame mesh visibility loop
    if (fxOn) effects.userData.update(dt, camera);
  }

  group.userData.update = update;
  return group;
}

/**
 * Densify + drape on terrain. Tube center ≈ ground + radius + clearance.
 * Near the outlet, ease smoothly onto the river surface (no hard jump).
 */
function buildGroundedCurvePts(ordered, stations, rec, radius) {
  // Enough control points for a smooth CatmullRom without exploding memory
  const dense = densifyPolyline(ordered, 6);
  const n = dense.length;
  const pts = dense.map((p, i) => {
    const under = p.under || 0;
    let ground = terrainHeightAt(p.x, p.z, stations);
    if (!Number.isFinite(ground)) ground = p.y || SURFACE_Y;

    // Rest on terrain with small clearance (not SURFACE_Y everywhere)
    let y = ground + radius * 0.82 + PIPE_CLEARANCE;
    if (under > 0.55) y = ground + Math.max(0.35, radius * 0.28) + PIPE_CLEARANCE * 0.5;
    else if (under > 0.18) {
      y =
        ground +
        THREE.MathUtils.lerp(radius * 0.82 + PIPE_CLEARANCE, radius * 0.35 + PIPE_CLEARANCE * 0.5, under);
    }

    const t = n <= 1 ? 1 : i / (n - 1);
    if (rec.connectsToRiver && t > 0.78) {
      // Smooth last ~22% toward river surface / bank
      const u = (t - 0.78) / 0.22;
      const ease = u * u * (3 - 2 * u);
      const waterY = SURFACE_Y + Math.max(0.4, radius * 0.38);
      y = THREE.MathUtils.lerp(y, waterY, ease);
    }

    return new THREE.Vector3(p.x, y, p.z);
  });

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      pts[i].y = pts[i].y * 0.5 + pts[i - 1].y * 0.25 + pts[i + 1].y * 0.25;
    }
  }
  return pts;
}

function densifyPolyline(pts, stepM) {
  if (!pts?.length) return [];
  if (pts.length < 2) return pts.slice();
  const out = [{ ...pts[0] }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(dist / Math.max(2, stepM)));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const under = Math.max(a.under || 0, b.under || 0);
      if (
        Number.isFinite(a.lon) &&
        Number.isFinite(b.lon) &&
        Number.isFinite(a.lat) &&
        Number.isFinite(b.lat)
      ) {
        const lon = a.lon + (b.lon - a.lon) * t;
        const lat = a.lat + (b.lat - a.lat) * t;
        try {
          const loc = lonLatToLocal(lon, lat);
          out.push({
            x: loc.x,
            z: loc.z,
            lon,
            lat,
            y: a.y != null && b.y != null ? a.y + (b.y - a.y) * t : a.y,
            under,
          });
          continue;
        } catch {
          /* XZ fallback */
        }
      }
      out.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        y: a.y != null && b.y != null ? a.y + (b.y - a.y) * t : a.y,
        lon: Number.isFinite(a.lon) && Number.isFinite(b.lon) ? a.lon + (b.lon - a.lon) * t : a.lon,
        lat: Number.isFinite(a.lat) && Number.isFinite(b.lat) ? a.lat + (b.lat - a.lat) * t : a.lat,
        under,
      });
    }
  }
  return out;
}

/** Prefer KML <name> / name:en / int_name — never invent labels or show D-IDs. */
export function formatNallaDisplayName(rec, _displayId) {
  return formatDisplayName(rec);
}

function snapOutletToBank(ordered, rec, stations) {
  // Only extend geometry for drainages already verified as river-connected
  if (!rec.connectsToRiver || !rec.connection?.bankPoint) return ordered;
  const bank = rec.connection.bankPoint;
  if (!ordered.length) return ordered;
  const last = ordered[ordered.length - 1];
  const gap = Math.hypot(last.x - bank.x, last.z - bank.z);
  const radius = rec.channelRadius || 2;
  const mouthY = SURFACE_Y + Math.max(0.4, radius * 0.35);

  // Refuse long fake bridges — connection should already be near the bank
  if (gap > 80) return ordered;

  const withoutTip = ordered.slice();
  while (withoutTip.length > 2) {
    const t = withoutTip[withoutTip.length - 1];
    if (Math.hypot(t.x - bank.x, t.z - bank.z) < 4) withoutTip.pop();
    else break;
  }

  const stIdx = bank.stationIndex;
  const st = Number.isFinite(stIdx) ? stations[stIdx] : null;
  if (st && gap > 2) {
    const half = Math.max(8, st.halfWidth || 40);
    const fx = st.flowX ?? 0;
    const fz = st.flowZ ?? 1;
    const lx = -fz;
    const lz = fx;
    const tip = withoutTip[withoutTip.length - 1];
    const side = Math.sign((tip.x - st.x) * lx + (tip.z - st.z) * lz) || 1;
    const approach = {
      x: st.x + lx * half * 0.95 * side,
      z: st.z + lz * half * 0.95 * side,
      y: terrainHeightAt(st.x + lx * half * 0.95 * side, st.z + lz * half * 0.95 * side, stations) || tip.y,
      lon: last.lon,
      lat: last.lat,
      under: 0,
    };
    if (Math.hypot(tip.x - approach.x, tip.z - approach.z) > 1.5) {
      withoutTip.push(approach);
    }
  }

  withoutTip.push({
    x: bank.x,
    z: bank.z,
    y: mouthY,
    lon: last.lon,
    lat: last.lat,
    under: 0,
  });
  // Preserve authoritative bank-gap; do NOT invent connectsToRiver here
  if (Number.isFinite(rec.connection?.distanceToBank)) {
    rec.distanceToRiverM = Math.round(rec.connection.distanceToBank * 10) / 10;
  }
  return withoutTip;
}

function enrichChainage(rec, chainagePts, ordered, dataset, stations = []) {
  // River connection chainage — NEVER use drainage-local distance 0
  const focus =
    rec.connection?.bankPoint ||
    rec.connection?.riverPoint ||
    rec.outletPoint ||
    ordered[ordered.length - 1] ||
    ordered[0];

  let meters = null;

  // 1) Nearest corridor station.along (authoritative river meters)
  if (focus && stations?.length) {
    let best = null;
    let bestD = Infinity;
    const step = Math.max(1, Math.floor(stations.length / 400));
    for (let i = 0; i < stations.length; i += step) {
      const st = stations[i];
      const d = Math.hypot(st.x - focus.x, st.z - focus.z);
      if (d < bestD) {
        bestD = d;
        best = st;
      }
    }
    if (best) {
      const i0 = stations.indexOf(best);
      for (let i = Math.max(0, i0 - 24); i <= Math.min(stations.length - 1, i0 + 24); i++) {
        const st = stations[i];
        const d = Math.hypot(st.x - focus.x, st.z - focus.z);
        if (d < bestD) {
          bestD = d;
          best = st;
        }
      }
      if (Number.isFinite(best.along)) meters = best.along;
    }
  }

  // 2) Nearest labeled chainage stake by XZ (if present)
  if (focus && chainagePts?.length) {
    let best = null;
    let bestD = Infinity;
    for (const c of chainagePts) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
      const d = Math.hypot(c.x - focus.x, c.z - focus.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best && Number.isFinite(best.meters)) {
      // Prefer stake if it is reasonably close; otherwise keep station.along
      if (meters == null || bestD < 80) meters = best.meters;
    }
  }

  // 3) Fallback: connection.alongM only if non-zero / finite
  if (meters == null && Number.isFinite(rec.connection?.alongM)) {
    meters = rec.connection.alongM;
  }

  rec.nearestChainageMeters = Number.isFinite(meters) ? meters : null;
  rec.nearestChainageLabel =
    rec.nearestChainageMeters != null ? metersToStation(rec.nearestChainageMeters) : "—";
  // Explicit river-chainage field (UI must not confuse with local 0+000)
  rec.riverChainageMeters = rec.nearestChainageMeters;
  rec.riverChainageLabel = rec.nearestChainageLabel;
  if (rec.connection) {
    rec.connection.alongM = Number.isFinite(meters) ? meters : rec.connection.alongM;
    rec.connection.riverChainage = rec.connection.alongM;
    rec.connection.bankChainage = rec.connection.alongM;
  }

  if (rec.distanceToRiverM == null && rec.connection?.distanceToBank != null) {
    rec.distanceToRiverM = rec.connection.distanceToBank;
  } else if (rec.distanceToRiverM == null && rec.connection?.distance != null) {
    rec.distanceToRiverM = rec.connection.distance;
  }

  const end = ordered[ordered.length - 1];
  if (end) {
    if (Number.isFinite(end.lon) && Number.isFinite(end.lat)) {
      const fixed = validateLonLat(end.lon, end.lat);
      rec.outletLon = fixed?.lon ?? end.lon;
      rec.outletLat = fixed?.lat ?? end.lat;
    } else if (dataset?.frame?.toLonLat) {
      const ll = dataset.frame.toLonLat(end.x, end.z);
      const fixed = validateLonLat(ll.lon, ll.lat);
      rec.outletLon = fixed?.lon ?? ll.lon;
      rec.outletLat = fixed?.lat ?? ll.lat;
    }
  }
}

/** Channel radii from KML waterway / width when present. */
function channelRadius(rec) {
  const ww = String(rec.meta?.waterway || "").toLowerCase();
  const L = rec.lengthM || 100;
  const open = rec.openGroundShare ?? 1;
  const widthM = Number(rec.meta?.width);
  let r = 2.0;
  if (Number.isFinite(widthM) && widthM > 0) {
    r = THREE.MathUtils.clamp(widthM * 0.12, 1.4, 3.6);
  } else if (ww === "canal") r = 2.7;
  else if (ww === "drain") r = 2.4;
  else if (ww === "stream") r = 2.2;
  else if (ww === "ditch") r = 1.7;
  if (L > 900) r *= 1.12;
  else if (L > 450) r *= 1.06;
  if (rec.connectsToRiver) r *= 1.04;
  r *= 0.92 + open * 0.12;
  return Math.min(3.4, Math.max(1.4, r));
}
