/**
 * Compact Flood Result card (left side).
 * Renders only fields whose values are genuinely available in the API result
 * (or derived from it via the verified datum pipeline). Unavailable fields are
 * omitted entirely — no placeholders.
 */
import { ChevronUp, Play, Crosshair, X } from "lucide";
import { lucideHtml } from "./icons.js";
import {
  validNumber,
  validYmd,
  validText,
  fmtHa,
  fmtMeters,
  fmtRiseMm,
  fmtYmd,
  fmtTimestamp,
} from "./floodFieldFormat.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Field order and formatting. Half-width cells pair up in a two-column grid;
 * `wide` cells span both columns. `id` lets live progress updates find values.
 */
const FIELDS = [
  { id: "flood-res-date", label: "Date", get: (i) => fmtYmd(i.scene_date) },
  { id: "flood-res-status", label: "Status", get: (i) => validText(i.status_label) },
  {
    id: "flood-res-observation",
    label: "Observation",
    wide: true,
    get: (i) =>
      validYmd(i.pre_date) && validYmd(i.post_date)
        ? `${fmtYmd(i.pre_date, false)} → ${fmtYmd(i.post_date)}`
        : null,
  },
  { id: "flood-res-flood-area", label: "Flood area", get: (i) => fmtHa(i.flood_area_ha) },
  {
    id: "flood-res-mapped-area",
    label: "Mapped extent",
    // Only when the overlay maps materially less than the API headline, so the map is never overstated.
    get: (i) => {
      const m = Number(i.mapped_flood_area_ha);
      const a = Number(i.flood_area_ha);
      return Number.isFinite(m) && Number.isFinite(a) && a > 0 && Math.abs(m - a) / a > 0.2 ? fmtHa(m) : null;
    },
  },
  { id: "flood-res-water-area", label: "Water area", get: (i) => fmtHa(i.water_area_ha) },
  { id: "flood-res-initial-water", label: "Initial water", get: (i) => fmtMeters(i.initial_water_level) },
  { id: "flood-res-final-water", label: "Final water", get: (i) => fmtMeters(i.final_water_level) },
  { id: "flood-res-current-water", label: "Current water", get: (i) => fmtMeters(i.current_water_level) },
  { id: "flood-res-water-rise", label: "Water rise", get: (i) => fmtRiseMm(i.water_rise_mm) },
  { id: "flood-res-max-depth", label: "Max depth", get: (i) => fmtMeters(i.max_depth_m) },
  { id: "flood-res-updated", label: "Updated", get: (i) => fmtTimestamp(i.catalog_updated_at) },
];

function rowHtml(id, label, value, wide = false) {
  return `<div class="flood-result-row${wide ? " is-wide" : ""}" data-row="${id}"><span class="k">${esc(label)}</span><span class="v" id="${id}" title="${esc(value)}">${esc(value)}</span></div>`;
}

/** Rows for every field with a valid value, in FIELDS order. */
export function floodResultRows(info) {
  if (!info) return [];
  return FIELDS.map((f) => ({ ...f, value: f.get(info) })).filter((f) => f.value != null);
}

