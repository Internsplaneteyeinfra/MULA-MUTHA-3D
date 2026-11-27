import { SILT_CLASS_PERIODS } from "../../data/siltPeriods.generated.js";
import { summarizeSiltPolygon } from "../../scene/siltAreaAnalysis.js";

const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CLASS_COLORS = ["#0D5C2E", "#6B7A00", "#C2410C", "#991B1B"];
let focusMonth = 11;

let selectedYear = null;
let cacheKey = "";
let byId = null;
let loadToken = 0;
let slots = [];
let tip = null;
let bound = false;

function fmtM3(n) {
  if (n == null || !Number.isFinite(n)) return "N/A";
  return Math.round(n).toLocaleString("en-IN") + " m³";
}

function fmtM2(n) {
  if (n == null || !Number.isFinite(n)) return "N/A";
  return Math.round(n).toLocaleString("en-IN") + " m²";
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return "N/A";
  return n.toFixed(1) + "%";
}

function fmtSigned(n, digits, suffix) {
  if (n == null || !Number.isFinite(n)) return "N/A";
  const sign = n > 0 ? "+" : "";
  const body = digits === 0 ? Math.round(n).toLocaleString("en-IN") : n.toFixed(digits);
  return sign + body + suffix;
}

function deltaKind(n) {
  if (n == null || !Number.isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function arrow(n) {
  if (n == null || !Number.isFinite(n) || n === 0) return "–";
  return n > 0 ? "▲" : "▼";
}

function volumeChange(curr, prev) {
  if (!curr || !prev || curr.volumeM3 == null || prev.volumeM3 == null) return { diff: null, pct: null };
  const diff = curr.volumeM3 - prev.volumeM3;
  const pct = prev.volumeM3 === 0 ? null : (diff / prev.volumeM3) * 100;
  return { diff, pct };
}

function coverageChange(curr, prev) {
  if (!curr || !prev || curr.coveragePct == null || prev.coveragePct == null) return null;
  return curr.coveragePct - prev.coveragePct;
}

function ensureBound() {
  if (bound) return;
  const root = document.getElementById("silt-pro-dashboard");
  if (!root) return;
  bound = true;
  root.addEventListener("click", (event) => {
    const yearBtn = event.target.closest(".silt-year-btn");
    if (yearBtn) {
      event.stopPropagation();
      pausePlayback();
      chooseYear(Number(yearBtn.dataset.year));
      return;
    }
    const monthBtn = event.target.closest(".silt-month-btn");
    if (monthBtn) {
      event.stopPropagation();
      if (monthBtn.disabled) return;
      pausePlayback();
      chooseMonth(Number(monthBtn.dataset.month));
      return;
    }
    const playBtn = event.target.closest("[data-silt-play]");
    if (playBtn) {
      event.stopPropagation();
      const cmd = playBtn.dataset.siltPlay;
      if (cmd === "play") startPlayback();
      else if (cmd === "pause") pausePlayback();
      else if (cmd === "prev") { pausePlayback(); stepMonth(-1); }
      else if (cmd === "next") { pausePlayback(); stepMonth(1); }
      return;
    }
    const hit = event.target.closest("[data-hist-month]");
    if (!hit) return;
    event.stopPropagation();
    pausePlayback();
    chooseMonth(Number(hit.dataset.histMonth) + 1);
  });
  root.addEventListener("mousemove", (event) => {
    const hit = event.target.closest("[data-hist-month]");
    if (!hit || !tip) return;
    tip.showTT(event, tooltipHtml(Number(hit.dataset.histMonth)));
  });
  root.addEventListener("mouseleave", () => tip?.hideTT?.());
}

function renderChrome() {
  const year = selectedYear ?? 2026;
  const years = document.getElementById("silt-hist-years");
  if (years) {
    years.innerHTML = YEARS.map((y) =>
      `<button type="button" class="silt-year-btn${y === year ? " active" : ""}" data-year="${y}">${y}</button>`
    ).join("");
  }
  const months = document.getElementById("silt-hist-months");
  if (months) {
    months.innerHTML = MONTH_SHORT.map((name, i) => {
      const slot = slots[i];
      const on = i + 1 === focusMonth ? " active" : "";
      const off = slot && !slot.available ? " is-missing" : "";
      const disabled = byId && slot && !slot.available ? " disabled" : "";
      return `<button type="button" class="silt-month-btn${on}${off}" data-month="${i + 1}"${disabled}>${name}</button>`;
    }).join("");
  }
}

function showStatus(text) {
  const el = document.getElementById("silt-hist-status");
  if (el) el.textContent = text;
}

function slotFromRow(year, month, row) {
  const id = `${year}-${String(month).padStart(2, "0")}`;
  const section = row?.available ? row.polygon : null;
  if (!row?.available || !section || section.coveragePct == null) {
    return {
      month,
      year,
      id,
      available: false,
      provenance: row?.reason || "No stored raster for this month",
    };
  }
  return {
    month,
    year,
    id,
    available: true,
    areaM2: section.areaM2,
    coveredM2: section.coveredM2,
    coveragePct: section.coveragePct,
    volumeM3: section.volumeM3,
    validCells: section.validCells,
    dominant: section.dominant,
    classes: section.classes,
    provenance: row.provenance,
  };
}

function buildSlots(year) {
  const next = [];
  for (let month = 1; month <= 12; month++) {
    next.push(slotFromRow(year, month, byId?.get(`${year}-${String(month).padStart(2, "0")}`)));
  }
  return next;
}

/** Earlier stored month in this year, otherwise the last stored month of the previous year. */
function previousAvailable(year, month) {
  if (!byId) return null;
  let y = year;
  let m = month;
  while (y >= YEARS[0]) {
    m -= 1;
    if (m < 1) {
      y -= 1;
      m = 12;
    }
    if (y < YEARS[0]) return null;
    const slot = slotFromRow(y, m, byId.get(`${y}-${String(m).padStart(2, "0")}`));
    if (slot.available) return slot;
  }
  return null;
}

function axisMax(values) {
  let max = 0;
  for (const value of values) if (value != null && value > max) max = value;
  if (max <= 0) return 1;
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  return Math.ceil((max * 1.08) / step) * step;
}

function chartSvg(yLabel, ticks, body, aria) {
  const w = 520;
  const h = 188;
  const left = 58;
  const right = 10;
  const top = 8;
  const bottom = 34;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const lines = ticks.map((tick) => {
    const y = top + plotH - (tick.t * plotH);
    return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${w - right}" y2="${y.toFixed(1)}" class="silt-hist-gridline"/>` +
      `<text x="${left - 6}" y="${(y + 3).toFixed(1)}" class="silt-hist-tick" text-anchor="end">${tick.label}</text>`;
  }).join("");
  const labels = MONTH_SHORT.map((name, i) => {
    const x = left + ((i + 0.5) * plotW) / 12;
    return `<text x="${x.toFixed(1)}" y="${h - 16}" class="silt-hist-tick" text-anchor="middle">${name}</text>`;
  }).join("");
  const hits = MONTH_SHORT.map((_, i) => {
    const x = left + (i * plotW) / 12;
    return `<rect x="${x.toFixed(1)}" y="${top}" width="${(plotW / 12).toFixed(1)}" height="${plotH}" class="silt-hist-hit" data-hist-month="${i}"/>`;
  }).join("");
  return `<svg class="silt-hist-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${aria}">` +
    `<text x="16" y="${top + plotH / 2}" class="silt-hist-ylabel" transform="rotate(-90 16 ${top + plotH / 2})">${yLabel}</text>` +
    lines + body(left, top, plotW, plotH) + labels +
    `<text x="${(left + plotW / 2).toFixed(1)}" y="${h - 3}" class="silt-hist-axis" text-anchor="middle">Month</text>` +
    hits + `</svg>`;
}

function volumeBody(left, top, plotW, plotH) {
  const max = axisMax(slots.map((slot) => (slot.available ? slot.volumeM3 : null)));
  const finite = slots.filter((slot) => slot.available && slot.volumeM3 != null).map((slot) => slot.volumeM3);
  const hi = finite.length ? Math.max(...finite) : null;
  const lo = finite.length ? Math.min(...finite) : null;
  const markEnds = hi != null && lo != null && hi !== lo;
  return slots.map((slot, i) => {
    const x = left + (i * plotW) / 12;
    const colW = plotW / 12;
    if (!slot.available || slot.volumeM3 == null) {
      const mark = slot.month === focusMonth ? " is-selected" : "";
      return `<rect x="${(x + 2).toFixed(1)}" y="${top}" width="${(colW - 4).toFixed(1)}" height="${plotH}" class="silt-hist-gap${mark}"/>`;
    }
    const selected = slot.month === focusMonth ? " is-selected" : "";
    const h = Math.max(1, (slot.volumeM3 / max) * plotH);
    const y = top + plotH - h;
    const role = markEnds && slot.volumeM3 === hi ? " is-high" : markEnds && slot.volumeM3 === lo ? " is-low" : "";
    return `<rect class="silt-hist-bar${role}${selected}" x="${(x + colW * 0.18).toFixed(1)}" y="${y.toFixed(1)}" width="${(colW * 0.64).toFixed(1)}" height="${h.toFixed(1)}"/>`;
  }).join("");
}

function coverageBody(left, top, plotW, plotH) {
  return slots.map((slot, i) => {
    const x = left + (i * plotW) / 12;
    const colW = plotW / 12;
    if (!slot.available || slot.coveragePct == null) {
      return `<rect x="${(x + 2).toFixed(1)}" y="${top}" width="${(colW - 4).toFixed(1)}" height="${plotH}" class="silt-hist-gap"/>`;
    }
    const h = Math.max(1, (Math.max(0, Math.min(100, slot.coveragePct)) / 100) * plotH);
    const y = top + plotH - h;
    return `<rect class="silt-hist-bar" x="${(x + colW * 0.18).toFixed(1)}" y="${y.toFixed(1)}" width="${(colW * 0.64).toFixed(1)}" height="${h.toFixed(1)}"/>`;
  }).join("");
}

function classBody(left, top, plotW, plotH) {
  return slots.map((slot, i) => {
    const x = left + (i * plotW) / 12;
    const colW = plotW / 12;
    if (!slot.available || !slot.classes || slot.classes.some((item) => item.pct == null)) {
      return `<rect x="${(x + 2).toFixed(1)}" y="${top}" width="${(colW - 4).toFixed(1)}" height="${plotH}" class="silt-hist-gap"/>`;
    }
    let y = top + plotH;
    const bars = slot.classes.map((item, classIndex) => {
      const h = ((item.pct || 0) / 100) * plotH;
      y -= h;
      if (h <= 0) return "";
      return `<rect x="${(x + colW * 0.18).toFixed(1)}" y="${y.toFixed(1)}" width="${(colW * 0.64).toFixed(1)}" height="${Math.max(h, 0.5).toFixed(1)}" fill="${CLASS_COLORS[classIndex]}"/>`;
    }).join("");
    const mark = slot.month === focusMonth
      ? `<rect class="silt-hist-select" x="${(x + colW * 0.18).toFixed(1)}" y="${top}" width="${(colW * 0.64).toFixed(1)}" height="${plotH}"/>`
      : "";
    return bars + mark;
  }).join("");
}

function tooltipHtml(monthIndex) {
  const slot = slots[monthIndex];
  const when = `${MONTH_FULL[monthIndex]} ${selectedYear}`;
  if (!slot?.available) {
    return `<div class="silt-tt-row"><span>Month</span><b>${when}</b></div>` +
      `<div class="silt-tt-row"><span>Silt volume</span><b>N/A</b></div>` +
      `<div class="silt-tt-row"><span>Silt coverage</span><b>N/A</b></div>` +
      `<div class="silt-tt-row"><span>Covered area</span><b>N/A</b></div>` +
      `<div class="silt-tt-row"><span>Polygon area</span><b>N/A</b></div>` +
      `<div class="silt-tt-row"><span>Classification</span><b>N/A</b></div>` +
      `<div class="silt-tt-row"><span>Previous volume month</span><b>N/A</b></div>` +
      `<div class="silt-tt-row"><span>Volume change</span><b>N/A</b></div>`;
  }
  const prevVol = previousAvailable(selectedYear, slot.month);
  const vol = volumeChange(slot, prevVol);
  const volChange = vol.diff == null
    ? "N/A"
    : `${fmtSigned(vol.diff, 0, " m³")}${vol.pct == null ? "" : " (" + fmtSigned(vol.pct, 1, "%)") + ")"}`;
  return `<div class="silt-tt-row"><span>Month</span><b>${when}</b></div>` +
    `<div class="silt-tt-row"><span>Silt volume</span><b>${fmtM3(slot.volumeM3)}</b></div>` +
    `<div class="silt-tt-row"><span>Silt coverage</span><b>${fmtPct(slot.coveragePct)}</b></div>` +
    `<div class="silt-tt-row"><span>Covered area</span><b>${fmtM2(slot.coveredM2)}</b></div>` +
    `<div class="silt-tt-row"><span>Polygon area</span><b>${fmtM2(slot.areaM2)}</b></div>` +
    `<div class="silt-tt-row"><span>Classification</span><b>${slot.dominant || "N/A"}</b></div>` +
    `<div class="silt-tt-row"><span>Previous volume month</span><b>${prevVol ? `${MONTH_FULL[prevVol.month - 1]} ${prevVol.year}` : "N/A"}</b></div>` +
    `<div class="silt-tt-row"><span>Volume change</span><b>${volChange}</b></div>`;
}

function volumeTicks(max) {
  return [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    t,
    label: Math.round(max * t).toLocaleString("en-IN"),
  }));
}

