import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { nearestStation } from "../features/fishing/FishingZoneSystem.js";
import { terrainHeightAt } from "./terrain.js";
import { state } from "../state.js";

/**
 * Click-to-measure: visible white dotted bank↔bank line +
 * left depth (small "depth" + big meters) and one width strip:
 * <----- 63.7m ----(157.7m)---- 93.9m ---->
 */
export function createRiverWidthMeasure(dataset) {
  const group = new THREE.Group();
  group.name = "riverWidthMeasure";
  group.visible = false;
  group.renderOrder = 28;

  const lineMat = new THREE.LineDashedMaterial({
    color: 0xffffff,
    dashSize: 6,
    gapSize: 4,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    linewidth: 2,
  });
  const lineGeom = new THREE.BufferGeometry();
  const crossLine = new THREE.Line(lineGeom, lineMat);
  crossLine.frustumCulled = false;
  crossLine.renderOrder = 28;
  group.add(crossLine);

  // Second parallel dashed line for visibility.
  const lineMat2 = lineMat.clone();
  const lineGeom2 = new THREE.BufferGeometry();
  const crossLine2 = new THREE.Line(lineGeom2, lineMat2);
  crossLine2.frustumCulled = false;
  crossLine2.renderOrder = 28;
  group.add(crossLine2);

  const tickMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
  });
  const leftTick = makeTick(tickMat);
  const rightTick = makeTick(tickMat);
  const centerTick = makeTick(tickMat);
  const leftArrow = makeTick(tickMat);
  const rightArrow = makeTick(tickMat);
  group.add(leftTick, rightTick, centerTick, leftArrow, rightArrow);

  const depthLabel = makeDepthLabel();
  const widthLabel = makeWidthLabel();
  group.add(depthLabel, widthLabel);

  let hideTimer = 0;
  let lastHit = null;
  const HOLD_MS = 15000;

  function elevY(x, z, lift = 2.2) {
    const stations = dataset.corridor?.stations || [];
    return Math.max(terrainHeightAt(x, z, stations), SURFACE_Y) + lift;
  }

  function setDashed(geom, line, pts) {
    geom.setFromPoints(pts);
    geom.computeBoundingSphere();
    line.computeLineDistances();
  }

  /** Dense dashed bank-to-bank line so gaps read clearly on wide channels. */
  function setCrossLine(lx, ly, lz, rx, ry, rz, bankLen) {
    const segs = Math.max(64, Math.round(bankLen / 2.5));
    const pts = [];
    const pts2 = [];
    // Slight offset perpendicular so the double-dash reads thicker.
    const dx = rx - lx;
    const dz = rz - lz;
    const len = Math.hypot(dx, dz) || 1;
    const ox = (-dz / len) * 0.55;
    const oz = (dx / len) * 0.55;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const x = lx + dx * u;
      const y = ly + (ry - ly) * u;
      const z = lz + dz * u;
      pts.push(new THREE.Vector3(x, y, z));
      pts2.push(new THREE.Vector3(x + ox, y + 0.15, z + oz));
    }
    // Scale dash to channel width so it stays readable.
    const dash = THREE.MathUtils.clamp(bankLen * 0.035, 4, 10);
    const gap = dash * 0.7;
    lineMat.dashSize = dash;
    lineMat.gapSize = gap;
    lineMat2.dashSize = dash;
    lineMat2.gapSize = gap;
    setDashed(lineGeom, crossLine, pts);
    setDashed(lineGeom2, crossLine2, pts2);
  }

  function setTick(mesh, x, z, half = 3.2) {
    const y = elevY(x, z);
    mesh.geometry.setFromPoints([
      new THREE.Vector3(x, y - half, z),
      new THREE.Vector3(x, y + half, z),
    ]);
  }

  /** Small horizontal end-cap / arrow tick at bank. */
  function setEndArrow(mesh, x, z, ux, uz, towardCenter) {
    const y = elevY(x, z);
    const dir = towardCenter ? 1 : -1;
    const ax = x + ux * 4.5 * dir;
    const az = z + uz * 4.5 * dir;
    const px = -uz * 2.8;
    const pz = ux * 2.8;
    mesh.geometry.setFromPoints([
      new THREE.Vector3(x + px, y, z + pz),
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(x - px, y, z - pz),
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(ax, y, az),
    ]);
  }

  /**
   * @param {{ x: number, z: number, depth: number }} hit
   */
  function showAt(hit) {
    const stations = dataset.corridor?.stations;
    if (!stations?.length) {
      hide();
      return null;
    }

    const st = nearestStation(hit.x, hit.z, stations);
    if (!st) {
      hide();
      return null;
    }

    const lx = Number.isFinite(st.leftX) ? st.leftX : st.x;
    const lz = Number.isFinite(st.leftZ) ? st.leftZ : st.z;
    const rx = Number.isFinite(st.rightX) ? st.rightX : st.x;
    const rz = Number.isFinite(st.rightZ) ? st.rightZ : st.z;

    const dx = rx - lx;
    const dz = rz - lz;
    const bankLen = Math.hypot(dx, dz) || Math.max(16, st.width || 16);
    const ux = dx / bankLen;
    const uz = dz / bankLen;

    let t = (hit.x - lx) * ux + (hit.z - lz) * uz;
    t = Math.max(0, Math.min(bankLen, t));
    const px = lx + ux * t;
    const pz = lz + uz * t;

    const leftM = t;
    const rightM = bankLen - t;
    const depth = Number.isFinite(hit.depth) ? hit.depth : 0;

    const yL = elevY(lx, lz, 2.4);
    const yR = elevY(rx, rz, 2.4);
    const yP = elevY(px, pz, 2.4);
    setCrossLine(lx, yL, lz, rx, yR, rz, bankLen);
    setTick(leftTick, lx, lz, 4.5);
    setTick(rightTick, rx, rz, 4.5);
    setTick(centerTick, px, pz, 6);
    setEndArrow(leftArrow, lx, lz, ux, uz, true);
    setEndArrow(rightArrow, rx, rz, ux, uz, false);

    paintDepthLabel(depthLabel, depth);
    paintWidthLabel(
      widthLabel,
      `<----- ${leftM.toFixed(1)}m ----(${bankLen.toFixed(1)}m)---- ${rightM.toFixed(1)}m ---->`,
    );

    lastHit = {
      px,
      pz,
      yP,
      lx,
      lz,
      rx,
      rz,
      ux,
      uz,
      t,
      bankLen,
      leftM,
      rightM,
      depth,
      widthM: bankLen,
      station: st,
    };

    layoutLabels();

    group.visible = true;
    state.riverMeasureActive = true;
    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      hide();
    }, HOLD_MS);

    return lastHit;
  }

  function layoutLabels(camera) {
    if (!lastHit || !group.visible) return;
    const { px, pz, yP, ux, uz, bankLen } = lastHit;

    let lift = 5;
    let s = 7;
    if (camera) {
      const d = camera.position.distanceTo(new THREE.Vector3(px, yP, pz));
      // Compact screen size — readable, not scene-filling.
      s = THREE.MathUtils.clamp(d * 0.01, 4.5, 9);
      lift = THREE.MathUtils.clamp(d * 0.006, 3, 9);
    }

    const leftBias = Math.min(bankLen * 0.18, 20);
    const depthX = px - ux * leftBias;
    const depthZ = pz - uz * leftBias;
    const nx = -uz;
    const nz = ux;
    depthLabel.position.set(
      depthX + nx * 4,
      elevY(depthX, depthZ) + lift + 2.5,
      depthZ + nz * 4,
    );
    widthLabel.position.set(px, yP + lift + 0.8, pz);

    depthLabel.scale.set(s * 1.15, s * 0.78, 1);
    const wScale = THREE.MathUtils.clamp(bankLen * 0.05, s * 1.8, s * 2.6);
    widthLabel.scale.set(wScale, s * 0.36, 1);
  }

  function update(camera) {
    if (!group.visible) return;
    layoutLabels(camera);
  }

  function hide() {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = 0;
    }
    group.visible = false;
    lastHit = null;
    state.riverMeasureActive = false;
  }

  return { group, showAt, hide, update, isActive: () => group.visible };
}

