import * as THREE from "three";
import { state } from "../state.js";
import { createTerrain, terrainHeightAt, carveTerrainUnderRiver } from "./terrain.js";
import { buildChannelBanks, syncChannelBanks } from "./channelBanks.js";
import { createKmlSkeleton } from "./kmlSkeleton.js";
import { createRiver, applyExaggeration, applyRiverLook, clipRiverToHydrology, SURFACE_Y } from "./river.js";
import {
  fetchJalnetraWaterDepth,
  SURVEY_DEPTH_MIN_M,
  SURVEY_DEPTH_MAX_M,
} from "../services/jalnetraWaterDepthService.js";
import { setWaterSiltMode } from "./waterShader.js";
import { createUrban } from "./urban.js";
import { createVegetation } from "./vegetation.js";
import { createVegetationApiLayer } from "./vegetationApiLayer.js";
import { createPermanentVegetationTypeTrees } from "./vegetationTypeGrowLayer.js";
import { createRiparianVegetationLayer, RIPARIAN_LABEL_MIN_M2 } from "./riparianVegetationLayer.js";
import { prefetchTreeAssets } from "./treeRegistry.js";
import { fetchVegetationForAoi } from "../services/vegetationService.js";
import { mountVegetationStatus } from "../ui/components/vegetationStatus.js";
import { createBridges, updateBridgeLabels, updateBridgePiers } from "./bridges.js";
import { createBridgeLabels } from "./bridgeLabels.js";
import { createCameraSystem } from "./cinematic.js";
import { attachInspect } from "./inspect.js";
import { createRiverWidthMeasure } from "./riverWidthMeasure.js";
import { createDistanceMeasure } from "./distanceMeasure.js";
import { createSiltAreaTool } from "./siltAreaTool.js";
import { createFlowParticles } from "./flowParticles.js";
import { createWaterEffects } from "./waterEffects.js";
import { createRiverRain } from "./riverRain.js";
import { createChainageLayer, nearestChainage } from "./chainageMarkers.js";
import { createProjectionValidation } from "./validation.js";
import { createCoordinateGrid, mountCoordinateLabels } from "./coordinateGrid.js";
import { createRiverBankOverlay } from "./riverBanks.js";
import { createDrainageLayer } from "./drainageLayer.js";
import { createNallaFlowSystem } from "./drainage/nallaFlowSystem.js";
import { createJoiningStreamsController } from "./drainage/joiningStreamsController.js";
import { createDepthZonesLayer } from "./depthZonesLayer.js";
import { createFloodLayer } from "./floodLayer.js";
import { createApiFloodLayer } from "./apiFloodLayer.js";
import { createClimateImpactLayer } from "./climateImpactLayer.js";
import { createHydrologyLayer } from "./hydrologyLayer.js";
import { createBodCodLayer } from "./bodCodLayer.js";
import { createAqiRiverLayer } from "./aqiRiverLayer.js";
import { createMainStemLayer } from "./mainStemLayer.js";
import { fillPierUniforms, syncWaterMaterial, applyWaterPreset, getWaterDebugInfo } from "./waterShader.js";
import { createFishingSystem } from "../features/fishing/createFishingSystem.js";
import { createCinematicController } from "../animation/cinematicController.js";
import { computeActiveSceneBounds, computeSceneBounds } from "../geo/sceneBounds.js";
import { createQualityProfile, createThrottle, isLowMemoryDevice } from "../perf/quality.js";
import { createAtmosphericSky } from "./sky/atmosphericSky.js";
import { interpolateChainage } from "../geo/chainage.js";
import { loadLulcClassGrid } from "../geo/lulcRaster.js";
import { loadOsmWater } from "../geo/osmWater.js";
import { createWaterFill } from "./waterFill.js";
import {
  nearestStationU,
  chainageGisAerialPose,
  CHAINAGE_BACK_M,
  CHAINAGE_EYE_HEIGHT,
  CHAINAGE_FOV,
  CHAINAGE_LOOK_ABOVE,
} from "./riverCamera.js";
import { createRiverJourney, CameraMode, setJourneyTarget, flushSettled } from "./riverJourney.js";
import mainStemKmlRaw from "../data/main stream.kml?raw";
import { createAssetMarkers } from "./assetMarkers.js";
import { initDigitalTwin } from "../services/digitalTwinService.js";
import { initHydrologyProfileService, refreshHydrologyProfile } from "../services/hydrology/hydrologyProfileService.js";
import { hydrologyStore } from "../services/hydrology/hydrologyStore.js";
import { hydrologyTransform, BASELINE_DEPTH_M } from "../services/hydrology/hydrologyTransform.js";
import { telemetryService } from "../services/hydrology/hydrologyTelemetryService.js";
import { hydraulicCalibrationService } from "../services/hydrology/hydraulicCalibrationService.js";
import { historicalHydrologyService } from "../services/hydrology/historicalHydrologyService.js";
import { verticalDatumPipeline } from "../services/hydrology/verticalDatumPipeline.js";

