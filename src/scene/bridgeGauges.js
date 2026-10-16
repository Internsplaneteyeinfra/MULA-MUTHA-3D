/**
 * Staff gauges on bridges: one graduated depth scale per bridge, mounted on the upstream face of
 * the pier just left of the river centreline (looking downstream). The scale runs from the river
 * bed up to the bridge road; 0 m is the bed, so the waterline reads the water depth there.
 *
 * Depth is the surveyed water depth at the pier (inverse-distance mix of the nearest Excel survey
 * points — the same sampling the river bed mesh uses), so the gauge, the pier base and the bed agree.
 */
import * as THREE from "three";
import { SURFACE_Y, bedElevation } from "./river.js";
import { spatialIndex, neighbors } from "../geo/corridor.js";

const BOARD_W = 6; // metres
const PX_PER_M = 128; // texture resolution
const FRONT_GAP_M = 5; // stand the gauge visibly clear of the bridge's upstream face

let surveyIndex = null;

/** Nearest survey point within maxM: { depth, distM } or null. */
export function nearestSurvey(dataset, x, z, maxM = 400) {
  let best = null;
  for (const p of dataset?.points || []) {
    const depth = Number(p.depth);
    if (!Number.isFinite(depth)) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= maxM && (!best || d < best.distM)) best = { depth, distM: d };
  }
  return best;
}

/** Surveyed water depth (m) at x/z, or null when no survey point lies within 90 m. */
export function surveyDepthAt(dataset, x, z) {
  const pts = dataset?.points;
  if (!pts?.length) return null;
  if (!surveyIndex || surveyIndex.src !== pts) surveyIndex = { src: pts, idx: spatialIndex(pts) };
  let w = 0;
  let s = 0;
  for (const p of neighbors(surveyIndex.idx, x, z)) {
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 > 90 * 90) continue;
    const depth = Number(p.depth);
    if (!Number.isFinite(depth)) continue;
    const ww = 1 / Math.max(6, d2);
    w += ww;
    s += ww * depth;
  }
  return w > 0 ? s / w : null;
}

function nearestStation(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  for (const s of stations) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * How far the pier's masonry (shaft, cap, footing / cutwater) reaches upstream of the pier centre,
 * measured from the real meshes of this bridge, so the board stands clear in front of it.
 * Deck, parapets and other long members (> 15 m across) are ignored — they span the whole bridge.
 */
const _box = new THREE.Box3();
const _v = new THREE.Vector3();
function pierFrontReach(bridgeObj, at, fx, fz) {
  let reach = 1.5;
  if (!bridgeObj) return reach;
  bridgeObj.updateMatrixWorld(true);
  bridgeObj.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (_box.max.x - _box.min.x > 15 || _box.max.z - _box.min.z > 15) return;
    if (at.x < _box.min.x - 0.5 || at.x > _box.max.x + 0.5 || at.z < _box.min.z - 0.5 || at.z > _box.max.z + 0.5) return;
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? _box.max.x : _box.min.x, 0, i & 2 ? _box.max.z : _box.min.z);
      reach = Math.max(reach, (_v.x - at.x) * fx + (_v.z - at.z) * fz);
    }
  });
  return reach;
}

function drawScale(depthM, freeboardM) {
  const totalM = depthM + freeboardM;
  const h = Math.ceil(totalM * PX_PER_M);
  const w = Math.round(BOARD_W * PX_PER_M);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const yOf = (m) => h - m * PX_PER_M; // 0 m = bed (bottom)
  ctx.fillStyle = "#fbfaf5";
  ctx.fillRect(0, 0, w, h);
  // Left 40 %: staff-gauge "E" pattern — 10 cm bands alternating red / black every 0.5 m.
  const tickW = w * 0.4;
  for (let k = 0; k * 0.1 < totalM; k++) {
    if (k % 2) continue;
    const y0 = yOf((k + 1) * 0.1);
    ctx.fillStyle = Math.floor(k / 5) % 2 === 0 ? "#d32f2f" : "#111";
    ctx.fillRect(0, y0, tickW * (k % 10 === 0 ? 1 : 0.75), 0.1 * PX_PER_M);
  }
  ctx.fillStyle = "#111";
  ctx.fillRect(tickW, 0, 6, h); // divider
  // Right 60 %: large metre numbers, one per metre, centred in that metre.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontPx = Math.round(PX_PER_M * 1.0);
  for (let m = 0; m <= Math.floor(totalM); m++) {
    const y = yOf(m);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, y - 4, w, 8); // full-width metre line
    if (m < Math.floor(totalM) || totalM - m > 0.75) {
      const cy = yOf(m + 0.5);
      ctx.font = `900 ${fontPx}px 'Segoe UI', Arial, sans-serif`;
      ctx.lineWidth = 12;
      ctx.strokeStyle = "#fbfaf5";
      ctx.strokeText(String(m + 1), tickW + (w - tickW) * 0.42, cy);
      ctx.fillStyle = (m + 1) % 5 === 0 ? "#d32f2f" : "#111";
      ctx.fillText(String(m + 1), tickW + (w - tickW) * 0.42, cy);
      ctx.font = `700 ${Math.round(fontPx * 0.34)}px 'Segoe UI', Arial, sans-serif`;
      ctx.fillStyle = "#333";
      ctx.fillText("m", tickW + (w - tickW) * 0.85, cy + fontPx * 0.12);
    }
  }
  // Waterline.
  const yw = yOf(depthM);
  ctx.fillStyle = "#00b8f0";
  ctx.fillRect(0, yw - 8, w, 16);
  // Darken the submerged part a little so the waterline reads from far away.
  ctx.fillStyle = "rgba(12, 52, 80, 0.28)";
  ctx.fillRect(0, yw + 8, w, h - yw);
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, totalM };
}

