import * as THREE from "three";
import { SURFACE_Y, bedElevation } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { state } from "../state.js";
import { pointInRing } from "../features/fishing/FishingZoneSystem.js";
import { addYerwadaArchSpan, isYerwadaArchBridge } from "./yerwadaArchBridge.js";
import { addAmbedkarArchSpan, isAmbedkarArchBridge } from "./ambedkarArchBridge.js";
import { addSangamGirderSpan, addOpenGirderSpan, girderTheme, isSangamGirderBridge } from "./sangamGirderBridge.js";
import { addMundhwaArchSpan, isMundhwaArchBridge } from "./mundhwaArchBridge.js";

/**
 * Full-span road bridges across the river channel.
 * Uses OSM bridge footprints when present; also promotes OSM road
 * segments that cross the water into elevated decks (fixes flat black lines).
 */
export function createBridges(dataset) {
  const group = new THREE.Group();
  group.name = "bridges";
  group.userData.piers = [];
  group.userData.labels = [];
  group.renderOrder = 12;
  const stations = dataset.corridor.stations;
  const ring = dataset.ringLocal || [];

  const deckMat = mat({ color: "#9a9084", roughness: 0.78, metalness: 0.06, emissive: "#2a2418", emissiveIntensity: 0.1 });
  const asphaltMat = mat({ color: "#3a3e44", roughness: 0.92, metalness: 0.02 });
  const railMat = mat({ color: "#d8d0c0", roughness: 0.55, metalness: 0.1 });
  const pierMat = mat({ color: "#8a8074", roughness: 0.88 });
  const capMat = mat({ color: "#c4bcb0", roughness: 0.78 });
  const abutMat = mat({ color: "#a89e8e", roughness: 0.86 });
  const stripeMat = mat({ color: "#f0e8c8", roughness: 0.6, metalness: 0.04 });
  const xAxis = new THREE.Vector3(1, 0, 0);
  const dir = new THREE.Vector3();
  const minD = dataset.minDepth;
  const maxD = dataset.maxDepth;
  const dMid = (minD + maxD) * 0.5;

  const spans = collectBridgeSpans(dataset, ring, stations);
  dataset.bridgeSpans = spans;
  for (const g of spans) {
    const orig = (dataset.bridges || []).find((b) => String(b.id) === String(g.id));
    if (!orig) continue;
    orig.start = g.start;
    orig.end = g.end;
    orig.midX = g.midX;
    orig.midZ = g.midZ;
    orig.axisX = g.axisX;
    orig.axisZ = g.axisZ;
    orig.lengthM = g.lengthM;
    orig.toe0 = g.toe0;
    orig.toe1 = g.toe1;
  }
  console.info("Bridge spans", { count: spans.length, names: spans.map((s) => s.name) });

  for (const g of spans) {
    const bridge = new THREE.Group();
    bridge.name = g.name;
    bridge.renderOrder = 12;

    const st = nearestStation((g.start.x + g.end.x) * 0.5, (g.start.z + g.end.z) * 0.5, stations);
    const leftW = st.wetHalfLeft ?? st.halfWidth ?? 40;
    const rightW = st.wetHalfRight ?? st.halfWidth ?? 40;
    const ax = g.axisX;
    const az = g.axisZ;
    const y0 = terrainHeightAt(g.start.x, g.start.z, stations);
    const y1 = terrainHeightAt(g.end.x, g.end.z, stations);
    const deckY = Math.max(SURFACE_Y + 8.5, y0 + 1.6, y1 + 1.6);
    const span = Math.max(36, g.lengthM);
    const thick = Math.max(10, Math.min(16, g.widthM || 12));

    dir.set(g.axisX, 0, g.axisZ).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(xAxis, dir);
    const perpX = -g.axisZ;
    const perpZ = g.axisX;
    const mx = (g.start.x + g.end.x) * 0.5;
    const mz = (g.start.z + g.end.z) * 0.5;
    const yerwada = isYerwadaArchBridge(g.name);
    const ambedkar = isAmbedkarArchBridge(g.name);
    const sangam = isSangamGirderBridge(g.name);
    const mundhwa = isMundhwaArchBridge(g.name);
    const customDeck = true;

    if (yerwada) {
      addYerwadaArchSpan(bridge, group, {
        span,
        thick: Math.max(thick, 13),
        deckY,
        mx,
        mz,
        quat,
        start: g.start,
        end: g.end,
        minD,
        maxD,
        dMid,
      });
    } else if (ambedkar) {
      addAmbedkarArchSpan(bridge, group, {
        span,
        thick: Math.max(thick, 16),
        deckY,
        mx,
        mz,
        quat,
        start: g.start,
        end: g.end,
        minD,
        maxD,
        dMid,
      });
    } else if (sangam) {
      addSangamGirderSpan(bridge, group, {
        name: g.name,
        span,
        thick: Math.max(thick, 12),
        deckY,
        mx,
        mz,
        quat,
        start: g.start,
        end: g.end,
        minD,
        maxD,
        dMid,
      });
    } else if (mundhwa) {
      addMundhwaArchSpan(bridge, group, {
        span,
        thick: Math.max(thick, 13),
        deckY,
        mx,
        mz,
        quat,
        start: g.start,
        end: g.end,
        minD,
        maxD,
        dMid,
      });
    } else {
      addOpenGirderSpan(
        bridge,
        group,
        {
          name: g.name,
          span,
          thick: Math.max(thick, 12),
          deckY,
          mx,
          mz,
          quat,
          start: g.start,
          end: g.end,
          minD,
          maxD,
          dMid,
        },
        girderTheme(g.name),
      );
    }

    // Abutments stay on dry land — never drop a ramp into the river
    for (const end of [
      { p: g.start, outward: -1 },
      { p: g.end, outward: 1 },
    ]) {
      const ground = terrainHeightAt(end.p.x, end.p.z, stations);
      if (ground < SURFACE_Y + 0.6) continue;
      const drop = Math.max(0, deckY - ground);
      const rampLen = 16;
      const rx = end.p.x + dir.x * end.outward * (rampLen * 0.5);
      const rz = end.p.z + dir.z * end.outward * (rampLen * 0.5);
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 0.7, thick * 0.88), asphaltMat);
      ramp.position.set(rx, ground + drop * 0.45 + 0.35, rz);
      ramp.quaternion.copy(quat);
      if (drop > 1.4) {
        ramp.rotateZ(end.outward * -Math.atan2(drop - 0.8, rampLen) * 0.7);
      }
      ramp.receiveShadow = true;
      bridge.add(ramp);

      const abutH = Math.max(3, Math.min(10, drop + 1.4));
      const abut = new THREE.Mesh(new THREE.BoxGeometry(6, abutH, thick * 0.95), abutMat);
      abut.position.set(end.p.x, ground + abutH * 0.5, end.p.z);
      abut.quaternion.copy(quat);
      abut.castShadow = true;
      bridge.add(abut);
    }

    // Piers in the channel (skip abutments on dry banks; arched span has its own piers)
    const pierTs = customDeck
      ? []
      : span > 140
        ? [0.2, 0.35, 0.5, 0.65, 0.8]
        : span > 90
          ? [0.25, 0.5, 0.75]
          : [0.35, 0.65];
    for (const t of pierTs) {
      const px = g.start.x + (g.end.x - g.start.x) * t;
      const pz = g.start.z + (g.end.z - g.start.z) * t;
      const lat = Math.abs((px - st.x) * ax + (pz - st.z) * az);
      const wet = ((px - st.x) * ax + (pz - st.z) * az) < 0 ? leftW : rightW;
      if (lat > wet * 0.88) continue;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1, 5.4), pierMat);
      pier.castShadow = true;
      pier.quaternion.copy(quat);
      pier.renderOrder = 12;
      bridge.add(pier);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.9, 7), capMat);
      cap.quaternion.copy(quat);
      bridge.add(cap);

      group.userData.piers.push({
        mesh: pier,
        cap,
        x: px,
        z: pz,
        deckY,
        d: dMid,
        minD,
        maxD,
      });
    }

    // Name label + beacon
    const poleMat = new THREE.MeshBasicMaterial({
      color: "#f0e6c8",
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
    });
    const beaconMat = new THREE.MeshBasicMaterial({
      color: "#ffb040",
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
    });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 12, 8), poleMat);
    pole.position.set(mx, deckY + 7, mz);
    pole.renderOrder = 18;
    pole.frustumCulled = false;
    bridge.add(pole);

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(2.0, 12, 10), beaconMat);
    beacon.position.set(mx, deckY + 14.5, mz);
    beacon.renderOrder = 18;
    beacon.frustumCulled = false;
    bridge.add(beacon);

    const fullName = g.name || "Bridge";
    const label = makeBridgeLabel("B");
    label.position.set(mx, deckY + 20, mz);
    label.renderOrder = 20;
    label.frustumCulled = false;
    bridge.add(label);
    group.userData.labels.push({
      label,
      pole,
      beacon,
      x: mx,
      y: deckY + 20,
      z: mz,
      deckY,
      fullName,
      showingNames: false,
    });

    group.add(bridge);
  }

  updateBridgePiers(group, state.depthExaggeration);
  return group;
}

