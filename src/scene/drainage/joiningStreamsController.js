import * as THREE from "three";
import { state } from "../../state.js";
import { metersToStation } from "../chainageMarkers.js";
import { interpolateChainage } from "../../geo/chainage.js";
import { SURFACE_Y } from "../river.js";
import { isRiverConnectedDrainage } from "./flowDirectionResolver.js";

/**
 * Authoritative confluence meters along Mula–Mutha (never drainage-local 0).
 */
export function getActualRiverChainageMeters(rec) {
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
 * Orchestrates Joining Streams selection, chainage sync, and UI updates.
 * Forward/Backward navigate RIVER-ORDERED drainages (confluence along Mula–Mutha)
 * and fly the camera to actual nalla geometry — never main-river chainage roam.
 */
export function createJoiningStreamsController({ dataset, nallaFlow, cam, system } = {}) {
  // Accept either `nallaFlow` (world.js) or `system` (alias)
  const flow = nallaFlow || system;

  if (!flow || !flow.userData) {
    throw new Error(
      "Joining Streams controller requires a valid system (createNallaFlowSystem instance with userData)",
    );
  }
  if (!Array.isArray(flow.userData.records)) {
    throw new Error(
      "Joining Streams controller: nallaFlowSystem.userData.records is missing — system not initialized",
    );
  }

  // Preserve the system's real camera focusRecord (must NOT be replaced with select-only stub)
  const systemFocusRecord =
    typeof flow.userData.focusRecord === "function"
      ? flow.userData.focusRecord.bind(flow.userData)
      : null;

  const chainage = [...(dataset?.chainage || [])].sort(
    (a, b) => (a.meters ?? 0) - (b.meters ?? 0),
  );
  /** @type {object[]} river-ordered navigation sequence */
  let records = [];
  let selectedIndex = -1;
  let syncLock = false;
  let active = false;
  /** @type {"overview" | "drainage-focus" | "idle"} */
  let navigationMode = "idle";

  function isValidDrainage(rec) {
    if (!rec) return false;
    // Joining Streams: only Mula–Mutha river-connected drainages
    if (!isRiverConnectedDrainage(rec)) return false;
    if (rec.curve && (rec.curveLength > 0 || rec.curve.getLength?.() > 0)) return true;
    if (rec.orderedPts?.length >= 2 || rec.pts?.length >= 2) return true;
    return false;
  }

  /**
   * Build navigation sequence by actual confluence along the main river (start → end).
   * ONLY connected drainages. Does NOT reassign dataset drainageId / displayId / name.
   */
  function refreshRecords() {
    const raw = flow.userData?.records || [];
    records = [...raw]
      .filter(isValidDrainage)
      .sort((a, b) => {
        const d = getActualRiverChainageMeters(a) - getActualRiverChainageMeters(b);
        if (d !== 0) return d;
        return String(a.drainageId || a.displayId || a.id).localeCompare(
          String(b.drainageId || b.displayId || b.id),
        );
      });

    const navigationCount = records.length;
    records.forEach((r, i) => {
      // River-order navigation fields only — never rewrite original drainageId
      r.navigationIndex = i;
      r.navigationNumber = i + 1;
      r.navigationCount = navigationCount;
      r.navIndex = i;
      if (!r.drainageId) {
        r.drainageId = r.displayId || `D-${(r.index ?? i) + 1}`;
      }
      r.displayId = r.drainageId;
      r.displayName = formatDisplayName(r);
    });

    flow.userData.riverOrderedRecords = records;
    flow.userData.navigationCount = navigationCount;
    return records;
  }

  function getRecords() {
    if (!records.length) refreshRecords();
    return records;
  }

  function getRiverOrderedRecords() {
    return getRecords().slice();
  }

  function getSelected() {
    if (selectedIndex < 0 || selectedIndex >= records.length) return null;
    return records[selectedIndex];
  }

  function getRecord(index) {
    const list = getRecords();
    if (!list.length) return null;
    const i = THREE.MathUtils.clamp(Math.round(Number(index)), 0, list.length - 1);
    return list[i] || null;
  }

  function getCurrentRecord() {
    return getSelected();
  }

  function getNextRecord() {
    const list = getRecords();
    if (!list.length) return null;
    let idx = findIndex(getSelected());
    if (idx < 0) idx = -1;
    const next = idx + 1;
    if (next >= list.length) return list[list.length - 1];
    return list[next];
  }

  function getPreviousRecord() {
    const list = getRecords();
    if (!list.length) return null;
    let idx = findIndex(getSelected());
    if (idx < 0) idx = 0;
    const prev = idx - 1;
    if (prev < 0) return list[0];
    return list[prev];
  }

  function getNavigationIndex(rec) {
    if (!rec) return -1;
    if (Number.isFinite(rec.navigationIndex)) return rec.navigationIndex;
    return findIndex(rec);
  }

  function findIndex(rec) {
    if (!rec) return -1;
    const list = getRecords();
    return list.findIndex(
      (r) =>
        r === rec ||
        (r.drainageId && rec.drainageId && r.drainageId === rec.drainageId) ||
        r.id === rec.id ||
        (r.meta && rec.meta && r.meta === rec.meta) ||
        (r.meta?.osmId && r.meta.osmId === rec.meta?.osmId),
    );
  }

  function nearestIndexToChainage(meters) {
    const list = getRecords();
    if (!list.length) return -1;
    const m = Number(meters);
    if (!Number.isFinite(m)) return 0;

    // Prefer match by actual confluence meters (river-ordered list)
    let best = 0;
    let bestD = Infinity;
    let any = false;
    for (let i = 0; i < list.length; i++) {
      const cm = getActualRiverChainageMeters(list[i]);
      if (!Number.isFinite(cm) || cm === Number.POSITIVE_INFINITY) continue;
      any = true;
      const d = Math.abs(cm - m);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (any) return best;

    const p = interpolateChainage(chainage, m);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      return nearestIndexToXZ(p.x, p.z);
    }
    return 0;
  }

  function nearestIndexToXZ(x, z) {
    const list = getRecords();
    if (!list.length || !Number.isFinite(x) || !Number.isFinite(z)) return -1;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const p = outletFocusPoint(list[i]);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function nearestIndexToView() {
    const list = getRecords();
    if (!list.length) return -1;

    // Prefer where the user is looking / standing in the scene
    const camPos = cam?.camera?.position || cam?.getCamera?.()?.position;
    const target = cam?.controls?.target;
    let x = null;
    let z = null;
    if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
      x = target.x;
      z = target.z;
    } else if (camPos && Number.isFinite(camPos.x) && Number.isFinite(camPos.z)) {
      x = camPos.x;
      z = camPos.z;
    }
    if (x != null) return nearestIndexToXZ(x, z);

    const m = state.selectedChainageMeters;
    if (Number.isFinite(m)) {
      return nearestIndexToChainage(m);
    }
    return 0;
  }

  /**
   * Public drainage camera entry — NEVER uses main-river fly-to-chainage.
   * Routes through nallaFlowSystem.focusRecord (bound camera flight).
   */
  function focusDrainage(rec, opts = {}) {
    if (!rec) {
      console.warn("[JoiningStreams] focusDrainage: missing record");
      return null;
    }
    const mode = opts.mode || "drainage-focus";
    navigationMode = mode;

    if (systemFocusRecord) {
      return systemFocusRecord(rec, cam?.camera, cam?.controls, { mode });
    }

    if (typeof cam?.startDrainageFlight === "function" || typeof cam?.focusPose === "function") {
      const pose = requirePose().computeDrainageFocusPose(rec, mode);
      if (!pose) {
        console.warn("[JoiningStreams] Invalid drainage geometry", rec.drainageId || rec.id);
        return null;
      }
      if (typeof cam.startDrainageFlight === "function") {
        cam.startDrainageFlight(pose.position, pose.target, {
          durMs: mode === "overview" ? 1100 : 900,
          fov: mode === "overview" ? 55 : 50,
        });
      } else {
        cam.focusPose({
          toP: pose.position,
          toL: pose.target,
          dur: mode === "overview" ? 1.1 : 0.95,
          ease: "outCubic",
          fov: mode === "overview" ? 55 : 50,
        });
      }
      return { record: rec, navigationIndex: rec.navigationIndex };
    }

    console.warn("[JoiningStreams] No camera flight API available");
    return null;
  }

  function requirePose() {
    return {
      computeDrainageFocusPose: (rec, mode) => {
        if (!rec?.curve?.getPointAt) return null;
        try {
          const targetT = mode === "overview" ? 0.5 : 0.62;
          const lookT = Math.min(0.92, targetT + 0.22);
          const target = rec.curve.getPointAt(targetT);
          const lookTarget = rec.curve.getPointAt(lookT);
          const tangent = rec.curve.getTangentAt(targetT).clone();
          tangent.y = 0;
          if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
          else tangent.normalize();
          const side = new THREE.Vector3()
            .crossVectors(new THREE.Vector3(0, 1, 0), tangent)
            .normalize();
          const back = mode === "overview" ? 280 : 140;
          const sideOff = mode === "overview" ? 180 : 90;
          const elev = mode === "overview" ? 140 : 70;
          const position = target
            .clone()
            .addScaledVector(tangent, -back)
            .addScaledVector(side, sideOff);
          position.y = target.y + elev;
          const look = lookTarget.clone();
          look.y += 2.5;
          return { position, target: look };
        } catch {
          return null;
        }
      },
    };
  }

  function flyCameraToDrainage(rec) {
    focusDrainage(rec, { mode: "drainage-focus" });
  }

  /**
   * @param {object|null} rec
   * @param {{ syncChainage?: boolean, focusCamera?: boolean, source?: string, holdSyncLock?: boolean, cameraMode?: string }} opts
   */
  function select(rec, opts = {}) {
    const list = getRecords();
    if (!rec) {
      selectedIndex = -1;
      flow.userData?.setSelected?.(null);
      window.__MM_JOINING_CARD__?.clear?.();
      window.__MM_JOINING_NAV__?.update?.(null, list);
      state.joiningStreamsTipActive = false;
      return null;
    }

    // Refuse disconnected drainages in Joining Streams navigation
    if (!isRiverConnectedDrainage(rec)) {
      console.warn("[JoiningStreams] Ignoring non-connected drainage", rec.drainageId || rec.id);
      return null;
    }

    let idx = findIndex(rec);
    if (idx < 0) {
      refreshRecords();
      idx = findIndex(rec);
    }
    if (idx < 0) return null;

    selectedIndex = idx;
    const full = list[idx];
    state.joiningStreamsTipActive = true;
    flow.userData?.setSelected?.(full);
    window.__MM_JOINING_CARD__?.show?.(full);
    window.__MM_JOINING_NAV__?.update?.(full, list);

    // Sync MAIN RIVER chainage marker only — NEVER fly river camera
    const riverM = getActualRiverChainageMeters(full);
    if (opts.syncChainage !== false && Number.isFinite(riverM) && riverM !== Number.POSITIVE_INFINITY) {
      syncLock = true;
      state.joiningStreamsNavigation = true;
      state.selectedChainageMeters = riverM;
      state.showChainage = true;
      document.dispatchEvent(
        new CustomEvent("chainage-select", {
          detail: {
            meters: riverM,
            focus: false,
            dragging: false,
            source: opts.source || "joining-streams",
            joiningStreamsNavigation: true,
          },
        }),
      );
      window.setTimeout(() => {
        state.joiningStreamsNavigation = false;
        if (!opts.holdSyncLock) syncLock = false;
      }, 280);
    }

    if (opts.focusCamera) {
      const camMode = opts.cameraMode || "drainage-focus";
      navigationMode = camMode;
      // Immediate camera flight — no deferred rAF that can be dropped
      focusDrainage(full, { mode: camMode });
    }

    return full;
  }

  function focusRecord(rec, opts = {}) {
    const full = select(rec, {
      syncChainage: true,
      focusCamera: false,
      source: opts.source || "focus",
      ...opts,
    });
    if (!full) return null;
    focusDrainage(full, { mode: opts.mode || "drainage-focus" });
    return full;
  }

  function selectNearestToChainage(meters, opts = {}) {
    const idx = nearestIndexToChainage(meters);
    if (idx < 0) return null;
    const list = getRecords();
    return select(list[idx], {
      syncChainage: false,
      focusCamera: false,
      source: opts.source || "chainage",
      ...opts,
    });
  }

  function selectNearestToView(opts = {}) {
    refreshRecords();
    const list = getRecords();
    if (!list.length) return null;
    const idx = nearestIndexToView();
    if (idx < 0) return null;
    return select(list[idx], {
      syncChainage: true,
      focusCamera: true,
      cameraMode: "drainage-focus",
      source: opts.source || "view",
      ...opts,
    });
  }

  function step(delta, opts = {}) {
    const list = refreshRecords();
    if (!list.length) return null;

    let idx = findIndex(getSelected());
    if (idx < 0) idx = selectedIndex;
    if (idx < 0 || idx >= list.length) idx = 0;

    // Clamp — do not wrap; do not use D-ID order
    const next =
      Number(delta) > 0
        ? Math.min(idx + 1, list.length - 1)
        : Math.max(idx - 1, 0);

    if (next === idx && list.length > 1) {
      /* at end of sequence — no wrap */
    }

    const record =
      flow.userData.selectNavigationIndex?.(next) || list[next];
    if (!record) return null;

    navigationMode = "drainage-focus";
    syncLock = true;
    selectedIndex = next;

    // UI + chainage sync WITHOUT river camera
    select(record, {
      syncChainage: true,
      focusCamera: false,
      source: opts.source || "nav",
      holdSyncLock: true,
      ...opts,
    });

    // Camera MUST follow drainage geometry
    focusDrainage(record, { mode: "drainage-focus" });

    window.setTimeout(() => {
      syncLock = false;
    }, 400);
    return record;
  }

  function goToNextDrainage() {
    return step(1, { source: "next-drainage" });
  }

  function goToPreviousDrainage() {
    return step(-1, { source: "previous-drainage" });
  }

  function nextDrainage() {
    return goToNextDrainage();
  }

  function previousDrainage() {
    return goToPreviousDrainage();
  }

  function selectDrainage(indexOrRec) {
    if (typeof indexOrRec === "number") {
      const rec = flow.userData.selectNavigationIndex?.(indexOrRec) || getRecord(indexOrRec);
      if (!rec) return null;
      select(rec, { syncChainage: true, focusCamera: false, source: "select-drainage" });
      focusDrainage(rec, { mode: "drainage-focus" });
      return rec;
    }
    return focusRecord(indexOrRec, { source: "select-drainage" });
  }

  function focusSelectedDrainage() {
    const rec = getSelected();
    if (!rec) return null;
    return focusDrainage(rec, { mode: "drainage-focus" });
  }

  function setEnabled(on) {
    if (on) activate();
    else deactivate();
  }

  function activate() {
    active = true;
    refreshRecords();
    const list = getRecords();
    // Open on the drainage nearest the user's current view — NOT always river-start #1
    const nearIdx = nearestIndexToView();
    const sel = (nearIdx >= 0 ? list[nearIdx] : null) || list[0] || null;
    if (sel) {
      selectedIndex = nearIdx >= 0 ? nearIdx : 0;
      select(sel, {
        source: "activate",
        syncChainage: true,
        focusCamera: false,
      });
    }
    window.__MM_JOINING_NAV__?.setVisible?.(true);
    window.__MM_JOINING_NAV__?.update?.(getSelected(), getRecords());
    if (sel) {
      navigationMode = "drainage-focus";
      focusDrainage(sel, { mode: "drainage-focus" });
    }
  }

  function deactivate() {
    active = false;
    navigationMode = "idle";
    selectedIndex = -1;
    flow.userData?.setSelected?.(null);
    flow.userData?.setHovered?.(null);
    window.__MM_JOINING_CARD__?.clear?.();
    window.__MM_JOINING_NAV__?.setVisible?.(false);
    window.__MM_JOINING_NAV__?.update?.(null, []);
    state.joiningStreamsTipActive = false;
  }

  function onChainageSelect(meters) {
    if (!active || syncLock) return;
    if (!Number.isFinite(Number(meters))) return;
    // Ruler owns camera — only refresh which nalla card is nearest
    selectNearestToChainage(meters, {
      source: "chainage",
      syncChainage: false,
      focusCamera: false,
    });
  }

  function panelPayload(rec) {
    if (!rec) return null;
    const m = rec.meta || {};
    const latLon = outletLatLon(rec, dataset);
    return {
      title: "JOINING STREAMS",
      name: formatDisplayName(rec),
      id: rec.displayId || rec.id,
      type: drainageTypeLabel(m.waterway),
      chainageLabel:
        rec.riverChainageLabel ||
        rec.nearestChainageLabel ||
        (rec.riverChainageMeters != null
          ? metersToStation(rec.riverChainageMeters)
          : rec.nearestChainageMeters != null
            ? metersToStation(rec.nearestChainageMeters)
            : "—"),
      distanceM:
        rec.distanceToRiverM != null
          ? Math.round(rec.distanceToRiverM)
          : rec.connection?.distance != null
            ? Math.round(rec.connection.distance)
            : null,
      flow: "→ River",
      status: rec.connectsToRiver ? "Connected" : "Disconnected",
      lat: latLon?.lat ?? null,
      lon: latLon?.lon ?? null,
      index: rec.navigationNumber ?? (rec.navIndex ?? 0) + 1,
      total: getRecords().length,
      drainageId: rec.drainageId || rec.displayId,
    };
  }

  // Expose record helpers — do NOT replace system focusRecord camera flight
  flow.userData.getRecord = getRecord;
  flow.userData.getCurrentRecord = getCurrentRecord;
  flow.userData.getNextRecord = getNextRecord;
  flow.userData.getPreviousRecord = getPreviousRecord;
  flow.userData.getRiverOrderedRecords = getRiverOrderedRecords;
  flow.userData.getNavigationRecords = getRiverOrderedRecords;
  flow.userData.getNavigationIndex = (rec) =>
    rec == null ? selectedIndex : getNavigationIndex(rec);
  flow.userData.getNearestRecordToChainage = (meters) => {
    const idx = nearestIndexToChainage(meters);
    return idx >= 0 ? getRecords()[idx] : null;
  };
  // Combined select + camera fly (keeps system camera implementation)
  flow.userData.focusRecord = (recordOrIndex, camera, controls, opts = {}) => {
    const record =
      typeof recordOrIndex === "number" ? getRecord(recordOrIndex) : recordOrIndex;
    if (!record) return null;
    select(record, {
      syncChainage: opts.syncChainage !== false,
      focusCamera: false,
      source: opts.source || "focus",
    });
    if (systemFocusRecord) {
      return systemFocusRecord(record, camera || cam?.camera, controls || cam?.controls, opts);
    }
    return focusDrainage(record, opts);
  };
  flow.userData.focusDrainage = (rec, opts) => focusDrainage(rec, opts);

  return {
    refreshRecords,
    getRecords,
    getRiverOrderedRecords,
    getSelected,
    getSelectedDrainage: getSelected,
    getRecord,
    getCurrentRecord,
    getNextRecord,
    getPreviousRecord,
    getNavigationIndex,
    select,
    selectDrainage,
    focusRecord,
    focusDrainage,
    focusSelectedDrainage,
    selectNearestToChainage,
    selectNearestToView,
    nearestIndexToView,
    step,
    goToNextDrainage,
    goToPreviousDrainage,
    nextDrainage,
    previousDrainage,
    next: nextDrainage,
    previous: previousDrainage,
    activate,
    deactivate,
    setEnabled,
    onChainageSelect,
    panelPayload,
    isSyncLocked: () => syncLock,
    isActive: () => active,
    getNavigationMode: () => navigationMode,
  };
}

/**
 * Source drainage name only (OSM/KML). Never invents "Unnamed …" or uses D-IDs.
 * @returns {string} real name, or "" when unnamed
 */
export function resolveDrainageSourceName(rec) {
  if (!rec) return "";
  const m = rec.meta || {};
  const candidates = [m.name, m.nameEn, m.intName, rec.name];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (!s) continue;
    if (/^unnamed\b/i.test(s)) continue;
    return s;
  }
  return "";
}

