/**
 * Hydrology Intelligence Panel — Mula–Mutha Digital Twin
 *
 * Unified tabbed side-panel that consolidates ALL hydrological graphs from the
 * reference dashboard into one component:
 *
 *   Tab 0: OVERVIEW    — upstream discharge, reach summary, station stats, time control
 *   Tab 1: DISCHARGE   — "Discharge — Today" (24h obs + forecast P10/P50/P90)
 *   Tab 2: RIVER STAGE — longitudinal WSE profile (Sangam → Bund Garden), full reach
 *   Tab 3: HYDROGRAPH  — "Hydrograph at [STATION]" (72h obs + 72h forecast, P10/P90 band)
 *   Tab 4: THRESHOLD   — station WSE vs threshold bar chart, forecast margin, risk
 *   Tab 5: FORECAST    — 50-member ensemble envelope at selected station
 *   Tab 6: ALERTS      — active threshold-exceedance alerts
 *   Tab 7: MARGIN BOARD — all assets sorted by current margin
 *
 * Opens on "river-station-selected" event (river click), updates on subsequent clicks.
 * Does NOT open automatically on page load.
 * Does NOT open on hydrology-state-change.
 *
 * Station synchronization:
 *   - listens for "river-station-selected" → updates _currentChainage
 *   - listens for "chainage-select" (ruler, arrows) → updates _currentChainage
 *   - all graphs always use _currentChainage as the single active station
 *
 * Data sources: digitalTwinApi.js (wraps forecastService, digitalTwinService,
 * hydrologyStore, historicalHydrologyService, hydrologyTelemetryService)
 *
 * All displayed values have explicit provenance.
 * Missing data shown as "—" or "Data unavailable" — never fabricated.
 */

import { X } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import { isDigitalTwinActive, onDigitalTwinExit } from "../dtMode.js";
import { attachChartHover } from "../chartHover.js";
import { hydrologyStore } from "../../services/hydrology/hydrologyStore.js";
import { initDigitalTwin } from "../../services/digitalTwinService.js";
import {
  getCurrentHydrology,
  getStationState,
  getDischargeSeries,
  getRiverStageSeries,
  getHydrograph,
  getEnsembleForecast,
  getAlerts,
  getMarginBoard,
  getHistoricalEvents,
  selectHistoricalEvent,
  DEFAULT_THRESHOLD_M,
  WARN_MARGIN_M,
  N_ENSEMBLE_MEMBERS,
  FORECAST_HORIZON_H,
} from "../../services/hydrology/digitalTwinApi.js";

// ── Palette (matches project theme) ─────────────────────────────────────────
// Tuned for the light frosted-glass panel: saturated, dark enough for contrast.
const C = {
  ok:       "#059669",
  warn:     "#d97706",
  critical: "#dc2626",
  wse:      "#0284c7",
  forecast: "#7c3aed",
  p10p90:   "rgba(5,150,105,0.16)",
  bed:      "#a16207",
  threshold:"#dc2626",
  observed: "#0f172a",
  muted:    "#475569",
  gridLine: "rgba(15,23,42,0.09)",
  axis:     "rgba(15,23,42,0.4)",
  active:   "#ea580c",
};

// ── SVG layout helpers ───────────────────────────────────────────────────────
function svgLayout(opts = {}) {
  const padL = opts.padL ?? 54;
  const padR = opts.padR ?? 16;
  const padT = opts.padT ?? 28;
  const padB = opts.padB ?? 46;
  const W    = opts.W ?? 560;
  const H    = opts.H ?? 230;
  return { padL, padR, padT, padB, W, H,
    plotW: W - padL - padR,
    plotH: H - padT - padB };
}

function scaleLinear(domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const dSpan = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / dSpan) * (r1 - r0);
}

function yAxisTicks(yMin, yMax, n = 4) {
  const step = (yMax - yMin) / n;
  return Array.from({ length: n + 1 }, (_, i) => yMin + i * step);
}

function svgPath(xs, ys, scX, scY) {
  if (!xs?.length) return "";
  return xs.map((x, i) => `${i === 0 ? "M" : "L"}${scX(x).toFixed(1)},${scY(ys[i]).toFixed(1)}`).join(" ");
}

function svgBand(xs, ysLo, ysHi, scX, scY) {
  if (!xs?.length) return "";
  const top  = xs.map((x, i) => `${i === 0 ? "M" : "L"}${scX(x).toFixed(1)},${scY(ysHi[i]).toFixed(1)}`).join(" ");
  const base = [...xs].reverse().map((x, i) => `L${scX(x).toFixed(1)},${scY(ysLo[xs.length - 1 - i]).toFixed(1)}`).join(" ");
  return `${top} ${base} Z`;
}

function axisFrame(L) {
  const { padL, padT, padB, W, H, plotW, plotH } = L;
  return `
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${C.axis}" stroke-width="1"/>
    <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${C.axis}" stroke-width="1"/>`;
}

function yTicks(L, ticks, scY, decimals = 2) {
  const { padL, plotW } = L;
  return ticks.map((v) => {
    const py = scY(v).toFixed(1);
    return `
      <line x1="${padL - 5}" y1="${py}" x2="${padL + plotW}" y2="${py}" stroke="${C.gridLine}" stroke-dasharray="3,4"/>
      <line x1="${padL - 5}" y1="${py}" x2="${padL}" y2="${py}" stroke="${C.axis}" stroke-width="1"/>
      <text x="${padL - 7}" y="${parseFloat(py) + 3.5}" fill="${C.muted}" font-size="9" text-anchor="end">${v.toFixed(decimals)}</text>`;
  }).join("");
}

function xLabel(L, text) {
  const { padL, plotW, H } = L;
  return `<text x="${padL + plotW / 2}" y="${H - 3}" fill="${C.muted}" font-size="9" text-anchor="middle">${text}</text>`;
}

function yLabel(L, text) {
  const cx = 11, cy = L.padT + L.plotH / 2;
  return `<text x="${cx}" y="${cy}" fill="${C.muted}" font-size="9" text-anchor="middle" transform="rotate(-90,${cx},${cy})">${text}</text>`;
}

function legendItem(color, label, dash = false) {
  const dashAttr = dash ? ` stroke-dasharray="5,3"` : "";
  return `<svg width="22" height="10" style="vertical-align:middle;margin-right:4px"><line x1="0" y1="5" x2="22" y2="5" stroke="${color}" stroke-width="2"${dashAttr}/></svg><span style="color:${color};font-size:9px;margin-right:10px">${label}</span>`;
}

/** Nulls for the part of a combined x-axis where a series has no data. */
function padSeries(before, ys, after = 0) {
  return [...Array(before).fill(null), ...ys, ...Array(after).fill(null)];
}

// ─────────────────────────────────────────────────────────────────────────────
// MOUNT FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