export function mountFloodResultPanel(root, handlers = {}) {
  const panel = document.createElement("aside");
  panel.className = "flood-result-panel map-chrome";
  panel.id = "flood-result-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <header class="flood-result-panel__head" title="Flood extent generated from JalNetra Flood API results.">
      <button type="button" class="flood-result-toggle" aria-expanded="true" aria-controls="flood-result-content">
        <strong>FLOOD RESULT</strong>
        <span class="flood-result-toggle__icon" aria-hidden="true">${lucideHtml(ChevronUp, { size: 14 })}</span>
      </button>
      <button type="button" class="flood-result-close" id="flood-result-close" aria-label="Close">${lucideHtml(X, { size: 13 })}</button>
    </header>
    <div class="flood-result-panel__content" id="flood-result-content">
      <div class="flood-result-panel__body" id="flood-result-body"></div>
      <details class="flood-result-details" id="flood-result-details" hidden>
        <summary>Details</summary>
        <pre class="flood-result-details__pre" id="flood-result-details-pre"></pre>
      </details>
      <div class="flood-result-panel__actions">
        <button type="button" class="flood-result-action" id="flood-result-replay" title="Replay animation">${lucideHtml(Play, { size: 11 })}<span>Replay</span></button>
        <button type="button" class="flood-result-action" id="flood-result-focus" title="Focus flood extent">${lucideHtml(Crosshair, { size: 11 })}<span>Focus</span></button>
        <button type="button" class="flood-result-action flood-result-action--danger" id="flood-result-clear" title="Clear simulation">${lucideHtml(X, { size: 11 })}<span>Clear</span></button>
      </div>
    </div>
  `;
  root.appendChild(panel);

  const body = panel.querySelector("#flood-result-body");
  const details = panel.querySelector("#flood-result-details");
  const detailsPre = panel.querySelector("#flood-result-details-pre");
  const actions = panel.querySelector(".flood-result-panel__actions");
  const toggleBtn = panel.querySelector(".flood-result-toggle");
  /** Live level rows only exist when the loaded product carries a water level. */
  let hasLevels = false;
  /** kml/date of the result currently rendered — progress events from anything else are ignored. */
  let shownKey = null;
  /** User explicitly collapsed / expanded — auto-fit never overrides that choice. */
  let userChoice = null;

  function resultKey(info) {
    return info ? `${info.kml_id ?? ""}|${info.scene_date ?? ""}` : null;
  }

  function setCollapsed(on) {
    panel.classList.toggle("is-collapsed", !!on);
    toggleBtn.setAttribute("aria-expanded", String(!on));
  }

  /**
   * Keep the card between its top edge and the chainage ruler. If the content
   * cannot fit (very short viewports) collapse it instead of clipping.
   */
  function fitToViewport() {
    if (panel.hidden) return;
    const top = panel.getBoundingClientRect().top;
    const ruler = document.querySelector(".chainage-ruler");
    const rulerTop = ruler && !ruler.hidden ? ruler.getBoundingClientRect().top : window.innerHeight;
    const avail = Math.max(60, Math.floor(rulerTop - top - 10));
    panel.style.maxHeight = `${avail}px`;
    if (userChoice != null) {
      setCollapsed(userChoice === "collapsed");
      return;
    }
    setCollapsed(false);
    if (panel.scrollHeight > avail + 1) setCollapsed(true);
  }

  let lastInfo = null;

  function show(info, opts = {}) {
    if (!info && !opts.error) {
      hide();
      return;
    }

    if (opts.error) {
      hasLevels = false;
      shownKey = null;
      lastInfo = null;
      const date = fmtYmd(opts.date);
      body.innerHTML = `<div class="frp-grid">${[
        rowHtml("flood-res-status", "Status", "Error"),
        date ? rowHtml("flood-res-date", "Date", date) : "",
      ].join("")}</div><p class="flood-result-error">${esc(validText(opts.message) || "Flood simulation could not be completed.")}</p>`;
      const detail = validText(opts.errorDetails == null ? null : String(opts.errorDetails));
      details.hidden = !detail || detail === opts.message;
      detailsPre.textContent = details.hidden ? "" : detail;
      actions.hidden = true;
      panel.hidden = false;
      fitToViewport();
      return;
    }

    lastInfo = info;
    shownKey = resultKey(info);
    hasLevels = validNumber(info.final_water_level) != null;
    const rows = floodResultRows(info);

    body.innerHTML = `
      <div class="frp-grid">${rows.map((r) => rowHtml(r.id, r.label, r.value, r.wide)).join("")}</div>
      <div class="flood-sim-progress-area">
        <div class="flood-sim-progress-area__row">
          <span class="flood-sim-progress-area__status" id="flood-anim-status">${hasLevels ? "SIMULATION READY" : "FLOOD EXTENT READY"}</span>
          <span id="flood-anim-front-val">0%</span>
        </div>
        <div class="progress-bar-container"><div id="flood-anim-bar"></div></div>
      </div>`;

    details.hidden = true;
    detailsPre.textContent = "";
    actions.hidden = false;
    panel.hidden = false;
    fitToViewport();
  }

  function hide() {
    panel.hidden = true;
  }

  function clear() {
    panel.hidden = true;
    lastInfo = null;
    shownKey = null;
    hasLevels = false;
    body.innerHTML = "";
  }

  function reopen(info) {
    const target = info || lastInfo;
    if (target) {
      show(target);
    }
  }

  function updateScene(info) {
    if (info) lastInfo = info;
    if (panel.hidden || !info) return;
    show(info);
  }

  /** Update a live value; drop its row if the value stops being valid. */
  function setLive(id, value) {
    const el = panel.querySelector(`#${id}`);
    if (!el) return;
    if (value == null) {
      el.closest("[data-row]")?.remove();
      return;
    }
    el.textContent = value;
    el.title = value;
  }

  toggleBtn.addEventListener("click", () => {
    const collapse = !panel.classList.contains("is-collapsed");
    userChoice = collapse ? "collapsed" : "expanded";
    setCollapsed(collapse);
  });
  window.addEventListener("resize", () => fitToViewport());

  panel.querySelector("#flood-result-close")?.addEventListener("click", () => {
    hide();
    handlers.onClose?.();
  });
  panel.querySelector("#flood-result-replay")?.addEventListener("click", () => handlers.onReplay?.());
  panel.querySelector("#flood-result-focus")?.addEventListener("click", () => handlers.onFocus?.());
  panel.querySelector("#flood-result-clear")?.addEventListener("click", () => handlers.onClear?.());

  window.addEventListener("flood-sim-progress", (e) => {
    if (panel.hidden || !shownKey || !e.detail) return;
    const info = e.detail.info || {};
    if (resultKey(info) !== shownKey) return;
    const p = validNumber(e.detail.progress);
    if (p == null) return;
    const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
    const bar = panel.querySelector("#flood-anim-bar");
    if (bar) bar.style.width = `${pct}%`;

    const total = validNumber(info.flood_area_ha);
    const cur = total != null ? validNumber(info._current_flooded_area_ha) ?? total * p : null;
    setLive("flood-anim-front-val", cur != null ? `${pct}% · ${cur.toFixed(2)} ha` : `${pct}%`);

    if (hasLevels) {
      setLive("flood-res-water-rise", fmtRiseMm(info.water_rise_mm));
      setLive("flood-res-current-water", fmtMeters(info.current_water_level));
      const maxDepth = validNumber(info.max_depth_m);
      if (maxDepth != null) setLive("flood-res-max-depth", fmtMeters(maxDepth * p));
    }

    const status = panel.querySelector("#flood-anim-status");
    if (status) {
      const done = p >= 0.999;
      status.textContent = done ? "SIMULATION COMPLETE" : "SIMULATING…";
      status.classList.toggle("is-complete", done);
    }
  });

  window.addEventListener("flood-sim-complete", () => {
    if (panel.hidden || !shownKey) return;
    const status = panel.querySelector("#flood-anim-status");
    if (status) {
      status.textContent = "SIMULATION COMPLETE";
      status.classList.add("is-complete");
    }
  });

  return {
    el: panel,
    show,
    hide,
    clear,
    reopen,
    hasResult: () => !!lastInfo,
    updateScene,
    fit: fitToViewport,
  };
}

/** Compat alias for previous mountFloodInfoPanel name */
export const mountFloodInfoPanel = mountFloodResultPanel;
