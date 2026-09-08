import { CloudRain, TrendingUp, Database, Waves } from "lucide";
import { lucideHtml } from "../icons.js";

export function mountAnalyticsControls(root, dataset) {
  const el = document.createElement("nav");
  el.className = "analytics-controls";
  el.setAttribute("aria-label", "River analytics");
  el.innerHTML = [
    [CloudRain, "Forecast", "forecast"],
    [TrendingUp, "Hydrograph", "hydrograph"],
    [Database, "Data Simulations", "simulations"],
    [Waves, "Flood Analysis", "flood"],
  ].map(([icon, label, type]) => `<button type="button" data-analytics="${type}" title="${label}">${lucideHtml(icon, { size: 16 })}<span>${label}</span></button>`).join("");
  root.appendChild(el);
  const modal = document.createElement("div");
  modal.className = "river-analysis-modal-backdrop";
  modal.hidden = true;
  modal.innerHTML = `<section class="river-analysis-modal analytics-modal" role="dialog" aria-modal="true"><button class="river-analysis-close" aria-label="Close">×</button><h2 id="analytics-title"></h2><div id="analytics-body"></div></section>`;
  root.appendChild(modal);
  let selectedMeters = dataset?.chainage?.[0]?.meters ?? 0;
  document.addEventListener("chainage-select", (event) => { if (event.detail?.meters != null) selectedMeters = event.detail.meters; });
  const close = () => { modal.hidden = true; };
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  modal.querySelector(".river-analysis-close").addEventListener("click", close);
  el.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-analytics]");
    if (!button) return;
    const type = button.dataset.analytics;
    const labels = { forecast: "FORECAST SCENARIO", hydrograph: "HYDROGRAPH", simulations: "DATA SIMULATIONS", flood: "MODELLED FLOOD SCENARIO" };
    modal.querySelector("#analytics-title").textContent = labels[type];
    modal.querySelector("#analytics-body").innerHTML = `<p class="analytics-status">Loading model data…</p>`;
    modal.hidden = false;
    try {
      const payload = await loadAnalytics(type, selectedMeters, dataset);
      modal.querySelector("#analytics-body").innerHTML = analyticsMarkup(type, payload, selectedMeters);
    } catch (error) {
      modal.querySelector("#analytics-body").innerHTML = `<p class="analytics-unavailable">${escapeHtml(error.message || "Analytics service unavailable")}</p><p class="analytics-note">Connect the NadiTwin server to enable modelled analytics.</p>`;
    }
  });
  return el;
}

async function loadAnalytics(type, meters, dataset) {
  const profile = dataset?.chainage || [];
  const cell = nearestIndex(profile, meters);
  const base = "http://localhost:8080";
  if (type === "forecast") return fetchJson(`${base}/api/forecast/profile?lead=24`);
  if (type === "hydrograph") return fetchJson(`${base}/api/hydrograph?cell=${cell}`);
  if (type === "simulations") return fetchJson(`${base}/api/state`);
  const [margins, alerts] = await Promise.all([fetchJson(`${base}/api/margins`), fetchJson(`${base}/api/alerts`)]);
  return { margins, alerts };
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error(`Analytics endpoint unavailable (${response.status})`);
  return response.json();
}

function analyticsMarkup(type, data, meters) {
  if (type === "hydrograph") {
    return `<p class="model-badge">NO LIVE GAUGE CONNECTED · MODELLED HYDROGRAPH</p>${svgChart(data.observed || [], "#7fb8d8", "Modelled history")}${svgChart(data.forecast?.median || [], "#8f78d8", "Modelled forecast")}`;
  }
  if (type === "forecast") return `<p class="model-badge">MODELLED FORECAST · LEAD +${data.lead_h ?? 24} H</p>${svgChart(data.median || [], "#8f78d8", "Forecast median")}`;
  if (type === "simulations") return `<p class="model-badge">MODELLED DATA · SIMULATION STATE</p><p><b>Simulation time</b> ${data.q_now != null ? `${data.q_now} discharge units` : "Available"}</p><p><b>Water surface stations</b> ${data.wse?.length ?? 0}</p>`;
  return `<p class="model-badge">MODELLED FLOOD SCENARIO</p><p><b>Landmark margins</b> ${data.margins?.length ?? 0}</p><p><b>Active modelled alerts</b> ${data.alerts?.length ?? 0}</p><p><b>Selected chainage</b> ${Math.round(meters)} m</p>`;
}

function svgChart(values, color, label) {
  if (!values.length) return `<p class="analytics-note">No series available.</p>`;
  const nums = values.map(Number).filter(Number.isFinite);
  const min = Math.min(...nums); const max = Math.max(...nums); const span = max - min || 1;
  const points = nums.map((value, i) => `${(i / Math.max(1, nums.length - 1)) * 320},${84 - ((value - min) / span) * 68}`).join(" ");
  return `<div class="analytics-chart"><svg viewBox="0 0 320 92" role="img" aria-label="${label}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" /></svg><small>${label}</small></div>`;
}

function nearestIndex(points, meters) {
  let best = 0; let distance = Infinity;
  for (let i = 0; i < points.length; i += 1) { const d = Math.abs((points[i].meters ?? 0) - meters); if (d < distance) { distance = d; best = i; } }
  return best;
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
