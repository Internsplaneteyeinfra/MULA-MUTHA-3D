import { state } from "../state.js";
import { sceneName } from "../scene/cinematic.js";

export function createTooltip(root) {
  const el = document.createElement("div");
  el.className = "hud tooltip";
  root.appendChild(el);
  return {
    show(x, y, info) {
      el.style.left = `${Math.min(x, window.innerWidth - 300)}px`;
      el.style.top = `${Math.min(y, window.innerHeight - 280)}px`;
      el.classList.add("visible");
      if (info.chainageHover) {
        el.innerHTML = `
          <h3>CHAINAGE</h3>
          <div class="kv"><span class="k">Station</span><span class="v">${info.label ?? "—"}</span></div>
          <div class="kv"><span class="k">Meters</span><span class="v depth">${info.meters != null ? Math.round(info.meters) + " m" : "—"}</span></div>
        `;
        return;
      }
      if (info.compact) {
        el.innerHTML = `
          <h3>RIVER · HOVER</h3>
          <div class="kv"><span class="k">LAT</span><span class="v">${info.lat.toFixed(6)}° N</span></div>
          <div class="kv"><span class="k">LON</span><span class="v">${info.lon.toFixed(6)}° E</span></div>
          ${info.localX != null ? `<div class="kv"><span class="k">LOCAL X</span><span class="v">${info.localX.toFixed(1)} m</span></div>` : ""}
          ${info.localZ != null ? `<div class="kv"><span class="k">LOCAL Y</span><span class="v">${info.localZ.toFixed(1)} m</span></div>` : ""}
          ${info.landElevation != null ? `<div class="kv"><span class="k">TERRAIN</span><span class="v">${info.landElevation.toFixed(1)} m</span></div>` : ""}
          ${info.waterSurface != null ? `<div class="kv"><span class="k">WATER</span><span class="v">${info.waterSurface.toFixed(1)} m</span></div>` : ""}
          ${info.riverbedElevation != null ? `<div class="kv"><span class="k">RIVERBED</span><span class="v">${info.riverbedElevation.toFixed(1)} m</span></div>` : ""}
          <div class="kv"><span class="k">DEPTH</span><span class="v depth">${info.depth.toFixed(2)} m</span></div>
          ${info.flowDirection ? `<div class="kv"><span class="k">FLOW</span><span class="v">${info.flowDirection}${info.flowSpeed != null ? ` · ${info.flowSpeed.toFixed(1)} m/s` : ""}</span></div>` : ""}
          ${info.chainage ? `<div class="kv"><span class="k">CHAINAGE</span><span class="v">${info.chainage}</span></div>` : ""}
        `;
        return;
      }
      if (info.featureType) {
        el.innerHTML = `
          <h3>OSM · ${String(info.featureType).toUpperCase()}</h3>
          <div class="kv"><span class="k">OSM ID</span><span class="v">${info.osmId ?? "—"}</span></div>
          <div class="kv"><span class="k">Name</span><span class="v">${info.name ?? "—"}</span></div>
          <div class="kv"><span class="k">Longitude</span><span class="v">${info.lon?.toFixed?.(6) ?? "—"}°</span></div>
          <div class="kv"><span class="k">Latitude</span><span class="v">${info.lat?.toFixed?.(6) ?? "—"}°</span></div>
          <div class="kv"><span class="k">Height</span><span class="v">${info.height != null ? Number(info.height).toFixed(1) + " m" : "—"}</span></div>
          <div class="kv"><span class="k">Height source</span><span class="v">${info.height_source ?? "—"}</span></div>
          <div class="kv"><span class="k">Species</span><span class="v">${info.species ?? info.genus ?? "—"}</span></div>
          <div class="kv"><span class="k">Building</span><span class="v">${info.building ?? "—"}</span></div>
        `;
        return;
      }
      const swatch = info.color
        ? `<span class="swatch" style="background:${info.color}"></span>`
        : "";
      el.innerHTML = `
        <h3>${swatch}RIVER INSPECT</h3>
        <div class="kv"><span class="k">Longitude</span><span class="v">${info.lon.toFixed(6)}°</span></div>
        <div class="kv"><span class="k">Latitude</span><span class="v">${info.lat.toFixed(6)}°</span></div>
        <div class="kv"><span class="k">Terrain elevation</span><span class="v">${info.landElevation != null ? info.landElevation.toFixed(1) + " m" : "—"}</span></div>
        <div class="kv"><span class="k">Water surface</span><span class="v">${info.waterSurface != null ? info.waterSurface.toFixed(1) + " m" : "—"}</span></div>
        <div class="kv"><span class="k">Riverbed elevation</span><span class="v">${info.riverbedElevation != null ? info.riverbedElevation.toFixed(1) + " m" : "—"}</span></div>
        <div class="kv"><span class="k">Water depth</span><span class="v depth">${info.depth.toFixed(2)} m</span></div>
        <div class="kv"><span class="k">Depth source</span><span class="v">${info.depthLabel ?? info.kind}</span></div>
        <div class="kv"><span class="k">Flow direction</span><span class="v">${info.flowDirection ?? "—"}</span></div>
        <div class="kv"><span class="k">Chainage</span><span class="v">${info.chainage ?? "—"}</span></div>
        <div class="kv"><span class="k">Nearest fishing</span><span class="v">${info.nearestFishing ?? "—"}</span></div>
        <div class="kv"><span class="k">Nearest bridge</span><span class="v">${info.nearestBridge ?? "—"}</span></div>
      `;
    },
    hide() {
      el.classList.remove("visible");
    },
  };
}

