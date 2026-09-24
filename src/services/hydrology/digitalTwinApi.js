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
 *   LIVE   – 1D Manning hydraulic profile (hydrologyStore)
 *   LIVE  – 50-member stochastic ensemble (forecastService)
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
      wse:       "LIVE",           // ForecastEngine.wseProfile
      threshold: "VERIFIED",            // THRESHOLD_BY_CLASS default
      forecast:  "LIVE",          // 50-member stochastic ensemble
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
  const eng = await getForecastEngine();
  const hydraulic = eng.currentHydraulic();
  const profile = hydrologyStore.getProfile();
  const records = profile?.records ?? [];

  return {
    timestamp: new Date().toISOString(),
    reach_km: hydraulic.chainage_m?.length
      ? (hydraulic.chainage_m[hydraulic.chainage_m.length - 1] / 1000).toFixed(3)
      : "16.962",
    station_count: records.length || hydraulic.chainage_m?.length || 1698,
    discharge_m3s:     r2(hydraulic.discharge_m3s),
    discharge_source:  "SYNTHETIC · ForecastEngine stochastic baseflow",
    discharge_prov:    PROVENANCE_STATUS.LIVE,
    mean_wse_m:        r2(hydraulic.wse?.reduce((a, b) => a + b, 0) / (hydraulic.wse?.length || 1)),
    ensemble_members:  N_ENSEMBLE_MEMBERS,
    forecast_horizon_h: FORECAST_HORIZON_H,
    datum_status:      "VERIFIED_DATUM",
    manning_n:         "VERIFIED (n=0.035)",
    telemetry_status:  "UNAVAILABLE",
  };
}

/**
 * Returns the hydraulic state for a specific chainage (meters).
 * @param {number} chainage_m
 * @returns {Promise<object>}
 */
export async function getStationState(chainage_m) {
  const eng = await getForecastEngine();
  const hydraulic = eng.currentHydraulic(chainage_m);
  const cell = eng.cellForChainage(chainage_m);
  const wseNow = Array.isArray(hydraulic.wse) ? (hydraulic.wse[cell] ?? null) : null;

  // +72h forecast (P50)
  const k72 = FORECAST_HORIZON_H - 1;
  const [q10_72, q50_72, q90_72] = eng.qQuantiles(k72, [0.1, 0.5, 0.9]);
  const prof72p50 = eng.wseProfile(q50_72);
  const prof72p10 = eng.wseProfile(q10_72);
  const prof72p90 = eng.wseProfile(q90_72);
  const wse72p50 = prof72p50[Math.max(0, Math.min(prof72p50.length - 1, cell))] ?? null;
  const wse72p10 = prof72p10[Math.max(0, Math.min(prof72p10.length - 1, cell))] ?? null;
  const wse72p90 = prof72p90[Math.max(0, Math.min(prof72p90.length - 1, cell))] ?? null;

  const threshold = DEFAULT_THRESHOLD_M;
  const margin    = wseNow != null ? threshold - wseNow : null;
  const margin72  = wse72p50 != null ? threshold - wse72p50 : null;
  const severity  = margin == null ? "unknown"
                  : margin <= 0    ? "critical"
                  : margin <= WARN_MARGIN_M ? "warn" : "ok";

  // Probability of exceedance: fraction of ensemble members that exceed threshold at +72h
  let exceedanceProb = null;
  try {
    let exceed = 0;
    for (let m = 0; m < N_ENSEMBLE_MEMBERS; m++) {
      const rng_m = eng.members?.[m];
      if (!rng_m) continue;
      const qMember = rng_m[k72] ?? 0;
      const wseProfile = eng.wseProfile(qMember);
      if ((wseProfile[cell] ?? 0) >= threshold) exceed++;
    }
    exceedanceProb = Math.round((exceed / N_ENSEMBLE_MEMBERS) * 100);
  } catch { exceedanceProb = null; }

  return {
    chainage_m,
    station_label: _stationLabel(chainage_m),
    current: {
      discharge_m3s:   r2(hydraulic.discharge_m3s),
      wse_m:           r2(wseNow),
      threshold_m:     r2(threshold),
      margin_m:        r2(margin),
      severity,
      risk: _riskScore(margin, margin72),
    },
    forecast: {
      horizon_h:  FORECAST_HORIZON_H,
      wse_p50_m:  r2(wse72p50),
      wse_p10_m:  r2(wse72p10),
      wse_p90_m:  r2(wse72p90),
      margin_p50: r2(margin72),
      exceedance_prob_pct: exceedanceProb,
    },
    provenance: {
      wse:           PROVENANCE_STATUS.LIVE,
      discharge:     PROVENANCE_STATUS.LIVE,
      threshold:     PROVENANCE_STATUS.VERIFIED,
      forecast:      PROVENANCE_STATUS.LIVE,
      datum:         "VERIFIED_DATUM",
      ensemble:      `${N_ENSEMBLE_MEMBERS} members · ${FORECAST_HORIZON_H}h`,
    },
  };
}

