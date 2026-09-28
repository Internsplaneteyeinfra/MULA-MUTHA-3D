import { ChevronRight } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import { metersToStation } from "../../scene/chainageMarkers.js";

/** Thematic layers offered in 2D — ids are existing hydrology layer ids. */
const OPTIONS = [
  { id: "salinity", label: "Salinity", icon: "🧂", layerId: "salinity" },
  { id: "erosion", label: "Erosion", icon: "🏞️", layerId: "bank_erosion" },
];

const isMap2d = () =>
  !state.cinematicActive &&
  (state.cameraMode === "aerial" || state.cameraMode === "top" || state.cameraMode === "2d");

/**
 * 2D thematic analyses, driven only by `state.active2DAnalysis`:
 *  - null                 → launch rows inside River Data (2D only); no analysis panel
 *  - "salinity"/"erosion" → that analysis panel only (← Back sets the state to null)
 *  - any other analysis   → nothing here (that module owns its panel, e.g. Silt Area Analysis)
 * Layers render through the existing hydrology layer manager (no new data paths).
 */
export function mountMap2dDataPanel(stack, riverData) {
  const rowsHost = riverData?.el?.querySelector(".river-data-rows");
  const rows = OPTIONS.map((o) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "river-data-row";
    row.dataset.m2d = o.id;
    row.hidden = true;
    row.title = `${o.label} analysis`;
    row.innerHTML = `
      <span class="river-data-row-icon" aria-hidden="true">${o.icon}</span>
      <span class="river-data-row-label">${o.label}</span>
      <span class="river-data-row-value river-data-row-value--empty" data-m2d-status></span>
      <span class="river-data-row-action" aria-hidden="true">${lucideHtml(ChevronRight, { size: 14 })}</span>`;
    rowsHost?.appendChild(row);
    return row;
  });

  const el = document.createElement("section");
  el.className = "map2d-data-panel is-analysis";
  el.id = "map2d-analysis-panel";
  el.hidden = true;
  el.innerHTML = `
    <div class="m2d-view">
      <button type="button" class="m2d-back" data-m2d-back aria-label="Back">
        <span class="m2d-back-arrow" aria-hidden="true">←</span><span class="m2d-view-title"></span>
      </button>
      <div class="m2d-view-ch"></div>
      <div class="m2d-legend-title"></div>
      <ul class="m2d-legend"></ul>
    </div>
  `;
  stack.appendChild(el);

  const chEl = el.querySelector(".m2d-view-ch");
  /** Option shown in the analysis panel (always equals state.active2DAnalysis for own ids). */
  let active = null;
  /** Analysis to restore when the user comes back to 2D from 3D. */
  let resumeOpt = null;
  let busy = false;
  let leaving = false;
  let lastSel;

  function setRowStatus(id, text) {
    rows.forEach((r) => {
      const s = r.querySelector("[data-m2d-status]");
      s.textContent = r.dataset.m2d === id ? text || "" : "";
    });
  }

  function setActiveAnalysis(opt) {
    active = opt;
    if (opt) state.active2DAnalysis = opt.id;
    else if (OPTIONS.some((o) => o.id === state.active2DAnalysis)) state.active2DAnalysis = null;
    el.hidden = !opt;
    if (opt) el.setAttribute("aria-label", `${opt.label} analysis`);
  }

  function clear({ hideLayer = true } = {}) {
    if (hideLayer && active && window.__MM_SCENE__?.getHydrologyActiveId?.() === active.layerId) {
      window.__MM_SCENE__?.hideHydrology?.();
    }
    setActiveAnalysis(null);
  }

  function renderLegend(opt, legend) {
    el.querySelector(".m2d-view-title").textContent = `${opt.label.toUpperCase()} ANALYSIS`;
    el.querySelector(".m2d-legend-title").textContent = String(legend?.title || opt.label).toUpperCase();
    el.querySelector(".m2d-legend").innerHTML = (legend?.classes || [])
      .map((c) => {
        const value = c.range || c.pct || "";
        return `<li><span class="m2d-sw" style="background:${escapeHtml(c.color || "#888")}"></span>` +
          `<span class="m2d-lbl">${escapeHtml(c.label)}</span>` +
          `${value ? `<span class="m2d-val">${escapeHtml(value)}</span>` : ""}</li>`;
      })
      .join("");
    lastSel = undefined;
    syncChainage();
  }

  async function select(opt) {
    if (busy) return;
    busy = true;
    setRowStatus(null);
    if (state.active2DAnalysis === "silt") window.__MM_SCENE__?.setSiltAnalysisActive?.(false);
    try {
      const result = await window.__MM_SCENE__?.showHydrologyLayer?.(opt.layerId);
      if (result?.available) {
        renderLegend(opt, result.legend);
        setActiveAnalysis(opt);
      } else {
        setActiveAnalysis(null);
        setRowStatus(opt.id, "unavailable");
      }
    } catch {
      setActiveAnalysis(null);
      setRowStatus(opt.id, "unavailable");
    } finally {
      busy = false;
    }
  }

  function onRowClick(e) {
    const row = e.target.closest("[data-m2d]");
    const opt = row && OPTIONS.find((o) => o.id === row.dataset.m2d);
    if (!opt || state.active2DAnalysis) return;
    e.preventDefault();
    e.stopPropagation();
    void select(opt);
  }
  rows.forEach((r) => r.addEventListener("click", onRowClick));

  el.addEventListener("click", (e) => {
    if (!e.target.closest("[data-m2d-back]")) return;
    resumeOpt = null;
    clear();
  });

  function syncChainage() {
    const sel = state.selectedChainageMeters;
    if (sel === lastSel) return;
    lastSel = sel;
    chEl.textContent = Number.isFinite(sel) ? `Chainage ${metersToStation(sel).replace(/^\+/, "")}` : "Chainage —";
  }

  /** Per-HUD-tick sync with 2D mode, the canonical analysis state and external (toolbar) layers. */
  function update() {
    const in2d = isMap2d();
    if (!in2d) leaving = false;
    const in2dMode = in2d && !leaving;
    const hydroId = window.__MM_SCENE__?.getHydrologyActiveId?.() || null;
    const toolbarModule =
      !busy &&
      ((hydroId && hydroId !== active?.layerId) ||
        !!state.mapFocusKind ||
        !!state.landUseFocusMode ||
        !!state.lithologyMode);
    const otherModule =
      toolbarModule || (!!state.active2DAnalysis && !OPTIONS.some((o) => o.id === state.active2DAnalysis));
    if (otherModule) resumeOpt = null;

    if (!in2dMode && active) {
      resumeOpt = active;
      clear();
    } else if (otherModule && active) {
      clear({ hideLayer: !toolbarModule });
    } else if (in2dMode && !otherModule && resumeOpt && !active && !busy) {
      const opt = resumeOpt;
      resumeOpt = null;
      void select(opt);
    }

    const showRows = in2dMode && !toolbarModule && !state.active2DAnalysis && !busy;
    for (const r of rows) if (r.hidden === showRows) r.hidden = !showRows;

    if (!active) return;
    if (!busy && hydroId !== active.layerId) {
      clear({ hideLayer: false });
      return;
    }
    syncChainage();
  }

  /** Called when the user leaves 2D; the camera may still be mid-transition out of map mode. */
  function leave() {
    if (!isMap2d()) return;
    leaving = true;
    update();
  }

  /** 2D requested again — a pending leave no longer applies. */
  function resume() {
    leaving = false;
  }

  return { el, update, leave, resume };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
