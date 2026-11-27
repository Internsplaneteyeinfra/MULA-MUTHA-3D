/**
 * Centered PROFILE ANALYSIS popup for A→B measurement transect.
 * Dark glass GIS card · SVG chart · graph↔3D cursor sync.
 * Supports compact modal and full-screen / maximized engineering dashboard mode.
 */
import { X, Maximize2, Minimize2, Ruler, Compass, Waves, Activity } from "lucide";
import { lucideHtml } from "../icons.js";
import {
  buildMeasurementProfile,
  formatProfileDistance,
  sampleAtDistance,
} from "../../geo/measurementProfile.js";

const STORAGE_KEY = "mm_profile_analysis_maximized";

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

  // Default to full-screen mode per user request, remembering preference
  let isMaximized = true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      isMaximized = saved === "true";
    }
  } catch {
    /* fallback to default */
  }

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

  function toggleMaximize() {
    isMaximized = !isMaximized;
    try {
      localStorage.setItem(STORAGE_KEY, isMaximized ? "true" : "false");
    } catch {
      /* ignore */
    }
    syncMaximizedClasses();
    render();
  }

  function syncMaximizedClasses() {
    el.classList.toggle("is-maximized", isMaximized);
    backdrop.classList.toggle("is-maximized", isMaximized);
  }

  async function showFromMeasure(snap) {
    if (!snap?.pointA || !snap?.pointB) {
      hide();
      return;
    }
    if (busy) return;
    busy = true;
    syncMaximizedClasses();
    backdrop.hidden = false;
    backdrop.setAttribute("aria-hidden", "false");
    el.innerHTML = `<div class="profile-analysis-loading"><span class="profile-loading-spinner" aria-hidden="true"></span><p>Building transect profile & bathymetry…</p></div>`;
    try {
      profile = await buildMeasurementProfile({
        pointA: snap.pointA,
        pointB: snap.pointB,
        dataset,
      });
      render();
    } catch (err) {
      console.warn("[profile-analysis]", err);
      el.innerHTML = `
        <header class="profile-analysis-head">
          <div class="profile-analysis-title">
            <span aria-hidden="true">📏</span>
            <strong>Profile Analysis</strong>
          </div>
          <button type="button" class="profile-analysis-head-btn profile-analysis-close" id="profile-analysis-close" aria-label="Close profile">
            ${lucideHtml(X, { size: 14 })}
          </button>
        </header>
        <p class="profile-analysis-error">Profile unavailable</p>
      `;
      el.querySelector("#profile-analysis-close")?.addEventListener("click", hide);
    } finally {
      busy = false;
    }
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) hide();
  });

  function onKeyDown(e) {
    if (backdrop.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      hide();
    } else if (
      (e.key === "f" || e.key === "F" || e.key === "m" || e.key === "M") &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag !== "input" && tag !== "textarea") {
        e.preventDefault();
        toggleMaximize();
      }
    }
  }
  window.addEventListener("keydown", onKeyDown);

  function render() {
    if (!profile) return;
    syncMaximizedClasses();
    const st = profile.statistics || {};
    const distText = formatProfileDistance(profile.distance_m);
    const hasCoords =
      Number.isFinite(profile.pointA?.lat) &&
      Number.isFinite(profile.pointA?.lon) &&
      Number.isFinite(profile.pointB?.lat) &&
      Number.isFinite(profile.pointB?.lon);

    let bearingText = "";
    if (hasCoords) {
      const brg = calculateBearing(
        profile.pointA.lat,
        profile.pointA.lon,
        profile.pointB.lat,
        profile.pointB.lon
      );
      bearingText = `${brg.toFixed(0)}° ${compassHeading(brg)}`;
    }

    const areaText = Number.isFinite(st.flow_area_m2) ? `${st.flow_area_m2.toFixed(1)} m²` : "—";
    const qText = Number.isFinite(st.twin_discharge_m3s) ? `${st.twin_discharge_m3s.toFixed(1)} m³/s` : "Unavailable";
    const chText = Number.isFinite(st.twin_chainage_m) ? fmtStation(st.twin_chainage_m) : (profile.samples?.[0]?.chainage_label || "—");

    const chartRenderResult = profile.error ? null : renderChart(profile, isMaximized);

    el.innerHTML = `
      <header class="profile-analysis-head" title="Double click to ${isMaximized ? "restore default size" : "maximize to full screen"}">
        <div class="profile-analysis-title">
          <span class="profile-analysis-badge-icon" aria-hidden="true">${lucideHtml(Ruler, { size: 16 })}</span>
          <div>
            <div class="profile-analysis-title-row">
              <strong>Profile Analysis</strong>
              <span class="profile-analysis-tag">${isMaximized ? "Full-Screen Dashboard" : "Transect"}</span>
            </div>
            <p>Point A → Point B · Distance <b>${escapeHtml(distText)}</b>${bearingText ? ` · Heading <b>${bearingText}</b>` : ""}</p>
          </div>
        </div>
        <div class="profile-analysis-head-actions">
          <button type="button" class="profile-analysis-head-btn profile-analysis-expand" id="profile-analysis-expand" aria-label="${isMaximized ? "Restore default window" : "Maximize to full screen"}" title="${isMaximized ? "Restore window" : "Maximize to full screen"}">
            ${lucideHtml(isMaximized ? Minimize2 : Maximize2, { size: 14 })}
          </button>
          <button type="button" class="profile-analysis-head-btn profile-analysis-close" id="profile-analysis-close" aria-label="Close profile" title="Close">
            ${lucideHtml(X, { size: 14 })}
          </button>
        </div>
      </header>

      ${
        profile.error
          ? `<p class="profile-analysis-error">${escapeHtml(profile.error)}</p>`
          : `
            <div class="profile-analysis-chart-wrapper">
              <div class="profile-analysis-chart" id="profile-analysis-chart">${chartRenderResult?.svgHtml || ""}</div>
              <div class="profile-analysis-legend">
                <span class="is-terrain">Ground / River bed</span>
                <span class="is-wse">Water level</span>
                <span class="is-water-fill">Water (depth)</span>
              </div>
            </div>
            ${!isMaximized ? `<div class="profile-analysis-tip" id="profile-analysis-tip" hidden></div>` : ""}
          `
      }

      ${
        isMaximized
          ? `
            <div class="profile-analysis-grid-max">
              <!-- Cross-section: what the cut measures across the water -->
              <section class="profile-analysis-section-card">
                <header class="profile-analysis-card-title">
                  <span aria-hidden="true">${lucideHtml(Ruler, { size: 14 })}</span>
                  <span>Cross-Section</span>
                </header>
                <div class="profile-analysis-card-stats">
                  <div><span>Cut length</span><b>${escapeHtml(distText)}</b></div>
                  <div><span>Water width</span><b>${fmtM(st.water_width_m, 1)}</b></div>
                  <div><span>Max water depth</span><b>${fmtM(st.max_depth_m)}</b></div>
                  <div><span>Mean water depth</span><b>${fmtM(st.mean_depth_m)}</b></div>
                  <div><span>Flow area</span><b>${areaText}</b></div>
                </div>
              </section>

              <!-- Levels from the digital twin (one datum) -->
              <section class="profile-analysis-section-card">
                <header class="profile-analysis-card-title">
                  <span aria-hidden="true">${lucideHtml(Waves, { size: 14 })}</span>
                  <span>Levels · NadiTwin</span>
                </header>
                <div class="profile-analysis-card-stats">
                  <div><span>Water level</span><b>${fmtM(st.water_level_m)}</b></div>
                  <div><span>Deepest river bed</span><b>${fmtM(st.deepest_bed_m)}</b></div>
                  <div><span>Bank crest</span><b>${fmtM(st.bank_crest_m)}</b></div>
                  <div><span>Freeboard (crest − water)</span><b>${fmtM(st.freeboard_m)}</b></div>
                  <div><span>Discharge</span><b>${qText}</b>${Number.isFinite(st.twin_discharge_m3s) ? `<em class="is-badge">Live · modelled</em>` : ""}</div>
                </div>
              </section>

              <!-- Where the cut is -->
              <section class="profile-analysis-section-card">
                <header class="profile-analysis-card-title">
                  <span aria-hidden="true">${lucideHtml(Compass, { size: 14 })}</span>
                  <span>Location</span>
                </header>
                <div class="profile-analysis-card-stats">
                  <div><span>River chainage</span><b>${escapeHtml(chText)}</b></div>
                  ${
                    hasCoords
                      ? `<div><span>Point A</span><b>${Number(profile.pointA.lat).toFixed(6)}°N, ${Number(profile.pointA.lon).toFixed(6)}°E</b></div>
                         <div><span>Point B</span><b>${Number(profile.pointB.lat).toFixed(6)}°N, ${Number(profile.pointB.lon).toFixed(6)}°E</b></div>`
                      : ""
                  }
                </div>
              </section>

              <!-- Live Inspector Card -->
              <section class="profile-analysis-section-card profile-analysis-live-card">
                <header class="profile-analysis-card-title">
                  <span aria-hidden="true">${lucideHtml(Activity, { size: 14 })}</span>
                  <span>Live Point Inspector</span>
                </header>
                <div class="profile-analysis-inspector-box" id="profile-analysis-live-inspector">
                  <div class="profile-analysis-inspector-idle">
                    <span class="inspector-idle-icon">🎯</span>
                    <p>Hover across the transect chart above to inspect cross-section geometry, depth, and bed level at any point.</p>
                  </div>
                </div>
              </section>
            </div>
          `
          : `
            <div class="profile-analysis-stats">
              <div><span>Water width</span><b>${fmtM(st.water_width_m, 1)}</b></div>
              <div><span>Max depth</span><b>${fmtM(st.max_depth_m)}</b></div>
              <div><span>Mean depth</span><b>${fmtM(st.mean_depth_m)}</b></div>
              <div><span>Flow area</span><b>${areaText}</b></div>
            </div>
            <section class="profile-analysis-conditions">
              <header>NadiTwin · CH ${escapeHtml(chText)}</header>
              <div class="profile-analysis-cond-grid">
                <div><span>Water level</span><b>${fmtM(st.water_level_m)}</b></div>
                <div><span>Deepest bed</span><b>${fmtM(st.deepest_bed_m)}</b></div>
                <div><span>Freeboard</span><b>${fmtM(st.freeboard_m)}</b></div>
                <div><span>Discharge</span><b>${qText}</b></div>
              </div>
            </section>
          `
      }

      <footer class="profile-analysis-actions">
        ${
          isMaximized
            ? `<div class="profile-analysis-footer-meta">
                <span class="footer-meta-pill">Levels: NadiTwin · ${escapeHtml(st.datum || "m WSE")}</span>
                <span class="footer-meta-pill">Depth: Sentinel-2 survey</span>
                <span class="footer-meta-text">Press <b>F</b> or <b>Esc</b> to toggle / exit</span>
              </div>`
            : ""
        }
        <div class="profile-analysis-footer-btns">
          <button type="button" class="profile-analysis-btn is-toggle-size" id="profile-analysis-toggle-size">
            ${isMaximized ? "Restore Size" : "Full Screen"}
          </button>
          <button type="button" class="profile-analysis-btn is-clear" id="profile-analysis-clear">Clear</button>
          <button type="button" class="profile-analysis-btn is-exit" id="profile-analysis-exit">Exit Measure</button>
        </div>
      </footer>
    `;

    // Event listeners
    el.querySelector(".profile-analysis-head")?.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      toggleMaximize();
    });
    el.querySelector("#profile-analysis-expand")?.addEventListener("click", toggleMaximize);
    el.querySelector("#profile-analysis-toggle-size")?.addEventListener("click", toggleMaximize);

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
    const liveInspector = el.querySelector("#profile-analysis-live-inspector");

    if (chart && chartRenderResult) {
      chart.addEventListener("pointermove", (e) =>
        onChartMove(e, chart, tip, liveInspector, chartRenderResult)
      );
      chart.addEventListener("pointerleave", () =>
        onChartLeave(chart, tip, liveInspector)
      );
    }
  }

  function onChartMove(e, chart, tip, liveInspector, renderMeta) {
    if (!profile?.samples?.length || !renderMeta) return;
    const svg = chart.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();

    const { w, padL, padR, plotW, yOf } = renderMeta;
    const padLRendered = (padL / w) * rect.width;
    const padRRendered = (padR / w) * rect.width;
    const plotWRendered = Math.max(1, rect.width - padLRendered - padRRendered);
    const x = e.clientX - rect.left;
    const t = Math.max(0, Math.min(1, (x - padLRendered) / plotWRendered));
    const dist = t * (Number(profile.distance_m) || 0);
    const sample = sampleAtDistance(profile, dist);
    if (!sample) return;

    window.__MM_SCENE__?.setDistanceMeasureProfileCursor?.({
      x: sample.world_x,
      y: sample.terrain_elevation,
      z: sample.world_z,
      depth_m: sample.depth_m,
    });

    // Update SVG crosshair
    const crosshairGroup = svg.querySelector("#profile-chart-crosshair-group");
    const crosshairLine = svg.querySelector("#profile-crosshair-line");
    const crosshairTerrain = svg.querySelector("#profile-crosshair-terrain");
    const crosshairWse = svg.querySelector("#profile-crosshair-wse");
    const crosshairBed = svg.querySelector("#profile-crosshair-bed");

    if (crosshairGroup && crosshairLine) {
      crosshairGroup.style.display = "";
      const svgX = padL + t * plotW;
      crosshairLine.setAttribute("x1", svgX.toFixed(1));
      crosshairLine.setAttribute("x2", svgX.toFixed(1));
      const dot = (node, v) => {
        if (!node) return;
        node.style.display = Number.isFinite(v) ? "" : "none";
        if (Number.isFinite(v)) {
          node.setAttribute("cx", svgX.toFixed(1));
          node.setAttribute("cy", yOf(v).toFixed(1));
        }
      };
      dot(crosshairTerrain, sample.section_m);
      dot(crosshairWse, sample.water_level_m);
      if (crosshairBed) crosshairBed.style.display = "none";
    }

    const levelLabel = sample.in_water ? "River bed" : "Ground";

    // Update compact tip if present
    if (tip && !isMaximized) {
      tip.hidden = false;
      tip.innerHTML = `
        <div><span>Distance</span><b>${formatProfileDistance(sample.distance_m)}</b></div>
        <div><span>Water depth</span><b>${sample.in_water ? fmtM(sample.depth_m) : "Dry bank"}</b></div>
        <div><span>${levelLabel}</span><b>${fmtM(sample.section_m)}</b></div>
        ${sample.in_water ? `<div><span>Water level</span><b>${fmtM(sample.water_level_m)}</b></div>` : ""}
      `;
    }

    // Update live inspector card in maximized mode
    if (liveInspector && isMaximized) {
      const pct = (t * 100).toFixed(0);
      liveInspector.innerHTML = `
        <div class="profile-analysis-inspector-active">
          <div class="inspector-item">
            <span>Distance along cut</span>
            <b>${formatProfileDistance(sample.distance_m)} <small>(${pct}%)</small></b>
          </div>
          <div class="inspector-item">
            <span>Water depth</span>
            <b>${sample.in_water && sample.depth_m != null ? fmtM(sample.depth_m) : "Dry bank"}</b>
          </div>
          <div class="inspector-item">
            <span>${levelLabel} level</span>
            <b style="color: #E8A13D">${fmtM(sample.section_m)}</b>
          </div>
          ${
            sample.in_water
              ? `<div class="inspector-item">
                  <span>Water level</span>
                  <b style="color: #5bc8e8">${fmtM(sample.water_level_m)}</b>
                </div>`
              : ""
          }
          <div class="inspector-item">
            <span>Coordinates</span>
            <b>${sample.lat != null ? `${sample.lat.toFixed(6)}°, ${sample.lon.toFixed(6)}°` : "—"}</b>
          </div>
        </div>
      `;
    }
  }

  function onChartLeave(chart, tip, liveInspector) {
    if (tip) tip.hidden = true;
    window.__MM_SCENE__?.setDistanceMeasureProfileCursor?.(null);
    const svg = chart?.querySelector("svg");
    const crosshairGroup = svg?.querySelector("#profile-chart-crosshair-group");
    if (crosshairGroup) crosshairGroup.style.display = "none";
    if (liveInspector && isMaximized) {
      liveInspector.innerHTML = `
        <div class="profile-analysis-inspector-idle">
          <span class="inspector-idle-icon">🎯</span>
          <p>Hover across the transect chart above to inspect cross-section geometry, depth, and bed level at any point.</p>
        </div>
      `;
    }
  }

  return {
    el,
    toast,
    setToast,
    showFromMeasure,
    hide,
    toggleMaximize,
    isMaximized: () => isMaximized,
    isVisible: () => !backdrop.hidden,
    dispose() {
      hide();
      setToast("");
      window.removeEventListener("keydown", onKeyDown);
      toast.remove();
      backdrop.remove();
    },
  };
}

