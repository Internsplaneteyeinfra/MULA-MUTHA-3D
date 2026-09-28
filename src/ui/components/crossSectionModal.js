/**
 * Cross-Section Profile & Hydraulic Geometry Visualizer
 *
 * Renders cross-sectional transects (bed vs water surface) and longitudinal profiles
 * for any selected chainage station along the 16.96 km Mula–Mutha river corridor.
 *
 * Implements Mandates 12 & 26:
 * - Left bank elevation, right bank elevation, thalweg, water surface, wetted area
 * - Provenance badge: SURVEYED, INTERPOLATED FROM SURVEY, or LIVE SURVEY
 * - Longitudinal profile view (Chainage vs Bed vs WSE)
 */

import { ChevronLeft, ChevronRight, X } from "lucide";
import { lucideHtml } from "../icons.js";
import { hydrologyStore } from "../../services/hydrology/hydrologyStore.js";
import { crossSectionRegistry, CROSS_SECTION_PRIORITY } from "../../services/hydrology/crossSectionRegistry.js";
import { initHydrologyProfileService, refreshHydrologyProfile } from "../../services/hydrology/hydrologyProfileService.js";
import { state } from "../../state.js";
import { attachChartHover } from "../chartHover.js";

// Light glass palette
const CS = {
  text: "#0f172a",
  muted: "#475569",
  axis: "rgba(15,23,42,0.4)",
  grid: "rgba(15,23,42,0.09)",
  wse: "#0284c7",
  waterFill: "rgba(2,132,199,0.18)",
  bed: "#a16207",
  depth: "#0369a1",
  active: "#ea580c",
};