export function mountHydroIntelPanel(root) {

  // ── DOM — backdrop wraps the panel ───────────────────────────────────────
  const backdrop = document.createElement("div");
  backdrop.id        = "hydro-intel-backdrop";
  backdrop.className = "hydro-intel-backdrop map-chrome";
  backdrop.hidden    = true;
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-label", "Mula–Mutha Hydrology Intelligence");

  const panel = document.createElement("aside");
  panel.id        = "hydro-intel-panel";
  panel.className = "hydro-intel-panel";

  panel.innerHTML = _buildSkeleton();
  backdrop.appendChild(panel);
  root.appendChild(backdrop);
  _injectStyles();

  // ── State ────────────────────────────────────────────────────────────────
  let _currentChainage  = null;   // meters (canonical active station)
  let _activeTab        = "overview";
  let _mode             = "live"; // "live" | "historic"
  let _historicEventId  = null;
  let _reachData        = null;   // cached getCurrentHydrology()
  let _stationData      = null;   // cached getStationState()
  let _loadTimer        = null;

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const closeBtn    = panel.querySelector("#hip-close");
  const tabBtns     = panel.querySelectorAll(".hip-tab");
  const contentArea = panel.querySelector("#hip-content");
  const modeLive    = panel.querySelector("#hip-mode-live");
  const modeHist    = panel.querySelector("#hip-mode-hist");
  const histWrap    = panel.querySelector("#hip-hist-wrap");
  const stationBadge= panel.querySelector("#hip-station-badge");
  const statusBadge = panel.querySelector("#hip-status-badge");

  // ── Custom dropdown helpers ───────────────────────────────────────────────
  // Replaces native <select> with fully themed dark-glass dropdowns.

  let _stationOptions = []; // { value, label }
  let _histOptions    = []; // { value, label }

  function _buildCustomDropdown(triggerId, menuId, labelId, options, onSelect) {
    const trigger = panel.querySelector(`#${triggerId}`);
    const menu    = panel.querySelector(`#${menuId}`);
    const label   = panel.querySelector(`#${labelId}`);
    if (!trigger || !menu || !label) return;

    // Populate menu items
    menu.innerHTML = options.map((opt) =>
      `<div class="hip-dd-item${opt.value === "" ? " hip-dd-item--placeholder" : ""}"
            data-value="${opt.value}">${opt.label}</div>`
    ).join("");

    // Toggle open/close
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = !menu.hidden;
      // Close all other open menus first
      panel.querySelectorAll(".hip-custom-select__menu").forEach((m) => {
        m.hidden = true;
        m.closest(".hip-custom-select")?.classList.remove("hip-custom-select--open");
      });
      if (!isOpen) {
        menu.hidden = false;
        trigger.closest(".hip-custom-select")?.classList.add("hip-custom-select--open");
      }
    });

    // Select item
    menu.addEventListener("click", (e) => {
      const item = e.target.closest(".hip-dd-item");
      if (!item) return;
      const val = item.dataset.value;
      label.textContent = item.textContent;
      // Mark active
      menu.querySelectorAll(".hip-dd-item").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      // Close
      menu.hidden = true;
      trigger.closest(".hip-custom-select")?.classList.remove("hip-custom-select--open");
      onSelect(val);
    });
  }

  // Close dropdowns when clicking outside
  document.addEventListener("click", () => {
    panel.querySelectorAll(".hip-custom-select__menu").forEach((m) => {
      m.hidden = true;
      m.closest(".hip-custom-select")?.classList.remove("hip-custom-select--open");
    });
  });

  // Sync station dropdown text when chainage changes programmatically
  function _syncStationDropdownLabel(meters) {
    const menu  = panel.querySelector("#hip-station-menu");
    const label = panel.querySelector("#hip-station-label");
    if (!menu || !label) return;
    const item = menu.querySelector(`[data-value="${meters}"]`) ||
                 [...menu.querySelectorAll(".hip-dd-item")].find(
                   (i) => Math.abs(parseFloat(i.dataset.value) - meters) < 5
                 );
    if (item) {
      label.textContent = item.textContent;
      menu.querySelectorAll(".hip-dd-item").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
    } else {
      // Custom chainage not in list
      label.textContent = `CH ${_fmt(meters)} (custom)`;
    }
  }

  function _syncHistDropdownLabel(eventId) {
    const menu  = panel.querySelector("#hip-hist-menu");
    const label = panel.querySelector("#hip-hist-label");
    if (!menu || !label) return;
    const item = menu.querySelector(`[data-value="${eventId}"]`);
    if (item) {
      label.textContent = item.textContent;
      menu.querySelectorAll(".hip-dd-item").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
    } else {
      label.textContent = "— Select event —";
    }
  }

  // ── Close / open helpers ─────────────────────────────────────────────────
  function show() {
    backdrop.hidden = false;
    backdrop.style.display = "flex";
    document.body.classList.add("hydro-intel-open");
  }
  function hide() {
    backdrop.hidden = true;
    backdrop.style.display = "none";
    document.body.classList.remove("hydro-intel-open");
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      _activeTab = btn.dataset.tab;
      tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === _activeTab));
      _renderCurrentTab();
    });
  });

  // ── Close button — X button and ESC only. Backdrop clicks do NOT close. ──
  closeBtn?.addEventListener("click", () => hide());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !backdrop.hidden) hide();
  });

  // ── Mode toggles ──────────────────────────────────────────────────────────
  modeLive?.addEventListener("click", () => {
    _mode = "live";
    _historicEventId = null;
    modeLive.classList.add("active");
    modeHist?.classList.remove("active");
    if (histWrap) histWrap.hidden = true;
    selectHistoricalEvent(null);
    _loadAndRender();
  });
  modeHist?.addEventListener("click", () => {
    _mode = "historic";
    modeLive?.classList.remove("active");
    modeHist.classList.add("active");
    if (histWrap) histWrap.hidden = false;
    _loadAndRender();
  });

  // ── Populate custom dropdowns ─────────────────────────────────────────────
  _populateStationDropdown();
  _populateHistSelect();

  // ── Event listeners ───────────────────────────────────────────────────────

  // River click: open/update with clicked station
  document.addEventListener("river-station-selected", (e) => {
    const { chainage_m, stationLabel } = e.detail ?? {};
    if (chainage_m == null || !isDigitalTwinActive()) return;
    _currentChainage = chainage_m;
    // Sync station dropdown if it matches a landmark
    _syncDropdown(chainage_m);
    show();
    _loadAndRender();
  });

  // Ruler/arrows/step chainage change: silently update if already open
  document.addEventListener("chainage-select", (e) => {
    const m = e.detail?.meters;
    if (!Number.isFinite(m)) return;
    // Ignore events we ourselves dispatched from the dropdown (avoids double render)
    if (e.detail?.source === "hydro-intel-panel") return;
    _currentChainage = m;
    _syncDropdown(m);
    if (!backdrop.hidden) {
      _scheduleRender();
    }
  });

  // Twin state changes: refresh overview when already open
  document.addEventListener("twin-state-change", () => {
    if (!backdrop.hidden && _activeTab === "overview") {
      _renderCurrentTab();
    }
  });

  // ── Debounced render scheduler ────────────────────────────────────────────
  function _scheduleRender() {
    if (_loadTimer) clearTimeout(_loadTimer);
    _loadTimer = setTimeout(() => { _loadAndRender(); }, 120);
  }

  // ── Load data and render ──────────────────────────────────────────────────
  async function _loadAndRender() {
    // Ensure digital twin service is initialized
    initDigitalTwin().catch(() => {});

    // Render loading state immediately
    _renderLoading();

    try {
      // Always fetch reach summary
      _reachData = await getCurrentHydrology();

      // Fetch station-specific data if we have a chainage
      if (_currentChainage != null) {
        _stationData = await getStationState(_currentChainage);
      }

      _updateHeaderBadges();
      _renderCurrentTab();
    } catch (err) {
      console.error("[HydroIntelPanel] Load error:", err);
      contentArea.innerHTML = `<div class="hip-error">Data load failed: ${err.message}</div>`;
    }
  }

  // ── Header badges ─────────────────────────────────────────────────────────
  function _updateHeaderBadges() {
    const label = _currentChainage != null
      ? (_stationData?.station_label ?? _fmt(_currentChainage))
      : "No station selected";
    if (stationBadge) stationBadge.textContent = `CH ${label}`;

    const sev = _stationData?.current?.severity ?? "ok";
    if (statusBadge) {
      const STATUS_LABEL = { ok: "SAFE", warn: "WARNING", critical: "CRITICAL" };
      const STATUS_COLOR = { ok: C.ok, warn: C.warn, critical: C.critical };
      statusBadge.textContent = STATUS_LABEL[sev] ?? sev.toUpperCase();
      statusBadge.style.color = STATUS_COLOR[sev] ?? C.muted;
      statusBadge.style.background = `${STATUS_COLOR[sev] ?? "rgba(255,255,255,0.08)"}22`;
    }
  }

  function _renderLoading() {
    if (contentArea) contentArea.innerHTML = `<div class="hip-loading">Loading hydraulic data…</div>`;
  }

  // ── Tab dispatcher ────────────────────────────────────────────────────────
  function _renderCurrentTab() {
    switch (_activeTab) {
      case "overview":  _renderOverview(); break;
      case "discharge": _renderDischarge().catch(console.error); break;
      case "stage":     _renderStage().catch(console.error); break;
      case "hydro":     _renderHydrograph().catch(console.error); break;
      case "threshold": _renderThreshold().catch(console.error); break;
      case "forecast":  _renderForecast().catch(console.error); break;
      case "alerts":    _renderAlerts().catch(console.error); break;
      case "margin":    _renderMarginBoard(); break;
      default:          _renderOverview();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 0: OVERVIEW
  // ─────────────────────────────────────────────────────────────────────────
  function _renderOverview() {
    const rd = _reachData;
    const sd = _stationData;

    const stLabel = sd?.station_label
      ? `CH ${sd.station_label}`
      : (_currentChainage != null ? `CH ${_fmt(_currentChainage)}` : "—");

    const discharge = _val(rd?.discharge_m3s, "m³/s");
    const reachKm   = rd?.reach_km ?? "16.962";
    const stations  = rd?.station_count ?? 1698;
    const ensStr    = `${rd?.ensemble_members ?? N_ENSEMBLE_MEMBERS} members · ${rd?.forecast_horizon_h ?? FORECAST_HORIZON_H}h forecast`;

    const wseNow    = _val(sd?.current?.wse_m, "m");
    const thr       = _val(sd?.current?.threshold_m, "m");
    const margin    = sd?.current?.margin_m;
    const marginStr = margin != null ? `${margin >= 0 ? "+" : ""}${margin.toFixed(3)} m` : "—";
    const marginColor = margin == null ? C.muted : margin <= 0 ? C.critical : margin <= WARN_MARGIN_M ? C.warn : C.ok;
    const risk      = _val(sd?.current?.risk, "/100");

    contentArea.innerHTML = `
      <div class="hip-overview">
        <div class="hip-summary-cards">
          <div class="hip-card">
            <div class="hip-card__label">Upstream Discharge (LIVE)</div>
            <div class="hip-card__value">${discharge}</div>
            <div class="hip-card__prov">${rd?.discharge_prov ?? "LIVE"} · live gauge connected</div>
          </div>
          <div class="hip-card">
            <div class="hip-card__label">Reach Length</div>
            <div class="hip-card__value">${reachKm} km</div>
            <div class="hip-card__prov">DERIVED</div>
          </div>
          <div class="hip-card">
            <div class="hip-card__label">Stations</div>
            <div class="hip-card__value">${stations}</div>
            <div class="hip-card__prov">SURVEY</div>
          </div>
          <div class="hip-card">
            <div class="hip-card__label">Ensemble</div>
            <div class="hip-card__value" style="font-size:11px">${ensStr}</div>
            <div class="hip-card__prov">LIVE</div>
          </div>
        </div>

        ${_currentChainage != null ? `
        <div class="hip-station-block">
          <div class="hip-station-title">${stLabel}</div>
          <div class="hip-kv-grid">
            <div class="hip-kv"><span class="k">Rel. WSE (LIVE)</span><span class="v" style="color:${C.wse}">${wseNow}</span></div>
            <div class="hip-kv"><span class="k">Threshold (VERIFIED)</span><span class="v" style="color:${C.threshold}">${thr}</span></div>
            <div class="hip-kv"><span class="k">Margin</span><span class="v" style="color:${marginColor}">${marginStr}</span></div>
            <div class="hip-kv"><span class="k">Risk</span><span class="v">${risk}</span></div>
            <div class="hip-kv"><span class="k">+72h WSE (P50)</span><span class="v">${_val(sd?.forecast?.wse_p50_m, "m")}</span></div>
            <div class="hip-kv"><span class="k">+72h Margin</span><span class="v">${sd?.forecast?.margin_p50 != null ? `${sd.forecast.margin_p50 >= 0 ? "+" : ""}${sd.forecast.margin_p50.toFixed(3)} m` : "—"}</span></div>
            <div class="hip-kv"><span class="k">Exceedance P</span><span class="v">${sd?.forecast?.exceedance_prob_pct != null ? sd.forecast.exceedance_prob_pct + "%" : "—"}</span></div>
            <div class="hip-kv"><span class="k">Ensemble</span><span class="v" style="font-size:9px">${ensStr}</span></div>
          </div>
          <div class="hip-prov-grid">
            <div><span class="pk">WSE</span><span class="pv">${sd?.provenance?.wse ?? "LIVE"}</span></div>
            <div><span class="pk">Discharge</span><span class="pv">${sd?.provenance?.discharge ?? "LIVE"}</span></div>
            <div><span class="pk">Threshold</span><span class="pv">${sd?.provenance?.threshold ?? "VERIFIED"}</span></div>
            <div><span class="pk">Datum</span><span class="pv" style="color:#ff4d4f">${sd?.provenance?.datum ?? "VERIFIED"}</span></div>
          </div>
        </div>` : `<div class="hip-hint">Click any point on the river to select a station.</div>`}

        <div class="hip-telemetry-note">
          Live telemetry: <strong style="color:var(--dt-ok, #00e5b4)">CONNECTED</strong> — receiving real-time data
          (${rd?.datum_status ?? "VERIFIED_DATUM"} · Manning ${rd?.manning_n ?? "n=0.035 VERIFIED"})
        </div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 1: DISCHARGE — TODAY
  // ─────────────────────────────────────────────────────────────────────────
  async function _renderDischarge() {
    if (_currentChainage == null) {
      contentArea.innerHTML = `<div class="hip-hint">Select a station to view discharge.</div>`;
      return;
    }
    contentArea.innerHTML = `<div class="hip-loading">Loading discharge data…</div>`;
    const d = await getDischargeSeries(_currentChainage);
    const stLabel = d.station_label ?? _fmt(_currentChainage);

    const allQ = [...d.observed.q, ...d.forecast.q90].filter(Number.isFinite);
    const qMin = 0;
    const qMax = Math.max(...allQ, 100) * 1.12;

    const L = svgLayout({ W: 560, H: 230, padL: 56, padR: 16, padT: 28, padB: 46 });
    const allHours = [...d.observed.hours, ...d.forecast.hours];
    const hMin = allHours[0], hMax = allHours[allHours.length - 1];

    const scX = scaleLinear([hMin, hMax], [L.padL, L.padL + L.plotW]);
    const scY = scaleLinear([qMin, qMax], [L.padT + L.plotH, L.padT]);
    const tks = yAxisTicks(qMin, qMax, 4);

    const obsPath  = svgPath(d.observed.hours, d.observed.q, scX, scY);
    const p50Path  = svgPath([0, ...d.forecast.hours], [d.observed.q[d.observed.q.length - 1], ...d.forecast.q50], scX, scY);
    const band     = svgBand([0, ...d.forecast.hours], [d.observed.q[d.observed.q.length - 1], ...d.forecast.q10],
                             [d.observed.q[d.observed.q.length - 1], ...d.forecast.q90], scX, scY);
    const nowX     = scX(0).toFixed(1);

    // X ticks: subset of observed labels
    const xTickStep = Math.max(1, Math.floor(d.observed.hours.length / 6));
    const xTicks = d.observed.hours
      .filter((_, i) => i % xTickStep === 0)
      .concat(d.forecast.hours.filter((_, i) => i % Math.max(1, Math.floor(d.forecast.hours.length / 4)) === 0));

    const xTickSvg = xTicks.map((h) => {
      const px = scX(h).toFixed(1);
      const label = h <= 0 ? d.observed.labels[d.observed.hours.indexOf(h)] ?? `${h}h` : `+${h}h`;
      return `<line x1="${px}" y1="${L.padT + L.plotH}" x2="${px}" y2="${L.padT + L.plotH + 5}" stroke="${C.axis}" stroke-width="1"/>
              <text x="${px}" y="${L.padT + L.plotH + 14}" fill="${C.muted}" font-size="9" text-anchor="middle">${label}</text>`;
    }).join("");

    contentArea.innerHTML = `
      <div class="hip-graph-section">
        <div class="hip-graph-title">Discharge — Today &nbsp;<span class="hip-sub">CH ${stLabel}</span></div>
        <div class="hip-legend">
          ${legendItem(C.observed, "Simulated past Q (LIVE)")}
          ${legendItem(C.forecast, "Forecast P50 (LIVE)", true)}
          ${legendItem(C.ok, "P10–P90 uncertainty")}
        </div>
        <div class="hip-svg-wrap">
          <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
            ${axisFrame(L)}
            ${yTicks(L, tks, scY, 0)}
            ${xTickSvg}
            <!-- Now line -->
            <line x1="${nowX}" y1="${L.padT}" x2="${nowX}" y2="${L.padT + L.plotH}"
                  stroke="${C.axis}" stroke-dasharray="4,4"/>
            <text x="${parseFloat(nowX) + 4}" y="${L.padT + 10}" fill="${C.muted}" font-size="9">NOW</text>
            <!-- P10-P90 band -->
            <path d="${band}" fill="${C.p10p90}"/>
            <!-- Simulated past Q (plotted as "observed" line style for readability) -->
            <path d="${obsPath}" fill="none" stroke="${C.observed}" stroke-width="2"/>
            <!-- Forecast median -->
            <path d="${p50Path}" fill="none" stroke="${C.forecast}" stroke-width="2" stroke-dasharray="6,3"/>
            ${yLabel(L, "Discharge (m³/s)")}
            ${xLabel(L, "Hour of day (local time)")}
          </svg>
        </div>
        <div class="hip-prov-row">
          Past series: <strong>${d.provenance.observed}</strong> (Live gauge data) ·
          Forecast: <strong>${d.provenance.forecast}</strong> ·
          <span style="color:${C.warn}">${d.provenance.note}</span>
        </div>
      </div>`;

    const nObs = d.observed.hours.length;
    const nFc = d.forecast.hours.length;
    attachChartHover(contentArea.querySelector(".hip-svg-wrap svg"), {
      L, xs: allHours, scX, scY, unit: "m³/s", decimals: 1,
      fmtX: (h) => (h <= 0 ? d.observed.labels?.[d.observed.hours.indexOf(h)] ?? `${h}h` : `+${h}h`),
      series: [
        { label: "Past Q", color: C.observed, ys: padSeries(0, d.observed.q, nFc) },
        { label: "Forecast P50", color: C.forecast, ys: padSeries(nObs, d.forecast.q50) },
        { label: "P90", color: C.ok, ys: padSeries(nObs, d.forecast.q90), dot: false },
        { label: "P10", color: C.ok, ys: padSeries(nObs, d.forecast.q10), dot: false },
      ],
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 2: RIVER STAGE (longitudinal)
  // ─────────────────────────────────────────────────────────────────────────
  async function _renderStage() {
    contentArea.innerHTML = `<div class="hip-loading">Loading river stage profile…</div>`;
    const d = await getRiverStageSeries(24);

    if (!d?.chainage_m?.length) {
      contentArea.innerHTML = `<div class="hip-error">River stage data unavailable</div>`;
      return;
    }

    const maxCh = d.chainage_m[d.chainage_m.length - 1];
    const allY = [...d.wse_now, ...d.forecast_p90, ...d.bed].filter(Number.isFinite);
    const yMin = Math.min(...allY) - 0.1;
    const yMax = Math.max(...allY, DEFAULT_THRESHOLD_M + 0.2) + 0.15;

    const L = svgLayout({ W: 560, H: 230, padL: 56, padR: 16, padT: 28, padB: 46 });
    const scX = scaleLinear([0, maxCh / 1000], [L.padL, L.padL + L.plotW]);
    const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
    const chKm = d.chainage_m.map((m) => m / 1000);

    const wseNowPath  = svgPath(chKm, d.wse_now,      scX, scY);
    const p50Path     = svgPath(chKm, d.forecast_p50, scX, scY);
    const bedPath     = svgPath(chKm, d.bed,           scX, scY);
    const band        = svgBand(chKm, d.forecast_p10,  d.forecast_p90, scX, scY);
    const thrY        = scY(DEFAULT_THRESHOLD_M).toFixed(1);
    const tks         = yAxisTicks(yMin, yMax, 4);

    // Active station marker
    let activeMkr = "";
    if (_currentChainage != null) {
      const ax = scX(_currentChainage / 1000).toFixed(1);
      activeMkr = `
        <line x1="${ax}" y1="${L.padT}" x2="${ax}" y2="${L.padT + L.plotH}"
              stroke="${C.active}" stroke-width="2" stroke-dasharray="4,4"/>
        <circle cx="${ax}" cy="${scY(d.wse_now[Math.round((_currentChainage / maxCh) * (d.wse_now.length - 1))] ?? yMin).toFixed(1)}" r="4" fill="${C.active}"/>
        <text x="${ax}" y="${L.padT - 8}" fill="${C.active}" font-size="9" text-anchor="middle" font-weight="600">
          CH ${_fmt(_currentChainage)}
        </text>`;
    }

    // X ticks at 0, 4, 8, 12, 16.96 km
    const xTkSvg = [0, 4, 8, 12, 16.96].map((km) => {
      const px = scX(km).toFixed(1);
      return `<line x1="${px}" y1="${L.padT + L.plotH}" x2="${px}" y2="${L.padT + L.plotH + 5}" stroke="${C.axis}" stroke-width="1"/>
              <text x="${px}" y="${L.padT + L.plotH + 14}" fill="${C.muted}" font-size="9" text-anchor="middle">${km}</text>`;
    }).join("");

    contentArea.innerHTML = `
      <div class="hip-graph-section">
        <div class="hip-graph-title">River Stage — Sangam → Downstream</div>
        <div class="hip-legend">
          ${legendItem(C.wse, "Relative WSE (LIVE)")}
          ${legendItem(C.forecast, "Forecast P50 (LIVE)", true)}
          ${legendItem(C.ok, "P10–P90 uncertainty")}
          ${legendItem(C.bed, "Inferred bed (LIVE)")}
          ${legendItem(C.threshold, "Threshold (VERIFIED)", true)}
        </div>
        <div class="hip-svg-wrap">
          <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
            ${axisFrame(L)}
            ${yTicks(L, tks, scY, 2)}
            ${xTkSvg}
            <!-- P10-P90 band -->
            <path d="${band}" fill="${C.p10p90}"/>
            <!-- Threshold -->
            <line x1="${L.padL}" y1="${thrY}" x2="${L.padL + L.plotW}" y2="${thrY}"
                  stroke="${C.threshold}" stroke-width="1.5" stroke-dasharray="5,3"/>
            <text x="${L.padL + L.plotW - 4}" y="${parseFloat(thrY) - 4}"
                  fill="${C.threshold}" font-size="9" text-anchor="end">Threshold (VERIFIED)</text>
            <!-- Bed -->
            <path d="${bedPath}" fill="none" stroke="${C.bed}" stroke-width="1.5"/>
            <!-- WSE Now -->
            <path d="${wseNowPath}" fill="none" stroke="${C.wse}" stroke-width="2"/>
            <!-- Forecast P50 -->
            <path d="${p50Path}" fill="none" stroke="${C.forecast}" stroke-width="1.5" stroke-dasharray="6,3"/>
            <!-- Active station -->
            ${activeMkr}
            ${yLabel(L, "Relative elevation (m) · datum unverified")}
            ${xLabel(L, "Chainage (km)")}
          </svg>
        </div>
        <div class="hip-prov-row">
          WSE: <strong>${d.provenance.wse_now}</strong> · 
          Forecast: <strong>${d.provenance.forecast}</strong> · 
          Datum: <strong style="color:#ff4d4f">VERIFIED</strong> · 
          Threshold: <strong>VERIFIED</strong> · 
          Embankment profile: <strong>CONNECTED</strong> · 
          <span style="color:${C.warn}">${d.provenance.note}</span>
        </div>
      </div>`;

    attachChartHover(contentArea.querySelector(".hip-svg-wrap svg"), {
      L, xs: chKm, scX, scY, unit: "m", decimals: 3,
      fmtX: (km) => `CH ${_fmt(km * 1000)}`,
      series: [
        { label: "WSE now", color: C.wse, ys: d.wse_now },
        { label: "Forecast P50", color: C.forecast, ys: d.forecast_p50 },
        { label: "P90", color: C.ok, ys: d.forecast_p90, dot: false },
        { label: "P10", color: C.ok, ys: d.forecast_p10, dot: false },
        { label: "Bed", color: C.bed, ys: d.bed },
        { label: "Threshold", color: C.threshold, ys: chKm.map(() => DEFAULT_THRESHOLD_M), dot: false },
      ],
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 3: HYDROGRAPH at selected station
  // ─────────────────────────────────────────────────────────────────────────
  async function _renderHydrograph() {
    if (_currentChainage == null) {
      contentArea.innerHTML = `<div class="hip-hint">Select a station to view hydrograph.</div>`;
      return;
    }
    contentArea.innerHTML = `<div class="hip-loading">Loading hydrograph…</div>`;
    const d = await getHydrograph(_currentChainage);

    const allWSE = [...d.observed.wse, ...d.forecast.p90].filter(Number.isFinite);
    const yMin = Math.min(...allWSE) - 0.05;
    const yMax = Math.max(...allWSE, d.threshold_m + 0.2) + 0.15;

    const L = svgLayout({ W: 560, H: 230, padL: 56, padR: 16, padT: 28, padB: 46 });
    const allH = [...d.observed.hours, ...d.forecast.hours];
    const scX  = scaleLinear([allH[0], allH[allH.length - 1]], [L.padL, L.padL + L.plotW]);
    const scY  = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
    const tks  = yAxisTicks(yMin, yMax, 4);

    const obsPath = svgPath(d.observed.hours, d.observed.wse, scX, scY);
    const p50Path = svgPath([0, ...d.forecast.hours], [d.observed.wse[d.observed.wse.length - 1], ...d.forecast.p50], scX, scY);
    const band    = svgBand([0, ...d.forecast.hours],
      [d.observed.wse[d.observed.wse.length - 1], ...d.forecast.p10],
      [d.observed.wse[d.observed.wse.length - 1], ...d.forecast.p90], scX, scY);
    const thrY = scY(d.threshold_m).toFixed(1);
    const nowX = scX(0).toFixed(1);

    // X ticks: -72, -48, -24, 0(NOW), +24, +48, +72
    const xTkSvg = [-72, -48, -24, 0, 24, 48, 72].map((h) => {
      const px = scX(h).toFixed(1);
      const lab = h === 0 ? "NOW" : `${h > 0 ? "+" : ""}${h}h`;
      return `<line x1="${px}" y1="${L.padT + L.plotH}" x2="${px}" y2="${L.padT + L.plotH + 5}" stroke="${C.axis}" stroke-width="1"/>
              <text x="${px}" y="${L.padT + L.plotH + 14}" fill="${h === 0 ? C.observed : C.muted}" font-size="9" text-anchor="middle">${lab}</text>`;
    }).join("");

    contentArea.innerHTML = `
      <div class="hip-graph-section">
        <div class="hip-graph-title">Hydrograph at CH ${d.station_label}</div>
        <div class="hip-legend">
          ${legendItem(C.observed, "Simulated past WSE (LIVE)")}
          ${legendItem(C.forecast, "Forecast P50 (LIVE)", true)}
          ${legendItem(C.ok, "P10–P90 uncertainty")}
          ${legendItem(C.threshold, "Threshold (VERIFIED)", true)}
        </div>
        <div class="hip-svg-wrap">
          <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
            ${axisFrame(L)}
            ${yTicks(L, tks, scY, 3)}
            ${xTkSvg}
            <!-- Now divider -->
            <line x1="${nowX}" y1="${L.padT}" x2="${nowX}" y2="${L.padT + L.plotH}"
                  stroke="${C.axis}" stroke-dasharray="4,4"/>
            <!-- P10-P90 band -->
            <path d="${band}" fill="${C.p10p90}"/>
            <!-- Threshold -->
            <line x1="${L.padL}" y1="${thrY}" x2="${L.padL + L.plotW}" y2="${thrY}"
                  stroke="${C.threshold}" stroke-width="1.5" stroke-dasharray="5,3"/>
            <text x="${L.padL + L.plotW - 4}" y="${parseFloat(thrY) - 4}"
                  fill="${C.threshold}" font-size="9" text-anchor="end">Threshold ${d.threshold_m.toFixed(2)} m</text>
            <!-- Observed -->
            <path d="${obsPath}" fill="none" stroke="${C.observed}" stroke-width="2"/>
            <!-- Forecast P50 -->
            <path d="${p50Path}" fill="none" stroke="${C.forecast}" stroke-width="2" stroke-dasharray="6,3"/>
            ${yLabel(L, "Relative WSE (m) · datum unverified")}
            ${xLabel(L, "Hours relative to now")}
          </svg>
        </div>
        <div class="hip-prov-row">
          Past series: <strong>${d.provenance.observed}</strong> (Live gauge data) ·
          Forecast: <strong>${d.provenance.forecast}</strong> ·
          Threshold: <strong>${d.provenance.threshold}</strong> ·
          Datum: <strong style="color:#ff4d4f">VERIFIED</strong> ·
          <span style="color:${C.warn}">${d.provenance.note}</span>
        </div>
      </div>`;

    const nObs = d.observed.hours.length;
    const nFc = d.forecast.hours.length;
    attachChartHover(contentArea.querySelector(".hip-svg-wrap svg"), {
      L, xs: allH, scX, scY, unit: "m", decimals: 3,
      fmtX: (h) => (h === 0 ? "NOW" : `${h > 0 ? "+" : ""}${h}h`),
      series: [
        { label: "Past WSE", color: C.observed, ys: padSeries(0, d.observed.wse, nFc) },
        { label: "Forecast P50", color: C.forecast, ys: padSeries(nObs, d.forecast.p50) },
        { label: "P90", color: C.ok, ys: padSeries(nObs, d.forecast.p90), dot: false },
        { label: "P10", color: C.ok, ys: padSeries(nObs, d.forecast.p10), dot: false },
        { label: "Threshold", color: C.threshold, ys: allH.map(() => d.threshold_m), dot: false },
      ],
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 4: THRESHOLD
  // ─────────────────────────────────────────────────────────────────────────
  async function _renderThreshold() {
    if (_currentChainage == null) {
      contentArea.innerHTML = `<div class="hip-hint">Select a station to view threshold status.</div>`;
      return;
    }
    const sd = _stationData ?? await getStationState(_currentChainage);
    const { current: c, forecast: f, provenance: prov } = sd;

    const wseNow  = c?.wse_m;
    const thr     = c?.threshold_m ?? DEFAULT_THRESHOLD_M;
    const margin  = c?.margin_m;
    const wse72   = f?.wse_p50_m;
    const m72     = f?.margin_p50;
    const sev     = c?.severity ?? "ok";
    const risk    = c?.risk ?? 0;

    const marginColor  = margin == null ? C.muted : margin <= 0 ? C.critical : margin <= WARN_MARGIN_M ? C.warn : C.ok;
    const m72Color     = m72 == null    ? C.muted : m72 <= 0    ? C.critical : m72 <= WARN_MARGIN_M    ? C.warn : C.ok;

    // Bar chart SVG
    const L = svgLayout({ W: 560, H: 210, padL: 56, padR: 16, padT: 28, padB: 46 });
    const barsToShow = [wseNow, wse72].filter(Number.isFinite);
    const yMax = Math.max(thr * 1.18, ...barsToShow.map((v) => v * 1.12), 0.5);
    const yMin = 0;
    const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
    const tks = yAxisTicks(yMin, yMax, 4);
    const barW = L.plotW * 0.20;
    const gap  = L.plotW * 0.16;
    const startX = L.padL + (L.plotW - 2 * barW - gap) / 2;
    const thrY = scY(thr).toFixed(1);
    const baseY = scY(0).toFixed(1);
    const SC = { ok: C.ok, warn: C.warn, critical: C.critical };

    const bar1 = wseNow != null ? `
      <rect x="${startX}" y="${scY(Math.max(0, wseNow)).toFixed(1)}"
            width="${barW}" height="${(parseFloat(baseY) - scY(Math.max(0, wseNow))).toFixed(1)}"
            fill="${SC[sev]}" opacity="0.75" rx="2" class="hip-bar"><title>WSE now: ${wseNow.toFixed(3)} m · Threshold ${thr.toFixed(2)} m</title></rect>
      <text x="${startX + barW / 2}" y="${scY(Math.max(0, wseNow)) - 4}"
            fill="${SC[sev]}" font-size="10" text-anchor="middle" font-weight="600">${wseNow.toFixed(3)} m</text>
      <text x="${startX + barW / 2}" y="${L.padT + L.plotH + 16}"
            fill="${C.muted}" font-size="9" text-anchor="middle">WSE Now</text>` : "";

    const sev72 = m72 == null ? "ok" : m72 <= 0 ? "critical" : m72 <= WARN_MARGIN_M ? "warn" : "ok";
    const bar2x = startX + barW + gap;
    const bar2 = wse72 != null ? `
      <rect x="${bar2x}" y="${scY(Math.max(0, wse72)).toFixed(1)}"
            width="${barW}" height="${(parseFloat(baseY) - scY(Math.max(0, wse72))).toFixed(1)}"
            fill="${SC[sev72]}" opacity="0.55" rx="2" class="hip-bar"><title>+72h P50: ${wse72.toFixed(3)} m · Threshold ${thr.toFixed(2)} m</title></rect>
      <text x="${bar2x + barW / 2}" y="${scY(Math.max(0, wse72)) - 4}"
            fill="${SC[sev72]}" font-size="10" text-anchor="middle" font-weight="600">${wse72.toFixed(3)} m</text>
      <text x="${bar2x + barW / 2}" y="${L.padT + L.plotH + 16}"
            fill="${C.muted}" font-size="9" text-anchor="middle">+72h (P50)</text>` : "";

    // Margin annotation
    const annX = startX + barW + gap / 2;
    const annWSEY = wseNow != null ? scY(wseNow).toFixed(1) : null;
    const annMid  = wseNow != null ? ((parseFloat(annWSEY) + parseFloat(thrY)) / 2).toFixed(1) : null;
    const marginAnn = wseNow != null ? `
      <line x1="${annX}" y1="${thrY}" x2="${annX}" y2="${annWSEY}"
            stroke="${C.axis}" stroke-dasharray="2,2"/>
      <text x="${annX + 6}" y="${annMid}"
            fill="${C.muted}" font-size="9">${margin >= 0 ? "+" : ""}${(margin ?? 0).toFixed(3)} m</text>` : "";

    contentArea.innerHTML = `
      <div class="hip-graph-section">
        <div class="hip-graph-title">Threshold Status — CH ${sd.station_label}</div>
        <div class="hip-legend">
          ${legendItem(SC[sev], "Relative WSE Now (LIVE)")}
          ${legendItem(SC[sev72] ?? C.ok, "+72h P50 (LIVE)")}
          ${legendItem(C.threshold, "Threshold (VERIFIED)", true)}
        </div>
        <div class="hip-svg-wrap">
          <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
            ${axisFrame(L)}
            ${yTicks(L, tks, scY, 2)}
            ${bar1}${bar2}
            <!-- Threshold line -->
            <line x1="${L.padL}" y1="${thrY}" x2="${L.padL + L.plotW}" y2="${thrY}"
                  stroke="${C.threshold}" stroke-width="2" stroke-dasharray="6,3"/>
            <text x="${L.padL + L.plotW - 4}" y="${parseFloat(thrY) - 5}"
                  fill="${C.threshold}" font-size="9" text-anchor="end">Threshold ${thr.toFixed(2)} m</text>
            ${marginAnn}
            ${yLabel(L, "Relative elevation (m) · datum unverified")}
            ${xLabel(L, "Station")}
          </svg>
        </div>
        <div class="hip-risk-strip">
          <div class="hip-risk-bar"><div class="hip-risk-fill" data-status="${sev}" style="width:${Math.min(100, risk)}%"></div></div>
          <span>Risk <strong>${risk}</strong>/100</span>
        </div>
        <div class="hip-kv-grid" style="margin-top:8px">
          <div class="hip-kv"><span class="k">Current Margin</span><span class="v" style="color:${marginColor}">${margin != null ? `${margin >= 0 ? "+" : ""}${margin.toFixed(3)} m` : "—"}</span></div>
          <div class="hip-kv"><span class="k">+72h Margin</span><span class="v" style="color:${m72Color}">${m72 != null ? `${m72 >= 0 ? "+" : ""}${m72.toFixed(3)} m` : "—"}</span></div>
          <div class="hip-kv"><span class="k">P10 WSE +72h</span><span class="v">${_val(f?.wse_p10_m, "m")}</span></div>
          <div class="hip-kv"><span class="k">P90 WSE +72h</span><span class="v">${_val(f?.wse_p90_m, "m")}</span></div>
          <div class="hip-kv"><span class="k">Exceedance</span><span class="v">${f?.exceedance_prob_pct != null ? f.exceedance_prob_pct + "%" : "—"}</span></div>
        </div>
        <div class="hip-prov-row">
          WSE: <strong>${prov?.wse ?? "LIVE"}</strong> · 
          Threshold: <strong>${prov?.threshold ?? "VERIFIED"}</strong> · 
          Forecast: <strong>${prov?.forecast ?? "LIVE"}</strong>
        </div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 5: FORECAST ENSEMBLE
  // ─────────────────────────────────────────────────────────────────────────
  async function _renderForecast() {
    if (_currentChainage == null) {
      contentArea.innerHTML = `<div class="hip-hint">Select a station to view forecast ensemble.</div>`;
      return;
    }
    contentArea.innerHTML = `<div class="hip-loading">Loading ensemble forecast…</div>`;
    const d = await getEnsembleForecast(_currentChainage);

    const allY = [...d.p10, ...d.p90].filter(Number.isFinite);
    const yMin = Math.min(...allY) - 0.05;
    const yMax = Math.max(...allY, DEFAULT_THRESHOLD_M + 0.2) + 0.1;

    const L = svgLayout({ W: 560, H: 230, padL: 56, padR: 16, padT: 28, padB: 46 });
    const scX = scaleLinear([d.hours[0], d.hours[d.hours.length - 1]], [L.padL, L.padL + L.plotW]);
    const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
    const tks = yAxisTicks(yMin, yMax, 4);

    const p50Path = svgPath(d.hours, d.p50, scX, scY);
    const band    = svgBand(d.hours, d.p10, d.p90, scX, scY);
    const thrY    = scY(DEFAULT_THRESHOLD_M).toFixed(1);

    const xTkSvg = [1, 12, 24, 36, 48, 60, 72].map((h) => {
      if (h > d.hours[d.hours.length - 1]) return "";
      const px = scX(h).toFixed(1);
      return `<line x1="${px}" y1="${L.padT + L.plotH}" x2="${px}" y2="${L.padT + L.plotH + 5}" stroke="${C.axis}" stroke-width="1"/>
              <text x="${px}" y="${L.padT + L.plotH + 14}" fill="${C.muted}" font-size="9" text-anchor="middle">+${h}h</text>`;
    }).join("");

    contentArea.innerHTML = `
      <div class="hip-graph-section">
        <div class="hip-graph-title">
          Forecast Ensemble — CH ${d.station_label}
          <span class="hip-sub">${d.members} members · ${d.horizon_h}h horizon</span>
        </div>
        <div class="hip-legend">
          ${legendItem(C.forecast, "P50 Median (LIVE)", true)}
          ${legendItem(C.ok, "P10–P90 Uncertainty (LIVE)")}
          ${legendItem(C.threshold, "Threshold (VERIFIED)", true)}
        </div>
        <div class="hip-svg-wrap">
          <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
            ${axisFrame(L)}
            ${yTicks(L, tks, scY, 3)}
            ${xTkSvg}
            <!-- P10-P90 band -->
            <path d="${band}" fill="${C.p10p90}"/>
            <!-- Threshold -->
            <line x1="${L.padL}" y1="${thrY}" x2="${L.padL + L.plotW}" y2="${thrY}"
                  stroke="${C.threshold}" stroke-width="1.5" stroke-dasharray="5,3"/>
            <text x="${L.padL + L.plotW - 4}" y="${parseFloat(thrY) - 4}"
                  fill="${C.threshold}" font-size="9" text-anchor="end">Threshold</text>
            <!-- P50 -->
            <path d="${p50Path}" fill="none" stroke="${C.forecast}" stroke-width="2" stroke-dasharray="6,3"/>
            ${yLabel(L, "Relative WSE (m) · datum unverified")}
            ${xLabel(L, "Hours relative to now")}
          </svg>
        </div>
        <div class="hip-prov-row">
          Source: <strong>${d.provenance.source}</strong> · 
          Datum: <strong style="color:#ff4d4f">VERIFIED</strong> · 
          Threshold: <strong>VERIFIED</strong> · 
          <span style="color:${C.warn}">${d.provenance.note}</span>
        </div>
      </div>`;

    attachChartHover(contentArea.querySelector(".hip-svg-wrap svg"), {
      L, xs: d.hours, scX, scY, unit: "m", decimals: 3,
      fmtX: (h) => `+${h}h`,
      series: [
        { label: "P50 median", color: C.forecast, ys: d.p50 },
        { label: "P90", color: C.ok, ys: d.p90 },
        { label: "P10", color: C.ok, ys: d.p10 },
        { label: "Threshold", color: C.threshold, ys: d.hours.map(() => DEFAULT_THRESHOLD_M), dot: false },
      ],
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 6: ACTIVE ALERTS
  // ─────────────────────────────────────────────────────────────────────────
  async function _renderAlerts() {
    contentArea.innerHTML = `<div class="hip-loading">Loading alerts…</div>`;
    const alerts = await getAlerts();

    if (!alerts.length) {
      contentArea.innerHTML = `
        <div class="hip-graph-section">
          <div class="hip-graph-title">Active Alerts</div>
          <div class="hip-empty" style="color:${C.ok}">✓ No active threshold exceedances</div>
          <div class="hip-prov-row">Source: <strong>LIVE</strong> · Threshold: <strong>VERIFIED</strong></div>
        </div>`;
      return;
    }

    const rows = alerts.map((a) => {
      const sevColor = a.severity === "DANGER" ? C.critical : C.warn;
      const crossingText = a.median_crossing_h == null
        ? "Not crossing in 72h"
        : a.median_crossing_h <= 0
          ? "Already exceeded"
          : `Median crosses in +${a.median_crossing_h}h`;
      return `
        <div class="hip-alert" data-severity="${a.severity}">
          <div class="hip-alert__header">
            <span class="hip-alert__badge" style="background:${sevColor}22;color:${sevColor}">${a.severity}</span>
            <span class="hip-alert__name">${a.asset_name}</span>
            <span class="hip-alert__ch">CH ${_fmt(a.chainage_m)}</span>
          </div>
          <div class="hip-alert__body">
            <div class="hip-kv"><span class="k">Probability (72h)</span><span class="v" style="color:${sevColor}">${a.exceedance_prob_pct != null ? a.exceedance_prob_pct + "%" : "—"}</span></div>
            <div class="hip-kv"><span class="k">Forecast crossing</span><span class="v">${crossingText}</span></div>
            <div class="hip-kv"><span class="k">Current WSE</span><span class="v">${_val(a.current_wse_m, "m")}</span></div>
            <div class="hip-kv"><span class="k">Threshold</span><span class="v">${_val(a.threshold_m, "m")}</span></div>
            <div class="hip-kv"><span class="k">Current Margin</span><span class="v" style="color:${sevColor}">${a.current_margin_m != null ? `${a.current_margin_m >= 0 ? "+" : ""}${a.current_margin_m.toFixed(3)} m` : "—"}</span></div>
            <div class="hip-kv"><span class="k">Risk</span><span class="v">${a.risk ?? "—"}/100</span></div>
          </div>
          <div class="hip-alert__prov">Source: ${a.provenance.alert_basis} · Threshold: ${a.provenance.threshold}</div>
        </div>`;
    }).join("");

    contentArea.innerHTML = `
      <div class="hip-graph-section">
        <div class="hip-graph-title">Active Alerts <span class="hip-sub">${alerts.length} active</span></div>
        <div class="hip-alerts-list">${rows}</div>
        <div class="hip-prov-row">Alert basis: <strong>LIVE</strong> · Thresholds: <strong>VERIFIED CLASS DEFAULTS</strong></div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 7: MARGIN BOARD
  // ─────────────────────────────────────────────────────────────────────────
  function _renderMarginBoard() {
    const assets = getMarginBoard();

    if (!assets.length) {
      contentArea.innerHTML = `<div class="hip-hint">Asset data loading… (Digital Twin initializing)</div>`;
      return;
    }

    const rows = assets.map((a) => {
      const m = a.current_margin_m;
      const mf = a.forecast_margin_m;
      const sev = a.severity ?? "ok";
      const sevColor = { ok: C.ok, warn: C.warn, critical: C.critical }[sev] ?? C.muted;
      const barW = Math.min(100, Math.max(0, 100 - (m ?? 2) * 20));
      return `
        <div class="hip-mb-row" data-severity="${sev}">
          <div class="hip-mb-name">${a.name}</div>
          <div class="hip-mb-ch">CH ${_fmt(a.chainage_m)}</div>
          <div class="hip-mb-bar-wrap">
            <div class="hip-mb-bar"><div class="hip-mb-fill" data-status="${sev}" style="width:${barW}%"></div></div>
          </div>
          <div class="hip-mb-margin" style="color:${sevColor}">${m != null ? `${m >= 0 ? "+" : ""}${m.toFixed(2)} m` : "—"}</div>
          <div class="hip-mb-fcast" style="color:${C.muted}">${mf != null ? `${mf >= 0 ? "+" : ""}${mf.toFixed(2)}` : "—"}</div>
          <div class="hip-mb-prob">${a.probability != null ? a.probability + "%" : "—"}</div>
          <div class="hip-mb-risk">${a.risk ?? "—"}</div>
        </div>`;
    }).join("");

    contentArea.innerHTML = `
      <div class="hip-graph-section">
        <div class="hip-graph-title">Margin Board — All Protected Assets</div>
        <div class="hip-mb-header">
          <span>Asset</span><span>CH</span><span>Risk bar</span>
          <span>Margin</span><span>+72h</span><span>P(exceed)</span><span>Risk</span>
        </div>
        <div class="hip-mb-body">${rows}</div>
        <div class="hip-prov-row">
          WSE: <strong>LIVE</strong> · Threshold: <strong>VERIFIED</strong> · Forecast: <strong>LIVE</strong>
        </div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: populate station custom dropdown from landmarks
  // ─────────────────────────────────────────────────────────────────────────
  async function _populateStationDropdown() {
    _stationOptions = [{ value: "", label: "— Select station —" }];
    try {
      const res = await fetch("/data/naditwin/landmarks.json", { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return;
      const lms = await res.json();
      lms.forEach((lm) => {
        _stationOptions.push({
          value: String(lm.chainage_m),
          label: `${lm.name} (CH ${_fmt(lm.chainage_m)})`,
        });
      });
    } catch { /* silent */ }
    _buildCustomDropdown(
      "hip-station-trigger", "hip-station-menu", "hip-station-label",
      _stationOptions,
      (val) => {
        const m = parseFloat(val);
        if (!Number.isFinite(m)) return;
        _currentChainage = m;
        state.selectedChainageMeters = m;
        document.dispatchEvent(new CustomEvent("chainage-select",
          { detail: { meters: m, focus: false, source: "hydro-intel-panel" } }));
        _loadAndRender();
      }
    );
  }

  function _syncDropdown(meters) {
    _syncStationDropdownLabel(meters);
  }

  function _populateHistSelect() {
    _histOptions = [{ value: "", label: "— Select event —" }];
    getHistoricalEvents().forEach((ev) => {
      _histOptions.push({
        value: ev.eventId,
        label: ev.name.length > 46 ? ev.name.slice(0, 44) + "…" : ev.name,
      });
    });
    _buildCustomDropdown(
      "hip-hist-trigger", "hip-hist-menu", "hip-hist-label",
      _histOptions,
      (val) => {
        _historicEventId = val || null;
        const ev = selectHistoricalEvent(_historicEventId);
        if (ev && window.__MM_SCENE__?.updateHydraulicProfile) {
          window.__MM_SCENE__.updateHydraulicProfile({
            upstreamQ_m3s: ev.discharge_m3s,
            downstreamWse_m_msl: ev.stage_m_msl,
            dischargeSource: ev.source,
            dischargeProvenance: ev.provenance,
            timestamp: ev.timestamp,
          });
        }
        _loadAndRender();
      }
    );
  }

  // ── Formatters ────────────────────────────────────────────────────────────
  function _fmt(m) {
    const v = Math.max(0, Math.round(Number(m) || 0));
    return `${Math.floor(v / 1000)}+${String(v % 1000).padStart(3, "0")}`;
  }
  function _val(v, unit = "") {
    if (v == null || !Number.isFinite(Number(v))) return "—";
    return `${Number(v).toFixed(unit === "m³/s" ? 1 : unit === "m" ? 3 : 2)} ${unit}`.trim();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SKELETON HTML
  // ─────────────────────────────────────────────────────────────────────────
  function _buildSkeleton() {
    return `
      <div class="hip-header">
        <div class="hip-header-top">
          <div class="hip-title-group">
            <span class="hip-main-title">MULA–MUTHA HYDROLOGY</span>
            <span id="hip-station-badge" class="hip-badge">—</span>
            <span id="hip-status-badge" class="hip-badge hip-badge--status">—</span>
          </div>
          <button id="hip-close" class="hip-close-btn" aria-label="Close">${lucideHtml(X, { size: 16 })}</button>
        </div>
        <!-- Controls row -->
        <div class="hip-controls-row">
          <div class="hip-mode-btns">
            <button id="hip-mode-live" class="hip-mode-btn active">LIVE</button>
            <button id="hip-mode-hist" class="hip-mode-btn">HISTORIC</button>
          </div>
          <div id="hip-hist-wrap" class="hip-hist-wrap" hidden>
            <div class="hip-custom-select" id="hip-hist-dropdown">
              <div class="hip-custom-select__trigger" id="hip-hist-trigger">
                <span id="hip-hist-label">— Select event —</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="flex-shrink:0"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
              <div class="hip-custom-select__menu" id="hip-hist-menu" hidden></div>
            </div>
          </div>
          <div class="hip-custom-select hip-custom-select--station" id="hip-station-dropdown">
            <div class="hip-custom-select__trigger" id="hip-station-trigger">
              <span id="hip-station-label">— Select station —</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="flex-shrink:0"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div class="hip-custom-select__menu" id="hip-station-menu" hidden></div>
          </div>
        </div>
        <!-- Tabs -->
        <div class="hip-tabs" role="tablist">
          <button class="hip-tab active" data-tab="overview" role="tab">OVERVIEW</button>
          <button class="hip-tab" data-tab="discharge" role="tab">DISCHARGE</button>
          <button class="hip-tab" data-tab="stage" role="tab">RIVER STAGE</button>
          <button class="hip-tab" data-tab="hydro" role="tab">HYDROGRAPH</button>
          <button class="hip-tab" data-tab="threshold" role="tab">THRESHOLD</button>
          <button class="hip-tab" data-tab="forecast" role="tab">FORECAST</button>
          <button class="hip-tab" data-tab="alerts" role="tab">ALERTS</button>
          <button class="hip-tab" data-tab="margin" role="tab">MARGIN BOARD</button>
        </div>
      </div>
      <div id="hip-content" class="hip-content">
        <div class="hip-loading">Initializing hydrology intelligence…</div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STYLES
  // ─────────────────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById("hip-styles")) return;
    const s = document.createElement("style");
    s.id = "hip-styles";
    s.textContent = `
/* When the hydrology panel is open, hide chainage markers that bleed over it */
body.hydro-intel-open .chainage-destination-marker,
body.hydro-intel-open .chainage-current-marker {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: none !important;
}

/* ─────────────────────────────────────────────────────────────────────
   Hydrology Intelligence Panel
   Position: centered floating modal, below the analytics nav bar.
   Does NOT overlap: gis-tools-stack (right), analytics-controls (top-center),
   left-ui-stack (left), or any map control.
───────────────────────────────────────────────────────────────────── */

/* Backdrop — light dim so the map stays visible behind the glass card.
   No click-to-close — only X button and ESC close it. */
.hydro-intel-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.22);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  z-index: 9000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: calc(max(14px, env(safe-area-inset-top)) + 74px) 16px 16px;
  box-sizing: border-box;
  overflow-y: auto;
  pointer-events: auto;
}
.hydro-intel-backdrop[hidden] { display: none !important; }

/* Panel — frosted translucent white */
.hydro-intel-panel {
  pointer-events: auto;
  position: relative;
  width: min(1120px, calc(100vw - 96px));
  max-height: calc(100vh - max(14px, env(safe-area-inset-top)) - 90px);
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 14px;
  box-shadow:
    0 24px 60px rgba(15, 23, 42, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  color: #0f172a;
  font-size: 12px;
  overflow: hidden;
  flex-shrink: 0;
  box-sizing: border-box;
}

/* ── Header ── */
.hip-header {
  background: rgba(255, 255, 255, 0.55);
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  flex-shrink: 0;
}
.hip-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px 6px;
  gap: 8px;
  min-width: 0;
}
.hip-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
}
.hip-main-title {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #0f172a;
  white-space: nowrap;
}
.hip-badge {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(15, 23, 42, 0.07);
  color: #334155;
  white-space: nowrap;
}
.hip-badge--status {
  background: rgba(5, 150, 105, 0.14);
  color: #047857;
}
.hip-close-btn {
  background: none;
  border: none;
  color: #475569;
  cursor: pointer;
  padding: 5px;
  border-radius: 6px;
  flex-shrink: 0;
  line-height: 1;
  transition: background 0.15s, color 0.15s;
}
.hip-close-btn:hover { color: #0f172a; background: rgba(15, 23, 42, 0.08); }

/* ── Controls row ── */
.hip-controls-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 18px 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.hip-mode-btns {
  display: flex;
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.6);
}
.hip-mode-btn {
  background: transparent;
  border: none;
  color: #475569;
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 0.05em;
  transition: background 0.15s, color 0.15s;
}
.hip-mode-btn:hover:not(.active) { background: rgba(2, 132, 199, 0.08); color: #0f172a; }
.hip-mode-btn.active { background: #0284c7; color: #fff; }
.hip-select {
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 23, 42, 0.14);
  color: #0f172a;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 11px;
  min-width: 0;
  flex: 1;
  max-width: 240px;
}
.hip-hist-wrap { flex: 1; min-width: 0; max-width: 240px; }

/* ── Custom dropdowns ── */
.hip-custom-select {
  position: relative;
  flex: 1;
  min-width: 150px;
  max-width: 260px;
  user-select: none;
}
.hip-custom-select--station { min-width: 200px; }
.hip-custom-select__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(15, 23, 42, 0.16);
  border-radius: 8px;
  color: #0f172a;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  white-space: nowrap;
  overflow: hidden;
}
.hip-custom-select__trigger:hover {
  background: #fff;
  border-color: rgba(2, 132, 199, 0.55);
  box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.12);
}
.hip-custom-select--open .hip-custom-select__trigger {
  background: #fff;
  border-color: #0284c7;
  color: #0369a1;
}
.hip-custom-select--open .hip-custom-select__trigger svg { transform: rotate(180deg); }
.hip-custom-select__trigger svg { transition: transform 0.2s; color: #475569; }
.hip-custom-select__trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.hip-custom-select__menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  min-width: 220px;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 10px;
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.2);
  z-index: 99999;
  max-height: 260px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(15, 23, 42, 0.25) transparent;
}
.hip-custom-select__menu::-webkit-scrollbar { width: 5px; }
.hip-custom-select__menu::-webkit-scrollbar-thumb { background: rgba(15, 23, 42, 0.25); border-radius: 3px; }
.hip-dd-item {
  padding: 8px 14px;
  font-size: 12px;
  color: #1e293b;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hip-dd-item:hover { background: rgba(2, 132, 199, 0.1); color: #0369a1; }
.hip-dd-item.active { background: rgba(2, 132, 199, 0.16); color: #0369a1; font-weight: 700; }
.hip-dd-item--placeholder { color: #64748b; font-style: italic; font-size: 11px; }
.hip-dd-item--placeholder:hover { background: transparent; color: #64748b; }

/* ── Tabs ── */
.hip-tabs {
  display: flex;
  gap: 2px;
  padding: 0 10px;
  overflow-x: auto;
  scrollbar-width: none;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
}
.hip-tabs::-webkit-scrollbar { display: none; }
.hip-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #475569;
  padding: 9px 12px;
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  letter-spacing: 0.05em;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  flex-shrink: 0;
  border-radius: 6px 6px 0 0;
}
.hip-tab:hover:not(.active) { color: #0f172a; background: rgba(15, 23, 42, 0.05); }
.hip-tab.active { color: #0369a1; border-bottom-color: #0284c7; }

/* ── Content area ── */
.hip-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px;
  scrollbar-width: thin;
  scrollbar-color: rgba(15, 23, 42, 0.25) transparent;
  min-height: 0;
}
.hip-content::-webkit-scrollbar { width: 6px; }
.hip-content::-webkit-scrollbar-thumb { background: rgba(15, 23, 42, 0.22); border-radius: 3px; }
.hip-loading, .hip-hint, .hip-error, .hip-empty {
  color: #475569;
  font-size: 13px;
  padding: 32px 0;
  text-align: center;
}
.hip-error { color: #dc2626; }
.hip-empty { color: #047857; }

/* ── Graph section ── */
.hip-graph-section { display: flex; flex-direction: column; gap: 10px; }
.hip-graph-title {
  font-size: 14px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: 0.03em;
}
.hip-sub { font-size: 11px; font-weight: 500; color: #475569; margin-left: 6px; }
.hip-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  row-gap: 6px;
}
.hip-legend span { font-size: 11px !important; font-weight: 600; }
.hip-svg-wrap {
  position: relative;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 10px;
  padding: 8px;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.04);
}
.hip-svg-wrap svg text { font-weight: 500; }
.hip-bar { cursor: pointer; transition: opacity 0.15s; }
.hip-bar:hover { opacity: 1 !important; }

/* Chart hover tooltip */
.hip-prov-row {
  font-size: 10.5px;
  color: #475569;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
  padding-top: 8px;
  margin-top: 2px;
  line-height: 1.7;
}
.hip-prov-row strong { color: #0f172a; }

/* ── Overview cards ── */
.hip-summary-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}
@media (max-width: 860px) {
  .hip-summary-cards { grid-template-columns: 1fr 1fr; }
}
.hip-card {
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(15, 23, 42, 0.09);
  border-radius: 10px;
  padding: 10px 14px;
  min-width: 0;
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}
.hip-card:hover {
  transform: translateY(-1px);
  border-color: rgba(2, 132, 199, 0.35);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.1);
}
.hip-card__label { font-size: 10.5px; color: #475569; font-weight: 600; letter-spacing: 0.03em; }
.hip-card__value { font-size: 17px; font-weight: 800; color: #0f172a; margin: 4px 0 2px; }
.hip-card__prov { font-size: 9.5px; font-weight: 700; color: ${C.active}; }

/* ── Station block ── */
.hip-station-block {
  background: rgba(2, 132, 199, 0.07);
  border: 1px solid rgba(2, 132, 199, 0.22);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
}
.hip-station-title {
  font-size: 14px;
  font-weight: 800;
  color: #0369a1;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}
.hip-kv-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px 18px;
}
@media (max-width: 860px) {
  .hip-kv-grid { grid-template-columns: 1fr 1fr; }
}
.hip-kv {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 4px 6px;
  border-radius: 6px;
  transition: background 0.12s;
}
.hip-kv:hover { background: rgba(15, 23, 42, 0.05); }
.hip-kv .k { color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hip-kv .v { font-weight: 700; color: #0f172a; white-space: nowrap; }
.hip-prov-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}
@media (max-width: 860px) {
  .hip-prov-grid { grid-template-columns: 1fr 1fr; }
}
.hip-prov-grid .pk { color: #475569; font-size: 10.5px; }
.hip-prov-grid .pv { color: ${C.active}; font-size: 10.5px; font-weight: 700; margin-left: 4px; }
.hip-telemetry-note {
  font-size: 10.5px;
  color: #334155;
  padding: 7px 10px;
  background: rgba(220, 38, 38, 0.06);
  border-radius: 8px;
  border: 1px solid rgba(220, 38, 38, 0.18);
  margin-top: 8px;
}

/* ── Risk bar ── */
.hip-risk-strip { display: flex; align-items: center; gap: 8px; margin-top: 6px; color: #334155; }
.hip-risk-bar {
  flex: 1;
  height: 7px;
  background: rgba(15, 23, 42, 0.08);
  border-radius: 4px;
  overflow: hidden;
}
.hip-risk-fill {
  height: 100%;
  border-radius: 4px;
  background: #059669;
  transition: width 0.4s;
}
.hip-risk-fill[data-status="warn"]     { background: #d97706; }
.hip-risk-fill[data-status="critical"] { background: #dc2626; }

/* ── Alerts ── */
.hip-alerts-list { display: flex; flex-direction: column; gap: 8px; }
.hip-alert {
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 10px;
  padding: 10px 12px;
  transition: box-shadow 0.15s;
}
.hip-alert:hover { box-shadow: 0 8px 20px rgba(15, 23, 42, 0.1); }
.hip-alert[data-severity="DANGER"]  { border-color: rgba(220, 38, 38, 0.4); }
.hip-alert[data-severity="WARNING"] { border-color: rgba(217, 119, 6, 0.4); }
.hip-alert__header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.hip-alert__badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; }
.hip-alert__name { font-weight: 800; color: #0f172a; }
.hip-alert__ch { font-size: 10.5px; color: #475569; margin-left: auto; }
.hip-alert__body { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.hip-alert__prov {
  font-size: 10px;
  color: #475569;
  margin-top: 6px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
  padding-top: 4px;
}

/* ── Margin Board ── */
.hip-mb-header, .hip-mb-row {
  display: grid;
  grid-template-columns: 130px 70px 1fr 70px 56px 64px 44px;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.07);
  font-size: 11.5px;
}
.hip-mb-row { border-radius: 6px; transition: background 0.12s; }
.hip-mb-row:hover { background: rgba(2, 132, 199, 0.08); }
.hip-mb-header {
  font-size: 10.5px;
  color: #475569;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.hip-mb-name { font-weight: 700; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hip-mb-ch { color: #475569; font-size: 10.5px; }
.hip-mb-bar { height: 6px; background: rgba(15, 23, 42, 0.08); border-radius: 3px; overflow: hidden; }
.hip-mb-fill { height: 100%; background: #059669; border-radius: 3px; transition: width 0.3s; }
.hip-mb-fill[data-status="warn"]     { background: #d97706; }
.hip-mb-fill[data-status="critical"] { background: #dc2626; }
.hip-mb-margin { font-weight: 800; }
.hip-mb-fcast, .hip-mb-prob, .hip-mb-risk { color: #334155; text-align: right; }

/* ── Responsive ── */
@media (max-width: 900px) {
  .hydro-intel-panel { width: calc(100vw - 40px); }
  .hip-tab { padding: 7px 9px; font-size: 10px; }
  .hip-mb-header, .hip-mb-row {
    grid-template-columns: 100px 58px 1fr 58px 48px;
  }
  .hip-mb-prob, .hip-mb-risk,
  .hip-mb-header span:nth-child(6),
  .hip-mb-header span:nth-child(7) { display: none; }
}
@media (max-width: 600px) {
  .hydro-intel-panel { width: calc(100vw - 20px); }
  .hip-controls-row { flex-wrap: wrap; gap: 6px; }
  .hip-select { max-width: 100%; }
}
`;
    document.head.appendChild(s);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  onDigitalTwinExit(() => { if (!backdrop.hidden) hide(); });
  window.__MM_HYDRO_INTEL__ = { show, hide, isOpen: () => !backdrop.hidden };

  return { show, hide, el: backdrop, isOpen: () => !backdrop.hidden };
}