function makeLabel(text) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(8, 22, 34, 0.86)";
  ctx.beginPath();
  ctx.roundRect(4, 4, 504, 120, 22);
  ctx.fill();
  ctx.strokeStyle = "#00b8f0";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 58px 'Segoe UI', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Drawn over the pier / deck so the reading is never hidden behind the bridge.
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true }));
  spr.scale.set(8, 2, 1);
  spr.renderOrder = 30;
  return spr;
}

/**
 * Build one gauge per bridge from the piers recorded in bridges.userData.piers
 * (each tagged with bridgeName by createBridges). Returns the gauge group (added to `bridges`).
 */
export function createBridgeGauges(bridges, dataset, exag = 1) {
  const group = new THREE.Group();
  group.name = "bridgeGauges";
  const stations = dataset.corridor?.stations || [];
  const spans = dataset.bridgeSpans || [];
  const piersByBridge = new Map();
  for (const p of bridges.userData.piers || []) {
    if (!p.bridgeName) continue;
    if (!piersByBridge.has(p.bridgeName)) piersByBridge.set(p.bridgeName, []);
    piersByBridge.get(p.bridgeName).push(p);
  }
  const postMat = new THREE.MeshStandardMaterial({ color: "#d9d4c8", roughness: 0.7 });
  const gauges = [];
  for (const span of spans) {
    if (!stations.length) break;
    const name = span.name || "Bridge";
    // River crossing: point on the span closest to the river centreline.
    let cross = null;
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const x = span.start.x + (span.end.x - span.start.x) * t;
      const z = span.start.z + (span.end.z - span.start.z) * t;
      const st = nearestStation(x, z, stations);
      const lat = Math.abs((x - st.x) * -st.flowZ + (z - st.z) * st.flowX);
      if (!cross || lat < cross.lat) cross = { x, z, st, lat };
    }
    const st = cross.st;
    const sideOf = (q) => (q.x - st.x) * -st.flowZ + (q.z - st.z) * st.flowX; // + = right bank
    const inRiver = (q) => {
      const sd = sideOf(q);
      return Math.abs(sd) <= (sd >= 0 ? st.wetHalfRight ?? st.halfWidth : st.wetHalfLeft ?? st.halfWidth);
    };
    // Pier just left of the centreline (looking downstream); else the pier nearest the centre.
    const wet = (piersByBridge.get(name) || []).filter(inRiver);
    const left = wet.filter((q) => sideOf(q) <= 0);
    const pool = left.length ? left : wet;
    const pier = pool.length ? pool.reduce((a, q) => (Math.abs(sideOf(q)) < Math.abs(sideOf(a)) ? q : a)) : null;

    // No pier in the water: stand a gauge post just left of the crossing point.
    const leftHalf = st.wetHalfLeft ?? st.halfWidth ?? 20;
    const at = pier
      ? { x: pier.x, z: pier.z }
      : { x: cross.x - -st.flowZ * leftHalf * 0.3, z: cross.z - st.flowX * leftHalf * 0.3 };

    let depthM = surveyDepthAt(dataset, at.x, at.z);
    let approxM = null;
    if (!Number.isFinite(depthM)) {
      const ns = nearestSurvey(dataset, at.x, at.z);
      if (!ns) continue; // no survey data anywhere near — no honest depth to show
      depthM = ns.depth;
      approxM = ns.distM;
    }

    // Scale runs from the river bed up to the road deck.
    const deckTop = (Number.isFinite(span.deckY) ? span.deckY : SURFACE_Y + 8) - 0.3;
    const freeboardM = Math.max(1.5, deckTop - SURFACE_Y);
    const { tex, totalM } = drawScale(depthM, freeboardM);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W, 1),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }),
    );
    board.renderOrder = 13;
    // Face upstream (toward the water coming down the river).
    // Face square to the pier's upstream face: normal of the bridge axis, on the upstream side
    // (falls back to straight upstream when the span has no axis).
    let fx = -st.flowX;
    let fz = -st.flowZ;
    const al = Math.hypot(span.axisX || 0, span.axisZ || 0);
    if (al > 1e-6) {
      let nx = -span.axisZ / al;
      let nz = span.axisX / al;
      if (nx * fx + nz * fz < 0) { nx = -nx; nz = -nz; }
      fx = nx;
      fz = nz;
    }
    board.rotation.y = Math.atan2(fx, fz);
    const off = pier ? pierFrontReach(bridges.getObjectByName(name), at, fx, fz) + FRONT_GAP_M : FRONT_GAP_M;
    board.userData = { x: at.x + fx * off, z: at.z + fz * off, depthM, totalM, freeboardM };

    const text = approxM == null
      ? `Depth ${depthM.toFixed(2)} m`
      : `≈ ${depthM.toFixed(2)} m · survey ${Math.round(approxM)} m`;
    const label = makeLabel(text);
    const g = new THREE.Group();
    g.name = `gauge:${name}`;
    g.add(board, label);
    // Keep the gauge freestanding in front of the bridge, including when its station is beside a pier.
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 1, 10), postMat);
    post.userData = { x: board.userData.x, z: board.userData.z };
    g.add(post);
    g.userData = { bridgeName: name, depthM, approxM, onPier: !!pier };
    group.add(g);
    gauges.push({ group: g, board, label, post });
  }
  group.userData.gauges = gauges;
  updateBridgeGauges(group, exag);
  bridges.add(group);
  console.info(
    "[bridge-gauges]",
    gauges.map((g) => {
      const u = g.group.userData;
      return `${u.bridgeName}: ${u.depthM.toFixed(2)} m${u.approxM != null ? ` (nearest survey ${Math.round(u.approxM)} m)` : ""}${u.onPier ? "" : " [post]"}`;
    }),
  );
  return group;
}

