/**
 * NadiTwin chart series for Digital Twin → Charts.
 * All data via /naditwin-api proxy — no synthetic fill for missing series.
 */
import {
  fetchNadiTwinAlerts,
  fetchNadiTwinAlertsChainage,
  fetchNadiTwinDischargeProfile,
  fetchNadiTwinHydrographYear,
  fetchNadiTwinLocations,
  fetchNadiTwinMargins,
  fetchNadiTwinRating,
  fetchNadiTwinScorecard,
  fetchNadiTwinStations,
  fetchNadiTwinToday,
  fetchNadiTwinTimerange,
} from "./naditwinApi.js";
import {
  getNadiTwinForecastAlongReach,
  getNadiTwinHydrographAtChainage,
  getNadiTwinLiveBundle,
  refreshNadiTwinHydrology,
} from "./naditwinHydrologyAdapter.js";
import { mapLocalChainageToCell } from "./hydrologyNormalizer.js";

function r2(v) {
  // null/undefined must stay null — Number(null) === 0 and would fake dry Q = 0
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}
function asArr(v) {
  return Array.isArray(v) ? v : [];
}
async function ensureLive() {
  let live = getNadiTwinLiveBundle();
  if (!live?.wse?.length) {
    await refreshNadiTwinHydrology().catch(() => {});
    live = getNadiTwinLiveBundle();
  }
  return live;
}
function cellForMeters(meters, live) {
  const step = live?.chainage_step_m || 10;
  const n = live?.n_cells || 1681;
  return mapLocalChainageToCell(meters, n, step) ?? 0;
}
function downsample(n, maxPts = 160, forceIdx = []) {
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

export async function getLiveDischargeProfileSeries(opts = {}) {
  const live = await ensureLive();
  if (!live?.q_station?.length) {
    return { ok: false, chainage_m: [], q_now: [], provenance: { dataClass: "UNAVAILABLE", note: "q_station missing" } };
  }
  const n = live.q_station.length;
  const step = live.chainage_step_m || 10;
  const chFull = live.chainage_m?.length === n ? live.chainage_m : Array.from({ length: n }, (_, i) => i * step);
  const force = Number.isFinite(Number(opts.ensureMeters)) ? [Math.round(Number(opts.ensureMeters) / step)] : [];
  const idx = downsample(n, 160, force);
  const pick = (arr) => idx.map((i) => r2(arr?.[i] ?? null));

  let q24 = null;
  let q72 = null;
  const [fc24, fc72] = await Promise.all([
    getNadiTwinForecastAlongReach(24).catch(() => null),
    getNadiTwinForecastAlongReach(72).catch(() => null),
  ]);
  if (Array.isArray(fc24?.payload?.q_median_station) && fc24.payload.q_median_station.length === n) {
    q24 = pick(fc24.payload.q_median_station);
  }
  if (Array.isArray(fc72?.payload?.q_median_station) && fc72.payload.q_median_station.length === n) {
    q72 = pick(fc72.payload.q_median_station);
  }

  // Rain now: only when NadiTwin publishes chainage/segment rain (never fabricate).
  let rain_now_mmh = null;
  let rain_chainage_m = null;
  try {
    const segs = await getSegmentDischargeProfileSeries();
    if (segs.ok && segs.segments?.some((s) => Number.isFinite(s.rain_now_mmh))) {
      rain_chainage_m = segs.segments.map((s) => Math.round((Number(s.mid_km) || 0) * 1000));
      rain_now_mmh = segs.segments.map((s) => r2(s.rain_now_mmh));
    }
  } catch { /* optional */ }

  const forecastBits = [];
  if (q24) forecastBits.push("+24h");
  if (q72) forecastBits.push("+72h");

  return {
    ok: true,
    chainage_m: idx.map((i) => chFull[i]),
    q_now: pick(live.q_station),
    q_forecast_p50_24h: q24,
    q_forecast_p50_72h: q72,
    rain_chainage_m,
    rain_now_mmh,
    updatedAt: live.timestamp || null,
    provenance: {
      q_now: "NADITWIN LIVE · MODELLED",
      forecast: forecastBits.length
        ? `NADITWIN FORECAST q_median_station ${forecastBits.join(" · ")}`
        : "UNAVAILABLE",
      rain: rain_now_mmh ? "NADITWIN /api/discharge_profile rain_now_mmh (segment)" : "UNAVAILABLE",
      dataClass: "LIVE · MODELLED",
      unit: "m³/s",
      note: "Chainage-wise Q from /api/state (10 m cells) — not gauge OBSERVED · not Q–stage rating data",
    },
  };
}

export async function getLiveDepthProfileSeries(opts = {}) {
  const live = await ensureLive();
  if (!live?.depth?.length && !live?.wse?.length) {
    return { ok: false, chainage_m: [], depth_m: [], provenance: { dataClass: "UNAVAILABLE" } };
  }
  const n = live.depth?.length || live.wse.length;
  const step = live.chainage_step_m || 10;
  const chFull = live.chainage_m?.length === n ? live.chainage_m : Array.from({ length: n }, (_, i) => i * step);
  const force = Number.isFinite(Number(opts.ensureMeters)) ? [Math.round(Number(opts.ensureMeters) / step)] : [];
  const idx = downsample(n, 160, force);
  const pick = (arr) => idx.map((i) => r2(arr?.[i] ?? null));
  const depth = live.depth || [];
  const wse = live.wse || [];
  const bedMeta = live.bed_meta?.length === n ? live.bed_meta : null;
  const bed = idx.map((i) => {
    if (bedMeta) return r2(bedMeta[i]);
    const w = Number(wse[i]);
    const d = Number(depth[i]);
    return Number.isFinite(w) && Number.isFinite(d) ? r2(w - d) : null;
  });
  return {
    ok: true,
    chainage_m: idx.map((i) => chFull[i]),
    depth_m: pick(depth),
    wse_m: pick(wse),
    bed_m: bed,
    updatedAt: live.timestamp || null,
    provenance: {
      depth: "NADITWIN LIVE depth",
      wse: "NADITWIN LIVE wse · RELATIVE",
      bed: bedMeta ? "NADITWIN META bed" : "DERIVED (WSE − depth)",
      dataClass: "LIVE · MODELLED",
      unit: "m",
      note: "Relative datum · not MSL",
    },
  };
}

export async function getSegmentDischargeProfileSeries() {
  try {
    const res = await fetchNadiTwinDischargeProfile();
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) return { ok: false, provenance: { dataClass: "UNAVAILABLE" } };
    return {
      ok: true,
      segments: rows.map((s) => ({
        segment: s.segment,
        from_km: Number(s.from_km),
        to_km: Number(s.to_km),
        mid_km: (Number(s.from_km) + Number(s.to_km)) / 2,
        q_now: r2(s.q_now),
        q24: r2(s.forecast?.q24 ?? s.forecast?.q24_median),
        q72: r2(s.forecast?.q72 ?? s.q_peak_72h_median),
        rain_now_mmh: r2(s.rain_now_mmh),
        rain_past_24h_mm: r2(s.rain_past_24h_mm),
        rain_next_24h_mm: r2(s.rain_next_24h_mm),
      })),
      updatedAt: res.fetchedAt,
      provenance: { dataClass: "LIVE · MODELLED + FORECAST", unit: "m³/s", note: "/api/discharge_profile" },
    };
  } catch (err) {
    return { ok: false, error: err?.message, provenance: { dataClass: "UNAVAILABLE" } };
  }
}

