import { state } from "../../state.js";
import { metersToStation } from "../../scene/chainageMarkers.js";

/** Thematic layers offered in 2D — ids are existing hydrology layer ids. */
const OPTIONS = [
  { id: "salinity", label: "Salinity", layerId: "salinity" },
  { id: "erosion", label: "Erosion", layerId: "bank_erosion" },
];

const isMap2d = () =>
  !state.cinematicActive &&
  (state.cameraMode === "aerial" || state.cameraMode === "top" || state.cameraMode === "2d");

/**
 * Compact "2D DATA" chooser docked in the left stack; visible only in 2D map mode.
 * Layers render through the existing hydrology layer manager (no new data paths).
 */
export function mountMap2dDataPanel(stack) {
  const el = document.createElement("section");
  el.className = "map2d-data-panel";
  el.id = "map2d-data-panel";
  el.hidden = true;
  el.setAttribute("aria-label", "2D thematic data");
  el.innerHTML = `
    <div class="m2d-head">2D DATA</div>
    <div class="m2d-options" role="radiogroup" aria-label="2D thematic layer">
      ${OPTIONS.map((o) => `
        <button type="button" class="m2d-opt" role="radio" aria-checked="false" data-m2d="${o.id}">
          <span class="m2d-radio" aria-hidden="true"></span><span>${o.label}</span>
        </button>`).join("")}
    </div>
    <p class="m2d-status" hidden></p>
    <div class="m2d-view" hidden>
      <div class="m2d-view-title"></div>
      <div class="m2d-view-ch"></div>
      <div class="m2d-legend-title"></div>
      <ul class="m2d-legend"></ul>
    </div>
  `;
  stack.appendChild(el);

  const statusEl = el.querySelector(".m2d-status");
  const viewEl = el.querySelector(".m2d-view");
  const chEl = el.querySelector(".m2d-view-ch");
  let active = null;
  let busy = false;
  let shown = false;
  let leaving = false;
  let lastSel;

  function setChecked(id) {
    el.querySelectorAll(".m2d-opt").forEach((b) => {
      const on = b.dataset.m2d === id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function setStatus(text) {
    statusEl.hidden = !text;
    statusEl.textContent = text || "";
  }

  function clear({ hideLayer = true } = {}) {
    if (hideLayer && active && window.__MM_SCENE__?.getHydrologyActiveId?.() === active.layerId) {
      window.__MM_SCENE__?.hideHydrology?.();
    }
    active = null;
    setChecked(null);
    viewEl.hidden = true;
  }

  function renderLegend(opt, legend) {
    el.querySelector(".m2d-view-title").textContent = `2D VIEW — ${opt.label.toUpperCase()}`;
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
    viewEl.hidden = false;
  }

  async function select(opt) {
    if (busy) return;
    if (active?.id === opt.id) {
      clear();
      return;
    }
    busy = true;
    setStatus("");
    setChecked(opt.id);
    try {
      const result = await window.__MM_SCENE__?.showHydrologyLayer?.(opt.layerId);
      if (result?.available) {
        active = opt;
        renderLegend(opt, result.legend);
      } else {
        clear({ hideLayer: false });
        setStatus(`${opt.label} data unavailable`);
      }
    } catch {
      clear({ hideLayer: false });
      setStatus(`${opt.label} data unavailable`);
    } finally {
      busy = false;
    }
  }

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-m2d]");
    const opt = btn && OPTIONS.find((o) => o.id === btn.dataset.m2d);
    if (opt) void select(opt);
  });

  function syncChainage() {
    const sel = state.selectedChainageMeters;
    if (sel === lastSel) return;
    lastSel = sel;
    chEl.textContent = Number.isFinite(sel) ? `Chainage ${metersToStation(sel).replace(/^\+/, "")}` : "Chainage —";
  }

  /** Cheap per-HUD-tick sync: visibility with 2D mode, chainage text, external layer changes. */
  function update() {
    const in2d = isMap2d();
    if (!in2d) leaving = false;
    const want = in2d && !leaving;
    if (want !== shown) {
      shown = want;
      el.hidden = !want;
      if (!want) {
        clear();
        setStatus("");
      }
    }
    if (!shown || !active) return;
    if (!busy && window.__MM_SCENE__?.getHydrologyActiveId?.() !== active.layerId) {
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

  return { el, update, leave };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
