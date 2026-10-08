/**
 * Compact Flood Result card (left side).
 * Only shows API-returned or directly derived fields; "—" for missing.
 */

export function mountFloodResultPanel(root, handlers = {}) {
  const panel = document.createElement("aside");
  panel.className = "flood-result-panel map-chrome";
  panel.id = "flood-result-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <header class="flood-result-panel__head">
      <strong>FLOOD RESULT</strong>
      <button type="button" class="flood-result-close" id="flood-result-close" aria-label="Close">×</button>
    </header>
    <p class="flood-result-disclaimer">Flood extent generated from JalNetra Flood API results.</p>
    <div class="flood-result-panel__body" id="flood-result-body"></div>
    <details class="flood-result-details" id="flood-result-details" hidden>
      <summary>Details</summary>
      <pre class="flood-result-details__pre" id="flood-result-details-pre"></pre>
    </details>
    <div class="flood-result-panel__actions">
      <button type="button" class="flood-result-action" id="flood-result-replay">▶ Replay Animation</button>
      <button type="button" class="flood-result-action" id="flood-result-focus">Focus Flood</button>
      <button type="button" class="flood-result-action flood-result-action--danger" id="flood-result-clear">Clear Simulation</button>
    </div>
  `;
  root.appendChild(panel);

  const body = panel.querySelector("#flood-result-body");
  const details = panel.querySelector("#flood-result-details");
  const detailsPre = panel.querySelector("#flood-result-details-pre");

  function dash(v) {
    if (v == null || v === "") return "—";
    return v;
  }

  function row(label, value, id = null) {
    const idAttr = id ? ` id="${id}"` : "";
    return `<div class="flood-result-row"><span class="k">${label}</span><span class="v"${idAttr}>${dash(value)}</span></div>`;
  }

  function fmtHa(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return `${n.toFixed(2)} ha`;
  }

  function show(info, opts = {}) {
    if (!info && !opts.error) {
      panel.hidden = true;
      return;
    }

    if (opts.error) {
      body.innerHTML = [
        row("Status", "Error"),
        row("Message", "Flood simulation could not be completed."),
      ].join("");
      if (opts.errorDetails) {
        details.hidden = false;
        detailsPre.textContent = String(opts.errorDetails);
      } else {
        details.hidden = true;
        detailsPre.textContent = "";
      }
      panel.hidden = false;
      return;
    }

    const currentWater = info.current_water_level;
    const finalWater = info.final_water_level;
    const riseMm = info.water_rise_mm ?? 0;
    
    let riseStr = `+${Math.round(riseMm)} mm`;
    if (riseMm >= 1000) {
      riseStr = `+${(riseMm / 1000).toFixed(2)} m`;
    }

    body.innerHTML = [
      row("Date", info.scene_date || info.start_date, "flood-res-date"),
      row("Initial Water", info.initial_water_level != null ? `${info.initial_water_level.toFixed(2)} m` : "—", "flood-res-initial-water"),
      row("Current Water", currentWater != null ? `${currentWater.toFixed(2)} m` : "—", "flood-res-current-water"),
      row("Water Rise", riseStr, "flood-res-water-rise"),
      row("Final Water", finalWater != null ? `${finalWater.toFixed(2)} m` : "—", "flood-res-final-water"),
      row("Flooded Area", fmtHa(info.flood_area_ha), "flood-res-flood-area"),
      row("Max Depth", info.max_depth_m != null ? `${info.max_depth_m.toFixed(2)} m` : "—", "flood-res-max-depth"),
      
      // Progress UI placeholder (updated via events/DOM in overlay.js)
      `<div class="flood-sim-progress-area" style="margin-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.5rem;">
        <div id="flood-anim-status" style="font-weight: bold; margin-bottom: 4px; font-size: 0.9em; color: var(--accent);">\${(info.initial_water_level == null || info.final_water_level == null) ? 'FLOOD DATA INCOMPLETE' : 'SIMULATION READY'}</div>
        <div style="display:flex; justify-content:space-between; font-size:0.85em; margin-bottom: 2px;">
          <span id="flood-anim-rise-label">WATER RISE</span>
          <span id="flood-anim-rise-val">+0 mm</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:0.85em; margin-bottom: 4px;">
          <span id="flood-anim-front-label">FLOOD FRONT</span>
          <span id="flood-anim-front-val">0%</span>
        </div>
        <div class="progress-bar-container" style="background: rgba(0,0,0,0.4); height: 8px; border-radius: 4px; overflow: hidden; width: 100%;">
          <div id="flood-anim-bar" style="background: var(--accent, #4cc9f0); height: 100%; width: 0%; transition: width 0.1s linear;"></div>
        </div>
      </div>`
    ]
      .filter(Boolean)
      .join("");

    details.hidden = true;
    detailsPre.textContent = "";
    panel.hidden = false;
  }

  function hide() {
    panel.hidden = true;
  }

  function updateScene(info) {
    if (panel.hidden || !info) return;
    show(info);
  }

  panel.querySelector("#flood-result-close")?.addEventListener("click", () => {
    hide();
    handlers.onClose?.();
  });
  panel.querySelector("#flood-result-replay")?.addEventListener("click", () =>
    handlers.onReplay?.(),
  );
  panel.querySelector("#flood-result-focus")?.addEventListener("click", () =>
    handlers.onFocus?.(),
  );
  panel.querySelector("#flood-result-clear")?.addEventListener("click", () =>
    handlers.onClear?.(),
  );
  
  window.addEventListener("flood-sim-progress", (e) => {
    if (panel.hidden) return;
    const bar = panel.querySelector("#flood-anim-bar");
    const riseVal = panel.querySelector("#flood-anim-rise-val");
    const frontVal = panel.querySelector("#flood-anim-front-val");
    const status = panel.querySelector("#flood-anim-status");
    
    // Also grab the static table values to make them live
    const currentWaterSpan = panel.querySelector("#flood-res-current-water");
    const waterRiseSpan = panel.querySelector("#flood-res-water-rise");
    const floodAreaSpan = panel.querySelector("#flood-res-flood-area");
    
    if (bar && riseVal && frontVal && e.detail) {
      const p = e.detail.progress;
      const info = e.detail.info || {};
      const riseMm = info.water_rise_mm ?? 0;
      bar.style.width = `${Math.round(p * 100)}%`;
      frontVal.textContent = `${Math.round(p * 100)}%`;
      
      const curRise = Math.round(riseMm * p);
      let riseStr = `+${curRise} mm`;
      if (curRise >= 1000) {
        riseStr = `+${(curRise / 1000).toFixed(2)} m`;
      }
      riseVal.textContent = riseStr;
      if (waterRiseSpan) waterRiseSpan.textContent = riseStr;
      
      if (currentWaterSpan) {
        const initialLevel = info.initial_water_level ?? info.current_water_level ?? 0;
        const curLevel = initialLevel + (riseMm / 1000) * p;
        currentWaterSpan.textContent = `${curLevel.toFixed(2)} m`;
      }
      
      if (floodAreaSpan) {
        if (info._current_flooded_area_ha != null) {
          const totalArea = info.flood_area_ha != null ? info.flood_area_ha.toFixed(2) : "—";
          floodAreaSpan.textContent = `${info._current_flooded_area_ha.toFixed(2)} ha / ${totalArea} ha`;
        } else if (info.flood_area_ha != null) {
          const curArea = info.flood_area_ha * p;
          floodAreaSpan.textContent = `${curArea.toFixed(2)} ha / ${info.flood_area_ha.toFixed(2)} ha`;
        }
      }
      
      const maxDepthSpan = panel.querySelector("#flood-res-max-depth");
      if (maxDepthSpan && info.max_depth_m != null) {
        maxDepthSpan.textContent = `${(info.max_depth_m * p).toFixed(2)} m`;
      }
      
      if (status) {
        status.textContent = "SIMULATING...";
        status.style.color = "var(--accent)";
      }
    }
  });
  
  window.addEventListener("flood-sim-complete", () => {
    if (panel.hidden) return;
    const status = panel.querySelector("#flood-anim-status");
    if (status) {
      status.textContent = "SIMULATION COMPLETE";
      status.style.color = "var(--success, #4caf50)";
    }
  });

  return { el: panel, show, hide, updateScene };
}

/** Compat alias for previous mountFloodInfoPanel name */
export const mountFloodInfoPanel = mountFloodResultPanel;
