import * as THREE from "three";
import { SURFACE_Y, bedElevation } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { state } from "../state.js";
import { pointInRing } from "../features/fishing/FishingZoneSystem.js";

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
  console.info("Bridge spans", { count: spans.length, names: spans.map((s) => s.name) });

  for (const g of spans) {
    const bridge = new THREE.Group();
    bridge.name = g.name;
    bridge.renderOrder = 12;

    const bank0 = terrainHeightAt(g.start.x, g.start.z, stations);
    const bank1 = terrainHeightAt(g.end.x, g.end.z, stations);
    const deckY = Math.max(SURFACE_Y + 12.5, bank0 + 2.8, bank1 + 2.8);
    const span = Math.max(70, g.lengthM);
    const thick = Math.max(14, Math.min(26, g.widthM || 14));

    dir.set(g.axisX, 0, g.axisZ).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(xAxis, dir);
    const perpX = -g.axisZ;
    const perpZ = g.axisX;
    const mx = (g.start.x + g.end.x) * 0.5;
    const mz = (g.start.z + g.end.z) * 0.5;

    // Structural slab
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 2.2, thick), deckMat);
    deck.position.set(mx, deckY - 0.2, mz);
    deck.quaternion.copy(quat);
    deck.castShadow = true;
    deck.receiveShadow = true;
    deck.renderOrder = 12;
    bridge.add(deck);

    // Road asphalt on top — reads as continuous road
    const road = new THREE.Mesh(new THREE.BoxGeometry(span * 0.998, 0.45, thick * 0.82), asphaltMat);
    road.position.set(mx, deckY + 1.05, mz);
    road.quaternion.copy(quat);
    road.receiveShadow = true;
    road.renderOrder = 12;
    bridge.add(road);

    // Center stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(span * 0.9, 0.08, 0.35), stripeMat);
    stripe.position.set(mx, deckY + 1.3, mz);
    stripe.quaternion.copy(quat);
    stripe.renderOrder = 13;
    bridge.add(stripe);

    // Sidewalks + railings
    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(span * 0.99, 0.35, thick * 0.09), capMat);
      walk.position.set(mx + perpX * side * thick * 0.4, deckY + 1.15, mz + perpZ * side * thick * 0.4);
      walk.quaternion.copy(quat);
      bridge.add(walk);

      const rail = new THREE.Mesh(new THREE.BoxGeometry(span * 0.99, 0.55, 0.35), railMat);
      rail.position.set(mx + perpX * side * thick * 0.48, deckY + 2.35, mz + perpZ * side * thick * 0.48);
      rail.quaternion.copy(quat);
      bridge.add(rail);
    }

    // Approach ramps — longer so land roads meet the deck cleanly
    for (const end of [
      { p: g.start, outward: -1 },
      { p: g.end, outward: 1 },
    ]) {
      const ground = terrainHeightAt(end.p.x, end.p.z, stations);
      const rampLen = 36;
      const rx = end.p.x + dir.x * end.outward * (rampLen * 0.5);
      const rz = end.p.z + dir.z * end.outward * (rampLen * 0.5);
      const rampY = (deckY + ground) * 0.5 + 0.35;
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 1.25, thick * 0.95), asphaltMat);
      ramp.position.set(rx, rampY, rz);
      ramp.quaternion.copy(quat);
      const pitch = Math.atan2(deckY - ground - 1.5, rampLen);
      ramp.rotateZ(end.outward * -pitch * 0.85);
      ramp.receiveShadow = true;
      bridge.add(ramp);

      // Flat toe pad so OSM road asphalt can meet the ramp
      const toeX = end.p.x + dir.x * end.outward * (rampLen + 6);
      const toeZ = end.p.z + dir.z * end.outward * (rampLen + 6);
      const toe = new THREE.Mesh(new THREE.BoxGeometry(14, 0.35, thick * 1.05), asphaltMat);
      toe.position.set(toeX, ground + 0.2, toeZ);
      toe.quaternion.copy(quat);
      toe.receiveShadow = true;
      bridge.add(toe);

      const abutH = Math.max(5, deckY - ground);
      const abut = new THREE.Mesh(new THREE.BoxGeometry(10, abutH, thick * 1.05), abutMat);
      abut.position.set(end.p.x, ground + abutH * 0.5, end.p.z);
      abut.quaternion.copy(quat);
      abut.castShadow = true;
      bridge.add(abut);
    }

    // Piers in the channel
    const pierTs = span > 140 ? [0.2, 0.35, 0.5, 0.65, 0.8] : span > 90 ? [0.25, 0.5, 0.75] : [0.35, 0.65];
    for (const t of pierTs) {
      const px = g.start.x + (g.end.x - g.start.x) * t;
      const pz = g.start.z + (g.end.z - g.start.z) * t;
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

  // Road segments crossing the channel → elevated decks only when they truly cross
  for (const road of dataset.osm?.roads || []) {
    const hw = road.highway || "";
    if (/footway|path|steps|cycleway|pedestrian|service/.test(hw)) continue;
    const verts = road.vertices || [];
    if (verts.length < 2) continue;

    let i = 1;
    while (i < verts.length) {
      const a = verts[i - 1];
      const b = verts[i];
      const mx = (a.x + b.x) * 0.5;
      const mz = (a.z + b.z) * 0.5;
      const bank = nearestHalf(mx, mz, stations);
      const overWater =
        bank.lat < bank.half * 0.85 ||
        (ring.length && (pointInRing(mx, mz, ring) || pointInRing(a.x, a.z, ring) || pointInRing(b.x, b.z, ring)));
      if (!overWater) {
        i++;
        continue;
      }

      let j = i;
      while (j < verts.length) {
        const p0 = verts[j - 1];
        const p1 = verts[j];
        const cx = (p0.x + p1.x) * 0.5;
        const cz = (p0.z + p1.z) * 0.5;
        const bk = nearestHalf(cx, cz, stations);
        const wet =
          bk.lat < bk.half * 0.9 ||
          (ring.length && (pointInRing(cx, cz, ring) || pointInRing(p0.x, p0.z, ring) || pointInRing(p1.x, p1.z, ring)));
        if (!wet) break;
        j++;
      }

      const start = verts[i - 1];
      const end = verts[Math.min(j, verts.length - 1)];
      const midX = (start.x + end.x) * 0.5;
      const midZ = (start.z + end.z) * 0.5;
      const runLen = Math.hypot(end.x - start.x, end.z - start.z);

      // Require a real crossing: wet run long enough OR endpoints on opposite banks
      const st = nearestStation(midX, midZ, stations);
      const lat0 = (start.x - st.x) * -st.flowZ + (start.z - st.z) * st.flowX;
      const lat1 = (end.x - st.x) * -st.flowZ + (end.z - st.z) * st.flowX;
      const oppositeBanks = lat0 * lat1 < 0 && Math.abs(lat0) > st.halfWidth * 0.35 && Math.abs(lat1) > st.halfWidth * 0.35;
      if (!oppositeBanks && runLen < st.halfWidth * 1.1) {
        i = Math.max(i + 1, j);
        continue;
      }

      if (used.some((u) => Math.hypot(u.x - midX, u.z - midZ) < 100)) {
        i = Math.max(i + 1, j);
        continue;
      }

      // Snap to centerline + full bank span (same as curated bridges)
      let ax = -st.flowZ;
      let az = st.flowX;
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;
      const half = Math.max(55, st.halfWidth || 40) + 45;
      const s = { x: st.x - ax * half, z: st.z - az * half };
      const e = { x: st.x + ax * half, z: st.z + az * half };
      spans.push({
        id: `road-bridge-${road.id || i}`,
        name: road.name || prettyRoadName(hw),
        start: s,
        end: e,
        lengthM: half * 2,
        widthM: Math.max(12, road.widthM || 10),
        axisX: ax,
        axisZ: az,
      });
      used.push({ x: st.x, z: st.z });
      i = Math.max(i + 1, j);
    }
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

export function updateBridgeLabels(group, camera) {
  if (!camera || !group?.visible) return;
  const hideLabels = !!state.cinematicActive;
  // B pin / names only in Overview (not Local 3D / Bathymetry / Follow)
  const overviewOnly = state.cameraMode === "overview";
  const showNames = !!state.showBridgeNames && overviewOnly;
  const pos = new THREE.Vector3();
  for (const item of group.userData.labels || []) {
    if (item.showingNames !== showNames) {
      item.showingNames = showNames;
      paintBridgeLabel(item.label, showNames ? item.fullName || "Bridge" : "B", showNames);
    }

    pos.set(item.x, item.y, item.z);
    const d = camera.position.distanceTo(pos);
    const visible = overviewOnly && !hideLabels && d < 25000;
    item.label.visible = visible;
    if (item.pole) item.pole.visible = visible && d < 12000;
    if (item.beacon) item.beacon.visible = visible && d < 12000;
    if (!visible) continue;

    const ls = showNames
      ? THREE.MathUtils.clamp(d * 0.045, 35, 220)
      : THREE.MathUtils.clamp(d * 0.028, 18, 90);
    item.label.scale.set(showNames ? ls * 4.2 : ls * 1.15, showNames ? ls * 1.15 : ls * 1.15, 1);
    const lift = THREE.MathUtils.clamp(camera.position.y * 0.08, 8, 120);
    item.label.position.set(item.x, item.deckY + 18 + lift, item.z);

    const ms = THREE.MathUtils.clamp(d / 380, 1.2, 18);
    if (item.pole) item.pole.scale.set(ms * 0.55, ms * 0.5, ms * 0.55);
    if (item.beacon) item.beacon.scale.setScalar(ms * 0.55);
  }
}

function makeBridgeLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 160;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
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
  spr.frustumCulled = false;
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
    ctx.font = "800 64px 'Segoe UI', system-ui, sans-serif";
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
    ctx.font = "800 72px 'Segoe UI', system-ui, sans-serif";
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
