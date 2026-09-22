import { state } from "../../state.js";
import { enterMapFocus, exitMapFocus } from "../mapFocus.js";

/**
 * Land Use theme chrome:
 * - Top: class chips — coverage % on chip, class name on hover
 * - LULC / silt overlays: legend-only (no class click filter — one raster)
 * - Bottom: year / period stepper
 * - Back: exit land-use focus
 */

const LULC_CLASS_ORDER = [
  { key: "F", match: /forest/i, color: "#006400", label: "Forest" },
  { key: "C", match: /crop/i, color: "#E6A23C", label: "Cropland" },
  { key: "B", match: /barren/i, color: "#A9A9A9", label: "Barren Land" },
  { key: "S", match: /settle/i, color: "#C62828", label: "Settlements" },
  { key: "W", match: /water/i, color: "#2196F3", label: "Water Bodies" },
];

const VEG_TYPE_ORDER = [
  { key: "N", match: /non.?veg/i, color: "#A9A9A9", label: "Non-Vegetation" },
  { key: "T", match: /^trees/i, color: "#228B22", label: "Trees" },
  { key: "S", match: /shrub|scrub/i, color: "#9ACD32", label: "Shrub / Scrub" },
  { key: "G", match: /grass|herb/i, color: "#90EE90", label: "Grass / Herbaceous" },
  { key: "M", match: /mixed|diverse/i, color: "#8A2BE2", label: "Mixed / Diverse" },
];

const VEG_HEALTH_ORDER = [
  { key: "P", match: /poor|stress/i, color: "#C62828", label: "Stressed / Poor" },
  { key: "M", match: /moderate/i, color: "#F9A825", label: "Moderate" },
  { key: "H", match: /healthy|^good/i, color: "#2E7D32", label: "Healthy" },
  { key: "D", match: /dense|canopy/i, color: "#1B5E20", label: "Dense canopy" },
];

/** Layers that are a single draped raster — class chips are scale only. */
const LEGEND_ONLY_LAYER_IDS = new Set([
  "landuse_lulc",
  "silt_classification",
  "vegetation_extent",
  "vegetation_health",
]);

function classOrderForLayer(layerId) {
  if (layerId === "vegetation_extent") return VEG_TYPE_ORDER;
  if (layerId === "vegetation_health") return VEG_HEALTH_ORDER;
  return LULC_CLASS_ORDER;
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   onYearChange?: (year: number) => void|Promise<void>,
 *   onPeriodChange?: (periodId: string) => void|Promise<void>,
 *   onClear?: () => void,
 *   onBack?: () => void,
 * }} [hooks]
 */