/** Seat the deck on the OSM road that actually crosses here. */
function snapSpanToRiverBanks(g, stations, roads) {
  const mx = Number.isFinite(g.midX) ? g.midX : (g.start.x + g.end.x) * 0.5;
  const mz = Number.isFinite(g.midZ) ? g.midZ : (g.start.z + g.end.z) * 0.5;
  const st = nearestStation(mx, mz, stations);
  const leftW = Math.max(14, st.wetHalfLeft ?? st.halfWidth ?? 40);
  const rightW = Math.max(14, st.wetHalfRight ?? st.halfWidth ?? 40);
  const cross = bestCrossingRoad(st, leftW, rightW, roads);
  let ax = -st.flowZ;
  let az = st.flowX;
  let al = Math.hypot(ax, az) || 1;
  ax /= al;
  az /= al;
  let start = { x: st.x - ax * (leftW + 18), z: st.z - az * (leftW + 18) };
  let end = { x: st.x + ax * (rightW + 18), z: st.z + az * (rightW + 18) };
  if (cross) {
    start = { x: cross.left.x, z: cross.left.z };
    end = { x: cross.right.x, z: cross.right.z };
    ax = end.x - start.x;
    az = end.z - start.z;
    al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
  }
  start = dryBankSeat(start.x, start.z, -ax, -az, stations);
  end = dryBankSeat(end.x, end.z, ax, az, stations);
  return {
    ...g,
    start,
    end,
    midX: st.x,
    midZ: st.z,
    axisX: ax,
    axisZ: az,
    lengthM: Math.hypot(end.x - start.x, end.z - start.z),
    channelHalf: (leftW + rightW) * 0.5,
  };
}