function percentTicks() {
  return [0, 25, 50, 75, 100].map((n) => ({ t: n / 100, label: String(n) }));
}

function selectedSlot() {
  return slots[focusMonth - 1] || null;
}

function chooseYear(year) {
  selectedYear = year;
  if (byId) {
    slots = buildSlots(year);
    if (!slots[focusMonth - 1]?.available) {
      const fallback = [...slots].reverse().find((slot) => slot.available);
      if (fallback) focusMonth = fallback.month;
    }
  }
  paint();
}

function chooseMonth(month) {
  const slot = slots[month - 1];
  if (!slot?.available) return;
  focusMonth = month;
  paint();
}

function stepMonth(dir) {
  const months = slots.filter((slot) => slot.available).map((slot) => slot.month);
  const next = dir > 0
    ? months.find((month) => month > focusMonth)
    : [...months].reverse().find((month) => month < focusMonth);
  if (next) {
    chooseMonth(next);
    return true;
  }
  const year = selectedYear ?? 2026;
  const other = dir > 0 ? year + 1 : year - 1;
  if (!byId || !YEARS.includes(other)) return false;
  const otherSlots = buildSlots(other);
  const edge = dir > 0
    ? otherSlots.find((slot) => slot.available)
    : [...otherSlots].reverse().find((slot) => slot.available);
  if (!edge) return false;
  selectedYear = other;
  slots = otherSlots;
  focusMonth = edge.month;
  paint();
  return true;
}