/** Visible display name = source name only (empty when unnamed). */
export function formatDisplayName(rec) {
  return resolveDrainageSourceName(rec);
}

export function hasDrainageSourceName(rec) {
  return resolveDrainageSourceName(rec).length > 0;
}

export function drainageTypeLabel(waterway) {
  const s = String(waterway || "").toLowerCase();
  if (s === "drain") return "Minor Drainage";
  if (s === "stream") return "Stream / Nullah";
  if (s === "canal") return "Canal";
  if (s === "ditch") return "Ditch";
  if (s) return s.charAt(0).toUpperCase() + s.slice(1);
  return "Minor Drainage";
}

function outletLatLon(rec, dataset) {
  const ordered = rec.orderedPts?.length ? rec.orderedPts : rec.pts;
  const end = ordered?.[ordered.length - 1];
  if (end && Number.isFinite(end.lon) && Number.isFinite(end.lat)) {
    return validateLonLat(end.lon, end.lat);
  }
  const conn = rec.connection?.nallaPoint;
  if (conn && Number.isFinite(conn.lon) && Number.isFinite(conn.lat)) {
    return validateLonLat(conn.lon, conn.lat);
  }
  if (end && dataset?.frame?.toLonLat) {
    const ll = dataset.frame.toLonLat(end.x, end.z);
    return validateLonLat(ll.lon, ll.lat);
  }
  return null;
}

