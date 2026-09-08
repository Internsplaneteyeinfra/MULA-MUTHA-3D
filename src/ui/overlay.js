import { state } from "../state.js";
import { sceneName } from "../scene/cinematic.js";
import { mountProjectIdentity } from "./components/projectIdentity.js";
import { mountWeatherWidget } from "./components/weatherWidget.js";
import { mountAnalyticsControls } from "./components/analyticsControls.js";
import { mountRiverDataPanel } from "./components/riverDataPanel.js";
import { interpolateChainage } from "../geo/chainage.js";
import { mountNavigationControls } from "./components/navigationControls.js";
import { mountCompassNavigation } from "./components/compassNavigation.js";
import { mountZoomControls } from "./components/zoomControls.js";
import { mountLayersPanel } from "./components/layersPanel.js";
import { mountSettingsPanel } from "./components/settingsPanel.js";
import { mountWaterFlowControl } from "./components/waterFlowControl.js";
import { mountChainageRuler } from "./components/chainageRuler.js";
import { mountChainagePanel } from "./components/chainagePanel.js";
import { mountFloodSimulationToolbar } from "./floodSimulationToolbar.js";
import { mountFloodResultPanel } from "./floodResultPanel.js";
import { mountFloodPlaybackControls } from "./floodPlaybackControls.js";
import { bindLayerIndicator } from "./components/layerToggle.js";
import {
  runFloodSimulation,
  cancelJalnetraFloodRequest,
  shiftApiDate,
  todayApiDate,
  getFloodStatus,
} from "../services/jalnetraFloodService.js";

