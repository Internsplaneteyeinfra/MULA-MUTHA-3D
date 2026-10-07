import * as THREE from "three";
import { SURFACE_Y } from "./river.js";

/** Sangam Bridge — blue round piers, shallow dark arches, steel deck + OHE. */
export function isSangamGirderBridge(name = "") {
  return /\bsangam\b/i.test(name) && !/sangamwadi|ambedkar/i.test(name);
}

function mat(color, extra = {}) {
  return new THREE.MeshLambertMaterial({
    color,
    emissive: color,
    emissiveIntensity: extra.emissiveIntensity ?? 0.14,
    ...extra,
  });
}

const DEFAULT_THEME = {
  steel: "#8a9098",
  steelDark: "#7a828a",
  pier: "#8ec6d4",
};

/** Tints for the other named crossings that share Sangam’s open-girder look. */
export function girderTheme(name = "") {
  const n = String(name).toLowerCase();
  if (/shivaji/.test(n)) return { steel: "#94a2ac", steelDark: "#82909a", pier: "#8ebfe0" };
  if (/dengle/.test(n)) return { steel: "#909890", steelDark: "#808880", pier: "#7ecfc0" };
  if (/aga khan/.test(n)) return { steel: "#8e96a4", steelDark: "#7c8490", pier: "#9ab4dc" };
  if (/sangamwadi/.test(n)) return { steel: "#8a9098", steelDark: "#7a828a", pier: "#86c4d4" };
  return { ...DEFAULT_THEME };
}

export function addSangamGirderSpan(bridge, group, opts) {
  addOpenGirderSpan(bridge, group, opts, girderTheme(opts.name || "Sangam Bridge"));
}

export function addOpenGirderSpan(bridge, group, opts, theme = DEFAULT_THEME) {
  const { span, thick, deckY, mx, mz, quat, start, end, minD, maxD, dMid } = opts;
  const t = { ...DEFAULT_THEME, ...theme };

  const steel = mat(t.steel);
  const steelDark = mat(t.steelDark);
  const blue = mat(t.pier);
  const concrete = mat("#d2ccc4");
  const asphalt = mat("#5a5e64");
  const stripe = mat("#f0f0ee");
  const rail = mat("#d8dce0");
  const cornice = mat("#e4ddd4");
  const parapet = mat("#ebe4db");

  const nBay = Math.max(6, Math.min(9, Math.round(span / 20)));
  const bay = span / nBay;
  const pierR = 0.85;
  const springY = SURFACE_Y - 0.6;
  const wallH = Math.max(6.5, deckY - springY);
  const depth = thick * 0.95;
  const archGeo = makeOpenArch(bay - pierR * 2.2, wallH, depth);

  const local = new THREE.Group();
  local.position.set(mx, 0, mz);
  local.quaternion.copy(quat);

  for (let i = 0; i < nBay; i++) {
    const x = -span * 0.5 + (i + 0.5) * bay;
    const wall = new THREE.Mesh(archGeo, steelDark);
    wall.position.set(x, springY, 0);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.renderOrder = 12;
    local.add(wall);
  }

  const girder = new THREE.Mesh(new THREE.BoxGeometry(span + 0.6, 1.35, thick + 0.35), steel);
  girder.position.set(0, deckY + 0.15, 0);
  girder.castShadow = true;
  girder.receiveShadow = true;
  local.add(girder);

  const corniceBand = new THREE.Mesh(new THREE.BoxGeometry(span + 0.9, 0.5, thick + 0.85), cornice);
  corniceBand.position.set(0, deckY + 0.72, 0);
  corniceBand.castShadow = true;
  local.add(corniceBand);

  for (const side of [-1, 1]) {
    const web = new THREE.Mesh(new THREE.BoxGeometry(span + 0.4, 1.6, 0.28), steel);
    web.position.set(0, deckY + 0.1, side * thick * 0.48);
    web.castShadow = true;
    local.add(web);
  }

  const road = new THREE.Mesh(new THREE.BoxGeometry(span * 0.998, 0.18, thick * 0.82), asphalt);
  road.position.set(0, deckY + 0.92, 0);
  road.receiveShadow = true;
  local.add(road);

  const line = new THREE.Mesh(new THREE.BoxGeometry(span * 0.9, 0.04, 0.16), stripe);
  line.position.set(0, deckY + 1.04, 0);
  local.add(line);

  for (const side of [-1, 1]) {
    const z = side * thick * 0.5;
    const walk = new THREE.Mesh(new THREE.BoxGeometry(span, 0.2, thick * 0.1), parapet);
    walk.position.set(0, deckY + 1.05, z);
    local.add(walk);

    const nPost = Math.max(22, Math.round(span / 3.4));
    for (let p = 0; p <= nPost; p++) {
      const px = -span * 0.5 + (p / nPost) * span;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.15, 0.42), parapet);
      post.position.set(px, deckY + 1.7, z);
      local.add(post);
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(span, 0.16, 0.48), parapet);
    cap.position.set(0, deckY + 2.32, z);
    local.add(cap);

    // OHE / lighting masts along the deck (as in the photo)
    const nMast = Math.max(6, Math.round(span / 18));
    for (let i = 0; i <= nMast; i++) {
      const px = -span * 0.5 + (i / nMast) * span;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 9.5, 6), rail);
      mast.position.set(px, deckY + 5.8, z + side * 0.15);
      local.add(mast);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 2.4), rail);
      cross.position.set(px, deckY + 10.4, z - side * 0.6);
      local.add(cross);
      const ins = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), rail);
      ins.position.set(px, deckY + 10.05, z - side * 1.5);
      local.add(ins);
    }
  }

  bridge.add(local);

  const shaftGeo = new THREE.CylinderGeometry(pierR, pierR * 1.08, 1, 14);
  const capGeo = new THREE.BoxGeometry(pierR * 2.6, 0.7, depth * 0.72);
  const plinthGeo = new THREE.BoxGeometry(pierR * 2.2, 0.9, Math.min(depth * 0.5, thick * 0.55));
  for (let i = 0; i <= nBay; i++) {
    const t = i / nBay;
    const px = start.x + (end.x - start.x) * t;
    const pz = start.z + (end.z - start.z) * t;

    const shaft = new THREE.Mesh(shaftGeo, blue);
    shaft.castShadow = true;
    shaft.renderOrder = 12;
    bridge.add(shaft);

    const cap = new THREE.Mesh(capGeo, concrete);
    cap.quaternion.copy(quat);
    bridge.add(cap);

    const plinth = new THREE.Mesh(plinthGeo, concrete);
    plinth.quaternion.copy(quat);
    plinth.position.set(px, SURFACE_Y - 0.15, pz);
    plinth.castShadow = true;
    bridge.add(plinth);

    group.userData.piers.push({
      mesh: shaft,
      cap,
      x: px,
      z: pz,
      deckY: springY + 0.5,
      d: dMid,
      minD,
      maxD,
    });
  }
}

/** Spandrel only above the arch — opening under the curve stays empty so the river can pass. */
function makeOpenArch(bayW, wallH, depth) {
  const hw = Math.max(1.4, bayW * 0.5);
  const r = Math.min(hw * 0.97, wallH * 0.88);
  const shape = new THREE.Shape();
  shape.moveTo(-hw, wallH);
  shape.lineTo(hw, wallH);
  shape.lineTo(hw, 0);
  shape.lineTo(r, 0);
  shape.absarc(0, 0, r, 0, Math.PI, false);
  shape.lineTo(-hw, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 28,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}
