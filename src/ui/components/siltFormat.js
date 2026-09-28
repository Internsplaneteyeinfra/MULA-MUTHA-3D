/** Display formatting for Silt Area Analysis. Missing values render as "—"; numeric 0 is real data. */

export const SILT_DASH = "—";

const MISSING_STRINGS = new Set(["", "null", "undefined", "nan", "infinity", "-infinity", "[object object]"]);

export function isMissingSiltValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string") return MISSING_STRINGS.has(value.trim().toLowerCase());
  return typeof value !== "boolean";
}

export function escapeSiltHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

/**
 * HTML-safe display string. `digits` fixes decimals for numbers; `unit` is appended verbatim
 * (include a leading space where needed, e.g. " m²" vs "%"). Missing values never get the unit.
 */
export function formatSiltValue(value, { digits, unit = "", fallback = SILT_DASH } = {}) {
  if (isMissingSiltValue(value)) return fallback;
  if (typeof value === "number") {
    const text =
      digits == null
        ? value.toLocaleString("en-IN")
        : value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return `${text}${unit}`;
  }
  return `${escapeSiltHtml(value)}${unit}`;
}

export function formatSiltArea(m2, compact = false) {
  if (isMissingSiltValue(m2)) return SILT_DASH;
  const area = formatSiltValue(m2, { digits: 0, unit: " m²" });
  return compact ? area : `${area} · ${formatSiltValue(m2 / 10000, { digits: 2, unit: " ha" })}`;
}

export function formatSiltLatLon(lat, lon) {
  if (isMissingSiltValue(lat) || isMissingSiltValue(lon)) return SILT_DASH;
  return `${formatSiltValue(lat, { digits: 6 })}, ${formatSiltValue(lon, { digits: 6 })}`;
}
