import { state } from "../../state.js";
import { enterMapFocus, exitMapFocus } from "../mapFocus.js";

/**
 * Land Use theme chrome:
 * - Top: class letter chips (F C B S W) — click to focus a class
 * - Bottom: year / period stepper
 * - Back: clear class focus, or exit land-use focus mode entirely
 */

const LULC_CLASS_ORDER = [
  { key: "F", match: /forest/i, color: "#006400", label: "Forest" },
  { key: "C", match: /crop/i, color: "#E6A23C", label: "Cropland" },
  { key: "B", match: /barren/i, color: "#A9A9A9", label: "Barren Land" },
  { key: "S", match: /settle/i, color: "#C62828", label: "Settlements" },
  { key: "W", match: /water/i, color: "#2196F3", label: "Water Bodies" },
];

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

  function enterFocusMode() {
    enterMapFocus(root, "landuse");
  }

  function exitFocusMode() {
    exitMapFocus(root, "landuse");
    root.classList.remove("lu-theme-classes-open", "lu-theme-year-open");
  }

  function letterForClass(c) {
    const label = String(c?.label || "");
    const hit = LULC_CLASS_ORDER.find((o) => o.match.test(label));
    if (hit) return { ...hit, color: c?.color || hit.color, label: c?.label || hit.label };
    const first = label.trim().charAt(0).toUpperCase() || "?";
    return { key: first, color: c?.color || "#888", label };
  }

  function syncClassSelection() {
    const sel = state.landUseSelectedClass;
    classesEl.querySelectorAll(".lu-theme-class").forEach((btn) => {
      const on = sel && btn.dataset.label === sel;
      btn.classList.toggle("is-selected", !!on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    classesEl.classList.toggle("has-selection", !!sel);
  }

  function renderClasses(classes) {
    const list = Array.isArray(classes) ? classes : [];
    if (!list.length) {
      classesEl.hidden = true;
      classesEl.innerHTML = "";
      classItems = [];
      root.classList.remove("lu-theme-classes-open");
      return;
    }

    const ordered = [];
    const used = new Set();
    for (const pref of LULC_CLASS_ORDER) {
      const found = list.find((c) => pref.match.test(String(c.label || "")));
      if (found) {
        ordered.push({
          ...pref,
          color: found.color || pref.color,
          label: found.label || pref.label,
        });
        used.add(found);
      }
    }
    for (const c of list) {
      if (used.has(c)) continue;
      ordered.push(letterForClass(c));
    }
    classItems = ordered;

    classesEl.innerHTML = ordered
      .map(
        (c) => `
      <button type="button" class="lu-theme-class" role="listitem"
        data-label="${escapeAttr(c.label)}"
        style="--lu-class-color:${escapeAttr(c.color)}"
        title="${escapeAttr(c.label)} — click to focus"
        aria-label="${escapeAttr(c.label)}"
        aria-pressed="false">
        <span class="lu-theme-class-letter">${escapeHtml(c.key)}</span>
        <span class="lu-theme-class-name">${escapeHtml(c.label)}</span>
      </button>`,
      )
      .join("");
    classesEl.hidden = false;
    root.classList.add("lu-theme-classes-open");

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
    syncClassSelection();
  }

  function renderYearStepper() {
    if (mode === "year" && years.length) {
      const idx = Math.max(0, years.indexOf(Number(activeYear)));
      const cur = years[idx] ?? activeYear;
      const prev = idx > 0 ? years[idx - 1] : null;
      const next = idx >= 0 && idx < years.length - 1 ? years[idx + 1] : null;
      yearEl.innerHTML = `
        <button type="button" class="lu-theme-year-side" id="lu-year-prev"
          ${prev == null ? "disabled" : ""} data-year="${prev ?? ""}"
          aria-label="Previous year">
          <span class="lu-theme-year-arrow" aria-hidden="true">←</span>
          <span class="lu-theme-year-side-val">${prev ?? "—"}</span>
        </button>
        <div class="lu-theme-year-center">
          <span class="lu-theme-year-eyebrow">Year</span>
          <strong class="lu-theme-year-current">${cur ?? "—"}</strong>
        </div>
        <button type="button" class="lu-theme-year-side" id="lu-year-next"
          ${next == null ? "disabled" : ""} data-year="${next ?? ""}"
          aria-label="Next year">
          <span class="lu-theme-year-side-val">${next ?? "—"}</span>
          <span class="lu-theme-year-arrow" aria-hidden="true">→</span>
        </button>
      `;
      yearEl.hidden = false;
      root.classList.add("lu-theme-year-open");
      bindYearButtons();
      return;
    }

    if (mode === "period" && periods.length) {
      const ids = periods.map((p) => (typeof p === "object" ? p.id : p));
      const labels = periods.map((p) => (typeof p === "object" ? p.label || p.id : p));
      const idx = Math.max(0, ids.findIndex((id) => String(id) === String(activePeriod)));
      const curLabel = labels[idx] ?? String(ids[idx] ?? activePeriod);
      const prevId = idx > 0 ? ids[idx - 1] : null;
      const nextId = idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null;
      const prevLabel = idx > 0 ? labels[idx - 1] : null;
      const nextLabel = idx >= 0 && idx < ids.length - 1 ? labels[idx + 1] : null;
      yearEl.innerHTML = `
        <button type="button" class="lu-theme-year-side" id="lu-period-prev"
          ${prevId == null ? "disabled" : ""} data-period="${escapeAttr(prevId ?? "")}"
          aria-label="Previous period">
          <span class="lu-theme-year-arrow" aria-hidden="true">←</span>
          <span class="lu-theme-year-side-val">${escapeHtml(shortPeriod(prevLabel))}</span>
        </button>
        <div class="lu-theme-year-center">
          <span class="lu-theme-year-eyebrow">Period</span>
          <strong class="lu-theme-year-current">${escapeHtml(curLabel)}</strong>
        </div>
        <button type="button" class="lu-theme-year-side" id="lu-period-next"
          ${nextId == null ? "disabled" : ""} data-period="${escapeAttr(nextId ?? "")}"
          aria-label="Next period">
          <span class="lu-theme-year-side-val">${escapeHtml(shortPeriod(nextLabel))}</span>
          <span class="lu-theme-year-arrow" aria-hidden="true">→</span>
        </button>
      `;
      yearEl.hidden = false;
      root.classList.add("lu-theme-year-open");
      bindPeriodButtons();
      return;
    }

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
    if (state.landUseSelectedClass) {
      state.landUseSelectedClass = null;
      syncClassSelection();
      return;
    }
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
    renderClasses(legend.classes || []);

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
    classesEl.hidden = true;
    classesEl.innerHTML = "";
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

function shortPeriod(label) {
  if (label == null) return "—";
  const s = String(label);
  if (s.length <= 8) return s;
  return s.slice(0, 7) + "…";
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
