/**
 * Data controller for 3D hydrology visualization modes.
 * LIVE / HISTORICAL / FORECAST kept distinct; safety stays locked.
 * Timeline offsetH: −72…0 = historical/NOW, +1…+72 = forecast lead hours.
 */
import { state } from "../../state.js";
import { hydrologyStore } from "./hydrologyStore.js";
import { bathymetryService } from "./bathymetryService.js";
import { DATA_CLASS } from "./hydrologyProvenance.js";
import {
  areSafetyBoardsUnlocked,
  getNadiTwinDischargeAtChainage,
  getNadiTwinForecastAlongReach,
  getNadiTwinHydrographAtChainage,
  getNadiTwinLiveBundle,
  getNadiTwinSafetyBoard,
  refreshNadiTwinHydrology,
  subscribeNadiTwinHydrology,
} from "./naditwinHydrologyAdapter.js";
import { mapLocalChainageToCell } from "./hydrologyNormalizer.js";

export const HYDRO_VIZ_MODES = Object.freeze({
  DISCHARGE: "discharge",
  STAGE: "stage",
  DEPTH: "depth",
  VELOCITY: "velocity",
  FORECAST: "forecast",
  HISTORICAL: "historical",
  SAFETY: "safety",
  RATING: "rating",
});

const MODE_META = {
  [HYDRO_VIZ_MODES.DISCHARGE]: {
    label: "Discharge",
    unit: "m³/s",
    dataClass: DATA_CLASS.LIVE,
  },
  [HYDRO_VIZ_MODES.STAGE]: {
    label: "River Stage (relative)",
    unit: "m rel.",
    dataClass: DATA_CLASS.LIVE,
    note: "NadiTwin WSE is relative — not applied to 3D water mesh / not MSL",
  },
  [HYDRO_VIZ_MODES.DEPTH]: {
    label: "Water Depth",
    unit: "m",
    dataClass: DATA_CLASS.LIVE,
  },
  [HYDRO_VIZ_MODES.VELOCITY]: {
    label: "Flow Velocity",
    unit: "m/s",
    dataClass: DATA_CLASS.MODELLED,
  },
  [HYDRO_VIZ_MODES.FORECAST]: {
    label: "Forecast",
    unit: "m³/s",
    dataClass: DATA_CLASS.FORECAST,
  },
  [HYDRO_VIZ_MODES.HISTORICAL]: {
    label: "Historical",
    unit: "m³/s",
    dataClass: DATA_CLASS.MODELLED,
  },
  [HYDRO_VIZ_MODES.SAFETY]: {
    label: "Threshold & Safety",
    unit: "—",
    dataClass: DATA_CLASS.UNAVAILABLE,
  },
  [HYDRO_VIZ_MODES.RATING]: {
    label: "Rating Curve",
    unit: "Q–stage",
    dataClass: DATA_CLASS.MODELLED,
  },
};

/** Timeline: hours relative to NOW. Negative = historical, 0 = NOW/LIVE, positive = forecast lead. */
let _mode = HYDRO_VIZ_MODES.DISCHARGE;
let _offsetH = 0;
let _active = false;
let _playing = false;
let _playSpeed = 1;
let _selectedMeters = 0;
const _listeners = new Set();
const _forecastCache = new Map();
const _hydrographCache = new Map();

function notify(extra = {}) {
  const payload = { ...getHydroVizSnapshot(), ...extra };
  for (const fn of _listeners) {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  }
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("hydrology-viz-change", { detail: payload }));
  }
}

function timeClass(offsetH = _offsetH) {
  if (offsetH < 0) return "HISTORICAL";
  if (offsetH > 0) return "FORECAST";
  return "LIVE";
}

