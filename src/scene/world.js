import * as THREE from "three";
import { state } from "../state.js";
import { createTerrain } from "./terrain.js";
import { createKmlSkeleton } from "./kmlSkeleton.js";
import { createRiver, applyExaggeration, applyRiverLook, SURFACE_Y } from "./river.js";
import { createUrban } from "./urban.js";
import { createVegetation } from "./vegetation.js";
import { createVegetationApiLayer } from "./vegetationApiLayer.js";
import { fetchVegetationForAoi } from "../services/vegetationService.js";
import { mountVegetationStatus } from "../ui/components/vegetationStatus.js";
import { createBridges, updateBridgeLabels, updateBridgePiers } from "./bridges.js";
import { createCameraSystem } from "./cinematic.js";
import { attachInspect } from "./inspect.js";
import { createRiverWidthMeasure } from "./riverWidthMeasure.js";
import { createFlowParticles } from "./flowParticles.js";
import { createWaterEffects } from "./waterEffects.js";
import { createChainageLayer, nearestChainage } from "./chainageMarkers.js";
import { createProjectionValidation } from "./validation.js";
import { createCoordinateGrid, mountCoordinateLabels } from "./coordinateGrid.js";
import { createRiverBankOverlay } from "./riverBanks.js";
import { createDrainageLayer } from "./drainageLayer.js";
import { createNallaFlowSystem } from "./drainage/nallaFlowSystem.js";
import { createDepthZonesLayer } from "./depthZonesLayer.js";
import { createFloodLayer } from "./floodLayer.js";
import { createApiFloodLayer } from "./apiFloodLayer.js";
import { createHydrologyLayer } from "./hydrologyLayer.js";
import { createMainStemLayer } from "./mainStemLayer.js";
import { fillPierUniforms, syncWaterMaterial, applyWaterPreset, getWaterDebugInfo } from "./waterShader.js";
import { createFishingSystem } from "../features/fishing/createFishingSystem.js";
import { createCinematicController } from "../animation/cinematicController.js";
import { computeActiveSceneBounds, computeSceneBounds } from "../geo/sceneBounds.js";
import { createQualityProfile, createThrottle } from "../perf/quality.js";
import { createAtmosphericSky } from "./sky/atmosphericSky.js";
import { interpolateChainage } from "../geo/chainage.js";
import mainStemKmlRaw from "../data/main stream.kml?raw";