export function mountLandUseThemeHud(root, hooks = {}) {
  const backEl = document.createElement("button");
  backEl.type = "button";
  backEl.className = "lu-theme-back map-chrome";
  backEl.id = "lu-theme-back";
  backEl.hidden = true;
  backEl.setAttribute("aria-label", "Back from land use");
  backEl.innerHTML = `<span class="lu-theme-back-arrow" aria-hidden="true">←</span><span>Back</span>`;
  root.appendChild(backEl);

  const classesEl = document.createElement("div");
  classesEl.className = "lu-theme-classes map-chrome";
  classesEl.id = "lu-theme-classes";
  classesEl.hidden = true;
  classesEl.setAttribute("role", "list");
  classesEl.setAttribute("aria-label", "Land cover classes");
  root.appendChild(classesEl);

  const yearEl = document.createElement("div");
  yearEl.className = "lu-theme-year map-chrome";
  yearEl.id = "lu-theme-year";
  yearEl.hidden = true;
  yearEl.setAttribute("role", "group");
  yearEl.setAttribute("aria-label", "Land use year");
  root.appendChild(yearEl);

  let mode = null;
  let years = [];
  let periods = [];
  let activeYear = null;
  let activePeriod = null;
  let busy = false;
  let classItems = [];
  let legendOnly = true;
  let activeLayerId = null;

  function enterFocusMode() {
    enterMapFocus(root, "landuse");
  }

  function exitFocusMode() {
    exitMapFocus(root, "landuse");
    root.classList.remove("lu-theme-classes-open", "lu-theme-year-open");
  }

  function letterForClass(c, order) {
    const label = String(c?.label || "");
    const hit = order.find((o) => o.match.test(label));
    if (hit) {
      return {
        ...hit,
        color: c?.color || hit.color,
        label: c?.label || hit.label,
        pct: c?.pct || null,
        range: c?.range || null,
      };
    }
    const first = label.trim().charAt(0).toUpperCase() || "?";
    return {
      key: first,
      color: c?.color || "#888",
      label,
      pct: c?.pct || null,
      range: c?.range || null,
    };
  }

  function scaleDisplayText(c) {
    const pct = String(c?.pct || "").trim();
    if (pct) return pct;
    const range = String(c?.range || "").trim();
    if (range) return range;
    const label = String(c?.label || "").trim();
    if (/^[<>~]?\d/.test(label) || /\d+\s*[–\-m%]/.test(label)) return label;
    return null;
  }

  function syncClassSelection() {
    if (legendOnly) {
      classesEl.querySelectorAll(".lu-theme-class").forEach((btn) => {
        btn.classList.remove("is-selected");
        btn.removeAttribute("aria-pressed");
      });
      classesEl.classList.remove("has-selection");
      return;
    }
    const sel = state.landUseSelectedClass;
    classesEl.querySelectorAll(".lu-theme-class").forEach((btn) => {
      const on = sel && btn.dataset.label === sel;
      btn.classList.toggle("is-selected", !!on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    classesEl.classList.toggle("has-selection", !!sel);
  }

  function renderClasses(classes, opts = {}) {
    const list = Array.isArray(classes) ? classes : [];
    legendOnly = opts.legendOnly !== false;
    activeLayerId = opts.layerId || activeLayerId || null;
    const order = classOrderForLayer(activeLayerId);

    if (!list.length) {
      classesEl.hidden = true;
      classesEl.innerHTML = "";
      classItems = [];
      classesEl.classList.remove("is-numeric-scale", "is-legend-only");
      root.classList.remove("lu-theme-classes-open");
      return;
    }

    const ordered = [];
    const used = new Set();
    for (const pref of order) {
      const found = list.find((c) => pref.match.test(String(c.label || "")));
      if (found) {
        ordered.push({
          ...pref,
          color: found.color || pref.color,
          label: found.label || pref.label,
          pct: found.pct || null,
          range: found.range || null,
        });
        used.add(found);
      }
    }
    for (const c of list) {
      if (used.has(c)) continue;
      ordered.push(letterForClass(c, order));
    }
    classItems = ordered;

    // Always treat as numeric scale when we show coverage / range under swatches
    const anyScale = ordered.some((c) => !!scaleDisplayText(c));
    classesEl.classList.toggle("is-numeric-scale", anyScale || legendOnly);
    classesEl.classList.toggle("is-legend-only", legendOnly);

    state.landUseSelectedClass = null;

    classesEl.innerHTML = ordered
      .map((c) => {
        const scaleText = scaleDisplayText(c) || "—";
        const tip = `${c.label} · ${scaleText}`;
        const tag = legendOnly ? "div" : "button";
        const interactiveAttrs = legendOnly
          ? `role="listitem" tabindex="0"`
          : `type="button" role="listitem" aria-pressed="false"`;
        return `
      <${tag} class="lu-theme-class is-numeric${legendOnly ? " is-legend-chip" : ""}"
        data-label="${escapeAttr(c.label)}"
        style="--lu-class-color:${escapeAttr(c.color)}"
        title="${escapeAttr(tip)}"
        aria-label="${escapeAttr(tip)}"
        ${interactiveAttrs}>
        <span class="lu-theme-class-letter" aria-hidden="true"></span>
        <span class="lu-theme-class-name">${escapeHtml(scaleText)}</span>
      </${tag}>`;
      })
      .join("");
    classesEl.hidden = false;
    root.classList.add("lu-theme-classes-open");

    if (!legendOnly) {
      classesEl.querySelectorAll(".lu-theme-class").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const label = btn.dataset.label;
          if (!label) return;
          if (state.landUseSelectedClass === label) {
            state.landUseSelectedClass = null;
          } else {
            state.landUseSelectedClass = label;
          }
          document.dispatchEvent(new CustomEvent("river-measure-clear"));
          syncClassSelection();
        });
      });
    }
    syncClassSelection();
  }

  function renderYearStepper() {
    if (mode === "year" && years.length) {
      const idx = Math.max(0, years.indexOf(Number(activeYear)));
      const cur = years[idx] ?? activeYear;
      const prev = idx > 0 ? years[idx - 1] : null;
      const next = idx >= 0 && idx < years.length - 1 ? years[idx + 1] : null;

      yearEl.classList.remove("is-period-only");
      yearEl.classList.add("is-period-nav");
      yearEl.innerHTML = `
        <button type="button" class="lu-theme-period-arrow is-prev" id="lu-year-prev"
          ${prev == null ? "disabled" : ""} data-year="${prev ?? ""}"
          aria-label="Previous year" title="Previous year">
          <span aria-hidden="true">←</span>
        </button>
        <div class="lu-theme-year-center">
          <span class="lu-theme-year-eyebrow">Year</span>
          <strong class="lu-theme-year-current">${cur ?? "—"}</strong>
        </div>
        <button type="button" class="lu-theme-period-arrow is-next" id="lu-year-next"
          ${next == null ? "disabled" : ""} data-year="${next ?? ""}"
          aria-label="Next year" title="Next year">
          <span aria-hidden="true">→</span>
        </button>
      `;
      yearEl.hidden = false;
      root.classList.add("lu-theme-year-open");
      bindYearButtons();
      return;
    }

    if (mode === "period" && periods.length) {
      const ids = periods.map((p) => (typeof p === "object" ? p.id : p));
      const idx = Math.max(0, ids.findIndex((id) => String(id) === String(activePeriod)));
      const cur = periods[idx] ?? periods[0];
      const curLabel = formatPeriodMonthYear(cur, activePeriod);
      const prevId = idx > 0 ? ids[idx - 1] : null;
      const nextId = idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null;

      yearEl.classList.remove("is-period-only");
      yearEl.classList.add("is-period-nav");
      yearEl.innerHTML = `
        <button type="button" class="lu-theme-period-arrow is-prev" id="lu-period-prev"
          ${prevId == null ? "disabled" : ""} data-period="${escapeAttr(prevId ?? "")}"
          aria-label="Previous period" title="Previous month">
          <span aria-hidden="true">←</span>
        </button>
        <div class="lu-theme-year-center">
          <span class="lu-theme-year-eyebrow">Period</span>
          <strong class="lu-theme-year-current">${escapeHtml(curLabel)}</strong>
        </div>
        <button type="button" class="lu-theme-period-arrow is-next" id="lu-period-next"
          ${nextId == null ? "disabled" : ""} data-period="${escapeAttr(nextId ?? "")}"
          aria-label="Next period" title="Next month">
          <span aria-hidden="true">→</span>
        </button>
      `;
      yearEl.hidden = false;
      root.classList.add("lu-theme-year-open");
      bindPeriodButtons();
      return;
    }

    yearEl.classList.remove("is-period-only", "is-period-nav");
    yearEl.hidden = true;
    yearEl.innerHTML = "";
    root.classList.remove("lu-theme-year-open");
  }

  function bindYearButtons() {
    yearEl.querySelector("#lu-year-prev")?.addEventListener("click", onYearClick);
    yearEl.querySelector("#lu-year-next")?.addEventListener("click", onYearClick);
  }

  function bindPeriodButtons() {
    yearEl.querySelector("#lu-period-prev")?.addEventListener("click", onPeriodClick);
    yearEl.querySelector("#lu-period-next")?.addEventListener("click", onPeriodClick);
  }

  async function onYearClick(e) {
    const year = Number(e.currentTarget?.dataset?.year);
    if (!Number.isFinite(year) || busy) return;
    busy = true;
    try {
      await hooks.onYearChange?.(year);
    } finally {
      busy = false;
    }
  }

  async function onPeriodClick(e) {
    const periodId = e.currentTarget?.dataset?.period;
    if (!periodId || busy) return;
    busy = true;
    try {
      await hooks.onPeriodChange?.(periodId);
    } finally {
      busy = false;
    }
  }

  function handleBack() {
    document.dispatchEvent(new CustomEvent("river-measure-clear"));
    state.landUseSelectedClass = null;
    syncClassSelection();
    exitFocusMode();
    hideChromeOnly();
    hooks.onBack?.();
  }

  backEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleBack();
  });

  function showFromLegend(legend) {
    if (!legend || legend.type !== "classes") {
      hide();
      return;
    }

    enterFocusMode();
    backEl.hidden = false;

    const layerId = String(legend.layerId || "");
    // Always legend-only — coverage % / names on hover; no class filter or selection
    renderClasses(legend.classes || [], { legendOnly: true, layerId });

    if (Array.isArray(legend.years) && legend.years.length) {
      mode = "year";
      years = legend.years.map(Number).filter(Number.isFinite);
      periods = [];
      activeYear = Number(legend.activeYear);
      activePeriod = null;
      renderYearStepper();
      return;
    }

    if (Array.isArray(legend.periods) && legend.periods.length) {
      mode = "period";
      periods = legend.periods;
      years = [];
      activePeriod = legend.activePeriod;
      activeYear = null;
      renderYearStepper();
      return;
    }

    mode = null;
    years = [];
    periods = [];
    renderYearStepper();
  }

  function hideChromeOnly() {
    mode = null;
    years = [];
    periods = [];
    activeYear = null;
    activePeriod = null;
    classItems = [];
    legendOnly = true;
    activeLayerId = null;
    classesEl.hidden = true;
    classesEl.innerHTML = "";
    classesEl.classList.remove("is-numeric-scale", "is-legend-only", "has-selection");
    yearEl.classList.remove("is-period-only", "is-period-nav");
    yearEl.hidden = true;
    yearEl.innerHTML = "";
    backEl.hidden = true;
    root.classList.remove("lu-theme-classes-open", "lu-theme-year-open");
  }

  function hide() {
    exitFocusMode();
    hideChromeOnly();
  }

  function updateYear(year) {
    if (!Number.isFinite(Number(year))) return;
    activeYear = Number(year);
    if (mode === "year") renderYearStepper();
  }

  function updatePeriod(periodId) {
    activePeriod = periodId;
    if (mode === "period") renderYearStepper();
  }

  return {
    classesEl,
    yearEl,
    backEl,
    showFromLegend,
    hide,
    updateYear,
    updatePeriod,
    isVisible: () => !classesEl.hidden || !yearEl.hidden,
  };
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Display "Jan 2026" from period object / id. */
function formatPeriodMonthYear(period, fallbackId) {
  if (period && typeof period === "object") {
    const year = Number(period.year);
    const month = Number(period.month);
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
      return `${MONTH_NAMES[month - 1]} ${year}`;
    }
    const fromId = parsePeriodId(period.id);
    if (fromId) return fromId;
    const label = String(period.label || "").trim();
    if (label && Number.isFinite(year)) return `${label} ${year}`;
    if (label) return label;
  }
  return parsePeriodId(period) || parsePeriodId(fallbackId) || String(fallbackId || period || "—");
}

function parsePeriodId(id) {
  const m = String(id || "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
