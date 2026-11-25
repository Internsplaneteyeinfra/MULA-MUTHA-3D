/**
 * Normalize NadiTwin payloads into River.EYE-friendly structures.
 * Preserves units, timestamps, source, and original raw for debugging.
 */

import {
  classifyNadiTwinForecast,
  classifyNadiTwinLive,
  DAM_RELEASES_NOTE,
  freshnessLabel,
} from "./hydrologyProvenance.js";

/**
 * Build chainage_m for each NadiTwin cell (0 … n-1) × step.
 * flow_dir=1 → increasing downstream from upstream origin.
 */
export function buildNadiTwinChainageMeters(nCells, stepM = 10, flowDir = 1) {
  const n = Math.max(0, Number(nCells) || 0);
  const step = Number(stepM) || 10;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = flowDir >= 0 ? i * step : (n - 1 - i) * step;
  }
  return out;
}

/**
 * Validate local chainage profile against NadiTwin meta before joining.
 */
export function validateChainageAlignment(meta, localStations = []) {
  const nCells = Number(meta?.n_cells);
  const step = Number(meta?.chainage_step_m) || 10;
  const reachKm = Number(meta?.reach_km);
  const local = Array.isArray(localStations) ? localStations : [];
  const localPositive = local.filter((s) => Number(s.chainage_m) >= 0);
  const localReachM = localPositive.length
    ? Math.max(...localPositive.map((s) => Number(s.chainage_m))) -
      Math.min(...localPositive.map((s) => Number(s.chainage_m)))
    : null;

  const issues = [];
  if (!Number.isFinite(nCells) || nCells < 10) issues.push("NadiTwin n_cells missing/invalid");
  if (!local.length) issues.push("Local chainage stations empty");
  if (Number.isFinite(reachKm) && Number.isFinite(localReachM)) {
    const deltaKm = Math.abs(reachKm - localReachM / 1000);
    if (deltaKm > 0.5) issues.push(`Reach length delta ${deltaKm.toFixed(2)} km`);
  }
  if (Number.isFinite(nCells) && localPositive.length) {
    const deltaN = Math.abs(nCells - localPositive.length);
    if (deltaN > 50) issues.push(`Station count delta ${deltaN} (NT ${nCells} vs local+ ${localPositive.length})`);
  }

  return {
    ok: issues.length === 0,
    issues,
    nCells,
    stepM: step,
    reachKm,
    localCount: local.length,
    localPositiveCount: localPositive.length,
    localReachM,
    joinMethod: "nearest_positive_chainage_m",
    maxJoinDistanceM: step * 1.5,
    datum: meta?.datum || null,
    datumVerifiedMsl: false,
    note: "NadiTwin WSE is relative — not verified MSL. Do not overwrite 3D sheet datum.",
  };
}

/**
 * Nearest-index join: local chainage_m → NadiTwin cell index.
 */
export function mapLocalChainageToCell(chainageM, nCells, stepM = 10) {
  if (!Number.isFinite(chainageM) || !Number.isFinite(nCells) || nCells < 1) return null;
  if (chainageM < 0) return 0;
  const idx = Math.round(chainageM / stepM);
  if (idx < 0) return 0;
  if (idx >= nCells) return nCells - 1;
  return idx;
}