/** Walk inland until the ground is above the water, so abutments never sit in the channel. */
function dryBankSeat(x, z, ix, iz, stations) {
  let px = x;
  let pz = z;
  if (terrainHeightAt(px, pz, stations) >= SURFACE_Y + 0.7) return { x: px, z: pz };
  const step = 3;
  for (let i = 0; i < 12; i++) {
    px += ix * step;
    pz += iz * step;
    if (terrainHeightAt(px, pz, stations) >= SURFACE_Y + 0.7) return { x: px, z: pz };
  }
  return { x: px, z: pz };
}

function bestCrossingRoad(st, leftW, rightW, roads) {
  const px = -st.flowZ;
  const pz = st.flowX;
  const classW = { motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2, residential: 1 };
  let best = null;
  let bestScore = -1e9;
  for (const road of roads) {
    const hw = road.highway || "";
    if (/footway|path|steps|cycleway|pedestrian|service/.test(hw)) continue;
    let leftPt = null;
    let rightPt = null;
    let leftD = 1e9;
    let rightD = 1e9;
    for (const v of road.vertices || []) {
      const along = Math.abs((v.x - st.x) * st.flowX + (v.z - st.z) * st.flowZ);
      if (along > 75) continue;
      const signed = (v.x - st.x) * px + (v.z - st.z) * pz;
      if (signed < -leftW - 4 && along < leftD) {
        leftD = along;
        leftPt = v;
      }
      if (signed > rightW + 4 && along < rightD) {
        rightD = along;
        rightPt = v;
      }
    }
    if (!leftPt || !rightPt) continue;
    const span = Math.hypot(rightPt.x - leftPt.x, rightPt.z - leftPt.z);
    if (span < leftW + rightW + 8) continue;
    const score = (classW[hw] || 1) * 30 - (leftD + rightD) + span * 0.02;
    if (score <= bestScore) continue;
    bestScore = score;
    best = { left: leftPt, right: rightPt, hw };
  }
  return best;
}