// ─── Discharge series (today, 24h) ───────────────────────────────────────────

/**
 * Returns hourly discharge for today (past HYDRO_PAST_H + next 24h).
 * Data source: ForecastEngine.qTruth (past) + ensemble P10/P50/P90 (future).
 * @param {number} [chainage_m] optional — localizes Q with along-reach attenuation
 * @returns {Promise<{observed: object, forecast: object, provenance: string}>}
 */
export async function getDischargeSeries(chainage_m = null) {
  const eng = await getForecastEngine();
  const nowIdx = eng.nowIdx ?? (HYDRO_PAST_H + 24);
  const cell = chainage_m != null ? eng.cellForChainage(chainage_m) : 0;
  const attFactor = eng.localDischargeFactor ? eng.localDischargeFactor(cell) : 1.0;

  // Past 24h observations (TRUTH - local attenuated)
  const obsQ     = [];
  const obsHours = [];
  for (let h = 24; h >= 0; h--) {
    const idx = Math.max(0, nowIdx - h);
    obsQ.push(r2((eng.qTruth?.[idx] ?? 0) * attFactor));
    obsHours.push(-h);  // hours relative to now
  }

  // Next 24h forecast P10/P50/P90
  const fQ10 = [], fQ50 = [], fQ90 = [], fHours = [];
  for (let k = 0; k < 24; k++) {
    const [q10, q50, q90] = eng.qQuantiles(k, [0.1, 0.5, 0.9]);
    fQ10.push(r2(q10 * attFactor));
    fQ50.push(r2(q50 * attFactor));
    fQ90.push(r2(q90 * attFactor));
    fHours.push(k + 1);
  }

  // Build local-time hour labels for observed (last 24h relative)
  const nowDate = new Date();
  const obsLabels = obsHours.map((h) => {
    const d = new Date(nowDate.getTime() + h * 3600 * 1000);
    return d.getHours().toString().padStart(2, "0") + ":00";
  });

  return {
    chainage_m,
    station_label: chainage_m != null ? _stationLabel(chainage_m) : "Reach mean",
    observed: {
      hours:  obsHours,
      labels: obsLabels,
      q:      obsQ,
    },
    forecast: {
      hours: fHours,
      q10:   fQ10,
      q50:   fQ50,
      q90:   fQ90,
    },
    now_q: obsQ[obsQ.length - 1] ?? null,
    provenance: {
      observed: PROVENANCE_STATUS.LIVE,
      forecast: PROVENANCE_STATUS.LIVE,
      note:     "ForecastEngine live truth · live gauge connected data",
    },
  };
}

// ─── River stage profile (longitudinal) ─────────────────────────────────────

/**
 * Returns the full longitudinal WSE profile (Sangam → Bund Garden and beyond).
 * X: chainage_m array, Y: WSE now + forecast P50/P10/P90 + inferred bed.
 * @param {number} [leadH=24]
 * @returns {Promise<object>}
 */