export async function getRainfallSeries(chainage_m, hours = 72) {
  const live = await ensureLive();
  const meters = Number(chainage_m) || 0;
  const hg = await getNadiTwinHydrographAtChainage(meters, hours).catch(() => null);
  if (!hg?.times?.length) {
    return { ok: false, chainage_m: meters, provenance: { dataClass: "UNAVAILABLE" } };
  }
  const nowMs = Date.now();
  const obsH = [], obsRain = [], fcH = [], fcRain = [];
  for (let i = 0; i < hg.times.length; i += 1) {
    const t = Date.parse(hg.times[i]);
    if (!Number.isFinite(t)) continue;
    const h = (t - nowMs) / 3600000;
    const rain = Number(hg.observed_rain?.[i]);
    if (!Number.isFinite(rain) || h > 0.5) continue;
    obsH.push(r2(h));
    obsRain.push(r2(rain));
  }
  const ft = asArr(hg.forecast_times?.length ? hg.forecast_times : hg.raw?.forecast?.times);
  const fr = asArr(hg.raw?.forecast?.rain);
  for (let i = 0; i < Math.max(ft.length, fr.length); i += 1) {
    const t = ft[i] != null ? Date.parse(ft[i]) : NaN;
    const h = Number.isFinite(t) ? (t - nowMs) / 3600000 : i + 1;
    const rain = Number(fr[i]);
    if (!Number.isFinite(rain) || h <= 0) continue;
    fcH.push(r2(h));
    fcRain.push(r2(rain));
  }
  return {
    ok: obsRain.length > 0 || fcRain.length > 0,
    chainage_m: meters,
    cell: cellForMeters(meters, live),
    observed: { hours: obsH, rain_mmh: obsRain },
    forecast: { hours: fcH, rain_mmh: fcRain },
    provenance: {
      observed: "NADITWIN HISTORICAL · MODELLED",
      forecast: fcRain.length ? "NADITWIN FORECAST rain" : "UNAVAILABLE",
      dataClass: "MODELLED",
      unit: "mm/h",
      note: "Not gauge OBSERVED rainfall",
    },
  };
}

