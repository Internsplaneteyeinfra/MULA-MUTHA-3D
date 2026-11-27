/**
 * Digital Twin API — Centralized Hydrology Intelligence Layer
 *
 * Normalizes all local data sources into a single canonical schema.
 * The reference dashboard at digitaltwinmulamutha.vercel.app is behind
 * Vercel deployment protection (authentication required). All API endpoints
 * were inaccessible during inspection. This layer therefore uses the local
 * data pipeline exclusively:
 *
 *   forecastService.js   → ForecastEngine (50-member ensemble, 72h, WSE profiles)
 *   digitalTwinService.js → per-asset WSE/threshold/margin/risk
 *   historicalHydrologyService.js → 3 verified historical events
 *   hydrologyTelemetryService.js  → gauge connectors (UNAVAILABLE until configured)
 *   hydrologyStore.js    → canonical hydraulic profile (1,698 stations, Manning 1D)
 *   landmarks.json       → 8 named assets with chainage, lat, lon
 *
 * Data source provenance:
 *   OBSERVED   – gauge/survey data actually measured (none currently connected)
 *   MODELLED – 1D Manning hydraulic profile (hydrologyStore) and the
 *              50-member stochastic ensemble (forecastService)
 *   VERIFIED    – thresholds & roughness not verified
 *   UNAVAILABLE – live telemetry endpoints not configured
 *
 * Reference API endpoint inventory: see docs/digital_twin_api_inventory.md
 */

import { getForecastEngine, FORECAST_HORIZONS } from "../forecastService.js";
import { getTwinState, initDigitalTwin, getTwinAssets } from "../digitalTwinService.js";
import { telemetryService, GAUGE_STATIONS } from "./hydrologyTelemetryService.js";
import { historicalHydrologyService, VERIFIED_HISTORICAL_EVENTS } from "./historicalHydrologyService.js";
import { hydrologyStore } from "./hydrologyStore.js";
import { PROVENANCE_STATUS } from "./hydrologyContract.js";
import {
  getNadiTwinLiveBundle,
  getNadiTwinHydrographAtChainage,
  getNadiTwinForecastAlongReach,
  refreshNadiTwinHydrology,
  getNadiTwinDischargeAtChainage,
  getNadiTwinRawMeta,
} from "./naditwinHydrologyAdapter.js";

async function ensureNadiTwinLive() {
  let live = getNadiTwinLiveBundle();
  // Refresh when missing, or when crest not yet on the normalized live bundle
  if (!live || !live.crest?.length) {
    await refreshNadiTwinHydrology().catch(() => {});
    live = getNadiTwinLiveBundle();
  }
  return live;
}

function hoursFromIso(iso, nowMs = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (t - nowMs) / 3600000;
}

function downsampleIndices(n, maxPts = 120, forceIdx = []) {
  if (n <= 0) return [];
  const step = Math.max(1, Math.floor(n / maxPts));
  const keep = new Set();
  for (let i = 0; i < n; i += step) keep.add(i);
  keep.add(n - 1);
  for (const fi of forceIdx) {
    const i = Math.round(Number(fi));
    if (Number.isFinite(i) && i >= 0 && i < n) keep.add(i);
  }
  return [...keep].sort((a, b) => a - b);
}