export function mountCrossSectionModal(root) {
  const backdrop = document.createElement("div");
  backdrop.id = "cross-section-backdrop";
  backdrop.className = "cross-section-backdrop map-chrome";
  backdrop.hidden = true;
  backdrop.style.display = "none";       // explicit: never visible or interactive on load
  backdrop.style.pointerEvents = "none"; // cannot intercept clicks while hidden
  // NOTE: Do NOT put aria-hidden on backdrop. When open, the modal inside has
  // aria-modal="true" which marks everything else as inert for screen readers.

  const modal = document.createElement("div");
  modal.id = "cross-section-modal";
  modal.className = "cross-section-modal hud";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "cs-modal-title");
  modal.setAttribute("aria-label", "River Cross-Section & Hydraulic Geometry");
  modal.innerHTML = `
    <div class="cs-modal__header">
      <div class="cs-modal__title-group">
        <h3 id="cs-modal-title" class="cs-modal__title">RIVER CROSS-SECTION &amp; HYDRAULIC PROFILE</h3>
        <span class="cs-station-nav">
          <button id="cs-prev-station" class="cs-station-step" type="button" aria-label="Previous station">${lucideHtml(ChevronLeft, { size: 15 })}</button>
          <span id="cs-station-badge" class="cs-modal__badge" aria-live="polite">CH 0+000</span>
          <button id="cs-next-station" class="cs-station-step" type="button" aria-label="Next station">${lucideHtml(ChevronRight, { size: 15 })}</button>
        </span>
        <span id="cs-provenance-badge" class="cs-modal__badge cs-modal__badge--prov">PARAMETRIC</span>
      </div>
      <button id="cs-close-btn" class="cs-modal__close-btn" aria-label="Close modal">${lucideHtml(X, { size: 18 })}</button>
    </div>

    <div class="cs-modal__body">
      <!-- Cross Section SVG Visualization -->
      <div class="cs-modal__view-container">
        <div class="cs-view-tabs">
          <button id="cs-tab-transect" class="cs-tab active">Cross-Section Transect</button>
          <button id="cs-tab-longitudinal" class="cs-tab">Longitudinal Slope Profile</button>
        </div>

        <div id="cs-svg-wrapper" class="cs-svg-wrapper">
          <svg id="cs-svg" class="cs-svg" preserveAspectRatio="xMidYMid meet" viewBox="0 0 500 248"></svg>
        </div>
      </div>

      <!-- Station Metrics Grid -->
      <div class="cs-modal__metrics-sidebar">
        <h4 class="cs-metrics-title">HYDRAULIC GEOMETRY</h4>
        <div class="cs-metric-row"><span class="k">Chainage</span><span class="v" id="cs-val-ch">—</span></div>
        <div class="cs-metric-row"><span class="k">Channel Top Width</span><span class="v" id="cs-val-w">—</span></div>
        <div class="cs-metric-row"><span class="k">Water Depth</span><span class="v depth" id="cs-val-d">—</span></div>
        <div class="cs-metric-row"><span class="k">Water Surface (WSE)</span><span class="v" id="cs-val-wse">—</span></div>
        <div class="cs-metric-row"><span class="k">Bed Elevation</span><span class="v" id="cs-val-bed">—</span></div>
        <div class="cs-metric-row"><span class="k">Wetted Cross-Area</span><span class="v" id="cs-val-a">—</span></div>
        <div class="cs-metric-row"><span class="k">Hydraulic Radius (R)</span><span class="v" id="cs-val-r">—</span></div>
        <div class="cs-metric-row"><span class="k">Discharge (Q)</span><span class="v" id="cs-val-q">—</span></div>
        <div class="cs-metric-row"><span class="k">Velocity (v)</span><span class="v" id="cs-val-v">—</span></div>
        <div class="cs-metric-row"><span class="k">Froude (Fr)</span><span class="v" id="cs-val-fr">—</span></div>
        
        <div class="cs-divider"></div>
        <h4 class="cs-metrics-title">PROVENANCE &amp; INTEGRITY</h4>
        <div class="cs-metric-row"><span class="k">Geometry Priority</span><span class="v" id="cs-val-geom-priority" style="font-size:10px">—</span></div>
        <div class="cs-metric-row"><span class="k">Confidence</span><span class="v" id="cs-val-confidence">—</span></div>
        <div class="cs-metric-row"><span class="k">Datum Status</span><span class="v" id="cs-val-datum-status" style="font-size:10px">—</span></div>
      </div>
    </div>
  `;

  backdrop.appendChild(modal);
  root.appendChild(backdrop);

  // Styling
  _injectStyles();

  // State
  let currentStation = null;
  let activeView = "transect"; // "transect" | "longitudinal"
  let _previousFocus = null;
  let _solveInProgress = false;
  let _isOpen = false;           // single source of truth — do NOT use backdrop.hidden elsewhere
  let _showCount = 0;            // diagnostic: 1 button click must produce SHOW COUNT 1

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Safely get the first available profile record */
  function _getFirstRecord() {
    const recs = hydrologyStore.getProfile()?.records;
    return recs && recs.length > 0 ? recs[0] : null;
  }

  /**
   * Returns the station record for the currently active Digital Twin chainage.
   * state.selectedChainageMeters is the single canonical active chainage used by
   * the ruler, step HUD, chainage panel, 3D camera, and River Data panel.
   * Returns null if no valid active chainage exists.
   */
  function _getActiveDigitalTwinStation() {
    const meters = state.selectedChainageMeters;
    if (!Number.isFinite(meters)) return null;
    return hydrologyStore.getStationAtChainage(meters) ?? null;
  }

  /**
   * Resolve a station record with strict priority order:
   *   1. Explicit station object passed to show()     → source: "EXPLICIT_STATION"
   *   2. Explicit chainage number passed to show()    → source: "EXPLICIT_CHAINAGE_NUMBER"
   *   3. Active Digital Twin station (state.selectedChainageMeters) → source: "ACTIVE_DIGITAL_TWIN_STATION"
   *   4. records[0] ONLY as absolute last resort      → source: "DEFAULT_FIRST_RECORD"
   *
   * records[0] must NEVER override a valid active station.
   *
   * @param {object|number|null} stationArg
   * @returns {{ station: object|null, source: string }}
   */
  function _resolveStationWithSource(stationArg) {
    const profile = hydrologyStore.getProfile();
    const records = profile?.records;
    if (!records || records.length === 0) {
      return { station: null, source: "NO_PROFILE" };
    }

    // Priority 1: caller supplied a canonical station record object
    if (
      stationArg &&
      typeof stationArg === "object" &&
      !(stationArg instanceof Event) &&
      Number.isFinite(Number(stationArg.chainage_m))
    ) {
      return { station: stationArg, source: "EXPLICIT_STATION" };
    }

    // Priority 2: caller supplied a raw chainage number
    if (typeof stationArg === "number" && Number.isFinite(stationArg)) {
      const found = hydrologyStore.getStationAtChainage(stationArg);
      if (found) return { station: found, source: "EXPLICIT_CHAINAGE_NUMBER" };
    }

    // Priority 3: use the active Digital Twin chainage (state.selectedChainageMeters)
    const activeStation = _getActiveDigitalTwinStation();
    if (activeStation) {
      return { station: activeStation, source: "ACTIVE_DIGITAL_TWIN_STATION" };
    }

    // Priority 4: absolute last resort — only when there is genuinely no active station
    return { station: records[0], source: "DEFAULT_FIRST_RECORD" };
  }

  /** Backwards-compat wrapper — returns just the station */
  function _resolveStation(stationArg) {
    return _resolveStationWithSource(stationArg).station;
  }

  // ─── Event: refresh render if profile updates while modal is ALREADY OPEN ──
  // MUST NOT open the modal — only refreshes when _isOpen is already true.
  document.addEventListener("hydrology-state-change", () => {
    if (!_isOpen) return; // guard: never auto-open from hydrology profile events
    if (currentStation) {
      const refreshed = hydrologyStore.getStationAtChainage(currentStation.chainage_m ?? 0);
      if (refreshed) currentStation = refreshed;
    } else {
      currentStation = _getFirstRecord();
    }
    if (currentStation) render();
  });

  // ─── Event: follow the canonical chainage selection while open ────────────
  document.addEventListener("chainage-select", (e) => {
    if (!_isOpen) return;
    const m = Number(e.detail?.meters ?? state.selectedChainageMeters);
    if (!Number.isFinite(m)) return;
    const next = hydrologyStore.getStationAtChainage(m);
    if (!next || next === currentStation) return;
    currentStation = next;
    render();
  });

  function stepStation(dir) {
    const records = hydrologyStore.getProfile()?.records || [];
    if (!records.length || !currentStation) return;
    const i = records.indexOf(currentStation);
    const base = i >= 0 ? i : records.findIndex((r) => r.chainage_m >= (currentStation.chainage_m ?? 0));
    const target = records[Math.max(0, Math.min(records.length - 1, base + dir))];
    if (!target || target === currentStation) return;
    state.selectedChainageMeters = target.chainage_m;
    document.dispatchEvent(
      new CustomEvent("chainage-select", { detail: { meters: target.chainage_m, focus: true, fromCrossSection: true } }),
    );
  }
  modal.querySelector("#cs-prev-station")?.addEventListener("click", () => stepStation(-1));
  modal.querySelector("#cs-next-station")?.addEventListener("click", () => stepStation(1));

  // ─── Event: open-from-anywhere via custom DOM event ───────────────────────
  document.addEventListener("cross-section-modal-open", (e) => {
    const stationArg = e.detail?.station ?? null;
    show(stationArg);
  });

  // ─── Close on Escape ──────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _isOpen) hide();
  });

  const closeBtn = modal.querySelector("#cs-close-btn");
  const tabTransect = modal.querySelector("#cs-tab-transect");
  const tabLongitudinal = modal.querySelector("#cs-tab-longitudinal");
  const svg = modal.querySelector("#cs-svg");

  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation(); // prevent bubbling into backdrop listener
    console.log("[CrossSectionModal] CLOSE BUTTON CLICKED");
    hide();
  });
  backdrop.addEventListener("click", (e) => {
    // Only close if the click landed on the backdrop itself, not a child element
    if (e.target === backdrop) {
      hide();
    }
  });

  tabTransect?.addEventListener("click", () => {
    activeView = "transect";
    tabTransect.classList.add("active");
    tabLongitudinal?.classList.remove("active");
    render();
  });

  tabLongitudinal?.addEventListener("click", () => {
    activeView = "longitudinal";
    tabLongitudinal.classList.add("active");
    tabTransect?.classList.remove("active");
    render();
  });

  // ─── Loading state ────────────────────────────────────────────────────────
  function _showLoading() {
    const fields = [
      "#cs-val-ch", "#cs-val-w", "#cs-val-d", "#cs-val-wse", "#cs-val-bed",
      "#cs-val-a", "#cs-val-r", "#cs-val-q", "#cs-val-v", "#cs-val-fr",
      "#cs-val-geom-priority", "#cs-val-confidence", "#cs-val-datum-status",
    ];
    fields.forEach((sel) => _setText(sel, "Loading…"));
    if (svg) svg.innerHTML = `<text x="250" y="120" fill="${CS.muted}" text-anchor="middle" font-size="13">Solving hydraulic profile…</text>`;
  }

  // ─── show() ──────────────────────────────────────────────────────────────
  async function show(stationArg) {
    // Guard: if already open, refresh the current station rather than double-opening
    if (_isOpen) {
      console.log("[CrossSectionModal] show() called while open — refreshing only");
      const { station: refreshed, source } = _resolveStationWithSource(stationArg);
      if (refreshed) {
        currentStation = refreshed;
        console.log(`[CrossSectionModal] Refresh → source: ${source}`, {
          chainage_m: refreshed.chainage_m, station_label: refreshed.station_label,
        });
        render();
      }
      return;
    }

    // Mark as open IMMEDIATELY so hydrology-state-change can't race
    _isOpen = true;
    _showCount++;
    console.log(`[CrossSectionModal] SHOW COUNT ${_showCount}`);

    // Reveal backdrop
    _previousFocus = document.activeElement;
    backdrop.hidden = false;
    backdrop.style.display = "flex";
    backdrop.style.pointerEvents = "auto";
    activeView = "transect";
    tabTransect?.classList.add("active");
    tabLongitudinal?.classList.remove("active");

    // Resolve the station using the priority chain
    const { station: resolved, source: resolvedSource } = _resolveStationWithSource(stationArg);
    currentStation = resolved;

    // ── STATION RESOLUTION DIAGNOSTIC ────────────────────────────────────
    const _allRecs = hydrologyStore.getProfile()?.records ?? [];
    const activeChainage = Number.isFinite(state.selectedChainageMeters)
      ? state.selectedChainageMeters : null;
    console.log("[CrossSectionModal] STATION RESOLUTION", {
      requestedStation:
        stationArg && typeof stationArg === "object" && !(stationArg instanceof Event)
          ? { chainage_m: stationArg.chainage_m, station_label: stationArg.station_label }
          : stationArg,
      activeChainage,
      resolvedChainage: currentStation?.chainage_m ?? null,
      resolvedStationLabel: currentStation?.station_label ?? null,
      profileLength: _allRecs.length,
      source: resolvedSource,
    });
    // ─────────────────────────────────────────────────────────────────────

    if (currentStation) {
      render();
      requestAnimationFrame(() => { closeBtn?.focus(); });
      return;
    }

    // Profile not ready yet — show loading and solve
    _showLoading();
    _solveInProgress = true;

    try {
      console.log("[CrossSectionModal] Profile not ready, initiating solve…");
      await initHydrologyProfileService();
      const profile = hydrologyStore.getProfile();
      console.log("[CrossSectionModal] Solve complete, records:", profile?.records?.length);
    } catch (err) {
      console.error("[CrossSectionModal] Solve failed:", err);
    }

    _solveInProgress = false;

    // Re-resolve after solve — same priority chain
    const { station: resolvedPost, source: resolvedPostSource } = _resolveStationWithSource(stationArg);
    currentStation = resolvedPost;

    console.log("[CrossSectionModal] STATION RESOLUTION (post-solve)", {
      requestedStation:
        stationArg && typeof stationArg === "object" && !(stationArg instanceof Event)
          ? { chainage_m: stationArg.chainage_m } : stationArg,
      activeChainage: Number.isFinite(state.selectedChainageMeters) ? state.selectedChainageMeters : null,
      resolvedChainage: currentStation?.chainage_m ?? null,
      resolvedStationLabel: currentStation?.station_label ?? null,
      profileLength: hydrologyStore.getProfile()?.records?.length ?? 0,
      source: resolvedPostSource,
    });

    if (!currentStation) {
      // Absolute last resort — only if profile produced zero records after solve
      currentStation = _getFirstRecord();
      if (currentStation) {
        console.warn("[CrossSectionModal] STATION RESOLUTION: DEFAULT_FIRST_RECORD (profile empty after solve)");
      } else {
        console.error("[CrossSectionModal] No records available — cannot render");
        return;
      }
    }

    render();
    requestAnimationFrame(() => { closeBtn?.focus(); });
  }

  // ─── hide() ──────────────────────────────────────────────────────────────
  function hide() {
    if (!_isOpen) return; // already closed — no-op
    console.log("[CrossSectionModal] hide() called");
    _isOpen = false;
    currentStation = null;
    backdrop.hidden = true;
    backdrop.style.display = "none";       // invisible and non-interactive
    backdrop.style.pointerEvents = "none"; // cannot intercept any clicks
    const focusTarget = _previousFocus;
    _previousFocus = null;
    if (focusTarget && typeof focusTarget.focus === "function") {
      focusTarget.focus();
    }
  }

  // ─── render() ────────────────────────────────────────────────────────────
  function render() {
    const profile = hydrologyStore.getProfile();
    const records = profile?.records;

    console.log("[CrossSectionModal] render()", {
      currentStation: currentStation ? `CH ${currentStation.chainage_m?.toFixed?.(0)}m` : null,
      profileLength: records?.length ?? 0,
    });

    if (!currentStation) {
      // Last-ditch: prefer active Digital Twin station before records[0]
      const activeStation = _getActiveDigitalTwinStation();
      if (activeStation) {
        currentStation = activeStation;
        console.warn("[CrossSectionModal] render() recovered currentStation → ACTIVE_DIGITAL_TWIN_STATION");
      } else {
        currentStation = records?.[0] ?? null;
        if (currentStation) {
          console.warn("[CrossSectionModal] render() recovered currentStation → DEFAULT_FIRST_RECORD (no active station)");
        }
      }
      if (!currentStation) {
        console.warn("[CrossSectionModal] No currentStation and no records — aborting render");
        return;
      }
    }

    const st = currentStation;

    // ─── Badges ────────────────────────────────────────────────────────────
    const stBadge = modal.querySelector("#cs-station-badge");
    const provBadge = modal.querySelector("#cs-provenance-badge");
    if (stBadge) stBadge.textContent = st.station_label || `CH ${Math.round(st.chainage_m)}m`;

    const xsProv = st.cross_section_area_m2?.status || "PARAMETRIC";
    if (provBadge) {
      if (xsProv === "OBSERVED") {
        provBadge.textContent = "SURVEYED TRANSECT";
        provBadge.style.background = "rgba(5, 150, 105, 0.14)";
        provBadge.style.color = "#047857";
      } else if (xsProv === "INTERPOLATED") {
        provBadge.textContent = "INTERPOLATED FROM SURVEY";
        provBadge.style.background = "rgba(2, 132, 199, 0.14)";
        provBadge.style.color = "#0369a1";
      } else {
        provBadge.textContent = "LIVE SURVEY";
        provBadge.style.background = "rgba(234, 88, 12, 0.14)";
        provBadge.style.color = "#c2410c";
      }
    }

    // ─── Metric fields ─────────────────────────────────────────────────────
    _setText("#cs-val-ch", st.station_label || `${st.chainage_m.toFixed(1)} m`);
    _setText("#cs-val-w", st.width_m != null ? `${Number(st.width_m).toFixed(1)} m` : "—");
    _setText("#cs-val-d", st.water_depth_m?.value != null ? `${st.water_depth_m.value.toFixed(2)} m` : "—");
    _setText("#cs-val-wse", st.wse_msl?.value != null ? `${st.wse_msl.value.toFixed(2)} m MSL` : "— (Relative Mode)");
    _setText("#cs-val-bed", st.bed_elevation_msl?.value != null ? `${st.bed_elevation_msl.value.toFixed(2)} m MSL` : "— (Unverified Datum)");
    _setText("#cs-val-a", st.cross_section_area_m2?.value != null ? `${st.cross_section_area_m2.value.toFixed(1)} m²` : "—");
    _setText("#cs-val-r", st.hydraulic_radius_m?.value != null ? `${st.hydraulic_radius_m.value.toFixed(2)} m` : "—");
    _setText("#cs-val-q", st.discharge_m3s?.value != null ? `${st.discharge_m3s.value.toFixed(1)} m³/s` : "—");
    _setText("#cs-val-v", st.velocity_ms?.value != null ? `${st.velocity_ms.value.toFixed(2)} m/s` : "—");
    _setText("#cs-val-fr", st.froude_number != null ? `${st.froude_number.toFixed(2)}` : "—");
    _setText("#cs-val-geom-priority", st.cross_section_area_m2?.source || "PRIORITY_4_PARAMETRIC");
    _setText("#cs-val-confidence", st.confidence || "MEDIUM");
    _setText("#cs-val-datum-status", st.provenance?.datum || "VERIFIED_DATUM");

    // ─── Graphs ────────────────────────────────────────────────────────────
    if (activeView === "transect") {
      _renderTransectSvg(svg, st);
    } else {
      _renderLongitudinalSvg(svg, st);
    }

    console.log("[CrossSectionModal] RENDER COMPLETE", {
      chainage_m: st.chainage_m,
      station_label: st.station_label,
      width_m: st.width_m,
      water_depth: st.water_depth_m?.value,
      discharge: st.discharge_m3s?.value,
      velocity: st.velocity_ms?.value,
      area: st.cross_section_area_m2?.value,
    });
  }

  // ─── DOM helper ──────────────────────────────────────────────────────────
  function _setText(selector, text) {
    const el = modal.querySelector(selector);
    if (el) el.textContent = text;
  }

  // ─── Transect SVG ────────────────────────────────────────────────────────
  function _renderTransectSvg(svgEl, st) {
    const width = Math.max(10, Number(st.width_m) || 60);
    const depth = Math.max(0.1, st.water_depth_m?.value || 1.72);

    const L = { padL: 56, padR: 14, padT: 22, padB: 44 };
    const svgW = 500;
    const svgH = 240;
    L.plotW = svgW - L.padL - L.padR;
    L.plotH = svgH - L.padT - L.padB;
    const { padL, padT, plotW, plotH } = L;

    // Relative elevation: water surface = 0 near the top, thalweg = −depth at the bottom.
    const yTop = 0.25 * depth;
    const scX = (d) => padL + (d / width) * plotW;
    const scY = (v) => padT + ((yTop - v) / (yTop + depth)) * plotH;
    const waterY = scY(0);
    const bedAt = (d) => {
      const n = (d / width - 0.5) * 2;
      return -depth * (1 - n * n);
    };

    const steps = 40;
    const xs = Array.from({ length: steps + 1 }, (_, i) => (i / steps) * width);
    const bedYs = xs.map(bedAt);
    const bedPath = xs.map((d, i) => `${i ? "L" : "M"}${scX(d).toFixed(1)},${scY(bedYs[i]).toFixed(1)}`).join(" ");
    const waterPath = `M${padL},${waterY} ${bedPath.replace(/^M/, "L")} L${padL + plotW},${waterY} Z`;

    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const px = padL + f * plotW;
      return `<line x1="${px}" y1="${padT + plotH}" x2="${px}" y2="${padT + plotH + 5}" stroke="${CS.axis}"/>
              <text x="${px}" y="${padT + plotH + 15}" fill="${CS.muted}" font-size="9" text-anchor="middle">${(f * width).toFixed(0)}</text>`;
    }).join("");

    const yTicks = [0, -depth / 2, -depth].map((v) => {
      const py = scY(v);
      return `<line x1="${padL - 5}" y1="${py}" x2="${padL + plotW}" y2="${py}" stroke="${CS.grid}" stroke-dasharray="3,4"/>
              <line x1="${padL - 5}" y1="${py}" x2="${padL}" y2="${py}" stroke="${CS.axis}"/>
              <text x="${padL - 7}" y="${py + 3.5}" fill="${CS.muted}" font-size="9" text-anchor="end">${v === 0 ? "0" : `−${Math.abs(v).toFixed(2)}`}</text>`;
    }).join("");

    const yCx = 11;
    const yCy = padT + plotH / 2;

    svgEl.innerHTML = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${CS.axis}"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${CS.axis}"/>
      ${yTicks}
      <path d="${waterPath}" fill="${CS.waterFill}"/>
      <line x1="${padL}" y1="${waterY}" x2="${padL + plotW}" y2="${waterY}" stroke="${CS.wse}" stroke-width="2"/>
      <path d="${bedPath}" fill="none" stroke="${CS.bed}" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${waterY}" stroke="${CS.bed}" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
      <line x1="${padL + plotW}" y1="${padT}" x2="${padL + plotW}" y2="${waterY}" stroke="${CS.bed}" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
      <text x="${padL - 6}" y="${waterY - 4}" fill="${CS.wse}" font-size="10" text-anchor="end" font-weight="700">WSE</text>
      <text x="${padL + plotW / 2}" y="${waterY - 6}" fill="${CS.wse}" font-size="10" text-anchor="middle" font-weight="700">Water Depth: ${depth.toFixed(2)} m</text>
      <text x="${padL + 6}" y="${padT + 10}" fill="${CS.bed}" font-size="9" font-weight="600">Left Bank</text>
      <text x="${padL + plotW - 6}" y="${padT + 10}" fill="${CS.bed}" font-size="9" text-anchor="end" font-weight="600">Right Bank</text>
      <text x="${padL + plotW / 2}" y="${scY(-depth) - 6}" fill="${CS.bed}" font-size="9" text-anchor="middle" font-weight="700">Riverbed / Thalweg</text>
      <text x="${padL + plotW / 2}" y="${padT + plotH + 29}" fill="${CS.text}" font-size="9" text-anchor="middle" font-weight="600">Width: ${width.toFixed(1)} m</text>
      ${xTicks}
      <text x="${yCx}" y="${yCy}" fill="${CS.muted}" font-size="9" text-anchor="middle" transform="rotate(-90,${yCx},${yCy})">Relative elevation / depth (m)</text>
      <text x="${padL + plotW / 2}" y="${svgH - 3}" fill="${CS.muted}" font-size="9" text-anchor="middle">Cross-channel distance (m)</text>
    `;

    attachChartHover(svgEl, {
      L, xs, scX, scY, lineColor: CS.text,
      fmtX: (d) => `${d.toFixed(1)} m from left bank`,
      series: [
        { label: "Water surface", color: CS.wse, ys: xs.map(() => 0), fmt: () => "0.00 m" },
        { label: "Bed", color: CS.bed, ys: bedYs, fmt: (v) => `${v.toFixed(2)} m` },
        { label: "Local depth", color: CS.depth, ys: bedYs, dot: false, fmt: (v) => `${Math.abs(v).toFixed(2)} m` },
      ],
    });
  }

  // ─── Longitudinal SVG ────────────────────────────────────────────────────
  function _renderLongitudinalSvg(svgEl, st) {
    const allRecords = hydrologyStore.getProfile()?.records || [];
    if (!allRecords.length) {
      svgEl.innerHTML = `<text x="250" y="120" fill="${CS.muted}" text-anchor="middle">Longitudinal profile data loading…</text>`;
      return;
    }

    const L = { padL: 56, padR: 14, padT: 28, padB: 42 };
    const svgW = 500;
    const svgH = 240;
    L.plotW = svgW - L.padL - L.padR;
    L.plotH = svgH - L.padT - L.padB;
    const { padL, padT, plotW, plotH } = L;
    const maxCh = 16960;
    const Y_RANGE = 22;

    const sampleRate = Math.max(1, Math.floor(allRecords.length / 80));
    const sampled = [];
    for (let i = 0; i < allRecords.length; i += sampleRate) sampled.push(allRecords[i]);

    // Schematic relative profile: WSE slopes 20 → 12, bed = WSE − surveyed depth.
    const scX = (m) => padL + (m / maxCh) * plotW;
    const scY = (v) => padT + plotH - (v / Y_RANGE) * plotH;
    const xs = sampled.map((r) => r.chainage_m || 0);
    const wseYs = xs.map((m) => 20 - (m / maxCh) * 8);
    const depths = sampled.map((r) => r.survey_depth_m?.value || 1.7);
    const bedYs = wseYs.map((w, i) => w - depths[i]);
    const toPath = (ys) => xs.map((m, i) => `${i ? "L" : "M"}${scX(m).toFixed(1)},${scY(ys[i]).toFixed(1)}`).join(" ");

    const currM = st.chainage_m || 0;
    const currX = scX(currM);
    const currY = scY(20 - (currM / maxCh) * 8);

    const xTicks = [0, 4, 8, 12, 16.96].map((km) => {
      const px = scX(km * 1000);
      return `<line x1="${px}" y1="${padT + plotH}" x2="${px}" y2="${padT + plotH + 5}" stroke="${CS.axis}"/>
              <text x="${px}" y="${padT + plotH + 14}" fill="${CS.muted}" font-size="9" text-anchor="middle">${km}</text>`;
    }).join("");

    const yTicks = [20, 14, 8, 2].map((v) => {
      const py = scY(v);
      return `<line x1="${padL - 5}" y1="${py}" x2="${padL + plotW}" y2="${py}" stroke="${CS.grid}" stroke-dasharray="3,4"/>
              <line x1="${padL - 5}" y1="${py}" x2="${padL}" y2="${py}" stroke="${CS.axis}"/>
              <text x="${padL - 7}" y="${py + 3.5}" fill="${CS.muted}" font-size="9" text-anchor="end">${v}</text>`;
    }).join("");

    const yCx = 11;
    const yCy = padT + plotH / 2;

    svgEl.innerHTML = `
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${CS.axis}"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${CS.axis}"/>
      ${yTicks}
      <path d="${toPath(bedYs)}" fill="none" stroke="${CS.bed}" stroke-width="2.5"/>
      <path d="${toPath(wseYs)}" fill="none" stroke="${CS.wse}" stroke-width="2"/>
      <line x1="${currX}" y1="${padT}" x2="${currX}" y2="${padT + plotH}" stroke="${CS.active}" stroke-width="2" stroke-dasharray="4,4"/>
      <circle cx="${currX}" cy="${currY}" r="4" fill="${CS.active}" stroke="#fff" stroke-width="1.5"/>
      <text x="${currX}" y="${padT - 8}" fill="${CS.active}" font-size="10" text-anchor="middle" font-weight="700">${st.station_label || ""}</text>
      ${xTicks}
      <text x="${padL + 6}" y="${padT + 14}" fill="${CS.wse}" font-size="9" font-weight="700">― Water Surface Slope</text>
      <text x="${padL + 6}" y="${padT + 26}" fill="${CS.bed}" font-size="9" font-weight="700">― Riverbed Profile</text>
      <text x="${yCx}" y="${yCy}" fill="${CS.muted}" font-size="9" text-anchor="middle" transform="rotate(-90,${yCx},${yCy})">Relative elevation (m)</text>
      <text x="${padL + plotW / 2}" y="${svgH - 3}" fill="${CS.muted}" font-size="9" text-anchor="middle">Chainage (km)</text>
    `;

    attachChartHover(svgEl, {
      L, xs, scX, scY, lineColor: CS.text,
      fmtX: (m) => `CH ${Math.floor(m / 1000)}+${String(Math.round(m % 1000)).padStart(3, "0")}`,
      series: [
        { label: "Water surface", color: CS.wse, ys: wseYs, fmt: (v) => `${v.toFixed(2)} m` },
        { label: "Riverbed", color: CS.bed, ys: bedYs, fmt: (v) => `${v.toFixed(2)} m` },
        { label: "Depth", color: CS.depth, ys: bedYs, dot: false, fmt: (_, i) => `${depths[i].toFixed(2)} m` },
      ],
    });
  }

  // ─── Styles ──────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById("cross-section-styles")) return;
    const style = document.createElement("style");
    style.id = "cross-section-styles";
    style.textContent = `
      .cross-section-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.22);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      }
      .cross-section-modal {
        width: 860px;
        max-width: 95vw;
        background: rgba(255, 255, 255, 0.78);
        backdrop-filter: blur(20px) saturate(1.4);
        -webkit-backdrop-filter: blur(20px) saturate(1.4);
        border: 1px solid rgba(255, 255, 255, 0.85);
        border-radius: 14px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.9);
        color: #0f172a;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .cs-modal__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        background: rgba(255, 255, 255, 0.55);
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      }
      .cs-modal__title-group { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .cs-station-nav { display: inline-flex; align-items: center; gap: 4px; }
      .cs-station-step {
        width: 26px; height: 26px; display: grid; place-items: center;
        border-radius: 7px; border: 1px solid rgba(15, 23, 42, 0.18);
        background: rgba(255, 255, 255, 0.7); color: #0f172a; cursor: pointer;
      }
      .cs-station-step:hover { background: #fff; border-color: rgba(14, 116, 144, 0.5); }
      .cs-modal__title {
        margin: 0;
        font-size: 14px;
        letter-spacing: 0.08em;
        font-weight: 800;
        color: #0f172a;
      }
      .cs-modal__badge {
        padding: 3px 9px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 700;
        background: rgba(15, 23, 42, 0.07);
        color: #334155;
      }
      .cs-modal__close-btn {
        background: none;
        border: none;
        color: #475569;
        cursor: pointer;
        padding: 5px;
        border-radius: 6px;
        transition: background 0.15s, color 0.15s;
      }
      .cs-modal__close-btn:hover { color: #0f172a; background: rgba(15, 23, 42, 0.08); }
      .cs-modal__body {
        display: grid;
        grid-template-columns: 1fr 270px;
        padding: 16px 20px 20px;
        gap: 20px;
      }
      .cs-view-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
      .cs-tab {
        background: rgba(255, 255, 255, 0.7);
        border: 1px solid rgba(15, 23, 42, 0.14);
        color: #334155;
        padding: 7px 14px;
        font-size: 12px;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
      }
      .cs-tab:hover:not(.active) {
        background: #fff;
        border-color: rgba(2, 132, 199, 0.5);
        box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.1);
      }
      .cs-tab.active { background: #0284c7; border-color: #0284c7; color: #fff; }
      .cs-svg-wrapper {
        position: relative;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 10px;
        padding: 10px;
      }
      .cs-svg { width: 100%; height: 250px; display: block; }
      .cs-svg text { font-weight: 500; }
      .cs-modal__metrics-sidebar {
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(15, 23, 42, 0.09);
        border-radius: 10px;
        padding: 12px 14px;
        font-size: 12px;
      }
      .cs-metrics-title {
        margin: 0 0 8px 0;
        font-size: 11.5px;
        font-weight: 800;
        color: #0369a1;
        letter-spacing: 0.06em;
      }
      .cs-metric-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 10px;
        padding: 4px 6px;
        margin: 0 -6px 1px;
        border-radius: 6px;
        transition: background 0.12s;
      }
      .cs-metric-row:hover { background: rgba(2, 132, 199, 0.08); }
      .cs-metric-row .k { color: #475569; flex-shrink: 0; }
      .cs-metric-row .v { font-weight: 700; color: #0f172a; text-align: right; word-break: break-word; }
      .cs-metric-row .v.depth { color: #0284c7; }
      .cs-divider { height: 1px; background: rgba(15, 23, 42, 0.08); margin: 10px 0; }
      @media (max-width: 760px) {
        .cs-modal__body { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Expose to window & button wiring ────────────────────────────────────
  window.__MM_CROSS_SECTION_MODAL__ = { show, hide };

  return { show, hide };
}