let playing = false;
let playTimer = 0;

function pausePlayback() {
  playing = false;
  clearTimeout(playTimer);
  document.querySelector("[data-silt-play='play']")?.classList.remove("is-on");
}

function startPlayback() {
  pausePlayback();
  playing = true;
  document.querySelector("[data-silt-play='play']")?.classList.add("is-on");
  const tick = () => {
    if (!playing) return;
    if (!stepMonth(1)) {
      pausePlayback();
      return;
    }
    const speed = Number(document.getElementById("silt-play-speed")?.value) || 900;
    playTimer = setTimeout(tick, speed);
  };
  const speed = Number(document.getElementById("silt-play-speed")?.value) || 900;
  playTimer = setTimeout(tick, speed);
}

function sync3d() {
  const slot = selectedSlot();
  if (!slot?.available) return;
  window.__MM_SCENE__?.setSiltAnalysisPeriod?.(slot.id);
}

function classAt(slot, index) {
  return slot?.classes?.[index] || null;
}

function summaryHtml() {
  const slot = selectedSlot();
  const area = slot?.areaM2 ?? slots.find((item) => item.available)?.areaM2;
  const ha = Number.isFinite(area) ? (area / 10000).toFixed(2) + " ha" : "N/A";
  const when = slot?.available ? `${MONTH_FULL[slot.month - 1]} ${selectedYear}` : `${MONTH_FULL[focusMonth - 1]} ${selectedYear ?? ""}`.trim();
  const obs = slot?.available && slot.validCells != null ? Number(slot.validCells).toLocaleString("en-IN") : "N/A";
  return `<div><span>Polygon</span><b>${fmtM2(area)}</b><em>${ha}</em></div>` +
    `<div><span>Silt volume</span><b>${slot?.available ? fmtM3(slot.volumeM3) : "N/A"}</b></div>` +
    `<div><span>Coverage</span><b>${slot?.available ? fmtPct(slot.coveragePct) : "N/A"}</b></div>` +
    `<div><span>Observations</span><b>${obs}</b></div>` +
    `<div><span>Selected</span><b>${when}</b></div>`;
}