export async function getRatingCurveSeries(chainage_m) {
  const live = await ensureLive();
  const meters = Number(chainage_m) || 0;
  const cell = cellForMeters(meters, live);
  try {
    const res = await fetchNadiTwinRating(cell);
    const d = res.data || {};
    const q = asArr(d.q).map(r2);
    const stage = asArr(d.stage).map(r2);
    if (!q.length || !stage.length) {
      return { ok: false, cell, provenance: { dataClass: "UNAVAILABLE", note: "Empty rating" } };
    }
    return {
      ok: true,
      cell,
      chainage_m: meters,
      label: d.label,
      q_m3s: q,
      stage_m: stage,
      depth_m: asArr(d.depth).map(r2),
      now: { q: r2(d.now?.q), stage: r2(d.now?.stage) },
      peak72: { q: r2(d.peak72?.q), stage: r2(d.peak72?.stage) },
      levels: d.levels || null,
      datum: d.datum || null,
      updatedAt: res.fetchedAt,
      provenance: {
        dataClass: "DERIVED · MODELLED",
        unit_x: "m³/s",
        unit_y: "m (relative)",
        note: "/api/rating · relative datum · not MSL",
      },
    };
  } catch (err) {
    return { ok: false, cell, error: err?.message, provenance: { dataClass: "UNAVAILABLE" } };
  }
}

export async function getTodaySeries(chainage_m, tzOffsetMin = 330) {
  const live = await ensureLive();
  const meters = Number(chainage_m) || 0;
  const cell = cellForMeters(meters, live);
  try {
    const res = await fetchNadiTwinToday(cell, tzOffsetMin);
    const d = res.data || {};
    const hours = asArr(d.hours).map((h) => Number(h));
    return {
      ok: hours.length > 0,
      cell,
      chainage_m: meters,
      date: d.date,
      current_hour: d.current_hour,
      hours,
      q_observed: asArr(d.q_observed).map(r2),
      q_forecast_median: asArr(d.q_forecast_median).map(r2),
      q_forecast_p10: asArr(d.q_forecast_p10).map(r2),
      q_forecast_p90: asArr(d.q_forecast_p90).map(r2),
      wse_observed: asArr(d.wse_observed).map(r2),
      wse_forecast_median: asArr(d.wse_forecast_median).map(r2),
      wse_forecast_p10: asArr(d.wse_forecast_p10).map(r2),
      wse_forecast_p90: asArr(d.wse_forecast_p90).map(r2),
      updatedAt: res.fetchedAt,
      provenance: {
        observed: "NADITWIN TODAY · MODELLED",
        forecast: "NADITWIN TODAY · FORECAST",
        dataClass: "LIVE/FORECAST · MODELLED",
        note: "Not gauge OBSERVED · relative WSE",
      },
    };
  } catch (err) {
    return { ok: false, cell, error: err?.message, provenance: { dataClass: "UNAVAILABLE" } };
  }
}

