/**
 * Centered PROFILE ANALYSIS popup for A→B measurement transect.
 * Dark glass GIS card · SVG chart · graph↔3D cursor sync.
 */
import { X } from "lucide";
import { lucideHtml } from "../icons.js";
import {
  buildMeasurementProfile,
  formatProfileDistance,
  sampleAtDistance,
} from "../../geo/measurementProfile.js";

/**
 * @param {HTMLElement} root
 * @param {object} dataset
 */
export function mountProfileAnalysisPanel(root, dataset) {
  const backdrop = document.createElement("div");
  backdrop.className = "profile-analysis-backdrop map-chrome";
  backdrop.id = "profile-analysis-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");

  const el = document.createElement("aside");
  el.className = "hud profile-analysis-panel";
  el.id = "profile-analysis-panel";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Profile analysis");
  backdrop.appendChild(el);
  root.appendChild(backdrop);

  const toast = document.createElement("div");
  toast.className = "measure-mode-toast map-chrome";
  toast.id = "measure-mode-toast";
  toast.hidden = true;
  toast.setAttribute("role", "status");
  root.appendChild(toast);

  /** @type {object | null} */
  let profile = null;
  let busy = false;

  function setToast(text) {
    if (!text) {
      toast.hidden = true;
      toast.textContent = "";
      return;
    }
    toast.hidden = false;
    toast.textContent = text;
  }

  function hide() {
    backdrop.hidden = true;
    backdrop.setAttribute("aria-hidden", "true");
    el.innerHTML = "";
    profile = null;
    window.__MM_SCENE__?.setDistanceMeasureProfileCursor?.(null);
  }

  async function showFromMeasure(snap) {
    if (!snap?.pointA || !snap?.pointB) {
      hide();
      return;
    }
    if (busy) return;
    busy = true;
    backdrop.hidden = false;
    backdrop.setAttribute("aria-hidden", "false");
    el.innerHTML = `<p class="profile-analysis-loading">Building transect profile…</p>`;
    try {
      profile = await buildMeasurementProfile({
        pointA: snap.pointA,
        pointB: snap.pointB,
        dataset,
      });
      render();
    } catch (err) {
      console.warn("[profile-analysis]", err);
      el.innerHTML = `<p class="profile-analysis-error">Profile unavailable</p>`;
    } finally {
      busy = false;
    }
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) hide();
  });

  function render() {
    if (!profile) return;
    const st = profile.statistics || {};
    const distText = formatProfileDistance(profile.distance_m);
    const hasCoords =
      Number.isFinite(profile.pointA?.lat) &&
      Number.isFinite(profile.pointA?.lon) &&
      Number.isFinite(profile.pointB?.lat) &&
      Number.isFinite(profile.pointB?.lon);

    el.innerHTML = `
      <header class="profile-analysis-head">
        <div class="profile-analysis-title">
          <span aria-hidden="true">📏</span>
          <div>
            <strong>Profile Analysis</strong>
            <p>Point A → Point B · Distance <b>${escapeHtml(distText)}</b></p>
          </div>
        </div>
        <button type="button" class="profile-analysis-close" id="profile-analysis-close" aria-label="Close profile">
          ${lucideHtml(X, { size: 14 })}
        </button>
      </header>
      ${
        profile.error
          ? `<p class="profile-analysis-error">${escapeHtml(profile.error)}</p>`
          : `<div class="profile-analysis-chart" id="profile-analysis-chart">${renderChart(profile)}</div>
             <div class="profile-analysis-tip" id="profile-analysis-tip" hidden></div>
             <div class="profile-analysis-legend">
               <span class="is-terrain">DTM / Terrain</span>
               <span class="is-wse">Water Surface</span>
               <span class="is-bed">River Bed</span>
             </div>`
      }
      <div class="profile-analysis-stats">
        <div><span>Distance</span><b>${escapeHtml(distText)}</b></div>
        <div><span>Max Depth</span><b>${fmtM(st.max_depth_m)}</b></div>
        <div><span>Avg Depth</span><b>${fmtM(st.mean_depth_m)}</b></div>
        <div><span>Width</span><b>${fmtM(st.width_m, 1)}</b></div>
      </div>
      <section class="profile-analysis-conditions">
        <header>Current Conditions</header>
        <div class="profile-analysis-cond-grid">
          <div>
            <span>Discharge</span>
            <b>${st.discharge_m3s != null ? `${Number(st.discharge_m3s).toFixed(1)} m³/s` : "Unavailable"}</b>
            ${st.discharge_label ? `<em class="is-badge">${escapeHtml(st.discharge_label)}</em>` : ""}
          </div>
          <div>
            <span>Water Surface</span>
            <b>${fmtM(st.water_surface_m)}</b>
            ${st.water_surface_quality ? `<em class="is-badge">${escapeHtml(capitalize(st.water_surface_quality))}</em>` : ""}
          </div>
        </div>
        ${
          st.min_terrain_m != null
            ? `<p class="profile-analysis-terrain-meta">DTM / Terrain · Min ${fmtM(st.min_terrain_m)} · Max ${fmtM(st.max_terrain_m)} · Δ ${fmtM(st.terrain_delta_m)}</p>`
            : ""
        }
      </section>
      ${
        hasCoords
          ? `<section class="profile-analysis-points">
              <div>
                <strong>Point A</strong>
                <span>Lat ${Number(profile.pointA.lat).toFixed(6)}</span>
                <span>Lon ${Number(profile.pointA.lon).toFixed(6)}</span>
              </div>
              <div>
                <strong>Point B</strong>
                <span>Lat ${Number(profile.pointB.lat).toFixed(6)}</span>
                <span>Lon ${Number(profile.pointB.lon).toFixed(6)}</span>
              </div>
            </section>`
          : ""
      }
      <footer class="profile-analysis-actions">
        <button type="button" class="profile-analysis-btn is-clear" id="profile-analysis-clear">Clear</button>
        <button type="button" class="profile-analysis-btn is-exit" id="profile-analysis-exit">Exit Measure</button>
      </footer>
    `;

    el.querySelector("#profile-analysis-close")?.addEventListener("click", () => {
      hide();
    });
    el.querySelector("#profile-analysis-clear")?.addEventListener("click", () => {
      window.__MM_SCENE__?.clearDistanceMeasure?.();
      hide();
      setToast("📏 Measure Mode · Select first point");
      document.dispatchEvent(new CustomEvent("profile-analysis-cleared"));
    });
    el.querySelector("#profile-analysis-exit")?.addEventListener("click", () => {
      hide();
      setToast("");
      document.dispatchEvent(new CustomEvent("profile-analysis-exit"));
    });

    const chart = el.querySelector("#profile-analysis-chart");
    const tip = el.querySelector("#profile-analysis-tip");
    chart?.addEventListener("pointermove", (e) => onChartMove(e, chart, tip));
    chart?.addEventListener("pointerleave", () => {
      if (tip) tip.hidden = true;
      window.__MM_SCENE__?.setDistanceMeasureProfileCursor?.(null);
    });
  }

  function onChartMove(e, chart, tip) {
    if (!profile?.samples?.length) return;
    const svg = chart.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const padL = 36;
    const padR = 12;
    const plotW = Math.max(1, rect.width - padL - padR);
    const x = e.clientX - rect.left;
    const t = Math.max(0, Math.min(1, (x - padL) / plotW));
    const dist = t * (Number(profile.distance_m) || 0);
    const sample = sampleAtDistance(profile, dist);
    if (!sample) return;

    window.__MM_SCENE__?.setDistanceMeasureProfileCursor?.({
      x: sample.world_x,
      y: sample.terrain_elevation,
      z: sample.world_z,
      depth_m: sample.depth_m,
    });

    if (tip) {
      tip.hidden = false;
      tip.innerHTML = `
        <div><span>Distance</span><b>${formatProfileDistance(sample.distance_m)}</b></div>
        ${sample.chainage_label ? `<div><span>Chainage</span><b>${escapeHtml(sample.chainage_label)}</b></div>` : ""}
        <div><span>Terrain</span><b>${fmtM(sample.terrain_elevation)}</b></div>
        <div><span>Depth</span><b>${fmtM(sample.depth_m)}${sample.depth_quality ? ` · ${escapeHtml(capitalize(sample.depth_quality))}` : ""}</b></div>
        <div><span>Water Surface</span><b>${fmtM(sample.water_surface_elevation)}${sample.water_surface_quality ? ` · ${escapeHtml(capitalize(sample.water_surface_quality))}` : ""}</b></div>
        <div><span>River Bed</span><b>${fmtM(sample.river_bed_elevation)}</b></div>
      `;
    }
  }

  return {
    el,
    toast,
    setToast,
    showFromMeasure,
    hide,
    isVisible: () => !backdrop.hidden,
    dispose() {
      hide();
      setToast("");
      toast.remove();
      backdrop.remove();
    },
  };
}

