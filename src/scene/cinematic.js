import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { state } from "../state.js";
import { SURFACE_Y } from "./river.js";
import { computeSceneBounds, computeKmlOverviewBounds } from "../geo/sceneBounds.js";
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
  const overviewBounds = dataset.kmlOverviewBounds || computeKmlOverviewBounds(dataset);
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

  function st(u) {
    return stationAt(stations, u);
  }

  function takeManualControl() {
    if (state.cameraMode === "follow") {
      state.playing = false;
      state.cameraMode = "orbit";
      state.visualMode = "landscape";
    }
  }

  controls.addEventListener("start", takeManualControl);
  canvas.addEventListener(
    "wheel",
    () => {
      if (state.cameraMode === "follow") takeManualControl();
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
      state.showTerrain = true;
      state.showUrban = true;
      state.showOsmBuildings = true;
      state.showOsmRoads = true;
      state.showVegetation = true;
      state.showOsmTrees = true;
      state.showBridges = true;
      state.showBridgeNames = false;
      state.showFish = true;
      state.showFishDebug = true;
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
      state.flowVisibility = 1;
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
      snapTo(tmpP, tmpL, tmpUp);
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

  function update(dt) {
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

  return { camera, controls, applyMode, update, stationAt: st };
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
