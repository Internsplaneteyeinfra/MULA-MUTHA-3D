import { state } from "../../state.js";
import { metersToStation } from "../chainageMarkers.js";
import { interpolateChainage } from "../../geo/chainage.js";

/**
 * Orchestrates Joining Streams selection, chainage sync, and UI updates.
 * Uses real nallaFlow records only — no invented coordinates.
 */
export function createJoiningStreamsController({ dataset, nallaFlow, cam }) {
  const chainage = [...(dataset?.chainage || [])].sort(
    (a, b) => (a.meters ?? 0) - (b.meters ?? 0),
  );
  /** @type {object[]} */
  let records = [];
  let selectedIndex = -1;
  let syncLock = false;
  let active = false;

  function refreshRecords() {
    const raw = nallaFlow?.userData?.records || [];
    records = [...raw].sort((a, b) => {
      const am = a.nearestChainageMeters ?? Number.POSITIVE_INFINITY;
      const bm = b.nearestChainageMeters ?? Number.POSITIVE_INFINITY;
      if (am !== bm) return am - bm;
      return String(a.displayId || a.id).localeCompare(String(b.displayId || b.id));
    });
    // Stable display indices after sort (D-1 … D-n upstream → downstream)
    records.forEach((r, i) => {
      r.navIndex = i;
      r.displayId = `D-${i + 1}`;
      r.displayName = formatDisplayName(r);
    });
    return records;
  }

  function getRecords() {
    if (!records.length) refreshRecords();
    return records;
  }

  function getSelected() {
    if (selectedIndex < 0 || selectedIndex >= records.length) return null;
    return records[selectedIndex];
  }

  function findIndex(rec) {
    if (!rec) return -1;
    const list = getRecords();
    return list.findIndex(
      (r) =>
        r === rec ||
        r.id === rec.id ||
        (r.meta && rec.meta && r.meta === rec.meta) ||
        (r.meta?.osmId && r.meta.osmId === rec.meta?.osmId),
    );
  }

  /** Nearest drainage to a chainage station — use river XZ (reliable), not sparse alongM alone. */
  function nearestIndexToChainage(meters) {
    const list = getRecords();
    if (!list.length) return -1;
    const m = Number(meters);
    if (!Number.isFinite(m)) return 0;

    const p = interpolateChainage(chainage, m);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
      return nearestIndexToXZ(p.x, p.z);
    }

    let best = 0;
    let bestD = Infinity;
    let any = false;
    for (let i = 0; i < list.length; i++) {
      const cm = list[i].nearestChainageMeters;
      if (cm == null) continue;
      any = true;
      const d = Math.abs(cm - m);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return any ? best : 0;
  }

  /** Nearest drainage by outlet / bank confluence XZ (true “where I am”). */
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

  /** Prefer camera look-at; fall back to selected chainage station XZ / meters. */
  function nearestIndexToView() {
    const list = getRecords();
    if (!list.length) return -1;

    const target = cam?.controls?.target;
    if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
      return nearestIndexToXZ(target.x, target.z);
    }

    const m = state.selectedChainageMeters;
    if (Number.isFinite(m) && chainage.length) {
      const p = interpolateChainage(chainage, m);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
        return nearestIndexToXZ(p.x, p.z);
      }
      return nearestIndexToChainage(m);
    }
    return 0;
  }

  /**
   * @param {object|null} rec
   * @param {{ syncChainage?: boolean, focusCamera?: boolean, source?: string }} opts
   */
  function select(rec, opts = {}) {
    const list = getRecords();
    if (!rec) {
      selectedIndex = -1;
      nallaFlow?.userData?.setSelected?.(null);
      window.__MM_JOINING_CARD__?.clear?.();
      window.__MM_JOINING_NAV__?.update?.(null, list);
      state.joiningStreamsTipActive = false;
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
    nallaFlow?.userData?.setSelected?.(full);
    window.__MM_JOINING_CARD__?.show?.(full);
    window.__MM_JOINING_NAV__?.update?.(full, list);

    if (opts.syncChainage !== false && Number.isFinite(full.nearestChainageMeters)) {
      syncLock = true;
      const meters = full.nearestChainageMeters;
      state.selectedChainageMeters = meters;
      state.showChainage = true;
      document.dispatchEvent(
        new CustomEvent("chainage-select", {
          detail: {
            meters,
            focus: false,
            dragging: false,
            source: opts.source || "joining-streams",
          },
        }),
      );
      // Don't clear syncLock here if step() owns a longer lock
      if (!opts.holdSyncLock) {
        window.setTimeout(() => {
          syncLock = false;
        }, 280);
      }
    }

    if (opts.focusCamera && cam?.focusOnXZ) {
      const target = confluenceFocusPoint(full);
      if (target) {
        cam.focusOnXZ(target.x, target.z, {
          cameraHeight: 34,
          cameraDistance: 95,
          lookAheadDistance: 28,
          lookY: (target.y ?? 0) + 4,
          lateralOffset: 18,
          fov: 52,
          dur: 0.9,
          ease: "outCubic",
        });
      }
    }

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

  /** Select drainage nearest to current camera / chainage and optionally fly to it. */
  function selectNearestToView(opts = {}) {
    refreshRecords();
    const list = getRecords();
    if (!list.length) return null;
    const idx = nearestIndexToView();
    if (idx < 0) return null;
    return select(list[idx], {
      syncChainage: true,
      focusCamera: true,
      source: opts.source || "view",
      ...opts,
    });
  }

  function step(delta, opts = {}) {
    const list = refreshRecords();
    if (!list.length) return null;

    let idx = findIndex(getSelected());
    if (idx < 0) idx = selectedIndex;
    if (idx < 0 || idx >= list.length) {
      const m = state.selectedChainageMeters;
      idx = Number.isFinite(m) ? nearestIndexToChainage(m) : nearestIndexToView();
    }
    if (idx < 0) idx = 0;

    const next = (idx + Number(delta || 0) + list.length * 64) % list.length;
    syncLock = true;
    const full = select(list[next], {
      syncChainage: true,
      focusCamera: true,
      source: "nav",
      holdSyncLock: true,
      ...opts,
    });
    window.setTimeout(() => {
      syncLock = false;
    }, 400);
    return full;
  }

  function activate() {
    active = true;
    refreshRecords();
    // Prefer current chainage stake (where user already is), then fly to that nearest nalla
    const m = state.selectedChainageMeters;
    if (Number.isFinite(m)) {
      selectNearestToChainage(m, {
        source: "activate",
        syncChainage: true,
        focusCamera: true,
      });
    } else {
      selectNearestToView({ source: "activate" });
    }
    window.__MM_JOINING_NAV__?.setVisible?.(true);
    const sel = getSelected();
    window.__MM_JOINING_NAV__?.update?.(sel, getRecords());
  }

  function deactivate() {
    active = false;
    selectedIndex = -1;
    nallaFlow?.userData?.setSelected?.(null);
    nallaFlow?.userData?.setHovered?.(null);
    window.__MM_JOINING_CARD__?.clear?.();
    window.__MM_JOINING_NAV__?.setVisible?.(false);
    window.__MM_JOINING_NAV__?.update?.(null, []);
    state.joiningStreamsTipActive = false;
  }

  function onChainageSelect(meters, detail = {}) {
    if (!active || syncLock) return;
    if (!Number.isFinite(Number(meters))) return;
    // Chainage ruler owns the camera — only refresh which nalla card is nearest
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
      name: rec.displayName || formatDisplayName(rec),
      id: rec.displayId || rec.id,
      type: drainageTypeLabel(m.waterway),
      chainageLabel:
        rec.nearestChainageLabel ||
        (rec.nearestChainageMeters != null
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
      index: (rec.navIndex ?? 0) + 1,
      total: getRecords().length,
    };
  }

  // Keep chainage interpolation available for callers
  void interpolateChainage;

  return {
    refreshRecords,
    getRecords,
    getSelected,
    select,
    selectNearestToChainage,
    selectNearestToView,
    nearestIndexToView,
    step,
    activate,
    deactivate,
    onChainageSelect,
    panelPayload,
    isSyncLocked: () => syncLock,
    isActive: () => active,
  };
}

function formatDisplayName(rec) {
  const m = rec?.meta || {};
  const raw = String(m.name || m.nameEn || m.intName || rec?.name || "").trim();
  const id = rec.displayId || rec.id || "";
  if (raw && !/^unnamed/i.test(raw)) return `${raw} (${id})`;
  return `Unnamed channel (${id})`;
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
  // Pune / Mula–Mutha: lon ~73.5–74.2 E, lat ~18.3–18.8 N
  if (lo >= 72.5 && lo <= 75.5 && la >= 17.5 && la <= 20.0) {
    return { lon: lo, lat: la };
  }
  // Likely swapped
  if (la >= 72.5 && la <= 75.5 && lo >= 17.5 && lo <= 20.0) {
    console.warn("[joining-streams] lat/lon appear swapped — correcting", { lon: lo, lat: la });
    return { lon: la, lat: lo };
  }
  return { lon: lo, lat: la };
}

function outletFocusPoint(rec) {
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
  const ordered = rec.orderedPts;
  if (ordered?.length) {
    const p = ordered[ordered.length - 1];
    return { x: p.x, z: p.z, y: p.y };
  }
  return null;
}

function confluenceFocusPoint(rec) {
  return outletFocusPoint(rec);
}
