import "./style.css";
import "./styles/gis-ui.css";
import "./weather/weather.css";
import "./styles/layers-panel.css";
import "./styles/silt-pro.css";
import { loadJourneyDataset } from "./geo/load.js";
import { createWorld } from "./scene/world.js";
import { mountUI, createTooltip, mountCinematicOverlays } from "./ui/overlay.js";
import { registerServiceWorker } from "./cache/registerServiceWorker.js";
import { fetchBodCodViewerData } from "./services/bodCodService.js";
import { mountAppLoader, hideLoader } from "./ui/appLoader.js";

registerServiceWorker();
// Droplet loader is for flood sync / flood run only — not boot.
mountAppLoader();
hideLoader("boot", { immediate: true });

const canvas = document.getElementById("scene");
const uiRoot = document.getElementById("ui-root");

const INTRO_3D_CHAINAGE_M = 8790;

async function boot() {
  try {
    // Server round trip is slow (~40 s when the viewer id has expired): start it now, in parallel with the scene load.
    const bodCodReady = fetchBodCodViewerData().catch((err) => {
      console.warn("[bod-cod] prefetch failed:", err?.message || err);
      return null;
    });
    void bodCodReady;

    const dataset = await loadJourneyDataset({
      csvUrl: "/data/mula_mutha_water_depth.csv",
      riverCoordsUrl: "/data/Mula_MuthaAOI_3_full_coordinates.csv",
      kmlUrl: "/data/Mula_MuthaAOI_2.kml",
      kmlFallbacks: [
        `/data/${encodeURIComponent("Mula_MuthaAOI(2).kml")}`,
        "/data/Mula_MuthaAOI.kml",
        "/data/mula_mutha_river.kml",
      ],
      onProgress: () => {},
    });

    if (!dataset.validation.ok) {
      console.error("Validation issues — check layer overlap", dataset.validation.issues);
      const fatal = (dataset.validation.issues || []).some((i) =>
        /does not overlap/i.test(i),
      );
      if (fatal) {
        throw new Error(`Projection mismatch: ${dataset.validation.issues.join("; ")}`);
      }
    }

    const tooltip = createTooltip(uiRoot);
    mountCinematicOverlays(uiRoot, dataset);

    const app = await createWorld(canvas, dataset, tooltip, {
      onCoreReady() {},
    });

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
      const dt = Math.min(0.1, Math.max(0.001, rawDt));
      app.update(dt);
    }
    requestAnimationFrame(loop);

    await Promise.race([
      app.whenReady,
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ]);
    try {
      window.__MM_SCENE__?.warmUp3DView?.(INTRO_3D_CHAINAGE_M, window.__MM_NAV__?.view3DPose);
    } catch (err) {
      console.warn("[boot] 3D warm-up skipped:", err?.message || err);
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    setTimeout(() => window.__MM_NAV__?.enter3D?.({ meters: INTRO_3D_CHAINAGE_M, dur: 3.2 }), 700);
  } catch (err) {
    console.error("[boot] failed — full stack:", err);
    if (err?.stack) console.error(err.stack);
  }
}

boot();