const cancelFloodSimulationRequest = cancelJalnetraFloodRequest;

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
  mountAnalyticsControls(root, dataset);
  const weather = mountWeatherWidget(root);
  const riverData = mountRiverDataPanel(root, dataset);
  const flowBtn = mountWaterFlowControl(root);
  if (flowBtn) flowBtn.hidden = true; // no floating start CTA; pause only during cinematic
  const { panel: layers } = mountLayersPanel(root);
  layers.hidden = !state.showLayers;
  const { panel: settings } = mountSettingsPanel(root);
  settings.hidden = !state.showSettings;

  mountCompassNavigation(root, {
    onCompass: (dir) => onCompass?.(dir),
    onResetOrientation: () => onResetOrientation?.(),
  });
  mountZoomControls(root, { onZoomIn, onZoomOut });

  const floodInfo = mountFloodResultPanel(root, {
    onReplay: () => window.__MM_SCENE__?.replayFloodSimulation?.(),
    onFocus: () => window.__MM_SCENE__?.focusFloodSimulation?.(),
    onClear: () => clearApiFloodUi(),
  });

  const floodPlayback = mountFloodPlaybackControls(root, {
    onPlay: () => {
      state.apiFlood.isPlaying = true;
      window.__MM_SCENE__?.playFloodTimeline?.();
    },
    onPause: () => {
      state.apiFlood.isPlaying = false;
      window.__MM_SCENE__?.pauseFloodSimulation?.();
    },
    onReplay: () => {
      state.apiFlood.currentScene = 0;
      window.__MM_SCENE__?.setFloodScene?.(0);
      window.__MM_SCENE__?.playFloodTimeline?.();
      floodPlayback.setIndex(0);
      syncApiFloodFromLayer();
    },
    onSeek: (index) => {
      state.apiFlood.currentScene = index;
      window.__MM_SCENE__?.setFloodScene?.(index);
      syncApiFloodFromLayer();
    },
  });

  function setLpFloodStatus(text, kind = "") {
    const wrap = root.querySelector("#lp-flood-status");
    const label = root.querySelector(".lp-flood-status-text");
    const dot = root.querySelector(".lp-flood-status-dot");
    if (label) label.textContent = text ? `Status · ${text}` : "Status · Idle";
    if (wrap) wrap.dataset.kind = kind || "";
    if (dot) dot.dataset.kind = kind || "";
  }

  function syncIllustrativeDisabled() {
    const stage = root.querySelector("#lp-illustrative-stage");
    const apiOn = state.floodMode === "api";
    if (stage) stage.classList.toggle("is-disabled", apiOn);
    const floodInput = root.querySelector("#flood");
    if (floodInput) floodInput.disabled = apiOn;
  }

  function syncApiFloodFromLayer() {
    const info = window.__MM_SCENE__?.apiFloodLayer?.userData?.getInfo?.() || state.apiFlood.result?.info;
    if (info) {
      state.apiFlood.result = { ...(state.apiFlood.result || {}), info };
      state.floodSimInfo = info;
      floodInfo.updateScene(info);
      const idx = window.__MM_SCENE__?.apiFloodLayer?.userData?.getSceneIndex?.() ?? state.apiFlood.currentScene;
      state.apiFlood.currentScene = idx;
      state.apiFlood.currentDate = info.scene_date || null;
      floodPlayback.setIndex(idx);
    }
    syncFloodSimStats();
  }

  function clearApiFloodUi() {
    window.__MM_SCENE__?.clearFloodSimulation?.();
    floodBar?.setStatus("");
    floodInfo.hide();
    floodPlayback.hide();
    state.apiFlood = {
      ...state.apiFlood,
      status: "idle",
      result: null,
      scenes: [],
      currentScene: 0,
      currentDate: null,
      isPlaying: false,
      progress: 0,
      error: null,
      errorDetails: null,
      message: "",
    };
    state.floodSimStatus = "idle";
    state.floodSimMessage = "";
    state.floodSimInfo = null;
    setLpFloodStatus("Idle", "");
    syncFloodSimStats();
    syncIllustrativeDisabled();
  }

  async function applyFloodResult(result, bar) {
    const apply = window.__MM_SCENE__?.applyFloodSimulation;
    if (typeof apply !== "function") {
      throw new Error("3D scene is not ready yet. Wait for the map to finish loading, then try again.");
    }
    apply(result);
    const scenes = result.scenes || [];
    state.floodMode = "api";
    state.apiFlood = {
      ...state.apiFlood,
      status: "ready",
      result,
      scenes,
      currentScene: result.currentScene ?? 0,
      currentDate: result.info?.scene_date || null,
      isPlaying: true,
      progress: 0,
      error: null,
      errorDetails: null,
      message: "",
      showLayer: true,
    };
    state.floodSimStatus = "ready";
    state.floodSimInfo = result.info;
    state.floodSimMessage = "";
    state.showFloodSimulation = true;
    setChecked("flood-sim", true);
    window.__MM_SCENE__?.apiFloodLayer?.setVisible?.(true);
    floodInfo.show(result.info);
    floodPlayback.setScenes(scenes, result.currentScene ?? 0);
    if (scenes.length >= 2) floodPlayback.show();
    const ha =
      typeof result.info?.flood_area_ha === "number"
        ? `${result.info.flood_area_ha.toFixed(2)} ha`
        : "ready";
    const msg = `Flood Ready · ${result.info?.scene_date || "scene"} · ${ha}`;
    bar.setStatus(msg, "ok");
    setLpFloodStatus("Complete", "ok");
    syncFloodSimStats();
    syncIllustrativeDisabled();
    window.__MM_SCENE__?.playFloodSimulation?.();
    setTimeout(() => window.__MM_SCENE__?.focusFloodSimulation?.(), 80);
  }

  async function executeFloodRun(opts, bar) {
    cancelFloodSimulationRequest();
    state.apiFlood.status = "loading";
    state.apiFlood.error = null;
    state.apiFlood.errorDetails = null;
    state.floodSimStatus = "loading";
    state.floodSimMessage = "Preparing KML…";
    bar.setStatus("Preparing KML…", "loading");
    setLpFloodStatus("Running", "loading");
    try {
      const result = await runFloodSimulation({
        ...opts,
        onProgress: (msg) => {
          bar.setStatus(msg, "loading");
          const st = getFloodStatus();
          state.apiFlood.status = st.status === "ready" ? "running" : st.status;
          state.apiFlood.message = msg;
          state.floodSimStatus = /receiv|build|visual|overlay/i.test(msg || "")
            ? "processing"
            : "loading";
          setLpFloodStatus(
            st.status === "loading" ? "Running" : "Running",
            "loading",
          );
        },
      });
      bar.setStatus("Building visualization…", "loading");
      setLpFloodStatus("Running", "loading");
      await applyFloodResult(result, bar);
      return result;
    } catch (err) {
      const aborted =
        err?.name === "AbortError" || /cancel/i.test(err?.message || "");
      const st = getFloodStatus();
      if (!aborted) {
        state.apiFlood.status = "error";
        state.apiFlood.error = "Flood simulation could not be completed.";
        state.apiFlood.errorDetails = st.details || err?.message || String(err);
        state.floodSimStatus = "error";
        state.floodSimMessage = state.apiFlood.error;
        bar.setStatus(state.apiFlood.error, "error");
        setLpFloodStatus("Error", "error");
        floodInfo.show(null, {
          error: true,
          errorDetails: state.apiFlood.errorDetails,
        });
      } else {
        state.apiFlood.status = "idle";
        state.floodSimStatus = "idle";
        bar.setStatus("");
        setLpFloodStatus("Idle", "");
      }
      syncIllustrativeDisabled();
      throw err;
    } finally {
      bar.setBusy?.(false);
    }
  }

  const floodBar = mountFloodSimulationToolbar(root, {
    onRun: async ({ start_date, end_date }) => {
      await executeFloodRun(
        {
          start_date,
          end_date,
          preferDate: end_date,
          autoWiden: true,
        },
        floodBar,
      );
    },
    onToday: async ({ start_date, end_date, preferDate }) => {
      const end = end_date || todayApiDate();
      const start = start_date || shiftApiDate(end, -45);
      floodBar.setDates(start, end);
      await executeFloodRun(
        {
          start_date: start,
          end_date: end,
          preferDate: preferDate || end,
          autoWiden: true,
        },
        floodBar,
      );
    },
  });
  // Hidden until Flood map-control is pressed
  if (floodBar?.el) floodBar.el.hidden = !state.showFloodBar;

  window.__MM_FLOOD__ = {
    clear: clearApiFloodUi,
    play: () => window.__MM_SCENE__?.playFloodSimulation?.(),
    replay: () => window.__MM_SCENE__?.replayFloodSimulation?.(),
    run: (opts) => executeFloodRun(opts, floodBar),
  };

  function syncFloodSimStats() {
    const el = root.querySelector("#flood-sim-stats");
    if (!el) return;
    const info = state.floodSimInfo || state.apiFlood?.result?.info;
    const status = state.apiFlood?.status || state.floodSimStatus;
    if (status === "loading" || status === "running") {
      el.textContent = state.apiFlood?.message || "Running JalNetra flood simulation…";
      return;
    }
    if (status === "error") {
      el.textContent = state.apiFlood?.error || state.floodSimMessage || "Flood simulation error.";
      return;
    }
    if (!info) {
      el.textContent = "Use the top Flood Simulation bar to run.";
      return;
    }
    const bits = [];
    if (info.scene_date) bits.push(info.scene_date);
    if (typeof info.flood_area_ha === "number") bits.push(`${info.flood_area_ha.toFixed(2)} ha flood`);
    if (typeof info.water_area_ha === "number") bits.push(`${info.water_area_ha.toFixed(2)} ha water`);
    if (info.total_scenes > 1) bits.push(`${info.current_scene || 1}/${info.total_scenes} scenes`);
    el.textContent = bits.join(" · ") || "Flood extent loaded.";
  }

  let chainPanel = null;
  const nav = mountNavigationControls(root, {
    onOverview: () => {
      onCamera("overview");
      nav.syncActive();
      // Keep overview clean — close chainage side panel (notes stay collapsed next open)
      chainPanel?.close?.();
    },
    onRiverSide: () => {
      onCamera("aerial");
      nav.syncActive();
    },
    onLayersToggle: () => toggleLayers(),
    onDrainageToggle: () => toggleDrainage(),
    onSettingsToggle: () => toggleSettings(),
    onFloodToggle: () => toggleFloodBar(),
  });
  nav.setLayersPressed(state.showLayers);
  nav.setDrainagePressed?.(state.showDrainage);
  nav.setSettingsPressed?.(state.showSettings);
  nav.setFloodPressed?.(state.showFloodBar);

  const chainRuler = mountChainageRuler(root, dataset);
  chainPanel = mountChainagePanel(root, dataset);

  function syncSelectedChainage(meters) {
    const point = interpolateChainage(dataset.chainage, meters);
    if (!point) return;
    riverData.update(point);
    weather.updateForChainage(point);
  }

  document.addEventListener("chainage-select", (event) => {
    syncSelectedChainage(event.detail?.meters);
  });
  const initialChainage = state.selectedChainageMeters ?? dataset.chainage?.[0]?.meters;
  if (initialChainage != null) {
    state.selectedChainageMeters = initialChainage;
    syncSelectedChainage(initialChainage);
  }

  const depthMin = Number.isFinite(dataset.minDepth) ? dataset.minDepth : 0.5;
  const depthMax = Number.isFinite(dataset.maxDepth) ? dataset.maxDepth : 2.0;
  const depthStep = (depthMax - depthMin) / 3;

  root.insertAdjacentHTML(
    "beforeend",
    `
    <aside class="hud depth-legend depth-legend--vertical map-chrome" id="depth-legend" aria-label="Water depth legend">
      <strong>WATER DEPTH</strong>
      <div class="depth-legend-body">
        <div class="depth-bar" aria-hidden="true"></div>
        <div class="depth-ticks">
          <span>Shallow</span>
          <span>${depthMin.toFixed(2)}</span>
          <span>${(depthMin + depthStep).toFixed(2)}</span>
          <span>${(depthMin + depthStep * 2).toFixed(2)}</span>
          <span>${depthMax.toFixed(2)}</span>
          <span>Deep</span>
        </div>
      </div>
      <em class="depth-note">${dataset.dtm ? "FABDEM DTM + Excel bathymetry" : "Excel bathymetry model"}</em>
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
    if (open) toggleSettings(false);
    layers.hidden = !open;
    root.classList.toggle("layers-open", open);
    nav.setLayersPressed(open);
  }

  function toggleSettings(force) {
    const open = force ?? !state.showSettings;
    state.showSettings = open;
    if (open) toggleLayers(false);
    settings.hidden = !open;
    nav.setSettingsPressed?.(open);
  }

  function toggleDrainage(force) {
    const on = force ?? !state.showDrainage;
    state.showDrainage = on;
    state.showNallaFlow = on;
    window.__MM_SCENE__?.setDrainageFlow?.(on);
    nav.setDrainagePressed?.(on);
  }

  function toggleFloodBar(force) {
    const open = force ?? !state.showFloodBar;
    state.showFloodBar = open;
    if (floodBar?.el) floodBar.el.hidden = !open;
    nav.setFloodPressed?.(open);
    // When opening Flood controls, keep the toolbar easy to find
    if (open && floodBar?.el) {
      floodBar.el.classList.add("is-open");
    } else if (floodBar?.el) {
      floodBar.el.classList.remove("is-open");
    }
  }

  root.querySelector("#layers-close")?.addEventListener("click", () => toggleLayers(false));
  root.querySelector("#settings-close")?.addEventListener("click", () => toggleSettings(false));

  root.querySelector("#layer-reset")?.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onCamera("reset");
    syncLayersPanelFromState();
    onCamera("overview");
    nav.syncActive();
  });
  root.querySelector("#layer-bath-cam")?.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onCamera("bathymetry");
    nav.syncActive();
  });
  root.querySelector("#layer-flow-path")?.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onCamera("follow");
    pathScrub.hidden = false;
    nav.syncActive();
  });
  root.querySelector("#layer-river-cinematic")?.addEventListener("click", () => {
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
      // Show depth legend with River on, or when River off (ground deep view)
      const showLegend =
        !cine &&
        (state.showWater || state.cameraMode === "bathymetry" || state.showBathymetry);
      depthLegend.hidden = !showLegend;
      depthLegend.style.opacity = state.cameraMode === "bathymetry" || !state.showWater ? "1" : "0.85";
      const title = depthLegend.querySelector("strong");
      if (title) {
        title.textContent = state.showWater ? "WATER DEPTH" : "CHANNEL DEPTH";
      }
      const note = depthLegend.querySelector(".depth-note");
      if (note) {
        note.textContent = state.showWater
          ? dataset.dtm
            ? "FABDEM DTM + Excel bathymetry"
            : "Excel bathymetry model"
          : dataset.dtm
            ? "Ground deep view · FABDEM DTM + Excel bathymetry"
            : "Ground deep view · Excel bathymetry";
      }
    }
  }

  function setCinematicHud(active) {
    if (brand) brand.hidden = active;
    if (navWrap) navWrap.hidden = active;
    if (toolsStack) toolsStack.hidden = active;
    if (flowBtn) flowBtn.hidden = !active; // pause control only while cinematic runs
    if (pathScrub) pathScrub.hidden = active || state.cameraMode !== "follow";
    if (active) {
      toggleLayers(false);
      toggleSettings(false);
    }
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

  // Vegetation is always on — keep OSM + JalNetra visible together.
  root.querySelector("#veg")?.addEventListener("change", (e) => {
    e.target.checked = true;
    state.showVegetation = true;
    state.showOsmTrees = true;
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
    root.querySelectorAll('input[name="chain-mode"]').forEach((inp) => {
      inp.closest(".lp-row")?.classList.toggle("is-on", !!inp.checked);
    });
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
  root.querySelector("#bath")?.addEventListener("change", (e) => {
    state.showBathymetry = e.target.checked;
  });
  root.querySelector("#water")?.addEventListener("change", (e) => {
    state.showWater = e.target.checked;
    window.__MM_SCENE__?.setRiverVisible?.(e.target.checked);
    syncCamButtons();
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
          ? `SURVEY / INTERPOLATED DEPTH · measured depth zones (${n} polygons · shared GPU shader)`
          : "SURVEY / INTERPOLATED DEPTH · visualized by measured depth_m.";
      }
    }
  });
  root.querySelector("#raw-survey-points")?.addEventListener("change", (e) => {
    state.showRawSurveyPoints = e.target.checked;
    window.__MM_SCENE__?.setRawSurveyPointsVisible?.(e.target.checked);
  });
  root.querySelector("#flood-sim")?.addEventListener("change", (e) => {
    state.showFloodSimulation = e.target.checked;
    state.apiFlood.showLayer = e.target.checked;
    window.__MM_SCENE__?.apiFloodLayer?.setVisible?.(e.target.checked);
    window.__MM_SCENE__?.floodSimLayer?.setVisible?.(e.target.checked);
    syncFloodSimStats();
  });

  document.addEventListener("mm-flood-scene", () => {
    syncApiFloodFromLayer();
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
      inp.closest(".lp-row")?.classList.toggle("is-on", !!inp.checked);
    });
  }
  root.querySelector("#glassy-mode-cine")?.addEventListener("change", syncGlassyMode);
  root.querySelector("#glassy-mode-data")?.addEventListener("change", syncGlassyMode);

  root.querySelector("#opacity")?.addEventListener("input", (e) => {
    state.waterOpacity = Number(e.target.value) / 100;
  });
  root.querySelector("#flow")?.addEventListener("input", (e) => {
    // Safe range (0.20–1.00): min still moves; max stays calm/cinematic
    const v = Math.max(0.2, Math.min(1, Number(e.target.value) / 100));
    state.flowSpeed = v;
    state.waterOverallSpeed = Math.max(0.25, Math.min(0.95, v * 0.85 + 0.1));
  });
  root.querySelector("#flowvis")?.addEventListener("input", (e) => {
    state.flowVisibility = Number(e.target.value) / 100;
  });
  root.querySelector("#water-anim")?.addEventListener("change", (e) => {
    state.waterAnimEnabled = e.target.checked;
  });
  root.querySelector("#water-preset")?.addEventListener("change", (e) => {
    window.__MM_SCENE__?.applyWaterPreset?.(e.target.value);
    syncLayersPanelFromState();
  });
  root.querySelector("#water-overall")?.addEventListener("input", (e) => {
    state.waterOverallSpeed = Number(e.target.value) / 100;
  });
  root.querySelector("#water-primary-amp")?.addEventListener("input", (e) => {
    state.primaryWaveAmplitude = Number(e.target.value) / 100;
  });
  root.querySelector("#water-ripple")?.addEventListener("input", (e) => {
    state.rippleAmplitude = Number(e.target.value) / 100;
  });
  root.querySelectorAll("[data-wq]").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("[data-wq]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.waterQuality = btn.dataset.wq;
    });
  });

  // ── Sky & Atmosphere ──
  const syncSky = () => window.__MM_SCENE__?.atmosphericSky?.syncFromState?.();
  root.querySelector("#sky-enabled")?.addEventListener("change", (e) => {
    state.skyEnabled = e.target.checked;
    window.__MM_SCENE__?.atmosphericSky?.setEnabled?.(e.target.checked);
  });
  root.querySelector("#sky-preset")?.addEventListener("change", (e) => {
    window.__MM_SCENE__?.atmosphericSky?.applyPreset?.(e.target.value);
    syncLayersPanelFromState();
  });
  root.querySelector("#sky-cloud-density")?.addEventListener("input", (e) => {
    state.skyCloudDensity = Number(e.target.value) / 100;
    syncSky();
  });
  root.querySelector("#sky-cloud-speed")?.addEventListener("input", (e) => {
    state.skyCloudSpeed = Number(e.target.value) / 100;
    syncSky();
  });
  root.querySelector("#sky-sun")?.addEventListener("input", (e) => {
    state.skySunIntensity = Number(e.target.value) / 100;
    syncSky();
  });
  root.querySelector("#sky-atmosphere")?.addEventListener("input", (e) => {
    state.skyAtmosphere = Number(e.target.value) / 100;
    syncSky();
  });
  root.querySelector("#sky-haze")?.addEventListener("input", (e) => {
    state.skyHorizonHaze = Number(e.target.value) / 100;
    syncSky();
  });
  root.querySelector("#sky-shadows")?.addEventListener("change", (e) => {
    state.skyCloudShadows = e.target.checked;
    syncSky();
  });
  root.querySelectorAll("[data-sky-q]").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("[data-sky-q]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.skyQuality = btn.dataset.skyQ;
      syncSky();
    });
  });

  function syncFloodLabel(cm) {
    const label = root.querySelector("#flood-label");
    if (label) label.textContent = `+${(cm / 100).toFixed(1)} m`;
  }
  root.querySelector("#flood")?.addEventListener("input", (e) => {
    if (state.floodMode === "api") return;
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
    setChecked("raw-survey-points", state.showRawSurveyPoints);
    setChecked("flood-sim", state.showFloodSimulation !== false);
    setChecked("glassy-flow", state.glassyAnimatedFlow);
    setChecked("water-anim", state.waterAnimEnabled !== false);
    setChecked("sky-enabled", state.skyEnabled !== false);
    setChecked("sky-shadows", state.skyCloudShadows !== false);
    const skyPreset = root.querySelector("#sky-preset");
    if (skyPreset) skyPreset.value = state.skyPreset || "calmRealistic";
    const skyDens = root.querySelector("#sky-cloud-density");
    const skySpd = root.querySelector("#sky-cloud-speed");
    const skySun = root.querySelector("#sky-sun");
    const skyAtm = root.querySelector("#sky-atmosphere");
    const skyHz = root.querySelector("#sky-haze");
    if (skyDens) skyDens.value = String(Math.round((state.skyCloudDensity ?? 0.42) * 100));
    if (skySpd) skySpd.value = String(Math.round((state.skyCloudSpeed ?? 0.32) * 100));
    if (skySun) skySun.value = String(Math.round((state.skySunIntensity ?? 1) * 100));
    if (skyAtm) skyAtm.value = String(Math.round((state.skyAtmosphere ?? 0.55) * 100));
    if (skyHz) skyHz.value = String(Math.round((state.skyHorizonHaze ?? 0.48) * 100));
    root.querySelectorAll("[data-sky-q]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.skyQ === (state.skyQuality || "high"));
    });
    const waterPreset = root.querySelector("#water-preset");
    if (waterPreset) waterPreset.value = state.waterPreset || "calmRealistic";
    const wOverall = root.querySelector("#water-overall");
    const wPrim = root.querySelector("#water-primary-amp");
    const wRip = root.querySelector("#water-ripple");
    if (wOverall) wOverall.value = String(Math.round((state.waterOverallSpeed ?? 0.55) * 100));
    if (wPrim) wPrim.value = String(Math.round((state.primaryWaveAmplitude ?? 0.14) * 100));
    if (wRip) wRip.value = String(Math.round((state.rippleAmplitude ?? 0.035) * 100));
    root.querySelectorAll("[data-wq]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.wq === (state.waterQuality || "high"));
    });
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
    if (flow) {
      const flowPct = Math.round((state.flowSpeed ?? 0.45) * 100);
      flow.value = String(Math.max(20, Math.min(100, flowPct)));
    }
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
    ["water", "drainage", "map-ref-grid", "depth-zones", "raw-survey-points", "flood-sim", "br-names", "chain", "chain-labels", "glassy-flow", "water-anim", "sky-enabled", "sky-shadows"].forEach(
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
  syncFloodSimStats();
}
