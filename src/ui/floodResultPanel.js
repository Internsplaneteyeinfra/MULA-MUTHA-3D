/**
 * Compact Flood Result card (left dock).
 * Collapsed: date · flood area · max depth · status.
 * Expanded: full metrics + progress + Replay / Focus / Clear.
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

/** Always shown in the compact summary strip. */
const SUMMARY_IDS = new Set([
  "flood-res-date",
  "flood-res-flood-area",
  "flood-res-max-depth",
  "flood-res-status",
]);

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
  {
    id: "flood-res-water-rise",
    label: "Water rise",
    get: (i) => {
      const mm =
        validNumber(i.water_rise_mm) ??
        (validNumber(i.water_rise_m) != null ? validNumber(i.water_rise_m) * 1000 : null);
      const v = fmtRiseMm(mm);
      if (!v) return null;
      return i.level_source && i.level_source !== "api" ? `${v} (est.)` : v;
    },
  },
  {
    id: "flood-res-max-depth",
    label: "Max depth",
    get: (i) => {
      const v = fmtMeters(i.max_depth_m);
      if (!v) return null;
      return i.level_source && i.level_source !== "api" ? `${v} (est.)` : v;
    },
  },
  { id: "flood-res-updated", label: "Updated", get: (i) => fmtTimestamp(i.catalog_updated_at) },
];

function rowHtml(id, label, value, wide = false) {
  return `<div class="flood-result-row${wide ? " is-wide" : ""}" data-row="${id}"><span class="k">${esc(label)}</span><span class="v" id="${id}" title="${esc(value)}">${esc(value)}</span></div>`;
}

export function floodResultRows(info) {
  if (!info) return [];
  return FIELDS.map((f) => ({ ...f, value: f.get(info) })).filter((f) => f.value != null);
}

