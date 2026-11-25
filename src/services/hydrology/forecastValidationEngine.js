/**
 * Forecast verification — pairs archived NadiTwin forecasts with later observations.
 * Does not invent observations. Shows insufficient-data when n is too small.
 */
import { getNadiTwinHydrographAtChainage } from "./naditwinHydrologyAdapter.js";
import { validateForecastInterval } from "./hydrologyQuality.js";

const STORAGE_KEY = "mm_forecast_archive_v1";
const MIN_SAMPLES = 8;
const MATCH_TOLERANCE_MS = 45 * 60 * 1000;

/** @type {Array<object>} */
let _archive = loadArchive();

function loadArchive() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(-500) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_archive.slice(-500)));
  } catch {
    /* quota */
  }
}

/**
 * Record a forecast snapshot when fetched from NadiTwin.
 * @param {object} opts
 */
export function recordForecastSnapshot({
  issueTime,
  lead_h,
  chainage_m,
  cell,
  p10,
  p50,
  p90,
  source = "NADITWIN FORECAST",
}) {
  const issue = issueTime || new Date().toISOString();
  const lead = Math.round(Number(lead_h) || 0);
  if (lead <= 0) return null;
  const issueMs = Date.parse(issue);
  if (!Number.isFinite(issueMs)) return null;
  const validMs = issueMs + lead * 3600 * 1000;
  const interval = validateForecastInterval(p10, p50, p90);
  const row = {
    id: `${issue}|${lead}|${Math.round(Number(chainage_m) || 0)}`,
    issueTime: issue,
    validTime: new Date(validMs).toISOString(),
    lead_h: lead,
    chainage_m: Number.isFinite(Number(chainage_m)) ? Number(chainage_m) : null,
    cell: cell ?? null,
    p10: Number.isFinite(Number(p10)) ? Number(p10) : null,
    p50: Number.isFinite(Number(p50)) ? Number(p50) : null,
    p90: Number.isFinite(Number(p90)) ? Number(p90) : null,
    source,
    intervalOk: interval.ok,
    intervalReason: interval.reason || null,
    recordedAt: new Date().toISOString(),
  };
  // de-dupe same id
  _archive = _archive.filter((r) => r.id !== row.id);
  _archive.push(row);
  persist();
  return row;
}

/**
 * Record spatial forecast profile (samples outlet + mid + selected).
 */
export function recordForecastProfile(payload, { lead_h, issueTime, selectedMeters = 0 } = {}) {
  const q = payload?.q_median_station;
  if (!Array.isArray(q) || !q.length) return [];
  const step = 10;
  const samples = [
    { chainage_m: 0, cell: 0 },
    { chainage_m: Math.round(selectedMeters), cell: Math.round(selectedMeters / step) },
    { chainage_m: (q.length - 1) * step, cell: q.length - 1 },
  ];
  const out = [];
  for (const s of samples) {
    const cell = Math.max(0, Math.min(q.length - 1, s.cell));
    out.push(
      recordForecastSnapshot({
        issueTime,
        lead_h,
        chainage_m: s.chainage_m,
        cell,
        p50: q[cell],
        p10: null,
        p90: null,
        source: "NADITWIN FORECAST",
      }),
    );
  }
  return out.filter(Boolean);
}

function leadBucket(h) {
  if (h <= 6) return "0-6h";
  if (h <= 24) return "6-24h";
  if (h <= 48) return "24-48h";
  return "48-72h";
}

/**
 * Pair archived forecasts with hydrograph series at a chainage.
 *
 * IMPORTANT: NadiTwin hydrograph "observed_q" is MODELLED historical (GloFAS-routed),
 * NOT authoritative gauge OBSERVED. Gauge pairs require telemetryService feed.
 * Modelled pairs are retained only as a non-authoritative proxy diagnostic.
 */
export async function buildValidationPairs(chainage_m, { observationClass = "MODELLED" } = {}) {
  const hg = await getNadiTwinHydrographAtChainage(chainage_m, 168).catch(() => null);
  const times = hg?.times || [];
  const obsQ = hg?.observed_q || [];
  const pairs = [];

  for (const fc of _archive) {
    if (fc.chainage_m != null && Math.abs(fc.chainage_m - chainage_m) > 15) continue;
    if (!Number.isFinite(fc.p50)) continue;
    if (fc.intervalOk === false) continue; // reject invalid P10–P90
    const validMs = Date.parse(fc.validTime);
    if (!Number.isFinite(validMs)) continue;

    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < times.length; i += 1) {
      const t = Date.parse(times[i]);
      if (!Number.isFinite(t)) continue;
      const d = Math.abs(t - validMs);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI < 0 || bestD > MATCH_TOLERANCE_MS) continue;
    const obs = Number(obsQ[bestI]);
    if (!Number.isFinite(obs)) continue;

    const err = fc.p50 - obs;
    const covered =
      Number.isFinite(fc.p10) && Number.isFinite(fc.p90)
        ? obs >= fc.p10 && obs <= fc.p90
        : null;

    pairs.push({
      issueTime: fc.issueTime,
      validTime: fc.validTime,
      obsTime: times[bestI],
      lead_h: fc.lead_h,
      bucket: leadBucket(fc.lead_h),
      chainage_m: fc.chainage_m,
      p10: fc.p10,
      p50: fc.p50,
      p90: fc.p90,
      observation: obs,
      observationClass,
      error: err,
      absError: Math.abs(err),
      pctError: obs !== 0 ? Math.abs(err / obs) * 100 : null,
      covered,
      source: fc.source,
      intervalOk: fc.intervalOk,
    });
  }
  return pairs;
}

