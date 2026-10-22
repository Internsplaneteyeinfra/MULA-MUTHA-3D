import "./style.css";
import "./styles/gis-ui.css";
import "./weather/weather.css";
import "./styles/layers-panel.css";
import "./styles/silt-pro.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { LandingPageApp } from "./cinematic/LandingPageApp.jsx";
import { loadJourneyDataset } from "./geo/load.js";
import { createWorld } from "./scene/world.js";
import { mountUI, createTooltip, mountCinematicOverlays } from "./ui/overlay.js";
import { registerServiceWorker } from "./cache/registerServiceWorker.js";
import { fetchBodCodViewerData } from "./services/bodCodService.js";
import { mountAppLoader, hideLoader } from "./ui/appLoader.js";

registerServiceWorker();
// Droplet loader is for flood sync / flood run only — not the cinematic boot.
mountAppLoader();
hideLoader("boot", { immediate: true });

const landingRootEl = document.getElementById("landing-root");
let landingReactRoot = null;
let gisBootPromise = null;

const urlParams = new URLSearchParams(window.location.search);
let currentMode = urlParams.get("mode") || "cinematic";

function mountLandingPage() {
  if (landingRootEl) {
    landingRootEl.style.display = "block";
    if (!landingReactRoot) {
      landingReactRoot = ReactDOM.createRoot(landingRootEl);
    }
    landingReactRoot.render(React.createElement(LandingPageApp));
  }
}

function ensureGisBoot() {
  if (!gisBootPromise) gisBootPromise = boot();
  return gisBootPromise;
}

async function switchToGis() {
  const bootPromise = ensureGisBoot();
  // The film's last frame (the RIVER.EYE title) stays on screen, with a progress line, until the
  // scene is built — no blank loader in between. Live film (no video): show the progress card.
  const holdsTitle = !!document.querySelector(".landing-film-video");
  if (!holdsTitle) {
    filmPlaying = false;
    window.__riverEye?.setActive?.(false);
    if (landingRootEl) landingRootEl.style.display = "none";
    if (!gisBootDone) loading.classList.remove("hidden");
  }
  const ready = await bootPromise;
  filmPlaying = false;
  window.__riverEye?.setActive?.(false);
  if (landingRootEl) landingRootEl.style.display = "none";
  if (!ready) return false;
  currentMode = "gis";
  revealGis();
  window.dispatchEvent(new Event("rivereye-gis-ready"));
  return true;
}

let gisBootDone = false;
/** Hide the loader and fly into 3D — once, after both the scene is loaded and the film is over. */
function revealGis() {
  if (gisRevealed || filmPlaying || !gisBootDone) return;
  gisRevealed = true;
  loading.classList.add("hidden");
  if (uiRoot) uiRoot.style.visibility = "";
  setTimeout(() => window.__MM_NAV__?.enter3D?.({ meters: INTRO_3D_CHAINAGE_M, dur: 3.2 }), 700);
}

function switchToCinematic() {
  currentMode = "cinematic";
  mountLandingPage();
  window.__riverEye?.restart?.();
}

window.addEventListener("open-cinematic-landing", () => {
  switchToCinematic();
});

const loading = document.getElementById("loading");
const loadMsg = document.getElementById("load-msg");
const loadBar = document.getElementById("load-bar");
const loadPercent = document.getElementById("load-percent");
const canvas = document.getElementById("scene");
const uiRoot = document.getElementById("ui-root");
let renderRiver = false;
/** True while the landing film plays: the GIS scene loads in the background but does not render. */
let filmPlaying = currentMode === "cinematic";
let gisRevealed = false;

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
  window.dispatchEvent(new CustomEvent("rivereye-gis-progress", { detail: { pct: targetProgress, msg: loadMsg.textContent } }));
  if (!progressFrame) progressFrame = requestAnimationFrame(animateProgress);
}

const INTRO_3D_CHAINAGE_M = 8790;

