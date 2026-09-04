import { state } from "../state.js";
import { sceneName } from "../scene/cinematic.js";
import { mountProjectIdentity } from "./components/projectIdentity.js";
import { mountNavigationControls } from "./components/navigationControls.js";
import { mountCompassNavigation } from "./components/compassNavigation.js";
import { mountZoomControls } from "./components/zoomControls.js";
import { mountLayersPanel } from "./components/layersPanel.js";
import { mountWaterFlowControl } from "./components/waterFlowControl.js";
import { mountChainageRuler } from "./components/chainageRuler.js";
import { mountChainagePanel } from "./components/chainagePanel.js";
import { bindLayerIndicator } from "./components/layerToggle.js";

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
      if (info.nullahHover) {
        const row = (k, v) =>
          v != null && String(v).trim() !== ""
            ? `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`
            : "";
        el.innerHTML = `
          <h3>💧 DRAINAGE CHANNEL</h3>
          <div class="kv"><span class="k">Name</span><span class="v depth">${info.name ?? "Unnamed nullah"}</span></div>
          ${row("Type", info.typeLabel || info.waterway)}
          ${row("Length", info.lengthM != null ? `${Math.round(info.lengthM)} m` : "")}
          ${row("Flow", info.flowDirection)}
          ${row("Joins river", info.connectsToRiver == null ? "" : info.connectsToRiver ? "Yes" : "Nearby")}
          ${info.lat != null ? `<div class="kv"><span class="k">Latitude</span><span class="v">${Number(info.lat).toFixed(6)}° N</span></div>` : ""}
          ${info.lon != null ? `<div class="kv"><span class="k">Longitude</span><span class="v">${Number(info.lon).toFixed(6)}° E</span></div>` : ""}
          <em style="display:block;margin-top:6px;font-size:9px;color:var(--muted);">Water moving toward Mula–Mutha</em>
        `;
        return;
      }
      if (info.depthZoneHover) {
        const area =
          info.areaM2 != null
            ? `${Math.round(info.areaM2).toLocaleString()} m²`
            : "—";
        el.innerHTML = `
          <h3>💎 SELECTED WATER REGION</h3>
          <div class="kv"><span class="k">Depth class</span><span class="v depth">${info.depthClass ?? "—"} m</span></div>
          <div class="kv"><span class="k">Depth (mid)</span><span class="v">${info.depthMid != null ? Number(info.depthMid).toFixed(2) + " m" : "—"}</span></div>
          <div class="kv"><span class="k">Area</span><span class="v">${area}</span></div>
          <div class="kv"><span class="k">Feature ID</span><span class="v">${info.featureId ?? "—"}</span></div>
          <div class="kv"><span class="k">Elevation</span><span class="v">${info.elevation != null ? Number(info.elevation).toFixed(1) + " m" : "—"}</span></div>
          ${info.lat != null ? `<div class="kv"><span class="k">Latitude</span><span class="v">${Number(info.lat).toFixed(6)}° N</span></div>` : ""}
          ${info.lon != null ? `<div class="kv"><span class="k">Longitude</span><span class="v">${Number(info.lon).toFixed(6)}° E</span></div>` : ""}
          <em style="display:block;margin-top:6px;font-size:9px;color:var(--muted);">Real KML polygon · glassy viz only</em>
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

export function mountUI(root, {
  dataset,
  onCamera,
  onCompass,
  onResetOrientation,
  onZoomIn,
  onZoomOut,
  onStartWaterFlow,
  onTogglePauseWaterFlow,
  isCinematicActive,
  isCinematicPaused,
}) {
  root.classList.add("gis-ui");
  if (state.showLayers) root.classList.add("layers-open");

  mountProjectIdentity(root);
  const flowBtn = mountWaterFlowControl(root);
  if (flowBtn) flowBtn.hidden = true; // no floating start CTA; pause only during cinematic
  const { panel: layers } = mountLayersPanel(root);
  layers.hidden = !state.showLayers;

  let chainPanel = null;
  const nav = mountNavigationControls(root, {
    onOverview: () => {
      onCamera("overview");
      nav.syncActive();
      // Keep overview clean — close chainage side panel (notes stay collapsed next open)
      chainPanel?.close?.();
    },
    onRiverSide: () => {
      onCamera("local");
      nav.syncActive();
    },
    onLayersToggle: () => toggleLayers(),
  });
  nav.setLayersPressed(state.showLayers);

  const chainRuler = mountChainageRuler(root, dataset);
  chainPanel = mountChainagePanel(root, dataset);

  mountCompassNavigation(root, {
    onCompass: (dir) => onCompass?.(dir),
    onResetOrientation: () => onResetOrientation?.(),
  });
  mountZoomControls(root, { onZoomIn, onZoomOut });

  root.insertAdjacentHTML(
    "beforeend",
    `
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
    <div class="hud gis-timeline" id="path-scrub" hidden>
      <input id="scrub" type="range" min="0" max="1000" value="0" />
      <span class="scene-label" id="scene-label">OVERVIEW · FULL AOI</span>
    </div>
  `,
  );

  const scrub = root.querySelector("#scrub");
  const sceneLabel = root.querySelector("#scene-label");
  const pathScrub = root.querySelector("#path-scrub");
  const depthLegend = root.querySelector("#depth-legend");
  const brand = root.querySelector("#hud-brand");
  const navWrap = root.querySelector(".gis-nav-wrap");
  const toolsStack = root.querySelector(".gis-tools-stack");

  function toggleLayers(force) {
    const open = force ?? !state.showLayers;
    state.showLayers = open;
    layers.hidden = !open;
    root.classList.toggle("layers-open", open);
    nav.setLayersPressed(open);
  }

  root.querySelector("#layers-close")?.addEventListener("click", () => toggleLayers(false));

  layers.querySelector("#layer-reset")?.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onCamera("reset");
    syncLayersPanelFromState();
    onCamera("overview");
    nav.syncActive();
  });
  layers.querySelector("#layer-bath-cam")?.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onCamera("bathymetry");
    nav.syncActive();
  });
  layers.querySelector("#layer-flow-path")?.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onCamera("follow");
    pathScrub.hidden = false;
    nav.syncActive();
  });
  layers.querySelector("#layer-river-cinematic")?.addEventListener("click", () => {
    if (state.cinematicActive) return;
    const ok = onStartWaterFlow?.();
    if (ok === false) return;
    setCinematicHud(true);
    toggleLayers(false);
  });

  function syncCamButtons() {
    nav.syncActive();
    if (depthLegend) {
      const cine = state.cinematicActive;
      depthLegend.hidden = cine || !(state.cameraMode === "bathymetry" || state.showBathymetry);
      depthLegend.style.opacity = state.cameraMode === "bathymetry" ? "1" : "0.85";
    }
  }

  function setCinematicHud(active) {
    if (brand) brand.hidden = active;
    if (navWrap) navWrap.hidden = active;
    if (toolsStack) toolsStack.hidden = active;
    if (flowBtn) flowBtn.hidden = !active; // pause control only while cinematic runs
    if (pathScrub) pathScrub.hidden = active || state.cameraMode !== "follow";
    if (active) toggleLayers(false);
  }

  flowBtn?.addEventListener("click", () => {
    if (isCinematicActive?.()) {
      onTogglePauseWaterFlow?.();
      return;
    }
    const ok = onStartWaterFlow?.();
    if (ok === false) return;
    setCinematicHud(true);
  });

  scrub.addEventListener("input", () => {
    state.pathT = Number(scrub.value) / 1000;
    state.playing = false;
    if (state.cameraMode !== "follow") onCamera("follow");
  });

  // Urban / vegetation / fish / bridges geometry stay in scene — no Layers UI.
  // Optional listeners kept only if legacy markup is reintroduced.
  root.querySelector("#veg")?.addEventListener("change", (e) => {
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
    const stationRow = root.querySelector("#chain-mode-station")?.closest(".layer-row");
    const metersRow = root.querySelector("#chain-mode-meters")?.closest(".layer-row");
    if (stationRow) {
      stationRow.querySelector(".layer-indicator").textContent = !meters ? "🟧" : "⬜";
      stationRow.classList.toggle("is-on", !meters);
    }
    if (metersRow) {
      metersRow.querySelector(".layer-indicator").textContent = meters ? "🟧" : "⬜";
      metersRow.classList.toggle("is-on", !!meters);
    }
  };
  root.querySelector("#chain-mode-station")?.addEventListener("change", syncChainMode);
  root.querySelector("#chain-mode-meters")?.addEventListener("change", syncChainMode);
  syncChainMode();

  const syncUrban = () => {
    state.showOsmBuildings = root.querySelector("#urb-b")?.checked ?? true;
    state.showOsmRoads = root.querySelector("#urb-r")?.checked ?? true;
    state.showUrban = state.showOsmBuildings || state.showOsmRoads;
  };
  root.querySelector("#urb-b")?.addEventListener("change", syncUrban);
  root.querySelector("#urb-r")?.addEventListener("change", syncUrban);
  root.querySelector("#br")?.addEventListener("change", (e) => {
    state.showBridges = e.target.checked;
  });
  root.querySelector("#br-names")?.addEventListener("change", (e) => {
    state.showBridgeNames = e.target.checked;
  });
  root.querySelector("#ter")?.addEventListener("change", (e) => {
    state.showTerrain = e.target.checked;
  });
  root.querySelector("#bath")?.addEventListener("change", (e) => {
    state.showBathymetry = e.target.checked;
  });
  root.querySelector("#water")?.addEventListener("change", (e) => {
    state.showWater = e.target.checked;
  });
  function setMapReferenceGrid(on) {
    state.showMapReferenceGrid = !!on;
    state.showKmlSkeleton = !!on;
    state.showCoordinateGrid = !!on;
  }
  root.querySelector("#map-ref-grid")?.addEventListener("change", (e) => {
    setMapReferenceGrid(e.target.checked);
  });
  // Legacy separate toggles (if present) stay in sync with combined control
  root.querySelector("#kml-skel")?.addEventListener("change", (e) => {
    state.showKmlSkeleton = e.target.checked;
    state.showMapReferenceGrid = state.showKmlSkeleton && state.showCoordinateGrid;
  });
  root.querySelector("#coord-grid")?.addEventListener("change", (e) => {
    state.showCoordinateGrid = e.target.checked;
    state.showMapReferenceGrid = state.showKmlSkeleton && state.showCoordinateGrid;
  });
  root.querySelector("#drainage")?.addEventListener("change", (e) => {
    state.showDrainage = e.target.checked;
    state.showNallaFlow = e.target.checked;
    const statsEl = root.querySelector("#drainage-stats");
    if (statsEl) {
      if (!e.target.checked) {
        statsEl.textContent = "";
      } else {
        const stats = window.__MM_SCENE__?.getDrainageStats?.();
        const n = datasetCountFallback(stats);
        statsEl.textContent = n
          ? `Drainage channels that join Mula–Mutha (${n.chains ?? n.features} channels). Water flows automatically along the paths.`
          : "Drainage channels that join the main river. Water flows automatically when this layer is on.";
      }
    }
  });

  root.querySelector("#depth-zones")?.addEventListener("change", (e) => {
    state.showDepthZones = e.target.checked;
    const toolkit = root.querySelector("#glassy-toolkit");
    if (toolkit) toolkit.hidden = !e.target.checked;
    const statsEl = root.querySelector("#depth-zones-stats");
    if (statsEl) {
      if (!e.target.checked) {
        statsEl.textContent = "";
        window.__MM_SCENE__?.depthZonesLayer?.userData?.setSelected?.(null);
      } else {
        state.glassyRevealActive = true;
        window.__MM_SCENE__?.depthZonesLayer?.userData?.playReveal?.();
        const stats = window.__MM_SCENE__?.getDepthZonesStats?.();
        const n = stats?.polygons || window.__MM_SCENE__?.dataset?.depthZones?.length || 0;
        statsEl.textContent = n
          ? `Glassy Jul 2026 depth polygons (real KML). Cyan → blue → violet by depth. (${n} polygons · shared GPU shader)`
          : "Jul 2026 depth-class bands (glassy flow).";
      }
    }
  });
  root.querySelector("#glassy-flow")?.addEventListener("change", (e) => {
    state.glassyAnimatedFlow = e.target.checked;
  });
  root.querySelector("#glassy-opacity")?.addEventListener("input", (e) => {
    state.glassyWaterOpacity = Number(e.target.value) / 100;
  });
  root.querySelector("#glassy-speed")?.addEventListener("input", (e) => {
    state.glassyFlowSpeed = Number(e.target.value) / 100;
  });
  function syncGlassyMode() {
    const data = root.querySelector("#glassy-mode-data");
    state.glassyVizMode = data?.checked ? "data" : "cinematic";
    root.querySelectorAll("[name=glassy-mode]").forEach((inp) => {
      const row = inp.closest(".layer-row");
      const ind = row?.querySelector(".layer-indicator");
      if (ind) ind.textContent = inp.checked ? "🟧" : "⬜";
    });
  }
  root.querySelector("#glassy-mode-cine")?.addEventListener("change", syncGlassyMode);
  root.querySelector("#glassy-mode-data")?.addEventListener("change", syncGlassyMode);

  function datasetCountFallback(stats) {
    if (stats?.features) return stats;
    const nFeat = window.__MM_SCENE__?.dataset?.drainage?.length || 0;
    return nFeat ? { features: nFeat, chains: "?", bridges: 0 } : null;
  }
  root.querySelector("#opacity")?.addEventListener("input", (e) => {
    state.waterOpacity = Number(e.target.value) / 100;
  });
  root.querySelector("#flow")?.addEventListener("input", (e) => {
    state.flowSpeed = Number(e.target.value) / 100;
  });
  root.querySelector("#flowvis")?.addEventListener("input", (e) => {
    state.flowVisibility = Number(e.target.value) / 100;
  });
  function syncFloodLabel(cm) {
    const label = root.querySelector("#flood-label");
    if (label) label.textContent = `+${(cm / 100).toFixed(1)} m`;
  }
  root.querySelector("#flood")?.addEventListener("input", (e) => {
    const cm = Number(e.target.value) || 0;
    state.floodRiseM = cm / 100;
    syncFloodLabel(cm);
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

  function syncLayersPanelFromState() {
    setChecked("water", state.showWater);
    setChecked("drainage", state.showDrainage);
    setChecked(
      "map-ref-grid",
      state.showMapReferenceGrid || (state.showKmlSkeleton && state.showCoordinateGrid),
    );
    setChecked("depth-zones", state.showDepthZones);
    setChecked("glassy-flow", state.glassyAnimatedFlow);
    const toolkit = root.querySelector("#glassy-toolkit");
    if (toolkit) toolkit.hidden = !state.showDepthZones;
    const cine = root.querySelector("#glassy-mode-cine");
    const dataMode = root.querySelector("#glassy-mode-data");
    if (cine && dataMode) {
      const isData = state.glassyVizMode === "data";
      cine.checked = !isData;
      dataMode.checked = isData;
      syncGlassyMode();
    }
    const gOp = root.querySelector("#glassy-opacity");
    const gSp = root.querySelector("#glassy-speed");
    if (gOp) gOp.value = String(Math.round((state.glassyWaterOpacity ?? 0.72) * 100));
    if (gSp) gSp.value = String(Math.round((state.glassyFlowSpeed ?? 0.45) * 100));
    setChecked("br-names", state.showBridgeNames);
    setChecked("chain", state.showChainage);
    setChecked("chain-labels", state.showChainageLabels);
    const station = root.querySelector("#chain-mode-station");
    const meters = root.querySelector("#chain-mode-meters");
    if (station && meters) {
      const useMeters = state.chainageLabelMode === "meters";
      station.checked = !useMeters;
      meters.checked = useMeters;
    }
    syncChainMode();
    const opacity = root.querySelector("#opacity");
    const flow = root.querySelector("#flow");
    const flowvis = root.querySelector("#flowvis");
    if (opacity) opacity.value = String(Math.round((state.waterOpacity ?? 0.72) * 100));
    if (flow) flow.value = String(Math.round((state.flowSpeed ?? 0.85) * 100));
    if (flowvis) flowvis.value = String(Math.round((state.flowVisibility ?? 0) * 100));
    const flood = root.querySelector("#flood");
    if (flood) {
      const cm = Math.round((state.floodRiseM ?? 0) * 100);
      flood.value = String(cm);
      syncFloodLabel(cm);
    }
    root.querySelectorAll("[data-exag]").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.exag) === state.depthExaggeration);
    });
    ["water", "drainage", "map-ref-grid", "depth-zones", "br-names", "chain", "chain-labels", "glassy-flow"].forEach(
      (id) => bindLayerIndicator(root, id),
    );
  }

  let wasCinematic = false;
  let lastHud = 0;
  function tickHud(now) {
    // HUD doesn't need 60fps — saves main-thread work when port-sharing
    if (now - lastHud < 80) {
      requestAnimationFrame(tickHud);
      return;
    }
    lastHud = now;
    scrub.value = String(Math.round(state.pathT * 1000));
    const cine = !!state.cinematicActive;

    if (cine !== wasCinematic) {
      setCinematicHud(cine);
      wasCinematic = cine;
    }

    if (cine) {
      if (brand) brand.hidden = true;
      if (navWrap) navWrap.hidden = true;
      if (toolsStack) toolsStack.hidden = true;
      if (pathScrub) pathScrub.hidden = true;
      if (chainPanel?.el) chainPanel.el.hidden = true;
      if (flowBtn) {
        flowBtn.hidden = false;
        const paused = isCinematicPaused?.() || state.cinematicPaused;
        flowBtn.textContent = paused ? "▶ RESUME WATER FLOW" : "⏸ PAUSE WATER FLOW";
      }
    } else {
      if (brand) brand.hidden = false;
      if (navWrap) navWrap.hidden = false;
      if (toolsStack) toolsStack.hidden = false;
      if (flowBtn) {
        flowBtn.hidden = true;
        flowBtn.disabled = false;
        flowBtn.textContent = "💧 START WATER FLOW";
      }
      sceneLabel.textContent = sceneName(state.cameraMode);
      pathScrub.hidden = state.cameraMode !== "follow";
      scrub.hidden = false;
    }

    chainRuler?.update?.();
    syncCamButtons();
    requestAnimationFrame(tickHud);
  }
  requestAnimationFrame(tickHud);

  syncLayersPanelFromState();
}
