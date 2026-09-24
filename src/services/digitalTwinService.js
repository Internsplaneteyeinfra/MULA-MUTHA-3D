/**
 * Digital Twin Service — Mula–Mutha River
 *
 * Authoritative data layer for the operational dashboard.
 * Wraps ForecastEngine to expose:
 *   - Asset registry (landmarks from naditwin/landmarks.json)
 *   - Per-asset risk: WSE margin, P72h, threshold
 *   - Hydrograph: observed (72h past) + forecast ensemble quantiles + threshold
 *   - Reach-wide hydraulic snapshot
 *
 * Events dispatched on document:
 *   "twin-state-change"  — {detail: TwinState}  whenever state changes
 *   "twin-asset-select"  — {detail: {id, asset}} when an asset is focused
 *
 * NEVER labels modelled data as LIVE — dischargeLabel is "MODEL" unless a gauge is connected.
 */

import { getForecastEngine, FORECAST_HORIZONS } from "./forecastService.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** WSE flood threshold per asset class (m above datum) */
const THRESHOLD_BY_CLASS = {
  bridge: 2.5,
  landmark: 1.8,
  intake: 1.2,
  outfall: 1.0,
  default: 2.0,
};

/** Warning margin below threshold that triggers WARN status (m) */
const WARN_MARGIN_M = 0.5;

/** Hydrograph past hours to present in chart */
const HYDRO_PAST_H = 72;
/** Hydrograph forecast hours to present in chart */
const HYDRO_FUTURE_H = 72;

// ─── Internal state ──────────────────────────────────────────────────────────

let _engine = null;
let _assets = []; // enriched asset list
let _state = null; // last emitted TwinState
let _selectedAssetId = null;
let _forecastHorizon = 24; // active horizon for dashboard charts (hours)
let _initPromise = null;

// ─── Bootstrap ───────────────────────────────────────────────────────────────

/**
 * Initialise the service (idempotent).
 * @returns {Promise<TwinState>}
 */
export function initDigitalTwin() {
  if (!_initPromise) {
    _initPromise = _bootstrap().catch((err) => {
      _initPromise = null;
      console.error("[DigitalTwin] init failed:", err);
      throw err;
    });
  }
  return _initPromise;
}

async function _bootstrap() {
  const [eng, landmarks] = await Promise.all([
    getForecastEngine(),
    _fetchLandmarks(),
  ]);
  _engine = eng;
  _assets = _buildAssets(landmarks, eng);
  _state = _computeState();
  _dispatch("twin-state-change", _state);

  // Refresh every 30 s (re-uses same engine, just recomputes)
  setInterval(() => {
    _state = _computeState();
    _dispatch("twin-state-change", _state);
  }, 30_000);

  return _state;
}