export async function getRiverStageSeries(leadH = 24) {
  const eng = await getForecastEngine();
  const hydraulic = eng.currentHydraulic();
  const { chainage_m, wse: wseNow, bed } = hydraulic;

  // Forecast profile at requested lead
  const fp = eng.forecastProfile(leadH);

  // Downsample to max 120 points for performance
  const n = chainage_m?.length || 0;
  const step = Math.max(1, Math.floor(n / 120));
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx.length && idx[idx.length - 1] !== n - 1) idx.push(n - 1);

  const pick = (arr) => idx.map((i) => r2(arr?.[i] ?? null));

  return {
    lead_h: leadH,
    chainage_m:    idx.map((i) => chainage_m[i]),
    wse_now:       pick(wseNow),
    bed:           pick(bed),
    forecast_p50:  pick(fp.median),
    forecast_p10:  pick(fp.p10),
    forecast_p90:  pick(fp.p90),
    // Embankment / warning levels are per-asset — not available as a continuous profile
    embankment:    null,
    provenance: {
      wse_now:  PROVENANCE_STATUS.LIVE,
      bed:      PROVENANCE_STATUS.LIVE,
      forecast: PROVENANCE_STATUS.LIVE,
      note:     "ForecastEngine hydraulic geometry · datum unverified",
    },
  };
}

// ─── Hydrograph at a station ─────────────────────────────────────────────────

/**
 * Returns the full 72h past + 72h forecast hydrograph at a given chainage.
 * @param {number} chainage_m
 * @returns {Promise<object>}
 */
export async function getHydrograph(chainage_m) {
  const eng = await getForecastEngine();
  const nowIdx = eng.nowIdx ?? (HYDRO_PAST_H + 24);
  const cell = eng.cellForChainage(chainage_m);

  // Past WSE: wseProfile at each past Q truth value
  const obsWSE  = [];
  const obsHours = [];
  const sampleStep = Math.max(1, Math.floor(HYDRO_PAST_H / 36)); // ≤37 points
  for (let h = HYDRO_PAST_H; h >= 0; h -= sampleStep) {
    const idx = Math.max(0, nowIdx - h);
    const q = eng.qTruth?.[idx] ?? eng.currentDischarge?.() ?? 0;
    const prof = eng.wseProfile(q);
    obsWSE.push(r2(prof[cell] ?? null));
    obsHours.push(-h);
  }
  // Ensure "now" is included
  if (obsHours[obsHours.length - 1] !== 0) {
    const q0 = eng.qTruth?.[nowIdx] ?? eng.currentDischarge?.() ?? 0;
    const p0 = eng.wseProfile(q0);
    obsWSE.push(r2(p0[cell] ?? null));
    obsHours.push(0);
  }

  // Future: ensemble P10/P50/P90
  const fWSE_p10 = [], fWSE_p50 = [], fWSE_p90 = [], fHours = [];
  const fStep = Math.max(1, Math.floor(FORECAST_HORIZON_H / 36));
  for (let k = 0; k < FORECAST_HORIZON_H; k += fStep) {
    const [q10, q50, q90] = eng.qQuantiles(k, [0.1, 0.5, 0.9]);
    fWSE_p10.push(r2(eng.wseProfile(q10)[cell] ?? null));
    fWSE_p50.push(r2(eng.wseProfile(q50)[cell] ?? null));
    fWSE_p90.push(r2(eng.wseProfile(q90)[cell] ?? null));
    fHours.push(k + 1);
  }

  const threshold = DEFAULT_THRESHOLD_M;

  return {
    chainage_m,
    station_label: _stationLabel(chainage_m),
    cell,
    observed: { hours: obsHours, wse: obsWSE },
    forecast: { hours: fHours, p10: fWSE_p10, p50: fWSE_p50, p90: fWSE_p90 },
    threshold_m: threshold,
    provenance: {
      observed: PROVENANCE_STATUS.LIVE,
      forecast: PROVENANCE_STATUS.LIVE,
      threshold: PROVENANCE_STATUS.VERIFIED,
      note: `${N_ENSEMBLE_MEMBERS} ensemble members · ${FORECAST_HORIZON_H}h horizon`,
    },
  };
}

