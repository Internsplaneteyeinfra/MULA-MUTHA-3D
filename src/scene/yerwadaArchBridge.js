import * as THREE from "three";
import { SURFACE_Y } from "./river.js";

/** Historic Fitzgerald / Bund Garden / Yerwada basalt viaduct. */
export function isYerwadaArchBridge(name = "") {
  return /yerwada|yarwada|fitzgerald|bund garden/i.test(name);
}

function stoneMat(color, extra = {}) {
  const { map: mapOpt, ...rest } = extra;
  const map = mapOpt === null ? null : mapOpt || stoneMap();
  return new THREE.MeshLambertMaterial({
    color,
    map,
    emissive: color,
    emissiveIntensity: 0.14,
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
  ctx.strokeStyle = "#b4aea6";
  ctx.lineWidth = 1.2;
  for (let row = 0; row < 8; row++) {
    const y = row * 8;
    const off = row % 2 ? 16 : 0;
    for (let x = -20; x < 140; x += 32) {
      ctx.fillStyle = row % 2 ? "#ddd8d0" : "#d0cac2";
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
 * Dark basalt multi-arch viaduct matching Fitzgerald Bridge:
 * round masonry arches, circular spandrel medallions, stone parapet, white rail.
 */
export function addYerwadaArchSpan(bridge, group, opts) {
  const { span, thick, deckY, mx, mz, quat, start, end, minD, maxD, dMid } = opts;

  const basalt = stoneMat("#c8c0b4");
  const basaltDark = stoneMat("#b4aca0");
  const corniceStone = stoneMat("#e4ddd4", { map: null });
  const parapet = stoneMat("#ebe4db", { map: null });
  const discMat = stoneMat("#d8d2c8", { map: null });
  const asphalt = stoneMat("#5a5e64", { map: null });
  const stripe = stoneMat("#ececec", { map: null, roughness: 0.5 });
  const whiteRail = stoneMat("#e8e8e4", { map: null, roughness: 0.45, metalness: 0.12 });
  const pole = stoneMat("#c8ccd0", { map: null, roughness: 0.5, metalness: 0.2 });

  const nArch = Math.max(7, Math.min(11, Math.round(span / 18)));
  const bay = span / nArch;
  const pierW = Math.min(2.6, bay * 0.16);
  const springY = SURFACE_Y - 0.8;
  const wallH = Math.max(7, deckY - springY);
  const depth = thick * 1.1;
  const archGeo = makeOpenArch(bay - pierW * 0.85, wallH, depth);

  const local = new THREE.Group();
  local.position.set(mx, 0, mz);
  local.quaternion.copy(quat);

  for (let i = 0; i < nArch; i++) {
    const x = -span * 0.5 + (i + 0.5) * bay;
    const wall = new THREE.Mesh(archGeo, basalt);
    wall.position.set(x, springY, 0);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.renderOrder = 12;
    local.add(wall);
  }

  // Circular stone medallions on each pier face (as in the photograph)
  const discGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.22, 18);
  for (let i = 1; i < nArch; i++) {
    const x = -span * 0.5 + i * bay;
    const y = springY + wallH * 0.52;
    for (const face of [-1, 1]) {
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(x, y, face * (depth * 0.5 + 0.1));
      disc.castShadow = true;
      local.add(disc);
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), discMat);
      boss.position.set(x, y, face * (depth * 0.5 + 0.22));
      local.add(boss);
    }
  }

  const cornice = new THREE.Mesh(new THREE.BoxGeometry(span + 0.9, 0.5, depth + 0.7), corniceStone);
  cornice.position.set(0, deckY - 0.28, 0);
  cornice.castShadow = true;
  local.add(cornice);

  const slab = new THREE.Mesh(new THREE.BoxGeometry(span + 0.5, 0.8, thick), basaltDark);
  slab.position.set(0, deckY + 0.18, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  local.add(slab);

  const road = new THREE.Mesh(new THREE.BoxGeometry(span * 0.998, 0.2, thick * 0.72), asphalt);
  road.position.set(0, deckY + 0.68, 0);
  road.receiveShadow = true;
  local.add(road);

  const line = new THREE.Mesh(new THREE.BoxGeometry(span * 0.88, 0.04, 0.16), stripe);
  line.position.set(0, deckY + 0.8, 0);
  local.add(line);

  for (const side of [-1, 1]) {
    const z = side * thick * 0.46;
    const walk = new THREE.Mesh(new THREE.BoxGeometry(span, 0.22, thick * 0.12), parapet);
    walk.position.set(0, deckY + 0.7, z);
    local.add(walk);

    // Stone parapet wall with repeating posts
    const nPost = Math.max(22, Math.round(span / 3.4));
    for (let p = 0; p <= nPost; p++) {
      const px = -span * 0.5 + (p / nPost) * span;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.15, 0.42), parapet);
      post.position.set(px, deckY + 1.35, z);
      local.add(post);
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(span, 0.16, 0.48), parapet);
    cap.position.set(0, deckY + 1.95, z);
    local.add(cap);

    // Inner white crash rail (photo)
    const wz = z - side * thick * 0.08;
    const nBar = Math.max(40, Math.round(span / 1.1));
    for (let i = 0; i <= nBar; i++) {
      const px = -span * 0.5 + (i / nBar) * span;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.05), whiteRail);
      bar.position.set(px, deckY + 1.35, wz);
      local.add(bar);
    }
    const wRail = new THREE.Mesh(new THREE.BoxGeometry(span, 0.08, 0.08), whiteRail);
    wRail.position.set(0, deckY + 1.85, wz);
    local.add(wRail);
    const wRailLo = new THREE.Mesh(new THREE.BoxGeometry(span, 0.07, 0.07), whiteRail);
    wRailLo.position.set(0, deckY + 1.15, wz);
    local.add(wRailLo);

    const nLight = Math.max(5, Math.round(span / 24));
    for (let i = 0; i <= nLight; i++) {
      const px = -span * 0.5 + (i / nLight) * span;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 7.4, 6), pole);
      stem.position.set(px, deckY + 4.6, z + side * 0.2);
      local.add(stem);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 1.5), pole);
      arm.position.set(px, deckY + 8.2, z - side * 0.4);
      local.add(arm);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.14, 0.5),
        new THREE.MeshStandardMaterial({
          color: "#ece6d4",
          emissive: "#c4b070",
          emissiveIntensity: 0.4,
          roughness: 0.4,
        }),
      );
      lamp.position.set(px, deckY + 8.05, z - side * 1.0);
      local.add(lamp);
    }
  }

  bridge.add(local);

  const pierGeo = new THREE.BoxGeometry(pierW, 1, Math.min(depth * 0.55, thick * 0.7));
  const capGeo = new THREE.BoxGeometry(pierW + 1.2, 0.65, depth * 1.04);
  for (let i = 0; i <= nArch; i++) {
    const t = i / nArch;
    const px = start.x + (end.x - start.x) * t;
    const pz = start.z + (end.z - start.z) * t;
    const pier = new THREE.Mesh(pierGeo, basaltDark);
    pier.castShadow = true;
    pier.quaternion.copy(quat);
    pier.renderOrder = 12;
    bridge.add(pier);

    const cap = new THREE.Mesh(capGeo, corniceStone);
    cap.quaternion.copy(quat);
    bridge.add(cap);

    group.userData.piers.push({
      mesh: pier,
      cap,
      x: px,
      z: pz,
      deckY: springY + 0.35,
      d: dMid,
      minD,
      maxD,
    });
  }
}

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
