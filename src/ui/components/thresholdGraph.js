/**
 * Threshold Graph — Mula–Mutha River Station WSE / Threshold / Margin
 *
 * Opens when the user clicks any point on the river surface.
 * Displays for the CLICKED chainage station:
 *   - WSE Now (modelled, from forecastService)
 *   - Flood Threshold (class-based default 2.0 m above datum)
 *   - Margin (Threshold − WSE Now)
 *   - +72 h forecast WSE
 *   - +72 h forecast margin
 *   - Risk score (0–100)
 *   - Longitudinal WSE profile (all stations) with active marker
 *
 * Triggered by: "river-station-selected" CustomEvent
 * Closed by: X button, ESC key, backdrop click
 * Does NOT open automatically on hydrology-state-change.
 *
 * Separates cleanly from the Cross-Section & Hydraulic Profile modal.
 */

import { X } from "lucide";
import { lucideHtml } from "../icons.js";
import { getForecastEngine } from "../../services/forecastService.js";

// ── Threshold constants (mirrors digitalTwinService.js THRESHOLD_BY_CLASS) ──
const THRESHOLD_DEFAULT_M = 2.0; // default for arbitrary river chainage
const WARN_MARGIN_M = 0.5;

export function mountThresholdGraph(root) {
  // ── DOM ──────────────────────────────────────────────────────────────────
  const backdrop = document.createElement("div");
  backdrop.id = "tg-backdrop";
  backdrop.className = "tg-backdrop map-chrome";
  backdrop.hidden = true;
  backdrop.style.display = "none";
  backdrop.style.pointerEvents = "none";

  const modal = document.createElement("div");
  modal.id = "tg-modal";
  modal.className = "tg-modal hud";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "tg-title");
  modal.setAttribute("aria-label", "River Threshold Graph");

  modal.innerHTML = `
    <div class="tg-header">
      <div class="tg-title-group">
        <h3 id="tg-title" class="tg-title">MULA-MUTHA HYDROLOGY</h3>
        <span id="tg-station-badge" class="tg-badge">—</span>
        <span id="tg-status-badge" class="tg-badge tg-badge--status">—</span>
      </div>
      <button id="tg-close-btn" class="tg-close-btn" aria-label="Close threshold graph">${lucideHtml(X, { size: 18 })}</button>
    </div>

    <div class="tg-body">
      <!-- Left: metrics -->
      <div class="tg-metrics">
        <h4 class="tg-section-title">HYDRAULIC THRESHOLD STATUS</h4>
        <div class="tg-metric-row"><span class="k">Station</span><span class="v" id="tg-val-station">—</span></div>
        <div class="tg-metric-row"><span class="k">WSE Now</span><span class="v tg-wse" id="tg-val-wse">—</span></div>
        <div class="tg-metric-row"><span class="k">Threshold</span><span class="v tg-thr" id="tg-val-thr">—</span></div>
        <div class="tg-metric-row"><span class="k">Margin</span><span class="v" id="tg-val-margin">—</span></div>
        <div class="tg-metric-row"><span class="k">+72 h Forecast WSE</span><span class="v" id="tg-val-p72wse">—</span></div>
        <div class="tg-metric-row"><span class="k">+72 h Margin</span><span class="v" id="tg-val-p72margin">—</span></div>
        <div class="tg-metric-row"><span class="k">Risk Score</span><span class="v" id="tg-val-risk">—</span></div>

        <div class="tg-divider"></div>
        <h4 class="tg-section-title">PROVENANCE</h4>
        <div class="tg-metric-row"><span class="k">WSE Source</span><span class="v tg-prov" id="tg-val-wseprov">—</span></div>
        <div class="tg-metric-row"><span class="k">Threshold Basis</span><span class="v tg-prov" id="tg-val-thrprov">—</span></div>
        <div class="tg-metric-row"><span class="k">Forecast Model</span><span class="v tg-prov" id="tg-val-fcastprov">—</span></div>

        <!-- Risk bar -->
        <div class="tg-divider"></div>
        <div class="tg-risk-wrap">
          <div class="tg-risk-bar">
            <div class="tg-risk-bar__fill" id="tg-risk-bar-fill" data-status="ok" style="width:0%"></div>
          </div>
          <span class="tg-risk-label">Risk <strong id="tg-risk-score">0</strong>/100</span>
        </div>
      </div>

      <!-- Right: SVG graph -->
      <div class="tg-graph-area">
        <div class="tg-tabs">
          <button id="tg-tab-station" class="tg-tab active">Station Overview</button>
          <button id="tg-tab-profile" class="tg-tab">WSE Profile (Longitudinal)</button>
        </div>
        <div class="tg-svg-wrapper">
          <svg id="tg-svg" class="tg-svg" preserveAspectRatio="xMidYMid meet" viewBox="0 0 520 260"></svg>
        </div>
      </div>
    </div>
  `;

  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  _injectStyles();

  // ── Internal state ────────────────────────────────────────────────────────
  let _isOpen = false;
  let _previousFocus = null;
  let _currentStation = null;   // { chainage_m, stationLabel, stationRecord }
  let _engineData = null;       // cached forecast engine snapshot
  let _activeTab = "station";   // "station" | "profile"

  const closeBtn  = modal.querySelector("#tg-close-btn");
  const tabStation = modal.querySelector("#tg-tab-station");
  const tabProfile = modal.querySelector("#tg-tab-profile");
  const svgEl     = modal.querySelector("#tg-svg");

  // ── Close on X button ────────────────────────────────────────────────────
  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hide();
  });

  // ── Close on backdrop click ───────────────────────────────────────────────
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) hide();
  });

  // ── Close on ESC ─────────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _isOpen) hide();
  });

  // ── Tab switching ─────────────────────────────────────────────────────────
  tabStation?.addEventListener("click", () => {
    _activeTab = "station";
    tabStation.classList.add("active");
    tabProfile?.classList.remove("active");
    if (_engineData && _currentStation) _renderGraph();
  });
  tabProfile?.addEventListener("click", () => {
    _activeTab = "profile";
    tabProfile.classList.add("active");
    tabStation?.classList.remove("active");
    if (_engineData && _currentStation) _renderGraph();
  });

  // ── river-station-selected listener ──────────────────────────────────────
  // This is the ONLY event that opens the graph.
  document.addEventListener("river-station-selected", (e) => {
    const { chainage_m, stationLabel, stationRecord, worldPosition } = e.detail ?? {};
    if (chainage_m == null) return;

    console.log("[RiverSelection] ACTIVE STATION", {
      chainage_m,
      stationLabel,
    });

    _currentStation = { chainage_m, stationLabel, stationRecord };
    _openOrUpdate();
  });

  // ── Open / Update ─────────────────────────────────────────────────────────
  async function _openOrUpdate() {
    if (_isOpen) {
      // Already open — update data for new station
      await _loadEngineData();
      _renderAll();
      console.log("[ThresholdGraph] UPDATE", {
        chainage_m: _currentStation?.chainage_m,
        stationLabel: _currentStation?.stationLabel,
      });
      return;
    }

    // Open fresh
    _isOpen = true;
    _previousFocus = document.activeElement;
    backdrop.hidden = false;
    backdrop.style.display = "flex";
    backdrop.style.pointerEvents = "auto";
    _activeTab = "station";
    tabStation?.classList.add("active");
    tabProfile?.classList.remove("active");

    // Optimistically render loading state while engine loads
    _renderLoadingState();

    await _loadEngineData();
    _renderAll();

    requestAnimationFrame(() => closeBtn?.focus());

    console.log("[ThresholdGraph] OPEN", {
      chainage_m: _currentStation?.chainage_m,
      stationLabel: _currentStation?.stationLabel,
      wse: _engineData?.wseNow,
      threshold: _engineData?.threshold,
      margin: _engineData?.margin,
      source: _engineData?.wseSource,
    });
  }

  function hide() {
    if (!_isOpen) return;
    _isOpen = false;
    _currentStation = null;
    _engineData = null;
    backdrop.hidden = true;
    backdrop.style.display = "none";
    backdrop.style.pointerEvents = "none";
    const ft = _previousFocus;
    _previousFocus = null;
    if (ft && typeof ft.focus === "function") ft.focus();
  }

  // ── Load forecast engine data for current station ─────────────────────────
  async function _loadEngineData() {
    if (!_currentStation) return;
    const { chainage_m } = _currentStation;
    try {
      const eng = await getForecastEngine();
      const hydraulic = eng.currentHydraulic(chainage_m);
      const { wse, chainage_m: allChainage } = hydraulic;
      const cell = eng.cellForChainage(chainage_m);

      // Current WSE at clicked chainage
      const wseNow = Array.isArray(wse) && wse.length > 0
        ? (wse[cell] ?? wse[0])
        : 0;

      // +72h forecast WSE (P50) at same cell
      const k72 = Math.min(71, 72 - 1); // 72h lead, 0-indexed
      const [, q50_72] = eng.qQuantiles(k72, [0.1, 0.5, 0.9]);
      const prof72 = eng.wseProfile(q50_72);
      const wse72 = prof72[Math.max(0, Math.min(prof72.length - 1, cell))] ?? 0;

      // Threshold and margin
      const threshold = THRESHOLD_DEFAULT_M;
      const margin = threshold - wseNow;
      const margin72 = threshold - wse72;

      // Risk score (mirrors digitalTwinService logic)
      const nowScore  = Math.max(0, Math.min(1, (WARN_MARGIN_M - margin)   / (WARN_MARGIN_M + 2)));
      const p72Score  = Math.max(0, Math.min(1, (WARN_MARGIN_M - margin72) / (WARN_MARGIN_M + 2)));
      const riskScore = Math.round((nowScore * 0.6 + p72Score * 0.4) * 100);

      const status = margin <= 0 ? "critical" : margin <= WARN_MARGIN_M ? "warn" : "ok";

      // Full longitudinal WSE profile for profile tab
      const allWse    = wse.slice();       // current WSE at all cells
      const allWse72  = prof72.slice();    // +72h WSE at all cells

      _engineData = {
        wseNow:    round2(wseNow),
        wse72:     round2(wse72),
        threshold: round2(threshold),
        margin:    round2(margin),
        margin72:  round2(margin72),
        riskScore,
        status,
        cell,
        allChainage,
        allWse,
        allWse72,
        wseSource:    hydraulic.dischargeLabel ?? "MODEL",
        wseProvenance: "MODELLED",
      };
    } catch (err) {
      console.error("[ThresholdGraph] Failed to load engine data:", err);
      _engineData = null;
    }
  }

  // ── Render loading state ──────────────────────────────────────────────────
  function _renderLoadingState() {
    const fields = ["#tg-val-station","#tg-val-wse","#tg-val-thr","#tg-val-margin",
                    "#tg-val-p72wse","#tg-val-p72margin","#tg-val-risk",
                    "#tg-val-wseprov","#tg-val-thrprov","#tg-val-fcastprov"];
    fields.forEach((sel) => _setText(sel, "Loading…"));
    _setText("#tg-station-badge", _currentStation?.stationLabel ?? "—");
    _setText("#tg-status-badge", "—");
    if (svgEl) svgEl.innerHTML = `
      <text x="260" y="130" fill="rgba(255,255,255,0.4)" text-anchor="middle" font-size="13">Loading hydraulic data…</text>`;
  }

  // ── Render everything ─────────────────────────────────────────────────────
  function _renderAll() {
    _renderMetrics();
    _renderGraph();
  }

  function _renderMetrics() {
    if (!_currentStation || !_engineData) return;
    const { chainage_m, stationLabel } = _currentStation;
    const {
      wseNow, wse72, threshold, margin, margin72,
      riskScore, status, wseSource, wseProvenance,
    } = _engineData;

    // Header badges
    _setText("#tg-station-badge", stationLabel ?? `CH ${Math.round(chainage_m)}m`);
    const statusBadge = modal.querySelector("#tg-status-badge");
    if (statusBadge) {
      const labels   = { ok: "SAFE", warn: "WARNING", critical: "CRITICAL" };
      const colors   = { ok: "#00e5b4", warn: "#ffc300", critical: "#ff3d57" };
      const bgColors = {
        ok:       "rgba(0,229,180,0.18)",
        warn:     "rgba(255,195,0,0.18)",
        critical: "rgba(255,61,87,0.18)",
      };
      statusBadge.textContent = labels[status] ?? status.toUpperCase();
      statusBadge.style.color = colors[status] ?? "#94a3b8";
      statusBadge.style.background = bgColors[status] ?? "rgba(255,255,255,0.08)";
    }

    // Metric fields
    _setText("#tg-val-station", stationLabel ?? `${chainage_m.toFixed(1)} m`);

    const wseEl = modal.querySelector("#tg-val-wse");
    if (wseEl) {
      wseEl.textContent = `${wseNow.toFixed(3)} m`;
      wseEl.style.color = margin <= 0 ? "#ff3d57" : margin <= WARN_MARGIN_M ? "#ffc300" : "#00e5b4";
    }

    _setText("#tg-val-thr", `${threshold.toFixed(2)} m`);

    const marginEl = modal.querySelector("#tg-val-margin");
    if (marginEl) {
      marginEl.textContent = `${margin >= 0 ? "+" : ""}${margin.toFixed(3)} m`;
      marginEl.style.color = margin <= 0 ? "#ff3d57" : margin <= WARN_MARGIN_M ? "#ffc300" : "#00e5b4";
      marginEl.dataset.sign = margin >= 0 ? "pos" : "neg";
    }

    _setText("#tg-val-p72wse", `${wse72.toFixed(3)} m`);

    const p72El = modal.querySelector("#tg-val-p72margin");
    if (p72El) {
      p72El.textContent = `${margin72 >= 0 ? "+" : ""}${margin72.toFixed(3)} m`;
      p72El.style.color = margin72 <= 0 ? "#ff3d57" : margin72 <= WARN_MARGIN_M ? "#ffc300" : "#00e5b4";
    }

    _setText("#tg-val-risk", `${riskScore} / 100`);

    // Risk bar
    const barFill = modal.querySelector("#tg-risk-bar-fill");
    if (barFill) {
      barFill.style.width = `${Math.min(100, riskScore)}%`;
      barFill.dataset.status = status;
    }
    _setText("#tg-risk-score", String(riskScore));

    // Provenance
    _setText("#tg-val-wseprov",   wseProvenance ?? "MODELLED");
    _setText("#tg-val-thrprov",   "CLASS_DEFAULT · 2.0 m ASSUMED");
    _setText("#tg-val-fcastprov", "MODEL FORECAST · ENSEMBLE HYDRAULIC");
  }

  // ── SVG graph rendering ───────────────────────────────────────────────────
  function _renderGraph() {
    if (!_engineData) return;
    if (_activeTab === "station") {
      _renderStationBarChart(svgEl);
    } else {
      _renderProfileSvg(svgEl);
    }
  }

  /**
   * Station Overview tab — vertical bar chart showing WSE Now, +72h, and Threshold.
   * X axis: categories (WSE Now, +72h Forecast)
   * Y axis: Water Surface Elevation (m)
   */
  function _renderStationBarChart(svgEl) {
    const { wseNow, wse72, threshold, margin, margin72, status } = _engineData;
    const stLabel = _currentStation?.stationLabel ?? "—";

    const svgW = 520, svgH = 260;
    const padL = 58, padR = 20, padT = 28, padB = 50;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;

    // Y range: 0 to max(threshold*1.15, wse72*1.15, 0.5)
    const yMax = Math.max(threshold * 1.18, wse72 * 1.18, 0.5);
    const yMin = 0;
    const yRange = yMax - yMin;
    const scaleY = (v) => padT + plotH - ((v - yMin) / yRange) * plotH;

    // Bar layout: 2 bars (WSE Now, +72h), with gap
    const barW  = plotW * 0.22;
    const gap   = plotW * 0.18;
    const startX = padL + (plotW - 2 * barW - gap) / 2;
    const bar1X  = startX;
    const bar2X  = startX + barW + gap;

    const bar1Top  = scaleY(Math.max(0, wseNow));
    const bar2Top  = scaleY(Math.max(0, wse72));
    const baselineY = scaleY(0);
    const thrY      = scaleY(threshold);

    // Status color for WSE bars
    const STATUS_C = { ok: "#00e5b4", warn: "#ffc300", critical: "#ff3d57" };
    const barColor   = STATUS_C[status] ?? "#4fc8eb";
    const bar2Status = margin72 <= 0 ? "critical" : margin72 <= WARN_MARGIN_M ? "warn" : "ok";
    const bar2Color  = STATUS_C[bar2Status];

    // Y-axis ticks: 4 evenly spaced
    const yTickCount = 4;
    const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => {
      const v = yMin + (yRange * i) / yTickCount;
      return v;
    });
    const yTickSvg = yTicks.map((v) => {
      const py = scaleY(v);
      return `
        <line x1="${padL - 5}" y1="${py}" x2="${padL + plotW}" y2="${py}"
              stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,4"/>
        <line x1="${padL - 5}" y1="${py}" x2="${padL}" y2="${py}"
              stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
        <text x="${padL - 8}" y="${py + 3.5}"
              fill="rgba(255,255,255,0.5)" font-size="9" text-anchor="end">${v.toFixed(2)}</text>`;
    }).join("");

    // Axis labels
    const yCx = 11, yCy = padT + plotH / 2;
    const xCx = padL + plotW / 2, xCy = svgH - 3;

    // Margin annotation arrows
    const annX = bar1X + barW + gap / 2;
    const annWSEY  = scaleY(wseNow);
    const annMid   = (annWSEY + thrY) / 2;

    svgEl.innerHTML = `
      <!-- Axes -->
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}"
            stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}"
            stroke="rgba(255,255,255,0.22)" stroke-width="1"/>

      <!-- Y-axis grid + ticks -->
      ${yTickSvg}

      <!-- WSE Now bar -->
      <rect x="${bar1X}" y="${bar1Top}"
            width="${barW}" height="${baselineY - bar1Top}"
            fill="${barColor}" opacity="0.72" rx="2"/>
      <text x="${bar1X + barW / 2}" y="${bar1Top - 5}"
            fill="${barColor}" font-size="10" text-anchor="middle" font-weight="600">
        ${wseNow.toFixed(3)} m
      </text>
      <text x="${bar1X + barW / 2}" y="${padT + plotH + 16}"
            fill="rgba(255,255,255,0.65)" font-size="10" text-anchor="middle">WSE Now</text>

      <!-- +72h Forecast bar -->
      <rect x="${bar2X}" y="${bar2Top}"
            width="${barW}" height="${baselineY - bar2Top}"
            fill="${bar2Color}" opacity="0.55" rx="2"/>
      <text x="${bar2X + barW / 2}" y="${bar2Top - 5}"
            fill="${bar2Color}" font-size="10" text-anchor="middle" font-weight="600">
        ${wse72.toFixed(3)} m
      </text>
      <text x="${bar2X + barW / 2}" y="${padT + plotH + 16}"
            fill="rgba(255,255,255,0.65)" font-size="10" text-anchor="middle">+72h Forecast</text>

      <!-- Threshold line -->
      <line x1="${padL}" y1="${thrY}" x2="${padL + plotW}" y2="${thrY}"
            stroke="#ff3d57" stroke-width="2" stroke-dasharray="6,3"/>
      <text x="${padL + plotW - 4}" y="${thrY - 5}"
            fill="#ff3d57" font-size="10" text-anchor="end" font-weight="600">
        Threshold ${threshold.toFixed(2)} m
      </text>

      <!-- Margin annotation: WSE Now ↔ Threshold -->
      <line x1="${annX}" y1="${thrY}" x2="${annX}" y2="${annWSEY}"
            stroke="rgba(255,255,255,0.3)" stroke-width="1" stroke-dasharray="2,2"/>
      <text x="${annX + 6}" y="${annMid}"
            fill="rgba(255,255,255,0.55)" font-size="9" text-anchor="start">
        Margin ${margin >= 0 ? "+" : ""}${margin.toFixed(2)} m
      </text>

      <!-- Station header inside chart -->
      <text x="${padL + plotW / 2}" y="${padT - 8}"
            fill="rgba(255,255,255,0.45)" font-size="9" text-anchor="middle">
        ${stLabel}
      </text>

      <!-- Y-axis label (rotated) -->
      <text x="${yCx}" y="${yCy}" fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="middle"
            transform="rotate(-90,${yCx},${yCy})">Water Surface Elevation (m)</text>

      <!-- X-axis label -->
      <text x="${xCx}" y="${xCy}" fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="middle">
        Station
      </text>
    `;
  }

  /**
   * Longitudinal Profile tab — WSE profile along entire reach with active marker.
   * X axis: Chainage (km)
   * Y axis: Water Surface Elevation (m)
   */
  function _renderProfileSvg(svgEl) {
    const { allChainage, allWse, allWse72, threshold, cell } = _engineData;
    if (!allChainage?.length) {
      svgEl.innerHTML = `<text x="260" y="130" fill="white" text-anchor="middle">Profile data unavailable</text>`;
      return;
    }

    const svgW = 520, svgH = 260;
    const padL = 58, padR = 14, padT = 28, padB = 44;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;

    const maxCh = allChainage[allChainage.length - 1] || 16960;

    // Y range: span both profiles + threshold with 10% headroom
    const allY = [...allWse, ...allWse72, threshold];
    const rawMin = Math.min(...allY);
    const rawMax = Math.max(...allY);
    const yPad = (rawMax - rawMin) * 0.12 || 0.2;
    const yMin = rawMin - yPad;
    const yMax = rawMax + yPad;
    const yRange = yMax - yMin;

    const scaleX = (m) => padL + (m / maxCh) * plotW;
    const scaleY = (v) => padT + plotH - ((v - yMin) / yRange) * plotH;

    // Sample every Nth record to stay ≤100 SVG points
    const N = allChainage.length;
    const step = Math.max(1, Math.floor(N / 100));
    const idx  = [];
    for (let i = 0; i < N; i += step) idx.push(i);
    if (idx[idx.length - 1] !== N - 1) idx.push(N - 1);

    const wseLine  = idx.map((i, j) =>
      `${j === 0 ? "M" : "L"}${scaleX(allChainage[i]).toFixed(1)},${scaleY(allWse[i]).toFixed(1)}`
    ).join(" ");
    const wse72Line = idx.map((i, j) =>
      `${j === 0 ? "M" : "L"}${scaleX(allChainage[i]).toFixed(1)},${scaleY(allWse72[i]).toFixed(1)}`
    ).join(" ");

    const thrY      = scaleY(threshold);
    const activeCh  = allChainage[cell] ?? 0;
    const activeX   = scaleX(activeCh);
    const activeWseY = scaleY(allWse[cell] ?? allWse[0]);

    // X-axis ticks: 0, 4, 8, 12, 16.96 km
    const xTicks = [0, 4, 8, 12, 16.96].map((km) => {
      const px = padL + (km / 16.96) * plotW;
      return `
        <line x1="${px}" y1="${padT + plotH}" x2="${px}" y2="${padT + plotH + 5}"
              stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
        <text x="${px}" y="${padT + plotH + 14}"
              fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="middle">${km}</text>`;
    }).join("");

    // Y-axis ticks: 4 levels
    const yTicks = [0, 0.25, 0.5, 0.75, 1.0].map((frac) => {
      const v  = yMin + frac * yRange;
      const py = scaleY(v);
      if (py < padT - 2 || py > padT + plotH + 2) return "";
      return `
        <line x1="${padL - 5}" y1="${py}" x2="${padL + plotW}" y2="${py}"
              stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,4"/>
        <line x1="${padL - 5}" y1="${py}" x2="${padL}" y2="${py}"
              stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
        <text x="${padL - 7}" y="${py + 3.5}"
              fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="end">${v.toFixed(2)}</text>`;
    }).join("");

    const yCx = 11, yCy = padT + plotH / 2;
    const xCx = padL + plotW / 2, xCy = svgH - 3;
    const stLabel = _currentStation?.stationLabel ?? "—";

    svgEl.innerHTML = `
      <!-- Axes -->
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}"
            stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}"
            stroke="rgba(255,255,255,0.22)" stroke-width="1"/>

      <!-- Y ticks + grid -->
      ${yTicks}

      <!-- Threshold line -->
      <line x1="${padL}" y1="${thrY}" x2="${padL + plotW}" y2="${thrY}"
            stroke="#ff3d57" stroke-width="1.5" stroke-dasharray="5,3"/>
      <text x="${padL + plotW - 4}" y="${thrY - 4}"
            fill="#ff3d57" font-size="9" text-anchor="end">Threshold</text>

      <!-- +72h WSE profile -->
      <path d="${wse72Line}" fill="none" stroke="#ffc300" stroke-width="1.5" opacity="0.65"/>

      <!-- WSE Now profile -->
      <path d="${wseLine}" fill="none" stroke="#00e5b4" stroke-width="2"/>

      <!-- Active station marker -->
      <line x1="${activeX}" y1="${padT}" x2="${activeX}" y2="${padT + plotH}"
            stroke="#e89a1c" stroke-width="2" stroke-dasharray="4,4"/>
      <circle cx="${activeX}" cy="${activeWseY}" r="4" fill="#e89a1c"/>
      <text x="${activeX}" y="${padT - 8}"
            fill="#e89a1c" font-size="10" text-anchor="middle" font-weight="600">${stLabel}</text>

      <!-- X-axis ticks -->
      ${xTicks}

      <!-- Legend -->
      <text x="${padL + 6}" y="${padT + 14}" fill="#00e5b4" font-size="9">― WSE Now</text>
      <text x="${padL + 6}" y="${padT + 26}" fill="#ffc300" font-size="9">― +72h Forecast</text>

      <!-- Y-axis label -->
      <text x="${yCx}" y="${yCy}" fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="middle"
            transform="rotate(-90,${yCx},${yCy})">Water Surface Elevation (m)</text>

      <!-- X-axis label -->
      <text x="${xCx}" y="${xCy}" fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="middle">
        Chainage (km)
      </text>
    `;
  }

  // ── DOM helper ────────────────────────────────────────────────────────────
  function _setText(selector, text) {
    const el = modal.querySelector(selector);
    if (el) el.textContent = text;
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById("tg-styles")) return;
    const style = document.createElement("style");
    style.id = "tg-styles";
    style.textContent = `
      .tg-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(4, 9, 20, 0.70);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9998;
      }
      .tg-modal {
        width: 840px;
        max-width: 96vw;
        background: rgba(14, 23, 38, 0.95);
        border: 1px solid rgba(0, 229, 180, 0.25);
        border-radius: 10px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.6);
        color: #e2e8f0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .tg-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .tg-title-group {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .tg-title {
        margin: 0;
        font-size: 13px;
        letter-spacing: 0.08em;
        font-weight: 700;
        color: #f8fafc;
      }
      .tg-badge {
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        background: rgba(255,255,255,0.08);
        color: #94a3b8;
      }
      .tg-badge--status {
        background: rgba(0,229,180,0.18);
        color: #00e5b4;
      }
      .tg-close-btn {
        background: none;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
      }
      .tg-close-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }
      .tg-body {
        display: grid;
        grid-template-columns: 260px 1fr;
        padding: 16px 20px 20px;
        gap: 20px;
      }
      .tg-metrics {
        background: rgba(255,255,255,0.03);
        border-radius: 6px;
        padding: 12px 14px;
        font-size: 11px;
      }
      .tg-section-title {
        margin: 0 0 10px;
        font-size: 10px;
        color: #94a3b8;
        letter-spacing: 0.05em;
        font-weight: 700;
      }
      .tg-metric-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 6px;
      }
      .tg-metric-row .k { color: #64748b; font-size: 10px; }
      .tg-metric-row .v { font-weight: 600; color: #f1f5f9; font-size: 11px; }
      .tg-metric-row .tg-wse,
      .tg-metric-row .tg-thr { color: #4fc8eb; }
      .tg-metric-row .tg-prov { color: #e89a1c; font-size: 9px; font-weight: 500; }
      .tg-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 10px 0; }
      .tg-risk-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
      }
      .tg-risk-bar {
        flex: 1;
        height: 6px;
        background: rgba(255,255,255,0.08);
        border-radius: 3px;
        overflow: hidden;
      }
      .tg-risk-bar__fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.4s ease;
        background: #00e5b4;
      }
      .tg-risk-bar__fill[data-status="warn"]     { background: #ffc300; }
      .tg-risk-bar__fill[data-status="critical"] { background: #ff3d57; }
      .tg-risk-label { font-size: 10px; color: #94a3b8; white-space: nowrap; }
      .tg-graph-area {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .tg-tabs {
        display: flex;
        gap: 8px;
      }
      .tg-tab {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        color: #94a3b8;
        padding: 6px 14px;
        font-size: 11px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .tg-tab.active {
        background: rgba(0,229,180,0.18);
        border-color: #00e5b4;
        color: #00e5b4;
        font-weight: 600;
      }
      .tg-svg-wrapper {
        background: rgba(0,0,0,0.38);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 6px;
        padding: 8px;
        flex: 1;
      }
      .tg-svg {
        width: 100%;
        height: 240px;
      }
    `;
    document.head.appendChild(style);
  }

  // ── Expose ────────────────────────────────────────────────────────────────
  window.__MM_THRESHOLD_GRAPH__ = { hide, isOpen: () => _isOpen };

  return { hide, isOpen: () => _isOpen };
}

function round2(v) {
  return Math.round((v ?? 0) * 1000) / 1000;
}
