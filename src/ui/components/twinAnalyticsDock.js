/**
 * Twin Analytics Dock — Mula–Mutha Operational Dashboard
 *
 * Mounts at the bottom of the screen. Features:
 * - End-to-end asset risk strip (sorted by chainage)
 * - Forecast horizon toggles (+6h, +24h, +48h, +72h)
 * - Simulation stepper controls (-, +)
 * - Embedded SVG hydrograph (past 72h observed + 72h forecast quantiles)
 */

import { setForecastHorizon, FORECAST_HORIZONS, selectTwinAsset } from "../../services/digitalTwinService.js";

const STATUS_COLOR = {
  ok: "#00e5b4",
  warn: "#ffc300",
  critical: "#ff3d57",
  unknown: "#7a8ea4",
};

export function mountTwinAnalyticsDock(root) {
  const el = document.createElement("section");
  el.id = "dt-analytics-dock";
  el.className = "dt-dock hud";
  el.innerHTML = _buildSkeleton();
  root.appendChild(el);

  // ─── DOM refs ────────────────────────────────────────────────────────────
  const toggleBtn = el.querySelector("#dt-dock-toggle");
  const horizonWrap = el.querySelector("#dt-horizon-toggles");
  const stepMinus = el.querySelector("#dt-step-minus");
  const stepPlus = el.querySelector("#dt-step-plus");
  const assetStrip = el.querySelector("#dt-asset-strip");
  const hydroSvg = el.querySelector("#dt-hydrograph-svg");
  const hydroTooltip = el.querySelector("#dt-hydro-tooltip");

  let _collapsed = false;
  let _currentState = null;
  let _activeHorizon = 24;

  // ─── Events ──────────────────────────────────────────────────────────────
  toggleBtn?.addEventListener("click", () => {
    _collapsed = !_collapsed;
    el.classList.toggle("dt-dock--collapsed", _collapsed);
    if (toggleBtn) toggleBtn.textContent = _collapsed ? "▴" : "▾";
  });

  horizonWrap?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-horizon]");
    if (!btn) return;
    const h = parseInt(btn.dataset.horizon, 10);
    if (h) {
      _activeHorizon = h;
      setForecastHorizon(h);
      _renderHorizonToggles();
    }
  });

  document.addEventListener("twin-state-change", (e) => {
    _currentState = e.detail;
    _activeHorizon = e.detail.forecastHorizon ?? 24;
    _renderHorizonToggles();
    _renderAssetStrip(e.detail);
    _renderHydrograph(e.detail);
  });

  document.addEventListener("twin-asset-select", (e) => {
    const id = e.detail?.id;
    assetStrip.querySelectorAll(".dt-strip-node").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.id === id);
    });
  });

  // ─── Renderers ───────────────────────────────────────────────────────────

  function _renderHorizonToggles() {
    horizonWrap.innerHTML = FORECAST_HORIZONS.map((h) => `
      <button class="dt-horizon-btn ${h === _activeHorizon ? "active" : ""}" data-horizon="${h}">
        +${h}h
      </button>
    `).join("");
  }

  function _renderAssetStrip(state) {
    if (!state?.assets) return;
    const sorted = [...state.assets].sort((a, b) => a.chainage_m - b.chainage_m);
    
    // Distribute nodes evenly across the strip (or proportionally to chainage)
    const reachLen = state.reachLenM || 1;
    
    assetStrip.innerHTML = sorted.map((a) => {
      const pct = (a.chainage_m / reachLen) * 100;
      const isSel = state.selectedAsset?.id === a.id;
      return `
        <div class="dt-strip-node dt-strip-node--${a.status} ${isSel ? "is-selected" : ""}" 
             style="left: ${pct}%" 
             data-id="${a.id}" 
             title="${a.name} (${a.chainage_km?.toFixed(1)} km) - ${a.status}">
        </div>
      `;
    }).join("");

    assetStrip.querySelectorAll(".dt-strip-node").forEach((node) => {
      node.addEventListener("click", () => {
        selectTwinAsset(node.dataset.id);
      });
    });
  }

  function _renderHydrograph(state) {
    const data = state?.hydrograph;
    if (!data) return;

    const W = 600;
    const H = 140;
    const padding = { top: 20, right: 20, bottom: 20, left: 50 };

    const { obs, forecast, thresholdQ, nowH } = data;
    
    // X scale: -HYDRO_PAST_H to _activeHorizon
    const xMin = -72;
    const xMax = _activeHorizon;
    
    // Y scale: 0 to max(Q) * 1.2
    const allQ = [...obs.q, ...forecast.q90, thresholdQ];
    const yMax = Math.max(...allQ, 100) * 1.2;

    const scaleX = (h) => padding.left + ((h - xMin) / (xMax - xMin)) * (W - padding.left - padding.right);
    const scaleY = (q) => H - padding.bottom - (q / yMax) * (H - padding.top - padding.bottom);

    // Build SVG paths
    const obsPath = obs.times.map((t, i) => `${i===0?'M':'L'}${scaleX(t)},${scaleY(obs.q[i])}`).join(" ");
    
    // Forecast Band (P10 to P90)
    let bandPath = forecast.times.map((t, i) => `${i===0?'M':'L'}${scaleX(t)},${scaleY(forecast.q90[i])}`).join(" ");
    const reverseP10 = [...forecast.times].reverse().map((t, i) => {
      const revIdx = forecast.times.length - 1 - i;
      return `L${scaleX(t)},${scaleY(forecast.q10[revIdx])}`;
    }).join(" ");
    
    // Connect now to start of forecast band
    const nowX = scaleX(0);
    const nowY = scaleY(obs.q[obs.q.length - 1] ?? 0);
    bandPath = `M${nowX},${nowY} L${scaleX(forecast.times[0])},${scaleY(forecast.q90[0])} ` + bandPath.substring(1) + " " + reverseP10 + ` L${nowX},${nowY} Z`;

    const medianPath = `M${nowX},${nowY} ` + forecast.times.map((t, i) => `L${scaleX(t)},${scaleY(forecast.q50[i])}`).join(" ");
    
    const thrY = scaleY(thresholdQ);

    hydroSvg.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none">
        <defs>
          <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#00e5b4" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="#00e5b4" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        
        <!-- Axes / Grid -->
        <line x1="${padding.left}" y1="${H-padding.bottom}" x2="${W-padding.right}" y2="${H-padding.bottom}" stroke="#444" />
        <line x1="${nowX}" y1="${padding.top}" x2="${nowX}" y2="${H-padding.bottom}" stroke="#666" stroke-dasharray="4 4" />
        
        <!-- Threshold -->
        <line x1="${padding.left}" y1="${thrY}" x2="${W-padding.right}" y2="${thrY}" stroke="${STATUS_COLOR.critical}" stroke-dasharray="2 2" stroke-width="1.5" />
        <text x="${padding.left + 5}" y="${thrY - 5}" fill="${STATUS_COLOR.critical}" font-size="10">Threshold</text>

        <!-- Forecast Band -->
        <path d="${bandPath}" fill="url(#bandGrad)" />
        
        <!-- Forecast Median -->
        <path d="${medianPath}" fill="none" stroke="#00e5b4" stroke-width="2" stroke-dasharray="4 2" />
        
        <!-- Observed -->
        <path d="${obsPath}" fill="none" stroke="#fff" stroke-width="2" />

        <!-- Y Axis Labels -->
        <text x="${padding.left - 5}" y="${padding.top}" fill="#888" font-size="10" text-anchor="end" alignment-baseline="middle">${Math.round(yMax)}</text>
        <text x="${padding.left - 5}" y="${H - padding.bottom}" fill="#888" font-size="10" text-anchor="end" alignment-baseline="middle">0</text>
        
        <!-- X Axis Labels -->
        <text x="${scaleX(-72)}" y="${H - 5}" fill="#888" font-size="10" text-anchor="middle">-72h</text>
        <text x="${nowX}" y="${H - 5}" fill="#fff" font-size="10" text-anchor="middle">NOW</text>
        <text x="${scaleX(_activeHorizon)}" y="${H - 5}" fill="#888" font-size="10" text-anchor="middle">+${_activeHorizon}h</text>
      </svg>
    `;

    // Interactive tooltip (simple hover hit testing could be added here)
  }

  function _buildSkeleton() {
    return `
      <header class="dt-dock__header">
        <div class="dt-dock__title">
          <span>Simulation Horizon</span>
          <div id="dt-horizon-toggles" class="dt-horizon-toggles"></div>
        </div>
        <div class="dt-dock__controls">
          <button id="dt-step-minus" class="dt-icon-btn" title="Step Back">⏮</button>
          <button id="dt-step-plus" class="dt-icon-btn" title="Step Forward">⏭</button>
          <button id="dt-dock-toggle" class="dt-icon-btn" title="Toggle Dock">▾</button>
        </div>
      </header>
      <div class="dt-dock__body">
        <div class="dt-dock__hydrograph">
          <div id="dt-hydrograph-svg" class="dt-svg-container"></div>
          <div id="dt-hydro-tooltip" class="dt-tooltip" hidden></div>
        </div>
        <div class="dt-dock__asset-strip">
          <div class="dt-strip-line"></div>
          <div id="dt-asset-strip" class="dt-strip-nodes"></div>
        </div>
      </div>
    `;
  }

  // Initial render setup
  _renderHorizonToggles();

  return {
    el,
    show() { el.hidden = false; },
    hide() { el.hidden = true; },
  };
}
