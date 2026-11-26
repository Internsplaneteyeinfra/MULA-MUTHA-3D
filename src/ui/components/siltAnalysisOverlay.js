import { X, MousePointerSquareDashed, Trash2, MousePointer2 } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import {
  SILT_DASH as DASH,
  escapeSiltHtml,
  formatSiltArea,
  formatSiltValue,
  isMissingSiltValue,
} from "./siltFormat.js";
import { updateHistoricalSilt } from "./historicalSilt.js";

const INSTRUCTION = "Select 4 points around the area to analyze";

export function mountSiltAnalysisOverlay(root, dataset) {
  const panel = document.createElement("div");
  panel.className = "silt-pro-overlay";
  panel.id = "silt-pro-overlay";
  panel.hidden = true;

  panel.innerHTML = `
    <div class="silt-pro-top-bar">
      <div class="top-bar-left">
        <div class="silt-pro-title">
          <div style="width:18px;height:18px;background:#35D9FF;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);margin-right:4px;"></div>
          <div>
            <h2>SILT AREA ANALYSIS</h2>
            <div class="subtitle">MULA-MUTHA RIVER DIGITAL TWIN</div>
          </div>
        </div>
        <div class="top-area-pill">
          <span class="lbl">SELECTED AREA (4 POINTS)</span>
          <span class="val">P1 \u2192 P2 \u2192 P3 \u2192 P4 \u2192 P1</span>
        </div>
      </div>
      <div class="silt-pro-toolbar">
        <button class="silt-pro-btn" data-silt="minimize">
          <span>Minimize ▼</span>
        </button>
        <button class="silt-pro-btn" data-silt="edit">
          ${lucideHtml(MousePointerSquareDashed, { size: 14 })} <span>Edit Points</span>
        </button>
        <button class="silt-pro-btn" data-silt="reset">
          ${lucideHtml(Trash2, { size: 14 })} <span>Clear</span>
        </button>
        <button class="silt-pro-btn silt-pro-btn--toggle active" data-silt="mode-surface">Surface</button>
        <button class="silt-pro-btn silt-pro-btn--toggle" data-silt="mode-cutaway">Cutaway</button>
        <button class="silt-pro-btn silt-pro-btn--danger" data-silt="close">
          ${lucideHtml(X, { size: 14 })} <span>Close</span>
        </button>
      </div>
    </div>

    <div class="silt-pro-hint-banner" id="silt-pro-hint">
      <div class="hint-content">
        ${lucideHtml(MousePointer2, { size: 16 })}
        <span id="silt-pro-hint-text">${INSTRUCTION}</span>
      </div>
    </div>

    <div class="silt-pro-floating-legend" id="silt-pro-legend" hidden>
      <h4>SILT / DEPOSITION</h4>
      <div class="legend-subtitle">Spatial Analysis Index</div>
      <ul class="legend-list" id="silt-pro-legend-list"></ul>
    </div>

    
    <div class="silt-pro-minimized-bar" id="silt-pro-minimized-bar" hidden>
      <div class="min-content">
        SILT ANALYSIS &nbsp;&bull;&nbsp; 4 POINTS &nbsp;&bull;&nbsp; <span id="silt-min-coverage"></span> COVERAGE
      </div>
      <button class="silt-pro-btn" data-silt="restore">
        <span>RESTORE ▲</span>
      </button>
    </div>
    <div class="silt-pro-dashboard" id="silt-pro-dashboard" hidden>
      <div class="silt-summary" id="silt-summary"></div>
      <div class="silt-controls">
        <div class="silt-hist-years" id="silt-hist-years" role="group" aria-label="Year"></div>
        <div class="silt-hist-months" id="silt-hist-months" role="group" aria-label="Month"></div>
        <div class="silt-play" id="silt-play">
          <button type="button" data-silt-play="prev" title="Previous available month">Prev</button>
          <button type="button" data-silt-play="play" title="Play available months">Play</button>
          <button type="button" data-silt-play="pause" title="Pause">Pause</button>
          <button type="button" data-silt-play="next" title="Next available month">Next</button>
          <label>Speed
            <select id="silt-play-speed" aria-label="Playback speed">
              <option value="1600">0.5×</option>
              <option value="900" selected>1×</option>
              <option value="450">2×</option>
            </select>
          </label>
        </div>
      </div>
      <div class="silt-three" id="silt-three">
        <div class="dashboard-panel silt-spatial-panel">
          <div class="panel-header"><span id="cs-title">SPATIAL SILT CLASSIFICATION</span></div>
          <div class="silt-spatial-wrap" id="silt-spatial"></div>
          <div class="chart-legend-row" id="silt-spatial-legend"></div>
        </div>
        <div class="dashboard-panel">
          <div class="panel-header">MONTHLY SILT VOLUME</div>
          <div id="silt-month-volume"></div>
        </div>
        <div class="dashboard-panel">
          <div class="panel-header">MONTHLY SILT CLASSIFICATION</div>
          <div id="silt-month-class"></div>
        </div>
      </div>
      <div class="silt-compare" id="silt-compare"></div>
      <div class="silt-month-table" id="silt-month-table"></div>
    </div>
  `;

  root.appendChild(panel);
  const _tt = document.createElement("div");
  _tt.className = "silt-chart-tooltip";
  _tt.hidden = true;
  panel.appendChild(_tt);

  const hintEl = panel.querySelector("#silt-pro-hint");
  const hintText = panel.querySelector("#silt-pro-hint-text");
  const dashboard = panel.querySelector("#silt-pro-dashboard");
  const legend = panel.querySelector("#silt-pro-legend");
  const tooltipEl = _tt;

  function sampleNearest(x, z, pts) {
    if (!pts?.length) return null;
    let best = null, bestD = Infinity;
    const step = Math.max(1, Math.floor(pts.length / 600));
    for (let i = 0; i < pts.length; i += step) {
      const p = pts[i];
      const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d2 < bestD) { bestD = d2; best = p; }
    }
    return best?.depth ?? null;
  }

  function showTT(e, html) { tooltipEl.innerHTML = html; tooltipEl.hidden = false; moveTT(e); }
  function moveTT(e) {
    const px = e.clientX + 14, py = e.clientY - 8;
    tooltipEl.style.left = Math.min(px, window.innerWidth - 220) + "px";
    tooltipEl.style.top  = Math.min(py, window.innerHeight - 90) + "px";
  }
  function hideTT() { tooltipEl.hidden = true; }

  let active = false, snap = null, activeEdge = 0, isMinimized = false;
  const scene = () => window.__MM_SCENE__;

  function open() {
    active = true; panel.hidden = false; isMinimized = false;
    scene()?.setSiltAnalysisActive?.(true);
    document.body.classList.add("silt-analysis-mode");
  }

  function close() {
    active = false; panel.hidden = true; isMinimized = false;
    scene()?.setSiltAnalysisActive?.(false);
    document.body.classList.remove("silt-analysis-mode");
    scene()?.removeSiltHoverMarker?.();
  }

  panel.addEventListener("click", (e) => {
    const edgeBtn = e.target.closest(".edge-btn");
    if (edgeBtn) { activeEdge = parseInt(edgeBtn.dataset.edge, 10); render(); return; }
    const btn = e.target.closest("[data-silt]");
    if (btn) {
      if (btn.dataset.silt === "close") close();
      else if (btn.dataset.silt === "reset") { isMinimized = false; scene()?.resetSiltAnalysis?.(); }
      else if (btn.dataset.silt === "edit") { isMinimized = false; scene()?.editSiltAnalysis?.(); }
      else if (btn.dataset.silt === "minimize") { isMinimized = true; render(); }
      else if (btn.dataset.silt === "restore") { isMinimized = false; render(); }
      else if (btn.dataset.silt === "mode-surface" || btn.dataset.silt === "mode-cutaway") {
        panel.querySelectorAll(".silt-pro-btn--toggle").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        scene()?.setSiltCutaway?.(btn.dataset.silt === "mode-cutaway");
      }
    }
  });

  document.addEventListener("silt-analysis-change", (e) => {
    snap = e.detail || null;
    active = !!snap?.active;
    if (!active) {
      panel.hidden = true;
      document.body.classList.remove("silt-analysis-mode");
      scene()?.removeSiltHoverMarker?.();
      return;
    }
    panel.hidden = false;
    document.body.classList.add("silt-analysis-mode");
    render();
  });

  panel.querySelector("#silt-bank-inspect")?.addEventListener("toggle", () => render());

  function drawSpatialMap(r) {
    const host = panel.querySelector("#silt-spatial");
    const legendRow = panel.querySelector("#silt-spatial-legend");
    if (!host) return;
    const clip = r.clip;
    if (legendRow) {
      legendRow.innerHTML = (r.classes || []).map((c) =>
        '<span><span class="sw" style="background:' + escapeSiltHtml(c.color) + '"></span> ' + escapeSiltHtml(c.label) + "</span>"
      ).join("");
    }
    if (!clip?.data || !clip.width || !clip.height) {
      host.textContent = "No classified raster cells inside the polygon.";
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = clip.width;
    canvas.height = clip.height;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(clip.width, clip.height);
    const src = clip.data;
    let minX = clip.width;
    let minY = clip.height;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0, n = clip.width * clip.height; i < n; i++) {
      const s = i * 4;
      const a = src[s + 3];
      if (a >= 195) {
        img.data[s] = src[s];
        img.data[s + 1] = src[s + 1];
        img.data[s + 2] = src[s + 2];
        img.data[s + 3] = 235;
      } else if (a > 0) {
        img.data[s] = 58;
        img.data[s + 1] = 76;
        img.data[s + 2] = 86;
        img.data[s + 3] = 170;
      } else continue;
      const x = i % clip.width;
      const y = (i / clip.width) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    ctx.putImageData(img, 0, 0);
    const pad = 1;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(clip.width - 1, maxX + pad);
    maxY = Math.min(clip.height - 1, maxY + pad);
    const cropW = Math.max(1, maxX - minX + 1);
    const cropH = Math.max(1, maxY - minY + 1);
    const zoom = 8;
    const view = document.createElement("canvas");
    view.width = cropW * zoom;
    view.height = cropH * zoom;
    const vctx = view.getContext("2d");
    vctx.imageSmoothingEnabled = false;
    vctx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, view.width, view.height);
    const nw = clip.corners?.nw;
    const ne = clip.corners?.ne;
    const sw = clip.corners?.sw;
    if (nw && ne && sw && r.points?.length >= 3) {
      const ux = ne.x - nw.x;
      const uz = ne.z - nw.z;
      const wx = sw.x - nw.x;
      const wz = sw.z - nw.z;
      const det = ux * wz - uz * wx;
      if (Math.abs(det) > 1e-6) {
        vctx.beginPath();
        r.points.forEach((p, i) => {
          const vx = p.x - nw.x;
          const vz = p.z - nw.z;
          const u = (vx * wz - vz * wx) / det;
          const v = (ux * vz - uz * vx) / det;
          const x = (u * clip.width - minX) * zoom;
          const y = (v * clip.height - minY) * zoom;
          if (i === 0) vctx.moveTo(x, y);
          else vctx.lineTo(x, y);
        });
        vctx.closePath();
        vctx.strokeStyle = "#35D9FF";
        vctx.lineWidth = 2;
        vctx.stroke();
      }
    }
    host.replaceChildren(view);
    view.addEventListener("mousemove", (ev) => {
      const rect = view.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const px = Math.min(clip.width - 1, Math.max(0, minX + Math.floor(((ev.clientX - rect.left) / rect.width) * cropW)));
      const py = Math.min(clip.height - 1, Math.max(0, minY + Math.floor(((ev.clientY - rect.top) / rect.height) * cropH)));
      const a = src[(py * clip.width + px) * 4 + 3];
      let label = "Outside polygon";
      if (a >= 195) {
        const c = Math.max(0, Math.min(3, Math.round((a - 200) / 10)));
        label = (r.classes?.[c]?.label || "Classified") + " · stored raster cell";
      } else if (a > 0) label = "Inside polygon · no class";
      showTT(ev, label);
    });
    view.addEventListener("mouseleave", hideTT);
  }

  function render() {
    if (!active || !snap) return;
    const { phase, count, result } = snap;
    
    if (phase === "select") {
      hintEl.hidden = false;
      hintText.textContent = INSTRUCTION + " (" + count + "/4)";
      dashboard.hidden = true; legend.hidden = true; return;
    }
    if (phase === "analyzing") {
      hintEl.hidden = false; hintText.textContent = "Analysing silt raster inside polygon…";
      dashboard.hidden = true; legend.hidden = true; 
      panel.querySelector("#silt-pro-minimized-bar").hidden = true;
      return;
    }
    hintEl.hidden = true;
    
    const minBar = panel.querySelector("#silt-pro-minimized-bar");
    if (isMinimized) {
      dashboard.hidden = true;
      legend.hidden = true;
      minBar.hidden = false;
      const cov = result?.silt?.coveragePct != null ? result.silt.coveragePct.toFixed(1) + "%" : "--%";
      panel.querySelector("#silt-min-coverage").textContent = cov;
    } else {
      dashboard.hidden = false;
      legend.hidden = true;
      minBar.hidden = true;
      renderDashboard(result);
    }
  }

  function renderDashboard(r) {
    if (!r) return;
    const classes = r.classes ?? [];
    drawSpatialMap(r);
    updateHistoricalSilt(r.points, activeEdge, { showTT, moveTT, hideTT }, r.source?.classPeriod);

    const bankOpen = panel.querySelector("#silt-bank-inspect")?.open;
    if (!bankOpen) return;

    const cs = panel.querySelector("#silt-cs-canvas");
    const bathy = window.__MM_SCENE__?.dataset?.points ?? [];
    const pts = r.points ?? [];
    const p1 = pts[activeEdge];
    const p2 = pts[(activeEdge + 1) % pts.length];

    const STEPS = 30;
    const sectionPts = [];

    function sampleSiltData(x, z, clip) {
      if (!clip || !clip.data) return null;
      const { nw, se } = clip.corners;
      const tX = (x - nw.x) / (se.x - nw.x);
      const tY = (z - nw.z) / (se.z - nw.z);
      if (tX < 0 || tX >= 1 || tY < 0 || tY >= 1) return null;
      const px = Math.floor(tX * clip.width);
      const py = Math.floor(tY * clip.height);
      const idx = (py * clip.width + px) * 4;
      if (clip.data[idx + 3] === 0) return null;
      const rr = clip.data[idx], gg = clip.data[idx+1], bb = clip.data[idx+2];
      let best = null, bestD = Infinity;
      for (const c of classes) {
        const hr = parseInt(c.color.substr(1,2), 16);
        const hg = parseInt(c.color.substr(3,2), 16);
        const hb = parseInt(c.color.substr(5,2), 16);
        const d = (hr-rr)**2 + (hg-gg)**2 + (hb-bb)**2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (bestD > 10000 || !best) return null;
      let val = 0.5;
      if (best.label.toLowerCase().includes("very high")) val = 2.0;
      else if (best.label.toLowerCase().includes("high")) val = 1.5;
      else if (best.label.toLowerCase().includes("moderate")) val = 1.0;
      return { val, cls: best.label, col: best.color };
    }

    const wseVal = 0;
    let minBed = 0;

    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      let depth = 0, silt = null, x = 0, z = 0;
      if (p1 && p2) {
        x = p1.x + (p2.x - p1.x) * t;
        z = p1.z + (p2.z - p1.z) * t;
        if (bathy.length) depth = sampleNearest(x, z, bathy) ?? 0;
        silt = sampleSiltData(x, z, r.clip);
      }
      if (-depth < minBed) minBed = -depth;
      sectionPts.push({ t, x, z, depth, silt, bed: -depth });
    }
    for (let i = 0; i < sectionPts.length; i++) {
      if (sectionPts[i].silt) {
        const prev = i > 0 ? sectionPts[i-1].silt?.val ?? 0 : 0;
        const next = i < sectionPts.length - 1 ? sectionPts[i+1].silt?.val ?? 0 : 0;
        sectionPts[i].silt.val = (sectionPts[i].silt.val * 2 + prev + next) / 4;
      }
    }

    const totalDist = (p1 && p2) ? Math.round(Math.hypot(p2.x - p1.x, p2.z - p1.z)) : 300;
    const CHART_H = 220, CHART_W = 600, PAD = 15;
    const paddingVal = Math.max(Math.abs(minBed) * 0.15, 0.3); // add at least 0.3m headroom
    const graphMin = minBed - paddingVal;
    const graphMax = wseVal + paddingVal;
    const range = graphMax - graphMin;
    const toY = val => PAD + ((graphMax - val) / range) * (CHART_H - PAD * 2);
    const toX = t => PAD + t * (CHART_W - PAD * 2);
    const wseY = toY(wseVal).toFixed(1);

    const bedPts = sectionPts.map((p, i) => (i === 0 ? "M" : "L") + toX(p.t).toFixed(1) + "," + toY(p.bed).toFixed(1));
    const bedPath = bedPts.join(" ") + " L" + toX(1).toFixed(1) + "," + CHART_H + " L" + toX(0).toFixed(1) + "," + CHART_H + " Z";
    const waterPath = bedPts.join(" ") + " L" + toX(1).toFixed(1) + "," + wseY + " L" + toX(0).toFixed(1) + "," + wseY + " Z";

    // Silt fill area: above riverbed, proportional to silt index
    const siltFwdPts = sectionPts.map((p, i) => {
      const h = p.silt ? p.silt.val * Math.max(0.05, p.depth * 0.22) : 0;
      return (i === 0 ? "M" : "L") + toX(p.t).toFixed(1) + "," + toY(p.bed + h).toFixed(1);
    });
    const siltRevPts = sectionPts.slice().reverse().map(p => "L" + toX(p.t).toFixed(1) + "," + toY(p.bed).toFixed(1));
    const siltIndexPath = siltFwdPts.join(" ") + " " + siltRevPts.join(" ") + " Z";

    const hoverW = ((CHART_W - PAD * 2) / STEPS).toFixed(1);
    const hoverRects = sectionPts.map(p => {
      const x = toX(p.t - 1 / (2 * STEPS));
      const dist = Math.round(p.t * totalDist);
      return '<rect class="silt-hz" x="' + x.toFixed(1) + '" y="0" width="' + hoverW + '" height="' + CHART_H + '"' +
        ' data-dist="' + dist + 'm" data-depth="' + p.depth.toFixed(2) + 'm"' +
        ' data-wx="' + p.x + '" data-wz="' + p.z + '"' +
        ' fill="transparent" style="cursor:crosshair"/>';
    }).join("");

    const depthMarkers = [];
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const p = sectionPts[Math.floor(t * STEPS)];
      if (p && p.depth > 0.5) {
        const x1 = toX(p.t).toFixed(1), y1 = wseY, y2 = toY(p.bed).toFixed(1);
        const ym = toY(p.bed + p.depth / 2).toFixed(1);
        depthMarkers.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x1 + '" y2="' + y2 + '" stroke="rgba(221,248,255,0.4)" stroke-width="1" stroke-dasharray="2,2"/>');
        depthMarkers.push('<circle cx="' + x1 + '" cy="' + y1 + '" r="2.5" fill="#35D9FF"/>');
        depthMarkers.push('<circle cx="' + x1 + '" cy="' + y2 + '" r="2.5" fill="#D89A32"/>');
        depthMarkers.push('<text x="' + (parseFloat(x1)-5) + '" y="' + ym + '" fill="#DDF8FF" font-size="9" text-anchor="end" font-weight="500">' + p.depth.toFixed(2) + ' m</text>');
      }
    }

    const csYLabels = [];
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
       csYLabels.push((graphMax - i * (range / steps)).toFixed(1));
    }
    const csYAx = panel.querySelector("#silt-cs-y-axis");
    if (csYAx) csYAx.innerHTML = csYLabels.map(l => '<span>' + l + '</span>').join("");

    cs.innerHTML =
      '<svg viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" preserveAspectRatio="none" style="width:100%;height:100%;display:block;">' +
      '<defs>' +
        '<linearGradient id="csWaterG" x1="0" x2="0" y1="0" y2="1">' +
          '<stop offset="0%" stop-color="rgba(38,130,185,0.35)"/>' +
          '<stop offset="100%" stop-color="rgba(38,130,185,0.12)"/>' +
        '</linearGradient>' +
        '<pattern id="siltDot" width="5" height="5" patternUnits="userSpaceOnUse">' +
          '<circle cx="2.5" cy="2.5" r="1.5" fill="rgba(245,158,11,0.55)"/>' +
        '</pattern>' +
      '</defs>' +
      '<path d="' + waterPath + '" fill="url(#csWaterG)"/>' +
      '<path d="' + siltIndexPath + '" fill="url(#siltDot)"/>' +
      '<path d="' + bedPath + '" fill="rgba(130,95,55,0.40)" stroke="#D89A32" stroke-width="1.5"/>' +
      '<line x1="' + PAD + '" y1="' + wseY + '" x2="' + (CHART_W - PAD) + '" y2="' + wseY + '" stroke="#35D9FF" stroke-width="1.5"/>' +
      '<text x="' + (CHART_W - PAD - 2) + '" y="' + (parseFloat(wseY) - 4) + '" fill="#35D9FF" font-size="9" text-anchor="end" font-weight="600">WSE</text>' +
      depthMarkers.join("") +
      hoverRects +
      '</svg>';

    const csXAx = panel.querySelector("#silt-cs-x-axis");
    if (csXAx) csXAx.innerHTML = [0,.25,.5,.75,1].map(t => '<span>' + Math.round(t*totalDist) + '</span>').join("");

    function sync3dMarker(ds) { scene()?.setSiltHoverMarker?.(parseFloat(ds.wx), parseFloat(ds.wz)); }

    cs.querySelectorAll(".silt-hz").forEach(rect => {
      rect.addEventListener("mouseenter", e => {
        showTT(e,
          '<div class="silt-tt-row"><span>Distance:</span><b>' + rect.dataset.dist + '</b></div>' +
          '<div class="silt-tt-row"><span>Depth:</span><b>' + rect.dataset.depth + '</b></div>'
        );
        sync3dMarker(rect.dataset);
      });
      rect.addEventListener("mousemove", moveTT);
      rect.addEventListener("mouseleave", () => { hideTT(); scene()?.removeSiltHoverMarker?.(); });
    });

    // ---- Silt Profile ----
    const prof = panel.querySelector("#silt-prof-canvas");
    const PSTEPS = 30;
    const profilePts = [];
    for (let i = 0; i <= PSTEPS; i++) {
      const t = i / PSTEPS;
      let val = 0, cls = "None", col = "transparent";
      if (p1 && p2) {
        const x = p1.x + (p2.x - p1.x) * t;
        const z = p1.z + (p2.z - p1.z) * t;
        const s = sampleSiltData(x, z, r.clip);
        if (s) { val = s.val; cls = s.cls; col = s.col; }
        profilePts.push({ t, val, cls, col, x, z });
      } else {
        profilePts.push({ t, val, cls, col, x: 0, z: 0 });
      }
    }
    for (let i = 0; i < profilePts.length; i++) {
      const prev = i > 0 ? profilePts[i-1].val : 0;
      const next = i < profilePts.length - 1 ? profilePts[i+1].val : 0;
      profilePts[i].val = (profilePts[i].val * 2 + prev + next) / 4;
    }

    let maxProfVal = 0;
    profilePts.forEach(p => { if (p.val > maxProfVal) maxProfVal = p.val; });
    const profGraphMax = Math.max(maxProfVal * 1.15, 0.5); // at least 0.5 for scale

    const PH = 220, PW = 600, PP = 15;
    const pY = v => PP + ((profGraphMax - v) / profGraphMax) * (PH - PP * 2);
    const pX = t => PP + t * (PW - PP * 2);
    const phoverW = ((PW - PP * 2) / PSTEPS).toFixed(1);

    const profFwdPts = profilePts.map((p, i) => (i === 0 ? "M" : "L") + pX(p.t).toFixed(1) + "," + pY(p.val).toFixed(1));
    const profAreaPath = profFwdPts.join(" ") + " L" + pX(1).toFixed(1) + "," + PH + " L" + pX(0).toFixed(1) + "," + PH + " Z";
    const profLinePath = profFwdPts.join(" ");

    const phoverRects = profilePts.map(p => {
      const x = pX(p.t - 1 / (2 * PSTEPS));
      const dist = Math.round(p.t * totalDist);
      return '<rect class="silt-hz" x="' + x.toFixed(1) + '" y="0" width="' + phoverW + '" height="' + PH + '"' +
        ' data-dist="' + dist + 'm" data-cls="' + p.cls + '" data-col="' + p.col + '" data-idx="' + p.val.toFixed(2) + '"' +
        ' data-wx="' + p.x + '" data-wz="' + p.z + '"' +
        ' fill="transparent" style="cursor:crosshair"/>';
    }).join("");

    const dotPts = profilePts.filter((_, i) => i % 5 === 0).map(p =>
      '<circle cx="' + pX(p.t).toFixed(1) + '" cy="' + pY(p.val).toFixed(1) + '" r="2.5" fill="rgba(255,255,255,0.8)"/>'
    ).join("");

    const gridH = [0,.25,.5,.75,1].map(v =>
      '<line x1="' + PP + '" y1="' + pY(v*2.5).toFixed(1) + '" x2="' + (PW-PP) + '" y2="' + pY(v*2.5).toFixed(1) + '" stroke="rgba(160,205,220,0.10)" stroke-width="1"/>'
    ).join("");
    const gridV = [.25,.5,.75].map(t =>
      '<line x1="' + pX(t).toFixed(1) + '" y1="0" x2="' + pX(t).toFixed(1) + '" y2="' + PH + '" stroke="rgba(160,205,220,0.10)" stroke-width="1"/>'
    ).join("");

    prof.innerHTML =
      '<svg viewBox="0 0 ' + PW + ' ' + PH + '" preserveAspectRatio="none" style="width:100%;height:100%;display:block;">' +
      '<defs>' +
        '<linearGradient id="profFill" x1="0" x2="1" y1="0" y2="0">' +
          '<stop offset="0%" stop-color="#22c55e" stop-opacity="0.85"/>' +
          '<stop offset="33%" stop-color="#eab308" stop-opacity="0.85"/>' +
          '<stop offset="66%" stop-color="#f97316" stop-opacity="0.85"/>' +
          '<stop offset="100%" stop-color="#ef4444" stop-opacity="0.85"/>' +
        '</linearGradient>' +
        '<linearGradient id="profAlpha" x1="0" x2="0" y1="0" y2="1">' +
          '<stop offset="0%" stop-opacity="1"/>' +
          '<stop offset="100%" stop-opacity="0.1"/>' +
        '</linearGradient>' +
        '<mask id="profMask"><rect x="0" y="0" width="' + PW + '" height="' + PH + '" fill="url(#profAlpha)"/></mask>' +
      '</defs>' +
      gridH + gridV +
      '<path d="' + profAreaPath + '" fill="url(#profFill)" mask="url(#profMask)"/>' +
      '<path d="' + profLinePath + '" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>' +
      dotPts +
      phoverRects +
      '</svg>';

    prof.querySelectorAll(".silt-hz").forEach(rect => {
      rect.addEventListener("mouseenter", e => {
        showTT(e,
          '<div class="silt-tt-row"><span>Distance:</span><b>' + rect.dataset.dist + '</b></div>' +
          '<div class="silt-tt-row"><span>Silt Index:</span><b>' + rect.dataset.idx + '</b></div>' +
          '<div class="silt-tt-row"><span>Class:</span><b style="color:' + rect.dataset.col + '">' + rect.dataset.cls + '</b></div>'
        );
        sync3dMarker(rect.dataset);
      });
      rect.addEventListener("mousemove", moveTT);
      rect.addEventListener("mouseleave", () => { hideTT(); scene()?.removeSiltHoverMarker?.(); });
    });

    const profXAx = panel.querySelector("#silt-prof-x-axis");
    if (profXAx) profXAx.innerHTML = [0,.25,.5,.75,1].map(t => '<span>' + Math.round(t*totalDist) + '</span>').join("");

    const profYAx = panel.querySelector("#silt-profile-y-axis");
    if (profYAx) {
      const pSteps = 5;
      profYAx.innerHTML = Array.from({length: pSteps + 1}, (_, i) => {
        const v = profGraphMax - i * (profGraphMax / pSteps);
        return '<span>' + v.toFixed(1) + '</span>';
      }).join("");
    }
  }

  return { open, close, isOpen: () => active && !panel.hidden, el: panel };
}
