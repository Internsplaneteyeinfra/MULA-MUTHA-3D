import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { SURFACE_Y } from "./river.js";
import { state } from "../state.js";

/** Flat markers sit just above water surface. */
const MARKER_Y = SURFACE_Y + 0.55;
const LABEL_BASE_LIFT = 14;
const LINE_Y = SURFACE_Y + 1.15;

/**
 * Chainage styled after the GIS reference:
 * white dashed centerline · yellow majors (white rim) · white minors · white labels.
 */
export function createChainageLayer(dataset) {
  const group = new THREE.Group();
  group.name = "chainageMarkers";
  const points = [...(dataset.chainage || [])].sort(
    (a, b) => (a.meters ?? 0) - (b.meters ?? 0),
  );
  if (!points.length) return { group, update() {}, pick() {}, points: [] };

  const majors = points.filter((p) => p.major || (Number(p.meters) % 1000 === 0));
  const minors = points.filter((p) => !majors.includes(p));

  const rimGeo = makeDiscGeometry(6.4);
  const majorGeo = makeDiscGeometry(5.1);
  const minorGeo = makeDiscGeometry(1.55);
  const rimMat = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const majorMat = new THREE.MeshBasicMaterial({
    color: "#f5c518",
    depthTest: false,
    transparent: true,
    opacity: 1,
  });
  const minorMat = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const selectFillMat = new THREE.MeshBasicMaterial({
    color: "#ffd54a",
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const selectRingMat = new THREE.MeshBasicMaterial({
    color: "#ff8a00",
    depthTest: false,
    transparent: true,
    opacity: 0.72,
  });

  const rimMesh = new THREE.InstancedMesh(rimGeo, rimMat, Math.max(1, majors.length));
  const majorMesh = new THREE.InstancedMesh(majorGeo, majorMat, Math.max(1, majors.length));
  const minorMesh = new THREE.InstancedMesh(minorGeo, minorMat, Math.max(1, minors.length));
  rimMesh.name = "chainageMajorRim";
  majorMesh.name = "chainageMajor";
  minorMesh.name = "chainageMinor";
  for (const m of [rimMesh, majorMesh, minorMesh]) {
    m.frustumCulled = false;
    m.renderOrder = m === minorMesh ? 25 : 26;
  }
  majorMesh.userData.pickable = true;
  minorMesh.userData.pickable = true;
  rimMesh.renderOrder = 25;

  const dummy = new THREE.Object3D();
  const majorIndex = [];
  for (let i = 0; i < majors.length; i++) {
    const p = majors[i];
    majorIndex[i] = p;
    dummy.position.set(p.x, MARKER_Y, p.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    rimMesh.setMatrixAt(i, dummy.matrix);
    majorMesh.setMatrixAt(i, dummy.matrix);
  }
  rimMesh.count = majors.length;
  majorMesh.count = majors.length;
  rimMesh.instanceMatrix.needsUpdate = true;
  majorMesh.instanceMatrix.needsUpdate = true;

  const minorIndex = [];
  for (let i = 0; i < minors.length; i++) {
    const p = minors[i];
    minorIndex[i] = p;
    dummy.position.set(p.x, MARKER_Y + 0.02, p.z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    minorMesh.setMatrixAt(i, dummy.matrix);
  }
  minorMesh.count = minors.length;
  minorMesh.instanceMatrix.needsUpdate = true;

  group.add(rimMesh);
  group.add(majorMesh);
  group.add(minorMesh);

  // White dashed centerline (reference style)
  const resolution = new THREE.Vector2(
    Math.max(1, window.innerWidth),
    Math.max(1, window.innerHeight),
  );
  const positions = [];
  for (const p of points) positions.push(p.x, LINE_Y, p.z);

  const lineGeo = new LineGeometry();
  lineGeo.setPositions(positions);
  const lineMat = new LineMaterial({
    color: 0xffffff,
    linewidth: 1.85,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
    dashed: true,
    dashSize: 10,
    gapSize: 6,
    resolution,
  });
  const chainLine = new Line2(lineGeo, lineMat);
  chainLine.computeLineDistances();
  chainLine.name = "chainageConnector";
  chainLine.renderOrder = 24;
  chainLine.frustumCulled = false;
  group.add(chainLine);

  // Orange highlight for the selected chainage segment
  const selLineGeo = new LineGeometry();
  selLineGeo.setPositions([0, 0, 0, 0, 0, 0]);
  const selLineMat = new LineMaterial({
    color: 0xff8a00,
    linewidth: 2.4,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
    resolution,
  });
  const selLine = new Line2(selLineGeo, selLineMat);
  selLine.name = "chainageSelectedSegment";
  selLine.renderOrder = 25;
  selLine.visible = false;
  selLine.frustumCulled = false;
  group.add(selLine);

  group.userData.setResolution = (w, h) => {
    resolution.set(w, h);
    lineMat.resolution.set(w, h);
    selLineMat.resolution.set(w, h);
  };

  // Selected marker ~40% smaller than previous oversized disc
  const selectFill = new THREE.Mesh(makeDiscGeometry(4.3), selectFillMat);
  selectFill.name = "chainageSelectedFill";
  selectFill.visible = false;
  selectFill.renderOrder = 27;
  selectFill.frustumCulled = false;
  group.add(selectFill);

  const selectRing = new THREE.Mesh(new THREE.RingGeometry(4.4, 5.5, 36), selectRingMat);
  selectRing.name = "chainageSelectedRing";
  selectRing.rotation.x = -Math.PI / 2;
  selectRing.visible = false;
  selectRing.renderOrder = 28;
  selectRing.frustumCulled = false;
  group.add(selectRing);

  const labelGroup = new THREE.Group();
  labelGroup.name = "chainageLabels";
  const labelSprites = [];
  for (const p of points) {
    const isMajor = majors.includes(p);
    const spr = makeChainageLabelSprite(formatChainageText(p, "station"));
    spr.position.set(p.x, SURFACE_Y + LABEL_BASE_LIFT + (isMajor ? 2 : 0), p.z);
    spr.userData.point = p;
    spr.userData.isMajor = isMajor;
    spr.userData.mode = "station";
    spr.userData.baseLift = LABEL_BASE_LIFT + (isMajor ? 2 : 0);
    spr.visible = false;
    labelGroup.add(spr);
    labelSprites.push(spr);
  }
  group.add(labelGroup);

  let lastLabelMode = null;

  function syncSelection() {
    const sel = state.selectedChainageMeters;
    if (sel == null) {
      selectFill.visible = false;
      selectRing.visible = false;
      selLine.visible = false;
      return;
    }
    const idx = points.findIndex((c) => c.meters === sel);
    if (idx < 0) {
      selectFill.visible = false;
      selectRing.visible = false;
      selLine.visible = false;
      return;
    }
    const p = points[idx];
    selectFill.visible = true;
    selectRing.visible = true;
    selectFill.position.set(p.x, MARKER_Y + 0.05, p.z);
    selectRing.position.set(p.x, MARKER_Y + 0.08, p.z);

    // Orange segment spanning neighbors around the selected station
    const a = points[Math.max(0, idx - 1)];
    const b = points[Math.min(points.length - 1, idx + 1)];
    if (a !== b) {
      selLineGeo.setPositions([a.x, LINE_Y + 0.05, a.z, p.x, LINE_Y + 0.05, p.z, b.x, LINE_Y + 0.05, b.z]);
      selLine.computeLineDistances();
      selLine.visible = true;
    } else {
      selLine.visible = false;
    }
  }

  let lastMarkerBoost = -1;

  function applyMarkerBoost(boost) {
    if (Math.abs(boost - lastMarkerBoost) < 0.03) return;
    lastMarkerBoost = boost;
    for (let i = 0; i < majors.length; i++) {
      const p = majors[i];
      dummy.position.set(p.x, MARKER_Y, p.z);
      dummy.scale.set(boost, 1, boost);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      rimMesh.setMatrixAt(i, dummy.matrix);
      majorMesh.setMatrixAt(i, dummy.matrix);
    }
    rimMesh.instanceMatrix.needsUpdate = true;
    majorMesh.instanceMatrix.needsUpdate = true;
    const minorBoost = Math.max(1.05, boost * 0.95);
    for (let i = 0; i < minors.length; i++) {
      const p = minors[i];
      dummy.position.set(p.x, MARKER_Y + 0.02, p.z);
      dummy.scale.set(minorBoost, 1, minorBoost);
      dummy.updateMatrix();
      minorMesh.setMatrixAt(i, dummy.matrix);
    }
    minorMesh.instanceMatrix.needsUpdate = true;
  }

  /** Larger when close (River Side / chainage); modest grow in Overview. */
  function markerBoostForCam(camY) {
    if (camY < 220) return 1.75;
    if (camY < 380) return 1.55;
    if (camY < 600) return 1.35;
    if (camY < 1000) return 1.2;
    return THREE.MathUtils.clamp(0.85 + camY / 1600, 1.25, 1.95);
  }

  function syncLabels(camera) {
    const sel = state.selectedChainageMeters;
    const mode =
      state.chainageLabelMode === "meters"
        ? "meters"
        : state.chainageLabelMode === "both"
          ? "both"
          : "station";
    if (mode !== lastLabelMode) {
      lastLabelMode = mode;
      for (const spr of labelSprites) {
        spr.userData.mode = mode;
        paintChainageLabel(spr, formatChainageText(spr.userData.point, mode));
      }
    }
    labelGroup.visible = true;
    if (!camera) return;

    const camY = camera.position.y;
    const closeView = camY < 650 || state.cameraMode === "local";
    const camLift = THREE.MathUtils.clamp(camY * (closeView ? 0.014 : 0.01), closeView ? 8 : 0, 40);

    // Only the currently selected chainage label is shown in the 3D scene
    for (const spr of labelSprites) {
      const p = spr.userData.point;
      const isSel = sel != null && p.meters === sel;
      spr.visible = isSel;
      if (!isSel) continue;

      spr.position.set(
        p.x,
        SURFACE_Y + spr.userData.baseLift + camLift + 6,
        p.z - (closeView ? 4 : 8),
      );
      const d = camera.position.distanceTo(spr.position);
      let s;
      if (closeView) {
        s = THREE.MathUtils.clamp(d * 0.034, 14, 40);
      } else {
        const boost = markerBoostForCam(camY);
        s = THREE.MathUtils.clamp(d * 0.014 * boost, 8, 30);
      }
      const twoLine = mode === "both" ? 1.65 : 0.9;
      spr.scale.set(s * (closeView ? 3.0 : 2.7), s * twoLine, 1);
    }
  }

  function update(camera) {
    const show = state.showChainage !== false;
    group.visible = show;
    if (!show || !camera) return;
    const camY = camera.position.y;
    const inspecting = state.selectedChainageMeters != null;
    const showMinors = camY < 2200 || inspecting;
    minorMesh.visible = showMinors;
    rimMesh.visible = true;
    majorMesh.visible = true;
    chainLine.visible = true;
    const boost = markerBoostForCam(camY);
    applyMarkerBoost(boost);
    lineMat.linewidth = camY < 500 ? 2.4 : camY > 900 ? 2.2 : 1.95;
    syncSelection();
    syncLabels(camera);

    if (selectFill.visible) {
      const d = camera.position.distanceTo(selectFill.position);
      // ~40% smaller screen-space scale than previous selection marker
      const s = THREE.MathUtils.clamp(d * 0.0019, 0.7, 7.2) * Math.max(1.0, boost * 0.85);
      selectFill.scale.setScalar(s);
      selectRing.scale.setScalar(s);
    }
  }

  function pick(raycaster, camera, maxDistM = 90) {
    if (!group.visible) return null;
    const hits = raycaster.intersectObjects([majorMesh, minorMesh], false);
    if (hits.length) {
      const h = hits[0];
      const list = h.object === majorMesh ? majorIndex : minorIndex;
      const p = list[h.instanceId];
      if (p) {
        state.selectedChainageMeters = p.meters;
        syncSelection();
        return p;
      }
    }
    if (camera) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURFACE_Y);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, hit)) {
        const near = nearestChainage(hit.x, hit.z, points);
        if (near && near.dist <= maxDistM) {
          state.selectedChainageMeters = near.meters;
          syncSelection();
          return near;
        }
      }
    }
    return null;
  }

  // No auto-select on load — panel / tip only after the user clicks a chainage
  syncSelection();

  console.info("Chainage markers", {
    total: points.length,
    major: majors.length,
    minor: minors.length,
    style: "white dashed · yellow majors · white minors",
  });
  return { group, update, pick, points };
}