function makeTick(mat) {
  const line = new THREE.Line(new THREE.BufferGeometry(), mat);
  line.frustumCulled = false;
  line.renderOrder = 29;
  return line;
}

function makeDepthLabel() {
  const canvas = document.createElement("canvas");
  canvas.width = 420;
  canvas.height = 220;
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
  spr.renderOrder = 30;
  spr.frustumCulled = false;
  return spr;
}

function makeWidthLabel() {
  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = 120;
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
  spr.renderOrder = 30;
  spr.frustumCulled = false;
  return spr;
}

function strokeFill(ctx, text, x, y, strokeW) {
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = strokeW;
  ctx.strokeStyle = "#000000";
  ctx.strokeText(text, x, y);
  ctx.lineWidth = Math.max(2, strokeW * 0.45);
  ctx.strokeStyle = "rgba(0,0,0,0.92)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y);
}

/** Small "depth" (≈12px look) + large value matching chainage style. */
function paintDepthLabel(spr, depthM) {
  const canvas = spr.userData.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Small caption (~12 look).
  ctx.font = "600 20px Inter, system-ui, sans-serif";
  strokeFill(ctx, "depth", w / 2, h * 0.28, 5);

  // Compact value — still outlined white.
  const value = `${Number(depthM).toFixed(2)} m`;
  ctx.font = "700 42px Inter, system-ui, sans-serif";
  strokeFill(ctx, value, w / 2, h * 0.66, 9);

  if (spr.material.map) spr.material.map.needsUpdate = true;
}

function paintWidthLabel(spr, text) {
  const canvas = spr.userData.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 32px Inter, system-ui, sans-serif";
  strokeFill(ctx, String(text || "—"), w / 2, h / 2, 8);
  if (spr.material.map) spr.material.map.needsUpdate = true;
}