function compareHtml() {
  const current = selectedSlot();
  if (!current?.available) {
    return `<p class="silt-compare-note">${MONTH_FULL[focusMonth - 1]} ${selectedYear} has no stored raster. Missing months are not filled.</p>`;
  }
  const prev = previousAvailable(selectedYear, current.month);
  const vol = volumeChange(current, prev);
  const cov = coverageChange(current, prev);
  const prevName = prev ? `${MONTH_FULL[prev.month - 1]} ${prev.year}` : "N/A";
  const card = (label, value, kind) =>
    `<div class="silt-compare-card is-${kind}"><span>${label}</span><b>${value}</b></div>`;
  const classCards = [0, 1, 2, 3].map((index) => {
    const name = current.classes?.[index]?.label || ["Low", "Moderate", "High", "Very High"][index];
    const now = classAt(current, index)?.areaM2;
    const before = classAt(prev, index)?.areaM2;
    const diff = now != null && before != null ? now - before : null;
    return card(name + " area change", diff == null ? "N/A" : `${arrow(diff)} ${fmtSigned(diff, 0, " m²")}`, deltaKind(diff));
  }).join("");
  return `<p class="silt-compare-note">Compared with the previous available month${prev ? ": " + prevName : ""}.</p>` +
    card("Previous volume", fmtM3(prev?.volumeM3), "flat") +
    card("Selected volume", fmtM3(current.volumeM3), "flat") +
    card("Volume change", vol.diff == null ? "N/A" : `${arrow(vol.diff)} ${fmtSigned(vol.diff, 0, " m³")}`, deltaKind(vol.diff)) +
    card("Volume change %", vol.pct == null ? "N/A" : `${arrow(vol.pct)} ${fmtSigned(vol.pct, 1, "%")}`, deltaKind(vol.pct)) +
    card("Previous coverage", fmtPct(prev?.coveragePct), "flat") +
    card("Selected coverage", fmtPct(current.coveragePct), "flat") +
    card("Coverage difference", cov == null ? "N/A" : `${arrow(cov)} ${fmtSigned(cov, 1, " pp")}`, deltaKind(cov)) +
    classCards;
}