/** Gauge OBSERVED pairs — empty until telemetry endpoints are configured. */
export async function buildGaugeValidationPairs(_chainage_m) {
  // hydrologyTelemetryService returns UNAVAILABLE for all stations today.
  return [];
}

function nashSutcliffe(pairs) {
  if (pairs.length < 2) return null;
  const meanObs = pairs.reduce((s, p) => s + p.observation, 0) / pairs.length;
  const ssRes = pairs.reduce((s, p) => s + p.error * p.error, 0);
  const ssTot = pairs.reduce((s, p) => {
    const d = p.observation - meanObs;
    return s + d * d;
  }, 0);
  if (ssTot <= 0) return null; // mathematically undefined / degenerate
  return 1 - ssRes / ssTot;
}

function metricsFromPairs(pairs, { authoritative = false } = {}) {
  if (!pairs.length) {
    return {
      n: 0,
      insufficient: true,
      status: "INSUFFICIENT OBSERVATION DATA",
      message: authoritative
        ? "INSUFFICIENT OBSERVATION DATA — no gauge OBSERVED pairs (need ≥ 8)"
        : `Insufficient matched pairs (need ≥ ${MIN_SAMPLES})`,
    };
  }
  const n = pairs.length;
  const mae = pairs.reduce((s, p) => s + p.absError, 0) / n;
  const rmse = Math.sqrt(pairs.reduce((s, p) => s + p.error * p.error, 0) / n);
  const bias = pairs.reduce((s, p) => s + p.error, 0) / n;
  const mapePairs = pairs.filter((p) => p.pctError != null);
  const mape = mapePairs.length
    ? mapePairs.reduce((s, p) => s + p.pctError, 0) / mapePairs.length
    : null;
  const coverable = pairs.filter((p) => p.covered != null);
  const coverage = coverable.length
    ? coverable.filter((p) => p.covered).length / coverable.length
    : null;
  const nse = nashSutcliffe(pairs);
  const insufficient = n < MIN_SAMPLES;
  // Authoritative gauge skill: withhold numeric metrics until n ≥ 8.
  // Modelled proxy: may show diagnostics but never as verified skill.
  const publish = !insufficient && (authoritative || !authoritative);

  return {
    n,
    insufficient,
    status: insufficient
      ? "INSUFFICIENT OBSERVATION DATA"
      : authoritative
        ? "METRICS_AVAILABLE"
        : "PROXY_ONLY_NOT_GAUGE",
    message: insufficient
      ? `INSUFFICIENT OBSERVATION DATA (n=${n}, need ≥ ${MIN_SAMPLES})`
      : authoritative
        ? null
        : "Diagnostics from MODELLED hydrograph proxy — not gauge OBSERVED skill",
    mae: publish ? round3(mae) : undefined,
    rmse: publish ? round3(rmse) : undefined,
    bias: publish ? round3(bias) : undefined,
    mape: publish && mape != null ? round3(mape) : null,
    nse: publish && nse != null ? round3(nse) : null,
    intervalCoverage: publish && coverage != null ? round3(coverage) : null,
  };
}

/**
 * Full validation report for a chainage.
 * Authoritative skill requires gauge OBSERVED pairs; modelled hydrograph is proxy-only.
 */
export async function getForecastValidationReport(chainage_m = 8790) {
  const gaugePairs = await buildGaugeValidationPairs(chainage_m);
  const modelledPairs = await buildValidationPairs(chainage_m, {
    observationClass: "MODELLED",
  });
  const byBucket = {};
  for (const b of ["0-6h", "6-24h", "24-48h", "48-72h"]) {
    byBucket[b] = metricsFromPairs(
      gaugePairs.filter((p) => p.bucket === b),
      { authoritative: true },
    );
  }
  const byStation = {
    [String(chainage_m)]: metricsFromPairs(gaugePairs, { authoritative: true }),
  };
  const times = [
    ...gaugePairs.map((p) => p.validTime),
    ...modelledPairs.map((p) => p.validTime),
  ].filter(Boolean).sort();
  return {
    chainage_m,
    archiveSize: _archive.length,
    pairs: gaugePairs.length,
    modelledProxyPairs: modelledPairs.length,
    overall: metricsFromPairs(gaugePairs, { authoritative: true }),
    modelledProxy: metricsFromPairs(modelledPairs, { authoritative: false }),
    byBucket,
    byStation,
    evaluationPeriod:
      times.length >= 2
        ? { start: times[0], end: times[times.length - 1] }
        : null,
    status:
      gaugePairs.length >= MIN_SAMPLES
        ? "METRICS_AVAILABLE"
        : "INSUFFICIENT OBSERVATION DATA",
    methodology:
      "Authoritative validation matches archived NadiTwin forecasts to gauge OBSERVED discharge at the same station within ±45 min of valid time. NadiTwin hydrograph series is MODELLED and used only as a non-authoritative proxy. Invalid P10>P90 snapshots rejected. Metrics withheld unless n ≥ 8 gauge pairs.",
    disclaimer:
      "Do not treat forecast availability as forecast verification. No fabricated accuracy. NSE reported only when variance of observations is positive.",
  };
}

export function getForecastArchiveSize() {
  return _archive.length;
}

export function clearForecastArchive() {
  _archive = [];
  persist();
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}
