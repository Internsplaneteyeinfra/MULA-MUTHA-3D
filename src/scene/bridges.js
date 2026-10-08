import * as THREE from "three";
import { SURFACE_Y, bedElevation } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { state } from "../state.js";
import { pointInRing } from "../features/fishing/FishingZoneSystem.js";
import { addYerwadaArchSpan, isYerwadaArchBridge } from "./yerwadaArchBridge.js";
import { addAmbedkarArchSpan, isAmbedkarArchBridge } from "./ambedkarArchBridge.js";
import { addSangamGirderSpan, addOpenGirderSpan, girderTheme, isSangamGirderBridge } from "./sangamGirderBridge.js";
import { addMundhwaArchSpan, isMundhwaArchBridge } from "./mundhwaArchBridge.js";
import { validateBridgeConnections } from "./bridgeValidation.js";

/**
 * Typical roadway height above normal water (scene SURFACE_Y) for live
 * Mula–Mutha crossings. Values follow each structure’s character:
 * historic masonry sits lower; newer RCC/steel decks sit higher.
 * Final deck is max(this, bank DTM + 1.15 m) so it meets the approach road.
 */
const DECK_ABOVE_WATER_M = [
  { test: /mundhwa/i, m: 7.4 },
  { test: /fitzgerald|yerwada|yarwada|bund garden/i, m: 7.6 },
  { test: /ambedkar|babasaheb/i, m: 9.4 },
  { test: /aga khan/i, m: 8.8 },
  { test: /sangamwadi.*new/i, m: 8.6 },
  { test: /sangamwadi.*old/i, m: 7.0 },
  { test: /sangam/i, m: 8.2 },
  { test: /dengle/i, m: 7.8 },
  { test: /shivaji/i, m: 7.8 },
];

function deckYForBridge(name, y0, y1) {
  const n = String(name || "");
  const bank = Math.max(y0, y1);
  const roadY = bank + 0.28;
  const masonry = /mundhwa|fitzgerald|yerwada|yarwada|bund garden|ambedkar|babasaheb/i.test(n);
  if (masonry) {
    let above = 7.4;
    for (const row of DECK_ABOVE_WATER_M) {
      if (row.test.test(n)) {
        above = row.m;
        break;
      }
    }
    return Math.max(SURFACE_Y + above, roadY);
  }
  // Road bridges sit on the approach asphalt — not floating above it.
  return Math.max(SURFACE_Y + 1.85, roadY);
}

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
    const yerwada = isYerwadaArchBridge(g.name);
    const ambedkar = isAmbedkarArchBridge(g.name);
    const sangam = isSangamGirderBridge(g.name);
    const mundhwa = isMundhwaArchBridge(g.name);
    const historic = yerwada || mundhwa || ambedkar;
    const deckY = deckYForBridge(g.name, y0, y1);
    g.deckY = deckY;
    const orig = (dataset.bridges || []).find((b) => String(b.id) === String(g.id));
    if (orig) orig.deckY = deckY;
    const span = Math.max(36, g.lengthM);
    const thick = Math.max(10, Math.min(16, g.widthM || 12));

    dir.set(g.axisX, 0, g.axisZ).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(xAxis, dir);
    const perpX = -g.axisZ;
    const perpZ = g.axisX;
    const mx = (g.start.x + g.end.x) * 0.5;
    const mz = (g.start.z + g.end.z) * 0.5;
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
        stations,
        leftW,
        rightW,
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
          stations,
          leftW,
          rightW,
        },
        girderTheme(g.name),
      );
    }

    // Abutments on dry land for masonry spans (girder spans build their own ramps).
    for (const end of historic
      ? [
          { p: g.start, outward: -1 },
          { p: g.end, outward: 1 },
        ]
      : []) {
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
  validateBridgeConnections(spans, dataset.osm?.roads || [], stations, group);
  return group;
}

function buildBridgeFromGIS(bridge, roads, stations) {
  const startSnap = snapToRoadNetwork(bridge.start.x, bridge.start.z, roads);
  const endSnap = snapToRoadNetwork(bridge.end.x, bridge.end.z, roads);
  
  const finalStart = startSnap ? startSnap.point : bridge.start;
  const finalEnd = endSnap ? endSnap.point : bridge.end;
  
  if (startSnap && startSnap.distance <= 110) {
    bridge.userData.startConnected = true;
  }
  if (endSnap && endSnap.distance <= 110) {
    bridge.userData.endConnected = true;
  }
  
  const ax = finalEnd.x - finalStart.x;
  const az = finalEnd.z - finalStart.z;
  const al = Math.hypot(ax, az) || 1;
  
  return {
    ...bridge,
    start: finalStart,
    end: finalEnd,
    axisX: ax / al,
    axisZ: az / al,
    lengthM: al,
    midX: (finalStart.x + finalEnd.x) * 0.5,
    midZ: (finalStart.z + finalEnd.z) * 0.5,
  };
}

function snapToRoadNetwork(px, pz, roads) {
  let best = null;
  for (const r of roads) {
    if (!r.vertices || r.vertices.length < 2) continue;
    const snap = nearestPointOnPolyline(px, pz, r.vertices);
    if (!snap) continue;
    if (!best || snap.distance < best.distance) {
      best = snap;
    }
  }
  return best;
}

function nearestPointOnPolyline(px, pz, verts) {
  let bestD = Infinity;
  let bestP = null;
  let bestSeg = -1;
  for (let i = 0; i < verts.length - 1; i++) {
    const ax = verts[i].x;
    const az = verts[i].z;
    const bx = verts[i+1].x;
    const bz = verts[i+1].z;
    
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz;
    if (len2 === 0) continue;
    
    let t = ((px - ax) * abx + (pz - az) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + abx * t;
    const cz = az + abz * t;
    const d = Math.hypot(px - cx, pz - cz);
    if (d < bestD) {
      bestD = d;
      bestP = { x: cx, z: cz };
      bestSeg = i;
    }
  }
  
  if (!bestP) return null;
  
  const ax = verts[bestSeg].x;
  const az = verts[bestSeg].z;
  const bx = verts[bestSeg+1].x;
  const bz = verts[bestSeg+1].z;
  let tx = bx - ax;
  let tz = bz - az;
  const l = Math.hypot(tx, tz) || 1;
  
  return {
    point: bestP,
    distance: bestD,
    segmentIndex: bestSeg,
    tangent: { x: tx/l, z: tz/l }
  };
}

/**
 * Prefer curated OSM bridges; also promote road polylines that actually cross water.
 */
function collectBridgeSpans(dataset, ring, stations) {
  const spans = [];
  const used = [];

  const roads = dataset.osm?.roads || [];
  for (const g of dataset.bridges || []) {
    let bridge = {
      id: g.id,
      name: g.name,
      start: g.start,
      end: g.end,
      lengthM: g.lengthM,
      widthM: g.widthM || 14,
      axisX: g.axisX,
      axisZ: g.axisZ,
      midX: g.midX,
      midZ: g.midZ,
      userData: { startConnected: false, endConnected: false }
    };
    
    const built = buildBridgeFromGIS(bridge, roads, stations);
    spans.push(built);
    used.push({ x: built.midX, z: built.midZ });
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