/** Mula–Mutha AOI sanity — refuse swapped lat/lon. */
export function validateLonLat(lon, lat) {
  const lo = Number(lon);
  const la = Number(lat);
  if (!Number.isFinite(lo) || !Number.isFinite(la)) return null;
  if (lo >= 72.5 && lo <= 75.5 && la >= 17.5 && la <= 20.0) {
    return { lon: lo, lat: la };
  }
  if (la >= 72.5 && la <= 75.5 && lo >= 17.5 && lo <= 20.0) {
    console.warn("[joining-streams] lat/lon appear swapped — correcting", { lon: lo, lat: la });
    return { lon: la, lat: lo };
  }
  return { lon: lo, lat: la };
}

function outletFocusPoint(rec) {
  if (rec.outletPoint && Number.isFinite(rec.outletPoint.x) && Number.isFinite(rec.outletPoint.z)) {
    return {
      x: rec.outletPoint.x,
      y: rec.outletPoint.y,
      z: rec.outletPoint.z,
    };
  }
  const bank = rec.connection?.bankPoint;
  if (bank && Number.isFinite(bank.x) && Number.isFinite(bank.z)) {
    return { x: bank.x, z: bank.z, y: bank.y };
  }
  const river = rec.connection?.riverPoint;
  if (river && Number.isFinite(river.x) && Number.isFinite(river.z)) {
    return { x: river.x, z: river.z, y: river.y };
  }
  const nalla = rec.connection?.nallaPoint;
  if (nalla && Number.isFinite(nalla.x) && Number.isFinite(nalla.z)) {
    return { x: nalla.x, z: nalla.z, y: nalla.y };
  }
  if (rec.curve?.getPointAt) {
    try {
      const p = rec.curve.getPointAt(1);
      return { x: p.x, y: p.y, z: p.z };
    } catch {
      /* fall through */
    }
  }
  const ordered = rec.orderedPts;
  if (ordered?.length) {
    const p = ordered[ordered.length - 1];
    return { x: p.x, z: p.z, y: p.y };
  }
  return null;
}

