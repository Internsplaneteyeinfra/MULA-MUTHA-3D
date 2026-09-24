/**
 * Cross-Section Profile & Hydraulic Geometry Visualizer
 *
 * Renders cross-sectional transects (bed vs water surface) and longitudinal profiles
 * for any selected chainage station along the 16.96 km Mula–Mutha river corridor.
 *
 * Implements Mandates 12 & 26:
 * - Left bank elevation, right bank elevation, thalweg, water surface, wetted area
 * - Provenance badge: SURVEYED, INTERPOLATED FROM SURVEY, or MODELLED PARAMETRIC
 * - Longitudinal profile view (Chainage vs Bed vs WSE)
 */

import { X } from "lucide";
import { lucideHtml } from "../icons.js";
import { hydrologyStore } from "../../services/hydrology/hydrologyStore.js";
import { crossSectionRegistry, CROSS_SECTION_PRIORITY } from "../../services/hydrology/crossSectionRegistry.js";
import { initHydrologyProfileService, refreshHydrologyProfile } from "../../services/hydrology/hydrologyProfileService.js";
import { state } from "../../state.js";

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
        <span id="cs-station-badge" class="cs-modal__badge">CH 0+000</span>
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
    if (svg) svg.innerHTML = `<text x="250" y="120" fill="rgba(255,255,255,0.4)" text-anchor="middle" font-size="13">Solving hydraulic profile…</text>`;
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
        provBadge.style.background = "rgba(46, 213, 115, 0.25)";
        provBadge.style.color = "#2ed573";
      } else if (xsProv === "INTERPOLATED") {
        provBadge.textContent = "INTERPOLATED FROM SURVEY";
        provBadge.style.background = "rgba(79, 200, 235, 0.25)";
        provBadge.style.color = "#4fc8eb";
      } else {
        provBadge.textContent = "MODELLED PARAMETRIC";
        provBadge.style.background = "rgba(232, 154, 28, 0.25)";
        provBadge.style.color = "#e89a1c";
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
    _setText("#cs-val-datum-status", st.provenance?.datum || "UNVERIFIED_DATUM");

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

    // Padding: left/bottom enlarged to fit rotated Y label + X label
    const padL = 56;   // Y-axis tick numbers + rotated label
    const padR = 14;
    const padT = 22;
    const padB = 44;   // X-axis tick numbers + label
    const svgW = 500;
    const svgH = 240;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;

    // Parabolic bed (schematic cross-section shape)
    const steps = 30;
    let bedPath = "";
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = padL + u * plotW;
      const normX = (u - 0.5) * 2;
      const bedY = padT + plotH - (1 - normX * normX) * (plotH * 0.68);
      bedPath += i === 0 ? `M ${x} ${bedY}` : ` L ${x} ${bedY}`;
    }

    const waterY  = padT + plotH - plotH * 0.68;
    const waterPath = `M ${padL} ${waterY} ` + bedPath.slice(2) + ` L ${padL + plotW} ${waterY} Z`;

    // X-axis ticks: 0 … width in 5 steps
    const xTicks = [0, 0.25, 0.5, 0.75, 1.0].map((frac) => {
      const px    = padL + frac * plotW;
      const label = (frac * width).toFixed(0);
      return `<line x1="${px}" y1="${padT + plotH}" x2="${px}" y2="${padT + plotH + 5}" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
              <text x="${px}" y="${padT + plotH + 15}" fill="rgba(255,255,255,0.5)" font-size="9" text-anchor="middle">${label}</text>`;
    }).join("");

    // Y-axis ticks: water surface = 0, mid = −depth/2, thalweg = −depth
    const midDepthY = (waterY + padT + plotH) / 2;
    const yTicks = [
      { y: waterY,          label: "0" },
      { y: midDepthY,       label: `−${(depth / 2).toFixed(1)}` },
      { y: padT + plotH,    label: `−${depth.toFixed(1)}` },
    ].map(({ y, label }) =>
      `<line x1="${padL - 5}" y1="${y}" x2="${padL}" y2="${y}" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
       <text x="${padL - 7}" y="${y + 3.5}" fill="rgba(255,255,255,0.5)" font-size="9" text-anchor="end">${label}</text>`
    ).join("");

    const yCx = 11;
    const yCy = padT + plotH / 2;
    const xCx = padL + plotW / 2;
    const xCy = svgH - 3;

    svgEl.innerHTML = `
      <!-- Axes frame -->
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>

      <!-- Grid lines -->
      <line x1="${padL}" y1="${waterY}" x2="${padL + plotW}" y2="${waterY}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,4"/>
      <line x1="${padL}" y1="${midDepthY}" x2="${padL + plotW}" y2="${midDepthY}" stroke="rgba(255,255,255,0.04)" stroke-dasharray="3,4"/>

      <!-- Water body -->
      <path d="${waterPath}" fill="rgba(79,200,235,0.28)" stroke="#4fc8eb" stroke-width="1.5"/>

      <!-- Water surface -->
      <line x1="${padL}" y1="${waterY}" x2="${padL + plotW}" y2="${waterY}" stroke="#00f2fe" stroke-width="2"/>

      <!-- River bed -->
      <path d="${bedPath}" fill="none" stroke="#d4a373" stroke-width="2.5" stroke-linecap="round"/>

      <!-- Bank dashes -->
      <line x1="${padL}"          y1="${padT}" x2="${padL}"          y2="${waterY}" stroke="rgba(212,163,115,0.45)" stroke-width="1" stroke-dasharray="3,3"/>
      <line x1="${padL + plotW}" y1="${padT}" x2="${padL + plotW}" y2="${waterY}" stroke="rgba(212,163,115,0.45)" stroke-width="1" stroke-dasharray="3,3"/>

      <!-- Data annotations -->
      <text x="${padL - 6}" y="${waterY - 4}" fill="#4fc8eb" font-size="10" text-anchor="end" font-weight="600">WSE</text>
      <text x="${padL + plotW / 2}" y="${waterY - 6}" fill="#00f2fe" font-size="10" text-anchor="middle" font-weight="600">Water Depth: ${depth.toFixed(2)} m</text>
      <text x="${padL + 6}" y="${padT + 12}" fill="rgba(212,163,115,0.85)" font-size="9" text-anchor="start">Left Bank</text>
      <text x="${padL + plotW - 6}" y="${padT + 12}" fill="rgba(212,163,115,0.85)" font-size="9" text-anchor="end">Right Bank</text>
      <text x="${padL + plotW / 2}" y="${padT + plotH - 5}" fill="#d4a373" font-size="9" text-anchor="middle">Riverbed / Thalweg</text>
      <text x="${padL + plotW / 2}" y="${padT + plotH + 29}" fill="rgba(255,255,255,0.6)" font-size="9" text-anchor="middle">Width: ${width.toFixed(1)} m</text>

      <!-- X-axis ticks -->
      ${xTicks}

      <!-- Y-axis ticks -->
      ${yTicks}

      <!-- Y-axis label (rotated) -->
      <text x="${yCx}" y="${yCy}" fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="middle"
            transform="rotate(-90,${yCx},${yCy})">Relative elevation / depth (m)</text>

      <!-- X-axis label -->
      <text x="${xCx}" y="${xCy}" fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="middle">Cross-channel distance (m)</text>
    `;
  }

  // ─── Longitudinal SVG ────────────────────────────────────────────────────
  function _renderLongitudinalSvg(svgEl, st) {
    const allRecords = hydrologyStore.getProfile()?.records || [];
    if (!allRecords.length) {
      svgEl.innerHTML = `<text x="250" y="120" fill="white" text-anchor="middle">Longitudinal profile data loading…</text>`;
      return;
    }

    // Padding: left/bottom enlarged for axis labels
    const padL = 56;
    const padR = 14;
    const padT = 28;
    const padB = 42;
    const svgW = 500;
    const svgH = 240;
    const plotW = svgW - padL - padR;
    const plotH = svgH - padT - padB;
    const maxCh = 16960;
    const Y_RANGE = 22; // the plotted relative Y spans 0–22

    const sampleRate = Math.max(1, Math.floor(allRecords.length / 80));
    const sampled = [];
    for (let i = 0; i < allRecords.length; i += sampleRate) sampled.push(allRecords[i]);

    // Y-axis data:
    //   wseRel  = 20 − u × 8            (schematic linear WSE slope, relative units)
    //   bedRel  = wseRel − surveyDepth  (bed below WSE)
    let bedLine = "";
    let wseLine = "";
    sampled.forEach((rec, idx) => {
      const u      = (rec.chainage_m || 0) / maxCh;
      const x      = padL + u * plotW;
      const wseRel = 20 - u * 8;
      const bedRel = wseRel - (rec.survey_depth_m?.value || 1.7);
      const yWse   = padT + plotH - (wseRel / Y_RANGE) * plotH;
      const yBed   = padT + plotH - (bedRel / Y_RANGE) * plotH;
      if (idx === 0) {
        wseLine += `M ${x} ${yWse}`;
        bedLine += `M ${x} ${yBed}`;
      } else {
        wseLine += ` L ${x} ${yWse}`;
        bedLine += ` L ${x} ${yBed}`;
      }
    });

    // Active chainage indicator — uses the CURRENT station (not records[0])
    const currU    = (st.chainage_m || 0) / maxCh;
    const currX    = padL + currU * plotW;
    const currWse  = 20 - currU * 8;
    const currY    = padT + plotH - (currWse / Y_RANGE) * plotH;

    // X-axis ticks at 0, 4, 8, 12, 16.96 km
    const xTicks = [0, 4, 8, 12, 16.96].map((km) => {
      const px = padL + (km / 16.96) * plotW;
      return `<line x1="${px}" y1="${padT + plotH}" x2="${px}" y2="${padT + plotH + 5}" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
              <text x="${px}" y="${padT + plotH + 14}" fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="middle">${km}</text>`;
    }).join("");

    // Y-axis ticks at relative values 2, 8, 14, 20
    const yTicks = [20, 14, 8, 2].map((relVal) => {
      const py = padT + plotH - (relVal / Y_RANGE) * plotH;
      if (py < padT - 2 || py > padT + plotH + 2) return "";
      return `<line x1="${padL - 5}" y1="${py}" x2="${padL + plotW}" y2="${py}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,4"/>
              <line x1="${padL - 5}" y1="${py}" x2="${padL}" y2="${py}" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
              <text x="${padL - 7}" y="${py + 3.5}" fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="end">${relVal}</text>`;
    }).join("");

    const yCx = 11;
    const yCy = padT + plotH / 2;
    const xCx = padL + plotW / 2;
    const xCy = svgH - 3;

    svgEl.innerHTML = `
      <!-- Axes frame -->
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>

      <!-- Y-axis ticks + grid -->
      ${yTicks}

      <!-- Bed profile -->
      <path d="${bedLine}" fill="none" stroke="#d4a373" stroke-width="2.5"/>

      <!-- Water surface profile -->
      <path d="${wseLine}" fill="none" stroke="#00f2fe" stroke-width="2"/>

      <!-- Active chainage indicator at CURRENT station -->
      <line x1="${currX}" y1="${padT}" x2="${currX}" y2="${padT + plotH}" stroke="#e89a1c" stroke-width="2" stroke-dasharray="4,4"/>
      <circle cx="${currX}" cy="${currY}" r="4" fill="#e89a1c"/>
      <text x="${currX}" y="${padT - 8}" fill="#e89a1c" font-size="10" text-anchor="middle" font-weight="600">${st.station_label || ""}</text>

      <!-- X-axis ticks -->
      ${xTicks}

      <!-- Legend -->
      <text x="${padL + 6}" y="${padT + 14}" fill="#00f2fe" font-size="9">― Water Surface Slope</text>
      <text x="${padL + 6}" y="${padT + 26}" fill="#d4a373" font-size="9">― Riverbed Profile</text>

      <!-- Y-axis label (rotated) -->
      <text x="${yCx}" y="${yCy}" fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="middle"
            transform="rotate(-90,${yCx},${yCy})">Relative elevation (m)</text>

      <!-- X-axis label -->
      <text x="${xCx}" y="${xCy}" fill="rgba(255,255,255,0.48)" font-size="9" text-anchor="middle">Chainage (km)</text>
    `;
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
        background: rgba(4, 9, 20, 0.72);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      }
      .cross-section-modal {
        width: 820px;
        max-width: 95vw;
        background: rgba(14, 23, 38, 0.94);
        border: 1px solid rgba(79, 200, 235, 0.28);
        border-radius: 10px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.6);
        color: #e2e8f0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .cs-modal__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .cs-modal__title-group {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .cs-modal__title {
        margin: 0;
        font-size: 13px;
        letter-spacing: 0.08em;
        font-weight: 700;
        color: #f8fafc;
      }
      .cs-modal__badge {
        padding: 2px 7px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        background: rgba(255,255,255,0.08);
      }
      .cs-modal__close-btn {
        background: none;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
      }
      .cs-modal__close-btn:hover {
        color: #fff;
        background: rgba(255,255,255,0.1);
      }
      .cs-modal__body {
        display: grid;
        grid-template-columns: 1fr 260px;
        padding: 16px 20px 20px;
        gap: 20px;
      }
      .cs-view-tabs {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
      }
      .cs-tab {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        color: #94a3b8;
        padding: 6px 14px;
        font-size: 11px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .cs-tab.active {
        background: rgba(79, 200, 235, 0.2);
        border-color: #4fc8eb;
        color: #00f2fe;
        font-weight: 600;
      }
      .cs-svg-wrapper {
        background: rgba(0, 0, 0, 0.4);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 6px;
        padding: 10px;
      }
      .cs-svg {
        width: 100%;
        height: 230px;
      }
      .cs-modal__metrics-sidebar {
        background: rgba(255,255,255,0.03);
        border-radius: 6px;
        padding: 12px 14px;
        font-size: 11px;
      }
      .cs-metrics-title {
        margin: 0 0 10px 0;
        font-size: 11px;
        color: #94a3b8;
        letter-spacing: 0.05em;
      }
      .cs-metric-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 6px;
      }
      .cs-metric-row .k {
        color: #64748b;
      }
      .cs-metric-row .v {
        font-weight: 600;
        color: #f1f5f9;
      }
      .cs-metric-row .v.depth {
        color: #4fc8eb;
      }
      .cs-divider {
        height: 1px;
        background: rgba(255,255,255,0.08);
        margin: 10px 0;
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Expose to window & button wiring ────────────────────────────────────
  window.__MM_CROSS_SECTION_MODAL__ = { show, hide };

  return { show, hide };
}
