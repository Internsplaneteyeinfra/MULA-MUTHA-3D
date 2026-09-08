import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { state } from "../state.js";
import { SURFACE_Y } from "./river.js";
import { computeSceneBounds, computeKmlOverviewBounds, computeActiveSceneBounds } from "../geo/sceneBounds.js";
import {
  stationAt,
  alongRiverPose,
  chainageGisAerialPose,
  fullRiverOverviewPose,
  heightForWidth,
  nearestStationU,
  smoothTangent,
  terrainCameraOpts,
} from "./riverCamera.js";

export function sceneName(mode) {
  switch (mode) {
    case "overview":
      return "OVERVIEW · FULL AOI";
    case "local":
      return "LOCAL 3D · SELECTED SEGMENT";
    case "bathymetry":
    case "cutaway":
      return "BATHYMETRY INSPECT";
    case "aerial":
    case "top":
    case "2d":
      return "2D · ORTHOGRAPHIC TOP VIEW";
    case "follow":
      return "RIVER PATH FOLLOW";
    case "cinematic":
      return "WATER FLOW CINEMATIC";
    case "orbit":
    default:
      return "FREE ORBIT";
  }
}

export function createCameraSystem(canvas, dataset) {
  const stations = dataset.corridor.stations;
  const b = dataset.sceneBounds || computeSceneBounds(dataset);
  const overviewBounds =
    dataset.activeSceneBounds ||
    dataset.kmlOverviewBounds ||
    computeActiveSceneBounds(dataset) ||
    computeKmlOverviewBounds(dataset);
  const dtmCam = terrainCameraOpts(dataset.dtm);
  const midU = stations[dataset.corridor.midPathIdx ?? Math.floor(stations.length / 2)].t;
  const diag = Math.hypot(b.spanX, b.spanZ);
  const mapLookY =
    dtmCam.terrainLookY != null ? dtmCam.terrainLookY : SURFACE_Y;
  const mapAltitude = Math.max(diag * 0.35, 1800);

  /** Mean open-water width along the corridor (metres). */
  function meanRiverWidthM() {
    let sum = 0;
    let n = 0;
    const step = Math.max(1, Math.floor(stations.length / 100));
    for (let i = 0; i < stations.length; i += step) {
      sum += Math.max(18, stations[i].halfWidth || 40) * 2;
      n += 1;
    }
    return sum / Math.max(1, n);
  }

  /**
   * Inspection frustum height (world metres at zoom=1).
   * Sized so the river band fills ~25–40% of screen height — NOT full AOI fit.
   */
  const riverBandM = Math.max(90, meanRiverWidthM() * 2.05);
  const MAP2D_VIEW_HEIGHT_M = THREE.MathUtils.clamp(riverBandM / 0.3, 900, 2400);
  /** Default ortho zoom for the reference GIS framing (1 = MAP2D_VIEW_HEIGHT_M). */
  const MAP2D_DEFAULT_ZOOM = 1;

  /** Perspective for Overview / orbit / cinematic. */
  const perspCamera = new THREE.PerspectiveCamera(48, 1, 1.2, 120000);
  perspCamera.up.set(0, 1, 0);

  /** Orthographic for true GIS-style 2D top-down. */
  const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200000);
  orthoCamera.up.set(0, 0, 1);

  let activeCamera = perspCamera;

  const controls = new OrbitControls(perspCamera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 12;
  controls.maxDistance = diag * 3.2;
  controls.minZoom = 0.35;
  controls.maxZoom = 12;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 1.0;
  controls.panSpeed = 0.7;
  controls.enabled = true;

  const tmpP = new THREE.Vector3();
  const tmpL = new THREE.Vector3();
  const tmpUp = new THREE.Vector3(0, 1, 0);
  const smoothP = new THREE.Vector3();
  const smoothL = new THREE.Vector3();
  const smoothUp = new THREE.Vector3(0, 1, 0);
  const NORTH_UP = new THREE.Vector3(0, 0, 1);
  let followInited = false;
  let localTransition = null;
  let orientTransition = null;
  let zoomTransition = null;

  const COMPASS_AZIMUTH = {
    n: Math.PI,
    ne: Math.PI * 0.75,
    e: Math.PI * 0.5,
    se: Math.PI * 0.25,
    s: 0,
    sw: -Math.PI * 0.25,
    w: -Math.PI * 0.5,
    nw: -Math.PI * 0.75,
  };

  function st(u) {
    return stationAt(stations, u);
  }

  function isMap2D() {
    const m = state.cameraMode;
    return m === "aerial" || m === "top" || m === "2d";
  }

  function getCamera() {
    return activeCamera;
  }

  function viewportSize() {
    const w = canvas.clientWidth || window.innerWidth || 1;
    const h = canvas.clientHeight || window.innerHeight || 1;
    return { w, h, aspect: Math.max(0.5, w / Math.max(1, h)) };
  }

  /** Focus XZ for default 2D entry — mid corridor / selection / hover (not full AOI). */
  function map2dFocusXZ() {
    const chain = dataset.chainage;
    if (state.selectedChainageMeters != null && chain?.length) {
      const p = chain.find((c) => c.meters === state.selectedChainageMeters);
      if (p && p.x != null && p.z != null) {
        return {
          x: p.x,
          z: p.z,
          u: nearestStationU(stations, p.x, p.z),
        };
      }
    }
    if (state.hover?.x != null && state.hover?.z != null) {
      return {
        x: state.hover.x,
        z: state.hover.z,
        u: nearestStationU(stations, state.hover.x, state.hover.z),
      };
    }
    const mid = st(midU);
    return { x: mid.x, z: mid.z, u: midU };
  }

  /**
   * Camera.up for top-down so the river runs roughly horizontally
   * (screen X ≈ flow, screen Y ≈ across-river), matching the reference framing.
   */
  function map2dUpAt(u) {
    const tan = smoothTangent(stations, u, 0.035);
    let ax = -tan.z;
    let az = tan.x;
    // Prefer the across-vector with a positive north (+Z) component when possible
    if (az < 0) {
      ax = -ax;
      az = -az;
    }
    const len = Math.hypot(ax, az) || 1;
    return new THREE.Vector3(ax / len, 0, az / len);
  }

  /** Orthographic window at inspection scale (not full-project fit). */
  function syncOrthoFrustum(aspect = viewportSize().aspect) {
    const viewH = MAP2D_VIEW_HEIGHT_M;
    const viewW = viewH * aspect;
    orthoCamera.left = -viewW * 0.5;
    orthoCamera.right = viewW * 0.5;
    orthoCamera.top = viewH * 0.5;
    orthoCamera.bottom = -viewH * 0.5;
    orthoCamera.near = 1;
    orthoCamera.far = 200000;
    orthoCamera.updateProjectionMatrix();
  }

  function lockMap2DControls() {
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = 0;
    // Pan + zoom only — bearing via compass (camera.up). Never tilt.
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
  }

  function unlockPerspectiveControls() {
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.enableRotate = true;
    controls.enablePan = true;
  }

  function enterMap2D({ animate = true } = {}) {
    const fromP = activeCamera.position.clone();
    const fromL = controls.target.clone();
    const fromUp = activeCamera.up.clone().normalize();

    syncOrthoFrustum();
    orthoCamera.zoom = MAP2D_DEFAULT_ZOOM;
    orthoCamera.updateProjectionMatrix();

    activeCamera = orthoCamera;
    controls.object = orthoCamera;
    lockMap2DControls();

    const focus = map2dFocusXZ();
    const up = map2dUpAt(focus.u);
    tmpP.set(focus.x, mapLookY + mapAltitude, focus.z);
    tmpL.set(focus.x, mapLookY, focus.z);
    tmpUp.copy(up);

    state.cameraMode = "aerial";
    state.playing = false;
    state.visualMode = "landscape";
    controls.enabled = true;
    followInited = false;
    orientTransition = null;
    zoomTransition = null;

    if (!animate) {
      snapTo(tmpP, tmpL, tmpUp);
      return;
    }

    orthoCamera.position.copy(fromP);
    orthoCamera.up.copy(fromUp);
    controls.target.copy(fromL);
    orthoCamera.lookAt(fromL);

    localTransition = {
      fromP,
      fromL,
      fromUp,
      toP: tmpP.clone(),
      toL: tmpL.clone(),
      toUp: up.clone(),
      t: 0,
      dur: 1.05,
      releaseMode: "aerial",
    };
  }

  function exitMap2D() {
    if (activeCamera === perspCamera) {
      unlockPerspectiveControls();
      return;
    }
    perspCamera.position.copy(orthoCamera.position);
    perspCamera.up.set(0, 1, 0);
    controls.target.copy(controls.target);
    activeCamera = perspCamera;
    controls.object = perspCamera;
    unlockPerspectiveControls();
    perspCamera.lookAt(controls.target);
    controls.update();
  }

  function takeManualControl() {
    if (state.cinematicActive) return;
    // Cancel scripted tweens; keep true 2D top-down when in map mode
    localTransition = null;
    orientTransition = null;
    zoomTransition = null;
    if (isMap2D()) {
      lockMap2DControls();
      // Keep camera directly above target (no tilt); preserve map bearing
      activeCamera.position.x = controls.target.x;
      activeCamera.position.z = controls.target.z;
      activeCamera.position.y = Math.max(activeCamera.position.y, mapLookY + 200);
      activeCamera.up.y = 0;
      if (activeCamera.up.lengthSq() < 1e-8) {
        activeCamera.up.copy(
          map2dUpAt(nearestStationU(stations, controls.target.x, controls.target.z)),
        );
      } else activeCamera.up.normalize();
      activeCamera.lookAt(controls.target);
      controls.enabled = true;
      return;
    }
    if (state.cameraMode === "follow" || state.cameraMode === "local") {
      state.playing = false;
      state.cameraMode = "orbit";
    }
    activeCamera.up.set(0, 1, 0);
    activeCamera.lookAt(controls.target);
    controls.enabled = true;
  }

  controls.addEventListener("start", takeManualControl);
  canvas.addEventListener(
    "wheel",
    () => {
      takeManualControl();
    },
    { passive: true },
  );
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      // Cancel fly-to on drag (any button) so orbit/pan feel immediate;
      // plain click still lets the zoom finish.
      if (!localTransition && !orientTransition && !zoomTransition) return;
      if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const onMove = (ev) => {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 3) {
          takeManualControl();
          cleanup();
        }
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cleanup);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup);
    },
    { passive: true },
  );

  function snapTo(pos, look, up) {
    const camera = activeCamera;
    camera.up.copy(up).normalize();
    camera.position.copy(pos);
    controls.target.copy(look);
    camera.lookAt(look);
    controls.update();
    smoothP.copy(pos);
    smoothL.copy(look);
    smoothUp.copy(up);
  }

  function applyMode(mode) {
    if (mode === "reset") {
      state.pathT = 0;
      state.playing = false;
      state.cameraMode = "overview";
      state.visualMode = "landscape";
      state.showBathymetry = true;
      state.showWater = true;
      state.showKmlSkeleton = false;
      state.showMapReferenceGrid = false;
      state.showCoordinateGrid = false;
      state.showDrainage = false;
      state.showDepthZones = false;
      state.glassyRevealActive = false;
      state.selectedDepthZoneId = null;
      state.showTerrain = true;
      state.showUrban = true;
      state.showOsmBuildings = true;
      state.showOsmRoads = true;
      state.showVegetation = true;
      state.showOsmTrees = true;
      state.showBridges = true;
      state.showBridgeNames = false;
      state.showFish = true;
      state.showFishDebug = false;
      state.showChainage = true;
      state.showChainageLabels = false;
      state.chainageLabelMode = "station";
      state.selectedChainageMeters = null;
      state.chainageTipActive = false;
      state.showValidation = false;
      state.showWaterDebug = false;
      state.showOsmAlignment = false;
      state.inspectMode = false;
      state.flowSpeed = 0.62;
      state.flowVisibility = 0.55;
      state.waterOpacity = 0.9;
      state.depthExaggeration = 2;
      mode = "overview";
    }

    controls.enabled = true;
    followInited = false;
    localTransition = null;
    orientTransition = null;
    zoomTransition = null;

    if (mode === "aerial" || mode === "top" || mode === "2d") {
      enterMap2D({ animate: true });
      return;
    }

    // All other modes use PerspectiveCamera
    exitMap2D();

    if (mode === "overview") {
      state.cameraMode = "overview";
      state.playing = false;
      state.visualMode = "landscape";
      fullRiverOverviewPose(stations, overviewBounds, 1, tmpP, tmpL, tmpUp, {
        fovDeg: perspCamera.fov,
        aspect: Math.max(0.5, perspCamera.aspect || viewportSize().aspect),
        ...dtmCam,
      });
      snapTo(tmpP, tmpL, tmpUp);
      return;
    }

    if (mode === "local") {
      state.cameraMode = "local";
      state.playing = false;
      state.visualMode = "landscape";
      let u = THREE.MathUtils.clamp(state.pathT || midU, 0.08, 0.92);
      if (state.hover?.x != null && state.hover?.z != null) {
        u = nearestStationU(stations, state.hover.x, state.hover.z);
      }
      const local = st(u);
      alongRiverPose(stations, {
        u,
        height: heightForWidth(local.half, "detail"),
        pitchDeg: 48,
        lookAhead: 0.04,
        outP: tmpP,
        outL: tmpL,
        outUp: tmpUp,
      });
      localTransition = {
        fromP: activeCamera.position.clone(),
        fromL: controls.target.clone(),
        fromUp: activeCamera.up.clone(),
        toP: tmpP.clone(),
        toL: tmpL.clone(),
        toUp: tmpUp.clone(),
        t: 0,
        dur: 1.25,
        releaseMode: "orbit",
      };
      return;
    }

    if (mode === "follow") {
      state.cameraMode = "follow";
      state.playing = true;
      state.visualMode = "landscape";
      const u = THREE.MathUtils.clamp(state.pathT || 0.02, 0.02, 0.97);
      alongRiverPose(stations, {
        u,
        height: heightForWidth(st(u).half, "medium"),
        pitchDeg: 50,
        lookAhead: 0.05,
        outP: tmpP,
        outL: tmpL,
        outUp: tmpUp,
      });
      snapTo(tmpP, tmpL, tmpUp);
      followInited = true;
      return;
    }

    if (mode === "orbit") {
      state.cameraMode = "orbit";
      state.playing = false;
      state.visualMode = "landscape";
      alongRiverPose(stations, {
        u: 0.5,
        height: Math.max(900, diag * 0.22),
        pitchDeg: 50,
        lookAhead: 0.03,
        outP: tmpP,
        outL: tmpL,
        outUp: tmpUp,
      });
      snapTo(tmpP, tmpL, tmpUp);
      return;
    }

    if (mode === "bathymetry" || mode === "cutaway") {
      state.cameraMode = "bathymetry";
      state.playing = false;
      state.visualMode = "cutaway";
      state.showBathymetry = true;
      const u = THREE.MathUtils.clamp(state.pathT || midU, 0.15, 0.85);
      alongRiverPose(stations, {
        u,
        height: heightForWidth(st(u).half, "close") + 12,
        pitchDeg: 42,
        lookAhead: 0.03,
        lookY: SURFACE_Y - 8,
        outP: tmpP,
        outL: tmpL,
        outUp: tmpUp,
      });
      snapTo(tmpP, tmpL, tmpUp);
      return;
    }
  }

  applyMode("overview");

  function shortestAzimuthDelta(from, to) {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function cameraOffsetSpherical() {
    const camera = activeCamera;
    const offset = camera.position.clone().sub(controls.target);
    return new THREE.Spherical().setFromVector3(offset);
  }

  function applySpherical(spherical) {
    const camera = activeCamera;
    const offset = new THREE.Vector3().setFromSpherical(spherical);
    camera.position.copy(controls.target).add(offset);
    if (isMap2D()) {
      camera.up.copy(NORTH_UP);
      // Enforce pure nadir: directly above target
      camera.position.x = controls.target.x;
      camera.position.z = controls.target.z;
      camera.position.y = Math.max(Math.abs(spherical.radius), mapLookY + 200);
    }
    camera.lookAt(controls.target);
    controls.update();
  }

  function rotateToCompass(direction, duration = 0.5) {
    if (state.cinematicActive) return;
    const key = String(direction || "n").toLowerCase();
    const targetTheta = COMPASS_AZIMUTH[key];
    if (targetTheta == null) return;
    takeManualControl();
    localTransition = null;
    const camera = activeCamera;
    if (isMap2D()) {
      // Spin map bearing while staying perfectly vertical (north = +Z up on screen)
      const fromUp = camera.up.clone().normalize();
      const angle = key === "n" ? 0 : -targetTheta;
      const toUp = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).normalize();
      orientTransition = {
        map2d: true,
        fromUp,
        toUp,
        t: 0,
        dur: duration,
      };
      return;
    }
    const sph = cameraOffsetSpherical();
    orientTransition = {
      fromTheta: sph.theta,
      toTheta: sph.theta + shortestAzimuthDelta(sph.theta, targetTheta),
      phi: sph.phi,
      radius: sph.radius,
      fromUp: camera.up.clone(),
      toUp: new THREE.Vector3(0, 1, 0),
      resetUp: key === "n",
      t: 0,
      dur: duration,
    };
  }

  function resetOrientation(duration = 0.5) {
    rotateToCompass("n", duration);
  }

  function zoomBy(factor, duration = 0.4) {
    if (state.cinematicActive) return;
    localTransition = null;
    orientTransition = null;
    if (isMap2D()) {
      // Map zoom: change orthographic zoom only — never tilt
      const fromZoom = orthoCamera.zoom;
      const toZoom = THREE.MathUtils.clamp(
        fromZoom / factor,
        controls.minZoom,
        controls.maxZoom,
      );
      zoomTransition = {
        map2d: true,
        fromZoom,
        toZoom,
        t: 0,
        dur: duration,
      };
      return;
    }
    takeManualControl();
    const sph = cameraOffsetSpherical();
    const next = THREE.MathUtils.clamp(
      sph.radius * factor,
      controls.minDistance,
      controls.maxDistance,
    );
    zoomTransition = {
      fromRadius: sph.radius,
      toRadius: next,
      phi: sph.phi,
      theta: sph.theta,
      t: 0,
      dur: duration,
    };
  }

  function zoomIn() {
    zoomBy(0.82);
  }

  function zoomOut() {
    zoomBy(1.22);
  }

  function resize(w, h) {
    const width = w || viewportSize().w;
    const height = h || viewportSize().h;
    const aspect = Math.max(0.5, width / Math.max(1, height));
    perspCamera.aspect = aspect;
    perspCamera.updateProjectionMatrix();
    const prevZoom = orthoCamera.zoom;
    syncOrthoFrustum(aspect);
    orthoCamera.zoom = prevZoom;
    orthoCamera.updateProjectionMatrix();
  }

  function update(dt) {
    const camera = activeCamera;

    if (zoomTransition) {
      zoomTransition.t += dt;
      const k = easeInOutCubic(Math.min(1, zoomTransition.t / zoomTransition.dur));
      if (zoomTransition.map2d) {
        orthoCamera.zoom = THREE.MathUtils.lerp(
          zoomTransition.fromZoom,
          zoomTransition.toZoom,
          k,
        );
        orthoCamera.updateProjectionMatrix();
        // Keep nadir while zooming — preserve map bearing
        camera.position.x = controls.target.x;
        camera.position.z = controls.target.z;
        camera.up.y = 0;
        if (camera.up.lengthSq() < 1e-8) camera.up.copy(NORTH_UP);
        else camera.up.normalize();
        camera.lookAt(controls.target);
        controls.update();
      } else {
        const sph = new THREE.Spherical(
          THREE.MathUtils.lerp(zoomTransition.fromRadius, zoomTransition.toRadius, k),
          zoomTransition.phi,
          zoomTransition.theta,
        );
        applySpherical(sph);
      }
      if (zoomTransition.t >= zoomTransition.dur) zoomTransition = null;
      return;
    }

    if (orientTransition) {
      orientTransition.t += dt;
      const k = easeInOutCubic(Math.min(1, orientTransition.t / orientTransition.dur));
      if (orientTransition.map2d) {
        camera.up.copy(orientTransition.fromUp).lerp(orientTransition.toUp, k).normalize();
        camera.position.x = controls.target.x;
        camera.position.z = controls.target.z;
        camera.lookAt(controls.target);
        controls.update();
      } else {
        const sph = new THREE.Spherical(
          orientTransition.radius,
          orientTransition.phi,
          THREE.MathUtils.lerp(orientTransition.fromTheta, orientTransition.toTheta, k),
        );
        applySpherical(sph);
        if (orientTransition.resetUp) {
          camera.up.copy(orientTransition.fromUp).lerp(orientTransition.toUp, k).normalize();
          camera.lookAt(controls.target);
        }
        controls.update();
      }
      if (orientTransition.t >= orientTransition.dur) orientTransition = null;
      return;
    }

    if (localTransition) {
      localTransition.t += dt;
      const k = easeInOutCubic(Math.min(1, localTransition.t / localTransition.dur));
      camera.position.lerpVectors(localTransition.fromP, localTransition.toP, k);
      controls.target.lerpVectors(localTransition.fromL, localTransition.toL, k);
      smoothUp.copy(localTransition.fromUp).lerp(localTransition.toUp, k).normalize();
      camera.up.copy(smoothUp);
      if (localTransition.fromZoom != null && localTransition.toZoom != null) {
        orthoCamera.zoom = THREE.MathUtils.lerp(
          localTransition.fromZoom,
          localTransition.toZoom,
          k,
        );
        orthoCamera.updateProjectionMatrix();
      }
      camera.lookAt(controls.target);
      controls.update();
      if (localTransition.t >= localTransition.dur) {
        const release = localTransition.releaseMode || "orbit";
        localTransition = null;
        state.cameraMode = release;
        state.playing = false;
        controls.enabled = true;
        if (release === "aerial" || release === "top" || release === "2d") {
          lockMap2DControls();
          camera.up.y = 0;
          if (camera.up.lengthSq() < 1e-8) {
            camera.up.copy(map2dUpAt(nearestStationU(stations, controls.target.x, controls.target.z)));
          } else {
            camera.up.normalize();
          }
          camera.position.x = controls.target.x;
          camera.position.z = controls.target.z;
          camera.lookAt(controls.target);
          controls.update();
        } else if (release === "orbit") {
          camera.up.set(0, 1, 0);
          camera.lookAt(controls.target);
        }
      }
      return;
    }

    if (state.cameraMode === "follow") {
      if (state.playing) {
        state.pathT += dt / state.pathDuration;
        if (state.pathT >= 1) {
          state.pathT = 1;
          state.playing = false;
          state.cameraMode = "orbit";
        }
      }
      const u = THREE.MathUtils.clamp(state.pathT, 0.02, 0.97);
      alongRiverPose(stations, {
        u,
        height: heightForWidth(st(u).half, "medium"),
        pitchDeg: 50,
        lookAhead: 0.05,
        outP: tmpP,
        outL: tmpL,
        outUp: tmpUp,
      });
      const posK = 1 - Math.exp(-dt * 2.2);
      const rotK = 1 - Math.exp(-dt * 2.6);
      if (!followInited) {
        smoothP.copy(tmpP);
        smoothL.copy(tmpL);
        smoothUp.copy(tmpUp);
        followInited = true;
      }
      smoothP.lerp(tmpP, posK);
      smoothL.lerp(tmpL, rotK);
      smoothUp.lerp(tmpUp, rotK).normalize();
      camera.position.copy(smoothP);
      controls.target.copy(smoothL);
      camera.up.copy(smoothUp);
      camera.lookAt(smoothL);
      return;
    }

    if (isMap2D()) {
      // Enforce vertical lock every frame (OrbitControls can drift)
      lockMap2DControls();
      controls.update();
      camera.position.x = controls.target.x;
      camera.position.z = controls.target.z;
      if (camera.position.y < mapLookY + 200) camera.position.y = mapLookY + mapAltitude;
      camera.up.y = 0;
      if (camera.up.lengthSq() < 1e-8) {
        camera.up.copy(map2dUpAt(nearestStationU(stations, controls.target.x, controls.target.z)));
      } else {
        camera.up.normalize();
      }
      camera.lookAt(controls.target);
      return;
    }

    controls.update();
  }

  /**
   * Chainage focus:
   * - In 2D: pan/zoom only, stay orthographic top-down
   * - Otherwise: locked forward-looking aerial river profile
   */
  function focusOnXZ(x, z, opts = {}) {
    if (state.cinematicActive) return;
    state.playing = false;
    state.visualMode = "landscape";
    controls.enabled = true;

    if (isMap2D()) {
      // Pan only — keep current inspection zoom (no sudden close-up)
      const height = Math.max(activeCamera.position.y, mapLookY + 400);
      tmpP.set(x, height, z);
      tmpL.set(x, mapLookY, z);
      const keepUp = activeCamera.up.clone();
      keepUp.y = 0;
      if (keepUp.lengthSq() < 1e-8) keepUp.copy(map2dUpAt(nearestStationU(stations, x, z)));
      else keepUp.normalize();
      const keepZoom = orthoCamera.zoom;
      zoomTransition = null;
      localTransition = {
        fromP: activeCamera.position.clone(),
        fromL: controls.target.clone(),
        fromUp: activeCamera.up.clone().normalize(),
        toP: tmpP.clone(),
        toL: tmpL.clone(),
        toUp: keepUp,
        fromZoom: keepZoom,
        toZoom: keepZoom,
        t: 0,
        dur: opts.dur ?? 0.85,
        releaseMode: "aerial",
      };
      return;
    }

    state.cameraMode = "orbit";
    const u = nearestStationU(stations, x, z);
    chainageGisAerialPose(stations, {
      u,
      x,
      z,
      cameraHeight: opts.cameraHeight ?? 380,
      cameraDistance: opts.cameraDistance ?? 420,
      lookAheadDistance: opts.lookAheadDistance ?? 520,
      lookY: opts.lookY ?? SURFACE_Y + 28,
      outP: tmpP,
      outL: tmpL,
      outUp: tmpUp,
    });

    localTransition = {
      fromP: activeCamera.position.clone(),
      fromL: controls.target.clone(),
      fromUp: activeCamera.up.clone().normalize(),
      toP: tmpP.clone(),
      toL: tmpL.clone(),
      toUp: new THREE.Vector3(0, 1, 0),
      t: 0,
      dur: opts.dur ?? 1.0,
      releaseMode: "orbit",
    };
  }

  return {
    get camera() {
      return activeCamera;
    },
    getCamera,
    controls,
    applyMode,
    focusOnXZ,
    update,
    resize,
    ensurePerspective: exitMap2D,
    stationAt: st,
    rotateToCompass,
    resetOrientation,
    zoomIn,
    zoomOut,
  };
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function sceneBounds(dataset) {
  const b = dataset.corridor.bounds;
  const ring = dataset.ringLocal;
  if (!ring?.length) return b;
  let minX = b.minX;
  let maxX = b.maxX;
  let minZ = b.minZ;
  let maxZ = b.maxZ;
  for (const c of ring) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z);
    maxZ = Math.max(maxZ, c.z);
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    spanX: maxX - minX,
    spanZ: maxZ - minZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
  };
}
