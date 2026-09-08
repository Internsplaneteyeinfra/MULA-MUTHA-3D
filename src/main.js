import "./style.css";
import "./styles/gis-ui.css";
import "./styles/layers-panel.css";
import { loadJourneyDataset } from "./geo/load.js";
import { createWorld } from "./scene/world.js";
import { mountUI, createTooltip, mountCinematicOverlays } from "./ui/overlay.js";
import { registerServiceWorker } from "./cache/registerServiceWorker.js";
import { createLoadingScene } from "./loadingScene.js";

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

async function boot() {
  try {
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

    let sceneReady = false;
    const app = await createWorld(canvas, dataset, tooltip, {
      onCoreReady() {
        if (sceneReady) return;
        sceneReady = true;
        loading.classList.add("hidden");
        loadingScene.setVisible(false);
      },
    });

    if (!sceneReady) {
      loading.classList.add("hidden");
      loadingScene.setVisible(false);
    }

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
    let frameBudget = 0;
    function loop(now) {
      requestAnimationFrame(loop);
      const rawDt = (now - last) / 1000;
      last = now;
      const q = app.getQuality?.() || { targetFps: 60 };
      // Cap update rate on shared/low quality so GPU stays responsive
      const minDt = 1 / Math.max(20, q.targetFps || 60);
      frameBudget += rawDt;
      if (frameBudget < minDt * 0.92) return;
      const dt = Math.min(0.05, frameBudget);
      frameBudget = 0;
      app.update(dt);
    }
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    loadMsg.textContent = `Error: ${err.message}`;
    loadBar.style.width = "100%";
    loadBar.style.background = "#c45";
  }
}

boot();
