import "./style.css";
import { loadJourneyDataset } from "./geo/load.js";
import { createWorld } from "./scene/world.js";
import { mountUI, createTooltip } from "./ui/overlay.js";

const loading = document.getElementById("loading");
const loadMsg = document.getElementById("load-msg");
const loadBar = document.getElementById("load-bar");
const canvas = document.getElementById("scene");
const uiRoot = document.getElementById("ui-root");

function progress(p, msg) {
  loadBar.style.width = `${Math.round(p * 100)}%`;
  if (msg) loadMsg.textContent = msg;
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

    progress(0.96, "Building geographic scene + GLB urban…");
    const tooltip = createTooltip(uiRoot);
    const app = await createWorld(canvas, dataset, tooltip);
    mountUI(uiRoot, {
      onCamera: (mode) => app.setCamera(mode),
      onStartWaterFlow: () => app.startWaterFlow(),
      onTogglePauseWaterFlow: () => app.togglePauseWaterFlow(),
      isCinematicActive: () => app.isCinematicActive(),
      isCinematicPaused: () => app.isCinematicPaused(),
    });

    loading.classList.add("hidden");

    let last = performance.now();
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      app.update(dt);
      requestAnimationFrame(loop);
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