export async function createWorld(canvas, dataset, tooltip, { onCoreReady } = {}) {
  const quality = createQualityProfile();
  let q = quality.get();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: q.antialias,
    powerPreference: "high-performance",
    // preserveDrawingBuffer costs a full GPU copy every frame — only for screenshots
    preserveDrawingBuffer: q.preserveDrawingBuffer,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatioMax));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = q.softShadow
    ? THREE.PCFSoftShadowMap
    : THREE.BasicShadowMap;

  if (q.tier !== "high") {
    console.info(
      `[perf] Quality=${q.tier} (shared/remote-friendly). Use ?quality=high for full local detail.`,
    );
  }

  const scene = new THREE.Scene();
  // Match terrain grass/olive so overview doesn’t look like a cut-out on white
  const GROUND_SURROUND = "#6a7e5c";
  const GROUND_FOG = "#7a8e6e";
  const MAP2D_SURROUND = "#c5d0bc"; // clean GIS surround (no green fog wash)
  scene.background = null; // cinematic sky dome provides background
  const fogDensity = dataset.dtm ? 0.000022 : 0.00004;
  const groundFog = new THREE.FogExp2(GROUND_FOG, fogDensity);
  scene.fog = groundFog;
  scene.userData.groundSurround = GROUND_SURROUND;
  scene.userData.groundFog = GROUND_FOG;

  // Soft daylight — warm sun + cooler sky bounce (buildings only benefit; hydrology unchanged)
  const hemi = new THREE.HemisphereLight(0xd5e4ee, 0x6a5e4c, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6c8, 1.48);
  sun.position.set(-2400, 3400, 1500);
  sun.castShadow = q.shadows;
  if (q.shadows) {
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.04;
    sun.shadow.camera.left = -5000;
    sun.shadow.camera.right = 5000;
    sun.shadow.camera.top = 2800;
    sun.shadow.camera.bottom = -2800;
    sun.shadow.camera.far = 14000;
  }
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xb4c4d4, 0.32);
  fill.position.set(1600, 900, -1400);
  scene.add(fill);

  const sceneBounds = computeSceneBounds(dataset);
  const atmosphericSky = createAtmosphericSky({
    scene,
    sun,
    hemi,
    fill,
    renderer,
    bounds: sceneBounds,
  });
  // Seed sky quality from render tier when user hasn't forced a sky tier
  if (!new URLSearchParams(location.search).get("skyQuality")) {
    state.skyQuality = q.tier === "low" ? "low" : q.tier === "medium" ? "medium" : "high";
    atmosphericSky.syncFromState();
  }

  const LIGHT_DEFAULT = { hemi: 0.95, sun: 1.48, fill: 0.32 };
  const LIGHT_MAP2D = { hemi: 1.14, sun: 1.05, fill: 0.55 };

  function isMap2DMode() {
    const m = state.cameraMode;
    return m === "aerial" || m === "top" || m === "2d";
  }

  /** Crisp GIS lighting — no fog/haze (Overview keeps atmosphere). */
  function applyMap2DClarity() {
    scene.fog = null;
    atmosphericSky.setVisible(false);
    scene.background = new THREE.Color(MAP2D_SURROUND);
    hemi.intensity = LIGHT_MAP2D.hemi;
    sun.intensity = LIGHT_MAP2D.sun;
    fill.intensity = LIGHT_MAP2D.fill;
    sun.castShadow = false;
    renderer.toneMappingExposure = 1.22;
  }

  function restoreAtmosphereClarity() {
    if (scene.fog !== groundFog) scene.fog = groundFog;
    scene.background = null;
    atmosphericSky.setVisible(state.skyEnabled !== false);
    sun.castShadow = q.shadows && state.skyEnabled !== false;
  }

  const terrain = createTerrain(dataset);
  const kmlSkeleton = createKmlSkeleton(dataset);
  const river = createRiver(dataset);
  const coordinateGrid = createCoordinateGrid(dataset);
  const riverBanks = createRiverBankOverlay(dataset);
  const drainageLayer = createDrainageLayer(dataset);
  const nallaFlow = createNallaFlowSystem(dataset, drainageLayer, {
    uiRoot: document.getElementById("ui-root"),
  });
  drainageLayer.add(nallaFlow);
  const mainStemLayer = createMainStemLayer(dataset, mainStemKmlRaw);
  const depthZonesLayer = createDepthZonesLayer(dataset);
  const rawSurveyPoints = createRawSurveyPointLayer(dataset);
  const floodLayer = createFloodLayer(dataset);
  /** MODE A — JalNetra API flood (source of truth for inundation extent). */
  const apiFloodLayer = createApiFloodLayer(dataset);
  /** Hydrology thematic overlays (Geology + Salinity). */
  const hydrologyLayer = createHydrologyLayer(dataset);
  /** @deprecated alias — prefer apiFloodLayer */
  const floodSimLayer = apiFloodLayer;
  fillPierUniforms(river.material, dataset);
  applyWaterPreset(state.waterPreset || "calmRealistic");
  syncWaterMaterial(river.material);
  console.info(
    "[water] Untitled 2.abc = animated Plane sim (mesh cache 0–400@24fps). " +
      "Calm GPU waves applied to KML river mesh — ABC plane not used as corridor geometry.",
  );
  const particles = createFlowParticles(dataset);
  const waterFx = createWaterEffects(dataset);
  const chainage = createChainageLayer(dataset);
  const validation = createProjectionValidation(dataset);
  const bridges = createBridges(dataset);

  scene.add(terrain.mesh);
  if (terrain.surround) scene.add(terrain.surround);
  scene.add(terrain.outline);
  scene.add(kmlSkeleton);
  scene.add(river.bed);
  scene.add(river.walls);
  scene.add(river.mesh);
  if (river.wire) scene.add(river.wire);
  scene.add(particles.mesh);
  scene.add(waterFx.group);
  scene.add(chainage.group);
  scene.add(bridges);
  scene.add(validation);
  scene.add(coordinateGrid);
  scene.add(riverBanks);
  scene.add(drainageLayer);
  scene.add(mainStemLayer);
  scene.add(depthZonesLayer);
  scene.add(rawSurveyPoints);
  scene.add(floodLayer);
  scene.add(apiFloodLayer);
  scene.add(hydrologyLayer);

  // Spectral Lithology click marker (white point + ring)
  const lithologyPick = new THREE.Group();
  lithologyPick.name = "lithologyPick";
  lithologyPick.visible = false;
  const lithoRing = new THREE.Mesh(
    new THREE.RingGeometry(1.8, 2.4, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthTest: false,
    }),
  );
  lithoRing.rotation.x = -Math.PI / 2;
  const lithoDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
  );
  lithologyPick.add(lithoRing, lithoDot);
  lithologyPick.renderOrder = 60;
  scene.add(lithologyPick);
  /** @type {null | { x:number, z:number, y:number, label:string, pct:string, color:string }} */
  let lithologyPickInfo = null;
  const lithoNdc = new THREE.Vector3();

  const uiRoot = document.getElementById("ui-root");

  sun.target.position.set(dataset.corridor.bounds.cx, 0, dataset.corridor.bounds.cz);
  scene.add(sun.target);

  const cam = createCameraSystem(canvas, dataset);
  const getCamera = () => cam.camera;
  const coordLabels = mountCoordinateLabels(uiRoot, coordinateGrid, getCamera, canvas);
  const riverWidthMeasure = createRiverWidthMeasure(dataset);
  scene.add(riverWidthMeasure.group);

  attachInspect(canvas, getCamera, [river.mesh, river.bed], terrain.mesh, dataset, tooltip, {
    getDrainageGroup: () => drainageLayer,
    getDepthZonesGroup: () => depthZonesLayer,
    getNallaFlow: () => nallaFlow,
    getHydrologyGroup: () => hydrologyLayer,
    getRawSurveyLayer: () => rawSurveyPoints,
    riverWidthMeasure,
  });

  // Progressive load: core scene visible first (river + terrain + water)
  onCoreReady?.();

  const urbanGroup = new THREE.Group();
  urbanGroup.name = "urbanPending";
  scene.add(urbanGroup);

  const treesGroup = new THREE.Group();
  treesGroup.name = "treesPending";
  scene.add(treesGroup);

  const vegApiGroup = new THREE.Group();
  vegApiGroup.name = "vegetationApiPending";
  scene.add(vegApiGroup);

  const fishGroup = new THREE.Group();
  fishGroup.name = "fishPending";
  scene.add(fishGroup);

  let urbanResult = null;
  let treesResult = null;
  let vegApiResult = null;
  let fishing = null;

  const vegStatus = mountVegetationStatus(uiRoot);

  // Buildings/roads (~12MB GeoJSON) load AFTER first paint so the spinner is not stuck
  const loadUrbanLayers = async () => {
    try {
      if (typeof dataset.loadOsmLater === "function" && !dataset.osm?.loaded) {
        const lowTier = quality.get().tier === "low";
        const osm = await dataset.loadOsmLater({ lite: lowTier });
        dataset.osm = osm;
        if (osm.alignment && !osm.alignment.ok) {
          console.error("OSM–KML ALIGNMENT ISSUE", osm.alignment.issues);
        } else if (osm.alignment?.medianDistM != null) {
          console.info("OSM–KML alignment OK", {
            medianBuildingDistM: Math.round(osm.alignment.medianDistM),
            trees: osm.trees?.length || 0,
            buildings: osm.buildings?.length || 0,
            roads: osm.roads?.length || 0,
          });
        }
        dataset.activeSceneBounds = computeActiveSceneBounds(dataset);
      }
      const lowTier = quality.get().tier === "low";
      const [gUrban, gTrees] = await Promise.all([
        createUrban(dataset),
        lowTier ? Promise.resolve(new THREE.Group()) : createVegetation(dataset),
      ]);
      urbanResult = gUrban;
      urbanGroup.add(gUrban);
      treesResult = gTrees;
      treesGroup.add(gTrees);
    } catch (err) {
      console.warn("Progressive urban/vegetation load:", err.message);
    }

    // JalNetra Vegetation Type — independent layer; does not block terrain
    if (quality.get().tier !== "low") {
      loadJalnetraVegetation().catch((err) => {
        console.warn("Vegetation Type API:", err?.message || err);
      });
    }
  };

  async function loadJalnetraVegetation() {
    state.vegetationStatus = "loading";
    state.vegetationMessage = "Analyzing vegetation...";
    vegStatus.show("Analyzing vegetation...", "loading");
    try {
      const data = await fetchVegetationForAoi();
      if (data.empty || !data.features?.length) {
        state.vegetationStatus = "empty";
        state.vegetationMessage =
          "No vegetation detected for the selected AOI and date range.";
        vegStatus.show(state.vegetationMessage, "empty");
        setTimeout(() => vegStatus.hide(), 6000);
        return;
      }
      const layer = await createVegetationApiLayer(dataset, data);
      vegApiResult = layer;
      vegApiGroup.clear();
      vegApiGroup.add(layer);
      layer.visible = true;
      vegApiGroup.visible = true;
      state.vegetationStatus = "ready";
      state.vegetationMessage = "";
      vegStatus.hide();
    } catch (err) {
      state.vegetationStatus = "error";
      state.vegetationMessage = err?.message || "Vegetation analysis failed.";
      vegStatus.show(state.vegetationMessage, "error");
      setTimeout(() => vegStatus.hide(), 8000);
    }
  }

  // Yield one frame so the canvas can present before heavy OSM parse
  requestAnimationFrame(() => {
    setTimeout(loadUrbanLayers, 50);
  });

  if (quality.get().tier !== "low") {
    createFishingSystem(dataset, canvas, getCamera, uiRoot, { waterEffects: waterFx })
      .then((sys) => {
        fishing = sys;
        fishGroup.add(sys.group);
        if (sys.zones) cinematic.setFishingZones(sys.zones);
        if (dataset.fishingZones?.length) {
          dataset.activeSceneBounds = computeActiveSceneBounds(dataset);
        }
      })
      .catch((err) => console.warn("Fishing system load:", err.message));
  }

  // Click a red chainage pin to select it; hover THAT pin for station/meters.
  // Everywhere else, river water-depth hover stays (inspect).
  const chainPickRay = new THREE.Raycaster();
  const chainPickPtr = new THREE.Vector2();
  let chainHoverRaf = 0;
  const chainTipWorld = new THREE.Vector3();
  const chainTipNdc = new THREE.Vector3();

  function showChainageTipAt(clientX, clientY, p) {
    if (!p) return;
    state.chainageTipActive = true;
    tooltip.show(clientX, clientY, {
      chainageHover: true,
      label: p.label,
      meters: p.meters,
    });
  }

  /** Keep the floating CHAINAGE card pinned next to the selected marker (River Side structure). */
  function pinSelectedChainageTip() {
    if (state.cinematicActive || !state.showChainage) return;
    // Bank-erosion class card owns the tooltip until dismissed.
    // Bank-erosion / lithology tips own the floating card; joining-streams uses left panel.
    if (state.bankErosionTipActive || state.lithologyTipActive) return;
    const selM = state.selectedChainageMeters;
    if (selM == null) return;
    const sel = interpolateChainage(dataset.chainage, selM);
    if (!sel || sel.x == null) return;
    chainTipWorld.set(sel.x, SURFACE_Y + 8, sel.z);
    chainTipNdc.copy(chainTipWorld).project(cam.camera);
    if (chainTipNdc.z > 1) return;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + (chainTipNdc.x * 0.5 + 0.5) * rect.width + 18;
    const sy = rect.top + (-chainTipNdc.y * 0.5 + 0.5) * rect.height - 10;
    showChainageTipAt(sx, sy, sel);
  }

  /** Keep Spectral Lithology click card pinned to the geographic pick marker. */
  function pinLithologyPickTip() {
    if (!state.lithologyTipActive || !lithologyPickInfo) return;
    const info = lithologyPickInfo;
    chainTipWorld.set(info.x, info.y ?? SURFACE_Y + 2.5, info.z);
    lithoNdc.copy(chainTipWorld).project(cam.camera);
    if (lithoNdc.z > 1) return;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + (lithoNdc.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-lithoNdc.y * 0.5 + 0.5) * rect.height;
    tooltip.show(sx, sy, {
      lithologyClick: true,
      label: info.label,
      pct: info.pct,
      color: info.color,
      lon: info.lon,
      lat: info.lat,
    });
  }

  function resolveChainageUnderCursor(e, maxDistM = 70) {
    const rect = canvas.getBoundingClientRect();
    chainPickPtr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    chainPickPtr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    chainPickRay.setFromCamera(chainPickPtr, cam.camera);
    return chainage.pick?.(chainPickRay, cam.camera, maxDistM) || null;
  }

  // Eye-level corridor (reference screenshot): low boat height, nearly flat look.
  // Height 16 / back 55 / ahead 180 / lookY ≈ eye → horizon mid-frame, marker mid-foreground.
  function chainageCameraOptions(_point, dragging = false) {
    return {
      cameraHeight: 16,
      cameraDistance: 55,
      lookAheadDistance: 180,
      lookY: SURFACE_Y + 12,
      lateralOffset: 0,
      fov: 58,
      dur: dragging ? 0.22 : 0.85,
      ease: "outCubic",
      dragging: !!dragging,
    };
  }

  canvas.addEventListener("click", (e) => {
    if (state.cinematicActive || !state.showChainage) return;
    const hit = resolveChainageUnderCursor(e, 110);
    if (hit) {
      document.dispatchEvent(
        new CustomEvent("chainage-select", { detail: { meters: hit.meters, focus: true } }),
      );
    }
  });

  document.addEventListener("chainage-select", (e) => {
    if (state.cinematicActive) return;
    state.showChainage = true;
    // 3D scene shows only the selected label — do not flood with all station texts
    state.showChainageLabels = false;
    const labelsEl = document.querySelector("#chain-labels");
    if (labelsEl) {
      labelsEl.checked = false;
      labelsEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (e.detail?.focus === false) return;
    const m = e.detail?.meters;
    if (m == null) return;
    const p = interpolateChainage(dataset.chainage, m);
    if (!p || p.x == null) return;
    const dragging = !!e.detail?.dragging;
    cam.focusOnXZ?.(p.x, p.z, chainageCameraOptions(p, dragging));
    if (!dragging) setTimeout(() => pinSelectedChainageTip(), 120);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (chainHoverRaf) return;
    chainHoverRaf = requestAnimationFrame(() => {
      chainHoverRaf = 0;
      if (state.cinematicActive || !state.showChainage) {
        state.chainageTipActive = false;
        return;
      }
      // Prefer pinned tip on selection; pause while river width measure is up
      if (state.riverMeasureActive) {
        state.chainageTipActive = false;
        return;
      }
      if (state.selectedChainageMeters != null) {
        pinSelectedChainageTip();
        return;
      }
      state.chainageTipActive = false;
    });
  });

  const cinematic = createCinematicController({
    camera: cam.camera,
    controls: cam.controls,
    dataset,
    getRiverMaterial: () => river.material,
    waterEffects: waterFx,
    flowParticles: particles,
    onComplete: () => cam.applyMode("overview"),
  });

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    cam.resize?.(w, h);
    renderer.setSize(w, h, false);
    kmlSkeleton.userData?.setResolution?.(w, h);
    mainStemLayer.userData?.setResolution?.(w, h);
    // Keep Overview framed to KML after aspect changes
    if (state.cameraMode === "overview" && !cinematic.isActive()) {
      cam.applyMode("overview");
    }
  }
  window.addEventListener("resize", resize);
  resize();
  // Initial load: start close to the authoritative river centerline.
  cam.applyMode("overview");
  const initialChainage = dataset.chainage?.[0];
  if (initialChainage?.x != null && initialChainage?.z != null) {
    state.selectedChainageMeters = initialChainage.meters;
    cam.focusOnXZ(initialChainage.x, initialChainage.z, {
      ...chainageCameraOptions(initialChainage),
      dur: 0.9,
    });
  }

  let lastExag = state.depthExaggeration;
  let lastVisual = state.visualMode;
  let lastFlood = state.floodRiseM ?? 0;
  let lastWaterOn = state.showWater !== false;
  let lastRiverLook = "water";
  applyRiverLook(river, "water");

  const labelThrottle = createThrottle(q.labelHz);
  const lodThrottle = createThrottle(q.lodHz);
  const chainThrottle = createThrottle(q.chainageHz);
  const coordThrottle = createThrottle(q.coordLabelHz);
  let appliedTier = q.tier;

  function syncQualityRuntime() {
    q = quality.get();
    if (q.tier === appliedTier) return;
    appliedTier = q.tier;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatioMax));
    renderer.shadowMap.enabled = q.shadows;
    sun.castShadow = q.shadows;
    labelThrottle.setHz(q.labelHz);
    lodThrottle.setHz(q.lodHz);
    chainThrottle.setHz(q.chainageHz);
    coordThrottle.setHz(q.coordLabelHz);
  }

  window.__MM_SCENE__ = {
    scene,
    dataset,
    river,
    atmosphericSky,
    coordinateGrid,
    riverBanks,
    drainageLayer,
    nallaFlow,
    depthZonesLayer,
    floodLayer,
    apiFloodLayer,
    floodSimLayer,
    hydrologyLayer,
    async showHydrologyLayer(id) {
      const result = await hydrologyLayer.userData?.showLayer?.(id);
      // Bank erosion ribbon sits on the river corridor — keep water/flood hidden
      // every frame via state flags (update() otherwise restores them).
      const showErosion =
        id === "bank_erosion" && result?.available && result?.ok !== false && !result?.superseded;
      const showLithology =
        id === "geology" && result?.available && result?.ok !== false && !result?.superseded;
      state.hydrologyHidesWater = !!showErosion;
      state.hydrologyHidesFlood = !!showErosion;
      state.bankErosionMode = !!showErosion;
      state.lithologyMode = !!showLithology;
      const ui = document.getElementById("ui-root");
      ui?.classList.toggle("bank-erosion-mode", !!showErosion);
      ui?.classList.toggle("lithology-mode", !!showLithology);
      if (!showErosion) state.bankErosionTipActive = false;
      if (!showLithology) {
        state.lithologyTipActive = false;
        lithologyPick.visible = false;
        lithologyPickInfo = null;
      }
      if (showErosion) {
        console.info("[bank_erosion] overlay on", result?.stats || null);
      }
      return result;
    },
    hideHydrology() {
      hydrologyLayer.userData?.hideAll?.();
      state.hydrologyHidesWater = false;
      state.hydrologyHidesFlood = false;
      state.bankErosionMode = false;
      state.bankErosionTipActive = false;
      state.lithologyMode = false;
      state.lithologyTipActive = false;
      document.getElementById("ui-root")?.classList.remove("bank-erosion-mode", "lithology-mode");
      lithologyPick.visible = false;
      lithologyPickInfo = null;
    },
    setLithologyPick(info) {
      if (!info || info.x == null || info.z == null) {
        lithologyPick.visible = false;
        lithologyPickInfo = null;
        state.lithologyTipActive = false;
        return;
      }
      lithologyPickInfo = info;
      lithologyPick.position.set(info.x, info.y ?? SURFACE_Y + 2.5, info.z);
      lithologyPick.visible = true;
      state.lithologyTipActive = true;
      // Immediate tip at click; pinLithologyPickTip keeps it geo-locked while camera moves
      if (info.clientX != null && info.clientY != null) {
        tooltip.show(info.clientX, info.clientY, {
          lithologyClick: true,
          label: info.label,
          pct: info.pct,
          color: info.color,
          lon: info.lon,
          lat: info.lat,
        });
      }
    },
    clearLithologyPick() {
      lithologyPick.visible = false;
      lithologyPickInfo = null;
      state.lithologyTipActive = false;
      tooltip.hide();
    },
    getHydrologyActiveId() {
      return hydrologyLayer.userData?.getActiveId?.() ?? null;
    },
    validateHydrologyExtent() {
      return hydrologyLayer.userData?.validateExtent?.() ?? null;
    },
    cam,
    /** Exit 2D if needed and fly to chainage eye-level view (used by VIEW → 3D). */
    goToChainageView(meters) {
      if (cinematic.isActive()) return;
      const wasMap2d =
        state.cameraMode === "aerial" ||
        state.cameraMode === "top" ||
        state.cameraMode === "2d";
      // Preserve map up so the fly starts from the current top-down pose.
      cam.ensurePerspective?.(wasMap2d ? { preserveUp: true } : undefined);
      const chain = dataset.chainage || [];
      if (!chain.length) return;
      const first = chain[0].meters;
      const last = chain[chain.length - 1].meters;
      let m = Number(meters);
      if (!Number.isFinite(m)) m = 8000;
      m = Math.min(last, Math.max(first, m));
      const p = interpolateChainage(chain, m);
      if (!p || p.x == null) return;
      state.selectedChainageMeters = p.meters;
      state.showChainage = true;
      state.showChainageLabels = false;

      const startY = cam.camera?.position?.y ?? 0;
      const eyeH = 16;
      // Gentle descent arc when coming down from map altitude.
      const descentLift =
        wasMap2d || startY > eyeH + 120
          ? Math.min(420, Math.max(90, (startY - eyeH) * 0.22))
          : 0;

      cam.focusOnXZ?.(p.x, p.z, {
        ...chainageCameraOptions(p, false),
        dur: wasMap2d ? 3.4 : 2.6,
        ease: "inOutCubic",
        transitLift: descentLift,
      });
      document.dispatchEvent(
        new CustomEvent("chainage-select", {
          detail: { meters: p.meters, notes: false, focus: false },
        }),
      );
      // Pin tip after the fly settles so it doesn't fight the animation.
      const tipDelay = wasMap2d ? 3400 : 2600;
      setTimeout(() => pinSelectedChainageTip(), tipDelay);
    },
    /**
     * River click measure: pull camera back for readable width/depth labels,
     * but keep the view locked on the active (or nearest) chainage station.
     */
    frameRiverMeasure(_x, _z, metersHint) {
      if (cinematic.isActive()) return;
      cam.ensurePerspective?.();
      const chain = dataset.chainage || [];
      if (!chain.length) return;
      let m = state.selectedChainageMeters;
      if (m == null && Number.isFinite(metersHint)) m = metersHint;
      if (m == null) {
        const near = nearestChainage(_x, _z, chain);
        m = near?.meters;
      }
      if (m == null) return;
      const p = interpolateChainage(chain, m);
      if (!p || p.x == null) return;
      state.selectedChainageMeters = p.meters;
      // Zoomed-out corridor pose — still chainage-locked, not free overview.
      cam.focusOnXZ?.(p.x, p.z, {
        cameraHeight: 26,
        cameraDistance: 92,
        lookAheadDistance: 150,
        lookY: SURFACE_Y + 14,
        lateralOffset: 0,
        fov: 58,
        dur: 0.55,
        ease: "outCubic",
      });
    },
    setRawSurveyPointsVisible(_visible) {
      state.showRawSurveyPoints = false;
      rawSurveyPoints.visible = false;
      rawSurveyPoints.userData?.setSelected?.(null);
    },
    /** Toggle River water surface; when off, show excavated ground deep view. */
    setRiverVisible(on) {
      state.showWater = !!on;
      const waterOn = !!on;
      river.mesh.visible = waterOn;
      if (river.material) river.material.visible = waterOn;
      applyRiverLook(river, waterOn ? "water" : "depth");
      lastWaterOn = waterOn;
      lastRiverLook = waterOn ? "water" : "depth";
    },
    getDrainageStats: () => drainageLayer.userData?.stats || null,
    getNallaFlowStats: () => nallaFlow.userData?.stats || null,
    getDepthZonesStats: () => depthZonesLayer.userData?.stats || null,
    /** Enter MODE A — hide illustrative bathtub, keep prior stage for restore. */
    enterApiFloodMode() {
      if (state.floodMode !== "api") {
        state.savedFloodRiseM = state.floodRiseM ?? 0;
      }
      state.floodMode = "api";
      state.showFloodSimulation = true;
      floodLayer.setFloodRise?.(0);
      floodLayer.visible = false;
      lastFlood = 0;
    },
    /** Leave MODE A — restore illustrative Water Stage Explorer. */
    exitApiFloodMode() {
      apiFloodLayer.clear();
      state.floodMode = "illustrative";
      state.floodSimInfo = null;
      state.floodSimStatus = "idle";
      state.floodSimMessage = "";
      const restore = state.savedFloodRiseM;
      state.savedFloodRiseM = null;
      if (restore != null) {
        state.floodRiseM = restore;
        lastFlood = -1; // force bathtub re-apply next frame
        const floodEl = document.querySelector("#flood");
        const floodLabel = document.querySelector("#flood-label");
        if (floodEl) floodEl.value = String(Math.round(restore * 100));
        if (floodLabel) floodLabel.textContent = `+${restore.toFixed(1)} m`;
      }
    },
    applyFloodSimulation(result) {
      window.__MM_SCENE__.enterApiFloodMode();
      apiFloodLayer.loadFloodResult(result);
      apiFloodLayer.setVisible(state.showFloodSimulation !== false && state.apiFlood?.showLayer !== false);
      state.floodSimInfo = result?.info || apiFloodLayer.userData?.info || null;
      state.floodSimStatus = "ready";
      apiFloodLayer.userData.onSceneChange = (idx, scene) => {
        state.apiFlood.currentScene = idx;
        state.apiFlood.currentDate = scene?.date || null;
        state.floodSimInfo = apiFloodLayer.userData?.getInfo?.() || state.floodSimInfo;
        document.dispatchEvent(
          new CustomEvent("mm-flood-scene", { detail: { index: idx, scene } }),
        );
      };
    },
    playFloodSimulation() {
      if (!apiFloodLayer.userData?.hasFlood) return;
      apiFloodLayer.setVisible(state.showFloodSimulation !== false);
      apiFloodLayer.play();
    },
    playFloodTimeline() {
      if (!apiFloodLayer.userData?.hasFlood) return;
      apiFloodLayer.setVisible(state.showFloodSimulation !== false);
      apiFloodLayer.playTimeline?.();
    },
    pauseFloodSimulation() {
      apiFloodLayer.pause?.();
    },
    setFloodScene(index) {
      apiFloodLayer.setSceneIndex?.(index, { animate: false });
      apiFloodLayer.setProgress?.(1);
    },
    replayFloodSimulation() {
      if (!apiFloodLayer.userData?.hasFlood) return;
      apiFloodLayer.setVisible(state.showFloodSimulation !== false);
      apiFloodLayer.replay();
    },
    clearFloodSimulation() {
      window.__MM_SCENE__.exitApiFloodMode();
    },
    focusFloodSimulation() {
      const b = apiFloodLayer.userData?.getBounds?.();
      if (!b) return;
      // Gentle pan only — preserve viewing angle
      cam.focusOnXZ?.(b.cx, b.cz, { dur: 1.15 });
    },
    applyWaterPreset,
    getWaterDebugInfo: () => getWaterDebugInfo(river.material, dataset),
    /** @deprecated Drainage flow is driven by showDrainage (Nullahs checkbox) only */
    setDrainageFlow(on) {
      state.showDrainage = !!on;
      state.showNallaFlow = !!on;
      drainageLayer.visible = !!on;
      const dEl = document.querySelector("#drainage");
      if (dEl) dEl.checked = !!on;
      if (on) nallaFlow.userData?.playReveal?.();
      else nallaFlow.userData?.setActive?.(false);
      document.getElementById("drainage-btn")?.setAttribute("aria-pressed", on ? "true" : "false");
      document.getElementById("drainage-btn")?.classList.toggle("active", !!on);
    },
    toggleDrainageFlow() {
      window.__MM_SCENE__.setDrainageFlow(!state.showDrainage);
    },
    /** Geology → Joining Streams: drainage pipes + arrows + mist + click info */
    setJoiningStreams(on) {
      const active = !!on;
      state.joiningStreamsMode = active;
      if (!active) {
        state.joiningStreamsTipActive = false;
        nallaFlow.userData?.setSelected?.(null);
        window.__MM_JOINING_CARD__?.clear?.();
      }
      // Never disable OrbitControls / canvas pointer events — layer only.
      if (cam?.controls) cam.controls.enabled = true;
      nallaFlow.userData?.setJoiningStreamsMode?.(active);
      window.__MM_SCENE__.setDrainageFlow(active);
      document.getElementById("ui-root")?.classList.toggle("joining-streams-mode", active);
      return { ok: true, active };
    },
    /** Geology → Main Stem: Mula–Mutha centerline from main stream.kml */
    setMainStem(on) {
      const active = !!on;
      state.mainStemMode = active;
      mainStemLayer.userData?.setVisible?.(active);
      document.getElementById("ui-root")?.classList.toggle("main-stem-mode", active);
      return {
        ok: true,
        active,
        available: (mainStemLayer.userData?.stats?.paths || 0) > 0,
        stats: mainStemLayer.userData?.stats || null,
      };
    },
    /** Geology → Bathymetry: Jul 2026 depth-zone KML polygons */
    setBathymetry(on) {
      const active = !!on;
      state.bathymetryMode = active;
      state.showDepthZones = active;
      if (active) {
        state.glassyRevealActive = true;
        state.glassyVizMode = "data";
        state.glassyWaterOpacity = Math.max(state.glassyWaterOpacity ?? 0.72, 0.85);
        depthZonesLayer.userData?.playReveal?.();
      } else {
        state.glassyRevealActive = false;
        if (state.glassyVizMode === "data") state.glassyVizMode = "cinematic";
        depthZonesLayer.userData?.setSelected?.(null);
        state.selectedDepthZoneId = null;
      }
      depthZonesLayer.userData?.setVisible?.(active);
      depthZonesLayer.visible = active;
      const el = document.querySelector("#depth-zones");
      if (el && el.checked !== active) {
        el.checked = active;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const toolkit = document.querySelector("#glassy-toolkit");
      if (toolkit) toolkit.hidden = !active;
      document.getElementById("ui-root")?.classList.toggle("bathymetry-mode", active);
      const stats = depthZonesLayer.userData?.stats || null;
      return {
        ok: true,
        active,
        available: (stats?.built || stats?.polygons || 0) > 0,
        stats,
      };
    },
    selectJoiningStream(rec) {
      if (!rec) {
        state.joiningStreamsTipActive = false;
        nallaFlow.userData?.setSelected?.(null);
        window.__MM_JOINING_CARD__?.clear?.();
        return;
      }
      state.joiningStreamsTipActive = true;
      nallaFlow.userData?.setSelected?.(rec);
      window.__MM_JOINING_CARD__?.show?.(rec);
    },
    clearJoiningStreamSelection() {
      state.joiningStreamsTipActive = false;
      nallaFlow.userData?.setSelected?.(null);
      window.__MM_JOINING_CARD__?.clear?.();
    },
    startGlassyTour() {
      state.showDepthZones = true;
      state.glassyVizMode = "cinematic";
      state.glassyAnimatedFlow = true;
      state.glassyRevealActive = true;
      depthZonesLayer.visible = true;
      depthZonesLayer.userData?.playReveal?.();
      const dz = document.querySelector("#depth-zones");
      if (dz) {
        dz.checked = true;
        dz.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (!cinematic.isActive()) {
        cam.applyMode("overview");
        setTimeout(() => {
          if (!cinematic.isActive()) cam.applyMode("local");
        }, 3200);
        setTimeout(() => {
          if (!cinematic.isActive()) cam.applyMode("overview");
        }, 9000);
      }
    },
  };

  return {
    setCamera: (mode) => {
      if (cinematic.isActive()) return;
      cam.applyMode(mode);
    },
    rotateCompass: (dir) => cam.rotateToCompass(dir),
    resetOrientation: () => cam.resetOrientation(),
    zoomIn: () => cam.zoomIn(),
    zoomOut: () => cam.zoomOut(),
    startWaterFlow: () => {
      cam.ensurePerspective?.();
      cinematic.start();
    },
    pauseWaterFlow: () => cinematic.pause(),
    resumeWaterFlow: () => cinematic.resume(),
    togglePauseWaterFlow: () => cinematic.togglePause(),
    isCinematicActive: () => cinematic.isActive(),
    isCinematicPaused: () => cinematic.isPaused(),
    getQuality: () => quality.get(),
    update(dt) {
      quality.noteFrame(dt);
      syncQualityRuntime();
      state.elapsed += dt;
      river.material.uniforms.uTime.value = state.elapsed;
      if (!cinematic.isActive() && river.material.uniforms.uReveal) {
        river.material.uniforms.uReveal.value = 1.2;
      }
      syncWaterMaterial(river.material);
      if (!cinematic.isActive() && state.showDepthZones && river.material.uniforms.uOpacity) {
        // Keep river translucent so Jul 2026 depth classes read clearly
        const cap = state.bathymetryMode ? 0.42 : 0.78;
        river.material.uniforms.uOpacity.value = Math.max(
          state.bathymetryMode ? 0.28 : 0.58,
          Math.min(state.waterOpacity, cap),
        );
      }
      // Always tint floating water by bathymetry depth (light→dark blue)
      river.material.uniforms.uShowDepth.value = 1;
      const cutaway = state.visualMode === "cutaway";
      river.material.uniforms.uCutaway.value = cutaway ? 1 : 0;
      if (cutaway && !cinematic.isActive()) {
        river.material.uniforms.uOpacity.value = Math.min(state.waterOpacity, 0.28);
      }
      const waterOn = !!state.showWater && !state.hydrologyHidesWater;
      const erosionDark = !!state.hydrologyHidesWater;
      // River OFF → excavated ground deep view (boosted vertical relief)
      const bedExag = cutaway
        ? Math.max(5, state.depthExaggeration)
        : !waterOn
          ? Math.max(6.5, state.depthExaggeration * 3.2)
          : state.depthExaggeration;
      const apiFloodActive = state.floodMode === "api" && !!apiFloodLayer.userData?.hasFlood;
      // Bathtub stage ignored while API flood is the active surface
      const floodRise = apiFloodActive ? 0 : (state.floodRiseM ?? 0);
      // Bank erosion: dark channel so neon green/yellow ribbon pops (reference look)
      const riverLook = cutaway
        ? "cutaway"
        : erosionDark
          ? "erosionDark"
          : waterOn
            ? "water"
            : "depth";
      if (
        bedExag !== lastExag ||
        state.visualMode !== lastVisual ||
        floodRise !== lastFlood ||
        waterOn !== lastWaterOn ||
        riverLook !== lastRiverLook
      ) {
        lastExag = bedExag;
        lastVisual = state.visualMode;
        lastFlood = floodRise;
        lastWaterOn = waterOn;
        lastRiverLook = riverLook;
        applyExaggeration(river, dataset, bedExag, floodRise);
        if (!apiFloodActive) floodLayer.setFloodRise?.(floodRise);
        else {
          floodLayer.setFloodRise?.(0);
          floodLayer.visible = false;
        }
        updateBridgePiers(bridges, bedExag);
        applyRiverLook(river, riverLook);
      }
      // Illustrative bathtub never conflicts with API flood surface
      if (apiFloodActive) floodLayer.visible = false;
      if (state.hydrologyHidesFlood) {
        floodLayer.visible = false;
        apiFloodLayer.visible = false;
      }
      // River OFF / Bank Erosion mode → hide water; bed stays as ground deep view
      river.mesh.visible = waterOn;
      if (river.material) river.material.visible = waterOn;
      river.bed.visible = state.showBathymetry !== false;
      river.walls.visible = state.showBathymetry !== false;
      if (river.wire) river.wire.visible = !!state.showWaterDebug && waterOn;
      // Keep hydrology draped overlays on when a layer is active
      if (hydrologyLayer.userData?.getActiveId?.()) {
        hydrologyLayer.visible = true;
      }
      terrain.mesh.visible = true;
      if (terrain.surround) terrain.surround.visible = true;
      state.showTerrain = true;
      kmlSkeleton.visible = state.showMapReferenceGrid || state.showKmlSkeleton;
      coordinateGrid.visible = state.showMapReferenceGrid || state.showCoordinateGrid;
      if (coordThrottle.ready(dt)) {
        coordLabels.setVisible(state.showMapReferenceGrid || state.showCoordinateGrid);
        coordLabels.update();
      }
      // Bank overlay is debug/validation only — not drawn over living water
      riverBanks.visible = state.showValidation || state.showOsmAlignment;
      drainageLayer.visible = state.showDrainage;
      mainStemLayer.visible = !!state.mainStemMode;
      nallaFlow.userData?.update?.(dt, cam.camera);
      depthZonesLayer.visible = state.showDepthZones;
      depthZonesLayer.userData?.update?.(dt);
      rawSurveyPoints.visible = false;
      const showFloodSim =
        !state.hydrologyHidesFlood &&
        state.floodMode === "api" &&
        state.showFloodSimulation !== false &&
        state.apiFlood?.showLayer !== false &&
        !!apiFloodLayer.userData?.hasFlood;
      apiFloodLayer.visible = showFloodSim;
      if (showFloodSim) apiFloodLayer.update?.(dt);
      if (urbanResult) urbanResult.visible = true;
      if (urbanResult?.userData?.buildings) urbanResult.userData.buildings.visible = true;
      if (urbanResult?.userData?.roads) urbanResult.userData.roads.visible = true;
      if (lodThrottle.ready(dt)) {
        urbanResult?.userData?.updateLod?.(cam.camera);
      }
      // Vegetation is always present (OSM + JalNetra)
      state.showVegetation = true;
      state.showOsmTrees = true;
      if (treesResult) treesResult.visible = true;
      if (vegApiResult) vegApiResult.visible = true;
      if (vegApiGroup) vegApiGroup.visible = true;
      if (treesGroup) treesGroup.visible = true;
      bridges.visible = true;
      if (labelThrottle.ready(dt)) {
        updateBridgeLabels(bridges, cam.camera);
      }
      validation.visible = state.showValidation || state.showOsmAlignment;
      terrain.outline.visible = state.showValidation;
      particles.mesh.visible = waterOn && state.flowVisibility > 0.05;
      waterFx.group.visible = waterOn;
      if (particles.mesh.material?.uniforms?.uOpacity) {
        particles.mesh.material.uniforms.uOpacity.value = state.flowVisibility;
      } else if (particles.mesh.material) {
        particles.mesh.material.opacity = Math.min(1, 0.4 + state.flowVisibility * 0.7);
      }
      // Keep FX reveal in sync when idle (full river visible)
      if (!cinematic.isActive()) {
        const r = river.material.uniforms?.uReveal?.value ?? 1.2;
        particles.setReveal?.(r);
        waterFx.setReveal?.(r);
      }
      if (particles.mesh.visible) particles.update(dt);
      if (waterFx.group.visible) waterFx.update(dt);
      if (chainThrottle.ready(dt)) {
        chainage.update(cam.camera);
        if (state.lithologyTipActive) pinLithologyPickTip();
        else if (!state.riverMeasureActive) pinSelectedChainageTip();
      }
      riverWidthMeasure.update?.(cam.camera);
      cinematic.update(dt);
      if (fishing) fishing.update(dt, cam.camera);
      if (!cinematic.isActive()) cam.update(dt);
      const h = cam.camera.position.y;
      if (isMap2DMode() && !state.cinematicActive) {
        // True 2D GIS view — no fog, haze, or atmospheric wash
        applyMap2DClarity();
      } else if (state.cinematicUnderwater) {
        atmosphericSky.setVisible(false);
        if (scene.fog !== groundFog) scene.fog = groundFog;
        groundFog.density = 0.000008;
        groundFog.color.set("#7aabba");
        if (!scene.background) scene.background = new THREE.Color("#5a8fa0");
        else scene.background.set("#5a8fa0");
        renderer.toneMappingExposure = 1.55;
      } else {
        restoreAtmosphereClarity();
        const atmospheric = Math.min(0.00006, 0.00003 + h / 7_500_000);
        groundFog.density = cutaway ? 0.000028 : atmospheric * (0.7 + (state.skyAtmosphere ?? 0.55) * 0.5);
        groundFog.color.set(h > 900 ? "#889a78" : scene.userData.groundFog || "#7a8e6e");
        // Sky dome is the backdrop — keep scene.background null
        scene.background = null;
        atmosphericSky.update(dt, cam.camera);
      }
      renderer.render(scene, cam.camera);
    },
  };
}

function createRawSurveyPointLayer(dataset) {
  const points = dataset.points || [];
  const minD = Number(dataset.minDepth) || 0;
  const maxD = Number(dataset.maxDepth) || 1;
  const span = Math.max(0.001, maxD - minD);
  const positions = new Float32Array(points.length * 3);
  const colors = new Float32Array(points.length * 3);
  const y = SURFACE_Y + 3;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    positions[i * 3] = p.x ?? 0;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = p.z ?? 0;
    const t = THREE.MathUtils.clamp(((p.depth ?? minD) - minD) / span, 0, 1);
    // Light sky → deep navy (matches water depth legend)
    colors[i * 3] = (200 + (4 - 200) * t) / 255;
    colors[i * 3 + 1] = (234 + (20 - 234) * t) / 255;
    colors[i * 3 + 2] = (255 + (40 - 255) * t) / 255;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 5.5,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    vertexColors: true,
  });
  const layer = new THREE.Points(geometry, material);
  layer.name = "rawSurveyPoints";
  layer.visible = false;
  layer.userData.points = points;
  layer.userData.pointY = y;

  const highlight = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 3.2, 3.2),
    new THREE.MeshBasicMaterial({
      color: 0xffcc33,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  highlight.name = "rawSurveyHighlight";
  highlight.visible = false;
  highlight.renderOrder = 20;
  layer.add(highlight);
  layer.userData.highlight = highlight;

  layer.userData.setSelected = (point) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      highlight.visible = false;
      return;
    }
    highlight.position.set(point.x, y, point.z);
    highlight.visible = true;
  };

  return layer;
}
