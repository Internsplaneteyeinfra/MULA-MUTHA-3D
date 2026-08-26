import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SURFACE_Y } from "./river.js";
import { state } from "../state.js";

/** Pin tip sits on water; head stands above so chainage is obvious. */
const PIN_BASE_Y = SURFACE_Y + 0.15;
const LABEL_BASE_LIFT = 22;
const LINE_Y = SURFACE_Y + 3.5;

/**
 * Chainage markers: red map-style pins + red connector line.
 * Click a pin to highlight; Layers toolkit shows station/meters above water.
 */
export function createChainageLayer(dataset) {
  const group = new THREE.Group();
  group.name = "chainageMarkers";
  const points = [...(dataset.chainage || [])].sort(
    (a, b) => (a.meters ?? 0) - (b.meters ?? 0),
  );
  if (!points.length) return { group, update() {}, pick() {}, points: [] };

  const majors = points.filter((p) => p.major);
  const minors = points.filter((p) => !p.major);

  const majorGeo = makePinGeometry(1);
  const minorGeo = makePinGeometry(0.72);
  const majorMat = new THREE.MeshStandardMaterial({
    color: "#e02020",
    roughness: 0.45,
    metalness: 0.15,
    emissive: "#5a0808",
    emissiveIntensity: 0.35,
  });
  const minorMat = new THREE.MeshStandardMaterial({
    color: "#d01818",
    roughness: 0.5,
    metalness: 0.12,
    emissive: "#4a0606",
    emissiveIntensity: 0.28,
  });
  const selectMat = new THREE.MeshBasicMaterial({
    color: "#ff4444",
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });

  const majorMesh = new THREE.InstancedMesh(majorGeo, majorMat, Math.max(1, majors.length));
  const minorMesh = new THREE.InstancedMesh(minorGeo, minorMat, Math.max(1, minors.length));
  majorMesh.name = "chainageMajor";
  minorMesh.name = "chainageMinor";
  majorMesh.frustumCulled = false;
  minorMesh.frustumCulled = false;
  majorMesh.renderOrder = 9;
  minorMesh.renderOrder = 8;
  majorMesh.castShadow = true;
  minorMesh.castShadow = true;
  majorMesh.userData.pickable = true;
  minorMesh.userData.pickable = true;

  const dummy = new THREE.Object3D();
  const majorIndex = [];
  for (let i = 0; i < majors.length; i++) {
    const p = majors[i];
    majorIndex[i] = p;
    dummy.position.set(p.x, PIN_BASE_Y, p.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    majorMesh.setMatrixAt(i, dummy.matrix);
  }
  majorMesh.count = majors.length;
  majorMesh.instanceMatrix.needsUpdate = true;

  const minorIndex = [];
  for (let i = 0; i < minors.length; i++) {
    const p = minors[i];
    minorIndex[i] = p;
    dummy.position.set(p.x, PIN_BASE_Y, p.z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    minorMesh.setMatrixAt(i, dummy.matrix);
  }
  minorMesh.count = minors.length;
  minorMesh.instanceMatrix.needsUpdate = true;

  group.add(majorMesh);
  group.add(minorMesh);

  // Red path linking every chainage pin in order
  const linePts = points.map((p) => new THREE.Vector3(p.x, LINE_Y, p.z));
  const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xe02020,
    linewidth: 2,
    transparent: true,
    opacity: 0.95,
    depthTest: true,
  });
  const chainLine = new THREE.Line(lineGeo, lineMat);
  chainLine.name = "chainageConnector";
  chainLine.renderOrder = 6;
  chainLine.frustumCulled = false;
  group.add(chainLine);

  // Selection ring around clicked pin
  const selectMesh = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.55, 8, 24), selectMat);
  selectMesh.name = "chainageSelected";
  selectMesh.rotation.x = Math.PI / 2;
  selectMesh.visible = false;
  selectMesh.renderOrder = 14;
  selectMesh.frustumCulled = false;
  group.add(selectMesh);

  // Labels lifted well above water (not submerged)
  const labelGroup = new THREE.Group();
  labelGroup.name = "chainageLabels";
  const labelSprites = [];
  for (const p of points) {
    const spr = makeChainageLabelSprite(formatChainageText(p, "station"));
    spr.position.set(p.x, SURFACE_Y + LABEL_BASE_LIFT + (p.major ? 4 : 2), p.z);
    spr.userData.point = p;
    spr.userData.mode = "station";
    spr.userData.baseLift = LABEL_BASE_LIFT + (p.major ? 4 : 2);
    spr.visible = false;
    labelGroup.add(spr);
    labelSprites.push(spr);
  }
  group.add(labelGroup);

  let lastLabelMode = null;
  let lastShowLabels = null;

  function syncSelection() {
    const sel = state.selectedChainageMeters;
    if (sel == null) {
      selectMesh.visible = false;
      return;
    }
    const p = points.find((c) => c.meters === sel);
    if (!p) {
      selectMesh.visible = false;
      return;
    }
    selectMesh.visible = true;
    selectMesh.position.set(p.x, SURFACE_Y + 12, p.z);
  }

  function syncLabels(camera) {
    const show = !!state.showChainageLabels;
    const mode = state.chainageLabelMode === "meters" ? "meters" : "station";
    if (show !== lastShowLabels || mode !== lastLabelMode) {
      lastShowLabels = show;
      lastLabelMode = mode;
      for (const spr of labelSprites) {
        if (spr.userData.mode !== mode) {
          spr.userData.mode = mode;
          paintChainageLabel(spr, formatChainageText(spr.userData.point, mode));
        }
      }
    }
    labelGroup.visible = show;
    if (!show || !camera) return;
    const camLift = THREE.MathUtils.clamp(camera.position.y * 0.012, 0, 40);
    for (const spr of labelSprites) {
      const p = spr.userData.point;
      const y = SURFACE_Y + spr.userData.baseLift + camLift;
      spr.position.set(p.x, y, p.z);
      const d = camera.position.distanceTo(spr.position);
      const s = THREE.MathUtils.clamp(d * 0.014, 8, 36);
      spr.scale.set(s * 2.8, s, 1);
      spr.visible = true;
    }
  }

  function update(camera) {
    const show = state.showChainage !== false;
    group.visible = show;
    if (!show || !camera) return;
    const camY = camera.position.y;
    // Keep minor pins visible when labels on or when reasonably close
    minorMesh.visible = camY < 1400 || !!state.showChainageLabels;
    chainLine.visible = true;
    syncSelection();
    syncLabels(camera);

    if (selectMesh.visible) {
      const d = camera.position.distanceTo(selectMesh.position);
      const s = THREE.MathUtils.clamp(d * 0.0035, 1, 12);
      selectMesh.scale.setScalar(s);
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

  console.info("Chainage markers", {
    total: points.length,
    major: majors.length,
    minor: minors.length,
    style: "red pins + red connector",
  });
  return { group, update, pick, points };
}

/** Classic map pin: tip on water, stem up, round head. */
function makePinGeometry(scale = 1) {
  const tip = new THREE.ConeGeometry(0.85 * scale, 2.4 * scale, 10);
  tip.rotateX(Math.PI);
  tip.translate(0, 1.2 * scale, 0);

  const stem = new THREE.CylinderGeometry(0.28 * scale, 0.38 * scale, 9 * scale, 8);
  stem.translate(0, (2.4 + 4.5) * scale, 0);

  const head = new THREE.SphereGeometry(1.65 * scale, 14, 12);
  head.translate(0, (2.4 + 9 + 1.2) * scale, 0);

  const merged = mergeGeometries([tip, stem, head], false);
  tip.dispose();
  stem.dispose();
  head.dispose();
  if (!merged) {
    const fallback = new THREE.SphereGeometry(2 * scale, 10, 8);
    fallback.translate(0, 8 * scale, 0);
    return fallback;
  }
  merged.computeVertexNormals();
  return merged;
}

function formatChainageText(p, mode) {
  if (mode === "meters") {
    const m = Number(p.meters);
    if (!Number.isFinite(m)) return "—";
    return `${Math.round(m)} m`;
  }
  return p.label || metersToStation(p.meters);
}

function metersToStation(meters) {
  const m = Math.max(0, Math.round(Number(meters) || 0));
  const km = Math.floor(m / 1000);
  const rem = m % 1000;
  return `${km}+${String(rem).padStart(3, "0")}`;
}

function makeChainageLabelSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
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
  spr.renderOrder = 20;
  spr.frustumCulled = false;
  spr.scale.set(18, 4.5, 1);
  paintChainageLabel(spr, text);
  return spr;
}

function paintChainageLabel(spr, text) {
  const canvas = spr.userData.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "rgba(8, 10, 14, 0.92)";
  ctx.fillRect(8, 8, 240, 48);
  ctx.strokeStyle = "rgba(224, 40, 40, 1)";
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, 240, 48);
  ctx.fillStyle = "#ffe8e8";
  ctx.font = "700 28px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(text || "—"), 128, 34);
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
