/**
 * Single normalized hydrology state for River.EYE consumers.
 * LIVE outlet Q ≠ selected-chainage Q. ForecastEngine never writes LIVE here.
 */
import { state } from "../../state.js";
import { hydrologyStore } from "./hydrologyStore.js";
import {
  getNadiTwinDischargeAtChainage,
  getNadiTwinLiveBundle,
  getNadiTwinForecastAlongReach,
  getNadiTwinHydrographAtChainage,
  getAdapterSnapshot,
  refreshNadiTwinHydrology,
  subscribeNadiTwinHydrology,
  areSafetyBoardsUnlocked,
} from "./naditwinHydrologyAdapter.js";
import { mapLocalChainageToCell } from "./hydrologyNormalizer.js";
import {
  QUALITY,
  makeMeasurement,
  validateForecastInterval,
  auditSeries,
} from "./hydrologyQuality.js";
import { recordForecastProfile, recordForecastSnapshot } from "./forecastValidationEngine.js";

const listeners = new Set();
let _selectedMeters = 0;
let _snapshot = emptySnapshot();
let _refreshing = false;
let _seq = 0;

function emptyMeas(unit = "") {
  return makeMeasurement({
    value: null,
    unit,
    source: "N/A",
    timestamp: null,
    provenance: QUALITY.UNAVAILABLE,
  });
}

function emptySnapshot() {
  return {
    updatedAt: null,
    selectedMeters: 0,
    live: {
      outlet_discharge: emptyMeas("m³/s"),
      selected_discharge: emptyMeas("m³/s"),
      rainfall: emptyMeas("mm/h"),
      stage_relative: emptyMeas("m rel."),
      depth: emptyMeas("m"),
      velocity: emptyMeas("m/s"),
    },
    forecast: {
      p50: emptyMeas("m³/s"),
      p10: emptyMeas("m³/s"),
      p90: emptyMeas("m³/s"),
      lead_h: null,
      issueTime: null,
      validTime: null,
      intervalOk: null,
      intervalReason: null,
    },
    historical: {
      available: {
        outletLevel: false,
        stationHydrograph: true,
        fullReachSpatial: false,
        resolution_m: 10,
        maxHours: 168,
        note: "Station hydrograph only — no full-reach historical spatial surface",
      },
    },
    qualityIssues: [],
    safetyLocked: true,
    seq: 0,
  };
}

function notify() {
  for (const fn of listeners) {
    try {
      fn(_snapshot);
    } catch {
      /* ignore */
    }
  }
  if (typeof document !== "undefined") {
    document.dispatchEvent(new CustomEvent("hydrology-canonical-change", { detail: _snapshot }));
  }
}

export function subscribeCanonicalHydrology(fn) {
  listeners.add(fn);
  try {
    fn(_snapshot);
  } catch {
    /* ignore */
  }
  return () => listeners.delete(fn);
}

export function getCanonicalHydrology() {
  return _snapshot;
}

export function setCanonicalSelectedMeters(m) {
  if (Number.isFinite(Number(m))) {
    _selectedMeters = Number(m);
    state.selectedChainageMeters = _selectedMeters;
  }
  return refreshCanonicalHydrology({ selectedOnly: true });
}