/** Large files the river scene loads — fetched while the film plays so the build does not wait on them. */
const GIS_PREFETCH = [
  "/data/osm_buildings.geojson",
  "/data/osm_roads.geojson",
  "/data/trees.geojson",
  "/data/tree_rows.geojson",
  "/data/vegetation.geojson",
  "/data/feature_metadata.json",
  "/data/osm_water.geojson",
  "/data/water_features.geojson",
  "/data/bridges.geojson",
  "/data/FABDEM_DTM_FINAL.tif",
  "/data/mula_mutha_water_depth.csv",
  "/data/Mula-Mutha_River_10m_ch_merged.kml",
  "/data/naditwin/chainage_profile.json",
  "/data/naditwin/depth_profile.json",
  "/data/naditwin/landmarks.json",
  "/data/naditwin/raw_bathymetry_cloud.json",
  "/data/hydrology/lulc/index.json",
  "/data/hydrology/lulc/2026/overlay.png",
  "/data/hydrology/vegetation/vegetation_type_overlay.png",
  "/data/bathymetry/mula_mutha_depth_overlay.png",
];

function prefetchGisData() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  let i = 0;
  // Two at a time, low priority: the film's video stream keeps the bandwidth it needs.
  const next = () => {
    const url = GIS_PREFETCH[i++];
    if (!url || gisBootPromise) return;
    fetch(base + url, { priority: "low" })
      .then((r) => r.blob())
      .catch(() => {})
      .finally(next);
  };
  next();
  next();
}

function showRiverBackdrop() {
  if (renderRiver) return;
  renderRiver = true;
  window.dispatchEvent(new Event("rivereye-river-backdrop"));
}

async function boot() {
  try {
    if (!filmPlaying) loading.classList.remove("hidden");
    if (uiRoot) uiRoot.style.visibility = "hidden";
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
      onQualityChange: (tier) => app.setQuality?.(tier),
    });

    let last = performance.now();
    let paused = false;
    document.addEventListener("visibilitychange", () => {
      paused = document.hidden;
      last = performance.now();
    });
    function loop(now) {
      requestAnimationFrame(loop);
      // While the film plays the scene is built but not drawn (keeps the film smooth).
      if (paused || filmPlaying || (!renderRiver && currentMode !== "gis")) return;
      const rawDt = (now - last) / 1000;
      last = now;
      const dt = Math.min(0.1, Math.max(0.001, rawDt));
      app.update(dt);
    }
    app.update(0.016);
    showRiverBackdrop();
    requestAnimationFrame(loop);

    await Promise.all([
      app.whenReady,
      firstLiveData,
      Promise.race([bodCodReady, new Promise((resolve) => setTimeout(resolve, 8000))]),
    ]);
    progress(0.995, "Finalising…");
    try {
      window.__MM_SCENE__?.warmUp3DView?.(INTRO_3D_CHAINAGE_M, window.__MM_NAV__?.view3DPose);
    } catch (err) {
      console.warn("[boot] 3D warm-up skipped:", err?.message || err);
    }
    progress(1, "Ready");
    await new Promise((resolve) => {
      const wait = () => (displayedProgress >= 99.5 ? resolve() : requestAnimationFrame(wait));
      wait();
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    gisBootDone = true;
    revealGis();
    return true;
  } catch (err) {
    console.error("[boot] failed — full stack:", err);
    if (err?.stack) console.error(err.stack);
    showRiverBackdrop();
    loadMsg.textContent = `Error: ${err?.message || err}`;
    targetProgress = 100;
    if (loadBar) {
      loadBar.style.width = "100%";
      loadBar.style.background = "#c45";
    }
    return false;
  }
}

if (currentMode === "cinematic") {
  // The GIS journey card sits underneath the film. Hide it so it cannot cover the opening or return when the film ends.
  loading.classList.add("hidden");
  mountLandingPage();
  // Building the scene blocks the main thread for seconds at a time, which would freeze the film.
  // So: download the project's data now (network only), and build at the final title card
  // (rivereye-film-near-end), which can hold still while the scene finishes.
  // (Nothing while the film is being recorded: ?capture=1 must give Cesium the whole machine.)
  if (!urlParams.has("capture")) {
    // After the film itself has downloaded (stored video) — never compete with its stream.
    window.addEventListener("rivereye-film-downloaded", prefetchGisData, { once: true });
    if (urlParams.has("live")) setTimeout(prefetchGisData, 1500);
    window.addEventListener("rivereye-film-near-end", () => void ensureGisBoot(), { once: true });
  }
  window.addEventListener("rivereye-film-error", () => { void switchToGis(); }, { once: true });
  window.addEventListener(
    "rivereye-film-complete",
    () => { void switchToGis(); },
    { once: true },
  );
} else {
  void ensureGisBoot();
}