export function normalizeLiveState(stateRaw, metaRaw, liveRaw) {
  const liveClass = classifyNadiTwinLive();
  const nCells = Number(metaRaw?.n_cells) || (stateRaw?.q_station?.length ?? 0);
  const stepM = Number(metaRaw?.chainage_step_m) || 10;
  const flowDir = Number(metaRaw?.flow_dir) >= 0 ? 1 : -1;
  const chainage_m = buildNadiTwinChainageMeters(nCells, stepM, flowDir);
  const at = stateRaw?.at || liveRaw?.status?.fetched_at || new Date().toISOString();
  const fresh = freshnessLabel(at);

  return {
    river: metaRaw?.river || "Mula-Mutha",
    timestamp: at,
    freshness: fresh,
    dataClass: liveClass.dataClass,
    provenance: liveClass.provenance,
    source: liveClass.source,
    note: liveClass.note,
    damReleasesModelled: false,
    damReleasesNote: DAM_RELEASES_NOTE,
    datum: stateRaw?.datum || metaRaw?.datum || null,
    datumShort: metaRaw?.datum_short || null,
    q_up_now: num(stateRaw?.q_up_now),
    q_now: num(stateRaw?.q_now),
    q_out_now: num(stateRaw?.q_out_now),
    /** Prefer outlet for reach authority when available */
    discharge_m3s: firstFinite(stateRaw?.q_out_now, stateRaw?.q_now, stateRaw?.q_up_now),
    n_cells: nCells,
    chainage_step_m: stepM,
    chainage_m,
    q_station: asNumberArray(stateRaw?.q_station),
    wse: asNumberArray(stateRaw?.wse),
    depth: asNumberArray(stateRaw?.depth),
    /** NadiTwin meta crest / bed (relative) — same source as their River Stage chart */
    crest: asNumberArray(metaRaw?.crest),
    bed_meta: asNumberArray(metaRaw?.bed),
    freeboard_m: num(metaRaw?.freeboard_m) ?? 0.8,
    zone_watch_m: num(metaRaw?.zone_watch_m) ?? 1.7,
    zone_warning_m: num(metaRaw?.zone_warning_m) ?? 0.7,
    weather: liveRaw?.weather
      ? {
          temperature_c: num(liveRaw.weather.temperature_c),
          humidity_pct: num(liveRaw.weather.humidity_pct),
          wind_kmh: num(liveRaw.weather.wind_kmh),
          et0_mmh: num(liveRaw.weather.et0_mmh),
          rain_now_mmh: num(liveRaw.weather.rain_now_mmh),
          rain_past_24h_mm: num(liveRaw.weather.rain_past_24h_mm),
          rain_next_24h_mm: num(liveRaw.weather.rain_next_24h_mm),
          rain_next_72h_mm: num(liveRaw.weather.rain_next_72h_mm),
        }
      : null,
    assumptions: liveRaw?.assumptions || null,
    q_source: liveRaw?.q_source || metaRaw?.q_source || null,
    live_status: liveRaw?.status || metaRaw?.live_status || null,
    segments: Array.isArray(liveRaw?.segments) ? liveRaw.segments : null,
    raw: { state: stateRaw, meta: metaRaw, live: liveRaw },
  };
}

export function normalizeDischargeProfile(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const fc = classifyNadiTwinForecast();
  return {
    dataClass: fc.dataClass,
    provenance: fc.provenance,
    source: fc.source,
    note: fc.note,
    segments: list.map((s) => ({
      segment: s.segment,
      from_km: num(s.from_km),
      to_km: num(s.to_km),
      q_now: num(s.q_now),
      components: s.components || null,
      travel_time_h: num(s.travel_time_h),
      forecast: s.forecast || null,
      q_peak_72h_median: num(s.q_peak_72h_median),
      rain_now_mmh: num(s.rain_now_mmh),
      rain_past_24h_mm: num(s.rain_past_24h_mm),
      rain_next_24h_mm: num(s.rain_next_24h_mm),
      rain_next_72h_mm: num(s.rain_next_72h_mm),
      runoff_coeff: num(s.runoff_coeff),
    })),
    raw: rows,
  };
}

export function normalizeHydrograph(raw) {
  const fc = classifyNadiTwinForecast();
  const forecast = raw?.forecast || {};
  return {
    dataClass: fc.dataClass,
    provenance: fc.provenance,
    source: fc.source,
    note: fc.note,
    cell: raw?.cell ?? null,
    chainage_km: num(raw?.chainage_km),
    label: raw?.label || null,
    datum: raw?.datum || null,
    hours: num(raw?.hours),
    step_h: num(raw?.step_h),
    times: Array.isArray(raw?.times) ? raw.times : [],
    observed_stage: asNumberArray(raw?.observed),
    observed_q: asNumberArray(raw?.observed_q),
    observed_rain: asNumberArray(raw?.observed_rain),
    forecast_median: asNumberArray(forecast.median || forecast.p50 || forecast.stage_p50),
    forecast_p10: asNumberArray(forecast.p10 || forecast.stage_p10),
    forecast_p90: asNumberArray(forecast.p90 || forecast.stage_p90),
    forecast_q_median: asNumberArray(forecast.q_median || forecast.q_p50),
    forecast_q_p10: asNumberArray(forecast.q_p10),
    forecast_q_p90: asNumberArray(forecast.q_p90),
    forecast_rain: asNumberArray(forecast.rain || forecast.observed_rain),
    forecast_times: Array.isArray(forecast.times) ? forecast.times : [],
    levels: raw?.levels || null,
    q_danger: num(raw?.q_danger),
    raw,
  };
}

export function qAtLocalChainage(normalizedLive, chainageM) {
  if (!normalizedLive?.q_station?.length) return null;
  const idx = mapLocalChainageToCell(
    chainageM,
    normalizedLive.n_cells,
    normalizedLive.chainage_step_m,
  );
  if (idx == null) return null;
  const q = normalizedLive.q_station[idx];
  return Number.isFinite(q) ? q : null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asNumberArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  });
}
