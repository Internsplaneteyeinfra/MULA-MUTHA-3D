/**
 * Validation + formatting for flood UI fields. Every formatter returns `null`
 * when the value is unavailable so callers can omit the field entirely.
 * Zero is a valid measurement and is always kept.
 */

/** Finite number (accepts numeric strings from JSON); null/""/NaN/±Infinity → null. */
export function validNumber(v) {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Real calendar date in YYYY-MM-DD (rejects 2026-02-30 etc.). */
export function validYmd(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? v : null;
}

/** Valid timestamp (ISO string, epoch ms, or Date). */
export function validTimestamp(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function validText(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && !/^(null|undefined|n\/a|nan)$/i.test(s) ? s : null;
}

export function fmtHa(v) {
  const n = validNumber(v);
  return n == null ? null : `${n.toFixed(2)} ha`;
}

export function fmtMeters(v) {
  const n = validNumber(v);
  return n == null ? null : `${n.toFixed(2)} m`;
}

/** Signed rise from millimetres: `0 mm`, `+120 mm`, `+1.25 m`, `−40 mm`. */
export function fmtRiseMm(v) {
  const mm = validNumber(v);
  if (mm == null) return null;
  const sign = mm > 0 ? "+" : mm < 0 ? "−" : "";
  const a = Math.abs(mm);
  return a >= 1000 ? `${sign}${(a / 1000).toFixed(2)} m` : `${sign}${Math.round(a)} mm`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `25 Sep 2026` (or `25 Sep` without year); null for invalid dates. */
export function fmtYmd(v, withYear = true) {
  const ymd = validYmd(v);
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  return withYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

export function fmtTimestamp(v) {
  const d = validTimestamp(v);
  return d
    ? d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
}

/** Join only non-empty string parts (drops false/0/null from `cond && "text"` items). */
export function joinValid(parts, sep = " · ") {
  return parts.filter((p) => typeof p === "string" && p.trim() !== "").join(sep);
}