function makeDiscGeometry(radius) {
  const geo = new THREE.CircleGeometry(radius, 28);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function formatChainageText(p, mode) {
  const m = Number(p.meters);
  const metersTxt = Number.isFinite(m) ? `${Math.round(m)} m` : "—";
  const station = p.label || metersToStation(p.meters);
  if (mode === "meters") return metersTxt;
  if (mode === "both") return `${station}  ·  ${metersTxt}`;
  return station;
}

export function metersToStation(meters) {
  const m = Math.max(0, Math.round(Number(meters) || 0));
  const km = Math.floor(m / 1000);
  const rem = m % 1000;
  return `${km}+${String(rem).padStart(3, "0")}`;
}

function makeChainageLabelSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 80;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const spr = new THREE.Sprite(mat);
  spr.userData.canvas = canvas;
  spr.renderOrder = 29;
  spr.frustumCulled = false;
  spr.scale.set(18, 5, 1);
  paintChainageLabel(spr, text);
  return spr;
}

function paintChainageLabel(spr, text) {
  const canvas = spr.userData.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const label = String(text || "—");
  ctx.font = "800 34px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.78)";
  ctx.strokeText(label, w / 2, h / 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, w / 2, h / 2);
  if (spr.material.map) spr.material.map.needsUpdate = true;
}

/** Nearest chainage label to a local XZ point. */
export function nearestChainage(x, z, chainage) {
  if (!chainage?.length) return null;
  let best = chainage[0];
  let bestD = Infinity;
  for (const c of chainage) {
    const d2 = (c.x - x) ** 2 + (c.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = c;
    }
  }
  return { ...best, dist: Math.sqrt(bestD) };
}