async function _fetchLandmarks() {
  try {
    const res = await fetch("/data/naditwin/landmarks.json", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch {
    return [];
  }
}

// ─── Asset registry ──────────────────────────────────────────────────────────

function _buildAssets(landmarks, eng) {
  return landmarks.map((lm, idx) => {
    const assetClass = _inferClass(lm);
    const threshold_m = THRESHOLD_BY_CLASS[assetClass] ?? THRESHOLD_BY_CLASS.default;
    return {
      id: `asset-${idx}`,
      name: lm.name,
      chainage_m: lm.chainage_m,
      chainage_km: lm.chainage_km ?? lm.chainage_m / 1000,
      lon: lm.lon,
      lat: lm.lat,
      assetClass,
      threshold_m,
      /** resolved at compute time */ wse_m: null,
      margin_m: null,
      status: "ok",
      riskScore: 0,
    };
  });
}

function _inferClass(lm) {
  const n = (lm.name || "").toLowerCase();
  if (/bridge|bandh|dam/i.test(n)) return "bridge";
  if (/intake|pump/i.test(n)) return "intake";
  if (/outfall|drain|nullah/i.test(n)) return "outfall";
  return "landmark";
}

// ─── State computation ───────────────────────────────────────────────────────

function _computeState() {
  if (!_engine) return null;

  const hydraulic = _engine.currentHydraulic();
  const { wse, chainage_m, bed, discharge_m3s: q0 } = hydraulic;

  // Enrich assets
  const enriched = _assets.map((a) => {
    const cell = _engine.cellForChainage(a.chainage_m);
    const wse_m = Array.isArray(wse) && wse.length > 0 ? (wse[cell] ?? wse[0]) : 0;
    const margin_m = a.threshold_m - wse_m;
    const status = _riskStatus(margin_m);
    const p72h_wse = _p72hWse(cell);
    const p72h_margin = a.threshold_m - p72h_wse;
    const riskScore = _riskScore(margin_m, p72h_margin);
    return {
      ...a,
      wse_m: round2(wse_m),
      margin_m: round2(margin_m),
      p72h_wse: round2(p72h_wse),
      p72h_margin: round2(p72h_margin),
      status,
      riskScore,
    };
  });

  // Risk counts
  const riskCounts = { critical: 0, warn: 0, ok: 0 };
  enriched.forEach((a) => (riskCounts[a.status] = (riskCounts[a.status] || 0) + 1));

  // Hydrograph
  const hydrograph = _buildHydrograph(_engine);

  // Selected asset detail
  const selectedAsset = _selectedAssetId
    ? enriched.find((a) => a.id === _selectedAssetId) ?? null
    : null;

  // Compute Volume and Velocity
  let _totalVolume = 0;
  let sumVel = 0;
  let countCells = 0;
  if (wse && bed && chainage_m && _engine.realWidthM) {
    const reachQ = hydraulic.discharge_reach_m3s || q0;
    for (let i = 0; i < wse.length - 1; i++) {
      const depth = Math.max(0, wse[i] - bed[i]);
      const w = _engine.realWidthM[i] || 1;
      const area = depth * w;
      const dx = chainage_m[i + 1] - chainage_m[i];
      if (dx > 0) {
        _totalVolume += area * dx;
      }
      if (area > 0) {
        const qLocal = reachQ * _engine.localDischargeFactor(i);
        sumVel += qLocal / area;
        countCells++;
      }
    }
  }
  const _meanVelocity = countCells > 0 ? sumVel / countCells : 0;

  return {
    timestamp: Date.now(),
    assets: enriched,
    riskCounts,
    hydrograph,
    selectedAsset,
    forecastHorizon: _forecastHorizon,
    discharge_m3s: round2(q0),
    meanWse_m: round2(wse && wse.length ? wse.reduce((s, v) => s + v, 0) / wse.length : 0),
    meanVelocity_ms: round2(_meanVelocity),
    totalVolume_m3: _totalVolume,
    dischargeSource: hydraulic.dischargeSource ?? "model",
    dischargeLabel: hydraulic.dischargeLabel ?? "MODEL",
    reachLenM: chainage_m?.length ? chainage_m[chainage_m.length - 1] : 0,
    modelled: true,
  };
}

function _p72hWse(cell) {
  if (!_engine) return 0;
  try {
    const k = Math.min(71, 72 - 1); // k=71 = 72h lead
    const [, q50] = _engine.qQuantiles(k, [0.1, 0.5, 0.9]);
    const prof = _engine.wseProfile(q50);
    return prof[Math.max(0, Math.min(prof.length - 1, cell))] ?? 0;
  } catch {
    return 0;
  }
}

function _riskStatus(margin_m) {
  if (margin_m <= 0) return "critical";
  if (margin_m <= WARN_MARGIN_M) return "warn";
  return "ok";
}

function _riskScore(margin_m, p72h_margin) {
  // 0–100 score; higher = more risk
  const nowScore = Math.max(0, Math.min(1, (WARN_MARGIN_M - margin_m) / (WARN_MARGIN_M + 2)));
  const p72Score = Math.max(0, Math.min(1, (WARN_MARGIN_M - p72h_margin) / (WARN_MARGIN_M + 2)));
  return Math.round((nowScore * 0.6 + p72Score * 0.4) * 100);
}

function _buildHydrograph(eng) {
  if (!eng) return null;
  const nowIdx = eng.nowIdx ?? (HYDRO_PAST_H + 24);

  // Past: qTruth[nowIdx - HYDRO_PAST_H .. nowIdx]
  const obsQ = [];
  const obsTimes = [];
  for (let h = HYDRO_PAST_H; h >= 0; h--) {
    const idx = Math.max(0, nowIdx - h);
    obsQ.push(round2(eng.qTruth?.[idx] ?? 0));
    obsTimes.push(-h); // hours relative to now
  }

  // Forecast quantiles
  const fQ10 = [], fQ50 = [], fQ90 = [], fTimes = [];
  for (let k = 0; k < HYDRO_FUTURE_H; k++) {
    const [q10, q50, q90] = eng.qQuantiles(k);
    fQ10.push(round2(q10));
    fQ50.push(round2(q50));
    fQ90.push(round2(q90));
    fTimes.push(k + 1);
  }

  // Flood threshold line (representative reach mean)
  const thresholdQ = _thresholdDischarge(eng);

  return {
    obs: { times: obsTimes, q: obsQ },
    forecast: { times: fTimes, q10: fQ10, q50: fQ50, q90: fQ90 },
    thresholdQ: round2(thresholdQ),
    nowH: 0,
  };
}

/** Threshold Q = Q that brings mean WSE to mean threshold (2.0 m default) */
function _thresholdDischarge(eng) {
  // Simple binary search for Q where mean(wseProfile) = 2.0
  let lo = 100, hi = 5000;
  const target = THRESHOLD_BY_CLASS.default;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const prof = eng.wseProfile(mid);
    const mean = prof.reduce((s, v) => s + v, 0) / prof.length;
    if (mean < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the latest cached twin state synchronously (may be null before init).
 * @returns {TwinState|null}
 */
export function getTwinState() {
  return _state;
}

/**
 * Select an asset by ID — triggers twin-asset-select + twin-state-change.
 * Pass null to deselect.
 * @param {string|null} id
 */
export function selectTwinAsset(id) {
  _selectedAssetId = id ?? null;
  if (_state) {
    _state = _computeState();
    _dispatch("twin-state-change", _state);
  }
  const asset = _assets.find((a) => a.id === id) ?? null;
  _dispatch("twin-asset-select", { id, asset });
}

/**
 * Change the forecast horizon used by the analytics dock.
 * @param {number} hours — one of FORECAST_HORIZONS
 */
export function setForecastHorizon(hours) {
  _forecastHorizon = hours;
  if (_state) {
    _state = _computeState();
    _dispatch("twin-state-change", _state);
  }
}

/**
 * Get the list of enriched assets (without re-computing state).
 * @returns {Array}
 */
export function getTwinAssets() {
  return _state?.assets ?? [];
}

/**
 * Re-export forecast horizons for UI buttons.
 */
export { FORECAST_HORIZONS };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _dispatch(eventName, detail) {
  try {
    document.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: false }));
  } catch {
    /* headless / test */
  }
}

function round2(v) {
  return Math.round((v ?? 0) * 100) / 100;
}