/**
 * Elevated oblique aerial pose from drainage geometry (Screenshot 2 style).
 * Side-offset + above + looking diagonally toward nalla → confluence → river.
 * NEVER uses main-river chainage station pose.
 *
 * @param {object} rec
 * @param {"drainage-focus" | "overview"} mode
 */
function computeDrainageCameraPose(rec, mode = "drainage-focus") {
  let points = null;
  try {
    points = rec.curve?.getPoints?.(100) || null;
    if (!points?.length && rec.curve?.getPointAt) {
      points = Array.from({ length: 101 }, (_, i) => rec.curve.getPointAt(i / 100));
    }
  } catch {
    points = null;
  }

  if (!points || points.length < 2) {
    const fallback = outletFocusPoint(rec);
    if (!fallback) return null;
    const target = new THREE.Vector3(
      fallback.x,
      (Number.isFinite(fallback.y) ? fallback.y : SURFACE_Y) + 2,
      fallback.z,
    );
    const position = target.clone().add(new THREE.Vector3(120, 90, -150));
    return { position, target };
  }

  const last = points[points.length - 1];
  const bank = rec.connection?.bankPoint;
  const river = rec.connection?.riverPoint;

  const outlet = new THREE.Vector3(
    Number.isFinite(bank?.x) ? bank.x : Number.isFinite(river?.x) ? river.x : last.x,
    Number.isFinite(last.y)
      ? last.y
      : Number.isFinite(bank?.y)
        ? bank.y
        : SURFACE_Y,
    Number.isFinite(bank?.z) ? bank.z : Number.isFinite(river?.z) ? river.z : last.z,
  );

  const up = points[Math.max(0, points.length - 15)];
  const upstream = new THREE.Vector3(up.x, up.y, up.z);
  // Prefer ~60% along drainage path (not river station)
  const focusIdx = Math.floor(points.length * 0.6);
  const focusPt = points[focusIdx];
  const drainageFocus = new THREE.Vector3(focusPt.x, focusPt.y, focusPt.z);

  const direction = new THREE.Vector3().subVectors(outlet, upstream);
  direction.y = 0;
  if (direction.lengthSq() < 1e-6) direction.set(0.55, 0, 0.65);
  else direction.normalize();

  // Perpendicular side vector (horizontal)
  const side = new THREE.Vector3(-direction.z, 0, direction.x).normalize();

  // Prefer the land side: camera opposite the river center when known
  let sideSign = 1;
  if (river && Number.isFinite(river.x) && Number.isFinite(river.z)) {
    const toRiver = new THREE.Vector3(river.x - drainageFocus.x, 0, river.z - drainageFocus.z);
    if (toRiver.lengthSq() > 1e-6) {
      toRiver.normalize();
      if (side.dot(toRiver) > 0) sideSign = -1;
    }
  }

  // Target stays on selected drainage; slight blend toward outlet/confluence
  const target = drainageFocus.clone().lerp(outlet, 0.28);
  target.y = (Number.isFinite(target.y) ? target.y : SURFACE_Y) + 3;

  const len = Math.max(40, rec.curveLength || drainageFocus.distanceTo(outlet) * 2 || 120);
  const overview = mode === "overview";

  // Elevated oblique aerial — side + back + height (never top-down / river-center)
  const sideDist = overview
    ? THREE.MathUtils.clamp(len * 1.0, 200, 480)
    : THREE.MathUtils.clamp(len * 0.7, 110, 240);
  const backDist = overview
    ? THREE.MathUtils.clamp(len * 1.15, 240, 560)
    : THREE.MathUtils.clamp(len * 0.8, 140, 300);
  const elev = overview
    ? THREE.MathUtils.clamp(len * 0.55, 120, 260)
    : THREE.MathUtils.clamp(len * 0.38, 70, 150);

  const cameraPosition = target
    .clone()
    .addScaledVector(side, sideSign * sideDist)
    .addScaledVector(direction, -backDist);
  cameraPosition.y = target.y + elev;

  // Keep a clear oblique: never nearly top-down
  const horiz = Math.hypot(cameraPosition.x - target.x, cameraPosition.z - target.z);
  if (horiz < elev * 1.05) {
    const need = elev * 1.35;
    const scale = need / Math.max(1, horiz);
    cameraPosition.x = target.x + (cameraPosition.x - target.x) * scale;
    cameraPosition.z = target.z + (cameraPosition.z - target.z) * scale;
  }

  return { position: cameraPosition, target };
}
