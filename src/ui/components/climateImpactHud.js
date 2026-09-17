/**
 * Climate Impact HUD — Land Use-style chrome:
 * top class chips (click toggle), bottom period date sheet, floating area graph.
 */
import { enterMapFocus, exitMapFocus } from "../mapFocus.js";
import {
  fetchClimateImpactIndex,
  fetchClimateImpactPeriod,
  fetchWrdFloodLines,
  WRD_FLOODLINE_LEGEND,
} from "../../services/climateImpactService.js";

/**
 * @param {HTMLElement} root
 */
export function mountClimateImpactHud(root) {
  const backEl = document.createElement("button");
  backEl.type = "button";
  backEl.className = "lu-theme-back map-chrome climate-impact-back";
  backEl.hidden = true;
  backEl.setAttribute("aria-label", "Back");
  backEl.innerHTML = `<span class="lu-theme-back-arrow" aria-hidden="true">←</span><span>Back</span>`;
  root.appendChild(backEl);

  const classesEl = document.createElement("div");
  classesEl.className = "lu-theme-classes map-chrome climate-impact-classes";
  classesEl.id = "climate-impact-classes";
  classesEl.hidden = true;
  classesEl.setAttribute("role", "list");
  classesEl.setAttribute("aria-label", "Climate impact layers");
  root.appendChild(classesEl);

  const graphEl = document.createElement("aside");
  graphEl.className = "climate-impact-graph map-chrome";
  graphEl.id = "climate-impact-graph";
  graphEl.hidden = true;
  graphEl.setAttribute("aria-label", "Flood and water area by period");
  root.appendChild(graphEl);

  const yearEl = document.createElement("div");
  yearEl.className = "lu-theme-year map-chrome climate-impact-year";
  yearEl.id = "climate-impact-year";
  yearEl.hidden = true;
  yearEl.setAttribute("role", "group");
  yearEl.setAttribute("aria-label", "Climate image period");
  root.appendChild(yearEl);

  /** @type {object | null} */
  let index = null;
  let periodId = 0;
  let showFlood = true;
  let showWater = true;
  let showWrd = true;
  let wrdReady = false;
  let open = false;
  let loadSerial = 0;
  let busy = false;

  function isOpen() {
    return open;
  }

  async function show() {
    open = true;
    enterMapFocus(root, "climate");
    backEl.hidden = false;
    root.classList.add("climate-focus", "lu-theme-classes-open", "lu-theme-year-open");
    graphEl.hidden = false;
    graphEl.innerHTML = `<p class="climate-impact-graph-status">Loading climate impact…</p>`;
    yearEl.hidden = true;
    yearEl.innerHTML = "";
    classesEl.hidden = true;
    classesEl.innerHTML = "";

    try {
      index = await fetchClimateImpactIndex();
      periodId =
        Number.isFinite(index.default_period) &&
        index.periods.some((p) => p.id === index.default_period)
          ? index.default_period
          : index.periods[0].id;
      renderClasses();
      renderPeriodStepper();
      renderGraph();
      await loadPeriod(periodId);
      await loadWrdLines();
      applyVisibility();
    } catch (err) {
      console.warn("[climate-impact]", err?.message || err);
      graphEl.innerHTML = `
        <p class="climate-impact-graph-status is-error">${escapeHtml(err?.message || "Unavailable")}</p>
        <button type="button" class="climate-impact-retry" id="climate-retry">Retry</button>`;
      graphEl.querySelector("#climate-retry")?.addEventListener("click", () => void show());
    }
  }

  function hide() {
    open = false;
    wrdReady = false;
    classesEl.hidden = true;
    classesEl.innerHTML = "";
    yearEl.hidden = true;
    yearEl.innerHTML = "";
    graphEl.hidden = true;
    graphEl.innerHTML = "";
    backEl.hidden = true;
    root.classList.remove("climate-focus", "lu-theme-classes-open", "lu-theme-year-open");
    exitMapFocus(root, "climate");
    window.__MM_SCENE__?.hideClimateImpact?.();
  }

  function layerDefs() {
    const floodColor = index?.classes?.flood?.color || "#c2372a";
    const waterColor = index?.classes?.water?.color || "#2f9bd6";
    return [
      {
        id: "flood",
        key: "F",
        label: index?.classes?.flood?.label || "Flood water",
        color: floodColor,
        on: showFlood,
      },
      {
        id: "water",
        key: "S",
        label: index?.classes?.water?.label || "Surface water",
        color: waterColor,
        on: showWater,
      },
      {
        id: "wrd",
        key: "W",
        label: "WRD lines",
        color: "#1565c0",
        on: showWrd && wrdReady,
        disabled: !wrdReady,
        tri: true,
      },
    ];
  }

  function renderClasses() {
    if (!index) return;
    const layers = layerDefs();
    classesEl.innerHTML = layers
      .map(
        (c) => `
      <button type="button" class="lu-theme-class${c.on ? " is-selected" : ""}${c.tri ? " climate-impact-class--wrd" : ""}${c.disabled ? " is-disabled" : ""}"
        role="listitem"
        data-layer="${c.id}"
        style="--lu-class-color:${escapeAttr(c.color)}"
        title="${escapeAttr(c.label)}${c.disabled ? " — unavailable" : " — click to toggle"}"
        aria-label="${escapeAttr(c.label)}"
        aria-pressed="${c.on ? "true" : "false"}"
        ${c.disabled ? "disabled" : ""}>
        <span class="lu-theme-class-letter">${escapeHtml(c.key)}</span>
        <span class="lu-theme-class-name">${escapeHtml(c.label)}</span>
      </button>`,
      )
      .join("");
    classesEl.hidden = false;
    root.classList.add("lu-theme-classes-open");

    classesEl.querySelectorAll(".lu-theme-class[data-layer]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.dataset.layer;
        if (id === "flood") showFlood = !showFlood;
        else if (id === "water") showWater = !showWater;
        else if (id === "wrd") {
          if (!wrdReady) {
            void loadWrdLines();
            return;
          }
          showWrd = !showWrd;
        }
        applyVisibility();
        renderClasses();
        renderGraph();
      });
    });
  }

  function renderPeriodStepper() {
    const periods = index?.periods || [];
    if (!periods.length) {
      yearEl.hidden = true;
      yearEl.innerHTML = "";
      root.classList.remove("lu-theme-year-open");
      return;
    }
    const ids = periods.map((p) => p.id);
    const labels = periods.map((p) => p.label || String(p.id));
    const idx = Math.max(0, ids.findIndex((id) => id === periodId));
    const curLabel = labels[idx] ?? String(periodId);
    const prevId = idx > 0 ? ids[idx - 1] : null;
    const nextId = idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null;
    const prevLabel = idx > 0 ? labels[idx - 1] : null;
    const nextLabel = idx >= 0 && idx < ids.length - 1 ? labels[idx + 1] : null;
    const cur = periods[idx];
    const range =
      cur?.pre_date && cur?.post_date ? `${cur.pre_date} → ${cur.post_date}` : "";

    yearEl.innerHTML = `
      <button type="button" class="lu-theme-year-side" id="ci-period-prev"
        ${prevId == null ? "disabled" : ""} data-period="${prevId ?? ""}"
        aria-label="Previous period">
        <span class="lu-theme-year-arrow" aria-hidden="true">←</span>
        <span class="lu-theme-year-side-val">${escapeHtml(shortPeriod(prevLabel))}</span>
      </button>
      <div class="lu-theme-year-center">
        <span class="lu-theme-year-eyebrow">Period</span>
        <strong class="lu-theme-year-current">${escapeHtml(curLabel)}</strong>
        ${range ? `<small class="climate-impact-year-range">${escapeHtml(range)}</small>` : ""}
      </div>
      <button type="button" class="lu-theme-year-side" id="ci-period-next"
        ${nextId == null ? "disabled" : ""} data-period="${nextId ?? ""}"
        aria-label="Next period">
        <span class="lu-theme-year-side-val">${escapeHtml(shortPeriod(nextLabel))}</span>
        <span class="lu-theme-year-arrow" aria-hidden="true">→</span>
      </button>`;
    yearEl.hidden = false;
    root.classList.add("lu-theme-year-open");

    yearEl.querySelector("#ci-period-prev")?.addEventListener("click", onPeriodClick);
    yearEl.querySelector("#ci-period-next")?.addEventListener("click", onPeriodClick);
  }

  async function onPeriodClick(e) {
    const id = Number(e.currentTarget?.dataset?.period);
    if (!Number.isFinite(id) || busy || id === periodId) return;
    busy = true;
    try {
      periodId = id;
      renderPeriodStepper();
      renderGraph();
      await loadPeriod(periodId);
    } finally {
      busy = false;
    }
  }

  function renderGraph() {
    const periods = index?.periods || [];
    if (!periods.length) {
      graphEl.innerHTML = "";
      return;
    }
    const p = periods.find((x) => x.id === periodId) || periods[0];
    const floodHa = Number(p.flood_area_ha);
    const waterHa = Number(p.water_area_ha);
    const maxF = Math.max(...periods.map((x) => Number(x.flood_area_ha) || 0), 1);
    const maxW = Math.max(...periods.map((x) => Number(x.water_area_ha) || 0), 1);
    const floodColor = index?.classes?.flood?.color || "#c2372a";
    const waterColor = index?.classes?.water?.color || "#2f9bd6";

    const bars = periods
      .map((row) => {
        const fh = ((Number(row.flood_area_ha) || 0) / maxF) * 100;
        const wh = ((Number(row.water_area_ha) || 0) / maxW) * 100;
        return `<button type="button" class="climate-impact-graph-bar${row.id === periodId ? " is-active" : ""}" data-period="${row.id}" title="${escapeAttr(row.label)} · F ${Number(row.flood_area_ha || 0).toFixed(1)} ha · W ${Number(row.water_area_ha || 0).toFixed(1)} ha">
          <i class="is-flood" style="height:${fh.toFixed(0)}%;background:${escapeAttr(floodColor)}"></i>
          <i class="is-water" style="height:${wh.toFixed(0)}%;background:${escapeAttr(waterColor)}"></i>
        </button>`;
      })
      .join("");

    graphEl.innerHTML = `
      <header class="climate-impact-graph-head">
        <strong>${escapeHtml(p.label || "Period")}</strong>
        <small>${escapeHtml(p.pre_date || "")} → ${escapeHtml(p.post_date || "")}</small>
      </header>
      <div class="climate-impact-graph-stats">
        <div class="is-flood" style="--ci-color:${escapeAttr(floodColor)}">
          <span>Flood</span>
          <b>${Number.isFinite(floodHa) ? `${floodHa.toFixed(1)} ha` : "—"}</b>
        </div>
        <div class="is-water" style="--ci-color:${escapeAttr(waterColor)}">
          <span>Water</span>
          <b>${Number.isFinite(waterHa) ? `${waterHa.toFixed(1)} ha` : "—"}</b>
        </div>
      </div>
      <div class="climate-impact-graph-bars" role="tablist" aria-label="Period areas">${bars}</div>
      ${showWrd && wrdReady ? wrdLegendHtml() : ""}`;

    graphEl.querySelectorAll(".climate-impact-graph-bar[data-period]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.period);
        if (!Number.isFinite(id) || id === periodId || busy) return;
        periodId = id;
        renderPeriodStepper();
        renderGraph();
        void loadPeriod(periodId);
      });
    });
  }

  function wrdLegendHtml() {
    return `<ul class="climate-impact-graph-wrd" aria-label="WRD legend">
      ${WRD_FLOODLINE_LEGEND.map(
        (item) =>
          `<li><i style="--ci-color:${escapeAttr(item.color)}"></i><span>${escapeHtml(item.label)}</span></li>`,
      ).join("")}
    </ul>`;
  }

  async function loadPeriod(id) {
    const serial = ++loadSerial;
    try {
      const payload = await fetchClimateImpactPeriod(id);
      if (serial !== loadSerial) return;
      window.__MM_SCENE__?.showClimateImpact?.(payload, {
        flood: showFlood,
        water: showWater,
        wrd: showWrd && wrdReady,
      });
      if (serial === loadSerial) renderGraph();
    } catch (err) {
      if (serial !== loadSerial) return;
      console.warn("[climate-impact] period", err?.message || err);
      graphEl.innerHTML = `<p class="climate-impact-graph-status is-error">${escapeHtml(err?.message || "Period unavailable")}</p>`;
    }
  }

  async function loadWrdLines() {
    try {
      const geo = await fetchWrdFloodLines();
      if (!open) return;
      const info = window.__MM_SCENE__?.setClimateImpactWrdLines?.(geo, showWrd);
      if (!info?.wrdLoaded && !info?.nWrd) {
        throw new Error("WRD lines projected to zero segments");
      }
      wrdReady = true;
      applyVisibility();
      renderClasses();
      renderGraph();
    } catch (err) {
      wrdReady = false;
      showWrd = false;
      console.warn("[climate-impact] WRD lines", err?.message || err);
      applyVisibility();
      renderClasses();
      renderGraph();
    }
  }

  function applyVisibility() {
    window.__MM_SCENE__?.setClimateImpactClasses?.({
      flood: showFlood,
      water: showWater,
      wrd: showWrd && wrdReady,
    });
  }

  backEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hide();
  });

  return {
    show,
    hide,
    isOpen,
    dispose() {
      hide();
      backEl.remove();
      classesEl.remove();
      yearEl.remove();
      graphEl.remove();
    },
  };
}

function shortPeriod(label) {
  if (label == null) return "—";
  const s = String(label);
  if (s.length <= 8) return s;
  return `${s.slice(0, 7)}…`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
