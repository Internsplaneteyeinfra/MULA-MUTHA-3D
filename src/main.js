import "./style.css";
import "./styles/gis-ui.css";
import "./weather/weather.css";
import "./styles/layers-panel.css";
import "./styles/silt-pro.css";
import { loadJourneyDataset } from "./geo/load.js";
import { createWorld } from "./scene/world.js";
import { mountUI, createTooltip, mountCinematicOverlays } from "./ui/overlay.js";
import { registerServiceWorker } from "./cache/registerServiceWorker.js";
import { createLoadingScene } from "./loadingScene.js";
import { fetchBodCodViewerData } from "./services/bodCodService.js";

registerServiceWorker();

const loading = document.getElementById("loading");
const loadMsg = document.getElementById("load-msg");
const loadBar = document.getElementById("load-bar");
const loadPercent = document.getElementById("load-percent");
const canvas = document.getElementById("scene");
const uiRoot = document.getElementById("ui-root");
const loadingScene = createLoadingScene(document.getElementById("loading-scene"));

let targetProgress = 0;
let displayedProgress = 0;
let progressFrame = 0;

function animateProgress() {
  displayedProgress += (targetProgress - displayedProgress) * 0.12;
  if (Math.abs(targetProgress - displayedProgress) < 0.08) displayedProgress = targetProgress;
  if (loadBar) loadBar.style.width = `${displayedProgress}%`;
  if (loadPercent) loadPercent.textContent = `${Math.round(displayedProgress)}%`;
  if (displayedProgress !== targetProgress || !loading.classList.contains("hidden")) {
    progressFrame = requestAnimationFrame(animateProgress);
  } else {
    progressFrame = 0;
  }
}

function progress(p, msg) {
  targetProgress = Math.max(0, Math.min(100, Number(p) * 100));
  if (msg) loadMsg.textContent = msg;
  if (!progressFrame) progressFrame = requestAnimationFrame(animateProgress);
}

const INTRO_3D_CHAINAGE_M = 8790;

async function boot() {
  try {
    // Server round trip is slow (~40 s when the viewer id has expired): start it now, in parallel with the scene load.
    const bodCodReady = fetchBodCodViewerData().catch((err) => {
      console.warn("[bod-cod] prefetch failed:", err?.message || err);
      return null;
    });
    const dataset = await loadJourneyDataset({
      csvUrl: "/data/mula_mutha_water_depth.csv",
      riverCoordsUrl: "/data/Mula_MuthaAOI_3_full_coordinates.csv",
      kmlUrl: "/data/Mula_MuthaAOI_2.kml",
      kmlFallbacks: [
        `/data/${encodeURIComponent("Mula_MuthaAOI(2).kml")}`,
        "/data/Mula_MuthaAOI.kml",
        "/data/mula_mutha_river.kml",
      ],
      onProgress: progress,
    });

    if (!dataset.validation.ok) {
      console.error("Validation issues — check layer overlap", dataset.validation.issues);
      // Hard-stop only when bathymetry/KML clearly do not overlap
      const fatal = (dataset.validation.issues || []).some((i) =>
        /does not overlap/i.test(i),
      );
      if (fatal) {
        throw new Error(`Projection mismatch: ${dataset.validation.issues.join("; ")}`);
      }
    }

    progress(0.96, "Building geographic scene…");
    const tooltip = createTooltip(uiRoot);
    mountCinematicOverlays(uiRoot, dataset);

    // Keep the loader up until buildings, trees, fishing, hydrology and live data are in.
    const app = await createWorld(canvas, dataset, tooltip, {
      onCoreReady() {
        progress(0.97, "Loading buildings, roads and vegetation…");
      },
    });

    const firstLiveData = Promise.race([
      new Promise((resolve) => {
        let weather = false;
        let discharge = false;
        const check = () => weather && discharge && resolve();
        document.addEventListener("chainage-weather", () => { weather = true; check(); }, { once: true });
        document.addEventListener("chainage-discharge", () => { discharge = true; check(); }, { once: true });
      }),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);

    mountUI(uiRoot, {
      dataset,
      onCamera: (mode) => app.setCamera(mode),
      onCompass: (dir) => app.rotateCompass(dir),
      onResetOrientation: () => app.resetOrientation(),
      onZoomIn: () => app.zoomIn(),
      onZoomOut: () => app.zoomOut(),
      onStartWaterFlow: () => app.startWaterFlow(),
      onTogglePauseWaterFlow: () => app.togglePauseWaterFlow(),
      isCinematicActive: () => app.isCinematicActive(),
      isCinematicPaused: () => app.isCinematicPaused(),
    });

    let last = performance.now();
    let paused = false;
    document.addEventListener("visibilitychange", () => {
      paused = document.hidden;
      last = performance.now();
    });
    function loop(now) {
      requestAnimationFrame(loop);
      if (paused) return;
      const rawDt = (now - last) / 1000;
      last = now;
      // Clamp dt between 1ms and 100ms to gracefully handle tab pauses or brief frame spikes
      const dt = Math.min(0.1, Math.max(0.001, rawDt));
      app.update(dt);
    }
    requestAnimationFrame(loop);

    // Scene renders behind the loader so shaders/textures warm up before reveal.
    // Core 3D world (terrain, river, bridges, urban) gate with a fast 6s safety timeout.
    // Live weather, discharge telemetry, and bodCod fetch in the background without blocking load.
    await Promise.race([
      app.whenReady,
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ]);
    progress(0.995, "Finalising…");
    try {
      window.__MM_SCENE__?.warmUp3DView?.(INTRO_3D_CHAINAGE_M, window.__MM_NAV__?.view3DPose);
    } catch (err) {
      console.warn("[boot] 3D warm-up skipped:", err?.message || err);
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 400))));
    progress(1, "Ready");
    loading.classList.add("hidden");
    loadingScene.setVisible(false);
    // Land in 2D, then let the user watch the VIEW → 3D flight down to the river
    // (8+790, low over the water looking downstream at Mundhwa Bridge).
    setTimeout(() => window.__MM_NAV__?.enter3D?.({ meters: INTRO_3D_CHAINAGE_M, dur: 3.2 }), 700);
  } catch (err) {
    console.error("[boot] failed — full stack:", err);
    if (err?.stack) console.error(err.stack);
    loadMsg.textContent = `Error: ${err?.message || err}`;
    targetProgress = 100;
    if (loadBar) {
      loadBar.style.width = "100%";
      loadBar.style.background = "#c45";
    }
  }
}

boot();
