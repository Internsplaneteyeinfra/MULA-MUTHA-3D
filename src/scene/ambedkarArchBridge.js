import * as THREE from "three";
import { SURFACE_Y } from "./river.js";

/** Modern RCC arch: Babasaheb Ambedkar Bridge (Sangamwadi). */
export function isAmbedkarArchBridge(name = "") {
  return /ambedkar|babasaheb/i.test(name);
}

function conc(color, extra = {}) {
  return new THREE.MeshLambertMaterial({
    color,
    emissive: color,
    emissiveIntensity: extra.emissiveIntensity ?? 0.14,
    ...extra,
  });
}

/**
 * Large gray concrete arches, fascia, metal rail, and street lights —
 * matching the real Babasaheb Ambedkar Bridge.
 */
export function addAmbedkarArchSpan(bridge, group, opts) {
  const { span, thick, deckY, mx, mz, quat, start, end, minD, maxD, dMid } = opts;

  const concrete = conc("#d8d2c8");
  const concreteDark = conc("#c8c2b8");
  const fascia = conc("#e8e2d8");
  const asphalt = conc("#5a5e64");
  const stripe = conc("#f2f2f0", { roughness: 0.5 });
  const steel = conc("#b8bcc0", { roughness: 0.45, metalness: 0.35 });
  const pole = conc("#9aa0a6", { roughness: 0.5, metalness: 0.25 });

  const nArch = Math.max(3, Math.min(5, Math.round(span / 36)));
  const bay = span / nArch;
  const pierW = Math.min(2.8, bay * 0.12);
  const springY = SURFACE_Y - 0.7;
  const wallH = Math.max(8, deckY - springY);
  const depth = thick * 1.05;
  const archGeo = makeOpenArch(bay - pierW * 0.9, wallH, depth);

  const local = new THREE.Group();
  local.position.set(mx, 0, mz);
  local.quaternion.copy(quat);

  for (let i = 0; i < nArch; i++) {
    const x = -span * 0.5 + (i + 0.5) * bay;
    const wall = new THREE.Mesh(archGeo, concrete);
    wall.position.set(x, springY, 0);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.renderOrder = 12;
    local.add(wall);
  }

  // Deck box + pale fascia band like the photograph
  const slab = new THREE.Mesh(new THREE.BoxGeometry(span + 0.6, 1.15, thick + 0.4), concreteDark);
  slab.position.set(0, deckY + 0.2, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  local.add(slab);

  const band = new THREE.Mesh(new THREE.BoxGeometry(span + 0.7, 0.55, thick + 0.85), fascia);
  band.position.set(0, deckY + 0.55, 0);
  local.add(band);

  const road = new THREE.Mesh(new THREE.BoxGeometry(span * 0.998, 0.2, thick * 0.82), asphalt);
  road.position.set(0, deckY + 0.88, 0);
  road.receiveShadow = true;
  local.add(road);

  const line = new THREE.Mesh(new THREE.BoxGeometry(span * 0.9, 0.04, 0.18), stripe);
  line.position.set(0, deckY + 1.0, 0);
  local.add(line);

  for (const side of [-1, 1]) {
    const z = side * thick * 0.48;
    const walk = new THREE.Mesh(new THREE.BoxGeometry(span, 0.18, thick * 0.08), fascia);
    walk.position.set(0, deckY + 0.92, z);
    local.add(walk);

    const nBar = Math.max(28, Math.round(span / 1.35));
    for (let i = 0; i <= nBar; i++) {
      const px = -span * 0.5 + (i / nBar) * span;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.05, 0.06), steel);
      bar.position.set(px, deckY + 1.5, z);
      local.add(bar);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(span, 0.08, 0.1), steel);
    rail.position.set(0, deckY + 2.05, z);
    local.add(rail);
    const railLo = new THREE.Mesh(new THREE.BoxGeometry(span, 0.06, 0.08), steel);
    railLo.position.set(0, deckY + 1.35, z);
    local.add(railLo);

    const nLight = Math.max(4, Math.round(span / 22));
    for (let i = 0; i <= nLight; i++) {
      const px = -span * 0.5 + (i / nLight) * span;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7.2, 6), pole);
      stem.position.set(px, deckY + 4.5, z + side * 0.25);
      local.add(stem);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 1.6), pole);
      arm.position.set(px, deckY + 8.0, z - side * 0.45);
      local.add(arm);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.16, 0.55),
        new THREE.MeshStandardMaterial({
          color: "#e8e0c8",
          emissive: "#c8b070",
          emissiveIntensity: 0.45,
          roughness: 0.4,
        }),
      );
      lamp.position.set(px, deckY + 7.85, z - side * 1.05);
      local.add(lamp);
    }
  }

  bridge.add(local);

  const pierGeo = new THREE.BoxGeometry(pierW, 1, depth * 0.55);
  const capGeo = new THREE.BoxGeometry(pierW + 1.8, 0.85, depth * 0.72);
  for (let i = 0; i <= nArch; i++) {
    const t = i / nArch;
    const px = start.x + (end.x - start.x) * t;
    const pz = start.z + (end.z - start.z) * t;
    const pier = new THREE.Mesh(pierGeo, concreteDark);
    pier.castShadow = true;
    pier.quaternion.copy(quat);
    pier.renderOrder = 12;
    bridge.add(pier);

    const cap = new THREE.Mesh(capGeo, concrete);
    cap.quaternion.copy(quat);
    bridge.add(cap);

    group.userData.piers.push({
      mesh: pier,
      cap,
      x: px,
      z: pz,
      deckY: springY + 0.6,
      d: dMid,
      minD,
      maxD,
    });
  }
}

function makeOpenArch(bayW, wallH, depth) {
  const hw = Math.max(1.6, bayW * 0.5);
  const r = Math.min(hw * 0.97, wallH * 0.9);
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
