/**
 * Two-point distance measure — temporary markers + line on the existing local CRS.
 * Distance via metersDistance (EPSG:32643 local metres). No camera side-effects.
 */
import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { metersDistance, localToLonLat } from "../geo/geoReference.js";
import { state } from "../state.js";

/**
 * @param {{ corridor?: { stations?: object[] } }} dataset
 */
export function createDistanceMeasure(dataset) {
  const group = new THREE.Group();
  group.name = "distanceMeasure";
  group.visible = false;
  group.renderOrder = 40;

  const markerMat = new THREE.MeshBasicMaterial({
    color: 0x5bc8e8,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });
  const markerBMat = markerMat.clone();
  markerBMat.color.setHex(0xe8a13d);

  const markerA = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12), markerMat);
  const markerB = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12), markerBMat);
  markerA.visible = false;
  markerB.visible = false;
  markerA.renderOrder = 41;
  markerB.renderOrder = 41;
  markerA.frustumCulled = false;
  markerB.frustumCulled = false;
  group.add(markerA, markerB);

  const lineMat = new THREE.LineBasicMaterial({
    color: 0xb9f5ff,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  });
  const lineGeom = new THREE.BufferGeometry();
  const line = new THREE.Line(lineGeom, lineMat);
  line.visible = false;
  line.frustumCulled = false;
  line.renderOrder = 40;
  group.add(line);

  const label = makeDistanceLabel();
  label.visible = false;
  group.add(label);

  const letterA = makeLetterSprite("A", "#5bc8e8");
  const letterB = makeLetterSprite("B", "#e8a13d");
  letterA.visible = false;
  letterB.visible = false;
  group.add(letterA, letterB);

  const cursorMat = new THREE.MeshBasicMaterial({
    color: 0xffd54a,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });
  const cursor = new THREE.Mesh(new THREE.SphereGeometry(1.4, 14, 12), cursorMat);
  cursor.visible = false;
  cursor.renderOrder = 43;
  cursor.frustumCulled = false;
  group.add(cursor);

  const cursorDepthLabel = makeDistanceLabel();
  cursorDepthLabel.visible = false;
  group.add(cursorDepthLabel);

  /** @type {null | { x:number, y:number, z:number, lon?:number, lat?:number }} */
  let pointA = null;
  /** @type {null | { x:number, y:number, z:number, lon?:number, lat?:number }} */
  let pointB = null;
  let distanceM = null;
  let active = false;

  function elevY(x, z) {
    const stations = dataset?.corridor?.stations || [];
    const ty = stations.length ? terrainHeightAt(x, z, stations) : SURFACE_Y;
    return Math.max(ty, SURFACE_Y) + 1.2;
  }

  function lonLatOf(x, z) {
    try {
      return localToLonLat(x, z);
    } catch {
      return null;
    }
  }

  function setActive(on) {
    active = !!on;
    state.distanceMeasureActive = active;
    group.visible = active;
    if (!active) clearPoints();
    document.dispatchEvent(
      new CustomEvent("distance-measure-change", {
        detail: snapshot(),
      }),
    );
  }

  function clearPoints() {
    pointA = null;
    pointB = null;
    distanceM = null;
    markerA.visible = false;
    markerB.visible = false;
    letterA.visible = false;
    letterB.visible = false;
    line.visible = false;
    label.visible = false;
    cursor.visible = false;
    cursorDepthLabel.visible = false;
    document.dispatchEvent(
      new CustomEvent("distance-measure-change", {
        detail: snapshot(),
      }),
    );
  }

  function snapshot() {
    return {
      active,
      phase: !pointA ? "a" : !pointB ? "b" : "done",
      pointA,
      pointB,
      distanceM,
      distanceText: formatDistance(distanceM),
    };
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} [y]
   */
  function addPoint(x, z, y) {
    if (!active) return snapshot();
    const yy = Number.isFinite(y) ? y : elevY(x, z);
    const ll = lonLatOf(x, z);
    const pt = {
      x,
      y: yy,
      z,
      lon: ll?.lon,
      lat: ll?.lat,
    };

    if (!pointA || (pointA && pointB)) {
      // Fresh pair (or first point)
      pointA = pt;
      pointB = null;
      distanceM = null;
      markerA.position.set(pt.x, pt.y, pt.z);
      markerA.visible = true;
      letterA.position.set(pt.x, pt.y + 3.2, pt.z);
      letterA.visible = true;
      markerB.visible = false;
      letterB.visible = false;
      line.visible = false;
      label.visible = false;
      cursor.visible = false;
      cursorDepthLabel.visible = false;
    } else {
      pointB = pt;
      markerB.position.set(pt.x, pt.y, pt.z);
      markerB.visible = true;
      letterB.position.set(pt.x, pt.y + 3.2, pt.z);
      letterB.visible = true;
      distanceM = metersDistance(pointA, pointB);
      lineGeom.setFromPoints([
        new THREE.Vector3(pointA.x, pointA.y, pointA.z),
        new THREE.Vector3(pointB.x, pointB.y, pointB.z),
      ]);
      lineGeom.computeBoundingSphere();
      line.visible = true;
      paintDistanceLabel(label, formatDistance(distanceM));
      label.position.set(
        (pointA.x + pointB.x) * 0.5,
        Math.max(pointA.y, pointB.y) + 4,
        (pointA.z + pointB.z) * 0.5,
      );
      label.visible = true;
    }

    const snap = snapshot();
    document.dispatchEvent(new CustomEvent("distance-measure-change", { detail: snap }));
    return snap;
  }

  function update(camera) {
    if (!group.visible || !camera) return;
    if (label.visible && pointA && pointB) {
      const mid = label.position;
      const d = camera.position.distanceTo(mid);
      const s = THREE.MathUtils.clamp(d * 0.022, 10, 28);
      label.scale.set(s * 1.6, s * 0.45, 1);
    }
    for (const spr of [letterA, letterB]) {
      if (!spr.visible) continue;
      const d = camera.position.distanceTo(spr.position);
      const s = THREE.MathUtils.clamp(d * 0.014, 5, 14);
      spr.scale.set(s, s, 1);
    }
    if (cursorDepthLabel.visible) {
      const d = camera.position.distanceTo(cursorDepthLabel.position);
      const s = THREE.MathUtils.clamp(d * 0.018, 8, 20);
      cursorDepthLabel.scale.set(s * 1.5, s * 0.42, 1);
    }
  }

  /**
   * Graph ↔ 3D sync cursor along A→B.
   * @param {null | { x:number, y?:number, z:number, depth_m?:number|null }} sample
   */
  function setProfileCursor(sample) {
    if (!sample || !Number.isFinite(sample.x) || !Number.isFinite(sample.z)) {
      cursor.visible = false;
      cursorDepthLabel.visible = false;
      return;
    }
    const y = Number.isFinite(sample.y) ? sample.y : elevY(sample.x, sample.z);
    cursor.position.set(sample.x, y + 0.4, sample.z);
    cursor.visible = true;
    if (Number.isFinite(sample.depth_m)) {
      paintDistanceLabel(cursorDepthLabel, `Depth ${Number(sample.depth_m).toFixed(2)} m`);
      cursorDepthLabel.position.set(sample.x, y + 5.5, sample.z);
      cursorDepthLabel.visible = true;
    } else {
      cursorDepthLabel.visible = false;
    }
  }

  function dispose() {
    clearPoints();
    active = false;
    state.distanceMeasureActive = false;
    markerA.geometry?.dispose?.();
    markerB.geometry?.dispose?.();
    cursor.geometry?.dispose?.();
    markerMat.dispose();
    markerBMat.dispose();
    cursorMat.dispose();
    lineGeom.dispose();
    lineMat.dispose();
    for (const spr of [label, letterA, letterB, cursorDepthLabel]) {
      spr.material?.map?.dispose?.();
      spr.material?.dispose?.();
    }
  }

  return {
    group,
    setActive,
    clearPoints,
    addPoint,
    update,
    setProfileCursor,
    dispose,
    isActive: () => active,
    getSnapshot: snapshot,
  };
}

export function formatDistance(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} km`;
  return `${n.toFixed(1)} m`;
}

function makeDistanceLabel() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
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
  spr.renderOrder = 42;
  spr.frustumCulled = false;
  return spr;
}

function paintDistanceLabel(spr, text) {
  const canvas = spr.userData.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 52px Inter, system-ui, sans-serif";
  ctx.lineJoin = "round";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(String(text || "—"), w / 2, h / 2);
  ctx.fillStyle = "#eaf8fb";
  ctx.fillText(String(text || "—"), w / 2, h / 2);
  if (spr.material.map) spr.material.map.needsUpdate = true;
}

function makeLetterSprite(letter, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8, 20, 28, 0.88)";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 64px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const spr = new THREE.Sprite(mat);
  spr.renderOrder = 44;
  spr.frustumCulled = false;
  spr.scale.set(8, 8, 1);
  return spr;
}
