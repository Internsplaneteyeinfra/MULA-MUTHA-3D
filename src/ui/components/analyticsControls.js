import { Droplets, TrendingUp, Database, Waves, Home, Mountain } from "lucide";
import { lucideHtml } from "../icons.js";
import { mountGeologyWorkspace } from "./geologyWorkspace.js";
import {
  FORECAST_HORIZONS,
  forecastProfile,
  downsampleProfile,
} from "../../services/forecastService.js";
import { metersToStation } from "../../scene/chainageMarkers.js";

const HYDROLOGY_CATEGORIES = [
  { id: "geology", name: "GEOLOGY" },
  { id: "water_quality", name: "WATER QUALITY" },
  { id: "salinity", name: "SALINITY" },
  { id: "pollution", name: "POLLUTION" },
  { id: "landuse", name: "LAND USE" },
  { id: "aqi", name: "AQI" },
];

/**
 * Top analytics nav: Home | Geology | Hydrology | Hydrograph | Data Simulations | Flood Analysis.
 * Geology opens the horizontal glass workspace (not a modal).
 */
export function mountAnalyticsControls(root, dataset) {
  const el = document.createElement("nav");
  el.className = "analytics-controls top-navigation";
  el.setAttribute("aria-label", "River analytics");
  el.innerHTML = [
    [Home, "Home", "home"],
    [Mountain, "Geology", "geology"],
    [Droplets, "Hydrology", "hydrology"],
    [TrendingUp, "Hydrograph", "hydrograph"],
    [Database, "Data Simulations", "simulations"],
    [Waves, "Flood Analysis", "flood"],
  ]
    .map(
      ([icon, label, type]) =>
        `<button type="button" class="nav-button" data-analytics="${type}" title="${label}" aria-pressed="false">` +
        `<span class="nav-button-icon" aria-hidden="true">${lucideHtml(icon, { size: 15 })}</span>` +
        `<span class="nav-button-label">${label}</span></button>`,
    )
    .join("");
  root.appendChild(el);

  const geology = mountGeologyWorkspace(root);

  const modal = document.createElement("div");
  modal.className = "river-analysis-modal-backdrop";
  modal.hidden = true;
  modal.innerHTML = `
    <section class="river-analysis-modal analytics-modal" role="dialog" aria-modal="true" aria-labelledby="analytics-title">
      <button type="button" class="river-analysis-close" aria-label="Close">×</button>
      <h2 id="analytics-title"></h2>
      <div id="analytics-body"></div>
    </section>`;
  root.appendChild(modal);

  const hydroLegend = document.createElement("aside");
  hydroLegend.className = "hydro-legend-hud";
  hydroLegend.hidden = true;
  hydroLegend.setAttribute("aria-live", "polite");
  root.appendChild(hydroLegend);

  let selectedMeters = dataset?.chainage?.[0]?.meters ?? 0;
  let activeType = null;
  let forecastLead = 24;
  let forecastCache = null;
  let forecastRequestId = 0;
  let activeHydroId = null;

  document.addEventListener("chainage-select", (event) => {
    if (event.detail?.meters == null) return;
    selectedMeters = event.detail.meters;
    if (activeType === "forecast" && forecastCache && !modal.hidden) {
      renderForecastBody(forecastCache, selectedMeters, forecastLead);
    }
  });

  function setActive(type) {
    activeType = type;
    el.querySelectorAll(".nav-button").forEach((btn) => {
      const on = btn.dataset.analytics === type;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function closeModal() {
    modal.hidden = true;
  }

  function closeAll() {
    closeModal();
    geology.close();
    setActive(null);
  }

  function clearHydroLegend() {
    hydroLegend.hidden = true;
    hydroLegend.innerHTML = "";
  }

  function renderHydroLegend(result) {
    if (!result?.available || !result.legend) {
      clearHydroLegend();
      return;
    }
    const leg = result.legend;
    if (leg.type === "image") {
      hydroLegend.innerHTML = `
        <div class="hydro-legend-hud-title">${escapeHtml(leg.title || "GEOLOGY")}</div>
        <img src="${escapeHtml(leg.url)}" alt="Geology legend" class="hydro-legend-hud-img"/>
        <button type="button" class="hydro-legend-clear" id="hydro-clear-layer">Clear layer</button>`;
    } else if (leg.type === "classes") {
      const rows = (leg.classes || [])
        .map(
          (c) =>
            `<div class="hydro-legend-hud-row"><span class="hydro-swatch" style="background:${c.color}"></span>` +
            `<span>${escapeHtml(c.label)}${c.range ? ` <small>(${escapeHtml(c.range)})</small>` : ""}</span></div>`,
        )
        .join("");
      hydroLegend.innerHTML = `
        <div class="hydro-legend-hud-title">${escapeHtml(leg.title || "SALINITY")}</div>
        ${rows}
        <button type="button" class="hydro-legend-clear" id="hydro-clear-layer">Clear layer</button>`;
    } else {
      clearHydroLegend();
      return;
    }
    hydroLegend.hidden = false;
    hydroLegend.querySelector("#hydro-clear-layer")?.addEventListener("click", () => {
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = null;
      clearHydroLegend();
      if (activeType === "hydrology" && !modal.hidden) openHydrology();
    });
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
      if (activeType !== "geology") setActive(null);
    }
  });
  modal.querySelector(".river-analysis-close").addEventListener("click", () => {
    closeModal();
    if (activeType !== "geology") setActive(null);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!modal.hidden) {
      closeModal();
      if (activeType !== "geology") setActive(null);
    } else if (geology.isOpen()) {
      closeAll();
    }
  });

  el.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-analytics]");
    if (!button) return;
    const type = button.dataset.analytics;

    if (type === "home") {
      closeAll();
      window.__MM_SCENE__?.hideHydrology?.();
      clearHydroLegend();
      setActive(null);
      return;
    }

    if (type === "geology") {
      closeModal();
      clearHydroLegend();
      setActive("geology");
      geology.open();
      return;
    }

    geology.close();
    setActive(type);
    modal.hidden = false;

    if (type === "hydrology") {
      modal.querySelector("#analytics-title").textContent = "HYDROLOGY";
      await openHydrology();
      return;
    }

    if (type === "forecast") {
      modal.querySelector("#analytics-title").textContent = "FORECAST";
      await openForecast();
      return;
    }

    const labels = {
      hydrograph: "HYDROGRAPH",
      simulations: "DATA SIMULATIONS",
      flood: "MODELLED FLOOD SCENARIO",
    };
    modal.querySelector("#analytics-title").textContent = labels[type] || type.toUpperCase();
    modal.querySelector("#analytics-body").innerHTML =
      `<p class="analytics-status">Loading model data…</p>`;
    try {
      const payload = await loadLegacyAnalytics(type, selectedMeters, dataset);
      if (activeType !== type) return;
      modal.querySelector("#analytics-body").innerHTML = legacyMarkup(
        type,
        payload,
        selectedMeters,
      );
    } catch (error) {
      if (activeType !== type) return;
      modal.querySelector("#analytics-body").innerHTML = `
        <p class="analytics-unavailable">${escapeHtml(error.message || "Service unavailable")}</p>
        <p class="analytics-note">This modelled analytics endpoint is not available in the production build.</p>`;
    }
  });

  async function openHydrology() {
    const body = modal.querySelector("#analytics-body");
    body.innerHTML = `
      <div class="hydro-panel">
        <p class="model-badge">THEMATIC HYDROLOGY · MULA–MUTHA</p>
        <p class="analytics-note">Select one category. Layers are mutually exclusive.</p>
        <div class="hydro-cat-grid" id="hydro-cat-grid">
          ${HYDROLOGY_CATEGORIES.map(
            (c) =>
              `<button type="button" class="hydro-cat-btn${activeHydroId === c.id ? " is-active" : ""}" data-hydro="${c.id}">${c.name}</button>`,
          ).join("")}
        </div>
        <div id="hydro-status" class="hydro-status" hidden></div>
      </div>`;

    body.querySelectorAll("[data-hydro]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.hydro;
        const status = body.querySelector("#hydro-status");
        status.hidden = false;
        status.textContent = "Loading…";
        body.querySelectorAll(".hydro-cat-btn").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.hydro === id);
        });
        try {
          const result = await window.__MM_SCENE__?.showHydrologyLayer?.(id);
          if (!result) throw new Error("Hydrology layer manager not ready");
          activeHydroId = id;
          if (!result.available) {
            status.hidden = false;
            status.innerHTML = `
              <div class="hydro-unavail">
                <strong>${escapeHtml(result.message || "DATA UNAVAILABLE")}</strong>
                ${result.reason ? `<p>${escapeHtml(result.reason)}</p>` : ""}
              </div>`;
            clearHydroLegend();
            return;
          }
          status.hidden = true;
          renderHydroLegend(result);
          if (result.stats) {
            console.info("[hydrology]", id, result.stats);
            const v = window.__MM_SCENE__?.validateHydrologyExtent?.();
            if (v) console.info("[hydrology] extent check", v);
          }
        } catch (err) {
          status.hidden = false;
          status.innerHTML = `<div class="hydro-unavail"><strong>Unable to load layer</strong><p>${escapeHtml(err.message || String(err))}</p></div>`;
          clearHydroLegend();
        }
      });
    });
  }

  async function openForecast() {
    const reqId = ++forecastRequestId;
    modal.querySelector("#analytics-body").innerHTML =
      `<p class="analytics-status">Loading forecast…</p>`;
    try {
      const raw = await forecastProfile(forecastLead);
      if (reqId !== forecastRequestId || activeType !== "forecast") return;
      forecastCache = raw;
      renderForecastBody(raw, selectedMeters, forecastLead);
    } catch (error) {
      if (reqId !== forecastRequestId || activeType !== "forecast") return;
      forecastCache = null;
      modal.querySelector("#analytics-body").innerHTML = `
        <div class="forecast-panel">
          <p class="analytics-unavailable">Forecast service unavailable</p>
          <p class="analytics-note">Unable to retrieve model forecast.</p>
          <button type="button" class="forecast-retry" id="forecast-retry">Retry</button>
        </div>`;
      modal.querySelector("#forecast-retry")?.addEventListener("click", () => openForecast());
    }
  }

  function renderForecastBody(raw, meters, lead) {
    const data = downsampleProfile(raw, 160, meters);
    const station = metersToStation(meters);
    const body = modal.querySelector("#analytics-body");
    body.innerHTML = `
      <div class="forecast-panel">
        <p class="model-badge">MODEL FORECAST · P10–P90 uncertainty</p>
        <p class="forecast-subtitle">Water Level Forecast · Water Surface Elevation / Stage</p>
        <div class="forecast-horizons" role="group" aria-label="Forecast horizon">
          <span class="forecast-horizons-label">Forecast horizon</span>
          ${FORECAST_HORIZONS.map(
            (h) =>
              `<button type="button" class="forecast-horizon-btn${h === lead ? " is-active" : ""}" data-lead="${h}">${h}h</button>`,
          ).join("")}
        </div>
        <div class="forecast-meta">
          <span>Current chainage <strong>${escapeHtml(station)}</strong></span>
          <span>Lead <strong>+${lead} h</strong></span>
        </div>
        ${forecastChartSvg(data, meters)}
        <div class="forecast-legend">
          <span class="forecast-leg forecast-leg--p90">P90</span>
          <span class="forecast-leg forecast-leg--med">Forecast Median</span>
          <span class="forecast-leg forecast-leg--p10">P10</span>
        </div>
      </div>`;

    body.querySelectorAll("[data-lead]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const next = Number(btn.dataset.lead);
        if (!Number.isFinite(next) || next === forecastLead) return;
        forecastLead = next;
        await openForecast();
      });
    });
  }

  return el;
}