export function mountFloodResultPanel(root, handlers = {}) {
  const panel = document.createElement("aside");
  panel.className = "flood-result-panel map-chrome flood-dock-card is-collapsed";
  panel.id = "flood-result-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <header class="flood-result-panel__head" title="Flood extent generated from JalNetra Flood API results.">
      <button type="button" class="flood-result-toggle" aria-expanded="false" aria-controls="flood-result-detail">
        <strong>FLOOD RESULT</strong>
        <span class="flood-result-toggle__icon" aria-hidden="true">${lucideHtml(ChevronUp, { size: 14 })}</span>
      </button>
      <button type="button" class="flood-result-close" id="flood-result-close" aria-label="Close">${lucideHtml(X, { size: 13 })}</button>
    </header>
    <div class="flood-result-panel__summary" id="flood-result-summary"></div>
    <div class="flood-result-panel__content" id="flood-result-detail">
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

  const summaryEl = panel.querySelector("#flood-result-summary");
  const body = panel.querySelector("#flood-result-body");
  const details = panel.querySelector("#flood-result-details");
  const detailsPre = panel.querySelector("#flood-result-details-pre");
  const actions = panel.querySelector(".flood-result-panel__actions");
  const toggleBtn = panel.querySelector(".flood-result-toggle");
  let hasLevels = false;
  let shownKey = null;
  let userChoice = "collapsed";
  let lastInfo = null;
  let liveStatus = "";

  function resultKey(info) {
    return info ? `${info.kml_id ?? ""}|${info.scene_date ?? ""}` : null;
  }

  function setCollapsed(on) {
    panel.classList.toggle("is-collapsed", !!on);
    toggleBtn.setAttribute("aria-expanded", String(!on));
  }

  function renderSummary(info, statusOverride) {
    if (!info) {
      summaryEl.innerHTML = "";
      return;
    }
    const date = fmtYmd(info.scene_date) || "—";
    const area = fmtHa(info.flood_area_ha) || "—";
    const depthRaw = fmtMeters(info.max_depth_m);
    const depth = depthRaw
      ? info.level_source && info.level_source !== "api"
        ? `${depthRaw} (est.)`
        : depthRaw
      : "—";
    const status =
      statusOverride ||
      liveStatus ||
      validText(info.status_label) ||
      (hasLevels ? "Ready" : "Extent ready");
    summaryEl.innerHTML = `
      <div class="frp-summary-grid">
        <div class="frp-summary-cell"><span class="k">Date</span><span class="v" id="flood-sum-date">${esc(date)}</span></div>
        <div class="frp-summary-cell"><span class="k">Flood area</span><span class="v" id="flood-sum-area">${esc(area)}</span></div>
        <div class="frp-summary-cell"><span class="k">Max depth</span><span class="v" id="flood-sum-depth">${esc(depth)}</span></div>
        <div class="frp-summary-cell frp-summary-cell--status"><span class="k">Status</span><span class="v" id="flood-sum-status">${esc(status)}</span></div>
      </div>`;
  }

  function fitToViewport() {
    /* Dock handles scroll; keep user collapse preference. */
    if (userChoice != null) setCollapsed(userChoice === "collapsed");
  }

  function show(info, opts = {}) {
    if (!info && !opts.error) {
      hide();
      return;
    }

    if (opts.error) {
      hasLevels = false;
      shownKey = null;
      lastInfo = null;
      liveStatus = "Error";
      const date = fmtYmd(opts.date);
      renderSummary(
        { scene_date: opts.date, status_label: "Error" },
        "Error",
      );
      body.innerHTML = `<div class="frp-grid">${[
        rowHtml("flood-res-status", "Status", "Error"),
        date ? rowHtml("flood-res-date", "Date", date) : "",
      ].join("")}</div><p class="flood-result-error">${esc(validText(opts.message) || "Flood simulation could not be completed.")}</p>`;
      const detail = validText(opts.errorDetails == null ? null : String(opts.errorDetails));
      details.hidden = !detail || detail === opts.message;
      detailsPre.textContent = details.hidden ? "" : detail;
      actions.hidden = true;
      panel.hidden = false;
      setCollapsed(userChoice === "collapsed");
      return;
    }

    lastInfo = info;
    shownKey = resultKey(info);
    hasLevels = validNumber(info.final_water_level) != null;
    liveStatus = "";
    const rows = floodResultRows(info);
    // Keep status in the expanded body (summary already shows the compact four).
    const detailRows = rows.filter(
      (r) => !SUMMARY_IDS.has(r.id) || r.id === "flood-res-status",
    );

    renderSummary(info);
    body.innerHTML = `
      <div class="frp-grid">${detailRows.map((r) => rowHtml(r.id, r.label, r.value, r.wide)).join("")}</div>
      <div class="flood-sim-progress-area">
        <div class="flood-sim-progress-area__row">
          <span class="flood-sim-progress-area__status" id="flood-anim-status">${hasLevels ? "SIMULATION READY" : "FLOOD EXTENT READY"}</span>
          <span id="flood-anim-front-val">0%</span>
        </div>
        <div class="progress-bar-container"><div id="flood-anim-bar"></div></div>
      </div>`;

    // Keep summary field ids available for live updates (hidden clones in detail if needed)
    for (const r of rows.filter((x) => SUMMARY_IDS.has(x.id))) {
      if (!body.querySelector(`#${r.id}`)) {
        body.insertAdjacentHTML(
          "afterbegin",
          `<div class="flood-result-row is-summary-mirror" hidden data-row="${r.id}"><span class="k">${esc(r.label)}</span><span class="v" id="${r.id}">${esc(r.value)}</span></div>`,
        );
      }
    }

    details.hidden = true;
    detailsPre.textContent = "";
    actions.hidden = false;
    panel.hidden = false;
    setCollapsed(userChoice === "collapsed");
  }

  function hide() {
    panel.hidden = true;
  }

  function clear() {
    panel.hidden = true;
    lastInfo = null;
    shownKey = null;
    hasLevels = false;
    liveStatus = "";
    body.innerHTML = "";
    summaryEl.innerHTML = "";
  }

  function reopen(info) {
    const target = info || lastInfo;
    if (target) show(target);
  }

  function updateScene(info) {
    if (info) lastInfo = info;
    if (panel.hidden || !info) return;
    show(info);
  }

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

  function setSummaryLive(id, value) {
    const el = panel.querySelector(`#${id}`);
    if (el && value != null) {
      el.textContent = value;
      el.title = value;
    }
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
      const est = info.level_source && info.level_source !== "api";
      const rise =
        fmtRiseMm(info.water_rise_mm) ||
        (validNumber(info.water_rise_m) != null ? fmtRiseMm(info.water_rise_m * 1000) : null);
      if (rise) setLive("flood-res-water-rise", est ? `${rise} (est.)` : rise);
      setLive("flood-res-current-water", fmtMeters(info.current_water_level));
      // Max depth is the final WSE−DTM product metric — do not scale by progress.
      const maxDepth = fmtMeters(info.max_depth_m);
      if (maxDepth) {
        const d = est ? `${maxDepth} (est.)` : maxDepth;
        setLive("flood-res-max-depth", d);
        setSummaryLive("flood-sum-depth", d);
      }
    }

    const done = p >= 0.999;
    liveStatus = done ? "Complete" : "Simulating…";
    setSummaryLive("flood-sum-status", liveStatus);
    const status = panel.querySelector("#flood-anim-status");
    if (status) {
      status.textContent = done ? "SIMULATION COMPLETE" : "SIMULATING…";
      status.classList.toggle("is-complete", done);
    }
  });

  window.addEventListener("flood-sim-complete", () => {
    if (panel.hidden || !shownKey) return;
    liveStatus = "Complete";
    setSummaryLive("flood-sum-status", "Complete");
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

export const mountFloodInfoPanel = mountFloodResultPanel;
