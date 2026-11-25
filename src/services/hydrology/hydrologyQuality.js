/**
 * Data-quality classifications and freshness rules for River.EYE hydrology.
 * Source-specific freshness — not one global threshold.
 */

export const QUALITY = Object.freeze({
  OBSERVED: "OBSERVED",
  LIVE: "LIVE",
  STALE: "STALE",
  MODELLED: "MODELLED",
  FORECAST: "FORECAST",
  DERIVED: "DERIVED",
  INTERPOLATED: "INTERPOLATED",
  UNAVAILABLE: "UNAVAILABLE",
});

/** Freshness windows by source family (ms). */
export const FRESHNESS_MS = Object.freeze({
  NADITWIN_LIVE: 20 * 60 * 1000,
  NADITWIN_FORECAST: 3 * 60 * 60 * 1000,
  NADITWIN_HYDROGRAPH: 2 * 60 * 60 * 1000,
  GLOFAS_DAILY: 36 * 60 * 60 * 1000,
  OPEN_METEO_WEATHER: 30 * 60 * 1000,
  SURVEY_STATIC: Infinity,
  SYNTHETIC: 0,
});

/**
 * @param {object} opts
 * @param {number|null|undefined} opts.value
 * @param {string} opts.unit
 * @param {string} opts.source
 * @param {string|null} opts.timestamp
 * @param {string} opts.provenance — QUALITY value
 * @param {number|null} [opts.chainage_m]
 * @param {string|null} [opts.station]
 * @param {string} [opts.freshnessKey] — key into FRESHNESS_MS
 * @param {string} [opts.note]
 */
export function makeMeasurement({
  value,
  unit,
  source,
  timestamp,
  provenance,
  chainage_m = null,
  station = null,
  freshnessKey = "NADITWIN_LIVE",
  note = "",
}) {
  const num = Number(value);
  const hasValue = Number.isFinite(num);
  const freshness = assessFreshness(timestamp, freshnessKey);
  let quality = provenance || QUALITY.UNAVAILABLE;
  if (!hasValue) quality = QUALITY.UNAVAILABLE;
  else if (quality === QUALITY.LIVE && freshness.stale) quality = QUALITY.STALE;

  return {
    value: hasValue ? num : null,
    unit: unit || "",
    source: source || "UNKNOWN",
    timestamp: timestamp || null,
    provenance: quality,
    quality,
    chainage_m: Number.isFinite(Number(chainage_m)) ? Number(chainage_m) : null,
    station: station || null,
    freshness,
    note: note || "",
    display: hasValue ? num : null,
  };
}

export function assessFreshness(isoTimestamp, freshnessKey = "NADITWIN_LIVE") {
  const maxAge = FRESHNESS_MS[freshnessKey] ?? FRESHNESS_MS.NADITWIN_LIVE;
  if (maxAge === Infinity) {
    return { stale: false, ageMs: null, label: "static", limitMs: maxAge };
  }
  if (!isoTimestamp) {
    return { stale: true, ageMs: null, label: "missing timestamp", limitMs: maxAge };
  }
  const t = Date.parse(isoTimestamp);
  if (!Number.isFinite(t)) {
    return { stale: true, ageMs: null, label: "invalid timestamp", limitMs: maxAge };
  }
  const ageMs = Date.now() - t;
  const stale = ageMs < 0 || ageMs > maxAge;
  const mins = Math.round(Math.abs(ageMs) / 60000);
  return {
    stale,
    ageMs,
    label: stale ? `STALE · ${mins} min` : `${mins} min ago`,
    limitMs: maxAge,
  };
}

/**
 * Validate forecast uncertainty band.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateForecastInterval(p10, p50, p90) {
  const a = Number(p10);
  const b = Number(p50);
  const c = Number(p90);
  if (![a, b, c].every(Number.isFinite)) {
    return { ok: false, reason: "incomplete P10/P50/P90" };
  }
  if (a > c) return { ok: false, reason: "P10 > P90 — invalid interval" };
  if (b < a || b > c) return { ok: false, reason: "P50 outside P10–P90" };
  return { ok: true };
}

/**
 * Run structural checks on a chainage-aligned array.
 */
export function auditSeries(series, { stepM = 10, name = "series" } = {}) {
  const issues = [];
  if (!Array.isArray(series) || !series.length) {
    issues.push({ code: "EMPTY", message: `${name} empty` });
    return { ok: false, issues };
  }
  let missing = 0;
  let dupTs = 0;
  const seen = new Set();
  for (let i = 0; i < series.length; i += 1) {
    const row = series[i];
    const v = typeof row === "object" ? Number(row?.value) : Number(row);
    if (!Number.isFinite(v)) missing += 1;
    if (typeof row === "object" && row?.timestamp) {
      if (seen.has(row.timestamp)) dupTs += 1;
      seen.add(row.timestamp);
    }
    if (typeof row === "object" && row?.chainage_m != null) {
      const ch = Number(row.chainage_m);
      if (!Number.isFinite(ch) || ch < -50) {
        issues.push({ code: "BAD_CHAINAGE", message: `${name}[${i}] invalid chainage` });
      }
    }
  }
  if (missing) issues.push({ code: "MISSING_VALUES", message: `${name}: ${missing} missing` });
  if (dupTs) issues.push({ code: "DUP_TIMESTAMP", message: `${name}: ${dupTs} duplicate timestamps` });
  if (stepM > 0 && series.length > 2 && typeof series[0] === "object") {
    let disorder = 0;
    for (let i = 1; i < series.length; i += 1) {
      const a = Number(series[i - 1]?.chainage_m);
      const b = Number(series[i]?.chainage_m);
      if (Number.isFinite(a) && Number.isFinite(b) && b < a) disorder += 1;
    }
    if (disorder) issues.push({ code: "CHAINAGE_ORDER", message: `${name}: ${disorder} out-of-order` });
  }
  return { ok: issues.length === 0, issues, missing, n: series.length };
}

export function naDisplay(measurement) {
  if (!measurement || measurement.value == null || !Number.isFinite(measurement.value)) return "N/A";
  return measurement.value;
}