/** Nearest series index by chainage_m (meters). */
export function nearestChainageIndex(chainageArr, meters) {
  if (!chainageArr?.length || !Number.isFinite(Number(meters))) return -1;
  const target = Number(meters);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < chainageArr.length; i += 1) {
    const d = Math.abs(Number(chainageArr[i]) - target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default flood threshold (m above datum) when no asset-specific value exists */
export const DEFAULT_THRESHOLD_M = 2.0;
/** Warning margin (m) — WARN status triggered below this */
export const WARN_MARGIN_M = 0.5;
/** Number of ensemble members in the forecast engine */
export const N_ENSEMBLE_MEMBERS = 50;
/** Forecast horizon range (hours) */
export const FORECAST_HORIZON_H = 72;
/** Past observation window in the hydrograph (hours) */
export const HYDRO_PAST_H = 72;

// ─── Normalised asset schema ─────────────────────────────────────────────────

/**
 * Returns a flat array of enriched asset records.
 * Each record conforms to:
 * {
 *   id, name, chainage_m, chainage_km, lat, lon,
 *   threshold_m,
 *   current_wse_m,   current_margin_m,
 *   forecast_margin_m, p72h_wse_m,
 *   probability,     risk,  severity,
 *   provenance: { wse, threshold, forecast }
 * }
 *
 * Source: getTwinAssets() (digitalTwinService) augmented with provenance.
 */
export function getAssets() {
  const twinAssets = getTwinAssets();
  if (!twinAssets.length) return [];

  return twinAssets.map((a) => ({
    id:               a.id,
    name:             a.name,
    chainage_m:       a.chainage_m,
    chainage_km:      a.chainage_km,
    lat:              a.lat,
    lon:              a.lon,
    threshold_m:      a.threshold_m,
    current_wse_m:    a.wse_m,
    current_margin_m: a.margin_m,
    p72h_wse_m:       a.p72h_wse ?? null,
    forecast_margin_m: a.p72h_margin ?? null,
    probability:      _exceedanceProbability(a),
    risk:             a.riskScore,
    severity:         a.status,        // "ok" | "warn" | "critical"
    provenance: {
      wse:       "MODELLED",       // ForecastEngine.wseProfile
      threshold: "CLASS_DEFAULT",  // THRESHOLD_BY_CLASS — not surveyed
      forecast:  "MODELLED",      // 50-member stochastic ensemble
    },
  }));
}

/** Estimate probability of threshold exceedance within 72 h from riskScore */
function _exceedanceProbability(asset) {
  if (asset.status === "critical") return 100;
  if (!Number.isFinite(asset.riskScore)) return null;
  // riskScore 0-100: approximate probability as riskScore^0.7 scaled 0-100
  return Math.round(Math.pow(asset.riskScore / 100, 0.7) * 100);
}

// ─── Current hydraulic state ─────────────────────────────────────────────────

/**
 * Returns the current modelled hydraulic state for the whole reach.
 * @returns {Promise<object>}
 */
export async function getCurrentHydrology() {
  // Prefer NadiTwin LIVE — never label ForecastEngine as LIVE/OBSERVED
  let nt = null;
  try {
    const { getNadiTwinLiveBundle, refreshNadiTwinHydrology } = await import("./naditwinHydrologyAdapter.js");
    if (!getNadiTwinLiveBundle()) await refreshNadiTwinHydrology().catch(() => {});
    nt = getNadiTwinLiveBundle();
  } catch {
    /* fall through */
  }

  const eng = await getForecastEngine();
  const hydraulic = eng.currentHydraulic();
  const profile = hydrologyStore.getProfile();
  const records = profile?.records ?? [];

  const ntQ = nt?.discharge_m3s ?? nt?.q_out_now;
  const usingNt = Number.isFinite(Number(ntQ));

  return {
    timestamp: usingNt ? (nt.timestamp || new Date().toISOString()) : new Date().toISOString(),
    reach_km: nt?.n_cells
      ? ((nt.n_cells - 1) * (nt.chainage_step_m || 10) / 1000).toFixed(3)
      : hydraulic.chainage_m?.length
      ? (hydraulic.chainage_m[hydraulic.chainage_m.length - 1] / 1000).toFixed(3)
      : "16.962",
    station_count: records.length || nt?.n_cells || hydraulic.chainage_m?.length || 1698,
    discharge_m3s:     r2(usingNt ? ntQ : hydraulic.discharge_m3s),
    discharge_source:  usingNt
      ? "NADITWIN LIVE · outlet Q"
      : "SYNTHETIC · ForecastEngine (fallback — not LIVE)",
    discharge_prov:    usingNt ? PROVENANCE_STATUS.MODELLED : PROVENANCE_STATUS.MODELLED,
    dataClass:         usingNt ? "LIVE" : "MODELLED",
    mean_wse_m:        r2(hydraulic.wse?.reduce((a, b) => a + b, 0) / (hydraulic.wse?.length || 1)),
    ensemble_members:  usingNt ? null : N_ENSEMBLE_MEMBERS,
    forecast_horizon_h: usingNt ? 72 : FORECAST_HORIZON_H,
    datum_status:      "RELATIVE_UNVERIFIED",
    manning_n:         "ASSUMED (n=0.035 — not surveyed)",
    telemetry_status:  "UNAVAILABLE",
  };
}

/**
 * Returns the hydraulic state for a specific chainage (meters).
 * Prefers NadiTwin LIVE + hydrograph levels / forecast (digital twin) — not ForecastEngine synthetics.
 * @param {number} chainage_m
 * @returns {Promise<object>}
 */
export async function getStationState(chainage_m) {
  const live = await ensureNadiTwinLive();
  const hit = getNadiTwinDischargeAtChainage(chainage_m);
  const hg = await getNadiTwinHydrographAtChainage(chainage_m, 168).catch(() => null);
  const fc72 = await getNadiTwinForecastAlongReach(72).catch(() => null);

  if (live?.wse?.length) {
    const step = live.chainage_step_m || 10;
    const cell = Math.max(0, Math.min(live.n_cells - 1, Math.round(Number(chainage_m) / step)));
    const wseNow = Number(live.wse[cell]);
    const qNow = Number.isFinite(hit?.q_m3s) ? hit.q_m3s : Number(live.q_station?.[cell]);
    const levels = hg?.levels || hg?.raw?.levels || null;
    const threshold = Number.isFinite(Number(levels?.warning))
      ? Number(levels.warning)
      : Number.isFinite(Number(levels?.danger))
        ? Number(levels.danger)
        : null;

    let wse72p50 = null, wse72p10 = null, wse72p90 = null;
    const qMed = fc72?.payload?.q_median_station;
    const med = fc72?.payload?.median;
    const p10a = fc72?.payload?.p10;
    const p90a = fc72?.payload?.p90;
    if (Array.isArray(med) && med.length) {
      wse72p50 = Number(med[Math.min(cell, med.length - 1)]);
      wse72p10 = Array.isArray(p10a) ? Number(p10a[Math.min(cell, p10a.length - 1)]) : null;
      wse72p90 = Array.isArray(p90a) ? Number(p90a[Math.min(cell, p90a.length - 1)]) : null;
    } else if (hg?.forecast_median?.length) {
      const last = hg.forecast_median.length - 1;
      wse72p50 = Number(hg.forecast_median[last]);
      wse72p10 = Number(hg.forecast_p10?.[last]);
      wse72p90 = Number(hg.forecast_p90?.[last]);
    }

    const margin = threshold != null && Number.isFinite(wseNow) ? threshold - wseNow : null;
    const margin72 = threshold != null && Number.isFinite(wse72p50) ? threshold - wse72p50 : null;
    const danger = Number(levels?.danger);
    const warning = Number(levels?.warning);
    let severity = "unknown";
    if (Number.isFinite(wseNow) && Number.isFinite(danger) && wseNow >= danger) severity = "critical";
    else if (Number.isFinite(wseNow) && Number.isFinite(warning) && wseNow >= warning) severity = "warn";
    else if (Number.isFinite(wseNow) && threshold != null) severity = "ok";

    let exceedanceProb = null;
    if (Number.isFinite(danger) && Number.isFinite(wse72p90) && Number.isFinite(wse72p10)) {
      if (wse72p10 >= danger) exceedanceProb = 100;
      else if (wse72p90 < danger) exceedanceProb = 0;
      else exceedanceProb = 50; // band straddles danger — not a calibrated probability
    }

    return {
      chainage_m,
      station_label: _stationLabel(chainage_m),
      current: {
        discharge_m3s: r2(qNow),
        wse_m: r2(wseNow),
        threshold_m: threshold != null ? r2(threshold) : null,
        margin_m: r2(margin),
        severity,
        risk: _riskScore(margin, margin72),
      },
      forecast: {
        horizon_h: 72,
        wse_p50_m: r2(wse72p50),
        wse_p10_m: r2(wse72p10),
        wse_p90_m: r2(wse72p90),
        margin_p50: r2(margin72),
        exceedance_prob_pct: exceedanceProb,
        q_p50: Array.isArray(qMed) ? r2(qMed[Math.min(cell, qMed.length - 1)]) : null,
      },
      levels,
      provenance: {
        wse: "NADITWIN LIVE",
        discharge: "NADITWIN LIVE",
        threshold: threshold != null ? "NADITWIN levels.warning (relative)" : "UNAVAILABLE",
        forecast: "NADITWIN FORECAST",
        datum: "RELATIVE_UNVERIFIED",
        ensemble: "NadiTwin P10/P50/P90 — not synthetic ForecastEngine",
      },
    };
  }

  // Fallback — synthetic (labelled)
  const eng = await getForecastEngine();
  const hydraulic = eng.currentHydraulic(chainage_m);
  const cell = eng.cellForChainage(chainage_m);
  const wseNow = Array.isArray(hydraulic.wse) ? (hydraulic.wse[cell] ?? null) : null;
  return {
    chainage_m,
    station_label: _stationLabel(chainage_m),
    current: {
      discharge_m3s: r2(hydraulic.discharge_m3s),
      wse_m: r2(wseNow),
      threshold_m: DEFAULT_THRESHOLD_M,
      margin_m: null,
      severity: "unknown",
      risk: null,
    },
    forecast: { horizon_h: FORECAST_HORIZON_H, wse_p50_m: null, wse_p10_m: null, wse_p90_m: null, margin_p50: null, exceedance_prob_pct: null },
    provenance: {
      wse: PROVENANCE_STATUS.MODELLED,
      discharge: PROVENANCE_STATUS.MODELLED,
      threshold: "CLASS_DEFAULT",
      forecast: PROVENANCE_STATUS.MODELLED,
      datum: "RELATIVE_UNVERIFIED",
      ensemble: "ForecastEngine fallback — NadiTwin unavailable",
    },
  };
}

// ─── Discharge series (today, 24h) ───────────────────────────────────────────

/**
 * Hourly discharge at chainage from NadiTwin hydrograph (digital twin) — not ForecastEngine synthetics.
 * @param {number} [chainage_m]
 */
export async function getDischargeSeries(chainage_m = null, opts = {}) {
  const meters = chainage_m != null ? Number(chainage_m) : 0;
  const pastH = Number.isFinite(Number(opts.pastHours)) ? Number(opts.pastHours) : 24;
  const fetchH = Math.max(72, Math.ceil(pastH) + 24);
  const hg = await getNadiTwinHydrographAtChainage(meters, fetchH).catch(() => null);
  if (hg?.times?.length && (hg.observed_q?.length || hg.forecast_q_median?.length)) {
    const nowMs = Date.now();
    const obsHours = [];
    const obsQ = [];
    const obsLabels = [];
    for (let i = 0; i < hg.times.length; i += 1) {
      const h = hoursFromIso(hg.times[i], nowMs);
      const q = Number(hg.observed_q?.[i]);
      if (!Number.isFinite(h) || !Number.isFinite(q)) continue;
      if (h < -(pastH + 0.5) || h > 0.5) continue;
      obsHours.push(r2(h));
      obsQ.push(r2(q));
      const d = new Date(Date.parse(hg.times[i]));
      obsLabels.push(`${String(d.getHours()).padStart(2, "0")}:00`);
    }
    const fHours = [], fQ10 = [], fQ50 = [], fQ90 = [];
    const ft = hg.forecast_times?.length ? hg.forecast_times : [];
    const nFc = Math.max(
      hg.forecast_q_median?.length || 0,
      hg.forecast_q_p10?.length || 0,
      ft.length,
    );
    for (let i = 0; i < nFc; i += 1) {
      const h = ft[i] != null ? hoursFromIso(ft[i], nowMs) : i + 1;
      if (!Number.isFinite(h) || h <= 0 || h > 24.5) continue;
      const q50 = Number(hg.forecast_q_median?.[i]);
      if (!Number.isFinite(q50)) continue;
      fHours.push(r2(h));
      fQ50.push(r2(q50));
      fQ10.push(r2(Number(hg.forecast_q_p10?.[i])));
      fQ90.push(r2(Number(hg.forecast_q_p90?.[i])));
    }
    return {
      chainage_m: meters,
      station_label: _stationLabel(meters),
      observed: { hours: obsHours, labels: obsLabels, q: obsQ },
      forecast: { hours: fHours, q10: fQ10, q50: fQ50, q90: fQ90 },
      now_q: obsQ[obsQ.length - 1] ?? null,
      provenance: {
        observed: "NADITWIN HISTORICAL · MODELLED",
        forecast: "NADITWIN FORECAST",
        dataClassPast: "HISTORICAL · MODELLED (NadiTwin)",
        dataClassForecast: "FORECAST · NADITWIN",
        note: "Digital twin hydrograph at cell — not gauge OBSERVED · not ForecastEngine synthetic",
      },
    };
  }

  // Fallback labelled synthetic
  const eng = await getForecastEngine();
  const nowIdx = eng.nowIdx ?? (HYDRO_PAST_H + 24);
  const cell = eng.cellForChainage(meters);
  const attFactor = eng.localDischargeFactor ? eng.localDischargeFactor(cell) : 1.0;
  const obsQ = [], obsHours = [];
  for (let h = 24; h >= 0; h--) {
    obsQ.push(r2((eng.qTruth?.[Math.max(0, nowIdx - h)] ?? null) * attFactor));
    obsHours.push(-h);
  }
  const nowDate = new Date();
  return {
    chainage_m: meters,
    station_label: _stationLabel(meters),
    observed: {
      hours: obsHours,
      labels: obsHours.map((h) => {
        const d = new Date(nowDate.getTime() + h * 3600 * 1000);
        return `${String(d.getHours()).padStart(2, "0")}:00`;
      }),
      q: obsQ,
    },
    forecast: { hours: [], q10: [], q50: [], q90: [] },
    now_q: obsQ[obsQ.length - 1] ?? null,
    provenance: {
      observed: PROVENANCE_STATUS.MODELLED,
      forecast: "UNAVAILABLE",
      dataClassPast: "HISTORICAL · MODELLED (fallback)",
      dataClassForecast: "UNAVAILABLE",
      note: "NadiTwin hydrograph unavailable — ForecastEngine fallback",
    },
  };
}

// ─── River stage profile (longitudinal) ─────────────────────────────────────

/**
 * Longitudinal relative WSE from NadiTwin LIVE state + forecast/profile (digital twin).
 * Matches NadiTwin River Stage chart: WSE, bed, crest, danger/warning/watch.
 * @param {number} [leadH=24]
 * @param {{ ensureMeters?: number|null }} [opts] — force-include this chainage cell (no 8+790→8+820 snap)
 */
export async function getRiverStageSeries(leadH = 24, opts = {}) {
  const live = await ensureNadiTwinLive();
  const fc = await getNadiTwinForecastAlongReach(leadH).catch(() => null);
  const payload = fc?.ok ? fc.payload : null;

  if (live?.wse?.length) {
    const n = live.wse.length;
    const step = live.chainage_step_m || 10;
    const chainageFull = live.chainage_m?.length === n
      ? live.chainage_m
      : Array.from({ length: n }, (_, i) => i * step);

    const ensureM = Number(opts.ensureMeters);
    const forceIdx = Number.isFinite(ensureM)
      ? [Math.round(ensureM / step)]
      : [];
    const idx = downsampleIndices(n, 120, forceIdx);
    const pick = (arr) => idx.map((i) => r2(arr?.[i] ?? null));

    const wseNow = live.wse;
    const depth = live.depth || [];
    const meta = getNadiTwinRawMeta();
    const crestSrc = live.crest?.length === n ? live.crest : meta?.crest;
    const bedSrc = live.bed_meta?.length === n ? live.bed_meta : meta?.bed;
    const crestFull = Array.isArray(crestSrc) && crestSrc.length === n
      ? crestSrc.map((x) => {
          const v = Number(x);
          return Number.isFinite(v) ? v : null;
        })
      : null;
    const bedMeta = Array.isArray(bedSrc) && bedSrc.length === n
      ? bedSrc.map((x) => {
          const v = Number(x);
          return Number.isFinite(v) ? v : null;
        })
      : null;
    const freeboard = Number.isFinite(Number(live.freeboard_m ?? meta?.freeboard_m))
      ? Number(live.freeboard_m ?? meta?.freeboard_m)
      : 0.8;
    const zoneWarn = Number.isFinite(Number(live.zone_warning_m ?? meta?.zone_warning_m))
      ? Number(live.zone_warning_m ?? meta?.zone_warning_m)
      : 0.7;
    const zoneWatch = Number.isFinite(Number(live.zone_watch_m ?? meta?.zone_watch_m))
      ? Number(live.zone_watch_m ?? meta?.zone_watch_m)
      : 1.7;

    // Prefer NadiTwin meta.bed (same as their chart); else WSE − depth
    const bed = Array.from({ length: n }, (_, i) => {
      if (bedMeta) {
        const v = Number(bedMeta[i]);
        return Number.isFinite(v) ? v : null;
      }
      const d = Number(depth[i]);
      const ww = Number(wseNow[i]);
      return Number.isFinite(ww) && Number.isFinite(d) ? ww - d : null;
    });

    const danger = crestFull
      ? crestFull.map((c) => {
          const v = Number(c);
          return Number.isFinite(v) ? v - freeboard : null;
        })
      : null;
    const warning = danger
      ? danger.map((d) => (Number.isFinite(d) ? d - zoneWarn : null))
      : null;
    const watch = danger
      ? danger.map((d) => (Number.isFinite(d) ? d - zoneWatch : null))
      : null;

    const med = payload?.median || [];
    const p10 = payload?.p10 || [];
    const p90 = payload?.p90 || [];
    // Water depth in the river: the twin's measured depth (Sentinel-2 survey + live flow),
    // else stage − bed on the same datum (they agree to < 1 cm).
    const depthFull = Array.from({ length: n }, (_, i) => {
      const d = Number(depth[i]);
      if (Number.isFinite(d)) return d;
      const ww = Number(wseNow[i]);
      const b = Number(bed[i]);
      return Number.isFinite(ww) && Number.isFinite(b) ? Math.max(0, ww - b) : null;
    });

    return {
      lead_h: leadH,
      chainage_m: idx.map((i) => chainageFull[i]),
      wse_now: pick(wseNow),
      bed: pick(bed),
      depth: pick(depthFull),
      datum: meta?.datum_short || live.datumShort || "m WSE",
      datumNote: meta?.datum || live.datum || "",
      forecast_p50: pick(med),
      forecast_p10: pick(p10),
      forecast_p90: pick(p90),
      crest: crestFull ? pick(crestFull) : null,
      danger: danger ? pick(danger) : null,
      warning: warning ? pick(warning) : null,
      watch: watch ? pick(watch) : null,
      threshold_m: null,
      embankment: crestFull ? pick(crestFull) : null,
      provenance: {
        wse_now: "NADITWIN LIVE",
        bed: bedMeta ? "NADITWIN META bed" : "DERIVED (WSE − depth)",
        forecast: payload ? "NADITWIN FORECAST" : "UNAVAILABLE",
        threshold: crestFull
          ? `NADITWIN crest − freeboard ${freeboard} m (display only · relative)`
          : "N/A (per-station levels)",
        note: "Digital twin longitudinal profile · relative datum · matches NadiTwin River Stage levels · not ForecastEngine static",
      },
    };
  }

  return {
    lead_h: leadH,
    chainage_m: [],
    wse_now: [],
    bed: [],
    forecast_p50: [],
    forecast_p10: [],
    forecast_p90: [],
    crest: null,
    danger: null,
    warning: null,
    watch: null,
    threshold_m: null,
    embankment: null,
    provenance: {
      wse_now: "UNAVAILABLE",
      bed: "UNAVAILABLE",
      forecast: "UNAVAILABLE",
      note: "NadiTwin LIVE state unavailable — no synthetic stage profile",
    },
  };
}

// ─── Hydrograph at a station ─────────────────────────────────────────────────

/**
 * 72h past + forecast hydrograph at chainage from NadiTwin digital twin API.
 * @param {number} chainage_m
 */
export async function getHydrograph(chainage_m, opts = {}) {
  const pastH = Number.isFinite(Number(opts.pastHours)) ? Number(opts.pastHours) : 168;
  const fetchH = Math.max(72, Math.ceil(pastH));
  const hg = await getNadiTwinHydrographAtChainage(chainage_m, fetchH).catch(() => null);
  if (hg?.times?.length) {
    const nowMs = Date.now();
    const obsHours = [], obsWSE = [];
    for (let i = 0; i < hg.times.length; i += 1) {
      const h = hoursFromIso(hg.times[i], nowMs);
      const w = Number(hg.observed_stage?.[i]);
      if (!Number.isFinite(h) || !Number.isFinite(w)) continue;
      if (h < -(pastH + 0.5) || h > 0.5) continue;
      obsHours.push(r2(h));
      obsWSE.push(r2(w));
    }
    const fHours = [], fWSE_p10 = [], fWSE_p50 = [], fWSE_p90 = [];
    const ft = hg.forecast_times || [];
    const nFc = Math.max(hg.forecast_median?.length || 0, ft.length);
    for (let i = 0; i < nFc; i += 1) {
      const h = ft[i] != null ? hoursFromIso(ft[i], nowMs) : i + 1;
      const p50 = Number(hg.forecast_median?.[i]);
      if (!Number.isFinite(h) || h <= 0 || !Number.isFinite(p50)) continue;
      fHours.push(r2(h));
      fWSE_p50.push(r2(p50));
      fWSE_p10.push(r2(Number(hg.forecast_p10?.[i])));
      fWSE_p90.push(r2(Number(hg.forecast_p90?.[i])));
    }
    const levels = hg.levels || hg.raw?.levels || null;
    const threshold = Number.isFinite(Number(levels?.warning))
      ? Number(levels.warning)
      : Number.isFinite(Number(levels?.danger))
        ? Number(levels.danger)
        : null;

    return {
      chainage_m,
      station_label: _stationLabel(chainage_m),
      cell: hg.cell,
      observed: { hours: obsHours, wse: obsWSE },
      forecast: { hours: fHours, p10: fWSE_p10, p50: fWSE_p50, p90: fWSE_p90 },
      threshold_m: threshold != null ? r2(threshold) : null,
      levels,
      provenance: {
        observed: "NADITWIN HISTORICAL · MODELLED",
        forecast: "NADITWIN FORECAST",
        threshold: threshold != null ? "NADITWIN levels.warning" : "UNAVAILABLE",
        dataClassPast: "HISTORICAL · MODELLED (NadiTwin)",
        dataClassForecast: "FORECAST · NADITWIN",
        note: "Digital twin hydrograph — relative datum · not gauge OBSERVED · not ForecastEngine static",
      },
    };
  }

  return {
    chainage_m,
    station_label: _stationLabel(chainage_m),
    cell: null,
    observed: { hours: [], wse: [] },
    forecast: { hours: [], p10: [], p50: [], p90: [] },
    threshold_m: null,
    provenance: {
      observed: "UNAVAILABLE",
      forecast: "UNAVAILABLE",
      threshold: "UNAVAILABLE",
      dataClassPast: "UNAVAILABLE",
      dataClassForecast: "UNAVAILABLE",
      note: "NadiTwin hydrograph unavailable",
    },
  };
}

/**
 * Water level timeline used by the in-scene playback. Values are the existing
 * ForecastEngine WSE outputs.
 */
export async function getWaterLevelSimulationSeries(kind, chainage_m = 0, resolution = "hourly") {
  const eng = await getForecastEngine();
  const cell = eng.cellForChainage(chainage_m);
  const nowIdx = eng.nowIdx ?? (HYDRO_PAST_H + 24);
  const values = [];
  const hours = [];

  if (kind === "discharge") {
    for (let h = 24; h >= 0; h--) {
      const idx = Math.max(0, nowIdx - h);
      const q = eng.qTruth?.[idx];
      const wse = Number.isFinite(q) ? eng.wseProfile(q)?.[cell] : null;
      if (Number.isFinite(wse)) { values.push(wse); hours.push(-h); }
    }
    for (let k = 0; k < 24; k++) {
      const [, q50] = eng.qQuantiles(k, [0.1, 0.5]);
      const wse = eng.wseProfile(q50)?.[cell];
      if (Number.isFinite(wse)) { values.push(wse); hours.push(k + 1); }
    }
  } else if (kind === "stage" || kind === "hydrograph") {
    const graph = await getHydrograph(chainage_m);
    if (kind === "hydrograph") {
      values.push(...graph.observed.wse, ...graph.forecast.p50);
      hours.push(...graph.observed.hours, ...graph.forecast.hours);
    } else {
      values.push(...graph.forecast.p50);
      hours.push(...graph.forecast.hours);
    }
  } else {
    throw new Error(`Unknown water simulation: ${kind}`);
  }

  const now = Date.now();
  const hourlySamples = values
    .map((value, i) => {
      const hour = Number(hours[i]);
      return {
        value: value == null ? NaN : Number(value),
        hour,
        timestamp: now + hour * 60 * 60 * 1000,
        provenance: hour <= 0 ? "MODEL" : "MODEL FORECAST",
      };
    })
    .filter((sample) => Number.isFinite(sample.value) && Number.isFinite(sample.hour))
    .sort((a, b) => a.hour - b.hour);
  if (hourlySamples.length < 2) throw new Error("Hydrology model returned too few valid water-level samples.");
  const expectedStepHours = kind === "discharge" ? 1 : 2;
  if (hourlySamples.some((sample, i) => i > 0 && sample.hour - hourlySamples[i - 1].hour > expectedStepHours + 0.01)) {
    throw new Error("Hydrology model returned a gap in the water-level time series.");
  }

  const hoursPerSample = { hourly: 1, daily: 24, weekly: 168 }[resolution];
  if (!hoursPerSample) throw new Error(`Unknown water-level resolution: ${resolution}`);
  const startHour = hourlySamples[0].hour;
  const bins = new Map();
  for (const sample of hourlySamples) {
    const bin = Math.floor((sample.hour - startHour) / hoursPerSample);
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin).push(sample);
  }

  // Keep only fully covered periods. A partial final day/week must not be
  // presented as a complete aggregate.
  const samples = resolution === "hourly"
    ? hourlySamples
    : [...bins.entries()]
      .filter(([, period]) => period[period.length - 1].hour - period[0].hour >= hoursPerSample - 2)
      .map(([, period]) => ({
        value: period.reduce((sum, sample) => sum + sample.value, 0) / period.length,
        hour: period[0].hour,
        timestamp: period[0].timestamp,
        provenance: period.some((sample) => sample.provenance === "MODEL FORECAST") ? "MODEL · FORECAST INCLUDED" : "MODEL",
      }));

  const available = samples.length >= 2;
  return {
    samples,
    resolution,
    available,
    reason: available ? null : `The ${resolution} series does not contain two complete periods.`,
    provenance: PROVENANCE_STATUS.MODELLED,
    units: "m",
  };
}

// ─── Ensemble forecast ───────────────────────────────────────────────────────

/**
 * NadiTwin forecast P10/P50/P90 at chainage — WSE + discharge (digital twin).
 * @param {number} chainage_m
 */
export async function getEnsembleForecast(chainage_m) {
  const hg = await getNadiTwinHydrographAtChainage(chainage_m, 168).catch(() => null);
  if (hg?.forecast_median?.length || hg?.forecast_q_median?.length) {
    const nowMs = Date.now();
    const hours = [];
    const p10 = [], p50 = [], p90 = [];
    const q10 = [], q50 = [], q90 = [];
    const ft = hg.forecast_times || [];
    const n = Math.max(
      hg.forecast_median?.length || 0,
      hg.forecast_q_median?.length || 0,
      ft.length,
    );
    for (let i = 0; i < n; i += 1) {
      const h = ft[i] != null ? hoursFromIso(ft[i], nowMs) : i + 1;
      if (!Number.isFinite(h) || h <= 0) continue;
      const med = Number(hg.forecast_median?.[i]);
      const qm = Number(hg.forecast_q_median?.[i]);
      if (!Number.isFinite(med) && !Number.isFinite(qm)) continue;
      hours.push(r2(h));
      p50.push(Number.isFinite(med) ? r2(med) : null);
      p10.push(r2(Number(hg.forecast_p10?.[i])));
      p90.push(r2(Number(hg.forecast_p90?.[i])));
      q50.push(Number.isFinite(qm) ? r2(qm) : null);
      q10.push(r2(Number(hg.forecast_q_p10?.[i])));
      q90.push(r2(Number(hg.forecast_q_p90?.[i])));
    }
    const levels = hg.levels || hg.raw?.levels || null;
    const threshold = Number.isFinite(Number(levels?.warning)) ? Number(levels.warning) : null;
    const lastObs = Number(hg.observed_stage?.[hg.observed_stage.length - 1]);
    const lastQ = Number(hg.observed_q?.[hg.observed_q.length - 1]);
    const p50now = p50.find((v) => Number.isFinite(v));
    const warnMargin =
      threshold != null && Number.isFinite(p50now) ? r2(threshold - p50now) : null;
    return {
      chainage_m,
      station_label: _stationLabel(chainage_m),
      members: null,
      horizon_h: hours.length ? Math.round(hours[hours.length - 1]) : 72,
      hours,
      p10,
      p50,
      p90,
      q10,
      q50,
      q90,
      live_wse: Number.isFinite(lastObs) ? r2(lastObs) : null,
      live_q: Number.isFinite(lastQ) ? r2(lastQ) : null,
      threshold_m: threshold != null ? r2(threshold) : null,
      warn_margin_m: warnMargin,
      levels,
      provenance: {
        source: "NADITWIN FORECAST",
        note: "NadiTwin forecast band P10/P50/P90 (WSE + Q) — LIVE twin · not ForecastEngine",
      },
    };
  }

  return {
    chainage_m,
    station_label: _stationLabel(chainage_m),
    members: null,
    horizon_h: 0,
    hours: [],
    p10: [],
    p50: [],
    p90: [],
    q10: [],
    q50: [],
    q90: [],
    threshold_m: null,
    provenance: {
      source: "UNAVAILABLE",
      note: "NadiTwin forecast unavailable",
    },
  };
}

// ─── Active Alerts ───────────────────────────────────────────────────────────

/**
 * Alerts from NadiTwin LIVE WSE vs NadiTwin warning/danger levels at key chainages.
 * NEVER fabricates crossing times; NEVER uses ForecastEngine synthetics.
 * @returns {Promise<Array>}
 */
export async function getAlerts() {
  const points = [
    { id: "ch-0", name: "Outlet / 0+000", chainage_m: 0 },
    { id: "ch-8790", name: "CH 8+790", chainage_m: 8790 },
    { id: "ch-16790", name: "CH 16+790", chainage_m: 16790 },
  ];
  const alerts = [];
  for (const p of points) {
    const st = await getStationState(p.chainage_m);
    const sev = st?.current?.severity;
    if (sev !== "warn" && sev !== "critical") continue;
    alerts.push({
      id: `alert-nt-${p.id}`,
      severity: sev === "critical" ? "DANGER" : "WARNING",
      asset_id: p.id,
      asset_name: p.name,
      chainage_m: p.chainage_m,
      current_wse_m: st.current?.wse_m,
      threshold_m: st.current?.threshold_m,
      current_margin_m: st.current?.margin_m,
      forecast_margin_m: st.forecast?.margin_p50,
      exceedance_prob_pct: st.forecast?.exceedance_prob_pct,
      median_crossing_h: null,
      risk: st.current?.risk,
      provenance: {
        alert_basis: "NADITWIN LIVE",
        threshold: st.provenance?.threshold || "NADITWIN levels",
      },
    });
  }
  return alerts;
}

// ─── Margin Board ────────────────────────────────────────────────────────────

/**
 * Margin board from NadiTwin LIVE at landmark chainages (async).
 * @returns {Promise<Array>}
 */
export async function getMarginBoard() {
  let landmarks = [];
  try {
    const assets = getTwinAssets() || [];
    landmarks = assets
      .map((a) => ({
        id: a.id || a.name,
        name: a.name || a.station_label || `CH ${a.chainage_m}`,
        chainage_m: Number(a.chainage_m),
      }))
      .filter((a) => Number.isFinite(a.chainage_m))
      .slice(0, 12);
  } catch {
    landmarks = [];
  }
  if (!landmarks.length) {
    landmarks = [
      { id: "0", name: "0+000", chainage_m: 0 },
      { id: "8790", name: "8+790", chainage_m: 8790 },
      { id: "16790", name: "16+790", chainage_m: 16790 },
    ];
  }
  const rows = [];
  for (const lm of landmarks) {
    const st = await getStationState(lm.chainage_m);
    if (!st?.current) continue;
    rows.push({
      id: lm.id,
      name: lm.name,
      chainage_m: lm.chainage_m,
      current_wse_m: st.current.wse_m,
      threshold_m: st.current.threshold_m,
      current_margin_m: st.current.margin_m,
      forecast_margin_m: st.forecast?.margin_p50,
      probability: st.forecast?.exceedance_prob_pct,
      risk: st.current.risk,
      severity: st.current.severity,
      provenance: st.provenance,
    });
  }
  return rows
    .filter((a) => a.current_margin_m != null)
    .sort((a, b) => (a.current_margin_m ?? 999) - (b.current_margin_m ?? 999));
}

// ─── Historical events ───────────────────────────────────────────────────────

/**
 * Returns the list of verified historical events.
 */
export function getHistoricalEvents() {
  return historicalHydrologyService.getEvents();
}

/**
 * Selects a historical event and returns its data.
 * @param {string|null} eventId
 */
export function selectHistoricalEvent(eventId) {
  return historicalHydrologyService.selectEvent(eventId);
}

// ─── Gauge telemetry ─────────────────────────────────────────────────────────

/**
 * Returns all gauge station observations (most will be UNAVAILABLE).
 */
export function getGaugeObservations() {
  return telemetryService.getAllObservations();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function r2(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 1000) / 1000;
}

function _stationLabel(meters) {
  const v = Math.max(0, Math.round(Number(meters) || 0));
  return `${Math.floor(v / 1000)}+${String(v % 1000).padStart(3, "0")}`;
}

function _riskScore(margin_m, margin72) {
  const nowScore = Math.max(0, Math.min(1, (WARN_MARGIN_M - (margin_m ?? WARN_MARGIN_M + 1)) / (WARN_MARGIN_M + 2)));
  const p72Score = Math.max(0, Math.min(1, (WARN_MARGIN_M - (margin72 ?? WARN_MARGIN_M + 1)) / (WARN_MARGIN_M + 2)));
  return Math.round((nowScore * 0.6 + p72Score * 0.4) * 100);
}
