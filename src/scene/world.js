import * as THREE from "three";
import { state } from "../state.js";
import { createTerrain } from "./terrain.js";
import { createKmlSkeleton } from "./kmlSkeleton.js";
import { createRiver, applyExaggeration, applyRiverLook, SURFACE_Y } from "./river.js";
import { createUrban } from "./urban.js";
import { createVegetation } from "./vegetation.js";
import { createBridges, updateBridgeLabels, updateBridgePiers } from "./bridges.js";
import { createCameraSystem } from "./cinematic.js";
import { attachInspect } from "./inspect.js";
import { createFlowParticles } from "./flowParticles.js";
import { createWaterEffects } from "./waterEffects.js";
import { createChainageLayer } from "./chainageMarkers.js";
import { createProjectionValidation } from "./validation.js";
import { createCoordinateGrid, mountCoordinateLabels } from "./coordinateGrid.js";
import { createRiverBankOverlay } from "./riverBanks.js";
import { createDrainageLayer } from "./drainageLayer.js";
import { createNallaFlowSystem } from "./drainage/nallaFlowSystem.js";
import { createDepthZonesLayer } from "./depthZonesLayer.js";
import { createFloodLayer } from "./floodLayer.js";
import { fillPierUniforms } from "./waterShader.js";
import { createFishingSystem } from "../features/fishing/createFishingSystem.js";
import { createCinematicController } from "../animation/cinematicController.js";
import { computeActiveSceneBounds } from "../geo/sceneBounds.js";
import { createQualityProfile, createThrottle } from "../perf/quality.js";

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
  scene.background = new THREE.Color("#9ab0a0");
  const fogDensity = dataset.dtm ? 0.000038 : 0.000055;
  scene.fog = new THREE.FogExp2("#a8b8a8", fogDensity);

  scene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(28000, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; void main(){
          float h=normalize(vP).y*0.5+0.5;
          vec3 c=mix(vec3(0.86,0.82,0.74), mix(vec3(0.78,0.86,0.84), vec3(0.48,0.64,0.76), smoothstep(0.4,0.95,h)), smoothstep(0.28,0.7,h));
          gl_FragColor=vec4(c,1.0);
        }`,
      }),
    ),
  );

  // Soft daylight — warm sun + cooler sky bounce (buildings only benefit; hydrology unchanged)
  scene.add(new THREE.HemisphereLight(0xd5e4ee, 0x6a5e4c, 0.95));
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

  const terrain = createTerrain(dataset);
  const kmlSkeleton = createKmlSkeleton(dataset);
  const river = createRiver(dataset);
  const coordinateGrid = createCoordinateGrid(dataset);
  const riverBanks = createRiverBankOverlay(dataset);
  const drainageLayer = createDrainageLayer(dataset);
  const nallaFlow = createNallaFlowSystem(dataset, drainageLayer);
  drainageLayer.add(nallaFlow);
  const depthZonesLayer = createDepthZonesLayer(dataset);
  const floodLayer = createFloodLayer(dataset);
  fillPierUniforms(river.material, dataset);
  const particles = createFlowParticles(dataset);
  const waterFx = createWaterEffects(dataset);
  const chainage = createChainageLayer(dataset);
  const validation = createProjectionValidation(dataset);
  const bridges = createBridges(dataset);

  scene.add(terrain.mesh);
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
  scene.add(depthZonesLayer);
  scene.add(floodLayer);

  const uiRoot = document.getElementById("ui-root");

  sun.target.position.set(dataset.corridor.bounds.cx, 0, dataset.corridor.bounds.cz);
  scene.add(sun.target);

  const cam = createCameraSystem(canvas, dataset);
  const coordLabels = mountCoordinateLabels(uiRoot, coordinateGrid, cam.camera, canvas);
  attachInspect(canvas, cam.camera, [river.mesh, river.bed], terrain.mesh, dataset, tooltip, {
    getDrainageGroup: () => drainageLayer,
    getDepthZonesGroup: () => depthZonesLayer,
    getNallaFlow: () => nallaFlow,
  });

  // Progressive load: core scene visible first (river + terrain + water)
  onCoreReady?.();

  const urbanGroup = new THREE.Group();
  urbanGroup.name = "urbanPending";
  scene.add(urbanGroup);

  const treesGroup = new THREE.Group();
  treesGroup.name = "treesPending";
  scene.add(treesGroup);

  const fishGroup = new THREE.Group();
  fishGroup.name = "fishPending";
  scene.add(fishGroup);

  let urbanResult = null;
  let treesResult = null;
  let fishing = null;

  // Buildings/roads (~12MB GeoJSON) load AFTER first paint so the spinner is not stuck
  const loadUrbanLayers = async () => {
    try {
      if (typeof dataset.loadOsmLater === "function" && !dataset.osm?.loaded) {
        const osm = await dataset.loadOsmLater();
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
      const [gUrban, gTrees] = await Promise.all([createUrban(dataset), createVegetation(dataset)]);
      urbanResult = gUrban;
      urbanGroup.add(gUrban);
      treesResult = gTrees;
      treesGroup.add(gTrees);
    } catch (err) {
      console.warn("Progressive urban/vegetation load:", err.message);
    }
  };

  // Yield one frame so the canvas can present before heavy OSM parse
  requestAnimationFrame(() => {
    setTimeout(loadUrbanLayers, 50);
  });

  createFishingSystem(dataset, canvas, cam.camera, uiRoot, { waterEffects: waterFx })
    .then((sys) => {
      fishing = sys;
      fishGroup.add(sys.group);
      if (sys.zones) cinematic.setFishingZones(sys.zones);
      if (dataset.fishingZones?.length) {
        dataset.activeSceneBounds = computeActiveSceneBounds(dataset);
      }
    })
    .catch((err) => console.warn("Fishing system load:", err.message));

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
    const selM = state.selectedChainageMeters;
    if (selM == null) return;
    const sel = (dataset.chainage || []).find((c) => c.meters === selM);
    if (!sel || sel.x == null) return;
    chainTipWorld.set(sel.x, SURFACE_Y + 8, sel.z);
    chainTipNdc.copy(chainTipWorld).project(cam.camera);
    if (chainTipNdc.z > 1) return;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + (chainTipNdc.x * 0.5 + 0.5) * rect.width + 18;
    const sy = rect.top + (-chainTipNdc.y * 0.5 + 0.5) * rect.height - 10;
    showChainageTipAt(sx, sy, sel);
  }

  function resolveChainageUnderCursor(e, maxDistM = 70) {
    const rect = canvas.getBoundingClientRect();
    chainPickPtr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    chainPickPtr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    chainPickRay.setFromCamera(chainPickPtr, cam.camera);
    return chainage.pick?.(chainPickRay, cam.camera, maxDistM) || null;
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
    // Selecting any station → show every chainage label with meters
    state.showChainage = true;
    state.showChainageLabels = true;
    const labelsEl = document.querySelector("#chain-labels");
    if (labelsEl) {
      labelsEl.checked = true;
      labelsEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (e.detail?.focus === false) return;
    const m = e.detail?.meters;
    if (m == null) return;
    const p = (dataset.chainage || []).find((c) => c.meters === m);
    if (!p || p.x == null) return;
    cam.focusOnXZ?.(p.x, p.z, {
      heightMode: "detail",
      pitchDeg: 48,
      lookAhead: 0.04,
      lateralBiasM: 0,
      dur: 0.95,
    });
    setTimeout(() => pinSelectedChainageTip(), 120);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (chainHoverRaf) return;
    chainHoverRaf = requestAnimationFrame(() => {
      chainHoverRaf = 0;
      if (state.cinematicActive || !state.showChainage) {
        state.chainageTipActive = false;
        return;
      }
      // Prefer pinned tip on selection; river hover handles the rest
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
    cam.camera.aspect = w / h;
    cam.camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    // Keep Overview framed to KML after aspect changes
    if (state.cameraMode === "overview" && !cinematic.isActive()) {
      cam.applyMode("overview");
    }
  }
  window.addEventListener("resize", resize);
  resize();
  // Initial load: snap to KML overview with correct aspect
  cam.applyMode("overview");

  let lastExag = state.depthExaggeration;
  let lastVisual = state.visualMode;
  let lastFlood = state.floodRiseM ?? 0;
  applyRiverLook(river, false);

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
    coordinateGrid,
    riverBanks,
    drainageLayer,
    nallaFlow,
    depthZonesLayer,
    floodLayer,
    cam,
    getDrainageStats: () => drainageLayer.userData?.stats || null,
    getNallaFlowStats: () => nallaFlow.userData?.stats || null,
    getDepthZonesStats: () => depthZonesLayer.userData?.stats || null,
    /** @deprecated Drainage flow is driven by showDrainage (Nullahs checkbox) only */
    setDrainageFlow(on) {
      state.showDrainage = !!on;
      state.showNallaFlow = !!on;
      drainageLayer.visible = !!on;
      const dEl = document.querySelector("#drainage");
      if (dEl) dEl.checked = !!on;
      if (on) nallaFlow.userData?.playReveal?.();
      else nallaFlow.userData?.setActive?.(false);
    },
    toggleDrainageFlow() {
      window.__MM_SCENE__.setDrainageFlow(!state.showDrainage);
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
    startWaterFlow: () => cinematic.start(),
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
      // When not in cinematic, keep water flow/opacity synced to UI (readable streaks)
      if (!cinematic.isActive()) {
        river.material.uniforms.uFlowSpeed.value = Math.max(0.35, Math.min(1.0, state.flowSpeed));
        if (river.material.uniforms.uOpacity) {
          // When depth-zone polygons are on, thin the surface so bands stay visible
          const op = state.showDepthZones
            ? Math.min(state.waterOpacity, 0.52)
            : Math.max(0.72, state.waterOpacity);
          river.material.uniforms.uOpacity.value = op;
        }
      }
      // Always tint floating water by bathymetry depth (light→dark blue)
      river.material.uniforms.uShowDepth.value = 1;
      if (river.material.uniforms.uShowFlowVis) {
        river.material.uniforms.uShowFlowVis.value = state.flowVisibility;
      }
      const cutaway = state.visualMode === "cutaway";
      river.material.uniforms.uCutaway.value = cutaway ? 1 : 0;
      if (cutaway && !cinematic.isActive()) {
        river.material.uniforms.uOpacity.value = Math.min(state.waterOpacity, 0.28);
      }
      const bedExag = cutaway ? Math.max(5, state.depthExaggeration) : state.depthExaggeration;
      const floodRise = state.floodRiseM ?? 0;
      if (bedExag !== lastExag || state.visualMode !== lastVisual || floodRise !== lastFlood) {
        lastExag = bedExag;
        lastVisual = state.visualMode;
        lastFlood = floodRise;
        applyExaggeration(river, dataset, bedExag, floodRise);
        floodLayer.setFloodRise?.(floodRise);
        updateBridgePiers(bridges, bedExag);
        applyRiverLook(river, cutaway);
      }
      river.mesh.visible = state.showWater;
      river.bed.visible = state.showBathymetry;
      river.walls.visible = state.showBathymetry || state.showWater;
      if (river.wire) river.wire.visible = !!state.showWaterDebug;
      terrain.mesh.visible = state.showTerrain;
      kmlSkeleton.visible = state.showMapReferenceGrid || state.showKmlSkeleton;
      coordinateGrid.visible = state.showMapReferenceGrid || state.showCoordinateGrid;
      if (coordThrottle.ready(dt)) {
        coordLabels.setVisible(state.showMapReferenceGrid || state.showCoordinateGrid);
        coordLabels.update();
      }
      riverBanks.visible = state.showValidation || state.showOsmAlignment;
      drainageLayer.visible = state.showDrainage;
      nallaFlow.userData?.update?.(dt, cam.camera);
      depthZonesLayer.visible = state.showDepthZones;
      depthZonesLayer.userData?.update?.(dt);
      if (urbanResult) urbanResult.visible = true;
      if (urbanResult?.userData?.buildings) urbanResult.userData.buildings.visible = true;
      if (urbanResult?.userData?.roads) urbanResult.userData.roads.visible = true;
      if (lodThrottle.ready(dt)) {
        urbanResult?.userData?.updateLod?.(cam.camera);
      }
      if (treesResult) treesResult.visible = true;
      bridges.visible = true;
      if (labelThrottle.ready(dt)) {
        updateBridgeLabels(bridges, cam.camera);
      }
      validation.visible = state.showValidation || state.showOsmAlignment;
      terrain.outline.visible = state.showValidation;
      particles.mesh.visible = state.showWater && state.flowVisibility > 0.05;
      waterFx.group.visible = state.showWater;
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
        pinSelectedChainageTip();
      }
      cinematic.update(dt);
      if (fishing) fishing.update(dt, cam.camera);
      if (!cinematic.isActive()) cam.update(dt);
      const h = cam.camera.position.y;
      if (state.cinematicUnderwater) {
        scene.fog.density = 0.000008;
        scene.fog.color.set("#7aabba");
        scene.background.set("#5a8fa0");
        renderer.toneMappingExposure = 1.55;
      } else {
        const atmospheric = Math.min(0.000055, 0.000028 + h / 8_000_000);
        scene.fog.density = cutaway ? 0.000028 : atmospheric;
        scene.fog.color.set(h > 800 ? "#b0c0b8" : "#a8b8a8");
        scene.background.set(h > 1200 ? "#98a898" : "#9ab0a0");
        renderer.toneMappingExposure = h > 1000 ? 1.18 : 1.22;
      }
      renderer.render(scene, cam.camera);
    },
  };
}