/** Remaining analytics still optional / external — Forecast no longer uses this. */
async function loadLegacyAnalytics(type, meters, dataset) {
  const profile = dataset?.chainage || [];
  const cell = nearestIndex(profile, meters);
  const base = typeof import.meta !== "undefined" && import.meta.env?.VITE_ANALYTICS_API_BASE
    ? String(import.meta.env.VITE_ANALYTICS_API_BASE).replace(/\/$/, "")
    : "";
  if (!base) {
    throw new Error("Modelled analytics service not configured");
  }
  if (type === "hydrograph") return fetchJson(`${base}/api/hydrograph?cell=${cell}`);
  if (type === "simulations") return fetchJson(`${base}/api/state`);
  const [margins, alerts] = await Promise.all([
    fetchJson(`${base}/api/margins`),
    fetchJson(`${base}/api/alerts`),
  ]);
  return { margins, alerts };
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error(`Analytics endpoint unavailable (${response.status})`);
  return response.json();
}

function legacyMarkup(type, data, meters) {
  if (type === "hydrograph") {
    return `<p class="model-badge">MODELLED HYDROGRAPH</p>${svgChart(data.observed || [], "#7fb8d8", "Modelled history")}${svgChart(data.forecast?.median || [], "#8f78d8", "Modelled forecast")}`;
  }
  if (type === "simulations") {
    return `<p class="model-badge">MODELLED DATA · SIMULATION STATE</p><p><b>Simulation time</b> ${data.q_now != null ? `${data.q_now} discharge units` : "Available"}</p><p><b>Water surface stations</b> ${data.wse?.length ?? 0}</p>`;
  }
  return `<p class="model-badge">MODELLED FLOOD SCENARIO</p><p><b>Landmark margins</b> ${data.margins?.length ?? 0}</p><p><b>Active modelled alerts</b> ${data.alerts?.length ?? 0}</p><p><b>Selected chainage</b> ${Math.round(meters)} m</p>`;
}

