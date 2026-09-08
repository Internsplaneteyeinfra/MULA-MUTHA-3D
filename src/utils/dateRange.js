/**
 * Dynamic date helpers for JalNetra vegetation / satellite APIs.
 * Never hardcodes calendar years or months — always derived from `now`.
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Format a Date as YYYY-MM-DD (local calendar). */
export function formatApiDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Latest fully completed calendar month relative to runtime `now`.
 *
 * End date = last day of the previous month.
 * Start date = first day of that same previous month.
 *
 * Example: 2026-09-07 → start 2026-08-01, end 2026-08-31
 *
 * @param {Date} [now]
 * @returns {{ startDate: string, endDate: string, start_date: string, end_date: string }}
 */
export function getLatestCompletedMonthDateRange(now = new Date()) {
  // Day 0 of current month = last day of previous month
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  const startDate = formatApiDate(start);
  const endDate = formatApiDate(end);
  return {
    startDate,
    endDate,
    start_date: startDate,
    end_date: endDate,
  };
}

/**
 * Move `start_date` (YYYY-MM-DD) back by `monthsBack` months to the 1st.
 * Used when a single completed month has no Sentinel-2 coverage.
 */
export function widenStartDate(startDateYmd, monthsBack = 1) {
  const [y, m] = String(startDateYmd).split("-").map(Number);
  const d = new Date(y, m - 1 - monthsBack, 1);
  return formatApiDate(d);
}
