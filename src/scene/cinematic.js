import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { state } from "../state.js";
import { SURFACE_Y } from "./river.js";
import { computeSceneBounds, computeKmlOverviewBounds, computeActiveSceneBounds } from "../geo/sceneBounds.js";
import {
  stationAt,
  riverAxis,
  alongRiverPose,
  fullRiverOverviewPose,
  mapAerialPose,
  heightForWidth,
  nearestStationU,
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
      return "AERIAL / PROJECTION";
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
  const axis = riverAxis(stations);

  const camera = new THREE.PerspectiveCamera(48, 1, 1.2, 120000);
  camera.up.set(0, 1, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 12;
  controls.maxDistance = diag * 3.2;
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

  function takeManualControl() {
    if (state.cinematicActive) return;
    // Break out of scripted fly / local / follow → free mouse orbit
    localTransition = null;
    orientTransition = null;
    zoomTransition = null;
    if (state.cameraMode === "follow" || state.cameraMode === "local") {
      state.playing = false;
      state.cameraMode = "orbit";
    }
    camera.up.set(0, 1, 0);
    camera.lookAt(controls.target);
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
      state.flowSpeed = 0.85;
      state.flowVisibility = 0;
      state.waterOpacity = 0.72;
      state.depthExaggeration = 2;
      mode = "overview";
    }

    controls.enabled = true;
    followInited = false;

    if (mode === "overview") {
      state.cameraMode = "overview";
      state.playing = false;
      state.visualMode = "landscape";
      fullRiverOverviewPose(stations, overviewBounds, 1, tmpP, tmpL, tmpUp, {
        fovDeg: camera.fov,
        aspect: Math.max(0.5, camera.aspect || window.innerWidth / Math.max(1, window.innerHeight)),
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
        fromP: camera.position.clone(),
        fromL: controls.target.clone(),
        fromUp: camera.up.clone(),
        toP: tmpP.clone(),
        toL: tmpL.clone(),
        toUp: tmpUp.clone(),
        t: 0,
        dur: 1.25,
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

    if (mode === "aerial" || mode === "top") {
      state.cameraMode = "aerial";
      state.playing = false;
      state.visualMode = "landscape";
      mapAerialPose(b, tmpP, tmpL, tmpUp);
      snapTo(tmpP, tmpL, tmpUp);
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
    const offset = camera.position.clone().sub(controls.target);
    return new THREE.Spherical().setFromVector3(offset);
  }

  function applySpherical(spherical) {
    const offset = new THREE.Vector3().setFromSpherical(spherical);
    camera.position.copy(controls.target).add(offset);
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
    takeManualControl();
    localTransition = null;
    orientTransition = null;
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

  function update(dt) {
    if (zoomTransition) {
      zoomTransition.t += dt;
      const k = easeInOutCubic(Math.min(1, zoomTransition.t / zoomTransition.dur));
      const sph = new THREE.Spherical(
        THREE.MathUtils.lerp(zoomTransition.fromRadius, zoomTransition.toRadius, k),
        zoomTransition.phi,
        zoomTransition.theta,
      );
      applySpherical(sph);
      if (zoomTransition.t >= zoomTransition.dur) zoomTransition = null;
      return;
    }

    if (orientTransition) {
      orientTransition.t += dt;
      const k = easeInOutCubic(Math.min(1, orientTransition.t / orientTransition.dur));
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
      camera.lookAt(controls.target);
      controls.update();
      if (localTransition.t >= localTransition.dur) {
        const release = localTransition.releaseMode || "orbit";
        localTransition = null;
        state.cameraMode = release;
        state.playing = false;
        controls.enabled = true;
        if (release === "orbit") {
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
    controls.update();
  }

  /**
   * Zoom to chainage (River Side framing), then free orbit for the mouse.
   * Drag / pan / scroll anytime cancels the fly and keeps control.
   */
  function focusOnXZ(x, z, opts = {}) {
    if (state.cinematicActive) return;
    state.playing = false;
    state.visualMode = "landscape";
    // Stay in orbit so mouse is the owner; fly is just a soft tween
    state.cameraMode = "orbit";
    controls.enabled = true;

    const u = nearestStationU(stations, x, z);
    const local = st(u);
    alongRiverPose(stations, {
      u,
      height: heightForWidth(local.half, opts.heightMode || "detail"),
      pitchDeg: opts.pitchDeg ?? 48,
      lookAhead: opts.lookAhead ?? 0.04,
      lateralBiasM: opts.lateralBiasM ?? 0,
      outP: tmpP,
      outL: tmpL,
      outUp: tmpUp,
    });
    // Nudge look-at toward the selected marker so the yellow disc reads clearly
    tmpL.x = THREE.MathUtils.lerp(tmpL.x, x, 0.45);
    tmpL.z = THREE.MathUtils.lerp(tmpL.z, z, 0.45);
    tmpL.y = SURFACE_Y + 1.4;

    localTransition = {
      fromP: camera.position.clone(),
      fromL: controls.target.clone(),
      fromUp: camera.up.clone().normalize(),
      toP: tmpP.clone(),
      toL: tmpL.clone(),
      // World-up destination → OrbitControls feel normal after zoom
      toUp: new THREE.Vector3(0, 1, 0),
      t: 0,
      dur: opts.dur ?? 0.9,
      releaseMode: "orbit",
    };
  }

  return {
    camera,
    controls,
    applyMode,
    focusOnXZ,
    update,
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