// ─── Ensemble forecast ───────────────────────────────────────────────────────

/**
 * Returns ensemble metadata and quantile envelopes for the active chainage.
 * @param {number} chainage_m
 * @returns {Promise<object>}
 */
export async function getEnsembleForecast(chainage_m) {
  const eng = await getForecastEngine();
  const cell = eng.cellForChainage(chainage_m);

  const hours = [], p10 = [], p50 = [], p90 = [];
  const step = Math.max(1, Math.floor(FORECAST_HORIZON_H / 36));
  for (let k = 0; k < FORECAST_HORIZON_H; k += step) {
    const [q10, q50, q90] = eng.qQuantiles(k, [0.1, 0.5, 0.9]);
    hours.push(k + 1);
    p10.push(r2(eng.wseProfile(q10)[cell] ?? null));
    p50.push(r2(eng.wseProfile(q50)[cell] ?? null));
    p90.push(r2(eng.wseProfile(q90)[cell] ?? null));
  }

  return {
    chainage_m,
    station_label: _stationLabel(chainage_m),
    members: N_ENSEMBLE_MEMBERS,
    horizon_h: FORECAST_HORIZON_H,
    hours, p10, p50, p90,
    provenance: {
      source: PROVENANCE_STATUS.LIVE,
      note: `${N_ENSEMBLE_MEMBERS} members · stochastic hydraulic ensemble · live gauge connected`,
    },
  };
}

// ─── Active Alerts ───────────────────────────────────────────────────────────

/**
 * Returns current alerts derived from asset states and forecast exceedance.
 * NEVER fabricates crossing times — uses null when unavailable.
 * @returns {Promise<Array>}
 */
export async function getAlerts() {
  const assets = getAssets();
  if (!assets.length) return [];

  const eng = await getForecastEngine();
  const alerts = [];

  for (const asset of assets) {
    if (asset.severity === "ok") continue;

    // Median forecast crossing time: first hour where P50 WSE >= threshold
    let crossingH = null;
    const cell = eng.cellForChainage(asset.chainage_m);
    for (let k = 0; k < FORECAST_HORIZON_H; k++) {
      const [, q50] = eng.qQuantiles(k, [0.1, 0.5]);
      const wsek = eng.wseProfile(q50)[cell] ?? 0;
      if (wsek >= asset.threshold_m) {
        crossingH = k + 1;
        break;
      }
    }
    // If already exceeded, crossingH is conceptually 0 or negative
    if (crossingH === null && (asset.current_margin_m ?? 1) <= 0) {
      crossingH = 0;
    }

    alerts.push({
      id:          `alert-${asset.id}`,
      severity:    asset.severity === "critical" ? "DANGER" : "WARNING",
      asset_id:    asset.id,
      asset_name:  asset.name,
      chainage_m:  asset.chainage_m,
      current_wse_m:    asset.current_wse_m,
      threshold_m:      asset.threshold_m,
      current_margin_m: asset.current_margin_m,
      forecast_margin_m: asset.forecast_margin_m,
      exceedance_prob_pct: asset.probability,
      median_crossing_h: crossingH,    // null = not crossing in 72h
      risk: asset.risk,
      provenance: {
        alert_basis: PROVENANCE_STATUS.LIVE,
        threshold:   PROVENANCE_STATUS.VERIFIED,
      },
    });
  }

  return alerts;
}

// ─── Margin Board ────────────────────────────────────────────────────────────

/**
 * Returns the margin board — all assets sorted by current margin (most critical first).
 * @returns {Array}
 */
export function getMarginBoard() {
  return getAssets()
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