export async function createWorld(canvas, dataset, tooltip, { onCoreReady } = {}) {
  const quality = createQualityProfile();
  let q = quality.get();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: q.antialias,
    // Prefer default on low-memory machines to avoid VRAM-hungry high-perf contexts
    powerPreference: isLowMemoryDevice() ? "default" : "high-performance",
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
  renderer.localClippingEnabled = true;

  if (q.tier !== "high") {
    console.info(
      `[perf] Quality=${q.tier} (smooth default). Use ?quality=high for max detail, ?quality=low for weak devices.`,
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

  const map2dBackground = new THREE.Color(MAP2D_SURROUND);

  /**
   * Crisp GIS lighting. Fog and the shadow-casting light stay assigned (density /
   * shadow intensity go to 0 instead): toggling either changes every lit material's
   * shader key, so each 2D↔3D switch would recompile all programs and render blank
   * (clear-colour) frames while they link.
   */
  let map2dClarityOn = false;
  function applyMap2DClarity() {
    map2dClarityOn = true;
    if (scene.fog !== groundFog) scene.fog = groundFog;
    groundFog.density = 0;
    atmosphericSky.setVisible(false);
    if (scene.background !== map2dBackground) scene.background = map2dBackground;
    hemi.intensity = LIGHT_MAP2D.hemi;
    sun.intensity = LIGHT_MAP2D.sun;
    fill.intensity = LIGHT_MAP2D.fill;
    sun.castShadow = q.shadows && state.skyEnabled !== false;
    sun.shadow.intensity = 0;
    renderer.toneMappingExposure = 1.22;
  }

  function restoreAtmosphereClarity() {
    if (scene.fog !== groundFog) scene.fog = groundFog;
    scene.background = null;
    atmosphericSky.setVisible(state.skyEnabled !== false);
    sun.castShadow = q.shadows && state.skyEnabled !== false;
    if (map2dClarityOn) {
      map2dClarityOn = false;
      hemi.intensity = LIGHT_DEFAULT.hemi;
      sun.intensity = LIGHT_DEFAULT.sun;
      fill.intensity = LIGHT_DEFAULT.fill;
      sun.shadow.intensity = 1;
    }
  }

  const terrain = await createTerrain(dataset);
  const kmlSkeleton = createKmlSkeleton(dataset);
  const river = createRiver(dataset);
  const [landCover, osmWater] = await Promise.all([
    loadLulcClassGrid(),
    loadOsmWater().catch((e) => {
      console.warn("[river] OSM water unavailable", e);
      return null;
    }),
  ]);
  clipRiverToHydrology(river, landCover, osmWater, dataset);
  // Keep the ground below the drawn water everywhere — incl. the narrow channel at the river start.
  let carved = carveTerrainUnderRiver(terrain.mesh, dataset.corridor.stations);
  console.info("[terrain] carved under river water", { vertices: carved });
  logCorridorLandCover(dataset, landCover);
  river.dtmHeightAt = (x, z) => terrainHeightAt(x, z, dataset.corridor.stations);
  // Dense shore strip over the sunk terrain band — the banks the coarse grid cannot draw.
  const channelBanks = buildChannelBanks(river, terrain.mesh, dataset.corridor.stations, null, landCover);
  river.banksSync = (waterY) => syncChannelBanks(channelBanks, river, waterY);
  applyExaggeration(river, dataset, state.depthExaggeration || 1, 0, null);
  const waterFill = createWaterFill(terrain.mesh, river, dataset, landCover, osmWater);
  /** Water volume follows the current ribbon + bed (it was left on the first ribbon after a refit). */
  function rebuildWaterFill() {
    const fresh = createWaterFill(terrain.mesh, river, dataset, landCover, osmWater);
    if (!fresh || !waterFill) return;
    waterFill.geometry.dispose();
    waterFill.geometry = fresh.geometry;
    fresh.material.dispose();
  }

  // JalNetra SAR permanent water + relative depth — tight mask, bridge-gap fuse only.
  // Depth scale 1.69–3.0 m. Non-blocking: LULC ribbon shows first.
  fetchJalnetraWaterDepth({
    depth_min_m: SURVEY_DEPTH_MIN_M,
    depth_max_m: SURVEY_DEPTH_MAX_M,
  })
    .then((wd) => {
      if (!wd?.mask) return;
      state.jalnetraWaterDepth = {
        water_area_ha: wd.water_area_ha,
        depth_min_m: wd.depth_min_m,
        depth_max_m: wd.depth_max_m,
        mean_m: wd.meta?.depth?.mean_m ?? null,
        s1: wd.meta?.sentinel1_image_date ?? null,
        s2: wd.meta?.sentinel2_image_date ?? null,
        provenance: wd.provenance,
      };
      clipRiverToHydrology(river, landCover, osmWater, dataset, wd.mask);
      buildChannelBanks(river, terrain.mesh, dataset.corridor.stations, channelBanks, landCover);
      applyExaggeration(
        river,
        dataset,
        state.depthExaggeration || 1,
        state.floodMode === "api" ? Number(state.floodRiseM) || 0 : 0,
        null,
        { includeBaseStage: false },
      );
      rebuildWaterFill();
      console.info("[river] JalNetra water-depth fused into ribbon", {
        water_area_ha: wd.water_area_ha,
        carved,
        depthScale: [SURVEY_DEPTH_MIN_M, SURVEY_DEPTH_MAX_M],
      });
      document.dispatchEvent(
        new CustomEvent("jalnetra-water-depth-ready", { detail: state.jalnetraWaterDepth }),
      );
    })
    .catch((err) => {
      console.warn("[river] JalNetra water-depth unavailable — keeping LULC/OSM ribbon", err?.message || err);
    });

  const UNDERWATER_COLOR = "#0e5f78";
  /** Thick enough that the view under the surface reads as water, not open air over the DTM. */
  const UNDERWATER_FOG_DENSITY = 0.016;
  const underwaterRay = new THREE.Raycaster();
  const UP = new THREE.Vector3(0, 1, 0);
  let underwaterCheckIn = 0;
  let underwater = false;
  let underwaterLook = false;
  /** Camera below the water surface with river / fill water directly above it (throttled raycast). */
  function cameraInRiverWater(camera, dt) {
    if (camera.position.y >= SURFACE_Y - 0.02 || !river.mesh.visible) {
      underwaterCheckIn = 0;
      underwater = false;
      return false;
    }
    underwaterCheckIn -= dt;
    if (underwaterCheckIn > 0) return underwater;
    underwaterCheckIn = 0.25;
    const stations = dataset.corridor.stations;
    let best = stations[0], bestD = Infinity;
    for (const s of stations) {
      const d = (s.x - camera.position.x) ** 2 + (s.z - camera.position.z) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    const lat = Math.sqrt(bestD);
    if (lat < Math.max(18, best.halfWidth) * 1.35) {
      underwater = true;
      return true;
    }
    underwaterRay.set(camera.position, UP);
    underwaterRay.far = SURFACE_Y + 2 - camera.position.y;
    underwater = underwaterRay.intersectObject(river.mesh, true).length > 0;
    return underwater;
  }
  function setUnderwaterLook(on) {
    underwaterLook = on;
  }
  const coordinateGrid = createCoordinateGrid(dataset);
  const riverBanks = createRiverBankOverlay(dataset);
  const drainageLayer = createDrainageLayer(dataset);
  const nallaFlow = createNallaFlowSystem(dataset, drainageLayer, {
    uiRoot: document.getElementById("ui-root"),
  });
  drainageLayer.add(nallaFlow);

  if (!nallaFlow?.userData || !Array.isArray(nallaFlow.userData.records)) {
    throw new Error(
      "Joining Streams: createNallaFlowSystem did not return a valid system with records",
    );
  }
  console.info("[joining-streams] nallaFlowSystem ready", {
    nallas: nallaFlow.userData.stats?.nallas ?? nallaFlow.userData.records.length,
    connected: nallaFlow.userData.stats?.connected,
  });
  const mainStemLayer = createMainStemLayer(dataset, mainStemKmlRaw);
  const depthZonesLayer = createDepthZonesLayer(dataset);
  const rawSurveyPoints = createRawSurveyPointLayer(dataset);
  const floodLayer = createFloodLayer(dataset);
  /** MODE A — JalNetra API flood (source of truth for inundation extent). */
  const apiFloodLayer = createApiFloodLayer(dataset);
  /** Climate Impact — RiverEye flood/surface-water heatmap periods. */
  const climateImpactLayer = createClimateImpactLayer(dataset);
  /** Hydrology thematic overlays (Geology + Salinity). */
  const hydrologyLayer = createHydrologyLayer(dataset);
  const bodCodLayer = createBodCodLayer(dataset);
  const aqiRiverLayer = createAqiRiverLayer(dataset);
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
  const riverRain = createRiverRain(dataset);
  const chainage = createChainageLayer(dataset);
  const validation = createProjectionValidation(dataset);
  const bridges = createBridges(dataset);
  const bridgeLabels = createBridgeLabels(bridges, dataset);

  scene.add(terrain.mesh);
  scene.add(channelBanks);
  if (terrain.surround) scene.add(terrain.surround);
  scene.add(terrain.outline);
  // scene.add(kmlSkeleton);
  scene.add(river.bed);
  scene.add(river.walls);
  scene.add(river.mesh);
  if (waterFill) {
    waterFill.visible = false;
    scene.add(waterFill);
  }
  if (river.wire) scene.add(river.wire);
  // scene.add(particles.mesh);
  scene.add(waterFx.group);
  scene.add(riverRain.group);
  scene.add(chainage.group);
  scene.add(bridges);
  scene.add(validation);
  scene.add(coordinateGrid);
  // scene.add(riverBanks);
  scene.add(drainageLayer);
  scene.add(mainStemLayer);
  scene.add(depthZonesLayer);
  scene.add(rawSurveyPoints);
  scene.add(floodLayer);
  scene.add(apiFloodLayer);
  scene.add(climateImpactLayer);
  scene.add(hydrologyLayer);
  scene.add(bodCodLayer);
  scene.add(aqiRiverLayer);

  // ── Digital Twin Asset Markers ───────────────────────────────────────────
  const assetMarkers = createAssetMarkers(scene, {
    getTerrainY: () => SURFACE_Y + 12,
  });

  // Track station water surface scene Y values (1 per corridor station)
  const corridorStationCount = dataset.corridor?.stations?.length || 720;
  let targetStationWaterY = new Float32Array(corridorStationCount).fill(SURFACE_Y);
  let currentStationWaterY = new Float32Array(corridorStationCount).fill(SURFACE_Y);
  let lastWaterYChangeTime = performance.now();
  let hydrologySimulationRiseM = 0;
  let renderedHydrologySimulationRiseM = 0;
  let hydrologySimulationActive = false;
  let hydrologySimulationNeedsFinalUpdate = false;

  // Bootstrap dedicated hydrology profile service
  const hydrologyProfileReady = initHydrologyProfileService(dataset.chainage).then(() => {
    console.info("[HydrologyProfileService] Ready with physical 1D hydraulic engine");
  }).catch((err) => console.warn("[HydrologyProfileService] Init deferred:", err));

  // Subscribe to hydrology store updates for water mesh & UI synchronization
  hydrologyStore.subscribe(({ profile, summary }) => {
    if (summary) {
      state.discharge_m3s = summary.discharge_m3s;
      state.meanVelocity_ms = summary.meanVelocity_ms;
      state.totalVolume_m3 = summary.totalVolume_m3;
      state.hydrologyStatus = summary.discharge_status;
      state.liveWaterSource = summary.source || null;
      state.liveWaterUpdatedAt = summary.timestamp || new Date().toISOString();
      // Relative stage: live Manning depth vs survey baseline — keeps the sheet
      // in the carved channel (absolute station Y previously floated banks).
      if (Number.isFinite(summary.meanDepth_m)) {
        const delta = summary.meanDepth_m - BASELINE_DEPTH_M;
        state.liveStageRiseM = Math.max(-0.45, Math.min(2.0, delta));
      }
      // Flow speed in shader derived from physical velocity
      if (summary.meanVelocity_ms != null && river.material?.uniforms?.uFlowSpeed) {
        river.material.uniforms.uFlowSpeed.value = hydrologyTransform.velocityToShaderSpeed(summary.meanVelocity_ms);
      }
    }

    if (profile?.records?.length) {
      // HUD / telemetry station Y (smoothed). Sheet uses uniform liveStageRiseM.
      const cStations = dataset.corridor?.stations || [];
      const newY = new Float32Array(corridorStationCount);
      for (let s = 0; s < corridorStationCount; s++) {
        const meters = cStations[s]?.along ?? (s * ((dataset.chainage?.at(-1)?.meters ?? 16796) / corridorStationCount));
        const rec = hydrologyStore.getStationAtChainage(meters);
        const depth = rec?.water_depth_m?.value ?? BASELINE_DEPTH_M;
        newY[s] = hydrologyTransform.hydraulicDepthToSceneY(depth);
      }
      targetStationWaterY.set(newY);
      lastWaterYChangeTime = performance.now();
    }
  });

  // Bootstrap the digital twin service and wire marker updates
  const digitalTwinReady = initDigitalTwin().then((twinState) => {
    if (twinState?.assets) assetMarkers.update(twinState.assets);
  }).catch((err) => console.warn("[DigitalTwin] init deferred:", err));
  document.addEventListener("twin-state-change", (e) => {
    if (e.detail?.assets) assetMarkers.update(e.detail.assets);
  });
  document.addEventListener("twin-asset-select", (e) => {
    assetMarkers.setSelected(e.detail?.id ?? null);
    if (e.detail?.asset?.chainage_m != null) {
      window.__MM_SCENE__?.goToChainageView?.(e.detail.asset.chainage_m);
    }
  });

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
  // Bind real camera into nalla focusRecord / joining effects
  nallaFlow.userData?.setCameraSystem?.(cam);
  if (nallaFlow.userData?.effects?.userData) {
    nallaFlow.userData._getCamera = getCamera;
  }
  const joiningCtrl = createJoiningStreamsController({
    dataset,
    nallaFlow,
    system: nallaFlow,
    cam,
  });
  // Re-bind after controller wrap so system flight still has camera
  nallaFlow.userData?.setCameraSystem?.(cam);
  console.info("[joining-streams] controller ready", {
    records: joiningCtrl.getRecords().length,
  });
  const coordLabels = mountCoordinateLabels(uiRoot, coordinateGrid, getCamera, canvas);
  const riverWidthMeasure = createRiverWidthMeasure(dataset);
  scene.add(riverWidthMeasure.group);
  const distanceMeasure = createDistanceMeasure(dataset);
  scene.add(distanceMeasure.group);
  const siltAreaTool = createSiltAreaTool();
  scene.add(siltAreaTool.group);

  attachInspect(canvas, getCamera, [river.mesh, river.bed, channelBanks].filter(Boolean), terrain.mesh, dataset, tooltip, {
    getDrainageGroup: () => drainageLayer,
    getDepthZonesGroup: () => depthZonesLayer,
    getNallaFlow: () => nallaFlow,
    getHydrologyGroup: () => hydrologyLayer,
    getRawSurveyLayer: () => rawSurveyPoints,
    getAqiLayer: () => aqiRiverLayer,
    getBodCodLayer: () => bodCodLayer,
    riverWidthMeasure,
    distanceMeasure,
    siltAreaTool,
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

  const vegTypeGrowGroup = new THREE.Group();
  vegTypeGrowGroup.name = "vegetationTypePermanent";
  scene.add(vegTypeGrowGroup);

  /** LULC land (forest / bank) inside the river polygon, away from surveyed depth points. */
  let riparianLayer = null;
  async function loadRiparianVegetation() {
    const qNow = quality.get();
    const layer = await createRiparianVegetationLayer(dataset, {
      maxTrees: qNow.tier === "low" ? 1800 : 4200,
      castShadow: !!qNow.treeShadows,
    });
    riparianLayer = layer;
    layer.userData.syncToWater(river.mesh, lastFlood);
    scene.add(layer);
    for (const c of layer.userData.clusters) {
      // Intentionally not adding "RIPARIAN / VEGETATED AREA" label per user request
    }
  }

  const fishGroup = new THREE.Group();
  fishGroup.name = "fishPending";
  scene.add(fishGroup);

  let urbanResult = null;
  let treesResult = null;
  let vegApiResult = null;
  /** Permanent trees from project vegetation_type overlay — always on. */
  let vegTypePermanent = null;
  let fishing = null;

  async function loadPermanentVegetationTypeTrees() {
    try {
      const qNow = quality.get();
      const layer = await createPermanentVegetationTypeTrees(dataset, {
        animate: false,
        maxInstances: qNow.maxVegTypeTrees || 8500,
        stepM: qNow.vegTypeStepM || 34,
        castShadow: !!qNow.treeShadows,
      });
      if (vegTypePermanent?.userData?.dispose) {
        try {
          vegTypePermanent.userData.dispose();
        } catch {
          /* ignore */
        }
      }
      vegTypePermanent = layer;
      vegTypeGrowGroup.clear();
      vegTypeGrowGroup.add(layer);
      vegTypeGrowGroup.visible = true;
      console.info("[vegetation-type] permanent trees ready", {
        instances: layer.userData?.instanceCount || 0,
        types: layer.userData?.typeCounts || {},
        quality: qNow.tier,
      });
      return layer;
    } catch (err) {
      console.warn("[vegetation-type] permanent place failed:", err?.message || err);
      return null;
    }
  }

  const vegStatus = mountVegetationStatus(uiRoot);

  // 50 m bank strip (buildings, roads, trees) always loads after first paint.
  prefetchTreeAssets();
  const loadUrbanLayers = async () => {
    try {
        const lowTier = quality.get().tier === "low";
      // Lite OSM still loads trees/vegetation; only skips heavy extras
      if (typeof dataset.loadOsmLater === "function" && !dataset.osm?.loaded) {
        const osm = await dataset.loadOsmLater({ lite: dataset.lite === true || lowTier });
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
      const gUrban = await createUrban(dataset);
      urbanResult = gUrban;
      urbanGroup.add(gUrban);

      // Always plant trees — density follows quality profile
      const qNow = quality.get();
      const maxTrees = qNow.maxTrees || (lowTier ? 2400 : 5500);
      const pending = [];
      pending.push(createVegetation(dataset, { maxTrees, castShadow: !!qNow.treeShadows, terrainMesh: terrain.mesh })
        .then((gTrees) => {
      treesResult = gTrees;
      treesGroup.add(gTrees);
          console.info("[vegetation] OSM trees ready", {
            meshes: gTrees.children?.length || 0,
            maxTrees,
            quality: qNow.tier,
            osmTrees: dataset.osm?.trees?.length || 0,
            green: dataset.osm?.green?.length || 0,
          });
        })
        .catch((err) => console.warn("Vegetation GLB load:", err?.message || err)));

      // Permanent trees from project vegetation_type.kml overlay (always on)
      pending.push(loadPermanentVegetationTypeTrees().catch((err) =>
        console.warn("Permanent vegetation type trees:", err?.message || err),
      ));
      pending.push(loadRiparianVegetation().catch((err) =>
        console.warn("[riparian] vegetation unavailable:", err?.message || err),
      ));
      await Promise.allSettled(pending);
    } catch (err) {
      console.warn("Progressive urban/vegetation load:", err.message);
    }
  };

  let jalnetraStarted = false;
  async function loadJalnetraVegetation() {
    if (vegApiResult || jalnetraStarted) return;
    jalnetraStarted = true;
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
      // Preserve API legend/category colors for Land Use → Vegetation Extent HUD
      layer.userData.vegetationLegend = {
        type: "classes",
        title: "VEGETATION EXTENT",
        classes: (data.legend || data.categories || [])
          .filter((c) => c?.label || c?.name)
          .map((c) => ({
            label: c.label || c.name,
            color: c.color,
            range: c.range || null,
          })),
      };
      layer.userData.vegetationMeta = {
        total_vegetation_area_ha: data.total_vegetation_area_ha,
        vegetation_cover_percent: data.vegetation_cover_percent,
        end_date: data.end_date,
      };
      vegApiResult = layer;
      vegApiGroup.clear();
      vegApiGroup.add(layer);
      layer.visible = true;
      vegApiGroup.visible = true;
      state.vegetationStatus = "ready";
      state.vegetationMessage = "";
      vegStatus.hide();
    } catch (err) {
      jalnetraStarted = false;
      state.vegetationStatus = "error";
      state.vegetationMessage = err?.message || "Vegetation analysis failed.";
      vegStatus.show(state.vegetationMessage, "error");
      setTimeout(() => vegStatus.hide(), 8000);
    }
  }

  // Yield one frame so the canvas can present, then load the 50 m river-side strip.
  const urbanDone = new Promise((resolve) => {
  requestAnimationFrame(() => {
      setTimeout(() => loadUrbanLayers().finally(resolve), 50);
    });
  });

  const fishingDone = createFishingSystem(dataset, canvas, getCamera, uiRoot, {
    waterEffects: waterFx,
    landCover,
    osmWater,
  })
      .then((sys) => {
        fishing = sys;
        fishGroup.add(sys.group);
        if (sys.zones) cinematic.setFishingZones(sys.zones);
        if (dataset.fishingZones?.length) {
          dataset.activeSceneBounds = computeActiveSceneBounds(dataset);
        }
      })
      .catch((err) => console.warn("Fishing system load:", err.message));

  const hydrologyDone = Promise.allSettled([hydrologyProfileReady, digitalTwinReady]);
  const whenReady = Promise.allSettled([urbanDone, fishingDone, hydrologyDone]);

  // Click a red chainage pin to select it; hover THAT pin for station/meters.
  // Everywhere else, river water-depth hover stays (inspect).
  const chainPickRay = new THREE.Raycaster();
  const chainPickPtr = new THREE.Vector2();
  let chainHoverRaf = 0;
  const chainTipWorld = new THREE.Vector3();
  const chainTipNdc = new THREE.Vector3();

  /** Show CHAINAGE card only while the cursor is near a marker — never permanently pinned. */
  function showChainageTipAt(clientX, clientY, p) {
    if (!p) return;
    state.chainageTipActive = true;
    tooltip.show(clientX, clientY, {
      chainageHover: true,
      label: p.label,
      meters: p.meters,
    });
  }

  function hideChainageTip() {
    if (!state.chainageTipActive) return;
    state.chainageTipActive = false;
    tooltip.hide();
  }

  /** @deprecated kept as no-op so older call sites stay safe */
  function pinSelectedChainageTip() {
    /* intentionally empty — tip is hover-only */
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

  // Low along-river framing: eye just over the water, marker near the middle of the frame.
  function chainageCameraOptions(_point, dragging = false) {
    return {
      cameraHeight: CHAINAGE_EYE_HEIGHT,
      cameraDistance: CHAINAGE_BACK_M,
      lookAheadDistance: 0,
      lookY: SURFACE_Y + CHAINAGE_LOOK_ABOVE,
      lateralOffset: 0,
      fov: CHAINAGE_FOV,
      dur: dragging ? 0.12 : 0.85,
      transitLift: 0,
      ease: dragging ? "outCubic" : "inOutCubic",
      dragging: !!dragging,
    };
  }

  /**
   * River journeys for discrete chainage picks (ticks, prev/next, step arrows, twin clicks):
   * the camera travels the centerline between chainages, settling into the aerial-oblique
   * inspection pose. See riverJourney.js.
   */
  const CHAIN_FLIGHT_NEAR_M = 360;
  const CHAIN_FLIGHT_MAX_EYE_Y = 140;
  const journey = createRiverJourney({ dataset, getBridges: () => bridgeLabels.items() });
  let chainFocusM = null;

  function publishJourney(tr) {
    state.cameraJourney = tr
      ? {
          mode: tr.mode,
          direction: tr.direction,
          startChainage: tr.startChainage,
          targetChainage: tr.targetChainage,
          currentChainage: tr.currentChainage,
          distance: tr.distance,
          duration: tr.duration,
        }
      : null;
    document.dispatchEvent(new CustomEvent("river-journey-progress", { detail: state.cameraJourney }));
  }

  function cancelChainFlight() {
    const tr = journey.cancel();
    if (!tr) return;
    chainFocusM = tr.currentChainage;
    publishJourney(null);
    flushSettled();
    cam.controls.enabled = true;
    cam.controls.update?.();
  }
  canvas.addEventListener("pointerdown", cancelChainFlight, { passive: true });
  canvas.addEventListener("wheel", cancelChainFlight, { passive: true });

  function cameraNearChainage(meters) {
    const p = interpolateChainage(dataset.chainage, meters);
    const c = cam.camera?.position;
    if (!p || p.x == null || !c) return false;
    return c.y < CHAIN_FLIGHT_MAX_EYE_Y && Math.hypot(c.x - p.x, c.z - p.z) < CHAIN_FLIGHT_NEAR_M;
  }

  /** Scene-aware destination framing from data already in the scene. */
  function destinationPose(toM) {
    const p = interpolateChainage(dataset.chainage, toM);
    const nearBridge = (bridgeLabels.items() || []).some(
      (b) => Number.isFinite(b.x) && p && Math.hypot(b.x - p.x, b.z - p.z) < 120,
    );
    if (nearBridge) return { height: 12, back: CHAINAGE_BACK_M, lookAbove: 3 };
    return { height: CHAINAGE_EYE_HEIGHT, back: CHAINAGE_BACK_M, lookAbove: CHAINAGE_LOOK_ABOVE };
  }

  function nearestChainageToCamera() {
    const c = cam.camera?.position;
    const stations = dataset.corridor?.stations || [];
    if (!c || !stations.length) return dataset.chainage?.[0]?.meters ?? 0;
    let best = stations[0];
    let bestD = Infinity;
    const step = Math.max(1, Math.floor(stations.length / 400));
    for (let i = 0; i < stations.length; i += step) {
      const s = stations[i];
      const d = (s.x - c.x) ** 2 + (s.z - c.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return Number.isFinite(best.along) ? best.along : dataset.chainage?.[0]?.meters ?? 0;
  }

  function startChainFlight(toM, opts = {}) {
    const p = interpolateChainage(dataset.chainage, toM);
    if (!p || p.x == null) return null;

    const c = cam.camera;
    const eyeY = c?.position?.y ?? 0;
    const isHighOverview = eyeY > 200 || isMap2DMode();

    // If coming from high aerial overview or 2D mode, descend smoothly into corridor
    if (isHighOverview && !journey.active) {
      chainFocusM = toM;
      state.selectedChainageMeters = toM;
      cam.focusOnXZ(p.x, p.z, {
        ...chainageCameraOptions(p, false),
        dur: 1.6,
        ease: "inOutCubic",
      });
      return null;
    }

    const fromM = journey.active
      ? journey.active.currentChainage
      : (chainFocusM ?? nearestChainageToCamera());
    if (cam.controls) cam.controls.enabled = false;
    const tr = journey.start(fromM, toM, { p: c.position, l: cam.controls.target }, {
      targetPose: destinationPose(toM) || undefined,
      ...opts,
    });
    setJourneyTarget(tr.targetChainage, toM, opts.requestedM);
    publishJourney(tr);
    return tr;
  }

  let journeyPublishT = 0;
  function stepChainFlight(dt) {
    if (!journey.active) return;
    if (
      state.cinematicActive ||
      isMap2DMode() ||
      state.joiningStreamsMode ||
      state.joiningStreamsNavigation ||
      state.garbageSelectionActive
    ) {
      cancelChainFlight();
      return;
    }
    const f = journey.step(dt);
    if (!f) return;
    chainFocusM = f.meters;
    cam.setPose?.(f.p, f.l, {
      fov: f.fov,
      lockControls: true,
      releaseControls: !!f.done,
    });
    journeyPublishT += dt;
    if (f.done) {
      const snappedTarget = Math.round(f.transition.targetChainage / 10) * 10;
      chainFocusM = snappedTarget;
      state.selectedChainageMeters = snappedTarget;
      publishJourney(null);
      flushSettled();
      document.dispatchEvent(
        new CustomEvent("river-journey-arrive", {
          detail: { meters: snappedTarget, mode: f.transition.mode },
        }),
      );
    } else if (journeyPublishT > 0.1) {
      journeyPublishT = 0;
      publishJourney(f.transition);
    }
  }

  function exploreRiver() {
    if (cinematic.isActive() || isMap2DMode()) return false;
    const chain = dataset.chainage || [];
    if (!chain.length) return false;
    const first = chain[0].meters;
    const last = chain[chain.length - 1].meters;
    let fromM = journey.active?.currentChainage ?? chainFocusM ?? state.selectedChainageMeters ?? first;
    // Start at 0+000 unless already underway near the source.
    if (!cameraNearChainage(fromM) || fromM > first + 50) {
      const p0 = interpolateChainage(chain, first);
      journey.cancel();
      chainFocusM = first;
      cam.focusOnXZ?.(p0.x, p0.z, { ...chainageCameraOptions(p0, false), dur: 1.0 });
      fromM = first;
    }
    startChainFlight(last, { mode: CameraMode.FULL_RIVER_JOURNEY });
    return true;
  }
  document.addEventListener("river-explore", () => {
    if (journey.active?.mode === CameraMode.FULL_RIVER_JOURNEY) cancelChainFlight();
    else exploreRiver();
  });

  // Chainage camera movement is UI-only (bottom ruler + top ± arrows).
  // River / 3D chainage-point clicks must not jump the view.

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
    const m = e.detail?.meters;
    const src = e.detail?.source || "";
    // Sources where Joining Streams already frames the nalla confluence
    const joiningOwnsCamera =
      src === "click" ||
      src === "nav" ||
      src === "activate" ||
      src === "view" ||
      src === "refocus" ||
      src === "joining-streams" ||
      src === "next-drainage" ||
      src === "previous-drainage" ||
      src === "focus" ||
      src === "overview" ||
      src === "select-drainage";

    // While Joining Streams is active: chainage only syncs nearest drainage —
    // NEVER fly the camera along the Mula–Mutha centerline.
    if (state.joiningStreamsMode || state.joiningStreamsNavigation || e.detail?.joiningStreamsNavigation) {
      if (state.joiningStreamsMode && m != null && !joiningOwnsCamera) {
        joiningCtrl.onChainageSelect(m, e.detail || {});
      }
      return;
    }

    if (e.detail?.focus === false) return;
    if (m == null) return;

    // Strictly snap chainage to 10m steps (10m 10m only)
    const snappedM = Math.round(Number(m) / 10) * 10;
    const p = interpolateChainage(dataset.chainage, snappedM);
    if (!p || p.x == null) return;
    const dragging = !!e.detail?.dragging;
    if (isMap2DMode()) {
      cancelChainFlight();
      chainFocusM = p.meters;
      cam.focusOnXZ?.(p.x, p.z, { ...chainageCameraOptions(p, dragging), dur: dragging ? 0 : 0.65, ease: "outCubic" });
      return;
    }
    if (dragging) {
      cancelChainFlight();
      chainFocusM = p.meters;
      state.selectedChainageMeters = p.meters;
      cam.focusOnXZ?.(p.x, p.z, { ...chainageCameraOptions(p, true), dur: 0.12, ease: "outCubic" });
      return;
    }

    // Move smoothly and swiftly along the river corridor (never teleporting across land)
    startChainFlight(p.meters, { requestedM: snappedM, dragging: false });
  });

  let lastChainMoveTime = 0;
  canvas.addEventListener("pointermove", (e) => {
    const now = performance.now();
    // Throttle chainage tooltips to max 15fps (~65ms) to save main thread cycles
    if (now - lastChainMoveTime < 65) {
      if (!chainHoverRaf) {
    chainHoverRaf = requestAnimationFrame(() => {
      chainHoverRaf = 0;
          lastChainMoveTime = performance.now();
      if (state.cinematicActive || !state.showChainage) {
            hideChainageTip();
            return;
          }
          const hydroId = hydrologyLayer.userData?.getActiveId?.();
          if (
            state.riverMeasureActive ||
            state.bankErosionTipActive ||
            state.lithologyTipActive ||
            state.joiningStreamsTipActive ||
            state.landUseTipActive ||
            hydroId === "landuse_lulc" ||
            hydroId === "silt_classification" ||
            hydroId === "silt_volume_surface" ||
            hydroId === "vegetation_extent" ||
            hydroId === "vegetation_health" ||
            hydroId === "bank_erosion" ||
            hydroId === "geology" ||
            hydroId === "salinity" ||
            hydroId === "water_quality_ndci" ||
            hydroId === "water_quality_tss"
          ) {
            if (state.chainageTipActive) hideChainageTip();
            return;
          }
          // Richer map hover cards (river, land, features) already include the chainage.
          if (state.hover) {
        state.chainageTipActive = false;
        return;
      }
          const hit = resolveChainageUnderCursor(e, 70);
          if (hit) {
            showChainageTipAt(e.clientX + 14, e.clientY - 12, hit);
          } else {
            hideChainageTip();
          }
        });
      }
        return;
      }

    lastChainMoveTime = now;
    if (chainHoverRaf) {
      cancelAnimationFrame(chainHoverRaf);
      chainHoverRaf = 0;
    }
    
    if (state.cinematicActive || !state.showChainage) {
      hideChainageTip();
      return;
    }
    // Land-use / silt / geology / bank-erosion own the shared tooltip on hover.
    const hydroId = hydrologyLayer.userData?.getActiveId?.();
    if (
      state.riverMeasureActive ||
      state.bankErosionTipActive ||
      state.lithologyTipActive ||
      state.joiningStreamsTipActive ||
      state.landUseTipActive ||
      hydroId === "landuse_lulc" ||
      hydroId === "silt_classification" ||
      hydroId === "silt_volume_surface" ||
      hydroId === "vegetation_extent" ||
      hydroId === "vegetation_health" ||
      hydroId === "bank_erosion" ||
      hydroId === "geology" ||
      hydroId === "salinity" ||
      hydroId === "water_quality_ndci" ||
      hydroId === "water_quality_tss"
    ) {
      if (state.chainageTipActive) hideChainageTip();
      return;
    }
    // Richer map hover cards (river, land, features) already include the chainage.
    if (state.hover) {
      state.chainageTipActive = false;
      return;
    }
    const hit = resolveChainageUnderCursor(e, 70);
    if (hit) {
      showChainageTipAt(e.clientX + 14, e.clientY - 12, hit);
    } else {
      hideChainageTip();
    }
  });

  canvas.addEventListener("pointerleave", () => {
    hideChainageTip();
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
  // Initial load: true 2D top-down of the whole corridor. VIEW → 3D flies to mid-chainage.
  // Leave selectedChainageMeters/chainFocusM unset — overlay.js defaults the HUD to the
  // corridor midpoint, and the VIEW → 3D handler falls back to that same midpoint.
  cam.applyMode("aerial", { animate: false, fullExtent: true });

  let lastExag = state.depthExaggeration;
  let lastVisual = state.visualMode;
  let lastFlood = state.floodRiseM ?? 0;
  let lastWaterOn = state.showWater !== false;
  let lastRiverLook = "water";
  let lastApiFlood = false;
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

  function depthAtLocalXZ(x, z) {
    const stations = dataset.corridor?.stations || [];
    const depths = dataset.bathymetry?.depths;
    if (!stations.length || !depths?.length) return null;
    const cols = (dataset.bathymetry?.across || 40) + 1;
    const u = nearestStationU(stations, x, z);
    const row = Math.min(stations.length - 1, Math.max(0, Math.round(u * Math.max(0, stations.length - 1))));
    const centerIndex = row * cols + Math.floor((cols - 1) / 2);
    const d = depths[centerIndex];
    return Number.isFinite(d) ? d : null;
  }

  function refreshRiverStationMeasure(metersHint) {
    if (!state.riverMeasureDepthOn && !state.riverMeasureWidthOn) {
      riverWidthMeasure.hide();
      return;
    }
    const m = metersHint ?? state.selectedChainageMeters;
    const p = interpolateChainage(dataset.chainage, m);
    if (!p || p.x == null) {
      riverWidthMeasure.hide();
      return;
    }
    const depth = depthAtLocalXZ(p.x, p.z);
    riverWidthMeasure.showAt(
      { x: p.x, z: p.z, depth: depth ?? 0 },
      {
        showDepth: state.riverMeasureDepthOn,
        showWidth: state.riverMeasureWidthOn,
        persist: true,
      },
    );
  }

  function clearRiverStationMeasure() {
    state.riverMeasureDepthOn = false;
    state.riverMeasureWidthOn = false;
    riverWidthMeasure.hide();
    document.dispatchEvent(new CustomEvent("river-measure-ui-sync"));
  }

  document.addEventListener("river-measure-clear", clearRiverStationMeasure);
  document.addEventListener("chainage-select", (e) => {
    if (!state.riverMeasureDepthOn && !state.riverMeasureWidthOn) return;
    refreshRiverStationMeasure(e.detail?.meters);
  });

  window.__MM_SCENE__ = {
    scene,
    dataset,
    river,
    getHydrologySimulationRise: () => hydrologySimulationRiseM,
    getRenderedHydrologySimulationRise: () => renderedHydrologySimulationRiseM,
    setHydrologySimulationRise(riseM, settled = false) {
      if (!Number.isFinite(riseM) || (state.floodMode === "api" && apiFloodLayer.userData?.hasFlood)) return false;
      hydrologySimulationRiseM = riseM;
      hydrologySimulationActive = true;
      hydrologySimulationNeedsFinalUpdate ||= !!settled;
      return true;
    },
    clearHydrologySimulation() {
      hydrologySimulationRiseM = 0;
      hydrologySimulationActive = false;
      hydrologySimulationNeedsFinalUpdate = true;
    },
    cameraSystem: cam,
    seekCinematic: (t) => cinematic.seek(t),
    stopCinematic: () => cinematic.finish(),
    atmosphericSky,
    riverRain,
    bridgeLabelStates: () => bridgeLabels.items(),
    riparianAreas: () => (riparianLayer?.userData.clusters || []).map((c) => ({
      areaM2: c.areaM2, x: c.anchor.x, z: c.anchor.z, waterOffset: c.waterOffset,
    })),
    applyLiveWeather(weather) {
      atmosphericSky.applyLiveWeather?.(weather);
      riverRain.applyLiveWeather?.(weather);
    },
    updateSiltWaterMode(active, points) {
      if (!river || !river.mesh) return;
      if (river.mesh.material) {
        setWaterSiltMode(river.mesh.material, active, points);
      }
    },
    coordinateGrid,
    riverBanks,
    drainageLayer,
    nallaFlow,
    depthZonesLayer,
    floodLayer,
    apiFloodLayer,
    floodSimLayer,
    climateImpactLayer,
    hydrologyLayer,
    // Hydrology runtime systems
    hydrologyStore,
    telemetryService,
    hydraulicCalibrationService,
    historicalHydrologyService,
    verticalDatumPipeline,
    async setRiverDischarge(qM3s, source = "USER_SCENARIO", provenance = "LIVE") {
      return refreshHydrologyProfile({
        discharge_m3s: qM3s,
        source,
        provenance,
      });
    },
    async updateHydraulicProfile({ upstreamQ_m3s, downstreamWse_m_msl, dischargeSource, dischargeProvenance, timestamp } = {}) {
      return refreshHydrologyProfile({
        discharge_m3s: upstreamQ_m3s,
        source: dischargeSource,
        provenance: dischargeProvenance,
        timestamp,
      });
    },
    async setHistoricalEvent(eventId) {
      const ev = historicalHydrologyService.selectEvent(eventId);
      if (!ev) return null;
      return refreshHydrologyProfile({
        discharge_m3s: ev.discharge_m3s,
        source: ev.source,
        provenance: ev.provenance,
        timestamp: ev.timestamp,
      });
    },
    setBenchmarkVerification(verified, verificationData = {}) {
      verticalDatumPipeline.setVerification({ verified, ...verificationData });
      state.datumVerified = !!verified;
      return refreshHydrologyProfile();
    },
    calibrateManning(observationPairs) {
      const res = hydraulicCalibrationService.calibrateManning(observationPairs);
      if (res.status === "CALIBRATED") {
        state.manningCalibrated = true;
      }
      return res;
    },
    async showHydrologyLayer(id) {
      if (id === "vegetation_extent" || id === "vegetation_health") {
        await loadJalnetraVegetation();
      }
      bodCodLayer.userData?.setVisible?.(false);
      bodCodLayer.visible = false;
      aqiRiverLayer.userData?.setVisible?.(false);
      aqiRiverLayer.visible = false;
      climateImpactLayer.userData?.clear?.();
      climateImpactLayer.visible = false;
      const result = await hydrologyLayer.userData?.showLayer?.(id);
      if (result?.available && !result?.superseded) {
        hydrologyLayer.visible = true;
      }
      // Bank erosion ribbon sits on the river corridor — keep water/flood hidden
      // every frame via state flags (update() otherwise restores them).
      const showErosion =
        id === "bank_erosion" && result?.available && result?.ok !== false && !result?.superseded;
      const showLithology =
        id === "geology" && result?.available && result?.ok !== false && !result?.superseded;
      const showPollution =
        id === "pollution" && result?.available && result?.ok !== false && !result?.superseded;
      state.hydrologyHidesWater = !!showErosion;
      state.hydrologyHidesFlood = !!showErosion;
      state.bankErosionMode = !!showErosion;
      state.lithologyMode = !!showLithology;
      if (!showPollution) state.garbageSelectionActive = false;
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
      if (id === "pollution" && result?.available) {
        console.info("[pollution] pins on", result?.stats || null);
      }
      return result;
    },
    hideHydrology() {
      hydrologyLayer.userData?.hideAll?.();
      climateImpactLayer.userData?.clear?.();
      climateImpactLayer.visible = false;
      aqiRiverLayer.userData?.clear?.();
      aqiRiverLayer.userData?.setVisible?.(false);
      aqiRiverLayer.visible = false;
      state.hydrologyHidesWater = false;
      state.hydrologyHidesFlood = false;
      state.bankErosionMode = false;
      state.bankErosionTipActive = false;
      state.lithologyMode = false;
      state.lithologyTipActive = false;
      state.garbageSelectionActive = false;
      document.getElementById("ui-root")?.classList.remove("bank-erosion-mode", "lithology-mode");
      lithologyPick.visible = false;
      lithologyPickInfo = null;
    },
    isMap2D() {
      return isMap2DMode();
    },
    startGarbageFlight(toP, toL, opts = {}) {
      return cam.startGarbageFlight?.(toP, toL, opts);
    },
    startDrainageFlight(toP, toL, opts = {}) {
      return cam.startDrainageFlight?.(toP, toL, opts);
    },
    selectGarbage(id, opts = {}) {
      const hydro = hydrologyLayer.userData;
      const rec = hydro?.getPollutionLayer?.()?.userData?.select?.(id, opts);
      if (rec) state.garbageSelectionActive = true;
      return rec;
    },
    clearGarbageSelection() {
      state.garbageSelectionActive = false;
      hydrologyLayer.userData?.getPollutionLayer?.()?.userData?.clearSelection?.();
    },
    isPollutionLoaded() {
      return hydrologyLayer.userData?.getPollutionLayer?.()?.userData?.isLoaded?.() ?? false;
    },
    setGarbageDensityVisible(v) {
      return hydrologyLayer.userData?.getPollutionLayer?.()?.userData?.setShowDensity?.(v);
    },
    showBodCod(data) {
      hydrologyLayer.userData?.hideAll?.();
      climateImpactLayer.userData?.clear?.();
      climateImpactLayer.visible = false;
      aqiRiverLayer.userData?.setVisible?.(false);
      aqiRiverLayer.visible = false;
      bodCodLayer.userData?.setData?.(data);
      bodCodLayer.userData?.setVisible?.(true);
      bodCodLayer.visible = true;
      const n = data?.reaches?.length || 0;
      return { available: n > 0, ok: n > 0, message: n ? undefined : "No BOD/COD reaches" };
    },
    applyBodCodSnapshot(snaps) {
      bodCodLayer.userData?.applySnapshot?.(snaps);
    },
    hideBodCod() {
      bodCodLayer.userData?.setVisible?.(false);
      bodCodLayer.visible = false;
    },
    showClimateImpact(payload, classes = {}) {
      hydrologyLayer.userData?.hideAll?.();
      bodCodLayer.userData?.setVisible?.(false);
      bodCodLayer.visible = false;
      aqiRiverLayer.userData?.setVisible?.(false);
      aqiRiverLayer.visible = false;
      state.hydrologyHidesWater = false;
      state.hydrologyHidesFlood = false;
      // Keep existing WRD lines when switching periods (do not clear them here)
      climateImpactLayer.userData?.setPeriodData?.(payload);
      climateImpactLayer.userData?.setClassVisible?.(classes);
      climateImpactLayer.userData?.setVisible?.(true);
      if (!cinematic.isActive()) {
        cam.applyMode?.("overview");
      }
      const info = climateImpactLayer.userData?.getInfo?.() || null;
      const n =
        (info?.nFlood || 0) + (info?.nWater || 0) + (info?.showWrd ? info?.nWrd || 0 : 0);
      return {
        available: n > 0 || !!info?.wrdLoaded,
        ok: n > 0 || !!info?.wrdLoaded,
        info,
        message: n ? undefined : "No climate heatmap points for this period",
      };
    },
    setClimateImpactWrdLines(geo, visible = true) {
      climateImpactLayer.userData?.setWrdFloodLines?.(geo);
      climateImpactLayer.userData?.setClassVisible?.({ wrd: visible });
      climateImpactLayer.userData?.setVisible?.(true);
      return climateImpactLayer.userData?.getInfo?.() || null;
    },
    setClimateImpactClasses(classes) {
      climateImpactLayer.userData?.setClassVisible?.(classes);
      return climateImpactLayer.userData?.getInfo?.() || null;
    },
    hideClimateImpact() {
      climateImpactLayer.userData?.clear?.();
      climateImpactLayer.visible = false;
    },
    showAqiRiver(opts = {}) {
      hydrologyLayer.userData?.hideAll?.();
      bodCodLayer.userData?.setVisible?.(false);
      bodCodLayer.visible = false;
      climateImpactLayer.userData?.clear?.();
      climateImpactLayer.visible = false;
      state.hydrologyHidesWater = false;
      state.hydrologyHidesFlood = false;
      const info = aqiRiverLayer.userData?.prepare?.(opts) || { n: 0 };
      aqiRiverLayer.userData?.setMetric?.(opts.metric || "aqi");
      aqiRiverLayer.userData?.setVisible?.(true);
      aqiRiverLayer.visible = true;
      return { available: info.n > 0, ok: info.n > 0, info };
    },
    setAqiRiverReading(meters, reading) {
      aqiRiverLayer.userData?.setReadingAt?.(meters, reading);
    },
    setAqiRiverMetric(metric) {
      aqiRiverLayer.userData?.setMetric?.(metric);
    },
    setAqiRiverFocus(meters) {
      aqiRiverLayer.userData?.setFocusMeters?.(meters);
    },
    getAqiRiverSamples() {
      return aqiRiverLayer.userData?.getSamplePoints?.() || [];
    },
    hideAqiRiver() {
      aqiRiverLayer.userData?.clear?.();
      aqiRiverLayer.userData?.setVisible?.(false);
      aqiRiverLayer.visible = false;
    },
    focusBodCodReach(reachId, opts = {}) {
      const hit = bodCodLayer.userData?.focusReach?.(reachId, opts);
      // Camera is owned by chainage-select (eye-level river view). Do not aerial-jump here.
      return hit;
    },
    findBodCodReachAtMeters(meters) {
      return bodCodLayer.userData?.findReachIndexAtMeters?.(meters) ?? -1;
    },
    setGarbageLabelsVisible(v) {
      return hydrologyLayer.userData?.getPollutionLayer?.()?.userData?.setLabelsEnabled?.(v);
    },
    setGarbageClassFilter(label) {
      return hydrologyLayer.userData?.getPollutionLayer?.()?.userData?.setClassFilter?.(label);
    },
    getPollutionSides() {
      return hydrologyLayer.userData?.getPollutionLayer?.()?.userData?.getSides?.() || [];
    },
    focusPollutionSide(sideId, opts = {}) {
      return hydrologyLayer.userData?.getPollutionLayer?.()?.userData?.focusSide?.(sideId, opts);
    },
    clearPollutionSideFilter() {
      return hydrologyLayer.userData?.getPollutionLayer?.()?.userData?.clearSideFilter?.();
    },
    getGarbageKeyPoints(opts) {
      return hydrologyLayer.userData?.getPollutionLayer?.()?.userData?.getKeyPoints?.(opts) || [];
    },
    focusGarbageSite(id) {
      return hydrologyLayer.userData?.getPollutionLayer?.()?.userData?.select?.(id, {
        focusCamera: true,
      });
    },
    async setLulcYear(year) {
      return hydrologyLayer.userData?.setLulcYear?.(year);
    },
    getLulcYear() {
      return hydrologyLayer.userData?.getLulcYear?.() ?? null;
    },
    async setSiltClassificationPeriod(periodId) {
      return hydrologyLayer.userData?.setSiltClassificationPeriod?.(periodId);
    },
    getSiltClassificationPeriod() {
      return hydrologyLayer.userData?.getSiltClassificationPeriod?.() ?? null;
    },
    async setSiltVolumePeriod(periodId) {
      return hydrologyLayer.userData?.setSiltVolumePeriod?.(periodId);
    },
    getSiltVolumePeriod() {
      return hydrologyLayer.userData?.getSiltVolumePeriod?.() ?? null;
    },
    /**
     * Land Use thematic layers (mutually exclusive with other hydrology overlays).
     * vegetation_extent / vegetation_health → draped study-area overlays.
     * landuse_lulc → Mula–Mutha LULC overlays (2021–2026).
     * silt_classification / silt_volume_surface → monthly silt rasters (2026).
     */
    async showLandUseLayer(id) {
      state.hydrologyHidesWater = false;
      state.hydrologyHidesFlood = false;
      state.bankErosionMode = false;
      state.lithologyMode = false;
      document.getElementById("ui-root")?.classList.remove("bank-erosion-mode", "lithology-mode");

      // Vegetation Type trees stay permanent; this only toggles the draped overlay / HUD.
      return this.showHydrologyLayer(id);
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
    /** Travel the whole corridor 0+000 → end along the real chainage profile. */
    exploreRiver,
    riverJourney: journey,
    /** Exit 2D if needed and fly to chainage eye-level view (used by VIEW → 3D). */
    /**
     * Pre-render the 3D view (behind the loader) so the first 2D→3D flight does not stall on
     * shader compiles and first-time GPU uploads of the near-river buildings, trees and bridges.
     */
    warmUp3DView(meters, pose = {}) {
      const p = interpolateChainage(dataset.chainage || [], meters);
      if (!p || p.x == null) return;
      const eye = new THREE.Vector3();
      const look = new THREE.Vector3();
      chainageGisAerialPose(dataset.corridor.stations, {
        x: p.x,
        z: p.z,
        ...chainageCameraOptions(p, false),
        ...pose,
        outP: eye,
        outL: look,
      });
      const size = renderer.getSize(new THREE.Vector2());
      const warmCam = new THREE.PerspectiveCamera(52, size.x / Math.max(1, size.y), 1.2, 120000);
      const prevBg = scene.background;
      restoreAtmosphereClarity();
      // Landing pose, then a mid-descent pose (wide view of the corridor).
      for (const lift of [0, 1500]) {
        warmCam.position.set(eye.x, eye.y + lift, eye.z);
        warmCam.lookAt(look);
        warmCam.updateMatrixWorld();
        renderer.compile(scene, warmCam);
        renderer.render(scene, warmCam);
      }
      scene.background = prevBg;
      // The next frame re-applies the 2D map look for the still-orthographic camera.
    },
    goToChainageView(meters, opts = {}) {
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
      state.showChainage = true;
      state.showChainageLabels = false;

      if (!wasMap2d) {
        startChainFlight(p.meters);
        document.dispatchEvent(
          new CustomEvent("chainage-select", {
            detail: { meters: p.meters, notes: false, focus: false },
          }),
        );
        return;
      }

      cancelChainFlight();
      chainFocusM = p.meters;
      state.selectedChainageMeters = p.meters;

      cam.focusOnXZ?.(p.x, p.z, {
        ...chainageCameraOptions(p, false),
        ...(opts.pose || {}),
        dur: opts.instant ? 0 : Number.isFinite(opts.dur) ? opts.dur : wasMap2d ? 2.0 : 1.4,
      });

      document.dispatchEvent(
        new CustomEvent("chainage-select", {
          detail: { meters: p.meters, notes: false, focus: false },
        }),
      );
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
      cancelChainFlight();
      chainFocusM = p.meters;
      cam.focusOnXZ?.(p.x, p.z, {
        cameraHeight: 26,
        cameraDistance: 92,
        lookAheadDistance: 150,
        lookY: SURFACE_Y + 14,
        lateralOffset: 0,
        fov: 58,
        dur: 1.1,
        ease: "inOutQuint",
      });
    },
    toggleRiverMeasureKind(kind) {
      if (kind === "depth") state.riverMeasureDepthOn = !state.riverMeasureDepthOn;
      else if (kind === "width") state.riverMeasureWidthOn = !state.riverMeasureWidthOn;
      if (!state.riverMeasureDepthOn && !state.riverMeasureWidthOn) {
        riverWidthMeasure.hide();
      } else {
        refreshRiverStationMeasure();
        const p = interpolateChainage(dataset.chainage, state.selectedChainageMeters);
        if (p?.x != null) window.__MM_SCENE__?.frameRiverMeasure?.(p.x, p.z, p.meters);
      }
      document.dispatchEvent(new CustomEvent("river-measure-ui-sync"));
      return {
        depthOn: state.riverMeasureDepthOn,
        widthOn: state.riverMeasureWidthOn,
      };
    },
    clearRiverStationMeasure,
    refreshRiverStationMeasure,
    setDistanceMeasureActive(on) {
      // Leaving depth/width 3D overlays so they don't compete with free pick.
      if (on && siltAreaTool.isActive()) siltAreaTool.setActive(false);
      if (on) {
        state.riverMeasureDepthOn = false;
        state.riverMeasureWidthOn = false;
        riverWidthMeasure.hide();
        document.dispatchEvent(new CustomEvent("river-measure-ui-sync"));
      }
      distanceMeasure.setActive(!!on);
      return distanceMeasure.getSnapshot();
    },
    clearDistanceMeasure() {
      distanceMeasure.clearPoints();
      return distanceMeasure.getSnapshot();
    },
    addDistanceMeasurePoint(x, z, y) {
      return distanceMeasure.addPoint(x, z, y);
    },
    getDistanceMeasureSnapshot() {
      return distanceMeasure.getSnapshot();
    },
    setSiltAnalysisActive(on) {
      if (on && distanceMeasure.isActive()) {
        distanceMeasure.setActive(false);
        document.dispatchEvent(new CustomEvent("profile-analysis-exit"));
      }
      siltAreaTool.setActive(!!on);
      return siltAreaTool.getSnapshot();
    },
    setSiltAnalysisSuspended(on) {
      siltAreaTool.setSuspended(!!on);
      return siltAreaTool.getSnapshot();
    },
    resetSiltAnalysis() {
      siltAreaTool.reset();
      return siltAreaTool.getSnapshot();
    },
    editSiltAnalysis() {
      if (siltAreaTool.editSiltAnalysis) siltAreaTool.editSiltAnalysis();
      return siltAreaTool.getSnapshot();
    },
    setSiltCutaway(on) {
      if (siltAreaTool.setCutaway) siltAreaTool.setCutaway(on);
    },
    addSiltAnalysisPoint(x, z) {
      return siltAreaTool.addPoint(x, z);
    },
    selectSiltHotspot(id) {
      return siltAreaTool.selectHotspot(id);
    },
    setSiltHoverMarker(wx, wz) { if (siltAreaTool.setHoverMarker) siltAreaTool.setHoverMarker(wx, wz); }, removeSiltHoverMarker() { if (siltAreaTool.removeHoverMarker) siltAreaTool.removeHoverMarker(); }, getSiltAnalysisSnapshot() {
      return siltAreaTool.getSnapshot();
    },
    setDistanceMeasureProfileCursor(sample) {
      distanceMeasure.setProfileCursor?.(sample);
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
      if (waterFill) waterFill.visible = false;
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
      try {
      apiFloodLayer.loadFloodResult(result);
      } catch (err) {
        console.error("[apiFlood] apply failed", err);
        state.floodSimStatus = "error";
        state.floodSimMessage = err?.message || "Flood visualization failed.";
        throw err;
      }
      apiFloodLayer.setVisible(state.showFloodSimulation !== false && state.apiFlood?.showLayer !== false);
      state.floodSimInfo = apiFloodLayer.userData?.info || result?.info || null;
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
      if (!apiFloodLayer.userData?.hasFlood && !apiFloodLayer.hasFlood && !apiFloodLayer.children.length) return;
      apiFloodLayer.setVisible(state.showFloodSimulation !== false);
      apiFloodLayer.replay();
    },
    playFloodTimeline() {
      if (!apiFloodLayer.userData?.hasFlood && !apiFloodLayer.hasFlood && !apiFloodLayer.children.length) return;
      apiFloodLayer.setVisible(state.showFloodSimulation !== false);
      apiFloodLayer.playTimeline?.();
    },
    pauseFloodSimulation() {
      apiFloodLayer.pause?.();
    },
    /** Continue the loaded simulation from its current progress (restarts only if finished). */
    resumeFloodSimulation() {
      if (!apiFloodLayer.userData?.hasFlood && !apiFloodLayer.hasFlood && !apiFloodLayer.children.length) return;
      apiFloodLayer.setVisible(state.showFloodSimulation !== false);
      apiFloodLayer.play();
    },
    /** Stop playback and put the simulation clock back at the river (0). */
    resetFloodSimulation() {
      window.__MM_SCENE__.setFloodProgress(0);
    },
    /** Scrub the simulation clock (0 = river, 1 = full API extent). Pauses playback. */
    setFloodProgress(p) {
      if (!apiFloodLayer.userData?.hasFlood && !apiFloodLayer.hasFlood && !apiFloodLayer.children.length) return;
      apiFloodLayer.pause?.();
      apiFloodLayer.setProgress?.(p);
      window.dispatchEvent(
        new CustomEvent("flood-sim-progress", {
          detail: {
            progress: apiFloodLayer.userData.getProgress?.() ?? p,
            info: apiFloodLayer.userData.getInfo?.(),
          },
        }),
      );
    },
    setFloodScene(index, opts = {}) {
      const animate = opts.animate === true;
      apiFloodLayer.setSceneIndex?.(index, { animate });
      if (!animate) apiFloodLayer.setProgress?.(1);
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
      if (cinematic.isActive()) cinematic.stop();
      state.cinematicActive = false;
      const b = apiFloodLayer.userData?.getBounds?.();
      if (!b || !Number.isFinite(b.cx) || !Number.isFinite(b.cz)) return;
      // 2D map: frame the real flood bounding box inside the corridor (no pan to the mass centroid).
      if (cam.focusMap2DBounds?.(b, { dur: 0.9 })) return;
      const span = Math.hypot(b.spanX || 200, b.spanZ || 200);
      const floodHeight = THREE.MathUtils.clamp(span * 0.45, 60, 240);
      const floodBack = THREE.MathUtils.clamp(span * 0.65, 100, 320);
      cam.focusOnXZ?.(b.cx, b.cz, {
        cameraHeight: floodHeight,
        cameraDistance: floodBack,
        lookAheadDistance: 60,
        dur: 1.6,
      });
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
      if (active) {
        state.garbageSelectionActive = false;
        window.__MM_SCENE__?.clearGarbageSelection?.();
      }
      if (!active) {
        joiningCtrl.deactivate();
      }
      if (cam?.controls) cam.controls.enabled = true;
      nallaFlow.userData?.setJoiningStreamsMode?.(active);
      // Hide static duplicate bank tubes while Joining Streams is active
      const banks = drainageLayer.userData?.staticBanks;
      if (banks) banks.visible = !active;
      window.__MM_SCENE__.setDrainageFlow(active);
      document.getElementById("ui-root")?.classList.toggle("joining-streams-mode", active);
      if (active) {
        if (typeof joiningCtrl.setEnabled === "function") joiningCtrl.setEnabled(true);
        else joiningCtrl.activate();
      } else if (banks) {
        banks.visible = true;
      }
      return { ok: true, active, count: joiningCtrl.getRecords().length };
    },
    stepJoiningStream(delta) {
      if (!state.joiningStreamsMode) return null;
      if (!joiningCtrl.isActive()) {
        if (typeof joiningCtrl.setEnabled === "function") joiningCtrl.setEnabled(true);
        else joiningCtrl.activate();
      }
      const d = Number(delta);
      if (!Number.isFinite(d) || d === 0) {
        return joiningCtrl.getSelectedDrainage?.() ?? joiningCtrl.getSelected();
      }
      // River-ordered drainage navigation (NOT main-river chainage)
      return d > 0
        ? joiningCtrl.nextDrainage?.() ?? joiningCtrl.goToNextDrainage?.() ?? joiningCtrl.step(d)
        : joiningCtrl.previousDrainage?.() ?? joiningCtrl.goToPreviousDrainage?.() ?? joiningCtrl.step(d);
    },
    /** Re-pick nearest drainage to current camera / chainage and fly to it. */
    focusNearestJoiningStream() {
      if (!state.joiningStreamsMode) return null;
      return joiningCtrl.selectNearestToView({ source: "refocus" });
    },
    getJoiningStreamCount() {
      return joiningCtrl.getRecords().length;
    },
    getJoiningStreamSelected() {
      return joiningCtrl.getSelected();
    },
    hoverJoiningStream(recOrNull) {
      nallaFlow.userData?.setHovered?.(recOrNull || null);
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
    /** Geology → Bathymetry: mula_mutha_depth_blueshade_smoothed.kmz raster */
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
        joiningCtrl.select(null);
        return;
      }
      // Same camera path as Forward/Backward
      if (typeof joiningCtrl.focusRecord === "function") {
        return joiningCtrl.focusRecord(rec, { source: "click" });
      }
      return joiningCtrl.select(rec, {
        syncChainage: true,
        focusCamera: true,
        cameraMode: "drainage-focus",
        source: "click",
      });
    },
    clearJoiningStreamSelection() {
      // Keep last selection on empty terrain click — do not randomly re-pick.
      // Explicit clear only when leaving Joining Streams mode.
      if (!state.joiningStreamsMode) joiningCtrl.select(null);
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
    // Digital Twin asset marker controls
    setAssetMarkersVisible(v) { assetMarkers.setVisible(!!v); },
    getAssetMarkers() { return assetMarkers; },
  };

  return {
    whenReady,
    setCamera: (mode) => {
      if (cinematic.isActive()) cinematic.finish();
      cam.applyMode(mode);
    },
    rotateCompass: (dir) => {
      if (cinematic.isActive()) cinematic.finish();
      cam.rotateToCompass(dir);
    },
    resetOrientation: () => {
      if (cinematic.isActive()) cinematic.finish();
      cam.resetOrientation();
    },
    zoomIn: () => {
      if (cinematic.isActive()) cinematic.finish();
      cam.zoomIn();
    },
    zoomOut: () => {
      if (cinematic.isActive()) cinematic.finish();
      cam.zoomOut();
    },
    startWaterFlow: () => {
      cam.ensurePerspective?.();
      cinematic.start();
    },
    pauseWaterFlow: () => cinematic.pause(),
    resumeWaterFlow: () => cinematic.resume(),
    togglePauseWaterFlow: () => cinematic.togglePause(),
    stopCinematic: () => cinematic.finish(),
    isCinematicActive: () => cinematic.isActive(),
    isCinematicPaused: () => cinematic.isPaused(),
    getQuality: () => quality.get(),
    setQuality(tier) {
      const normalized = tier === "balanced" ? "medium" : tier;
      return quality.setTier(normalized);
    },
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
      if (apiFloodActive && hydrologySimulationActive) {
        // Do not resurrect a stale hydrology run after API flood playback ends.
        hydrologySimulationRiseM = 0;
        hydrologySimulationActive = false;
        hydrologySimulationNeedsFinalUpdate = true;
      }
      // River stage follows flood-product water rise (mm→m × progress). Camera/chainage stay fixed.
      let floodRise = state.floodRiseM ?? 0;
      if (apiFloodActive) {
        const info = apiFloodLayer.userData.getInfo?.();
        const p = Math.max(0, Math.min(1, apiFloodLayer.userData.getProgress?.() || 0));
        const riseM =
          Number.isFinite(info?._target_water_rise_m) && info._target_water_rise_m >= 0
            ? info._target_water_rise_m
            : Number.isFinite(info?.water_rise_m) && info.water_rise_m >= 0
              ? info.water_rise_m
              : null;
        if (riseM != null) {
          floodRise = p * riseM;
          state.floodRiseM = floodRise;
        }
      }
      // Bank erosion: dark channel so neon green/yellow ribbon pops (reference look)
      const riverLook = cutaway
        ? "cutaway"
        : erosionDark
          ? "erosionDark"
          : waterOn
            ? "water"
            : "depth";
      // Keep a smoothed copy of hydraulic station WSE for HUD / telemetry only.
      // Do NOT bend the rendered ribbon to those Y values in normal mode — that
      // floats the sheet above banks carved to SURFACE_Y (up to +6 m).
      const lerpSpeed = Math.min(1.0, dt * 2.5);
      for (let s = 0; s < corridorStationCount; s++) {
        const diff = targetStationWaterY[s] - currentStationWaterY[s];
        if (Math.abs(diff) > 0.001) {
          currentStationWaterY[s] += diff * lerpSpeed;
        } else {
          currentStationWaterY[s] = targetStationWaterY[s];
        }
      }

      // API flood: river sheet rises with the flood water (SURFACE_Y + rise).
      // Normal mode: leave the river sheet at SURFACE_Y — no extra stage.
      const simulationActive = hydrologySimulationActive && !apiFloodActive;
      const forceRiverRise = apiFloodActive && floodRise >= 0;
      const sheetRise = apiFloodActive ? floodRise : simulationActive ? hydrologySimulationRiseM : 0;
      if (
        forceRiverRise ||
        bedExag !== lastExag ||
        state.visualMode !== lastVisual ||
        Math.abs(sheetRise - lastFlood) > 0.015 ||
        hydrologySimulationNeedsFinalUpdate ||
        waterOn !== lastWaterOn ||
        riverLook !== lastRiverLook ||
        apiFloodActive !== lastApiFlood
      ) {
        lastExag = bedExag;
        lastVisual = state.visualMode;
        lastFlood = sheetRise;
        lastWaterOn = waterOn;
        lastRiverLook = riverLook;
        lastApiFlood = apiFloodActive;
        hydrologySimulationNeedsFinalUpdate = false;
        applyExaggeration(
          river,
          dataset,
          bedExag,
          sheetRise,
          null,
          { includeBaseStage: false, allowNegativeRise: simulationActive },
        );
        renderedHydrologySimulationRiseM = simulationActive ? sheetRise : 0;
        riparianLayer?.userData.syncToWater(river.mesh, sheetRise);
        if (!apiFloodActive && !simulationActive) {
          floodLayer.setFloodRise?.(floodRise);
        } else {
          // API flood water is the JalNetra extent sheet only — hide the full-scene bathtub.
          floodLayer.setFloodRise?.(0);
          floodLayer.visible = false;
        }
        updateBridgePiers(bridges, bedExag, SURFACE_Y + sheetRise);
        applyRiverLook(river, riverLook);
      }
      if (state.hydrologyHidesFlood) {
        floodLayer.visible = false;
        apiFloodLayer.visible = false;
      }
      // River OFF / Bank Erosion mode → hide water; bed stays as ground deep view
      river.mesh.visible = waterOn;
      if (river.material) river.material.visible = waterOn;
      river.bed.visible = state.showBathymetry !== false;
      // Walls off in water mode (they look like a floating turquoise block).
      river.walls.visible = state.showBathymetry !== false && riverLook !== "water";
      if (river.wire) river.wire.visible = !!state.showWaterDebug && waterOn;
      // Keep hydrology draped overlays on when a layer is active
      if (hydrologyLayer.userData?.getActiveId?.()) {
        hydrologyLayer.visible = true;
        hydrologyLayer.userData?.setCamera?.(cam.camera);
        hydrologyLayer.userData?.update?.(dt);
      }
      if (bodCodLayer.visible) {
        bodCodLayer.userData?.update?.(dt);
      }
      if (aqiRiverLayer.visible) {
        aqiRiverLayer.userData?.update?.(dt);
      }
      terrain.mesh.visible = true;
      channelBanks.visible = true;
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
        (!!apiFloodLayer.userData?.hasFlood || !!apiFloodLayer.hasFlood || !!apiFloodLayer.children.length);
      apiFloodLayer.visible = showFloodSim;
      if (showFloodSim) {
        apiFloodLayer.update?.(dt);
        // River sheet uses the rise just published by the flood sheet (same frame).
        const riseNow = Math.max(0, Number(state.floodRiseM) || 0);
        if (apiFloodActive && Math.abs(riseNow - lastFlood) > 1e-4) {
          lastFlood = riseNow;
          applyExaggeration(river, dataset, bedExag, riseNow, null, { includeBaseStage: false });
          riparianLayer?.userData.syncToWater(river.mesh, riseNow);
        }
      }
      if (urbanResult) urbanResult.visible = true;
      if (urbanResult?.userData?.buildings) urbanResult.userData.buildings.visible = true;
      if (urbanResult?.userData?.roads) urbanResult.userData.roads.visible = true;
      if (lodThrottle.ready(dt)) {
        urbanResult?.userData?.updateLod?.(cam.camera);
      }
      // Always keep OSM + API + permanent vegetation-type trees visible.
      state.showVegetation = true;
      state.showOsmTrees = true;
      if (treesResult) treesResult.visible = true;
      if (treesGroup) treesGroup.visible = true;
      if (vegApiResult) vegApiResult.visible = true;
      if (vegApiGroup) vegApiGroup.visible = true;
      if (vegTypePermanent) {
        vegTypeGrowGroup.visible = true;
        // Only run grow animation while unfinished (permanent places at full scale)
        if (!vegTypePermanent.userData?.empty) {
          vegTypePermanent.userData?.update?.(dt);
        }
      }
      bridges.visible = true;
      if (labelThrottle.ready(dt)) {
        updateBridgeLabels(bridges);
      }
      bridgeLabels.update(cam.camera);
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
      const map2dIdle = isMap2DMode() && !cinematic.isActive();
      if (map2dIdle) {
        particles.mesh.visible = false;
        waterFx.group.visible = false;
      } else {
      if (particles.mesh.visible) particles.update(dt);
      if (waterFx.group.visible) waterFx.update(dt);
        riverRain.update(dt);
      }
      if (chainThrottle.ready(dt)) {
        chainage.update(cam.camera);
        if (state.lithologyTipActive) pinLithologyPickTip();
      }
      riverWidthMeasure.update?.(cam.camera);
      distanceMeasure.update?.(cam.camera);
      siltAreaTool.update(cam.camera);
      assetMarkers.tick(dt);
      cinematic.update(dt);
      if (fishing) fishing.update(dt, cam.camera);
      if (!cinematic.isActive()) {
        stepChainFlight(dt);
        // Orbit damping must not run during a chainage pass — it snaps back
        // to the previous station after the first click.
        if (!journey.active) cam.update(dt);
      }
      const h = cam.camera.position.y;
      if (isMap2DMode() && !state.cinematicActive && cam.camera.isOrthographicCamera) {
        // True 2D GIS view — no fog, haze, or atmospheric wash
        setUnderwaterLook(false);
        applyMap2DClarity();
      } else if (state.cinematicUnderwater) {
        setUnderwaterLook(true);
        atmosphericSky.setVisible(false);
        if (scene.fog !== groundFog) scene.fog = groundFog;
        groundFog.density = 0.000008;
        groundFog.color.set("#7aabba");
        if (!scene.background) scene.background = new THREE.Color("#5a8fa0");
        else scene.background.set("#5a8fa0");
        renderer.toneMappingExposure = 1.55;
      } else if (cameraInRiverWater(cam.camera, dt)) {
        // Fill the water column without hiding land, depth colour, or banks.
        setUnderwaterLook(true);
        atmosphericSky.setVisible(state.skyEnabled !== false);
        atmosphericSky.update(dt, cam.camera);
        if (scene.fog !== groundFog) scene.fog = groundFog;
        groundFog.density = UNDERWATER_FOG_DENSITY;
        groundFog.color.set(UNDERWATER_COLOR);
        if (!scene.background) scene.background = new THREE.Color(UNDERWATER_COLOR);
        else scene.background.set(UNDERWATER_COLOR);
      } else {
        setUnderwaterLook(false);
        restoreAtmosphereClarity();
        const atmospheric = Math.min(0.00006, 0.00003 + h / 7_500_000);
        groundFog.density = cutaway ? 0.000028 : atmospheric * (0.7 + (state.skyAtmosphere ?? 0.55) * 0.5);
        groundFog.color.set(h > 900 ? "#889a78" : scene.userData.groundFog || "#7a8e6e");
        // Sky dome is the backdrop — keep scene.background null
        scene.background = null;
        atmosphericSky.update(dt, cam.camera);
      }
      const belowSurface = cam.camera.position.y < SURFACE_Y - 0.15;
      if (waterFill) waterFill.visible = waterOn && (underwaterLook || belowSurface);
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

/** Dev check: LULC class across the Sangam–Bund Garden reach, not the corridor polygon. */
function logCorridorLandCover(dataset, lulc) {
  if (!lulc?.classAtLocal || !dataset?.chainage?.length) return;
  const stations = dataset.corridor?.stations || [];
  const marks = [0, 500, 620, 1000, 1270, 1500, 2000];
  const rows = [];
  for (const m of marks) {
    const p = interpolateChainage(dataset.chainage, m);
    if (!p) continue;
    let st = stations[0];
    let best = Infinity;
    for (let i = 0; i < stations.length; i += 3) {
      const s = stations[i];
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d < best) { best = d; st = s; }
    }
    const px = st ? -st.flowZ : 0;
    const pz = st ? st.flowX : 0;
    const at = (dist) => lulc.classAtLocal(p.x + px * dist, p.z + pz * dist);
    rows.push({
      ch: m,
      left90: at(-90),
      left40: at(-40),
      center: at(0),
      right40: at(40),
      right90: at(90),
    });
  }
  console.info("[land-cover] CH 0+000–2+000", rows);
}
