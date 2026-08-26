import * as THREE from "three";
import { state } from "../state.js";
import { createTerrain } from "./terrain.js";
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
import { fillPierUniforms } from "./waterShader.js";
import { createFishingSystem } from "../features/fishing/createFishingSystem.js";
import { createCinematicController } from "../animation/cinematicController.js";

export async function createWorld(canvas, dataset, tooltip) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#9ab0a0");
  scene.fog = new THREE.FogExp2("#a8b8a8", 0.000055);

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
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.04;
  sun.shadow.camera.left = -5000;
  sun.shadow.camera.right = 5000;
  sun.shadow.camera.top = 2800;
  sun.shadow.camera.bottom = -2800;
  sun.shadow.camera.far = 14000;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xb4c4d4, 0.32);
  fill.position.set(1600, 900, -1400);
  scene.add(fill);

  const terrain = createTerrain(dataset);
  const river = createRiver(dataset);
  const urban = await createUrban(dataset);
  const trees = createVegetation(dataset);
  const bridges = createBridges(dataset);
  fillPierUniforms(river.material, dataset);
  const particles = createFlowParticles(dataset);
  const waterFx = createWaterEffects(dataset);
  const chainage = createChainageLayer(dataset);
  const validation = createProjectionValidation(dataset);

  scene.add(terrain.mesh);
  scene.add(terrain.outline);
  scene.add(river.bed);
  scene.add(river.walls);
  scene.add(river.mesh);
  if (river.wire) scene.add(river.wire);
  scene.add(particles.mesh);
  scene.add(waterFx.group);
  scene.add(chainage.group);
  scene.add(urban);
  scene.add(trees);
  scene.add(bridges);
  scene.add(validation);

  sun.target.position.set(dataset.corridor.bounds.cx, 0, dataset.corridor.bounds.cz);
  scene.add(sun.target);

  const cam = createCameraSystem(canvas, dataset);
  attachInspect(canvas, cam.camera, [river.mesh, river.bed], terrain.mesh, dataset, tooltip);

  // Click a red chainage pin to select it; hover THAT pin for station/meters.
  // Everywhere else, river water-depth hover stays (inspect).
  const chainPickRay = new THREE.Raycaster();
  const chainPickPtr = new THREE.Vector2();
  let chainHoverRaf = 0;
  const chainPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURFACE_Y);
  const chainHitPt = new THREE.Vector3();

  function showChainageTip(e, p) {
    if (!p) return;
    state.chainageTipActive = true;
    tooltip.show(e.clientX, e.clientY, {
      chainageHover: true,
      label: p.label,
      meters: p.meters,
    });
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
    if (hit) showChainageTip(e, hit);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (chainHoverRaf) return;
    chainHoverRaf = requestAnimationFrame(() => {
      chainHoverRaf = 0;
      if (state.cinematicActive || !state.showChainage) {
        state.chainageTipActive = false;
        return;
      }
      const selM = state.selectedChainageMeters;
      if (selM == null) {
        state.chainageTipActive = false;
        return;
      }
      const sel = (dataset.chainage || []).find((c) => c.meters === selM);
      if (!sel) {
        state.chainageTipActive = false;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      chainPickPtr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      chainPickPtr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      chainPickRay.setFromCamera(chainPickPtr, cam.camera);

      // Only show chainage tip while hovering the *selected* red pin
      const meshes = chainage.group.children.filter((c) => c.isInstancedMesh);
      const hits = chainPickRay.intersectObjects(meshes, false);
      let overSelected = false;
      if (hits.length) {
        const h = hits[0];
        overSelected = Math.hypot(h.point.x - sel.x, h.point.z - sel.z) < 25;
      }
      if (!overSelected && chainPickRay.ray.intersectPlane(chainPlane, chainHitPt)) {
        overSelected = Math.hypot(chainHitPt.x - sel.x, chainHitPt.z - sel.z) < 55;
      }
      if (overSelected) {
        showChainageTip(e, sel);
      } else {
        state.chainageTipActive = false;
      }
    });
  });

  const uiRoot = document.getElementById("ui-root");
  const fishing = await createFishingSystem(dataset, canvas, cam.camera, uiRoot, {
    waterEffects: waterFx,
  });
  scene.add(fishing.group);

  const cinematic = createCinematicController({
    camera: cam.camera,
    controls: cam.controls,
    dataset,
    getRiverMaterial: () => river.material,
    waterEffects: waterFx,
    flowParticles: particles,
    onComplete: () => cam.applyMode("overview"),
  });
  if (fishing.zones) cinematic.setFishingZones(fishing.zones);

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
  applyRiverLook(river, false);

  return {
    setCamera: (mode) => {
      if (cinematic.isActive()) return;
      cam.applyMode(mode);
    },
    startWaterFlow: () => cinematic.start(),
    pauseWaterFlow: () => cinematic.pause(),
    resumeWaterFlow: () => cinematic.resume(),
    togglePauseWaterFlow: () => cinematic.togglePause(),
    isCinematicActive: () => cinematic.isActive(),
    isCinematicPaused: () => cinematic.isPaused(),
    update(dt) {
      state.elapsed += dt;
      river.material.uniforms.uTime.value = state.elapsed;
      // When not in cinematic, keep water flow/opacity synced to UI (readable streaks)
      if (!cinematic.isActive()) {
        river.material.uniforms.uFlowSpeed.value = Math.max(0.45, state.flowSpeed);
        if (river.material.uniforms.uOpacity) {
          river.material.uniforms.uOpacity.value = Math.max(0.55, state.waterOpacity);
        }
      }
      river.material.uniforms.uShowDepth.value = state.showBathymetry ? 1 : 0;
      if (river.material.uniforms.uShowFlowVis) {
        river.material.uniforms.uShowFlowVis.value = Math.max(0.75, state.flowVisibility);
      }
      const cutaway = state.visualMode === "cutaway";
      river.material.uniforms.uCutaway.value = cutaway ? 1 : 0;
      if (cutaway && !cinematic.isActive()) {
        river.material.uniforms.uOpacity.value = Math.min(state.waterOpacity, 0.28);
      }
      const bedExag = cutaway ? Math.max(5, state.depthExaggeration) : state.depthExaggeration;
      if (bedExag !== lastExag || state.visualMode !== lastVisual) {
        lastExag = bedExag;
        lastVisual = state.visualMode;
        applyExaggeration(river, dataset, bedExag);
        updateBridgePiers(bridges, bedExag);
        applyRiverLook(river, cutaway);
      }
      river.mesh.visible = state.showWater;
      river.bed.visible = state.showBathymetry;
      river.walls.visible = state.showBathymetry || state.showWater;
      if (river.wire) river.wire.visible = !!state.showWaterDebug;
      terrain.mesh.visible = state.showTerrain;
      urban.visible = state.showUrban;
      if (urban.userData?.buildings) urban.userData.buildings.visible = state.showOsmBuildings;
      if (urban.userData?.roads) urban.userData.roads.visible = state.showOsmRoads;
      trees.visible = state.showVegetation;
      bridges.visible = state.showBridges;
      updateBridgeLabels(bridges, cam.camera);
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
      particles.update(dt);
      waterFx.update(dt);
      chainage.update(cam.camera);
      cinematic.update(dt);
      fishing.update(dt, cam.camera);
      if (!cinematic.isActive()) cam.update(dt);
      const h = cam.camera.position.y;
      if (state.cinematicUnderwater) {
        // Minimal fog — empty blue fog was hiding the fish school
        scene.fog.density = 0.000008;
        scene.fog.color.set("#7aabba");
        scene.background.set("#5a8fa0");
        renderer.toneMappingExposure = 1.55;
      } else {
        scene.fog.density = cutaway ? 0.00003 : h > 400 ? 0.00004 : 0.00008;
        scene.fog.color.set("#a8b8a8");
        scene.background.set("#9ab0a0");
        renderer.toneMappingExposure = 1.22;
      }
      renderer.render(scene, cam.camera);
    },
  };
}
