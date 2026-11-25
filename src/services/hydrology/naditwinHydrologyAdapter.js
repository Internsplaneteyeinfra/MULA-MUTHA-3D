/**
 * Central NadiTwin → River.EYE hydrology adapter.
 * LIVE authority for discharge; forecast kept separately labelled.
 */

import {
  fetchNadiTwinDischargeProfile,
  fetchNadiTwinForecastProfile,
  fetchNadiTwinHydrograph,
  fetchNadiTwinLive,
  fetchNadiTwinMargins,
  fetchNadiTwinMeta,
  fetchNadiTwinState,
} from "./naditwinApi.js";
import {
  normalizeDischargeProfile,
  normalizeHydrograph,
  normalizeLiveState,
  qAtLocalChainage,
  validateChainageAlignment,
} from "./hydrologyNormalizer.js";
import {
  classifySyntheticForecast,
  DATA_CLASS,
  freshnessLabel,
} from "./hydrologyProvenance.js";
import { PROVENANCE_STATUS } from "./hydrologyContract.js";

const POLL_MS = 60_000;
const listeners = new Set();

let _bundle = null;
let _alignment = null;
let _lastError = null;
let _pollTimer = null;
let _localStations = null;
/** When false, safety boards stay inactive (relative WSE / unverified crest). */
let _safetyUnlocked = false;

function notify() {
  const payload = getAdapterSnapshot();
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch (err) {
      console.warn("[naditwinAdapter] listener error", err);
    }
  }
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("naditwin-hydrology-change", { detail: payload }));
  }
}