export async function refreshCanonicalHydrology({ selectedOnly = false, lead_h = 24 } = {}) {
  if (_refreshing && !selectedOnly) return _snapshot;
  _refreshing = true;
  const mySeq = ++_seq;
  try {
    if (!getNadiTwinLiveBundle()) {
      await refreshNadiTwinHydrology().catch(() => {});
    }
    const live = getNadiTwinLiveBundle();
    const adapterSnap = getAdapterSnapshot();
    const forceStale = adapterSnap?.quality === "STALE" || !!adapterSnap?.lastError;
    const liveProv = forceStale ? QUALITY.STALE : QUALITY.LIVE;
    const ts = live?.timestamp || null;
    const m = _selectedMeters;
    const step = live?.chainage_step_m || 10;
    const cell = mapLocalChainageToCell(m, live?.n_cells || 0, step);
    const issues = [];
    if (forceStale) {
      issues.push({
        code: "API_STALE",
        detail: adapterSnap?.note || adapterSnap?.lastError?.message || "NadiTwin refresh failed",
      });
    }
    const hit = getNadiTwinDischargeAtChainage(m);
    const rec = hydrologyStore.getStationAtChainage(m);

    const outlet = makeMeasurement({
      value: live?.q_out_now ?? live?.discharge_m3s,
      unit: "m³/s",
      source: forceStale ? "NADITWIN STALE" : "NADITWIN LIVE",
      timestamp: ts,
      provenance: live ? liveProv : QUALITY.UNAVAILABLE,
      freshnessKey: "NADITWIN_LIVE",
      note: forceStale
        ? adapterSnap?.note || "Retained last verified outlet Q — not LIVE"
        : "Outlet authority — not selected-chainage Q",
    });
    const selected = makeMeasurement({
      value: hit?.q_m3s,
      unit: "m³/s",
      source: hit ? (forceStale ? "NADITWIN STALE" : "NADITWIN LIVE") : "N/A",
      timestamp: ts,
      provenance: hit ? liveProv : QUALITY.UNAVAILABLE,
      chainage_m: m,
      freshnessKey: "NADITWIN_LIVE",
    });
    const rain = makeMeasurement({
      value: live?.weather?.rain_now_mmh,
      unit: "mm/h",
      source: live?.weather ? "NADITWIN LIVE" : "N/A",
      timestamp: ts,
      provenance: live?.weather ? QUALITY.LIVE : QUALITY.UNAVAILABLE,
      freshnessKey: "OPEN_METEO_WEATHER",
    });
    const stage = makeMeasurement({
      value: cell != null ? live?.wse?.[cell] : null,
      unit: "m rel.",
      source: "NADITWIN LIVE",
      timestamp: ts,
      provenance: QUALITY.LIVE,
      chainage_m: m,
      freshnessKey: "NADITWIN_LIVE",
      note: "Relative WSE — not MSL",
    });
    const survey = Number(rec?.survey_depth_m?.value);
    const flowD = Number(rec?.water_depth_m?.value);
    const depthVal = Number.isFinite(survey) ? survey : Number.isFinite(flowD) ? flowD : null;
    const depth = makeMeasurement({
      value: depthVal,
      unit: "m",
      source: Number.isFinite(survey) ? "SURVEYED" : Number.isFinite(flowD) ? "MODELLED" : "N/A",
      timestamp: ts,
      provenance: Number.isFinite(survey)
        ? QUALITY.OBSERVED
        : Number.isFinite(flowD)
          ? QUALITY.MODELLED
          : QUALITY.UNAVAILABLE,
      chainage_m: m,
      freshnessKey: Number.isFinite(survey) ? "SURVEY_STATIC" : "NADITWIN_LIVE",
    });
    const vel = makeMeasurement({
      value: rec?.velocity_ms?.value,
      unit: "m/s",
      source: "MODELLED",
      timestamp: ts,
      provenance: QUALITY.MODELLED,
      chainage_m: m,
      freshnessKey: "NADITWIN_LIVE",
    });

    if (live?.q_station) {
      const audit = auditSeries(live.q_station, { name: "q_station" });
      if (!audit.ok) issues.push(...audit.issues);
    }

    let forecastBlock = selectedOnly ? _snapshot.forecast : emptySnapshot().forecast;
    if (!selectedOnly) {
      const fc = await getNadiTwinForecastAlongReach(lead_h);
      const issueTime = new Date().toISOString();
      if (fc.ok && Array.isArray(fc.payload?.q_median_station)) {
        recordForecastProfile(fc.payload, { lead_h, issueTime, selectedMeters: m });
        const qCell = cell != null ? Number(fc.payload.q_median_station[cell]) : NaN;
        const hg = await getNadiTwinHydrographAtChainage(m, 72).catch(() => null);
        const i = Math.min((hg?.forecast_q_median?.length || 1) - 1, Math.max(0, lead_h - 1));
        const p10 = Number(hg?.forecast_q_p10?.[i]);
        const p90 = Number(hg?.forecast_q_p90?.[i]);
        const p50 = Number.isFinite(qCell) ? qCell : Number(hg?.forecast_q_median?.[i]);
        const interval = validateForecastInterval(
          Number.isFinite(p10) ? p10 : p50,
          p50,
          Number.isFinite(p90) ? p90 : p50,
        );
        if (Number.isFinite(p10) && Number.isFinite(p90) && Number.isFinite(p50)) {
          recordForecastSnapshot({ issueTime, lead_h, chainage_m: m, cell, p10, p50, p90 });
        }
        const validTime = new Date(Date.parse(issueTime) + lead_h * 3600 * 1000).toISOString();
        forecastBlock = {
          p50: makeMeasurement({
            value: p50,
            unit: "m³/s",
            source: "NADITWIN FORECAST",
            timestamp: validTime,
            provenance: QUALITY.FORECAST,
            chainage_m: m,
            freshnessKey: "NADITWIN_FORECAST",
          }),
          p10: makeMeasurement({
            value: Number.isFinite(p10) ? p10 : null,
            unit: "m³/s",
            source: "NADITWIN FORECAST",
            timestamp: validTime,
            provenance: QUALITY.FORECAST,
            chainage_m: m,
            freshnessKey: "NADITWIN_FORECAST",
          }),
          p90: makeMeasurement({
            value: Number.isFinite(p90) ? p90 : null,
            unit: "m³/s",
            source: "NADITWIN FORECAST",
            timestamp: validTime,
            provenance: QUALITY.FORECAST,
            chainage_m: m,
            freshnessKey: "NADITWIN_FORECAST",
          }),
          lead_h,
          issueTime,
          validTime,
          intervalOk: interval.ok,
          intervalReason: interval.reason || null,
        };
        if (!interval.ok) issues.push({ code: "BAD_FORECAST_INTERVAL", message: interval.reason });
      }
    }

    if (mySeq !== _seq) return _snapshot;

    _snapshot = {
      updatedAt: new Date().toISOString(),
      selectedMeters: m,
      live: {
        outlet_discharge: outlet,
        selected_discharge: selected,
        rainfall: rain,
        stage_relative: stage,
        depth,
        velocity: vel,
      },
      forecast: forecastBlock,
      historical: emptySnapshot().historical,
      qualityIssues: issues,
      safetyLocked: !areSafetyBoardsUnlocked(),
      seq: mySeq,
    };
    notify();
    return _snapshot;
  } finally {
    _refreshing = false;
  }
}

subscribeNadiTwinHydrology(() => {
  refreshCanonicalHydrology().catch(() => {});
});

if (typeof document !== "undefined") {
  document.addEventListener("chainage-select", (e) => {
    const m = Number(e.detail?.meters);
    if (!Number.isFinite(m)) return;
    _selectedMeters = m;
    refreshCanonicalHydrology({ selectedOnly: true }).catch(() => {});
  });
}