/** Re-seat gauges for the current depth exaggeration (bed moves, water surface stays). */
export function updateBridgeGauges(group, exag = 1) {
  for (const { board, label, post } of group?.userData?.gauges || []) {
    const { x, z, depthM, totalM, freeboardM } = board.userData;
    const bedY = bedElevation(depthM, 0, 0, 0.5, exag);
    // Real metres below the water are stretched with the bed; the freeboard stays 1:1.
    const below = SURFACE_Y - bedY;
    const height = below + freeboardM;
    board.scale.set(1, height, 1);
    board.position.set(x, bedY + height * 0.5, z);
    // Map texture so the waterline stays on the water surface at any exaggeration.
    const tex = board.material.map;
    const waterV = depthM / totalM; // texture v of the waterline (0 = bed)
    tex.repeat.set(1, 1);
    tex.offset.set(0, 0);
    // Piecewise mapping is not possible with one plane; split exactly at the waterline instead.
    board.geometry.dispose();
    board.geometry = splitBoardGeometry(below / height, waterV);
    label.position.set(x, SURFACE_Y + freeboardM + 2.4, z);
    if (post) {
      post.scale.set(1, height + 0.6, 1);
      post.position.set(post.userData.x, bedY + (height + 0.6) * 0.5, post.userData.z);
    }
  }
}

/** Plane whose lower part (bed → water) maps to texture 0..waterV and upper part to waterV..1. */
function splitBoardGeometry(waterFrac, waterV) {
  const geo = new THREE.BufferGeometry();
  const y0 = -0.5;
  const yw = -0.5 + waterFrac;
  const y1 = 0.5;
  const hw = BOARD_W * 0.5;
  geo.setAttribute("position", new THREE.Float32BufferAttribute([
    -hw, y0, 0, hw, y0, 0, -hw, yw, 0, hw, yw, 0, -hw, y1, 0, hw, y1, 0,
  ], 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, waterV, 1, waterV, 0, 1, 1, 1], 2));
  geo.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
  return geo;
}
