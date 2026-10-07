import * as THREE from "three";
import { SURFACE_Y } from "./river.js";

export function isMundhwaArchBridge(name = "") {
  return /mundhwa/i.test(name);
}

function stoneMat(color, extra = {}) {
  const { map: mapOpt, ...rest } = extra;
  const map = mapOpt === null ? null : mapOpt || stoneMap();
  return new THREE.MeshLambertMaterial({
    color,
    map,
    emissive: color,
    emissiveIntensity: 0.16,
    ...rest,
  });
}

let _stoneMap;
function stoneMap() {
  if (_stoneMap) return _stoneMap;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#d2ccc4";
  ctx.fillRect(0, 0, 128, 64);
  ctx.lineWidth = 1.2;
  for (let row = 0; row < 8; row++) {
    const y = row * 8;
    const off = row % 2 ? 16 : 0;
    ctx.strokeStyle = "#b4aea6";
    for (let x = -20; x < 140; x += 32) {
      ctx.fillStyle = row % 3 === 0 ? "#ddd8d0" : "#d0cac2";
      ctx.fillRect(x + off, y, 32, 8);
      ctx.strokeRect(x + off, y, 32, 8);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 4);
  t.anisotropy = 4;
  _stoneMap = t;
  return t;
}

/**
 * Dark masonry viaduct matching Mundhwa Bridge: round stone arches,
 * heavy river piers, cornice, and a stone parapet with street lights.
 */
export function addMundhwaArchSpan(bridge, group, opts) {
  const { span, thick, deckY, mx, mz, quat, start, end, minD, maxD, dMid } = opts;

  const stone = stoneMat("#c8c0b4");
  const stoneDark = stoneMat("#b4aca0");
  const pierStone = stoneMat("#cfc8be");
  const cornice = stoneMat("#e4ddd4", { map: null });
  const parapet = stoneMat("#ebe4db", { map: null });
  const asphalt = stoneMat("#5a5e64", { map: null });
  const stripe = stoneMat("#ececec", { map: null, roughness: 0.5 });
  const pole = stoneMat("#c8ccd0", { map: null, roughness: 0.5, metalness: 0.2 });

  const nArch = Math.max(7, Math.min(11, Math.round(span / 18)));
  const bay = span / nArch;
  const pierW = Math.min(2.6, bay * 0.16);
  const springY = SURFACE_Y - 0.8;
  const wallH = Math.max(7, deckY - springY);
  const depth = thick * 1.12;
  const archGeo = makeOpenArch(bay - pierW * 0.85, wallH, depth);

  const local = new THREE.Group();
  local.position.set(mx, 0, mz);
  local.quaternion.copy(quat);

  for (let i = 0; i < nArch; i++) {
    const x = -span * 0.5 + (i + 0.5) * bay;
    const wall = new THREE.Mesh(archGeo, stone);
    wall.position.set(x, springY, 0);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.renderOrder = 12;
    local.add(wall);
  }

  const band = new THREE.Mesh(new THREE.BoxGeometry(span + 1.0, 0.55, depth + 0.75), cornice);
  band.position.set(0, deckY - 0.3, 0);
  band.castShadow = true;
  local.add(band);

  const slab = new THREE.Mesh(new THREE.BoxGeometry(span + 0.5, 0.85, thick), stoneDark);
  slab.position.set(0, deckY + 0.18, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  local.add(slab);

  const road = new THREE.Mesh(new THREE.BoxGeometry(span * 0.998, 0.2, thick * 0.74), asphalt);
  road.position.set(0, deckY + 0.7, 0);
  road.receiveShadow = true;
  local.add(road);

  const line = new THREE.Mesh(new THREE.BoxGeometry(span * 0.88, 0.04, 0.16), stripe);
  line.position.set(0, deckY + 0.82, 0);
  local.add(line);

  for (const side of [-1, 1]) {
    const z = side * thick * 0.47;
    const walk = new THREE.Mesh(new THREE.BoxGeometry(span, 0.22, thick * 0.11), parapet);
    walk.position.set(0, deckY + 0.72, z);
    local.add(walk);

    const nPost = Math.max(24, Math.round(span / 3.2));
    for (let p = 0; p <= nPost; p++) {
      const px = -span * 0.5 + (p / nPost) * span;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.2, 0.46), parapet);
      post.position.set(px, deckY + 1.38, z);
      local.add(post);
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(span, 0.18, 0.52), parapet);
    cap.position.set(0, deckY + 2.02, z);
    local.add(cap);

    const nLight = Math.max(5, Math.round(span / 22));
    for (let i = 0; i <= nLight; i++) {
      const px = -span * 0.5 + (i / nLight) * span;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 7.2, 6), pole);
      stem.position.set(px, deckY + 4.55, z + side * 0.18);
      local.add(stem);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 1.45), pole);
      arm.position.set(px, deckY + 8.05, z - side * 0.38);
      local.add(arm);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.14, 0.48),
        new THREE.MeshStandardMaterial({
          color: "#ece6d4",
          emissive: "#c4b070",
          emissiveIntensity: 0.38,
          roughness: 0.4,
        }),
      );
      lamp.position.set(px, deckY + 7.9, z - side * 0.95);
      local.add(lamp);
    }
  }

  bridge.add(local);

  const pierGeo = new THREE.BoxGeometry(pierW, 1, Math.min(depth * 0.55, thick * 0.7));
  const capGeo = new THREE.BoxGeometry(pierW + 1.5, 0.7, depth * 1.06);
  for (let i = 0; i <= nArch; i++) {
    const t = i / nArch;
    const px = start.x + (end.x - start.x) * t;
    const pz = start.z + (end.z - start.z) * t;
    const pier = new THREE.Mesh(pierGeo, pierStone);
    pier.castShadow = true;
    pier.quaternion.copy(quat);
    pier.renderOrder = 12;
    bridge.add(pier);

    const pierCap = new THREE.Mesh(capGeo, cornice);
    pierCap.quaternion.copy(quat);
    bridge.add(pierCap);

    group.userData.piers.push({
      mesh: pier,
      cap: pierCap,
      x: px,
      z: pz,
      deckY: springY + 0.35,
      d: dMid,
      minD,
      maxD,
    });
  }
}

/** Spandrel only above the arch — opening under the curve stays empty so the river can pass. */
function makeOpenArch(bayW, wallH, depth) {
  const hw = Math.max(1.4, bayW * 0.5);
  const r = Math.min(hw * 0.97, wallH * 0.92);
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