export function subscribeHydroViz(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getHydroVizModeMeta(mode = _mode) {
  return MODE_META[mode] || MODE_META[HYDRO_VIZ_MODES.DISCHARGE];
}

export function getHydroVizSnapshot() {
  return {
    active: _active,
    mode: _mode,
    offsetH: _offsetH,
    leadH: Math.max(0, _offsetH),
    timeClass: timeClass(),
    playing: _playing,
    playSpeed: _playSpeed,
    selectedMeters: _selectedMeters,
    meta: getHydroVizModeMeta(),
    safetyUnlocked: areSafetyBoardsUnlocked(),
  };
}

export function setHydroVizActive(on) {
  _active = !!on;
  state.hydrologyVizActive = _active;
  if (!_active) {
    _playing = false;
  }
  if (_active && !getNadiTwinLiveBundle()) {
    refreshNadiTwinHydrology().catch(() => {});
  }
  notify();
  return _active;
}

export function setHydroVizMode(mode) {
  if (!MODE_META[mode]) return _mode;
  _mode = mode;
  if (mode === HYDRO_VIZ_MODES.HISTORICAL) {
    if (_offsetH >= 0) _offsetH = -1;
  } else if (mode === HYDRO_VIZ_MODES.FORECAST) {
    if (_offsetH < 0) _offsetH = 0;
  } else if (
    mode !== HYDRO_VIZ_MODES.DISCHARGE
  ) {
    _playing = false;
  }
  if (
    mode !== HYDRO_VIZ_MODES.FORECAST &&
    mode !== HYDRO_VIZ_MODES.HISTORICAL &&
    mode !== HYDRO_VIZ_MODES.DISCHARGE
  ) {
    _playing = false;
  }
  notify();
  return _mode;
}

/** @deprecated use setHydroVizOffsetHours */
export function setHydroVizLeadHours(h) {
  return setHydroVizOffsetHours(Math.max(0, Number(h) || 0));
}

export function setHydroVizOffsetHours(h) {
  _offsetH = Math.max(-72, Math.min(72, Math.round(Number(h) || 0)));
  notify();
  return _offsetH;
}

export function stepHydroVizOffset(delta = 1) {
  return setHydroVizOffsetHours(_offsetH + delta);
}

export function setHydroVizPlaying(on) {
  _playing = !!on;
  notify({ playing: _playing });
  return _playing;
}

export function setHydroVizPlaySpeed(speed) {
  const s = Number(speed);
  _playSpeed = s === 5 || s === 10 ? s : 1;
  notify();
  return _playSpeed;
}

export function setHydroVizSelectedMeters(m) {
  if (Number.isFinite(Number(m))) _selectedMeters = Number(m);
  return _selectedMeters;
}

async function ensureLive() {
  if (!getNadiTwinLiveBundle()) {
    await refreshNadiTwinHydrology().catch(() => {});
  }
  return getNadiTwinLiveBundle();
}

async function getHydrographCached(meters) {
  const key = `${Math.round(meters)}:72`;
  let hg = _hydrographCache.get(key);
  if (!hg) {
    hg = await getNadiTwinHydrographAtChainage(meters, 72);
    _hydrographCache.set(key, hg);
  }
  return hg;
}

async function getForecastCached(leadH) {
  const h = Math.max(1, Math.min(72, Math.round(leadH)));
  let fc = _forecastCache.get(h);
  if (!fc) {
    fc = await getNadiTwinForecastAlongReach(h);
    if (fc.ok) _forecastCache.set(h, fc);
  }
  return fc;
}

/**
 * Index into hydrograph arrays for timeline offset.
 * Historical: observed ends at NOW; offsetH=-1 → last-1, etc.
 * Forecast: forecast arrays start at NOW+step; offsetH=+1 → index 0.
 */
function hydrographIndex(hg, offsetH) {
  if (offsetH < 0) {
    const obs = hg?.observed_q || [];
    const i = obs.length - 1 + offsetH;
    if (i < 0 || i >= obs.length) return null;
    return { kind: "HISTORICAL", index: i, arr: "observed" };
  }
  if (offsetH === 0) {
    return { kind: "LIVE", index: null, arr: null };
  }
  const qMed = hg?.forecast_q_median || [];
  const i = Math.min(qMed.length - 1, Math.max(0, offsetH - 1));
  if (!qMed.length || i < 0) return null;
  return { kind: "FORECAST", index: i, arr: "forecast" };
}

function timestampFor(hg, live, offsetH) {
  if (offsetH === 0) return live?.timestamp || null;
  const hit = hydrographIndex(hg, offsetH);
  if (!hit) return null;
  if (hit.kind === "HISTORICAL") {
    return hg?.times?.[hit.index] || null;
  }
  const ft = hg?.forecast_times || hg?.raw?.forecast?.times || [];
  return ft[hit.index] || null;
}

/** Spatial series — nearest 10 m cell join only. No fabricated gaps. */
export async function buildHydroVizSeries(mode = _mode, offsetH = _offsetH) {
  const live = await ensureLive();
  const stepM = live?.chainage_step_m || 10;

  if (mode === HYDRO_VIZ_MODES.SAFETY) {
    const board = await getNadiTwinSafetyBoard("landmarks");
    return {
      ok: false,
      locked: !!board.locked,
      reason: board.reason || "Safety boards locked",
      dataClass: DATA_CLASS.UNAVAILABLE,
      series: null,
      stepM,
      unit: "—",
      palette: "neutral",
    };
  }

  // FORECAST spatial surface at lead hours
  if (
    (mode === HYDRO_VIZ_MODES.FORECAST || mode === HYDRO_VIZ_MODES.DISCHARGE) &&
    offsetH > 0
  ) {
    const fc = await getForecastCached(offsetH);
    if (!fc.ok) {
      return {
        ok: false,
        error: fc.error,
        dataClass: DATA_CLASS.FORECAST,
        note: "Forecast unavailable — no synthetic spatial surface",
        series: null,
        stepM,
        unit: "m³/s",
        palette: "forecast",
        timeClass: "FORECAST",
      };
    }
    const median = fc.payload?.q_median_station || null;
    if (!Array.isArray(median) || !median.length) {
      return {
        ok: false,
        error: "Spatial forecast discharge unavailable",
        dataClass: DATA_CLASS.FORECAST,
        note: "No q_median_station — not inventing from stage median",
        series: null,
        stepM,
        unit: "m³/s",
        palette: "forecast",
        timeClass: "FORECAST",
      };
    }
    return {
      ok: true,
      dataClass: DATA_CLASS.FORECAST,
      source: "NADITWIN FORECAST",
      note: `FORECAST P50 · +${offsetH}h — not LIVE`,
      series: median,
      p10: null,
      p90: null,
      stepM,
      unit: "m³/s",
      lead_h: offsetH,
      palette: "forecast",
      timeClass: "FORECAST",
      timestamp: null,
    };
  }

  // HISTORICAL: no full-reach spatial surface from NadiTwin — do not invent
  if ((mode === HYDRO_VIZ_MODES.HISTORICAL || mode === HYDRO_VIZ_MODES.FORECAST) && offsetH < 0) {
    const q = live?.q_station || [];
    return {
      ok: Array.isArray(q) && q.length > 0,
      dataClass: DATA_CLASS.MODELLED,
      source: "NADITWIN HISTORICAL",
      note: "HISTORICAL · selected-station hydrograph only — spatial reach surface N/A",
      series: q,
      spatialHistorical: false,
      stepM,
      unit: "m³/s",
      timestamp: live?.timestamp || null,
      palette: "historical",
      timeClass: "HISTORICAL",
      dim: true,
    };
  }

  if (
    mode === HYDRO_VIZ_MODES.DISCHARGE ||
    mode === HYDRO_VIZ_MODES.FORECAST ||
    mode === HYDRO_VIZ_MODES.HISTORICAL
  ) {
    const q = live?.q_station || [];
    return {
      ok: Array.isArray(q) && q.length > 0,
      dataClass: DATA_CLASS.LIVE,
      source: "NADITWIN LIVE",
      note: live?.note || "LIVE NadiTwin discharge",
      series: q,
      stepM,
      unit: "m³/s",
      timestamp: live?.timestamp || null,
      outlet_q: live?.discharge_m3s ?? live?.q_out_now ?? null,
      palette: "discharge",
      timeClass: "LIVE",
    };
  }

  if (mode === HYDRO_VIZ_MODES.STAGE) {
    const wse = live?.wse || [];
    const depth = live?.depth || [];
    const records = hydrologyStore.getProfile()?.records || [];
    const bedSeries = records.length
      ? records.map((r) => ({
          meters: Number(r.chainage_m),
          value: Number(r.survey_depth_m?.value),
          kind: "SURVEYED",
        }))
      : null;
    // Color by relative WSE; companion = surveyed bed depth for stage profile card
    return {
      ok: Array.isArray(wse) && wse.length > 0,
      dataClass: DATA_CLASS.LIVE,
      source: "NADITWIN LIVE",
      note: "RELATIVE stage — not MSL; 3D water mesh unchanged",
      series: wse,
      companionDepth: Array.isArray(depth) ? depth : null,
      bedSeries,
      stepM,
      unit: "m rel.",
      timestamp: live?.timestamp || null,
      datum: live?.datum || "m, relative",
      palette: "stage",
      timeClass: "LIVE",
    };
  }

  if (mode === HYDRO_VIZ_MODES.DEPTH) {
    const records = hydrologyStore.getProfile()?.records || [];
    if (records.length) {
      return {
        ok: true,
        dataClass: DATA_CLASS.LIVE,
        source: "SURVEYED",
        note: "Survey / profile depth — NadiTwin not used to overwrite",
        series: records.map((r) => {
          const survey = Number(r.survey_depth_m?.value);
          const flow = Number(r.water_depth_m?.value);
          if (Number.isFinite(survey)) {
            return { meters: Number(r.chainage_m), value: survey, kind: "SURVEYED" };
          }
          if (Number.isFinite(flow)) {
            return { meters: Number(r.chainage_m), value: flow, kind: "MODELLED" };
          }
          return { meters: Number(r.chainage_m), value: null, kind: "N/A" };
        }),
        stepM: 10,
        unit: "m",
        timestamp: live?.timestamp || null,
        palette: "depth",
        timeClass: "LIVE",
      };
    }
    const depth = live?.depth || [];
    return {
      ok: Array.isArray(depth) && depth.length > 0,
      dataClass: DATA_CLASS.MODELLED,
      source: "MODELLED",
      note: "NadiTwin modelled depth (survey unavailable)",
      series: depth,
      stepM,
      unit: "m",
      timestamp: live?.timestamp || null,
      palette: "depth",
      timeClass: "LIVE",
    };
  }

  if (mode === HYDRO_VIZ_MODES.VELOCITY) {
    const records = hydrologyStore.getProfile()?.records || [];
    if (records.length) {
      return {
        ok: true,
        dataClass: DATA_CLASS.MODELLED,
        source: "MODELLED",
        note: "Modelled velocity from hydraulic geometry",
        series: records.map((r) => ({
          meters: Number(r.chainage_m),
          value: Number(r.velocity_ms?.value),
          kind: "MODELLED",
        })),
        stepM: 10,
        unit: "m/s",
        timestamp: live?.timestamp || null,
        palette: "discharge",
        timeClass: "LIVE",
      };
    }
    return {
      ok: false,
      error: "Velocity series unavailable",
      series: null,
      unit: "m/s",
      dataClass: DATA_CLASS.UNAVAILABLE,
      palette: "neutral",
    };
  }

  if (mode === HYDRO_VIZ_MODES.RATING) {
    return {
      ok: true,
      dataClass: DATA_CLASS.MODELLED,
      source: "MODELLED",
      note: "Q–stage pairs — not a calibrated rating curve",
      series: live?.q_station || [],
      stepM,
      unit: "m³/s",
      timestamp: live?.timestamp || null,
      spatial: false,
      palette: "discharge",
    };
  }

  return { ok: false, series: null, dataClass: DATA_CLASS.UNAVAILABLE, palette: "neutral" };
}

/** Compact inspect — only verified fields; N/A when missing. Timeline-aware. */
export async function inspectHydroAtChainage(meters, offsetH = _offsetH) {
  const m = Number(meters);
  if (!Number.isFinite(m)) return null;
  _selectedMeters = m;
  const live = await ensureLive();
  const step = live?.chainage_step_m || 10;
  const cell = mapLocalChainageToCell(m, live?.n_cells || 0, step);
  const rec = hydrologyStore.getStationAtChainage(m);
  const hg = await getHydrographCached(m).catch(() => null);
  const tc = timeClass(offsetH);

  const fields = {
    chainage_m: m,
    timeClass: tc,
    offsetH,
    timestamp: timestampFor(hg, live, offsetH),
    datum: live?.datum || "m, relative",
  };

  // Discharge — LIVE / HISTORICAL / FORECAST
  if (offsetH === 0) {
    const hit = getNadiTwinDischargeAtChainage(m);
    if (hit && Number.isFinite(hit.q_m3s)) {
      fields.discharge_m3s = hit.q_m3s;
      fields.dischargeSource = "NADITWIN LIVE";
      fields.dataClass = DATA_CLASS.LIVE;
    } else {
      fields.discharge_m3s = null;
      fields.dischargeSource = "N/A";
    }
  } else if (offsetH < 0 && hg) {
    const hit = hydrographIndex(hg, offsetH);
    const q = hit ? Number(hg.observed_q?.[hit.index]) : NaN;
    if (Number.isFinite(q)) {
      fields.discharge_m3s = q;
      fields.dischargeSource = "NADITWIN HISTORICAL";
      fields.dataClass = DATA_CLASS.MODELLED;
    } else {
      fields.discharge_m3s = null;
      fields.dischargeSource = "N/A";
    }
  } else if (offsetH > 0) {
    const fc = await getForecastCached(offsetH);
    const q =
      fc.ok && cell != null ? Number(fc.payload?.q_median_station?.[cell]) : NaN;
    if (Number.isFinite(q)) {
      fields.discharge_m3s = q;
      fields.dischargeSource = "NADITWIN FORECAST";
      fields.forecast_discharge_m3s = q;
      fields.forecast_lead_h = offsetH;
      fields.forecast_class = DATA_CLASS.FORECAST;
      fields.dataClass = DATA_CLASS.FORECAST;
    } else {
      fields.discharge_m3s = null;
      fields.forecast_discharge_m3s = null;
      fields.dischargeSource = "N/A";
    }
    // P10–P90 at selected chainage from hydrograph forecast series if present
    if (hg?.forecast_q_p10?.length && hg?.forecast_q_p90?.length) {
      const i = Math.min(hg.forecast_q_p10.length - 1, Math.max(0, offsetH - 1));
      const p10 = Number(hg.forecast_q_p10[i]);
      const p90 = Number(hg.forecast_q_p90[i]);
      if (Number.isFinite(p10)) fields.forecast_p10 = p10;
      if (Number.isFinite(p90)) fields.forecast_p90 = p90;
    }
  }

  if (live?.q_out_now != null && offsetH === 0) {
    fields.outlet_discharge_m3s = live.q_out_now;
  }

  // Depth — prefer survey
  const survey = Number(rec?.survey_depth_m?.value);
  if (Number.isFinite(survey)) {
    fields.survey_depth_m = survey;
    fields.depthSource = "SURVEYED";
  } else {
    const flowD = Number(rec?.water_depth_m?.value);
    if (Number.isFinite(flowD)) {
      fields.flow_depth_m = flowD;
      fields.depthSource = "MODELLED";
    } else if (cell != null && live?.depth?.[cell] != null) {
      fields.nt_depth_m = live.depth[cell];
      fields.depthSource = "MODELLED";
      fields.nt_depth_note = "NadiTwin modelled — not survey overwrite";
    } else {
      fields.depthSource = "N/A";
    }
  }

  if (cell != null && live?.wse?.[cell] != null) {
    fields.stage_m_relative = live.wse[cell];
    fields.stageSource = "NADITWIN LIVE";
    fields.stage_note = "Relative WSE — not MSL";
  } else {
    fields.stage_m_relative = null;
    fields.stageSource = "N/A";
  }

  // Forecast at NOW context (preview)
  if (offsetH === 0 && hg?.forecast_q_median?.length) {
    fields.forecast_discharge_m3s = hg.forecast_q_median[Math.min(23, hg.forecast_q_median.length - 1)];
    fields.forecast_lead_h = 24;
    fields.forecast_class = DATA_CLASS.FORECAST;
    if (hg.forecast_q_p10?.length && hg.forecast_q_p90?.length) {
      const i = Math.min(23, hg.forecast_q_p10.length - 1);
      fields.forecast_p10 = hg.forecast_q_p10[i];
      fields.forecast_p90 = hg.forecast_q_p90[i];
    }
  }

  const vel = Number(rec?.velocity_ms?.value);
  if (Number.isFinite(vel)) {
    fields.velocity_ms = vel;
    fields.velocitySource = "MODELLED";
  }

  try {
    const bathy = bathymetryService.getBathymetryAt?.({ chainageMeters: m });
    const d = bathy?.depth_m ?? bathy?.depth;
    if (Number.isFinite(Number(d))) fields.bathy_depth_m = Number(d);
  } catch {
    /* optional */
  }

  fields.hydrograph = hg;
  return fields;
}

export async function getRatingPointsAtChainage(meters) {
  const hg = await getNadiTwinHydrographAtChainage(meters, 72);
  const qObs = hg?.observed_q || [];
  const stageObs = hg?.observed_stage || hg?.observed || [];
  const points = [];
  const n = Math.min(qObs.length, stageObs.length);
  for (let i = 0; i < n; i += 1) {
    const q = Number(qObs[i]);
    const s = Number(stageObs[i]);
    if (Number.isFinite(q) && Number.isFinite(s)) points.push({ q, stage: s, kind: "observed" });
  }
  const qF = hg?.forecast_q_median || [];
  const sF = hg?.forecast_median || [];
  const nf = Math.min(qF.length, sF.length);
  for (let i = 0; i < nf; i += 1) {
    const q = Number(qF[i]);
    const s = Number(sF[i]);
    if (Number.isFinite(q) && Number.isFinite(s)) points.push({ q, stage: s, kind: "forecast" });
  }
  return {
    points,
    dataClass: DATA_CLASS.MODELLED,
    note: "Q–stage pairs from hydrograph — not a calibrated rating curve",
    datum: hg?.datum || "relative",
  };
}

subscribeNadiTwinHydrology(() => {
  if (_active) notify({ from: "naditwin" });
});
