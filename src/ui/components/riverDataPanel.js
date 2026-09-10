import { Droplets, Ruler, ChevronRight, X } from "lucide";
import { lucideHtml } from "../icons.js";
import { interpolateChainage } from "../../geo/chainage.js";
import { metersToStation } from "../../scene/chainageMarkers.js";
import { nearestStationU, stationAt } from "../../scene/riverCamera.js";

/**
 * Compact River Data HUD.
 * Default: station + Depth/Width rows only.
 * Depth / Width open an attached profile popup (overlay — no layout reflow).
 */
export function mountRiverDataPanel(root, dataset) {
  const el = document.createElement("aside");
  el.className = "hud river-data-panel";
  el.id = "river-data-panel";
  el.innerHTML = `
    <div class="river-data-heading"><span>RIVER DATA</span></div>
    <div class="river-data-station" id="river-data-station">—</div>
    <div class="river-data-rows" role="group" aria-label="River measurements">
      <button type="button" class="river-data-row" id="depth-survey-btn" data-profile="depth" aria-expanded="false" title="Depth profile">
        <span class="river-data-row-icon" aria-hidden="true">${lucideHtml(Droplets, { size: 15 })}</span>
        <span class="river-data-row-label">Depth</span>
        <span class="river-data-row-value" id="river-data-depth" style="font-size:22px;font-weight:700;line-height:1.05;font-family:ui-monospace,SFMono-Regular,Consolas,monospace">—</span>
        <span class="river-data-row-action" aria-hidden="true">${lucideHtml(ChevronRight, { size: 14 })}</span>
      </button>
      <button type="button" class="river-data-row" id="width-profile-btn" data-profile="width" aria-expanded="false" title="Width profile">
        <span class="river-data-row-icon" aria-hidden="true">${lucideHtml(Ruler, { size: 15 })}</span>
        <span class="river-data-row-label">Width</span>
        <span class="river-data-row-value" id="river-data-width" style="font-size:22px;font-weight:700;line-height:1.05;font-family:ui-monospace,SFMono-Regular,Consolas,monospace">—</span>
        <span class="river-data-row-action" aria-hidden="true">${lucideHtml(ChevronRight, { size: 14 })}</span>
      </button>
    </div>
    <div class="river-profile-popup" id="river-profile-popup" hidden aria-hidden="true">
      <div class="river-profile-popup-inner" role="dialog" aria-modal="false" aria-labelledby="river-profile-title">
        <header class="river-profile-header">
          <div>
            <h2 class="river-profile-title" id="river-profile-title">DEPTH PROFILE</h2>
            <p class="river-profile-meta">
              <span id="river-profile-station">—</span>
              <span class="river-profile-sep">·</span>
              <strong id="river-profile-value">—</strong>
            </p>
          </div>
          <button type="button" class="river-profile-close" id="river-profile-close" aria-label="Close profile">
            ${lucideHtml(X, { size: 16 })}
          </button>
        </header>
        <div class="river-profile-chart" id="river-profile-chart"></div>
        <div class="river-profile-axes">
          <span>Chainage</span>
          <span id="river-profile-y-label">Depth (m)</span>
        </div>
      </div>
    </div>
  `;
  root.appendChild(el);

  const depthBtn = el.querySelector("#depth-survey-btn");
  const widthBtn = el.querySelector("#width-profile-btn");
  const popup = el.querySelector("#river-profile-popup");
  const titleEl = el.querySelector("#river-profile-title");
  const stationEl = el.querySelector("#river-profile-station");
  const valueEl = el.querySelector("#river-profile-value");
  const chartEl = el.querySelector("#river-profile-chart");
  const yLabelEl = el.querySelector("#river-profile-y-label");
  const closeBtn = el.querySelector("#river-profile-close");

  let current = null;
  /** @type {null | "depth" | "width"} */
  let openKind = null;
  let closingTimer = 0;
  let profileRaf = 0;

  function setRowActive(kind) {
    depthBtn.classList.toggle("is-active", kind === "depth");
    widthBtn.classList.toggle("is-active", kind === "width");
    depthBtn.setAttribute("aria-expanded", kind === "depth" ? "true" : "false");
    widthBtn.setAttribute("aria-expanded", kind === "width" ? "true" : "false");
  }

  function buildSeries(kind) {
    const profiles = dataset?.nadiTwinProfiles;
    if (kind === "depth") {
      const raw = profiles?.depth;
      if (raw?.length) return sampleProfile(raw, "depth_m", 120);
      return buildBathymetryDepthSeries(dataset);
    }
    const raw = profiles?.chainage;
    if (raw?.length) return sampleProfile(raw, "width_m", 120);
    return buildCorridorWidthSeries(dataset);
  }

  function renderPopupContent(kind) {
    if (!current) return;
    try {
      const isDepth = kind === "depth";
      titleEl.textContent = isDepth ? "DEPTH PROFILE" : "WIDTH PROFILE";
      yLabelEl.textContent = isDepth ? "Depth (m)" : "Width (m)";
      stationEl.textContent = `${current.label || "—"} selected`;
      valueEl.textContent = isDepth ? current.depthText : current.widthText;
      const series = buildSeries(kind);
      const selectedMeters = Number(current.meters) || 0;
      const selectedValue = isDepth ? current.depth : current.width;
      chartEl.innerHTML = profileSvg(series, selectedMeters, selectedValue, isDepth ? "#5bc8e8" : "#7dd3a8");
    } catch (err) {
      console.warn("[river-data] profile render failed", err);
      chartEl.innerHTML = `<p class="river-profile-empty">Profile unavailable.</p>`;
    }
  }

  function openPopup(kind) {
    if (!current) return;
    window.clearTimeout(closingTimer);
    openKind = kind;
    setRowActive(kind);
    renderPopupContent(kind);
    popup.hidden = false;
    popup.setAttribute("aria-hidden", "false");
    // Force reflow so enter transition runs
    void popup.offsetWidth;
    popup.classList.add("is-open");
  }

  function closePopup({ immediate = false } = {}) {
    if (!openKind && popup.hidden) return;
    openKind = null;
    setRowActive(null);
    popup.classList.remove("is-open");
    popup.setAttribute("aria-hidden", "true");
    if (immediate) {
      popup.hidden = true;
      return;
    }
    window.clearTimeout(closingTimer);
    closingTimer = window.setTimeout(() => {
      if (!popup.classList.contains("is-open")) popup.hidden = true;
    }, 260);
  }

  function toggleProfile(kind) {
    if (openKind === kind) {
      closePopup();
      return;
    }
    openPopup(kind);
  }

  depthBtn.addEventListener("click", () => toggleProfile("depth"));
  widthBtn.addEventListener("click", () => toggleProfile("width"));
  closeBtn.addEventListener("click", () => closePopup());

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
    const width = Number.isFinite(profilePoint?.width_m)
      ? profilePoint.width_m
      : Number.isFinite(station?.width)
        ? station.width
        : Number.isFinite(station?.half)
          ? station.half * 2
          : null;

    const label = p.label || profilePoint?.chainage_m || metersToStation(p.meters);
    const depthText = Number.isFinite(depth) ? `${depth.toFixed(2)} m` : "—";
    const widthText = Number.isFinite(width) ? `${width.toFixed(1)} m` : "—";
    const qualityText = depthPoint?.flagged || depthPoint?.nearest_survey_m > 60
      ? "LOW CONFIDENCE"
      : depthPoint?.nearest_survey_m < 1
        ? "SURVEY DATA"
        : "INTERPOLATED";
    const nearestSurveyText = Number.isFinite(depthPoint?.nearest_survey_m)
      ? `${depthPoint.nearest_survey_m.toFixed(1)} m`
      : "—";

    el.querySelector("#river-data-station").textContent = label || "—";
    el.querySelector("#river-data-depth").textContent = depthText;
    el.querySelector("#river-data-width").textContent = widthText;

    current = {
      ...p,
      label,
      widthText,
      depthText,
      qualityText,
      nearestSurveyText,
      depth,
      width,
      u,
    };

    // Defer chart rebuild so chainage-select handlers stay responsive.
    if (openKind && popup.classList.contains("is-open")) {
      stationEl.textContent = `${label || "—"} selected`;
      valueEl.textContent = openKind === "depth" ? depthText : widthText;
      if (profileRaf) cancelAnimationFrame(profileRaf);
      const kind = openKind;
      profileRaf = requestAnimationFrame(() => {
        profileRaf = 0;
        if (openKind === kind) renderPopupContent(kind);
      });
    }
    return current;
  }

  return { el, update, closeProfile: () => closePopup({ immediate: true }) };
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
  return Math.abs(points[lo].chainage_m - meters) <= Math.abs(points[hi].chainage_m - meters)
    ? points[lo]
    : points[hi];
}