function renderChart(profile, isMaximized = false) {
  const samples = profile.samples || [];
  if (samples.length < 2) {
    return {
      svgHtml: `<p class="profile-analysis-empty">Not enough samples for this transect.</p>`,
      w: 420,
      h: 168,
      padL: 36,
      padR: 12,
      plotW: 372,
      yOf: () => 0,
    };
  }

  const w = isMaximized ? 1140 : 420;
  const h = isMaximized ? 320 : 168;
  const padL = isMaximized ? 52 : 36;
  const padR = isMaximized ? 24 : 12;
  const padT = isMaximized ? 22 : 14;
  const padB = isMaximized ? 36 : 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // Real levels on one datum (see measurementProfile): ground/bed line + water level.
  const sections = samples.map((s) => s.section_m).filter(Number.isFinite);
  const wses = samples.map((s) => s.water_level_m).filter(Number.isFinite);
  const crest = Number(profile.statistics?.bank_crest_m);
  const allY = [...sections, ...wses, ...(Number.isFinite(crest) ? [crest] : [])];
  if (!allY.length) {
    return {
      svgHtml: `<p class="profile-analysis-empty">Elevation data unavailable for this transect.</p>`,
      w,
      h,
      padL,
      padR,
      plotW,
      yOf: () => 0,
    };
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
      if (!Number.isFinite(v)) continue;
      pts.push(`${xOf(s.distance_m).toFixed(1)},${yOf(v).toFixed(1)}`);
    }
    if (pts.length < 2) return "";
    return `<polyline fill="none" stroke="${color}" stroke-width="${strokeWidth}" points="${pts.join(" ")}" />`;
  };

  // Build broken polylines for wet-only series (gaps on land)
  const pathWet = (key, color, strokeWidth = 2.25) => {
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
          `<polyline fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(" ")}" />`
      )
      .join("");
  };

  // Water polygon fill between water surface and river bed
  let waterAreaHtml = "";
  const wetSegments = [];
  let curWet = [];
  for (const s of samples) {
    if (s.in_water && Number.isFinite(s.water_level_m) && Number.isFinite(s.bed_m)) {
      curWet.push(s);
    } else {
      if (curWet.length >= 2) wetSegments.push(curWet);
      curWet = [];
    }
  }
  if (curWet.length >= 2) wetSegments.push(curWet);

  for (const seg of wetSegments) {
    const topPts = seg.map((s) => `${xOf(s.distance_m).toFixed(1)},${yOf(s.water_level_m).toFixed(1)}`);
    const botPts = seg.map((s) => `${xOf(s.distance_m).toFixed(1)},${yOf(s.bed_m).toFixed(1)}`).reverse();
    const waterPolyCoords = [...topPts, ...botPts].join(" ");
    waterAreaHtml += `<polygon points="${waterPolyCoords}" fill="url(#profile-water-grad)" class="profile-analysis-area-water" />`;
  }

  // Terrain area fill under the terrain line
  let terrainAreaHtml = "";
  const terrainPts = [];
  for (const s of samples) {
    if (Number.isFinite(s.section_m)) {
      terrainPts.push(`${xOf(s.distance_m).toFixed(1)},${yOf(s.section_m).toFixed(1)}`);
    }
  }
  if (terrainPts.length >= 2) {
    const firstX = xOf(samples[0].distance_m).toFixed(1);
    const lastX = xOf(samples[samples.length - 1].distance_m).toFixed(1);
    const bottomY = (padT + plotH).toFixed(1);
    const polyCoords = [...terrainPts, `${lastX},${bottomY}`, `${firstX},${bottomY}`].join(" ");
    terrainAreaHtml = `<polygon points="${polyCoords}" fill="url(#profile-terrain-grad)" class="profile-analysis-area-terrain" />`;
  }

  // Horizontal elevation ticks & grid lines
  const ticks = isMaximized ? 6 : 4;
  const yTicks = [];
  for (let i = 0; i <= ticks; i++) {
    const v = yMin + ((yMax - yMin) * i) / ticks;
    const y = yOf(v);
    yTicks.push(
      `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" class="profile-analysis-tick">${v.toFixed(1)}</text>
       <line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" class="profile-analysis-grid" />`
    );
  }

  // Distance ticks along bottom in maximized mode
  let xTicksHtml = "";
  if (isMaximized && maxX > 2) {
    const roughStep = maxX / 8;
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
    let step = mag;
    if (roughStep / mag > 5) step = mag * 5;
    else if (roughStep / mag > 2) step = mag * 2;
    step = Math.max(1, step);

    for (let d = step; d < maxX * 0.98; d += step) {
      const x = xOf(d);
      xTicksHtml += `
        <line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${padT + plotH}" class="profile-analysis-grid is-vert" />
        <text x="${x.toFixed(1)}" y="${h - 8}" text-anchor="middle" class="profile-analysis-tick">${d.toFixed(0)}m</text>
      `;
    }
  }

  const svgHtml = `<svg class="profile-analysis-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="A to B elevation profile">
    <defs>
      <linearGradient id="profile-terrain-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#E8A13D" stop-opacity="0.22" />
        <stop offset="100%" stop-color="#E8A13D" stop-opacity="0.02" />
      </linearGradient>
      <linearGradient id="profile-water-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5bc8e8" stop-opacity="0.38" />
        <stop offset="100%" stop-color="#5bc8e8" stop-opacity="0.14" />
      </linearGradient>
    </defs>
    ${yTicks.join("")}
    ${xTicksHtml}
    ${terrainAreaHtml}
    ${waterAreaHtml}
    ${
      Number.isFinite(crest)
        ? `<line x1="${padL}" x2="${padL + plotW}" y1="${yOf(crest).toFixed(1)}" y2="${yOf(crest).toFixed(1)}" stroke="#ff6b6b" stroke-width="1.4" stroke-dasharray="6,4" />
           <text x="${padL + plotW - 4}" y="${(yOf(crest) - 5).toFixed(1)}" text-anchor="end" class="profile-analysis-tick" fill="#ff6b6b">Bank crest ${crest.toFixed(2)} m</text>`
        : ""
    }
    ${pathWet("water_level_m", "#5bc8e8", isMaximized ? 2.5 : 2.25)}
    ${pathOf("section_m", "#E8A13D", isMaximized ? 2.8 : 2.6)}
    <g id="profile-chart-crosshair-group" style="display: none; pointer-events: none;">
      <line id="profile-crosshair-line" y1="${padT}" y2="${padT + plotH}" stroke="rgba(255, 255, 255, 0.75)" stroke-dasharray="3,3" stroke-width="1.5" />
      <circle id="profile-crosshair-terrain" r="${isMaximized ? 5 : 4}" fill="#E8A13D" stroke="#fff" stroke-width="1.5" />
      <circle id="profile-crosshair-wse" r="${isMaximized ? 4.5 : 3.5}" fill="#5bc8e8" stroke="#fff" stroke-width="1.5" />
      <circle id="profile-crosshair-bed" r="${isMaximized ? 4.5 : 3.5}" fill="#5dcea0" stroke="#fff" stroke-width="1.5" />
    </g>
    <text x="${padL}" y="${h - 8}" class="profile-analysis-tick">A (0 m)</text>
    <text x="${padL + plotW}" y="${h - 8}" text-anchor="end" class="profile-analysis-tick">B · ${maxX.toFixed(0)} m</text>
    <text x="${padL}" y="12" class="profile-analysis-axis">Level (${escapeHtml(profile.statistics?.datum || "m WSE")})</text>
  </svg>`;

  return {
    svgHtml,
    w,
    h,
    padL,
    padR,
    padT,
    padB,
    plotW,
    plotH,
    yOf,
  };
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const φ1 = lat1 * toRad;
  const φ2 = lat2 * toRad;
  const Δλ = (lon2 - lon1) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let θ = Math.atan2(y, x) * toDeg;
  return (θ + 360) % 360;
}

function compassHeading(deg) {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const i = Math.round(deg / 22.5) % 16;
  return dirs[i];
}

function fmtStation(meters) {
  const n = Math.max(0, Math.round(Number(meters) || 0));
  return `${Math.floor(n / 1000)}+${String(n % 1000).padStart(3, "0")}`;
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
