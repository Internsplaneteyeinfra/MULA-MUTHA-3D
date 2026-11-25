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
  nearestChainageIndex,
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
import {
  renderThreeGraphs,
  resetThreeGraphExpand,
  collapseThreeGraphExpandIfNeeded,
} from "./hydroIntelThreeGraphs.js";
import { mountMarginBoard } from "./hydroIntelMarginBoard.js";
import {
  getTimerangeMeta,
  getLocationsSeries,
} from "../../services/hydrology/naditwinChartSeries.js";
import {
  buildHistOptions,
  parseCoverage,
  resolveHistSelection,
  formatSelectedPeriod,
} from "./hydroIntelHistRange.js";
import {
  clampHistoricAt,
  defaultHistoricAt,
  parseAtToLocalParts,
  stepHistoricAt,
  toNadiTwinAtIso,
} from "../../services/hydrology/naditwinHistoricService.js";

// ── Palette (matches project theme) ─────────────────────────────────────────
// Tuned for the light frosted-glass panel: saturated, dark enough for contrast.
/* Profile Analysis–matched dark dashboard palette (bright lines on dark). */
const C = {
  ok:       "#5dcea0",
  warn:     "#E8A13D",
  critical: "#ff6b6b",
  wse:      "#5bc8e8",
  forecast: "#c4b5fd",
  p10p90:   "rgba(91, 200, 232, 0.18)",
  bed:      "#E8A13D",
  threshold:"#ff6b6b",
  crest:    "#dff8ff",
  danger:   "#ff6b6b",
  warning:  "#E8A13D",
  watch:    "#f0d060",
  observed: "#9fe7f6",
  muted:    "rgba(190, 220, 230, 0.72)",
  gridLine: "rgba(180, 220, 230, 0.12)",
  axis:     "rgba(180, 220, 230, 0.45)",
  active:   "#E8A13D",
};

// ── SVG layout helpers ───────────────────────────────────────────────────────
function svgLayout(opts = {}) {
  const padL = opts.padL ?? 58;
  const padR = opts.padR ?? 20;
  const padT = opts.padT ?? 28;
  const padB = opts.padB ?? 48;
  const W    = opts.W ?? 1280;
  const H    = opts.H ?? 480;
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
  let d = "";
  let penUp = true;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (!Number.isFinite(y) || !Number.isFinite(xs[i])) {
      penUp = true;
      continue;
    }
    d += `${penUp ? "M" : "L"}${scX(xs[i]).toFixed(1)},${scY(y).toFixed(1)}`;
    penUp = false;
  }
  return d;
}