function renderChart(profile) {
  const samples = profile.samples || [];
  if (samples.length < 2) {
    return `<p class="profile-analysis-empty">Not enough samples for this transect.</p>`;
  }

  const w = 420;
  const h = 168;
  const padL = 36;
  const padR = 12;
  const padT = 14;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const terrains = samples.map((s) => s.terrain_elevation).filter(Number.isFinite);
  const beds = samples.map((s) => s.river_bed_elevation).filter(Number.isFinite);
  const wses = samples.map((s) => s.water_surface_elevation).filter(Number.isFinite);
  const allY = [...terrains, ...beds, ...wses];
  if (!allY.length) {
    return `<p class="profile-analysis-empty">Elevation data unavailable for this transect.</p>`;
  }

  let yMin = Math.min(...allY);
  let yMax = Math.max(...allY);
  if (yMax - yMin < 0.8) {
    yMin -= 0.4;
    yMax += 0.4;
  }
  const pad = (yMax - yMin) * 0.12;
  yMin -= pad;
  yMax += pad;

  const maxX = Number(profile.distance_m) || samples[samples.length - 1].distance_m || 1;
  const xOf = (d) => padL + (d / Math.max(1e-6, maxX)) * plotW;
  const yOf = (v) => padT + ((yMax - v) / Math.max(1e-6, yMax - yMin)) * plotH;

  const pathOf = (key, color, strokeWidth = 2) => {
    const pts = [];
    for (const s of samples) {
      const v = s[key];
      if (!Number.isFinite(v)) {
        // Break polyline across land gaps so bed/WSE don't span dry banks.
        if (pts.length >= 2) {
          /* keep segment; flush below */
        }
        continue;
      }
      pts.push(`${xOf(s.distance_m).toFixed(1)},${yOf(v).toFixed(1)}`);
    }
    if (pts.length < 2) return "";
    return `<polyline fill="none" stroke="${color}" stroke-width="${strokeWidth}" points="${pts.join(" ")}" />`;
  };

  // Build broken polylines for wet-only series (gaps on land).
  const pathWet = (key, color) => {
    const segments = [];
    let cur = [];
    for (const s of samples) {
      const v = s[key];
      if (!Number.isFinite(v)) {
        if (cur.length >= 2) segments.push(cur);
        cur = [];
        continue;
      }
      cur.push(`${xOf(s.distance_m).toFixed(1)},${yOf(v).toFixed(1)}`);
    }
    if (cur.length >= 2) segments.push(cur);
    return segments
      .map(
        (pts) =>
          `<polyline fill="none" stroke="${color}" stroke-width="2.25" points="${pts.join(" ")}" />`,
      )
      .join("");
  };

  const ticks = 4;
  const yTicks = [];
  for (let i = 0; i <= ticks; i++) {
    const v = yMin + ((yMax - yMin) * i) / ticks;
    const y = yOf(v);
    yTicks.push(
      `<text x="${padL - 4}" y="${y + 3}" text-anchor="end" class="profile-analysis-tick">${v.toFixed(1)}</text>
       <line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" class="profile-analysis-grid" />`,
    );
  }

  return `<svg class="profile-analysis-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="A to B elevation profile">
    ${yTicks.join("")}
    ${pathOf("terrain_elevation", "#E8A13D", 2)}
    ${pathWet("water_surface_elevation", "#5bc8e8")}
    ${pathWet("river_bed_elevation", "#5dcea0")}
    <text x="${padL}" y="${h - 6}" class="profile-analysis-tick">A</text>
    <text x="${padL + plotW}" y="${h - 6}" text-anchor="end" class="profile-analysis-tick">B · ${maxX.toFixed(0)} m</text>
    <text x="${padL}" y="11" class="profile-analysis-axis">Elevation (m)</text>
  </svg>`;
}

function fmtM(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)} m`;
}

function capitalize(s) {
  const t = String(s || "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
