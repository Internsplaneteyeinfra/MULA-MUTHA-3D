import { MapPin, Droplets, Ruler, X } from "lucide";
import { lucideHtml } from "../icons.js";
import { interpolateChainage } from "../../geo/chainage.js";
import { nearestStationU, stationAt } from "../../scene/riverCamera.js";

export function mountRiverDataPanel(root, dataset) {
  const el = document.createElement("aside");
  el.className = "hud river-data-panel map-chrome";
  el.id = "river-data-panel";
  el.innerHTML = `
    <div class="river-data-heading">${lucideHtml(MapPin, { size: 14 })}<span>RIVER DATA</span></div>
    <div class="river-data-station" id="river-data-station">—</div>
    <div class="river-data-grid">
      <span>Station</span><b id="river-data-distance">—</b>
      <span>Depth</span><b class="river-data-action-value"><span id="river-data-depth">—</span><button class="river-data-icon" id="depth-survey-btn" title="Depth Survey" aria-label="Depth Survey">${lucideHtml(Droplets, { size: 17 })}</button></b>
      <span>Width</span><b class="river-data-action-value"><span id="river-data-width">—</span><button class="river-data-icon" id="width-profile-btn" title="Width Profile" aria-label="Width Profile">${lucideHtml(Ruler, { size: 17 })}</button></b>
      <span>Coordinates</span><b id="river-data-coords">—</b>
      <span>Quality</span><b id="river-data-quality">—</b>
    </div>
  `;
  root.appendChild(el);

  const modal = document.createElement("div");
  modal.className = "river-analysis-modal-backdrop";
  modal.hidden = true;
  modal.innerHTML = `<section class="river-analysis-modal" role="dialog" aria-modal="true"><button class="river-analysis-close" aria-label="Close">${lucideHtml(X, { size: 18 })}</button><h2 id="river-analysis-title"></h2><div id="river-analysis-body"></div></section>`;
  root.appendChild(modal);
  let current = null;
  const closeModal = () => { modal.hidden = true; };
  modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
  modal.querySelector(".river-analysis-close").addEventListener("click", closeModal);
  function openModal(kind) {
    if (!current) return;
    modal.querySelector("#river-analysis-title").textContent = kind === "depth" ? "DEPTH SURVEY" : "WIDTH PROFILE";
    modal.querySelector("#river-analysis-body").innerHTML = kind === "depth"
      ? `<p><b>Station</b> ${current.label}</p><p><b>Depth</b> ${current.depthText}</p><p><b>Data source</b> ${current.qualityText}</p><p><b>Nearest survey point</b> ${current.nearestSurveyText}</p><p><b>Data quality</b> ${current.qualityText}</p><p><b>Raw survey points</b> ${dataset.points?.length?.toLocaleString?.() || "11,580"}</p>`
      : `<p><b>Current station</b> ${current.label}</p><p><b>Current width</b> ${current.widthText}</p><p><b>Source</b> chainage_profile.json · KML-derived width</p>`;
    modal.hidden = false;
  }
  el.querySelector("#depth-survey-btn").addEventListener("click", () => openModal("depth"));
  el.querySelector("#width-profile-btn").addEventListener("click", () => openModal("width"));

  function update(meters) {
    const p = typeof meters === "object" ? meters : interpolateChainage(dataset.chainage, meters);
    if (!p) return null;
    const stations = dataset.corridor?.stations || [];
    const profiles = dataset.nadiTwinProfiles;
    const profilePoint = profiles ? nearestByMeters(profiles.chainage, p.meters) : null;
    const depthPoint = profiles ? nearestByMeters(profiles.depth, p.meters) : null;
    const u = p.x != null && p.z != null ? nearestStationU(stations, p.x, p.z) : 0;
    const station = stations.length ? stationAt(stations, u) : null;
    const cols = (dataset.bathymetry?.across || 40) + 1;
    const row = Math.min(stations.length - 1, Math.max(0, Math.round(u * Math.max(0, stations.length - 1))));
    const centerIndex = row * cols + Math.floor((cols - 1) / 2);
    const depth = Number.isFinite(depthPoint?.depth_m) ? depthPoint.depth_m : dataset.bathymetry?.depths?.[centerIndex];
    el.querySelector("#river-data-station").textContent = p.label || "—";
    el.querySelector("#river-data-distance").textContent = p.label || `${Math.round(p.meters)} m`;
    el.querySelector("#river-data-depth").textContent = Number.isFinite(depth) ? `${depth.toFixed(2)} m` : "No survey value";
    const width = Number.isFinite(profilePoint?.width_m)
      ? profilePoint.width_m
      : Number.isFinite(station?.width)
      ? station.width
      : Number.isFinite(station?.half)
        ? station.half * 2
        : null;
    el.querySelector("#river-data-width").textContent = Number.isFinite(width) ? `${width.toFixed(1)} m` : "—";
    el.querySelector("#river-data-coords").textContent = Number.isFinite(p.lat) && Number.isFinite(p.lon)
      ? `${p.lat.toFixed(5)}° N · ${p.lon.toFixed(5)}° E`
      : "—";
    const qualityText = depthPoint?.flagged || depthPoint?.nearest_survey_m > 60
      ? "LOW CONFIDENCE"
      : depthPoint?.nearest_survey_m < 1
        ? "SURVEY DATA"
        : "INTERPOLATED";
    const nearestSurveyText = Number.isFinite(depthPoint?.nearest_survey_m) ? `${depthPoint.nearest_survey_m.toFixed(1)} m` : "—";
    el.querySelector("#river-data-quality").textContent = qualityText;
    current = { ...p, label: p.label || profilePoint?.chainage_m, widthText: Number.isFinite(width) ? `${width.toFixed(1)} m` : "—", depthText: Number.isFinite(depth) ? `${depth.toFixed(2)} m` : "—", qualityText, nearestSurveyText, depth, width, u };
    return current;
  }

  return { el, update };
}

function nearestByMeters(points, meters) {
  if (!points?.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].chainage_m <= meters) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].chainage_m - meters) <= Math.abs(points[hi].chainage_m - meters) ? points[lo] : points[hi];
}