function paint() {
  if (byId) slots = buildSlots(selectedYear ?? 2026);
  renderChrome();
  const summary = document.getElementById("silt-summary");
  const compare = document.getElementById("silt-compare");
  if (summary) summary.innerHTML = summaryHtml();
  if (compare) compare.innerHTML = compareHtml();
  const volume = document.getElementById("silt-month-volume");
  const klass = document.getElementById("silt-month-class");
  if (!volume || !klass || !byId) return;
  const volumeMax = axisMax(slots.map((slot) => (slot.available ? slot.volumeM3 : null)));
  volume.innerHTML = chartSvg("Silt Volume (m³)", volumeTicks(volumeMax), volumeBody, "Monthly silt volume");
  klass.innerHTML = chartSvg("Classified Area (%)", percentTicks(), classBody, "Monthly silt classification");
  sync3d();
}

function showLoading(done, total, clear) {
  renderChrome();
  showStatus("");
  if (!clear) return;
  const volume = document.getElementById("silt-month-volume");
  const klass = document.getElementById("silt-month-class");
  if (volume) volume.innerHTML = "";
  if (klass) klass.innerHTML = "";
}

/**
 * @param {{x:number,z:number}[]} points
 * @param {number} edge
 * @param {{showTT:Function, moveTT:Function, hideTT:Function}} tooltip
 */
export function updateHistoricalSilt(points, _edge, tooltip, periodId) {
  tip = tooltip;
  ensureBound();
  if (typeof periodId === "string" && periodId.length >= 7) {
    const month = Number(periodId.slice(5, 7));
    const year = Number(periodId.slice(0, 4));
    if (month >= 1 && month <= 12) focusMonth = month;
    if (selectedYear == null && year >= 2021 && year <= 2026) selectedYear = year;
  }
  renderChrome();
  const key = (points || []).map((p) => `${Number(p.x).toFixed(1)},${Number(p.z).toFixed(1)}`).join("|");
  if (!points || points.length < 3) {
    byId = null;
    cacheKey = "";
    showStatus("Select four points to read historical silt.");
    return;
  }
  if (key === cacheKey && byId) {
    paint();
    return;
  }
  if (key === cacheKey) return;
  cacheKey = key;
  byId = null;
  const token = ++loadToken;
  const source = points.map((p) => ({ x: p.x, z: p.z }));
  showLoading(0, SILT_CLASS_PERIODS.length, true);
  (async () => {
    const rows = [];
    for (let i = 0; i < SILT_CLASS_PERIODS.length; i++) {
      if (token !== loadToken) return;
      const period = SILT_CLASS_PERIODS[i];
      rows.push([period.id, await summarizeSiltPolygon(source, period.id)]);
      showLoading(i + 1, SILT_CLASS_PERIODS.length, false);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (token !== loadToken) return;
    byId = new Map(rows);
    if (selectedYear == null) selectedYear = 2026;
    paint();
  })().catch((err) => {
    if (token !== loadToken) return;
    console.warn("[silt-history]", err);
    showStatus("Historical rasters could not be read.");
  });
}