function svgBand(xs, ysLo, ysHi, scX, scY) {
  if (!xs?.length) return "";
  const pts = [];
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ysLo[i]) || !Number.isFinite(ysHi[i])) continue;
    pts.push(i);
  }
  if (!pts.length) return "";
  const top = pts.map((i, k) => `${k === 0 ? "M" : "L"}${scX(xs[i]).toFixed(1)},${scY(ysHi[i]).toFixed(1)}`).join(" ");
  const base = [...pts].reverse().map((i) => `L${scX(xs[i]).toFixed(1)},${scY(ysLo[i]).toFixed(1)}`).join(" ");
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
  let _mode             = "live"; // "live" | "historic"
  let _historicEventId  = null; // legacy bulletin id (unused for charts)
  let _histSelection    = { id: "72h", hours: 72, year: null, label: "Past 72 hours + 72 h forecast" };
  let _histLookbackH    = 72;
  let _histCoverage     = { ok: false };
  let _historicAt       = null; // ISO with +05:30 — HISTORIC only
  let _lastUpdateAt     = null;
  let _reachData        = null;   // cached getCurrentHydrology()
  let _stationData      = null;   // cached getStationState()
  let _loadTimer        = null;
  let _locations        = [];     // NadiTwin /api/locations rows
  let _stretchId        = "ALL";  // ALL | L1..L7
  let _lastHydroWindow  = null;   // actual hydro timespan from last API pack
  let _landmarks        = [];

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const closeBtn    = panel.querySelector("#hip-close");
  const contentArea = panel.querySelector("#hip-content");
  const modeLive    = panel.querySelector("#hip-mode-live");
  const modeHist    = panel.querySelector("#hip-mode-hist");
  const stationBadge= panel.querySelector("#hip-station-badge");
  const statusBadge = panel.querySelector("#hip-status-badge");
  const coverageEl  = panel.querySelector("#hip-coverage");
  const chainageInput = panel.querySelector("#hip-chainage-input");
  const historicCtrls = panel.querySelector("#hip-historic-controls");
  const histDateEl = panel.querySelector("#hip-hist-date");
  const histTimeEl = panel.querySelector("#hip-hist-time");
  const histClockEl = panel.querySelector("#hip-hist-clock");
  const histStepPrev = panel.querySelector("#hip-hist-prev");
  const histStepNext = panel.querySelector("#hip-hist-next");
  const histStepLabel = panel.querySelector("#hip-hist-step-label");
  const marginBoardBtn = panel.querySelector("#hip-margin-board-btn");

  const marginBoard = mountMarginBoard(panel, {
    getMode: () => _mode,
    getHistoricAt: () => _historicAt,
  });

  function _parseChainageInput(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    if (s.includes("+")) {
      const [km, m] = s.split("+");
      const meters = (Number(km) || 0) * 1000 + (Number(m) || 0);
      return Number.isFinite(meters) ? meters : null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function _syncChainageInput(meters) {
    if (!chainageInput || !Number.isFinite(meters)) return;
    chainageInput.value = _fmt(meters);
  }

  if (chainageInput) {
    const applyChainage = () => {
      const m = _parseChainageInput(chainageInput.value);
      if (!Number.isFinite(m)) return;
      _currentChainage = m;
      state.selectedChainageMeters = m;
      _syncStationDropdownLabel(m);
      document.dispatchEvent(new CustomEvent("chainage-select",
        { detail: { meters: m, focus: true, source: "hydro-intel-panel" } }));
      _loadAndRender();
    };
    chainageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); applyChainage(); }
    });
    chainageInput.addEventListener("change", applyChainage);
  }

  // ── Custom dropdown helpers ───────────────────────────────────────────────
  // Replaces native <select> with fully themed dark-glass dropdowns.

  let _stationOptions = []; // { value, label }
  let _histOptions    = []; // { value, label }

  function _buildCustomDropdown(triggerId, menuId, labelId, options, onSelect) {
    const trigger = panel.querySelector(`#${triggerId}`);
    const menu    = panel.querySelector(`#${menuId}`);
    const label   = panel.querySelector(`#${labelId}`);
    if (!trigger || !menu || !label) return;

    menu.innerHTML = options.map((opt) =>
      `<div class="hip-dd-item${opt.value === "" ? " hip-dd-item--placeholder" : ""}${opt.disabled ? " is-disabled" : ""}"
            data-value="${opt.value}"${opt.disabled ? " aria-disabled=\"true\"" : ""}>${opt.label}</div>`
    ).join("");

    trigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = !menu.hidden;
      panel.querySelectorAll(".hip-custom-select__menu").forEach((m) => {
        m.hidden = true;
        m.closest(".hip-custom-select")?.classList.remove("hip-custom-select--open");
      });
      if (!isOpen) {
        menu.hidden = false;
        trigger.closest(".hip-custom-select")?.classList.add("hip-custom-select--open");
      }
    };

    menu.onclick = (e) => {
      const item = e.target.closest(".hip-dd-item");
      if (!item || item.classList.contains("is-disabled")) return;
      const val = item.dataset.value;
      label.textContent = item.textContent;
      menu.querySelectorAll(".hip-dd-item").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      menu.hidden = true;
      trigger.closest(".hip-custom-select")?.classList.remove("hip-custom-select--open");
      onSelect(val);
    };
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
  // Digital Twin primary = Charts panel. Hydrology 3D modes/timeline HUD is retired.
  let _analyticalOpen = false;

  function setHydrologyView(view) {
    const detailed = view === "detailed";
    const wasDetailed = state.hydrologyViewState === "detailed";
    state.hydrologyViewState = detailed ? "detailed" : "current";

    if (!_analyticalOpen) {
      backdrop.hidden = true;
      backdrop.style.display = "none";
      document.body.classList.remove("hydro-intel-open");
    }

    if (detailed) {
      if (!wasDetailed) document.dispatchEvent(new Event("hydrology-intel-open"));
    } else {
      window.__MM_HYDRO_VIZ__?.hide?.();
      _analyticalOpen = false;
      backdrop.hidden = true;
      backdrop.style.display = "none";
      document.body.classList.remove("hydro-intel-open");
      if (wasDetailed) document.dispatchEvent(new Event("hydrology-intel-close"));
    }
  }

  /** Primary: open Charts (MULA-MUTHA HYDROLOGY analytical panel). */
  function show() {
    showAnalyticalCharts();
  }
  function hide() {
    _analyticalOpen = false;
    _stopChartRefresh();
    resetThreeGraphExpand();
    marginBoard.close();
    setHydrologyView("current");
    // Clear DT chrome when charts close
    const dtBtn = document.querySelector("[data-analytics='digital_twin']");
    dtBtn?.classList.remove("active");
    dtBtn?.setAttribute("aria-pressed", "false");
    document.getElementById("ui-root")?.classList.remove("dt-mode-active");
    document.body.classList.remove("dt-mode-active");
    backdrop.hidden = true;
    backdrop.style.display = "none";
    document.body.classList.remove("hydro-intel-open");
  }
  const isOpen = () => _analyticalOpen && !backdrop.hidden;
  const isAnalyticalOpen = () => _analyticalOpen && !backdrop.hidden;

  let _chartRefreshTimer = 0;
  function _stopChartRefresh() {
    if (_chartRefreshTimer) {
      window.clearInterval(_chartRefreshTimer);
      _chartRefreshTimer = 0;
    }
  }
  function _startChartRefresh() {
    _stopChartRefresh();
    _chartRefreshTimer = window.setInterval(() => {
      if (!_analyticalOpen || backdrop.hidden) return;
      if (_mode === "historic") return; // do not thrash historical queries
      _loadAndRender();
    }, 60_000);
  }

  /** Charts panel — Digital Twin entry surface. */
  function showAnalyticalCharts() {
    _analyticalOpen = true;
    state.hydrologyViewState = "detailed";
    backdrop.hidden = false;
    backdrop.style.display = "flex";
    document.body.classList.add("hydro-intel-open");
    // Keep the old Hydrology 3D HUD closed
    window.__MM_HYDRO_VIZ__?.hide?.();
    _loadAndRender();
    _startChartRefresh();
    document.dispatchEvent(new Event("hydrology-intel-open"));
  }

  // Charts view is fixed to the three NadiTwin analytical graphs (no extra tabs).

  // ── Close button — X button and ESC only. Backdrop clicks do NOT close. ──
  closeBtn?.addEventListener("click", () => {
    hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (backdrop.hidden && !_analyticalOpen) return;
    // First Escape restores the 3-graph dashboard; second exits fullscreen panel
    if (collapseThreeGraphExpandIfNeeded()) return;
    hide();
  });

  function _fillHistTimeOptions() {
    if (!histTimeEl) return;
    const maxH = (_mode === "historic"
      && _histCoverage?.latest
      && histDateEl?.value === _histCoverage.latest
      && Number.isFinite(_histCoverage.todayHour))
      ? Number(_histCoverage.todayHour)
      : 23;
    const cur = histTimeEl.value;
    histTimeEl.innerHTML = Array.from({ length: maxH + 1 }, (_, h) => {
      const v = String(h).padStart(2, "0") + ":00";
      return `<option value="${v}">${v} IST</option>`;
    }).join("");
    if (cur && [...histTimeEl.options].some((o) => o.value === cur)) histTimeEl.value = cur;
    else histTimeEl.value = String(Math.min(maxH, 12)).padStart(2, "0") + ":00";
  }

  function _syncHistoricControlsFromAt() {
    if (!_historicAt) return;
    const parts = parseAtToLocalParts(_historicAt);
    if (!parts) return;
    if (histDateEl) {
      if (_histCoverage.earliest) histDateEl.min = _histCoverage.earliest;
      if (_histCoverage.latest) histDateEl.max = _histCoverage.latest;
      histDateEl.value = parts.date;
    }
    _fillHistTimeOptions();
    if (histTimeEl) histTimeEl.value = `${String(parts.hour).padStart(2, "0")}:00`;
    if (histClockEl) histClockEl.textContent = parts.label;
    if (histStepLabel) histStepLabel.textContent = "STEP 1 h";
  }

  function _applyHistoricFromControls() {
    const date = histDateEl?.value;
    const time = histTimeEl?.value || "12:00";
    const hour = Number(String(time).split(":")[0]);
    if (!date) return;
    _historicAt = clampHistoricAt(toNadiTwinAtIso(date, hour, 0), _histCoverage);
    _syncHistoricControlsFromAt();
    _updateCoverageStrip();
    _loadAndRender();
    marginBoard.refresh();
  }

  function _setHistoricUiVisible(on) {
    if (historicCtrls) historicCtrls.hidden = !on;
  }

  // ── Mode toggles — LIVE path unchanged; HISTORIC adds date/time controls ─
  modeLive?.addEventListener("click", () => {
    _mode = "live";
    _historicEventId = null;
    _histSelection = resolveHistSelection("72h", _histCoverage);
    _histLookbackH = 72;
    modeLive.classList.add("active");
    modeHist?.classList.remove("active");
    selectHistoricalEvent(null);
    _setHistoricUiVisible(false);
    _updateCoverageStrip();
    _loadAndRender();
    marginBoard.refresh();
  });
  modeHist?.addEventListener("click", async () => {
    _mode = "historic";
    modeLive?.classList.remove("active");
    modeHist.classList.add("active");
    selectHistoricalEvent(null);
    await _ensureHistCoverage();
    if (!_historicAt) _historicAt = defaultHistoricAt(_histCoverage);
    else _historicAt = clampHistoricAt(_historicAt, _histCoverage);
    _histSelection = resolveHistSelection(_histSelection.id || "72h", _histCoverage);
    _histLookbackH = _histSelection.hours || 72;
    _setHistoricUiVisible(true);
    _syncHistoricControlsFromAt();
    _updateCoverageStrip();
    _loadAndRender();
    marginBoard.refresh();
  });

  histDateEl?.addEventListener("change", () => {
    _fillHistTimeOptions();
    _applyHistoricFromControls();
  });
  histTimeEl?.addEventListener("change", () => _applyHistoricFromControls());
  histStepPrev?.addEventListener("click", () => {
    if (!_historicAt) return;
    _historicAt = stepHistoricAt(_historicAt, -1, _histCoverage);
    _syncHistoricControlsFromAt();
    _updateCoverageStrip();
    _loadAndRender();
    marginBoard.refresh();
  });
  histStepNext?.addEventListener("click", () => {
    if (!_historicAt) return;
    _historicAt = stepHistoricAt(_historicAt, +1, _histCoverage);
    _syncHistoricControlsFromAt();
    _updateCoverageStrip();
    _loadAndRender();
    marginBoard.refresh();
  });
  marginBoardBtn?.addEventListener("click", () => marginBoard.toggle());

  function _chartPastHours() {
    return _mode === "historic" ? (_histLookbackH || 72) : 72;
  }

  function _currentStretch() {
    if (_stretchId === "ALL" || !_locations.length) {
      const last = _locations[_locations.length - 1];
      return {
        id: "ALL",
        from_name: "Sangam",
        to_name: "Manjari",
        from_m: 0,
        to_m: last?.to_m ?? 16796,
        cell: last ? Math.round((0 + last.to_m) / 20) : 840,
        name: "All locations (Sangam → Manjari)",
      };
    }
    return _locations.find((l) => l.id === _stretchId) || _locations[0];
  }

  function _updateCoverageStrip() {
    if (!coverageEl) return;
    const cov = _histCoverage;
    const period = formatSelectedPeriod(_histSelection, cov);
    const stretch = _currentStretch();
    const classLabel = _mode === "historic"
      ? "HISTORICAL · MODELLED · PROVISIONAL · UNVERIFIED"
      : "LIVE · MODELLED · PROVISIONAL";
    const clock = _mode === "historic" && _historicAt
      ? (parseAtToLocalParts(_historicAt)?.label || _historicAt)
      : null;
    if (_mode === "historic") {
      coverageEl.classList.add("hip-coverage--historic");
      coverageEl.innerHTML = `
        <span class="hip-cov-selected"><b>Selected IST:</b> ${clock || "—"}</span>
        <span><b>API at:</b> ${_historicAt || "—"}</span>
        <span><b>Coverage:</b> ${cov.earliest || "—"} → ${cov.latest || "—"}</span>
        <span><b>Stretch:</b> ${stretch.from_name} → ${stretch.to_name}</span>
        <span><b>Hydro range:</b> ${period}</span>
        <span><b>Source:</b> NadiTwin</span>
        <span><b>Class:</b> ${classLabel}</span>
        <span class="hip-fresh" data-fresh="HISTORICAL">${_lastUpdateAt ? new Date(_lastUpdateAt).toLocaleTimeString() : "—"}</span>`;
      return;
    }
    coverageEl.classList.remove("hip-coverage--historic");
    coverageEl.innerHTML = `
      <span><b>Coverage:</b> ${cov.earliest || "—"} – ${cov.latest || "—"}</span>
      <span><b>Stretch:</b> ${stretch.from_name} → ${stretch.to_name}</span>
      <span><b>Hydro range:</b> ${period}</span>
      <span><b>Class:</b> ${classLabel}</span>
      <span class="hip-fresh">${_lastUpdateAt ? new Date(_lastUpdateAt).toLocaleTimeString() : "—"}</span>`;
  }

  // ── Populate custom dropdowns ─────────────────────────────────────────────
  _populateStationDropdown();
  _populateStretchDropdown();

  // ── Event listeners ───────────────────────────────────────────────────────

  // River click: drive 3D viz + inspect — do NOT open the opaque chart modal
  document.addEventListener("river-station-selected", (e) => {
    const { chainage_m } = e.detail ?? {};
    if (chainage_m == null || !isDigitalTwinActive()) return;
    _currentChainage = chainage_m;
    _syncDropdown(chainage_m);
    show(); // → 3D viz
    window.__MM_SCENE__?.setHydrologyVizFocus?.(chainage_m);
    if (_analyticalOpen && !backdrop.hidden) _loadAndRender();
  });

  // Ruler/arrows/step chainage change
  document.addEventListener("chainage-select", (e) => {
    const m = e.detail?.meters;
    if (!Number.isFinite(m)) return;
    if (e.detail?.source === "hydro-intel-panel") return;
    _currentChainage = m;
    _syncDropdown(m);
    if (isOpen()) {
      window.__MM_SCENE__?.setHydrologyVizFocus?.(m);
    }
    if (_analyticalOpen && !backdrop.hidden) _scheduleRender();
  });

  document.addEventListener("twin-state-change", () => {
    if (_analyticalOpen && !backdrop.hidden && _mode === "live") {
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
      await _ensureHistCoverage();
      // Always fetch reach summary
      _reachData = await getCurrentHydrology();

      // Fetch station-specific data if we have a chainage
      if (_currentChainage != null) {
        _stationData = await getStationState(_currentChainage);
      }

      _lastUpdateAt = Date.now();
      _updateHeaderBadges();
      _updateCoverageStrip();
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
    if (Number.isFinite(_currentChainage)) _syncChainageInput(_currentChainage);

    // Phase 8 safety boards remain LOCKED — never show SAFE as engineering-verified
    if (statusBadge) {
      if (_mode === "historic") {
        statusBadge.textContent = "MODELLED · PROVISIONAL";
        statusBadge.style.color = "#c4b5fd";
        statusBadge.style.background = "rgba(196,181,253,0.14)";
        statusBadge.title = "NadiTwin modelled historical values · Phase 8 UNVERIFIED · safety boards LOCKED";
      } else {
        const sev = _stationData?.current?.severity ?? "ok";
        const STATUS_LABEL = { ok: "MODELLED", warn: "PROVISIONAL", critical: "UNVERIFIED" };
        const STATUS_COLOR = { ok: C.ok, warn: C.warn, critical: C.critical };
        statusBadge.textContent = STATUS_LABEL[sev] ?? "UNVERIFIED";
        statusBadge.style.color = STATUS_COLOR[sev] ?? C.muted;
        statusBadge.style.background = `${STATUS_COLOR[sev] ?? "rgba(255,255,255,0.08)"}22`;
        statusBadge.title = "NadiTwin modelled · Phase 8 safety boards LOCKED · not engineering-verified";
      }
    }
  }

  function _renderLoading() {
    if (contentArea) contentArea.innerHTML = `<div class="hip-loading">Loading hydraulic data…</div>`;
  }

  // ── Tab dispatcher ────────────────────────────────────────────────────────
  function _renderCurrentTab(opts = {}) {
    const hist = _mode === "historic"
      ? _histSelection
      : { id: "72h", hours: 72, year: null, label: "Past 72 hours + 72 h forecast" };
    const stretch = _currentStretch();
    renderThreeGraphs({
      contentArea,
      C,
      chainage_m: _currentChainage,
      hist,
      stretch,
      coverage: _histCoverage,
      mode: _mode,
      historicAt: _mode === "historic" ? _historicAt : null,
      only: opts.only || "all",
      onHistChange: _onHydroHistChange,
      onExitFullscreen: hide,
      liveMeta: {
        twinDate: _mode === "historic" && _historicAt
          ? (parseAtToLocalParts(_historicAt)?.date || _histCoverage.latest || "—")
          : (_histCoverage.latest || "—"),
        twinHour: _mode === "historic" && _historicAt
          ? (parseAtToLocalParts(_historicAt)?.hour ?? "—")
          : (_histCoverage.todayHour ?? "—"),
        nowIso: _mode === "historic" ? _historicAt : (_histCoverage.nowIso || null),
        apiUpdated: _lastUpdateAt ? new Date(_lastUpdateAt).toLocaleString() : "—",
        windowLabel: _mode === "live" && _lastHydroWindow
          ? _lastHydroWindow
          : formatSelectedPeriod(hist, _histCoverage),
        localClock: new Date().toLocaleString(),
      },
    }).then((res) => {
      if (res?.hydroMeta) {
        _lastHydroWindow = `${res.hydroMeta.firstObs || "—"} → ${res.hydroMeta.lastFc || res.hydroMeta.lastObs || "—"}`;
        _updateCoverageStrip();
      }
    }).catch((err) => {
      console.error("[HydroIntelPanel] three-graph render failed", err);
      contentArea.innerHTML = `<div class="hip-error">Chart render failed: ${err?.message || err}</div>`;
    });
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
    const ensStr = sd?.provenance?.ensemble
      || (rd?.dataClass === "LIVE"
        ? "NadiTwin P10/P50/P90 · LIVE twin"
        : `${rd?.ensemble_members ?? N_ENSEMBLE_MEMBERS} members · ${rd?.forecast_horizon_h ?? FORECAST_HORIZON_H}h`);

    const wseNow    = _val(sd?.current?.wse_m, "m");
    const thr       = _val(sd?.current?.threshold_m, "m");
    const margin    = sd?.current?.margin_m;
    const marginStr = margin != null ? `${margin >= 0 ? "+" : ""}${margin.toFixed(3)} m` : "—";
    const marginColor = margin == null ? C.muted : margin <= 0 ? C.critical : margin <= WARN_MARGIN_M ? C.warn : C.ok;
    const risk      = _val(sd?.current?.risk, "/100");
    const qSrc = rd?.discharge_source || sd?.provenance?.discharge || "—";

    contentArea.innerHTML = `
      <div class="hip-overview">
        <div class="hip-summary-cards">
          <div class="hip-card">
            <div class="hip-card__label">Outlet Discharge (LIVE)</div>
            <div class="hip-card__value">${discharge}</div>
            <div class="hip-card__sub" style="font-size:9px;opacity:.7">${qSrc}</div>
          </div>
          <div class="hip-card">
            <div class="hip-card__label">Reach Length</div>
            <div class="hip-card__value">${reachKm} km</div>
          </div>
          <div class="hip-card">
            <div class="hip-card__label">Stations</div>
            <div class="hip-card__value">${stations}</div>
          </div>
          <div class="hip-card">
            <div class="hip-card__label">Forecast</div>
            <div class="hip-card__value" style="font-size:11px">${ensStr}</div>
          </div>
        </div>

        ${_currentChainage != null ? `
        <div class="hip-station-block">
          <div class="hip-station-title">${stLabel}</div>
          <div class="hip-kv-grid">
            <div class="hip-kv"><span class="k">Rel. WSE</span><span class="v" style="color:${C.wse}">${wseNow}</span></div>
            <div class="hip-kv"><span class="k">Threshold</span><span class="v" style="color:${C.threshold}">${thr}</span></div>
            <div class="hip-kv"><span class="k">Margin</span><span class="v" style="color:${marginColor}">${marginStr}</span></div>
            <div class="hip-kv"><span class="k">Risk</span><span class="v">${risk}</span></div>
            <div class="hip-kv"><span class="k">+72h WSE (P50)</span><span class="v">${_val(sd?.forecast?.wse_p50_m, "m")}</span></div>
            <div class="hip-kv"><span class="k">+72h Margin</span><span class="v">${sd?.forecast?.margin_p50 != null ? `${sd.forecast.margin_p50 >= 0 ? "+" : ""}${sd.forecast.margin_p50.toFixed(3)} m` : "—"}</span></div>
            <div class="hip-kv"><span class="k">Exceedance P</span><span class="v">${sd?.forecast?.exceedance_prob_pct != null ? sd.forecast.exceedance_prob_pct + "%" : "—"}</span></div>
            <div class="hip-kv"><span class="k">Ensemble</span><span class="v" style="font-size:9px">${ensStr}</span></div>
          </div>
        </div>` : `<div class="hip-hint">Click any point on the river to select a station.</div>`}
        <div class="hip-prov-row" style="margin-top:12px">Charts view shows the three NadiTwin graphs only (discharge profile · stage profile · hydrograph).</div>
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
    const d = await getDischargeSeries(_currentChainage, { pastHours: _mode === "historic" ? _histLookbackH : 24 });
    const stLabel = d.station_label ?? _fmt(_currentChainage);

    const allQ = [...d.observed.q, ...d.forecast.q90].filter(Number.isFinite);
    const qMin = 0;
    const qMax = Math.max(...allQ, 100) * 1.12;

    const L = svgLayout({ W: 1280, H: 480, padL: 58, padR: 20, padT: 28, padB: 48 });
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
          ${legendItem(C.observed, "Past Q (NADITWIN · MODELLED)")}
          ${legendItem(C.forecast, "Forecast P50 (NADITWIN)", true)}
          ${legendItem(C.ok, "P10–P90 (NADITWIN)")}
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
          Past: <strong>${d.provenance.dataClassPast || "HISTORICAL · MODELLED"}</strong> ·
          Forecast: <strong>${d.provenance.dataClassForecast || "FORECAST · MODELLED"}</strong> ·
          <span style="color:${C.warn}">${d.provenance.note}</span>
        </div>
      </div>`;

    const nObs = d.observed.hours.length;
    const nFc = d.forecast.hours.length;
    attachChartHover(contentArea.querySelector(".hip-svg-wrap svg"), {
      L, xs: allHours, scX, scY, unit: "m³/s", decimals: 1,
      subtitle: `CH ${stLabel} · NadiTwin LIVE`,
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
    const d = await getRiverStageSeries(24, { ensureMeters: _currentChainage });

    if (!d?.chainage_m?.length) {
      contentArea.innerHTML = `<div class="hip-error">River stage data unavailable</div>`;
      return;
    }

    const maxCh = d.chainage_m[d.chainage_m.length - 1];
    const allY = [
      ...d.wse_now,
      ...d.forecast_p90,
      ...d.bed,
      ...(d.crest || []),
      ...(d.danger || []),
      ...(d.warning || []),
      ...(d.watch || []),
    ].filter(Number.isFinite);
    const yMin = Math.min(...allY) - 0.1;
    const yMax = Math.max(...allY) + 0.15;

    const L = svgLayout({ W: 1280, H: 500, padL: 58, padR: 20, padT: 28, padB: 48 });
    const scX = scaleLinear([0, maxCh / 1000], [L.padL, L.padL + L.plotW]);
    const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
    const chKm = d.chainage_m.map((m) => m / 1000);

    const wseNowPath  = svgPath(chKm, d.wse_now,      scX, scY);
    const p50Path     = svgPath(chKm, d.forecast_p50, scX, scY);
    const bedPath     = svgPath(chKm, d.bed,           scX, scY);
    const crestPath   = d.crest ? svgPath(chKm, d.crest, scX, scY) : "";
    const dangerPath  = d.danger ? svgPath(chKm, d.danger, scX, scY) : "";
    const warningPath = d.warning ? svgPath(chKm, d.warning, scX, scY) : "";
    const watchPath   = d.watch ? svgPath(chKm, d.watch, scX, scY) : "";
    const band        = svgBand(chKm, d.forecast_p10,  d.forecast_p90, scX, scY);
    const tks         = yAxisTicks(yMin, yMax, 4);

    // Active station marker — nearest kept chainage (same cell as NadiTwin hover)
    let activeMkr = "";
    if (_currentChainage != null) {
      const ni = nearestChainageIndex(d.chainage_m, _currentChainage);
      const markerCh = ni >= 0 ? d.chainage_m[ni] : _currentChainage;
      const ax = scX(markerCh / 1000).toFixed(1);
      const ay = scY(Number.isFinite(d.wse_now[ni]) ? d.wse_now[ni] : yMin).toFixed(1);
      activeMkr = `
        <line x1="${ax}" y1="${L.padT}" x2="${ax}" y2="${L.padT + L.plotH}"
              stroke="${C.active}" stroke-width="2" stroke-dasharray="4,4"/>
        <circle cx="${ax}" cy="${ay}" r="4" fill="${C.active}"/>
        <text x="${ax}" y="${L.padT - 8}" fill="${C.active}" font-size="9" text-anchor="middle" font-weight="600">
          CH ${_fmt(markerCh)}
        </text>`;
    }

    // X ticks at 0, 4, 8, 12 km and the river end
    const xTkSvg = [0, 4, 8, 12, +(maxCh / 1000).toFixed(2)].map((km) => {
      const px = scX(km).toFixed(1);
      return `<line x1="${px}" y1="${L.padT + L.plotH}" x2="${px}" y2="${L.padT + L.plotH + 5}" stroke="${C.axis}" stroke-width="1"/>
              <text x="${px}" y="${L.padT + L.plotH + 14}" fill="${C.muted}" font-size="9" text-anchor="middle">${km}</text>`;
    }).join("");

    contentArea.innerHTML = `
      <div class="hip-graph-section">
        <div class="hip-graph-title">River Stage — Sangam → Downstream <span class="hip-sub">NadiTwin LIVE</span></div>
        <div class="hip-legend">
          ${legendItem(C.wse, "River stage now (NADITWIN LIVE)")}
          ${legendItem(C.forecast, "Forecast P50 +24h (NADITWIN)", true)}
          ${legendItem(C.bed, "River bed (NADITWIN)")}
          ${d.crest ? legendItem(C.crest, "Bank crest (NADITWIN)", true) : ""}
          ${d.danger ? legendItem(C.danger, "Danger (crest − freeboard)", true) : ""}
          ${d.warning ? legendItem(C.warning, "Warning", true) : ""}
          ${d.watch ? legendItem(C.watch, "Watch", true) : ""}
        </div>
        <div class="hip-svg-wrap">
          <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
            ${axisFrame(L)}
            ${yTicks(L, tks, scY, 2)}
            ${xTkSvg}
            <path d="${band}" fill="${C.p10p90}"/>
            <path d="${bedPath}" fill="none" stroke="${C.bed}" stroke-width="1.5"/>
            ${crestPath ? `<path d="${crestPath}" fill="none" stroke="${C.crest}" stroke-width="1.4" stroke-dasharray="2,3"/>` : ""}
            ${dangerPath ? `<path d="${dangerPath}" fill="none" stroke="${C.danger}" stroke-width="1.3" stroke-dasharray="6,3"/>` : ""}
            ${warningPath ? `<path d="${warningPath}" fill="none" stroke="${C.warning}" stroke-width="1.2" stroke-dasharray="5,3"/>` : ""}
            ${watchPath ? `<path d="${watchPath}" fill="none" stroke="${C.watch}" stroke-width="1.1" stroke-dasharray="4,3"/>` : ""}
            <path d="${wseNowPath}" fill="none" stroke="${C.wse}" stroke-width="2"/>
            <path d="${p50Path}" fill="none" stroke="${C.forecast}" stroke-width="1.5" stroke-dasharray="6,3"/>
            ${activeMkr}
            ${yLabel(L, "Level (m WSE · relative)")}
            ${xLabel(L, "Chainage (km)")}
          </svg>
        </div>
        <div class="hip-prov-row">
          WSE: <strong>${d.provenance.wse_now}</strong> ·
          Bed: <strong>${d.provenance.bed}</strong> ·
          Forecast: <strong>${d.provenance.forecast}</strong> ·
          Datum: <strong style="color:#ff4d4f">RELATIVE · UNVERIFIED</strong> ·
          Levels: <strong>${d.provenance.threshold || "N/A"}</strong> ·
          <span style="color:${C.warn}">${d.provenance.note}</span>
        </div>
      </div>`;

    const hoverSeries = [
      { label: "River stage now", color: C.wse, ys: d.wse_now },
      { label: "River bed", color: C.bed, ys: d.bed },
      { label: "Forecast P50", color: C.forecast, ys: d.forecast_p50 },
    ];
    if (d.watch) hoverSeries.push({ label: "Watch level", color: C.watch, ys: d.watch, dot: false });
    if (d.warning) hoverSeries.push({ label: "Warning level", color: C.warning, ys: d.warning, dot: false });
    if (d.danger) hoverSeries.push({ label: "Danger level", color: C.danger, ys: d.danger, dot: false });
    if (d.crest) hoverSeries.push({ label: "Bank crest", color: C.crest, ys: d.crest, dot: false });

    attachChartHover(contentArea.querySelector(".hip-svg-wrap svg"), {
      L, xs: chKm, scX, scY, unit: "m", decimals: 2,
      subtitle: "River stage · NadiTwin LIVE · relative WSE",
      fmtX: (km) => `${_fmt(km * 1000)}`,
      series: hoverSeries,
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
    const d = await getHydrograph(_currentChainage, { pastHours: _chartPastHours() });

    if (!d.observed?.wse?.length && !d.forecast?.p50?.length) {
      contentArea.innerHTML = `<div class="hip-error">Hydrograph unavailable from digital twin</div>`;
      return;
    }
    const thr = Number.isFinite(d.threshold_m) ? d.threshold_m : null;
    const allWSE = [...d.observed.wse, ...d.forecast.p90, ...(thr != null ? [thr] : [])].filter(Number.isFinite);
    const yMin = Math.min(...allWSE) - 0.05;
    const yMax = Math.max(...allWSE) + 0.15;

    const L = svgLayout({ W: 1280, H: 480, padL: 58, padR: 20, padT: 28, padB: 48 });
    const allH = [...d.observed.hours, ...d.forecast.hours];
    const scX  = scaleLinear([allH[0], allH[allH.length - 1]], [L.padL, L.padL + L.plotW]);
    const scY  = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
    const tks  = yAxisTicks(yMin, yMax, 4);

    const lastObs = d.observed.wse[d.observed.wse.length - 1];
    const obsPath = svgPath(d.observed.hours, d.observed.wse, scX, scY);
    const p50Path = svgPath(
      Number.isFinite(lastObs) ? [0, ...d.forecast.hours] : d.forecast.hours,
      Number.isFinite(lastObs) ? [lastObs, ...d.forecast.p50] : d.forecast.p50,
      scX, scY,
    );
    const band = svgBand(
      Number.isFinite(lastObs) ? [0, ...d.forecast.hours] : d.forecast.hours,
      Number.isFinite(lastObs) ? [lastObs, ...d.forecast.p10] : d.forecast.p10,
      Number.isFinite(lastObs) ? [lastObs, ...d.forecast.p90] : d.forecast.p90,
      scX, scY,
    );
    const thrY = thr != null ? scY(thr).toFixed(1) : null;
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
        <div class="hip-graph-title">Hydrograph at CH ${d.station_label} <span class="hip-sub">past ${_chartPastHours()}h · HISTORICAL · MODELLED + FORECAST</span></div>
        <div class="hip-legend">
          ${legendItem(C.observed, "Historical WSE (MODELLED)")}
          ${legendItem(C.forecast, "Forecast P50", true)}
          ${legendItem(C.ok, "Forecast P10–P90")}
          ${thr != null ? legendItem(C.threshold, "Warning level", true) : ""}
        </div>
        <div class="hip-svg-wrap">
          <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
            ${axisFrame(L)}
            ${yTicks(L, tks, scY, 3)}
            ${xTkSvg}
            <line x1="${nowX}" y1="${L.padT}" x2="${nowX}" y2="${L.padT + L.plotH}"
                  stroke="${C.axis}" stroke-dasharray="4,4"/>
            <path d="${band}" fill="${C.p10p90}"/>
            ${thrY != null ? `
            <line x1="${L.padL}" y1="${thrY}" x2="${L.padL + L.plotW}" y2="${thrY}"
                  stroke="${C.threshold}" stroke-width="1.5" stroke-dasharray="5,3"/>
            <text x="${L.padL + L.plotW - 4}" y="${parseFloat(thrY) - 4}"
                  fill="${C.threshold}" font-size="9" text-anchor="end">Warn ${thr.toFixed(2)} m</text>` : ""}
            <path d="${obsPath}" fill="none" stroke="${C.observed}" stroke-width="2"/>
            <path d="${p50Path}" fill="none" stroke="${C.forecast}" stroke-width="2" stroke-dasharray="6,3"/>
            ${yLabel(L, "Relative WSE (m)")}
            ${xLabel(L, "Hours relative to now")}
          </svg>
        </div>
        <div class="hip-prov-row">
          Past: <strong>${d.provenance.dataClassPast || "HISTORICAL · MODELLED"}</strong> ·
          Forecast: <strong>${d.provenance.dataClassForecast || "FORECAST · NADITWIN"}</strong> ·
          Threshold: <strong>${d.provenance.threshold || "N/A"}</strong> ·
          Datum: <strong style="color:#ff4d4f">RELATIVE · UNVERIFIED</strong> ·
          <span style="color:${C.warn}">${d.provenance.note}</span>
        </div>
      </div>`;

    const nObs = d.observed.hours.length;
    const nFc = d.forecast.hours.length;
    const series = [
      { label: "Past WSE", color: C.observed, ys: padSeries(0, d.observed.wse, nFc) },
      { label: "Forecast P50", color: C.forecast, ys: padSeries(nObs, d.forecast.p50) },
      { label: "P90", color: C.ok, ys: padSeries(nObs, d.forecast.p90), dot: false },
      { label: "P10", color: C.ok, ys: padSeries(nObs, d.forecast.p10), dot: false },
    ];
    if (thr != null) series.push({ label: "Warn level", color: C.threshold, ys: allH.map(() => thr), dot: false });
    attachChartHover(contentArea.querySelector(".hip-svg-wrap svg"), {
      L, xs: allH, scX, scY, unit: "m", decimals: 3,
      subtitle: `CH ${d.station_label} · NadiTwin LIVE`,
      fmtX: (h) => (h === 0 ? "NOW" : `${h > 0 ? "+" : ""}${h}h`),
      series,
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
    const thr     = Number.isFinite(c?.threshold_m) ? c.threshold_m : null;
    const margin  = c?.margin_m;
    const wse72   = f?.wse_p50_m;
    const m72     = f?.margin_p50;
    const sev     = c?.severity ?? "ok";
    const risk    = c?.risk ?? 0;

    const marginColor  = margin == null ? C.muted : margin <= 0 ? C.critical : margin <= WARN_MARGIN_M ? C.warn : C.ok;
    const m72Color     = m72 == null    ? C.muted : m72 <= 0    ? C.critical : m72 <= WARN_MARGIN_M    ? C.warn : C.ok;

    // Relative WSE can be negative — scale from data, do not clamp to 0 / CLASS_DEFAULT 2.0
    const L = svgLayout({ W: 1280, H: 460, padL: 58, padR: 20, padT: 28, padB: 48 });
    const vals = [wseNow, wse72, thr].filter(Number.isFinite);
    if (!vals.length) {
      contentArea.innerHTML = `<div class="hip-error">Threshold chart unavailable — no NadiTwin WSE</div>`;
      return;
    }
    const yMin = Math.min(...vals) - 0.3;
    const yMax = Math.max(...vals) + 0.3;
    const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
    const tks = yAxisTicks(yMin, yMax, 4);
    const barW = L.plotW * 0.20;
    const gap  = L.plotW * 0.16;
    const startX = L.padL + (L.plotW - 2 * barW - gap) / 2;
    const thrY = thr != null ? scY(thr).toFixed(1) : null;
    const zeroY = scY(Math.max(yMin, Math.min(yMax, 0))).toFixed(1);
    const SC = { ok: C.ok, warn: C.warn, critical: C.critical };

    function barRect(x, value, fill, label, title) {
      if (!Number.isFinite(value)) return "";
      const yVal = scY(value);
      const y0 = parseFloat(zeroY);
      const top = Math.min(yVal, y0);
      const h = Math.abs(yVal - y0);
      return `
      <rect x="${x}" y="${top.toFixed(1)}" width="${barW}" height="${Math.max(2, h).toFixed(1)}"
            fill="${fill}" opacity="0.75" rx="2" class="hip-bar"><title>${title}</title></rect>
      <text x="${x + barW / 2}" y="${(yVal - 4).toFixed(1)}"
            fill="${fill}" font-size="10" text-anchor="middle" font-weight="600">${value.toFixed(3)} m</text>
      <text x="${x + barW / 2}" y="${L.padT + L.plotH + 16}"
            fill="${C.muted}" font-size="9" text-anchor="middle">${label}</text>`;
    }

    const bar1 = barRect(
      startX, wseNow, SC[sev], "WSE Now",
      `WSE now: ${wseNow?.toFixed?.(3)} m${thr != null ? ` · Warn ${thr.toFixed(2)} m` : ""}`,
    );
    const sev72 = m72 == null ? "ok" : m72 <= 0 ? "critical" : m72 <= WARN_MARGIN_M ? "warn" : "ok";
    const bar2x = startX + barW + gap;
    const bar2 = barRect(
      bar2x, wse72, SC[sev72], "+72h (P50)",
      `+72h P50: ${wse72?.toFixed?.(3)} m`,
    );

    const annX = startX + barW + gap / 2;
    const annWSEY = wseNow != null ? scY(wseNow).toFixed(1) : null;
    const marginAnn = thrY != null && annWSEY != null ? `
      <line x1="${annX}" y1="${thrY}" x2="${annX}" y2="${annWSEY}"
            stroke="${C.axis}" stroke-dasharray="2,2"/>
      <text x="${annX + 6}" y="${((parseFloat(annWSEY) + parseFloat(thrY)) / 2).toFixed(1)}"
            fill="${C.muted}" font-size="9">${margin >= 0 ? "+" : ""}${(margin ?? 0).toFixed(3)} m</text>` : "";

    contentArea.innerHTML = `
      <div class="hip-graph-section">
        <div class="hip-graph-title">Threshold Status — CH ${sd.station_label} <span class="hip-sub">NadiTwin</span></div>
        <div class="hip-legend">
          ${legendItem(SC[sev], "Relative WSE Now (NADITWIN LIVE)")}
          ${legendItem(SC[sev72] ?? C.ok, "+72h P50 (NADITWIN)")}
          ${thr != null ? legendItem(C.threshold, "Warning level (NADITWIN)", true) : ""}
        </div>
        <div class="hip-svg-wrap">
          <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
            ${axisFrame(L)}
            ${yTicks(L, tks, scY, 2)}
            ${bar1}${bar2}
            ${thrY != null ? `
            <line x1="${L.padL}" y1="${thrY}" x2="${L.padL + L.plotW}" y2="${thrY}"
                  stroke="${C.threshold}" stroke-width="2" stroke-dasharray="6,3"/>
            <text x="${L.padL + L.plotW - 4}" y="${parseFloat(thrY) - 5}"
                  fill="${C.threshold}" font-size="9" text-anchor="end">Warn ${thr.toFixed(2)} m</text>` : ""}
            ${marginAnn}
            ${yLabel(L, "Relative elevation (m)")}
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
          WSE: <strong>${prov?.wse ?? "MODELLED"}</strong> ·
          Threshold: <strong>${prov?.threshold ?? "CLASS_DEFAULT"}</strong> ·
          Forecast: <strong>${prov?.forecast ?? "MODELLED"}</strong>
        </div>
      </div>`;

    const barCenters = [startX + barW / 2, bar2x + barW / 2];
    const thrYs = thr != null ? [thr, thr] : null;
    attachChartHover(contentArea.querySelector(".hip-svg-wrap svg"), {
      L,
      xs: [0, 1],
      scX: (i) => barCenters[Math.round(i)] ?? barCenters[0],
      scY,
      unit: "m",
      decimals: 3,
      subtitle: "NadiTwin LIVE · hover bars for values",
      fmtX: (i) => (Math.round(i) === 0 ? "WSE Now" : "+72h P50"),
      series: [
        {
          label: "Relative WSE",
          color: SC[sev],
          ys: [wseNow, wse72],
        },
        ...(thrYs
          ? [{ label: "Warn level", color: C.threshold, ys: thrYs, dot: false }]
          : []),
        {
          label: "Margin",
          color: marginColor,
          ys: [margin, m72],
          unit: "m",
          dot: false,
          fmt: (v) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(3)} m` : "—"),
        },
      ],
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 5: FORECAST ENSEMBLE
  // ─────────────────────────────────────────────────────────────────────────
  async function _renderForecast() {
    if (_currentChainage == null) {
      contentArea.innerHTML = `<div class="hip-hint">Select a station to view NadiTwin forecast.</div>`;
      return;
    }
    contentArea.innerHTML = `<div class="hip-loading">Loading NadiTwin forecast…</div>`;
    const d = await getEnsembleForecast(_currentChainage);

    if (!d.hours?.length) {
      contentArea.innerHTML = `<div class="hip-error">Forecast unavailable from digital twin</div>`;
      return;
    }

    const thr = Number.isFinite(d.threshold_m) ? d.threshold_m : null;
    const hasQ = (d.q50 || []).some(Number.isFinite);
    // Prefer discharge when WSE band is nearly flat (common in dry twin states)
    const wseVals = [...(d.p10 || []), ...(d.p90 || [])].filter(Number.isFinite);
    const wseSpan = wseVals.length ? Math.max(...wseVals) - Math.min(...wseVals) : 0;
    const showQ = hasQ && (wseSpan < 0.05 || !(d.p50 || []).some(Number.isFinite));
    const seriesLo = showQ ? d.q10 : d.p10;
    const seriesHi = showQ ? d.q90 : d.p90;
    const seriesMid = showQ ? d.q50 : d.p50;
    const unit = showQ ? "m³/s" : "m";
    const yLabelTxt = showQ ? "Discharge (m³/s)" : "Relative WSE (m)";

    const bandVals = [...seriesLo, ...seriesHi, ...(showQ ? [] : [])].filter(Number.isFinite);
    // Zoom to forecast band — do NOT stretch axis to distant warn level
    const pad = showQ ? 0.15 : Math.max(0.02, wseSpan * 0.35 || 0.05);
    let yMin = Math.min(...bandVals) - pad;
    let yMax = Math.max(...bandVals) + pad;
    if (yMax - yMin < (showQ ? 0.5 : 0.08)) {
      const mid = (yMin + yMax) / 2;
      yMin = mid - (showQ ? 0.4 : 0.06);
      yMax = mid + (showQ ? 0.4 : 0.06);
    }
    const thrInView =
      thr != null && !showQ && thr >= yMin - pad && thr <= yMax + pad;

    const L = svgLayout({ W: 1280, H: 480, padL: 58, padR: 20, padT: 28, padB: 48 });
    const scX = scaleLinear([d.hours[0], d.hours[d.hours.length - 1]], [L.padL, L.padL + L.plotW]);
    const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
    const tks = yAxisTicks(yMin, yMax, 4);
    const p50Path = svgPath(d.hours, seriesMid, scX, scY);
    const band = svgBand(d.hours, seriesLo, seriesHi, scX, scY);
    const thrY = thrInView ? scY(thr).toFixed(1) : null;

    const xTkSvg = [1, 12, 24, 36, 48, 60, 72].map((h) => {
      if (h > d.hours[d.hours.length - 1]) return "";
      const px = scX(h).toFixed(1);
      return `<line x1="${px}" y1="${L.padT + L.plotH}" x2="${px}" y2="${L.padT + L.plotH + 5}" stroke="${C.axis}" stroke-width="1"/>
              <text x="${px}" y="${L.padT + L.plotH + 14}" fill="${C.muted}" font-size="9" text-anchor="middle">+${h}h</text>`;
    }).join("");

    const warnChip =
      thr != null
        ? `<div class="hip-kv-grid" style="margin:8px 0 4px">
            <div class="hip-kv"><span class="k">LIVE Q</span><span class="v">${_val(d.live_q, "m³/s")}</span></div>
            <div class="hip-kv"><span class="k">LIVE WSE</span><span class="v">${_val(d.live_wse, "m")}</span></div>
            <div class="hip-kv"><span class="k">Warn level</span><span class="v" style="color:${C.threshold}">${thr.toFixed(2)} m</span></div>
            <div class="hip-kv"><span class="k">Margin to warn</span><span class="v">${d.warn_margin_m != null ? `${d.warn_margin_m >= 0 ? "+" : ""}${d.warn_margin_m.toFixed(3)} m` : "—"}</span></div>
          </div>`
        : "";

    contentArea.innerHTML = `
      <div class="hip-graph-section">
        <div class="hip-graph-title">
          Forecast — CH ${d.station_label}
          <span class="hip-sub">NADITWIN LIVE · ${showQ ? "Discharge" : "WSE"} P10/P50/P90 · ${d.horizon_h}h</span>
        </div>
        ${warnChip}
        <div class="hip-legend">
          ${legendItem(C.forecast, `P50 ${showQ ? "Q" : "WSE"} (NADITWIN FORECAST)`, true)}
          ${legendItem(C.ok, "P10–P90 (NADITWIN)")}
          ${thrInView ? legendItem(C.threshold, "Warning level (NADITWIN)", true) : ""}
        </div>
        <div class="hip-svg-wrap">
          <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
            ${axisFrame(L)}
            ${yTicks(L, tks, scY, showQ ? 2 : 3)}
            ${xTkSvg}
            <path d="${band}" fill="${C.p10p90}"/>
            ${thrY != null ? `
            <line x1="${L.padL}" y1="${thrY}" x2="${L.padL + L.plotW}" y2="${thrY}"
                  stroke="${C.threshold}" stroke-width="1.5" stroke-dasharray="5,3"/>
            <text x="${L.padL + L.plotW - 4}" y="${parseFloat(thrY) - 4}"
                  fill="${C.threshold}" font-size="9" text-anchor="end">Warn ${thr.toFixed(2)} m</text>` : ""}
            <path d="${p50Path}" fill="none" stroke="${C.forecast}" stroke-width="2" stroke-dasharray="6,3"/>
            ${yLabel(L, yLabelTxt)}
            ${xLabel(L, "Hours relative to now")}
          </svg>
        </div>
        <div class="hip-prov-row">${d.provenance?.note || "NadiTwin forecast"}${!thrInView && thr != null ? " · Warn level shown as margin (outside plot scale)" : ""}</div>
      </div>`;

    attachChartHover(contentArea.querySelector(".hip-svg-wrap svg"), {
      L, xs: d.hours, scX, scY, unit, decimals: showQ ? 2 : 3,
      subtitle: `CH ${d.station_label} · NADITWIN FORECAST · ${showQ ? "Discharge" : "WSE"}`,
      fmtX: (h) => `+${h}h`,
      series: [
        { label: `P50 ${showQ ? "Q" : "WSE"}`, color: C.forecast, ys: seriesMid },
        { label: "P90", color: C.ok, ys: seriesHi },
        { label: "P10", color: C.ok, ys: seriesLo },
        ...(thrInView
          ? [{ label: "Warn level", color: C.threshold, ys: d.hours.map(() => thr), dot: false }]
          : []),
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
        </div>`;
    }).join("");

    contentArea.innerHTML = `
      <div class="hip-graph-section">
        <div class="hip-graph-title">Active Alerts <span class="hip-sub">${alerts.length} active</span></div>
        <div class="hip-alerts-list">${rows}</div>
        <div class="hip-prov-row">Alert basis: <strong>NADITWIN LIVE</strong> · Thresholds: <strong>NADITWIN levels (relative)</strong> · Safety boards: <strong>LOCKED</strong></div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB 7: MARGIN BOARD
  // ─────────────────────────────────────────────────────────────────────────
  async function _renderMarginBoard() {
    contentArea.innerHTML = `<div class="hip-loading">Loading NadiTwin margins…</div>`;
    const assets = await getMarginBoard();

    if (!assets.length) {
      contentArea.innerHTML = `<div class="hip-hint">No NadiTwin margin rows available</div>`;
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
        <div class="hip-graph-title">Margin Board — NadiTwin LIVE</div>
        <div class="hip-mb-header">
          <span>Asset</span><span>CH</span><span>Risk bar</span>
          <span>Margin</span><span>+72h</span><span>P(exceed)</span><span>Risk</span>
        </div>
        <div class="hip-mb-body">${rows}</div>
        <div class="hip-prov-row">
          WSE: <strong>NADITWIN LIVE</strong> · Threshold: <strong>NADITWIN levels</strong> · Forecast: <strong>NADITWIN</strong> · Safety: <strong>LOCKED</strong>
        </div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helper: populate station custom dropdown from landmarks
  // ─────────────────────────────────────────────────────────────────────────
  function _stationsForStretch() {
    const stretch = _currentStretch();
    const from = Number(stretch.from_m) || 0;
    const to = Number(stretch.to_m) || 1e9;
    const list = (_landmarks || []).filter((lm) => {
      const m = Number(lm.chainage_m);
      if (stretch.id === "ALL") return true;
      return Number.isFinite(m) && m >= from - 50 && m <= to + 50;
    });
    return list.length ? list : (_landmarks || []);
  }

  function _rebuildStationDropdown() {
    _stationOptions = [{ value: "", label: "— Select station —" }];
    _stationsForStretch().forEach((lm) => {
      _stationOptions.push({
        value: String(lm.chainage_m),
        label: `${lm.name} (CH ${_fmt(lm.chainage_m)})`,
      });
    });
    _buildCustomDropdown(
      "hip-station-trigger", "hip-station-menu", "hip-station-label",
      _stationOptions,
      (val) => {
        const m = parseFloat(val);
        if (!Number.isFinite(m)) return;
        _currentChainage = m;
        state.selectedChainageMeters = m;
        document.dispatchEvent(new CustomEvent("chainage-select",
          { detail: { meters: m, focus: true, source: "hydro-intel-panel" } }));
        _loadAndRender();
      },
    );
  }

  async function _populateStationDropdown() {
    try {
      const res = await fetch("/data/naditwin/landmarks.json", { signal: AbortSignal.timeout(4000) });
      if (res.ok) _landmarks = await res.json();
    } catch { /* silent */ }
    _rebuildStationDropdown();
  }

  async function _populateStretchDropdown() {
    const loc = await getLocationsSeries();
    _locations = Array.isArray(loc.rows) ? loc.rows : [];
    const opts = [
      { value: "ALL", label: "All locations (Sangam → Manjari)" },
      ..._locations.map((r) => ({
        value: r.id,
        label: `${r.from_name} → ${r.to_name} (${r.from_label}–${r.to_label})`,
      })),
    ];
    _buildCustomDropdown(
      "hip-stretch-trigger", "hip-stretch-menu", "hip-stretch-label",
      opts,
      (val) => {
        _stretchId = val || "ALL";
        const stretch = _currentStretch();
        // Representative station: stretch midpoint cell → meters
        const mid = Number.isFinite(stretch.cell)
          ? stretch.cell * 10
          : (Number(stretch.from_m) + Number(stretch.to_m)) / 2;
        if (Number.isFinite(mid)) {
          _currentChainage = mid;
          state.selectedChainageMeters = mid;
          document.dispatchEvent(new CustomEvent("chainage-select",
            { detail: { meters: mid, focus: true, source: "hydro-intel-panel" } }));
        }
        _rebuildStationDropdown();
        _syncStationDropdownLabel(_currentChainage);
        _updateCoverageStrip();
        _loadAndRender();
      },
    );
  }

  function _syncDropdown(meters) {
    _syncStationDropdownLabel(meters);
    _syncChainageInput(meters);
  }

  async function _ensureHistCoverage() {
    if (_histCoverage.ok) return _histCoverage;
    const meta = await getTimerangeMeta();
    _histCoverage = parseCoverage(meta);
    _histOptions = buildHistOptions(_histCoverage);
    _updateCoverageStrip();
    return _histCoverage;
  }

  function _onHydroHistChange(val) {
    _historicEventId = null;
    selectHistoricalEvent(null);
    _histSelection = resolveHistSelection(val, _histCoverage);
    _histLookbackH = _histSelection.hours || 72;
    _mode = "historic";
    modeLive?.classList.remove("active");
    modeHist?.classList.add("active");
    _updateCoverageStrip();
    // Reload hydrograph only — discharge/stage unchanged
    _renderCurrentTab({ only: "hydro" });
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
            <span class="hip-main-title">MULA–MUTHA CHARTS</span>
            <span class="hip-tag">NadiTwin · Discharge · Stage · Hydro</span>
            <span id="hip-station-badge" class="hip-badge">—</span>
            <span id="hip-status-badge" class="hip-badge hip-badge--status">—</span>
          </div>
          <button id="hip-close" class="hip-close-btn" aria-label="Close">${lucideHtml(X, { size: 16 })}</button>
        </div>
        <div class="hip-controls-row">
          <div class="hip-mode-btns">
            <button id="hip-mode-live" class="hip-mode-btn active" title="NadiTwin LIVE">LIVE</button>
            <button id="hip-mode-hist" class="hip-mode-btn" title="NadiTwin HISTORIC">HISTORIC</button>
          </div>
          <div id="hip-historic-controls" class="hip-historic-controls" hidden>
            <label class="hip-hist-field" title="Historical date (NadiTwin coverage)">
              <span>DATE</span>
              <input id="hip-hist-date" type="date" class="hip-hist-input" />
            </label>
            <label class="hip-hist-field" title="Historical hour (IST)">
              <span>TIME</span>
              <select id="hip-hist-time" class="hip-hist-input hip-hist-time"></select>
            </label>
            <div class="hip-hist-clock" id="hip-hist-clock" title="Historical simulation clock">—</div>
            <div class="hip-hist-stepper">
              <button type="button" id="hip-hist-prev" class="hip-hist-step-btn" title="Previous hour">−</button>
              <span id="hip-hist-step-label" class="hip-hist-step-label">STEP 1 h</span>
              <button type="button" id="hip-hist-next" class="hip-hist-step-btn" title="Next hour">+</button>
            </div>
          </div>
          <div class="hip-custom-select hip-custom-select--stretch" id="hip-stretch-dropdown">
            <div class="hip-custom-select__trigger" id="hip-stretch-trigger">
              <span id="hip-stretch-label">All locations (Sangam → Manjari)</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="flex-shrink:0"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div class="hip-custom-select__menu" id="hip-stretch-menu" hidden></div>
          </div>
          <div class="hip-custom-select hip-custom-select--station" id="hip-station-dropdown">
            <div class="hip-custom-select__trigger" id="hip-station-trigger">
              <span id="hip-station-label">— Select station —</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="flex-shrink:0"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div class="hip-custom-select__menu" id="hip-station-menu" hidden></div>
          </div>
          <label class="hip-chainage-ctrl" title="Precise chainage (secondary)">
            <span>CH</span>
            <input id="hip-chainage-input" class="hip-chainage-input" type="text" inputmode="numeric" placeholder="8+400" aria-label="Chainage km+m"/>
          </label>
          <button type="button" id="hip-margin-board-btn" class="hip-margin-board-btn" title="NadiTwin Margin Board">Margin Board</button>
        </div>
        <div id="hip-coverage" class="hip-coverage" aria-live="polite"></div>
      </div>
      <div id="hip-content" class="hip-content">
        <div class="hip-loading">Initializing NadiTwin three-graph charts…</div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STYLES
  // ─────────────────────────────────────────────────────────────────────────
  function _injectStyles() {
    let s = document.getElementById("hip-styles");
    if (!s) {
      s = document.createElement("style");
      s.id = "hip-styles";
      document.head.appendChild(s);
    }
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

/* Full-screen Charts — Profile Analysis dark neon look. */
.hydro-intel-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(2, 8, 14, 0.78);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 9000;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  padding: max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right))
    max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));
  box-sizing: border-box;
  overflow: hidden;
  pointer-events: auto;
}
.hydro-intel-backdrop[hidden] { display: none !important; }

.hydro-intel-panel {
  pointer-events: auto;
  position: relative;
  width: 100%;
  max-width: none;
  height: 100%;
  max-height: none;
  background: linear-gradient(165deg, rgba(18, 42, 54, 0.98), rgba(6, 18, 26, 0.97));
  backdrop-filter: blur(18px) saturate(130%);
  -webkit-backdrop-filter: blur(18px) saturate(130%);
  border: 1px solid rgba(140, 210, 228, 0.42);
  border-radius: 18px;
  box-shadow:
    0 32px 80px rgba(0, 0, 0, 0.65),
    0 0 0 1px rgba(91, 200, 232, 0.22),
    inset 0 1px 0 rgba(220, 245, 255, 0.16);
  display: flex;
  flex-direction: column;
  color: #eaf8fb;
  font-size: 13px;
  overflow: hidden;
  flex-shrink: 0;
  box-sizing: border-box;
}

.hip-header {
  background: transparent;
  border-bottom: 1px solid rgba(170, 225, 238, 0.12);
  flex-shrink: 0;
}
.hip-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 22px 8px;
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
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #dff8ff;
  white-space: nowrap;
}
.hip-tag {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: rgba(91, 200, 232, 0.18);
  border: 1px solid rgba(91, 200, 232, 0.35);
  color: #9fe7f6;
}
.hip-badge {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(91, 200, 232, 0.12);
  border: 1px solid rgba(91, 200, 232, 0.28);
  color: #b9f5ff;
  white-space: nowrap;
}
.hip-badge--status {
  background: rgba(93, 206, 160, 0.16);
  border-color: rgba(93, 206, 160, 0.35);
  color: #9af0c8;
}
.hip-close-btn {
  appearance: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(170, 225, 238, 0.3);
  color: #dff8ff;
  cursor: pointer;
  padding: 0;
  border-radius: 999px;
  flex-shrink: 0;
  line-height: 1;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.hip-close-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.6);
  color: #fecaca;
}

.hip-controls-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 22px 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.hip-mode-btns {
  display: flex;
  border: 1px solid rgba(91, 200, 232, 0.28);
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(3, 14, 22, 0.45);
}
.hip-historic-controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 8px;
  border-radius: 10px;
  border: 1px solid rgba(196, 181, 253, 0.35);
  background: rgba(76, 29, 149, 0.18);
}
.hip-historic-controls[hidden] { display: none !important; }
.hip-hist-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: rgba(220, 210, 255, 0.85);
}
.hip-hist-input {
  appearance: none;
  background: rgba(3, 14, 22, 0.75);
  border: 1px solid rgba(196, 181, 253, 0.4);
  color: #ffffff !important;
  -webkit-text-fill-color: #ffffff;
  color-scheme: dark;
  caret-color: #ffffff;
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 12px;
  font-weight: 600;
}
#hip-hist-date::-webkit-datetime-edit,
#hip-hist-date::-webkit-datetime-edit-fields-wrapper,
#hip-hist-date::-webkit-datetime-edit-text,
#hip-hist-date::-webkit-datetime-edit-month-field,
#hip-hist-date::-webkit-datetime-edit-day-field,
#hip-hist-date::-webkit-datetime-edit-year-field {
  color: #ffffff !important;
  -webkit-text-fill-color: #ffffff;
}
#hip-hist-date::-webkit-calendar-picker-indicator {
  /* Force the native glyph to solid white regardless of color-scheme */
  filter: brightness(0) invert(1);
  opacity: 1;
  cursor: pointer;
  width: 16px;
  height: 16px;
}
#hip-hist-time {
  color: #ffffff !important;
  -webkit-text-fill-color: #ffffff;
  appearance: none;
  -webkit-appearance: none;
  background-color: rgba(3, 14, 22, 0.75);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' fill='none' stroke='%23ffffff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 12px 12px;
  padding-right: 26px;
}
#hip-hist-time option {
  background: #12202a;
  color: #ffffff;
}
.hip-hist-time { min-width: 88px; }
.hip-hist-clock {
  font-size: 13px;
  font-weight: 800;
  color: #f5e9ff;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(124, 58, 237, 0.28);
  border: 1px solid rgba(196, 181, 253, 0.55);
  white-space: nowrap;
  letter-spacing: 0.02em;
  box-shadow: 0 0 0 1px rgba(196, 181, 253, 0.12);
}
.hip-hist-stepper { display: inline-flex; align-items: center; gap: 4px; }
.hip-hist-step-btn {
  width: 28px; height: 28px; border-radius: 8px;
  border: 1px solid rgba(196, 181, 253, 0.45);
  background: rgba(3, 14, 22, 0.7); color: #f3e8ff;
  font-size: 16px; font-weight: 700; cursor: pointer; line-height: 1;
}
.hip-hist-step-btn:hover { background: rgba(196, 181, 253, 0.2); }
.hip-hist-step-label {
  font-size: 10px; font-weight: 800; color: rgba(220, 210, 255, 0.8);
  letter-spacing: 0.04em; min-width: 58px; text-align: center;
}
.hip-margin-board-btn {
  appearance: none;
  border: 1px solid rgba(91, 200, 232, 0.45);
  background: rgba(91, 200, 232, 0.14);
  color: #dff8ff; border-radius: 9px; padding: 7px 12px;
  font-size: 11px; font-weight: 800; cursor: pointer; letter-spacing: 0.03em; flex-shrink: 0;
}
.hip-margin-board-btn:hover { background: rgba(91, 200, 232, 0.26); border-color: rgba(91, 200, 232, 0.7); }
.hip-margin-board {
  position: absolute; inset: 0; z-index: 20; display: flex;
  padding: 12px; background: rgba(2, 8, 14, 0.55); backdrop-filter: blur(6px);
}
.hip-margin-board[hidden] { display: none !important; }
.hip-margin-board__panel {
  flex: 1; min-height: 0; overflow: auto; border-radius: 16px;
  border: 1px solid rgba(170, 225, 238, 0.28);
  background: linear-gradient(165deg, rgba(18, 42, 54, 0.98), rgba(6, 18, 26, 0.98));
  padding: 12px 14px 18px; box-shadow: 0 24px 60px rgba(0,0,0,0.55);
}
.hip-margin-board__bar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: flex-start; margin-bottom: 10px; }
.hip-margin-board__title { font-size: 16px; font-weight: 800; color: #dff8ff; }
.hip-margin-board__disc { font-size: 11px; color: #fbbf24; font-weight: 700; margin-top: 2px; }
.hip-margin-board__actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.hip-margin-board__tabs { display: inline-flex; gap: 4px; }
.hip-mb-tab {
  appearance: none; border: 1px solid rgba(170, 225, 238, 0.28); background: transparent;
  color: rgba(210, 235, 242, 0.85); border-radius: 8px; padding: 6px 10px; font-size: 11px; font-weight: 700; cursor: pointer;
}
.hip-mb-tab.active { background: rgba(91, 200, 232, 0.2); border-color: rgba(91, 200, 232, 0.55); color: #dff8ff; }
.hip-margin-board__meta { font-size: 11px; color: rgba(190, 220, 230, 0.78); margin-bottom: 10px; line-height: 1.45; }
.hip-margin-board__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  align-items: stretch;
}
@media (max-width: 1400px) { .hip-margin-board__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 780px) { .hip-margin-board__grid { grid-template-columns: 1fr; } }
/* Full-bleed status colour cards — NadiTwin status drives colour; not engineering-verified */
.hip-mb-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 12px;
  border: 1.5px solid rgba(170, 225, 238, 0.22);
  background: #3a4550;
  padding: 10px 12px;
  min-width: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 6px 16px rgba(0, 0, 0, 0.22);
  color: #ffffff;
}
.hip-mb-card[data-status="danger"] {
  background: linear-gradient(165deg, #c53036 0%, #B3262D 55%, #9e1f25 100%);
  border-color: #FF6268;
}
.hip-mb-card[data-status="warning"] {
  background: linear-gradient(165deg, #e87820 0%, #D96B16 55%, #c25e12 100%);
  border-color: #FFAA45;
}
.hip-mb-card[data-status="watch"] {
  background: linear-gradient(165deg, #d4a91e 0%, #C99A16 55%, #b38912 100%);
  border-color: #F5CD48;
}
.hip-mb-card[data-status="safe"] {
  background: linear-gradient(165deg, #2a9452 0%, #238044 55%, #1c6b38 100%);
  border-color: #56C77A;
}
.hip-mb-card[data-status="na"],
.hip-mb-card[data-status="unverified"] {
  background: linear-gradient(165deg, #5a6570 0%, #3a4550 55%, #2f3840 100%);
  border-color: #8a969f;
}
.hip-mb-card__head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.hip-mb-card__name { font-size: 13px; font-weight: 800; color: #ffffff; }
.hip-mb-card__range { font-size: 10.5px; color: rgba(255, 255, 255, 0.82); margin-top: 2px; }
.hip-mb-card__status {
  align-self: flex-start; flex-shrink: 0;
  font-size: 10px; font-weight: 900; letter-spacing: 0.04em;
  padding: 3px 8px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.88); color: #1a1a1a;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.hip-mb-card[data-status="danger"] .hip-mb-card__status {
  color: #7a1218; background: #ffd6d9; border-color: rgba(122, 18, 24, 0.18);
}
.hip-mb-card[data-status="warning"] .hip-mb-card__status {
  color: #8a3d08; background: #ffe4c2; border-color: rgba(138, 61, 8, 0.18);
}
.hip-mb-card[data-status="watch"] .hip-mb-card__status {
  color: #5c4708; background: #fff3c4; border-color: rgba(92, 71, 8, 0.18);
}
.hip-mb-card[data-status="safe"] .hip-mb-card__status {
  color: #0f4d28; background: #c8f0d6; border-color: rgba(15, 77, 40, 0.18);
}
.hip-mb-card[data-status="na"] .hip-mb-card__status,
.hip-mb-card[data-status="unverified"] .hip-mb-card__status {
  color: #2a3036; background: #d7dde6; border-color: rgba(42, 48, 54, 0.2);
}
.hip-mb-card__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 10px; flex: 1 1 auto; }
.hip-mb-card__grid span { display: block; font-size: 9.5px; color: rgba(255, 255, 255, 0.82); }
.hip-mb-card__grid b { display: block; font-size: 12px; color: #ffffff; font-weight: 700; }
.hip-mode-btn {
  background: transparent;
  border: none;
  color: rgba(200, 230, 238, 0.72);
  padding: 6px 14px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 0.05em;
  transition: background 0.15s, color 0.15s;
}
.hip-mode-btn:hover:not(.active) {
  background: rgba(91, 200, 232, 0.12);
  color: #dff8ff;
}
.hip-mode-btn.active {
  background: rgba(91, 200, 232, 0.28);
  color: #ffffff;
}
.hip-select {
  background: rgba(3, 14, 22, 0.55);
  border: 1px solid rgba(170, 225, 238, 0.22);
  color: #eaf8fb;
  padding: 5px 8px;
  border-radius: 8px;
  font-size: 11px;
  min-width: 0;
  flex: 1;
  max-width: 240px;
}
.hip-hist-wrap { flex: 1; min-width: 0; max-width: 260px; }
.hip-custom-range {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.hip-date-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: rgba(190, 220, 230, 0.78);
}
.hip-date-field input {
  background: rgba(3, 14, 22, 0.55);
  border: 1px solid rgba(170, 225, 238, 0.22);
  color: #eaf8fb;
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 11px;
}
.hip-hist-apply {
  appearance: none;
  border: 1px solid rgba(91, 200, 232, 0.4);
  background: rgba(91, 200, 232, 0.18);
  color: #dff8ff;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.hip-hist-apply:hover { background: rgba(91, 200, 232, 0.28); }
.hip-coverage {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 6px 22px 8px;
  font-size: 10.5px;
  color: rgba(190, 220, 230, 0.78);
  border-top: 1px solid rgba(170, 225, 238, 0.08);
}
.hip-coverage b { color: #b9f5ff; font-weight: 700; }
.hip-coverage .hip-fresh { margin-left: auto; color: #9fe7f6; }
.hip-coverage--historic {
  border-top-color: rgba(196, 181, 253, 0.22);
  background: linear-gradient(180deg, rgba(76, 29, 149, 0.12), transparent);
}
.hip-cov-selected {
  color: #f3e8ff !important;
  font-size: 12px;
  font-weight: 700;
}
.hip-cov-selected b { color: #e9d5ff !important; }
.hip-cat-row {
  display: flex;
  gap: 4px;
  padding: 4px 14px 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.hip-cat-row::-webkit-scrollbar { display: none; }
.hip-cat {
  appearance: none;
  border: 1px solid rgba(170, 225, 238, 0.18);
  background: rgba(3, 14, 22, 0.35);
  color: rgba(190, 220, 230, 0.72);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  cursor: pointer;
  white-space: nowrap;
}
.hip-cat:hover { color: #dff8ff; border-color: rgba(91, 200, 232, 0.4); }
.hip-cat.active {
  color: #041018;
  background: #5bc8e8;
  border-color: #5bc8e8;
}
.hip-dd-item.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
  font-style: italic;
}
.hip-banner-warn {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(232, 161, 61, 0.45);
  background: rgba(232, 161, 61, 0.12);
  color: #f6d59a;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
}
.hip-kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 1200px) {
  .hip-kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 860px) {
  .hip-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .hip-kpi-grid { grid-template-columns: 1fr; }
}
.hip-kpi-card {
  background: rgba(3, 14, 22, 0.55);
  border: 1px solid rgba(170, 225, 238, 0.16);
  border-radius: 12px;
  padding: 14px 14px 12px;
  min-height: 128px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hip-kpi-card.is-warn { border-color: rgba(232, 161, 61, 0.45); }
.hip-kpi-label {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(190, 220, 230, 0.7);
}
.hip-kpi-value {
  font-size: 22px;
  font-weight: 800;
  color: #ffffff;
  line-height: 1.15;
  word-break: break-word;
}
.hip-kpi-unit {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(190, 220, 230, 0.7);
}
.hip-kpi-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(190, 220, 230, 0.68);
}
.hip-score-source {
  margin-top: 4px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(170, 225, 238, 0.14);
  background: rgba(3, 14, 22, 0.45);
}
.hip-score-source strong { color: #9fe7f6; font-size: 11px; letter-spacing: 0.04em; }
.hip-score-source p {
  margin: 6px 0 0;
  font-size: 11.5px;
  line-height: 1.55;
  color: rgba(200, 230, 238, 0.82);
  white-space: normal;
  overflow-wrap: anywhere;
}

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
  background: rgba(3, 14, 22, 0.55);
  border: 1px solid rgba(170, 225, 238, 0.22);
  border-radius: 8px;
  color: #eaf8fb;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  white-space: nowrap;
  overflow: hidden;
}
.hip-custom-select__trigger:hover {
  background: rgba(91, 200, 232, 0.12);
  border-color: rgba(91, 200, 232, 0.55);
  box-shadow: 0 0 0 3px rgba(91, 200, 232, 0.12);
}
.hip-custom-select--open .hip-custom-select__trigger {
  background: rgba(91, 200, 232, 0.16);
  border-color: rgba(91, 200, 232, 0.6);
  color: #9fe7f6;
}
.hip-custom-select--open .hip-custom-select__trigger svg { transform: rotate(180deg); }
.hip-custom-select__trigger svg { transition: transform 0.2s; color: rgba(190, 220, 230, 0.7); }
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
  background: linear-gradient(165deg, rgba(18, 42, 54, 0.98), rgba(8, 22, 30, 0.98));
  border: 1px solid rgba(140, 210, 228, 0.35);
  border-radius: 10px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55);
  z-index: 99999;
  max-height: 260px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(91, 200, 232, 0.35) transparent;
}
.hip-custom-select__menu::-webkit-scrollbar { width: 5px; }
.hip-custom-select__menu::-webkit-scrollbar-thumb {
  background: rgba(91, 200, 232, 0.35);
  border-radius: 3px;
}
.hip-dd-item {
  padding: 8px 14px;
  font-size: 12px;
  color: #cfeaf0;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hip-dd-item:hover { background: rgba(91, 200, 232, 0.14); color: #9fe7f6; }
.hip-dd-item.active { background: rgba(91, 200, 232, 0.22); color: #dff8ff; font-weight: 700; }
.hip-dd-item--placeholder { color: rgba(180, 210, 220, 0.55); font-style: italic; font-size: 11px; }
.hip-dd-item--placeholder:hover { background: transparent; color: rgba(180, 210, 220, 0.55); }

.hip-tabs {
  display: flex;
  gap: 2px;
  padding: 0 14px;
  overflow-x: auto;
  scrollbar-width: none;
  border-top: 1px solid rgba(170, 225, 238, 0.1);
}
.hip-tabs::-webkit-scrollbar { display: none; }
.hip-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: rgba(190, 220, 230, 0.62);
  padding: 10px 12px;
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  letter-spacing: 0.05em;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  flex-shrink: 0;
  border-radius: 6px 6px 0 0;
}
.hip-tab:hover:not(.active) {
  color: #dff8ff;
  background: rgba(91, 200, 232, 0.08);
}
.hip-tab.active {
  color: #9fe7f6;
  border-bottom-color: #5bc8e8;
}

.hip-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 22px 22px;
  scrollbar-width: thin;
  scrollbar-color: rgba(91, 200, 232, 0.35) transparent;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.hip-content::-webkit-scrollbar { width: 6px; }
.hip-content::-webkit-scrollbar-thumb {
  background: rgba(91, 200, 232, 0.3);
  border-radius: 3px;
}
.hip-loading, .hip-hint, .hip-error, .hip-empty {
  color: rgba(190, 220, 230, 0.7);
  font-size: 13px;
  padding: 32px 0;
  text-align: center;
}
.hip-error { color: #ff8a8a; }
.hip-empty { color: #9af0c8; }

.hip-three {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  flex: 1 0 auto;
  min-height: 0;
}
.hip-three--expanded {
  flex: 1 1 auto;
  min-height: 0;
  gap: 8px;
}
.hip-three[data-expand="discharge"] #hip-g-stage,
.hip-three[data-expand="discharge"] #hip-g-hydro,
.hip-three[data-expand="stage"] #hip-g-discharge,
.hip-three[data-expand="stage"] #hip-g-hydro,
.hip-three[data-expand="hydro"] #hip-g-discharge,
.hip-three[data-expand="hydro"] #hip-g-stage {
  display: none !important;
}
.hip-three[data-expand] .hip-graph-section--focused {
  flex: 1 1 auto;
  min-height: 0;
}
.hip-expand-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 0 8px;
  padding: 6px 2px;
}
.hip-expand-bar[hidden] { display: none !important; }
.hip-expand-bar__btn {
  appearance: none;
  border: 1px solid rgba(91, 200, 232, 0.45);
  background: rgba(91, 200, 232, 0.14);
  color: #dff8ff;
  border-radius: 9px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 0.02em;
}
.hip-expand-bar__btn:hover {
  background: rgba(91, 200, 232, 0.24);
  border-color: rgba(91, 200, 232, 0.7);
}
.hip-expand-bar__btn--ghost {
  background: transparent;
  border-color: rgba(170, 225, 238, 0.28);
  color: rgba(210, 235, 242, 0.88);
}
.hip-live-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 6px 10px;
  margin-bottom: 6px;
  border-radius: 8px;
  border: 1px solid rgba(170, 225, 238, 0.16);
  background: rgba(3, 14, 22, 0.45);
  font-size: 10.5px;
  color: rgba(190, 220, 230, 0.78);
  flex-shrink: 0;
}
.hip-live-meta b { color: #b9f5ff; }
.hip-live-meta--historic {
  border-color: rgba(196, 181, 253, 0.28);
  background: rgba(40, 20, 70, 0.35);
}
.hip-live-meta--historic .hip-meta-selected {
  color: #f3e8ff;
  font-size: 12px;
  font-weight: 700;
  width: 100%;
  margin-bottom: 2px;
}
.hip-live-meta--historic .hip-meta-selected b { color: #e9d5ff; }
.hip-graph-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 0 auto;
  min-height: 0;
  padding: 8px 10px 10px;
  border-radius: 14px;
  border: 1px solid rgba(170, 225, 238, 0.14);
  background: rgba(4, 16, 24, 0.35);
}
.hip-graph-section--focused {
  border-color: rgba(91, 200, 232, 0.4);
  background: rgba(4, 18, 28, 0.55);
}
.hip-graph-section--compact {
  min-height: 100px;
  max-height: 138px;
  padding: 6px 10px 8px;
  border-color: rgba(196, 181, 253, 0.22);
  background: rgba(20, 12, 36, 0.4);
}
.hip-graph-section--primary {
  border-color: rgba(91, 200, 232, 0.32);
  background: rgba(4, 20, 30, 0.5);
}
.hip-three--historic-compact #hip-g-hydro {
  flex: 1 1 auto;
}
.hip-avail {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: flex-start;
  justify-content: space-between;
  min-height: 64px;
  max-height: 100px;
  overflow: hidden;
  padding: 4px 2px 2px;
}
.hip-avail__main { flex: 1 1 220px; min-width: 0; }
.hip-avail__badge {
  display: inline-block;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #c4b5fd;
  border: 1px solid rgba(196, 181, 253, 0.4);
  border-radius: 6px;
  padding: 2px 7px;
  margin-bottom: 4px;
}
.hip-avail__msg {
  font-size: 12px;
  font-weight: 700;
  color: rgba(230, 220, 255, 0.92);
  line-height: 1.25;
}
.hip-avail__reason {
  font-size: 10px;
  color: rgba(196, 181, 253, 0.85);
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.hip-avail__detail {
  font-size: 10px;
  color: rgba(190, 220, 230, 0.65);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.hip-avail__note {
  font-size: 10px;
  color: rgba(190, 220, 230, 0.55);
  margin-top: 3px;
}
.hip-avail__station {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  flex: 0 1 auto;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid rgba(91, 200, 232, 0.28);
  background: rgba(3, 18, 28, 0.55);
}
.hip-avail__metric { display: flex; flex-direction: column; gap: 1px; min-width: 72px; }
.hip-avail__k { font-size: 9px; font-weight: 700; letter-spacing: 0.04em; color: rgba(190, 220, 230, 0.6); text-transform: uppercase; }
.hip-avail__v { font-size: 12px; font-weight: 700; color: #dff8ff; }
.hip-legend {
  display: flex !important;
  flex-wrap: wrap !important;
  overflow: visible;
  white-space: normal;
  max-height: none;
  margin: 0 !important;
  padding: 2px 0 4px !important;
  gap: 4px 8px !important;
  align-items: center;
}
.hip-graph-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.hip-graph-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: auto;
}
.hip-expand-btn {
  appearance: none;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid rgba(91, 200, 232, 0.4);
  background: rgba(3, 14, 22, 0.65);
  color: #9fe7f6;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.hip-expand-btn:hover {
  background: rgba(91, 200, 232, 0.2);
  border-color: rgba(91, 200, 232, 0.7);
}
.hip-expand-btn[aria-pressed="true"] {
  background: rgba(91, 200, 232, 0.28);
  color: #fff;
}
.hip-hydro-range { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.hip-inline-select {
  appearance: none;
  background: rgba(3, 14, 22, 0.7);
  border: 1px solid rgba(91, 200, 232, 0.4);
  color: #dff8ff;
  border-radius: 8px;
  padding: 5px 28px 5px 10px;
  font-size: 11px;
  font-weight: 600;
  max-width: min(360px, 48vw);
  cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, #9fe7f6 50%),
    linear-gradient(135deg, #9fe7f6 50%, transparent 50%);
  background-position: calc(100% - 14px) 55%, calc(100% - 9px) 55%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}
.hip-sr {
  position: absolute;
  width: 1px; height: 1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
}
.hip-custom-select--stretch { min-width: 220px; max-width: 340px; flex: 1.2; }
.hip-chainage-ctrl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid rgba(91, 200, 232, 0.35);
  background: rgba(3, 14, 22, 0.55);
  color: rgba(190, 220, 230, 0.85);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.hip-chainage-input {
  width: 72px;
  background: transparent;
  border: none;
  color: #dff8ff;
  font-size: 12px;
  font-weight: 700;
  outline: none;
}
.hip-fresh[data-fresh="LIVE"] { color: #9af0c8; font-weight: 700; }
.hip-fresh[data-fresh="HISTORICAL"] { color: #c4b5fd; font-weight: 700; }
.hip-graph-title {
  font-size: 13.5px;
  font-weight: 800;
  color: #dff8ff;
  letter-spacing: 0.04em;
  margin: 0;
  line-height: 1.3;
  min-width: 0;
}
.hip-sub {
  font-size: 11px;
  font-weight: 500;
  color: rgba(190, 220, 230, 0.7);
  margin-left: 6px;
}
.hip-legend span { font-size: 11px !important; font-weight: 600; }
.hip-svg-wrap {
  position: relative;
  width: 100%;
  max-width: none;
  margin: 0;
  flex: 0 0 auto;
  min-height: 220px;
  background: linear-gradient(180deg, rgba(3, 14, 22, 0.72), rgba(4, 20, 30, 0.88));
  border: 1px solid rgba(170, 225, 238, 0.18);
  border-radius: 12px;
  padding: 8px 10px 6px;
  box-shadow: inset 0 1px 0 rgba(220, 245, 255, 0.08);
  overflow: visible;
}
.hip-graph-section--focused .hip-svg-wrap {
  flex: 1 1 auto;
  min-height: 420px;
}
.hip-svg-wrap svg {
  display: block;
  width: 100%;
  height: 100%;
  max-height: none;
  min-height: 0;
}
.hip-content {
  padding: 10px 18px 18px !important;
}
.hip-header-top { padding: 8px 16px 4px !important; }
.hip-controls-row { padding: 4px 16px 6px !important; }
.hip-coverage { padding: 2px 16px 6px !important; font-size: 10.5px !important; }
.hip-svg-wrap svg text { font-weight: 500; }

/* Responsive chart densification for common laptop viewports */
@media (max-width: 1600px), (max-height: 900px) {
  .hip-three { gap: 12px; }
  .hip-graph-section { padding: 7px 8px 8px; }
}
@media (max-width: 1366px), (max-height: 768px) {
  .hip-three { gap: 10px; }
  .hip-graph-title { font-size: 12.5px; }
  .hip-content { padding: 8px 12px 12px !important; }
}
.hip-bar { cursor: pointer; transition: opacity 0.15s; }
.hip-bar:hover { opacity: 1 !important; }

.hip-prov-row {
  font-size: 10.5px;
  color: rgba(190, 220, 230, 0.7);
  border-top: 1px solid rgba(170, 225, 238, 0.12);
  padding-top: 8px;
  margin-top: 2px;
  line-height: 1.7;
}
.hip-prov-row strong { color: #b9f5ff; }

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
  background: rgba(3, 14, 22, 0.55);
  border: 1px solid rgba(170, 225, 238, 0.16);
  border-radius: 12px;
  padding: 10px 14px;
  min-width: 0;
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}
.hip-card:hover {
  transform: translateY(-1px);
  border-color: rgba(91, 200, 232, 0.45);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
}
.hip-card__label {
  font-size: 10.5px;
  color: rgba(190, 220, 230, 0.7);
  font-weight: 600;
  letter-spacing: 0.03em;
}
.hip-card__value {
  font-size: 17px;
  font-weight: 800;
  color: #ffffff;
  margin: 4px 0 2px;
}
.hip-card__prov { font-size: 9.5px; font-weight: 700; color: ${C.active}; }

.hip-station-block {
  background: rgba(91, 200, 232, 0.08);
  border: 1px solid rgba(91, 200, 232, 0.22);
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 10px;
}
.hip-station-title {
  font-size: 14px;
  font-weight: 800;
  color: #9fe7f6;
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
.hip-kv:hover { background: rgba(91, 200, 232, 0.1); }
.hip-kv .k {
  color: rgba(190, 220, 230, 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hip-kv .v { font-weight: 700; color: #ffffff; white-space: nowrap; }
.hip-prov-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(170, 225, 238, 0.12);
}
@media (max-width: 860px) {
  .hip-prov-grid { grid-template-columns: 1fr 1fr; }
}
.hip-prov-grid .pk { color: rgba(190, 220, 230, 0.65); font-size: 10.5px; }
.hip-prov-grid .pv { color: ${C.active}; font-size: 10.5px; font-weight: 700; margin-left: 4px; }
.hip-telemetry-note {
  font-size: 10.5px;
  color: #fecaca;
  padding: 7px 10px;
  background: rgba(239, 68, 68, 0.12);
  border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.28);
  margin-top: 8px;
}

.hip-risk-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  color: rgba(200, 230, 238, 0.85);
}
.hip-risk-bar {
  flex: 1;
  height: 7px;
  background: rgba(170, 225, 238, 0.12);
  border-radius: 4px;
  overflow: hidden;
}
.hip-risk-fill {
  height: 100%;
  border-radius: 4px;
  background: #5dcea0;
  transition: width 0.4s;
}
.hip-risk-fill[data-status="warn"]     { background: #E8A13D; }
.hip-risk-fill[data-status="critical"] { background: #ff6b6b; }

.hip-alerts-list { display: flex; flex-direction: column; gap: 8px; }
.hip-alert {
  background: rgba(3, 14, 22, 0.55);
  border: 1px solid rgba(170, 225, 238, 0.16);
  border-radius: 12px;
  padding: 10px 12px;
  transition: box-shadow 0.15s;
}
.hip-alert:hover { box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35); }
.hip-alert[data-severity="DANGER"]  { border-color: rgba(255, 107, 107, 0.45); }
.hip-alert[data-severity="WARNING"] { border-color: rgba(232, 161, 61, 0.45); }
.hip-alert__header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.hip-alert__badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; }
.hip-alert__name { font-weight: 800; color: #dff8ff; }
.hip-alert__ch { font-size: 10.5px; color: rgba(190, 220, 230, 0.7); margin-left: auto; }
.hip-alert__body { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.hip-alert__prov {
  font-size: 10px;
  color: rgba(190, 220, 230, 0.65);
  margin-top: 6px;
  border-top: 1px solid rgba(170, 225, 238, 0.12);
  padding-top: 4px;
}

.hip-mb-header, .hip-mb-row {
  display: grid;
  grid-template-columns: 130px 70px 1fr 70px 56px 64px 44px;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(170, 225, 238, 0.1);
  font-size: 11.5px;
}
.hip-mb-row { border-radius: 6px; transition: background 0.12s; }
.hip-mb-row:hover { background: rgba(91, 200, 232, 0.1); }
.hip-mb-header {
  font-size: 10.5px;
  color: rgba(190, 220, 230, 0.65);
  font-weight: 800;
  letter-spacing: 0.04em;
}
.hip-mb-name {
  font-weight: 700;
  color: #dff8ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hip-mb-ch { color: rgba(190, 220, 230, 0.65); font-size: 10.5px; }
.hip-mb-bar {
  height: 6px;
  background: rgba(170, 225, 238, 0.12);
  border-radius: 3px;
  overflow: hidden;
}
.hip-mb-fill { height: 100%; background: #5dcea0; border-radius: 3px; transition: width 0.3s; }
.hip-mb-fill[data-status="warn"]     { background: #E8A13D; }
.hip-mb-fill[data-status="critical"] { background: #ff6b6b; }
.hip-mb-margin { font-weight: 800; color: #ffffff; }
.hip-mb-fcast, .hip-mb-prob, .hip-mb-risk {
  color: rgba(200, 230, 238, 0.85);
  text-align: right;
}

@media (max-width: 900px) {
  .hip-content { padding: 12px 12px 16px; }
  .hip-tab { padding: 7px 9px; font-size: 10px; }
  .hip-mb-header, .hip-mb-row {
    grid-template-columns: 100px 58px 1fr 58px 48px;
  }
  .hip-mb-prob, .hip-mb-risk,
  .hip-mb-header span:nth-child(6),
  .hip-mb-header span:nth-child(7) { display: none; }
}
@media (max-width: 600px) {
  .hip-controls-row { flex-wrap: wrap; gap: 6px; }
  .hip-select { max-width: 100%; }
  .hip-svg-wrap { min-height: 280px; }
  .hip-svg-wrap svg { min-height: 240px; }
}
`;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  onDigitalTwinExit(() => { if (isOpen()) hide(); });
  window.__MM_HYDRO_INTEL__ = {
    show,
    hide,
    isOpen,
    isAnalyticalOpen,
    showAnalyticalCharts,
    showCharts: showAnalyticalCharts,
  };

  return { show, hide, el: backdrop, isOpen, showAnalyticalCharts };
}