/**
 * Prefer curated OSM bridges; also promote road polylines that actually cross water.
 */
function collectBridgeSpans(dataset, ring, stations) {
  const spans = [];
  const used = [];

  for (const g of dataset.bridges || []) {
    spans.push({
      id: g.id,
      name: g.name,
      start: g.start,
      end: g.end,
      lengthM: g.lengthM,
      widthM: g.widthM || 14,
      axisX: g.axisX,
      axisZ: g.axisZ,
    });
    used.push({ x: g.midX, z: g.midZ });
  }

  return spans;
}

function prettyRoadName(hw) {
  if (/trunk|primary/.test(hw)) return "Road Bridge";
  if (/secondary|tertiary/.test(hw)) return "Road Bridge";
  return "Bridge";
}

function nearestStation(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 300));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = s;
    }
  }
  return best;
}

function nearestHalf(x, z, stations) {
  const best = nearestStation(x, z, stations);
  const lat = Math.abs((x - best.x) * -best.flowZ + (z - best.z) * best.flowX);
  return { lat, half: best.halfWidth };
}

function mat(opts) {
  const m = new THREE.MeshStandardMaterial(opts);
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  return m;
}

/** In-scene sprite pins are superseded by the screen-space layer in bridgeLabels.js. */
export function updateBridgeLabels(group) {
  for (const item of group?.userData?.labels || []) {
    item.label.visible = false;
    if (item.pole) item.pole.visible = false;
    if (item.beacon) item.beacon.visible = false;
  }
}

function makeBridgeLabel(text) {
  const canvas = document.createElement("canvas");
  // Half resolution — sprite scale keeps on-screen size identical
  canvas.width = 512;
  canvas.height = 80;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const sprMat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const spr = new THREE.Sprite(sprMat);
  spr.userData.canvas = canvas;
  spr.renderOrder = 30;
  spr.frustumCulled = true;
  spr.scale.set(48, 48, 1);
  paintBridgeLabel(spr, text || "B", false);
  return spr;
}

function paintBridgeLabel(spr, text, fullName) {
  const canvas = spr.userData.canvas || spr.material.map?.image;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (fullName) {
    ctx.fillStyle = "rgba(8, 14, 10, 0.92)";
    roundRect(ctx, 16, 16, w - 32, h - 32, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(72, 200, 110, 1)";
    ctx.lineWidth = 8;
    roundRect(ctx, 16, 16, w - 32, h - 32, 14);
    ctx.stroke();
    const shown = String(text || "Bridge");
    const clipped = shown.length > 42 ? `${shown.slice(0, 40)}…` : shown;
    ctx.fillStyle = "#e8ffe8";
    ctx.font = "700 64px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = 8;
    ctx.fillText(clipped, w / 2, h / 2 + 4);
    ctx.shadowBlur = 0;
  } else {
    // Compact green "B" badge on every bridge
    const cx = w / 2;
    const cy = h / 2;
    const r = 52;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(12, 48, 28, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(72, 210, 110, 1)";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = "#7dff9a";
    ctx.font = "700 72px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("B", cx, cy + 4);
  }

  if (spr.material.map) {
    spr.material.map.needsUpdate = true;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function updateBridgePiers(group, exag) {
  for (const p of group.userData.piers || []) {
    const bedY = bedElevation(p.d, p.minD, p.maxD, 0.5, exag);
    const h = Math.max(6, p.deckY - 0.9 - bedY);
    p.mesh.scale.set(1, h, 1);
    p.mesh.position.set(p.x, bedY + h * 0.5, p.z);
    if (p.cap) {
      p.cap.position.set(p.x, p.deckY - 0.9, p.z);
    }
  }
}