/** Bridge info (top-right) + cinematic coordinate overlay. */
export function mountCinematicOverlays(root, dataset) {
  const bridgeEl = document.createElement("aside");
  bridgeEl.className = "hud bridge-info";
  bridgeEl.id = "bridge-info";
  bridgeEl.hidden = true;
  bridgeEl.innerHTML = `
    <strong>BRIDGE INFORMATION</strong>
    <div class="kv"><span class="k">Name</span><span class="v" id="bi-name">—</span></div>
    <div class="kv"><span class="k">Coordinates</span><span class="v" id="bi-coords">—</span></div>
    <div class="kv"><span class="k">River crossing</span><span class="v" id="bi-cross">—</span></div>
    <div class="kv"><span class="k">Length</span><span class="v" id="bi-len">—</span></div>
  `;
  root.appendChild(bridgeEl);

  const cineEl = document.createElement("aside");
  cineEl.className = "hud cine-info";
  cineEl.id = "cine-info";
  cineEl.hidden = true;
  cineEl.innerHTML = `
    <div class="cine-coords" id="cine-coords">—</div>
    <div class="cine-meta" id="cine-meta">—</div>
  `;
  root.appendChild(cineEl);

  function tick() {
    const focus = state.cinematicBridgeFocus;
    const showBridge = !!focus && state.cinematicActive && state.cinematicPhase === "bridge";
    bridgeEl.hidden = !showBridge;
    if (showBridge && focus) {
      bridgeEl.querySelector("#bi-name").textContent = focus.name || "Unnamed bridge";
      bridgeEl.querySelector("#bi-coords").textContent =
        focus.lon != null ? `${focus.lat.toFixed(6)}° N · ${focus.lon.toFixed(6)}° E` : "—";
      bridgeEl.querySelector("#bi-cross").textContent = focus.river || "Mula–Mutha";
      bridgeEl.querySelector("#bi-len").textContent =
        focus.lengthM != null ? `${Math.round(focus.lengthM)} m` : "—";
    }

    const info = state.cinematicInfo;
    const showCine = state.cinematicActive && info;
    cineEl.hidden = !showCine;
    if (showCine && info) {
      cineEl.querySelector("#cine-coords").textContent =
        `${info.lat.toFixed(6)}° N · ${info.lon.toFixed(6)}° E`;
      cineEl.querySelector("#cine-meta").textContent =
        `DEPTH: ${info.depth.toFixed(1)} m · FLOW: ${info.flowSpeed.toFixed(1)} m/s`;
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

export function mountUI(root, { onCamera, onStartWaterFlow, onTogglePauseWaterFlow, isCinematicActive, isCinematicPaused }) {
  root.insertAdjacentHTML(
    "beforeend",
    `
    <aside class="hud brand" id="hud-brand">
      <strong>MULA–MUTHA</strong>
      <p>3D Terrain + River · Chainage Analysis KML · EPSG:32643</p>
    </aside>

    <button type="button" class="hud flow-cta" id="start-flow">START WATER FLOW</button>
    <button type="button" class="hud flow-cta pause-cta" id="pause-flow" hidden>PAUSE</button>

    <nav class="hud bar" id="hud-bar">
      <button data-cam="overview">Overview</button>
      <button data-cam="local">Local 3D</button>
      <button data-cam="bathymetry">Bathymetry</button>
      <button data-cam="follow">River Path Follow</button>
      <button data-cam="reset">Reset</button>
      <button id="layers-btn">Layers</button>
    </nav>

    <aside class="hud depth-legend" id="depth-legend" aria-label="Water depth legend">
      <strong>WATER DEPTH</strong>
      <div class="depth-bar"></div>
      <div class="depth-ticks">
        <span>Shallow</span>
        <span>0.5</span>
        <span>1.0</span>
        <span>1.5</span>
        <span>2.0</span>
        <span>Deep</span>
      </div>
      <em class="depth-note">Excel bathymetry model</em>
    </aside>

    <section class="hud layers" id="layers-panel" hidden>
      <label><input id="water" type="checkbox" checked /> River (KML)</label>
      <label><input id="kml-skel" type="checkbox" /> KML ground skeleton <em>(Google Earth)</em></label>
      <label><input id="coord-grid" type="checkbox" /> Coordinate grid <em>(lat/lon lines)</em></label>
      <label><input id="validate-hud" type="checkbox" /> Projection validation</label>
      <label><input id="bath" type="checkbox" checked /> Bathymetry</label>
      <label><input id="ter" type="checkbox" checked /> Terrain <em>(FABDEM)</em></label>
      <label><input id="br" type="checkbox" checked /> Bridges</label>
      <label><input id="br-names" type="checkbox" /> Bridge names</label>
      <label><input id="urb-b" type="checkbox" checked /> Buildings</label>
      <label><input id="urb-r" type="checkbox" checked /> Roads</label>
      <label><input id="veg" type="checkbox" checked /> Trees / Vegetation</label>
      <label><input id="fish" type="checkbox" checked /> Fish / Fishing points</label>
      <label><input id="fish-debug" type="checkbox" checked /> Fish screen debug</label>
      <label><input id="chain" type="checkbox" checked /> Chainage</label>
      <div class="toolkit" id="chainage-toolkit">
        <strong>Chainage toolkit</strong>
        <label class="toolkit-emphasis"><input id="chain-labels" type="checkbox" /> Show numbers on all dots</label>
        <label class="radio-row"><input id="chain-mode-station" type="radio" name="chain-mode" value="station" checked /> Station <em>(0+000)</em></label>
        <label class="radio-row"><input id="chain-mode-meters" type="radio" name="chain-mode" value="meters" /> Meters <em>(12400 m)</em></label>
        <em class="toolkit-hint">Click a red pin — hover it for station / meters</em>
      </div>
      <div class="ctrl-row">Water opacity
        <input id="opacity" type="range" min="15" max="95" value="72" />
      </div>
      <div class="ctrl-row">Flow speed
        <input id="flow" type="range" min="0" max="150" value="65" />
      </div>
      <div class="ctrl-row">Flow visibility
        <input id="flowvis" type="range" min="0" max="100" value="100" />
      </div>
      <div class="exag-row">Z Exaggeration <em>(viz only)</em>
        <button type="button" data-exag="1">1×</button>
        <button type="button" data-exag="2" class="active">2×</button>
        <button type="button" data-exag="5">5×</button>
      </div>
    </section>

    <div class="hud timeline" id="path-scrub" hidden>
      <input id="scrub" type="range" min="0" max="1000" value="0" />
      <span class="scene-label" id="scene-label">OVERVIEW · FULL AOI</span>
    </div>
  `,
  );

  const scrub = root.querySelector("#scrub");
  const sceneLabel = root.querySelector("#scene-label");
  const layers = root.querySelector("#layers-panel");
  const pathScrub = root.querySelector("#path-scrub");
  const flowBtn = root.querySelector("#start-flow");
  const pauseBtn = root.querySelector("#pause-flow");
  const depthLegend = root.querySelector("#depth-legend");
  const brand = root.querySelector("#hud-brand") || root.querySelector("aside.hud.brand");
  const navBar = root.querySelector("#hud-bar") || root.querySelector("nav.hud.bar");

  const syncCamButtons = () => {
    root.querySelectorAll("[data-cam]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.cam === state.cameraMode);
    });
    if (depthLegend) {
      const cine = state.cinematicActive;
      depthLegend.hidden = cine || !(state.cameraMode === "bathymetry" || state.showBathymetry);
      depthLegend.style.opacity = state.cameraMode === "bathymetry" ? "1" : "0.85";
    }
  };

  function setCinematicHud(active) {
    if (brand) brand.hidden = active;
    if (navBar) navBar.hidden = active;
    if (flowBtn) flowBtn.hidden = active;
    if (pathScrub) pathScrub.hidden = active || state.cameraMode !== "follow";
    if (layers) {
      if (active) {
        layers.hidden = true;
        state.showLayers = false;
      }
    }
    if (pauseBtn) pauseBtn.hidden = true;
  }

  flowBtn?.addEventListener("click", () => {
    if (isCinematicActive?.()) return;
    const ok = onStartWaterFlow?.();
    if (ok === false) return;
    setCinematicHud(true);
  });

  pauseBtn?.addEventListener("click", () => {
    if (!isCinematicActive?.()) return;
    onTogglePauseWaterFlow?.();
    pauseBtn.textContent = isCinematicPaused?.() || state.cinematicPaused ? "RESUME" : "PAUSE";
  });

  root.querySelector("#layers-btn").addEventListener("click", () => {
    if (state.cinematicActive) return;
    state.showLayers = !state.showLayers;
    layers.hidden = !state.showLayers;
  });

  scrub.addEventListener("input", () => {
    state.pathT = Number(scrub.value) / 1000;
    state.playing = false;
    if (state.cameraMode !== "follow") onCamera("follow");
  });

  root.querySelector("#veg").addEventListener("change", (e) => {
    state.showVegetation = e.target.checked;
    state.showOsmTrees = e.target.checked;
  });
  root.querySelector("#fish")?.addEventListener("change", (e) => {
    state.showFish = e.target.checked;
  });
  root.querySelector("#fish-debug")?.addEventListener("change", (e) => {
    state.showFishDebug = e.target.checked;
  });
  root.querySelector("#chain")?.addEventListener("change", (e) => {
    state.showChainage = e.target.checked;
  });
  root.querySelector("#chain-labels")?.addEventListener("change", (e) => {
    state.showChainageLabels = e.target.checked;
  });
  const syncChainMode = () => {
    const meters = root.querySelector("#chain-mode-meters")?.checked;
    state.chainageLabelMode = meters ? "meters" : "station";
  };
  root.querySelector("#chain-mode-station")?.addEventListener("change", syncChainMode);
  root.querySelector("#chain-mode-meters")?.addEventListener("change", syncChainMode);
  const syncUrban = () => {
    state.showOsmBuildings = root.querySelector("#urb-b")?.checked ?? true;
    state.showOsmRoads = root.querySelector("#urb-r")?.checked ?? true;
    state.showUrban = state.showOsmBuildings || state.showOsmRoads;
  };
  root.querySelector("#urb-b")?.addEventListener("change", syncUrban);
  root.querySelector("#urb-r")?.addEventListener("change", syncUrban);
  root.querySelector("#br").addEventListener("change", (e) => {
    state.showBridges = e.target.checked;
  });
  root.querySelector("#br-names")?.addEventListener("change", (e) => {
    state.showBridgeNames = e.target.checked;
  });
  root.querySelector("#ter").addEventListener("change", (e) => {
    state.showTerrain = e.target.checked;
  });
  root.querySelector("#bath").addEventListener("change", (e) => {
    state.showBathymetry = e.target.checked;
  });
  root.querySelector("#water").addEventListener("change", (e) => {
    state.showWater = e.target.checked;
  });
  root.querySelector("#kml-skel")?.addEventListener("change", (e) => {
    state.showKmlSkeleton = e.target.checked;
  });
  root.querySelector("#coord-grid")?.addEventListener("change", (e) => {
    state.showCoordinateGrid = e.target.checked;
  });
  root.querySelector("#validate-hud")?.addEventListener("change", (e) => {
    state.showValidationHud = e.target.checked;
  });
  root.querySelector("#opacity").addEventListener("input", (e) => {
    state.waterOpacity = Number(e.target.value) / 100;
  });
  root.querySelector("#flow").addEventListener("input", (e) => {
    state.flowSpeed = Number(e.target.value) / 100;
  });
  root.querySelector("#flowvis").addEventListener("input", (e) => {
    state.flowVisibility = Number(e.target.value) / 100;
  });
  root.querySelectorAll("[data-exag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("[data-exag]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.depthExaggeration = Number(btn.dataset.exag);
    });
  });

  function setChecked(id, on) {
    const el = root.querySelector(`#${id}`);
    if (el) el.checked = !!on;
  }

  /** Sync Layers panel UI to current state (used by Reset). */
  function syncLayersPanelFromState() {
    setChecked("water", state.showWater);
    setChecked("kml-skel", state.showKmlSkeleton);
    setChecked("coord-grid", state.showCoordinateGrid);
    setChecked("validate-hud", state.showValidationHud);
    setChecked("bath", state.showBathymetry);
    setChecked("ter", state.showTerrain);
    setChecked("br", state.showBridges);
    setChecked("br-names", state.showBridgeNames);
    setChecked("urb-b", state.showOsmBuildings);
    setChecked("urb-r", state.showOsmRoads);
    setChecked("veg", state.showVegetation);
    setChecked("fish", state.showFish);
    setChecked("fish-debug", state.showFishDebug);
    setChecked("chain", state.showChainage);
    setChecked("chain-labels", state.showChainageLabels);
    const station = root.querySelector("#chain-mode-station");
    const meters = root.querySelector("#chain-mode-meters");
    if (station && meters) {
      const useMeters = state.chainageLabelMode === "meters";
      station.checked = !useMeters;
      meters.checked = useMeters;
    }
    const opacity = root.querySelector("#opacity");
    const flow = root.querySelector("#flow");
    const flowvis = root.querySelector("#flowvis");
    if (opacity) opacity.value = String(Math.round((state.waterOpacity ?? 0.72) * 100));
    if (flow) flow.value = String(Math.round((state.flowSpeed ?? 0.85) * 100));
    if (flowvis) flowvis.value = String(Math.round((state.flowVisibility ?? 1) * 100));
    root.querySelectorAll("[data-exag]").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.exag) === state.depthExaggeration);
    });
  }

  root.querySelectorAll("[data-cam]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.cinematicActive) return;
      const mode = btn.dataset.cam;
      onCamera(mode);
      if (mode === "reset") {
        syncLayersPanelFromState();
        // Always re-frame Overview even if already there
        onCamera("overview");
      }
      pathScrub.hidden = state.cameraMode !== "follow";
      syncCamButtons();
    });
  });

  let wasCinematic = false;
  function tickHud() {
    scrub.value = String(Math.round(state.pathT * 1000));
    const cine = !!state.cinematicActive;

    if (cine !== wasCinematic) {
      setCinematicHud(cine);
      wasCinematic = cine;
    }

    if (cine) {
      if (pauseBtn) pauseBtn.hidden = true;
      if (brand) brand.hidden = true;
      if (navBar) navBar.hidden = true;
      if (flowBtn) flowBtn.hidden = true;
      if (pathScrub) pathScrub.hidden = true;
    } else {
      if (pauseBtn) pauseBtn.hidden = true;
      if (brand) brand.hidden = false;
      if (navBar) navBar.hidden = false;
      if (flowBtn) {
        flowBtn.hidden = false;
        flowBtn.disabled = false;
        flowBtn.textContent = state.cinematicPhase === "complete" ? "REPLAY WATER FLOW" : "START WATER FLOW";
      }
      sceneLabel.textContent = sceneName(state.cameraMode);
      pathScrub.hidden = state.cameraMode !== "follow";
      scrub.hidden = false;
    }

    syncCamButtons();
    requestAnimationFrame(tickHud);
  }
  requestAnimationFrame(tickHud);
}