function sampleProfile(points, valueKey, maxPoints) {
  if (!points?.length) return [];
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  const out = [];
  for (let i = 0; i < points.length; i += step) {
    const meters = Number(points[i].chainage_m);
    const value = Number(points[i][valueKey]);
    if (Number.isFinite(meters) && Number.isFinite(value)) out.push({ meters, value });
  }
  const last = points[points.length - 1];
  const lastMeters = Number(last?.chainage_m);
  const lastValue = Number(last?.[valueKey]);
  if (
    Number.isFinite(lastMeters) &&
    Number.isFinite(lastValue) &&
    (!out.length || out[out.length - 1].meters !== lastMeters)
  ) {
    out.push({ meters: lastMeters, value: lastValue });
  }
  return out;
}

function downsampleSeries(points, maxPoints) {
  const valid = points.filter((p) => Number.isFinite(p.meters) && Number.isFinite(p.value));
  if (valid.length <= maxPoints) return valid;
  const step = Math.ceil(valid.length / maxPoints);
  const out = [];
  for (let i = 0; i < valid.length; i += step) out.push(valid[i]);
  const last = valid[valid.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function buildBathymetryDepthSeries(dataset) {
  const stations = dataset?.corridor?.stations || [];
  const depths = dataset?.bathymetry?.depths;
  if (!stations.length || !depths?.length) return [];
  const cols = (dataset.bathymetry?.across || 40) + 1;
  const out = [];
  const step = Math.max(1, Math.ceil(stations.length / 100));
  for (let i = 0; i < stations.length; i += step) {
    const centerIndex = i * cols + Math.floor((cols - 1) / 2);
    const value = depths[centerIndex];
    if (!Number.isFinite(value)) continue;
    const meters = Number(stations[i].along) || i;
    out.push({ meters, value });
  }
  return out;
}

function buildCorridorWidthSeries(dataset) {
  const stations = dataset?.corridor?.stations || [];
  if (!stations.length) return [];
  const out = [];
  const step = Math.max(1, Math.ceil(stations.length / 100));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const value = Number.isFinite(s.width) ? s.width : Number.isFinite(s.half) ? s.half * 2 : null;
    if (!Number.isFinite(value)) continue;
    out.push({ meters: Number(s.along) || i, value });
  }
  return out;
}

function profileSvg(series, selectedMeters, selectedValue, color) {
  if (!series.length) {
    return `<p class="river-profile-empty">No profile data available.</p>`;
  }
  const w = 320;
  const h = 118;
  const padL = 34;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const xs = series.map((p) => p.meters);
  const ys = series.map((p) => p.value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const toX = (m) => padL + ((m - minX) / spanX) * plotW;
  const toY = (v) => padT + plotH - ((v - minY) / spanY) * plotH;

  const poly = series.map((p) => `${toX(p.meters).toFixed(1)},${toY(p.value).toFixed(1)}`).join(" ");
  const selX = toX(selectedMeters);
  const selY = Number.isFinite(selectedValue) ? toY(selectedValue) : toY((minY + maxY) / 2);
  const yTicks = [minY, (minY + maxY) / 2, maxY];

  return `<svg class="river-profile-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Profile chart">
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(120,200,220,0.25)" stroke-width="1"/>
    <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="rgba(120,200,220,0.25)" stroke-width="1"/>
    ${yTicks.map((v) => {
      const y = toY(v);
      return `<text x="${padL - 4}" y="${y + 3}" text-anchor="end" class="river-profile-tick">${v.toFixed(1)}</text>
      <line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="rgba(120,200,220,0.08)" stroke-width="1"/>`;
    }).join("")}
    <polyline points="${poly}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${selX}" y1="${padT}" x2="${selX}" y2="${padT + plotH}" stroke="rgba(125,211,252,0.55)" stroke-width="1.5" stroke-dasharray="3 3"/>
    <circle cx="${selX}" cy="${selY}" r="4.5" fill="${color}" stroke="#eaf8fb" stroke-width="1.5"/>
    <text x="${padL}" y="${h - 4}" class="river-profile-tick">${formatChainageAxis(minX)}</text>
    <text x="${padL + plotW}" y="${h - 4}" text-anchor="end" class="river-profile-tick">${formatChainageAxis(maxX)}</text>
  </svg>`;
}

function formatChainageAxis(meters) {
  if (!Number.isFinite(meters)) return "—";
  return metersToStation(meters);
}
