/**
 * NadiTwin-matching historical presets for the three-graph Charts view.
 * Built from /api/timerange coverage — no invented ranges.
 */

export const LOOKBACK_PRESETS = [
  { id: "72h", label: "Past 72 hours + 72 h forecast", hours: 72 },
  { id: "7d", label: "Past 7 days + 72 h forecast", hours: 168 },
  { id: "30d", label: "Past 30 days + 72 h forecast", hours: 720 },
  { id: "90d", label: "Past 90 days + 72 h forecast", hours: 2160 },
  { id: "1y", label: "Past 1 year + 72 h forecast", hours: 8760 },
  { id: "all", label: "All available history", hours: 100000 },
];

/** @deprecated keep alias for older imports */
export const HIST_PRESETS = LOOKBACK_PRESETS;

export function parseCoverage(meta) {
  if (!meta?.ok && !meta?.epoch_date && !meta?.today_date) {
    return { ok: false, earliest: null, latest: null, earliestMs: null, latestMs: null, years: [] };
  }
  const earliest = meta.epoch_date || null;
  const latest = meta.today_date || null;
  const earliestMs = earliest ? Date.parse(`${earliest}T00:00:00Z`) : null;
  const latestMs = latest ? Date.parse(`${latest}T23:59:59Z`) : null;
  const y0 = earliest ? Number(earliest.slice(0, 4)) : null;
  const y1 = latest ? Number(latest.slice(0, 4)) : null;
  const years = [];
  if (Number.isFinite(y0) && Number.isFinite(y1)) {
    for (let y = y0; y <= y1; y++) years.push(y);
  }
  return {
    ok: Number.isFinite(earliestMs) && Number.isFinite(latestMs),
    earliest,
    latest,
    earliestMs,
    latestMs,
    todayHour: meta.today_hour,
    nowIso: meta.now_iso,
    updatedAt: meta.updatedAt,
    years,
  };
}

export function coverageMaxHours(coverage) {
  if (!coverage?.earliestMs || !coverage?.latestMs) return null;
  return Math.max(0, (coverage.latestMs - coverage.earliestMs) / 3_600_000);
}

export function buildHistOptions(coverage) {
  const maxH = coverageMaxHours(coverage);
  const opts = LOOKBACK_PRESETS.map((p) => {
    const available = !Number.isFinite(maxH) || p.id === "all" || maxH >= Math.min(p.hours, 24) * 0.5;
    return {
      value: p.id,
      label: available ? p.label : `${p.label} (unavailable)`,
      disabled: !available,
      hours: p.hours,
      year: null,
    };
  });
  // Individual calendar years from timerange (NadiTwin parity)
  for (const y of coverage.years || []) {
    const isCurrent = coverage.latest && String(y) === String(coverage.latest).slice(0, 4);
    opts.push({
      value: `year:${y}`,
      label: isCurrent
        ? `${y} (current year to latest + forecast)`
        : `Year ${y}`,
      disabled: false,
      hours: null,
      year: y,
    });
  }
  return opts;
}

export function resolveHistSelection(value, coverage) {
  if (String(value).startsWith("year:")) {
    const year = Number(String(value).slice(5));
    return {
      id: value,
      year,
      hours: null,
      label: `Year ${year}`,
    };
  }
  const p = LOOKBACK_PRESETS.find((x) => x.id === value) || LOOKBACK_PRESETS[0];
  let hours = p.hours;
  if (p.id === "all") {
    const maxH = coverageMaxHours(coverage);
    hours = Number.isFinite(maxH) ? Math.max(24, Math.ceil(maxH)) : 100000;
  } else {
    const maxH = coverageMaxHours(coverage);
    if (Number.isFinite(maxH) && hours > maxH) hours = Math.ceil(maxH);
  }
  return { id: p.id, year: null, hours, label: p.label };
}

export function formatSelectedPeriod(sel, coverage) {
  if (sel?.year != null) {
    if (coverage?.latest && String(sel.year) === String(coverage.latest).slice(0, 4)) {
      return `${sel.year}-01-01 → ${coverage.latest} (+ forecast)`;
    }
    return `${sel.year}-01-01 → ${sel.year}-12-31`;
  }
  return sel?.label || "—";
}

/** Kept for compatibility with earlier category UI (unused in three-graph mode). */
export const CHART_CATEGORIES = [];
export function hoursForPreset(presetId, coverage) {
  return resolveHistSelection(presetId, coverage).hours;
}
export function isPresetAvailable() { return true; }
export function resolveCustomRange() {
  return { ok: false, error: "Use NadiTwin year / lookback presets" };
}