export function subscribeNadiTwinHydrology(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAdapterSnapshot() {
  const hasLive = Number.isFinite(_bundle?.live?.discharge_m3s);
  // API failure must not silently present retained values as LIVE.
  const quality = !_bundle
    ? "UNAVAILABLE"
    : _lastError
      ? "STALE"
      : hasLive
        ? "LIVE"
        : "UNAVAILABLE";
  return {
    available: hasLive,
    live: _bundle?.live || null,
    dischargeProfile: _bundle?.dischargeProfile || null,
    alignment: _alignment,
    safetyUnlocked: _safetyUnlocked,
    lastError: _lastError,
    updatedAt: _bundle?.fetchedAt || null,
    quality,
    note: _lastError
      ? `STALE — last verified ${_bundle?.fetchedAt || "unknown"}; refresh failed: ${_lastError.message}`
      : null,
  };
}

export function getNadiTwinLiveBundle() {
  return _bundle?.live || null;
}

/** Raw /api/meta payload (crest/bed/zones) — used for NadiTwin-parity stage chart. */
export function getNadiTwinRawMeta() {
  return _bundle?.rawMeta || null;
}

export function getNadiTwinAlignment() {
  return _alignment;
}

/**
 * Authoritative live Q at local chainage (meters). Falls back to outlet Q.
 */
export function getNadiTwinDischargeAtChainage(meters) {
  const live = _bundle?.live;
  if (!live) return null;
  const q = qAtLocalChainage(live, meters);
  if (Number.isFinite(q)) {
    return {
      q_m3s: q,
      dataClass: DATA_CLASS.LIVE,
      provenance: live.provenance,
      source: live.source,
      timestamp: live.timestamp,
      freshness: freshnessLabel(live.timestamp),
      note: live.note,
    };
  }
  if (Number.isFinite(live.discharge_m3s)) {
    return {
      q_m3s: live.discharge_m3s,
      dataClass: DATA_CLASS.LIVE,
      provenance: live.provenance,
      source: live.source,
      timestamp: live.timestamp,
      freshness: freshnessLabel(live.timestamp),
      note: `${live.note} · outlet Q (chainage join miss)`,
    };
  }
  return null;
}

export function setLocalChainageStations(stations) {
  _localStations = Array.isArray(stations) ? stations : null;
  if (_bundle?.rawMeta) {
    _alignment = validateChainageAlignment(_bundle.rawMeta, _localStations || []);
  }
}

/**
 * Safety boards remain locked until crest/datum are explicitly validated.
 * Relative WSE alone is insufficient.
 */
export function unlockSafetyBoards({ confirmed = false, reason = "" } = {}) {
  _safetyUnlocked = !!confirmed;
  if (!_safetyUnlocked) {
    console.info("[naditwinAdapter] Safety boards locked:", reason || "datum/crest not validated");
  }
  notify();
  return _safetyUnlocked;
}

export function areSafetyBoardsUnlocked() {
  return _safetyUnlocked;
}

export async function refreshNadiTwinHydrology() {
  try {
    const [metaRes, stateRes, liveRes, profileRes] = await Promise.all([
      fetchNadiTwinMeta(),
      fetchNadiTwinState(),
      fetchNadiTwinLive(),
      fetchNadiTwinDischargeProfile().catch(() => null),
    ]);

    const meta = metaRes.data;
    const state = stateRes.data;
    const live = liveRes.data;
    _alignment = validateChainageAlignment(meta, _localStations || []);
    const normalizedLive = normalizeLiveState(state, meta, live);
    const dischargeProfile = profileRes?.data
      ? normalizeDischargeProfile(profileRes.data)
      : null;

    _bundle = {
      live: normalizedLive,
      dischargeProfile,
      rawMeta: meta,
      fetchedAt: new Date().toISOString(),
      proxy: {
        stateFromCache: !!stateRes.fromCache,
        liveFromCache: !!liveRes.fromCache,
        latencyMs: stateRes.latencyMs ?? liveRes.latencyMs ?? null,
      },
    };
    _lastError = null;
    notify();
    return getAdapterSnapshot();
  } catch (err) {
    _lastError = {
      message: err?.message || String(err),
      status: err?.status ?? null,
      at: new Date().toISOString(),
    };
    console.warn("[naditwinAdapter] refresh failed — keeping previous bundle", _lastError);
    notify();
    return getAdapterSnapshot();
  }
}

export function startNadiTwinHydrologyPolling(intervalMs = POLL_MS) {
  if (_pollTimer) return;
  refreshNadiTwinHydrology().catch(() => {});
  _pollTimer = setInterval(() => {
    refreshNadiTwinHydrology().catch(() => {});
  }, intervalMs);
  if (typeof _pollTimer === "object" && typeof _pollTimer.unref === "function") {
    _pollTimer.unref();
  }
}

export function stopNadiTwinHydrologyPolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

export async function getNadiTwinHydrographAtCell(cell, hours = 72) {
  const res = await fetchNadiTwinHydrograph(cell, hours);
  return normalizeHydrograph(res.data);
}

export async function getNadiTwinHydrographAtChainage(meters, hours = 72) {
  const live = _bundle?.live;
  const step = live?.chainage_step_m || 10;
  const n = live?.n_cells || 1681;
  let cell = Math.round(Number(meters) / step);
  if (!Number.isFinite(cell) || cell < 0) cell = 0;
  if (cell >= n) cell = n - 1;
  return getNadiTwinHydrographAtCell(cell, hours);
}

export async function getNadiTwinForecastAlongReach(leadH = 24) {
  try {
    const res = await fetchNadiTwinForecastProfile(leadH);
    return {
      ok: true,
      dataClass: DATA_CLASS.FORECAST,
      provenance: PROVENANCE_STATUS.MODELLED,
      source: "NADITWIN_API",
      lead_h: leadH,
      payload: res.data,
      note: "NadiTwin forecast profile — not LIVE",
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      fallback: classifySyntheticForecast(),
    };
  }
}

/**
 * Margins / safety — returns locked payload unless unlockSafetyBoards(true).
 */
export async function getNadiTwinSafetyBoard(kind = "landmarks") {
  if (!_safetyUnlocked) {
    return {
      locked: true,
      reason:
        "Safety boards gated: NadiTwin WSE datum is relative and bank crest/DEM assumptions are unverified for River.EYE 3D.",
      alignment: _alignment,
      dataClass: DATA_CLASS.UNAVAILABLE,
    };
  }
  const res = await fetchNadiTwinMargins(kind);
  return {
    locked: false,
    dataClass: DATA_CLASS.LIVE,
    kind,
    rows: res.data,
    timestamp: res.fetchedAt,
    note: "Unlocked safety board — verify crest elevations before operational use",
  };
}

/** Patch hydraulic profile records with NadiTwin per-station Q (nearest cell). */
export function applyNadiTwinQToProfileRecords(records) {
  const live = _bundle?.live;
  if (!live?.q_station?.length || !Array.isArray(records)) return records;
  const step = live.chainage_step_m || 10;
  const n = live.n_cells;
  const ts = live.timestamp;
  for (const rec of records) {
    const ch = Number(rec.chainage_m);
    if (!Number.isFinite(ch)) continue;
    let idx = Math.round(ch / step);
    if (ch < 0) idx = 0;
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    const q = live.q_station[idx];
    if (!Number.isFinite(q)) continue;
    rec.discharge_m3s = {
      value: q,
      unit: "m³/s",
      status: PROVENANCE_STATUS.MODELLED,
      source: live.source,
      timestamp: ts,
      note: live.note,
      dataClass: DATA_CLASS.LIVE,
    };
  }
  return records;
}