export async function getAnnualHydrographSeries(chainage_m, year) {
  const live = await ensureLive();
  const meters = Number(chainage_m) || 0;
  const cell = cellForMeters(meters, live);
  const y = Number(year) || new Date().getFullYear() - 1;
  try {
    const res = await fetchNadiTwinHydrographYear(cell, y);
    const d = res.data || {};
    const times = asArr(d.times);
    const stage = asArr(d.observed).map(r2);
    const q = asArr(d.observed_q).map(r2);
    const rain = asArr(d.observed_rain).map(r2);
    const n = times.length;
    const idx = downsample(n, 200);
    return {
      ok: n > 0,
      cell,
      chainage_m: meters,
      year: d.year || y,
      times: idx.map((i) => times[i]),
      stage_m: idx.map((i) => stage[i] ?? null),
      q_m3s: idx.map((i) => q[i] ?? null),
      rain_mmh: idx.map((i) => rain[i] ?? null),
      year_summary: d.year_summary || null,
      levels: d.levels || null,
      updatedAt: res.fetchedAt,
      provenance: { dataClass: "HISTORICAL · MODELLED", note: `hydrograph year=${y} — not gauge OBSERVED` },
    };
  } catch (err) {
    return { ok: false, cell, year: y, error: err?.message, provenance: { dataClass: "UNAVAILABLE" } };
  }
}

export async function getMarginsChainageSeries(stepKm = 1) {
  try {
    const res = await fetchNadiTwinMargins("chainage", { params: { step_km: stepKm } });
    const rows = Array.isArray(res.data) ? res.data : [];
    return {
      ok: rows.length > 0,
      rows: rows.map((r) => ({
        chainage_m: Number(r.chainage_m),
        label: r.label,
        wse_now: r2(r.wse_now),
        crest: r2(r.crest ?? r.levels?.crest),
        danger: r2(r.threshold ?? r.levels?.danger),
        warning: r2(r.levels?.warning),
        watch: r2(r.levels?.watch),
        margin_now_m: r2(r.margin_now_m),
        status: r.status,
      })),
      updatedAt: res.fetchedAt,
      provenance: {
        dataClass: "LIVE · MODELLED · DISPLAY ONLY",
        note: "Safety boards LOCKED — relative crest assumptions",
        unit: "m",
      },
      safetyLocked: true,
    };
  } catch (err) {
    return { ok: false, error: err?.message, provenance: { dataClass: "UNAVAILABLE" }, safetyLocked: true };
  }
}

export async function getScorecardSeries() {
  try {
    const res = await fetchNadiTwinScorecard();
    const rows = Array.isArray(res.data?.rows) ? res.data.rows : [];
    return {
      ok: rows.length > 0,
      note: res.data?.note || null,
      rows,
      updatedAt: res.fetchedAt,
      provenance: { dataClass: "HINDCAST · MODELLED", note: "Do not claim skill without observed pairs" },
    };
  } catch (err) {
    return { ok: false, error: err?.message, provenance: { dataClass: "UNAVAILABLE" } };
  }
}