function forecastChartSvg(data, selectedMeters) {
  const med = (data.median || []).map(Number);
  const p10 = (data.p10 || []).map(Number);
  const p90 = (data.p90 || []).map(Number);
  const ch = (data.chainage_m || []).map(Number);
  if (!med.length || med.length !== p10.length || med.length !== p90.length) {
    return `<p class="analytics-note">No forecast series available.</p>`;
  }

  const w = 520;
  const h = 200;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const all = [...med, ...p10, ...p90].filter(Number.isFinite);
  const minY = Math.min(...all);
  const maxY = Math.max(...all);
  const spanY = maxY - minY || 1;
  const minX = ch[0] ?? 0;
  const maxX = ch[ch.length - 1] ?? 1;
  const spanX = maxX - minX || 1;

  const toX = (meters) => padL + ((meters - minX) / spanX) * plotW;
  const toY = (v) => padT + plotH - ((v - minY) / spanY) * plotH;

  const poly = (arr) =>
    arr
      .map((v, i) => `${toX(ch[i]).toFixed(1)},${toY(v).toFixed(1)}`)
      .join(" ");

  // Uncertainty envelope (p90 top → p10 bottom reversed)
  const band = [
    ...p90.map((v, i) => `${toX(ch[i]).toFixed(1)},${toY(v).toFixed(1)}`),
    ...[...p10]
      .map((v, i) => ({ v, i }))
      .reverse()
      .map(({ v, i }) => `${toX(ch[i]).toFixed(1)},${toY(v).toFixed(1)}`),
  ].join(" ");

  let selX = null;
  let selY = null;
  let selLabel = "";
  if (Number.isFinite(selectedMeters) && ch.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < ch.length; i += 1) {
      const d = Math.abs(ch[i] - selectedMeters);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    selX = toX(ch[best]);
    selY = toY(med[best]);
    selLabel = metersToStation(ch[best]);
  }

  const yTicks = [minY, (minY + maxY) / 2, maxY];

  return `<div class="forecast-chart analytics-chart">
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Water surface elevation forecast along chainage">
      <text x="12" y="${padT + plotH / 2}" class="forecast-axis-label" transform="rotate(-90 12 ${padT + plotH / 2})">WSE (m)</text>
      ${yTicks
        .map((v) => {
          const y = toY(v);
          return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="rgba(120,200,220,0.1)" />
            <text x="${padL - 6}" y="${y + 3}" text-anchor="end" class="forecast-tick">${v.toFixed(2)}</text>`;
        })
        .join("")}
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="rgba(120,200,220,0.28)" />
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(120,200,220,0.28)" />
      <polygon points="${band}" fill="rgba(91,200,232,0.16)" stroke="none" />
      <polyline points="${poly(p90)}" fill="none" stroke="rgba(125,211,252,0.55)" stroke-width="1.2" stroke-dasharray="4 3" />
      <polyline points="${poly(p10)}" fill="none" stroke="rgba(125,211,252,0.55)" stroke-width="1.2" stroke-dasharray="4 3" />
      <polyline points="${poly(med)}" fill="none" stroke="#5bc8e8" stroke-width="2.4" stroke-linejoin="round" />
      ${
        selX != null
          ? `<line x1="${selX}" y1="${padT}" x2="${selX}" y2="${padT + plotH}" stroke="rgba(245,158,11,0.7)" stroke-width="1.5" stroke-dasharray="3 3" />
             <circle cx="${selX}" cy="${selY}" r="5" fill="#f59e0b" stroke="#eaf8fb" stroke-width="1.5" />
             <text x="${selX}" y="${padT + 12}" text-anchor="middle" class="forecast-sel-label">${escapeHtml(selLabel)}</text>`
          : ""
      }
      <text x="${padL}" y="${h - 6}" class="forecast-tick">${formatCh(minX)}</text>
      <text x="${padL + plotW}" y="${h - 6}" text-anchor="end" class="forecast-tick">${formatCh(maxX)}</text>
      <text x="${padL + plotW / 2}" y="${h - 6}" text-anchor="middle" class="forecast-axis-label">Chainage</text>
    </svg>
  </div>`;
}

function formatCh(meters) {
  if (!Number.isFinite(meters)) return "—";
  return metersToStation(meters);
}

function svgChart(values, color, label) {
  if (!values.length) return `<p class="analytics-note">No series available.</p>`;
  const nums = values.map(Number).filter(Number.isFinite);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const points = nums
    .map((value, i) => `${(i / Math.max(1, nums.length - 1)) * 320},${84 - ((value - min) / span) * 68}`)
    .join(" ");
  return `<div class="analytics-chart"><svg viewBox="0 0 320 92" role="img" aria-label="${label}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" /></svg><small>${label}</small></div>`;
}

function nearestIndex(points, meters) {
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const d = Math.abs((points[i].meters ?? 0) - meters);
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]),
  );
}