export async function getTimerangeMeta() {
  try {
    const res = await fetchNadiTwinTimerange();
    return { ok: true, ...(res.data || {}), updatedAt: res.fetchedAt };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export async function getLocationsSeries() {
  try {
    const res = await fetchNadiTwinLocations();
    const rows = Array.isArray(res.data) ? res.data : [];
    return { ok: rows.length > 0, rows, updatedAt: res.fetchedAt };
  } catch (err) {
    return { ok: false, error: err?.message, rows: [] };
  }
}

export async function getAlertsChainageSeries(stepKm = 1) {
  try {
    const res = await fetchNadiTwinAlertsChainage(stepKm);
    const rows = Array.isArray(res.data) ? res.data : [];
    return {
      ok: true,
      rows,
      count: rows.length,
      updatedAt: res.fetchedAt,
      provenance: { dataClass: rows.length ? "LIVE · MODELLED" : "LIVE · NONE" },
    };
  } catch (err) {
    return { ok: false, rows: [], error: err?.message };
  }
}

export async function getLandmarkAlertsSeries() {
  try {
    const res = await fetchNadiTwinAlerts();
    const rows = Array.isArray(res.data) ? res.data : [];
    return { ok: true, rows, count: rows.length, updatedAt: res.fetchedAt };
  } catch (err) {
    return { ok: false, rows: [], error: err?.message };
  }
}

export async function getStationsStretchSeries(loc = "L1") {
  try {
    const res = await fetchNadiTwinStations(loc);
    const d = res.data;
    if (Array.isArray(d)) {
      return {
        ok: d.length > 0,
        loc,
        chainage_m: d.map((r) => Number(r.chainage_m)),
        q: d.map((r) => r2(r.q)),
        depth_m: d.map((r) => r2(r.depth_m)),
        stage: d.map((r) => r2(r.stage)),
        velocity_ms: d.map((r) => r2(r.velocity_ms)),
        margin_m: d.map((r) => r2(r.margin_m)),
        updatedAt: res.fetchedAt,
        provenance: { dataClass: "LIVE · MODELLED", note: `/api/stations?loc=${loc}` },
      };
    }
    const n = Number(d?.n) || asArr(d?.q).length;
    if (!n) return { ok: false, loc, provenance: { dataClass: "UNAVAILABLE" } };
    const chainage = asArr(d.chainage_m).length === n
      ? asArr(d.chainage_m).map(Number)
      : Array.from({ length: n }, (_, i) => i * 10);
    return {
      ok: true,
      loc,
      chainage_m: chainage,
      q: asArr(d.q).map(r2),
      depth_m: asArr(d.depth_m).map(r2),
      stage: asArr(d.stage).map(r2),
      velocity_ms: asArr(d.velocity_ms).map(r2),
      margin_m: asArr(d.margin_m).map(r2),
      updatedAt: res.fetchedAt,
      provenance: { dataClass: "LIVE · MODELLED", note: `/api/stations?loc=${loc}` },
    };
  } catch (err) {
    return { ok: false, loc, error: err?.message, provenance: { dataClass: "UNAVAILABLE" } };
  }
}

export const NADITWIN_CHART_CATALOG = [
  { id: "live_q_profile", name: "Live discharge profile", endpoint: "/api/state", category: "LIVE", chart: "profile", unit: "m³/s", chainage: true },
  { id: "segment_q_profile", name: "1 km discharge profile", endpoint: "/api/discharge_profile", category: "LIVE", chart: "profile", unit: "m³/s", chainage: "segment" },
  { id: "live_depth", name: "Live depth profile", endpoint: "/api/state", category: "LIVE", chart: "profile", unit: "m", chainage: true },
  { id: "live_stage", name: "Live stage profile", endpoint: "/api/state+/api/forecast/profile", category: "LIVE", chart: "profile", unit: "m", chainage: true },
  { id: "discharge_today", name: "Discharge hydrograph", endpoint: "/api/hydrograph", category: "HISTORICAL", chart: "line+band", unit: "m³/s", chainage: true },
  { id: "stage_hydro", name: "Stage hydrograph", endpoint: "/api/hydrograph", category: "HISTORICAL", chart: "line+band", unit: "m", chainage: true },
  { id: "rainfall", name: "Rainfall series", endpoint: "/api/hydrograph", category: "RAINFALL", chart: "bar", unit: "mm/h", chainage: true },
  { id: "annual_hydro", name: "Annual hydrograph", endpoint: "/api/hydrograph?year=", category: "HISTORICAL", chart: "line", unit: "mixed", chainage: true },
  { id: "today", name: "Today Q / WSE", endpoint: "/api/today", category: "FORECAST", chart: "line+band", unit: "mixed", chainage: true },
  { id: "forecast_profile", name: "Forecast WSE profile", endpoint: "/api/forecast/profile", category: "FORECAST", chart: "profile+band", unit: "m", chainage: true },
  { id: "rating", name: "Rating curve", endpoint: "/api/rating", category: "HYDRAULIC", chart: "xy", unit: "m³/s vs m", chainage: true },
  { id: "margins_chainage", name: "Margins along reach", endpoint: "/api/margins_chainage", category: "HYDRAULIC", chart: "profile", unit: "m", chainage: true, displayOnly: true },
  { id: "alerts", name: "Alerts", endpoint: "/api/alerts+/api/alerts_chainage", category: "HYDRAULIC", chart: "table", unit: "—", chainage: true },
  { id: "scorecard", name: "Hindcast scorecard", endpoint: "/api/scorecard", category: "HYDRAULIC", chart: "table", unit: "mixed", chainage: false },
  { id: "stations_stretch", name: "Stretch stations", endpoint: "/api/stations", category: "LIVE", chart: "profile", unit: "mixed", chainage: true },
];
