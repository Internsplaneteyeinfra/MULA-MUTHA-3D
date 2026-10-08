import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";

/** Sangam Bridge — blue round piers, steel road deck. */
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
  pier: "#8ec6d4",
};

export function girderTheme(name = "") {
  const n = String(name).toLowerCase();
  if (/shivaji/.test(n)) return { steel: "#94a2ac", pier: "#8ebfe0" };
  if (/dengle/.test(n)) return { steel: "#909890", pier: "#7ecfc0" };
  if (/aga khan/.test(n)) return { steel: "#8e96a4", pier: "#9ab4dc" };
  if (/sangamwadi/.test(n)) return { steel: "#8a9098", pier: "#86c4d4" };
  return { ...DEFAULT_THEME };
}

export function addSangamGirderSpan(bridge, group, opts) {
  addOpenGirderSpan(bridge, group, opts, girderTheme(opts.name || "Sangam Bridge"));
}

/**
 * Normal road bridge: low deck, piers only in the water, no viaduct over the banks.
 */
export function addOpenGirderSpan(bridge, group, opts, theme = DEFAULT_THEME) {
  const { span, thick, deckY, mx, mz, quat, start, end, minD, maxD, dMid, stations, leftW, rightW } = opts;
  const t = { ...DEFAULT_THEME, ...theme };

  const steel = mat(t.steel);
  const blue = mat(t.pier);
  const concrete = mat("#d2ccc4");
  const asphalt = mat("#2a2a2c");
  const stripe = mat("#f0f0ee");
  const rail = mat("#d8dce0");
  const cornice = mat("#e4ddd4");
  const parapet = mat("#ebe4db");

  const visSpan = Math.max(36, span);
  const pierR = 0.7;
  const ux = (end.x - start.x) / (span || 1);
  const uz = (end.z - start.z) / (span || 1);

  const local = new THREE.Group();
  local.position.set(mx, 0, mz);
  local.quaternion.copy(quat);

  const girder = new THREE.Mesh(new THREE.BoxGeometry(visSpan + 0.4, 0.55, thick + 0.15), steel);
  girder.position.set(0, deckY - 0.4, 0);
  girder.castShadow = true;
  girder.receiveShadow = true;
  local.add(girder);

  const corniceBand = new THREE.Mesh(new THREE.BoxGeometry(visSpan + 0.5, 0.22, thick + 0.35), cornice);
  corniceBand.position.set(0, deckY - 0.08, 0);
  local.add(corniceBand);

  const road = new THREE.Mesh(new THREE.BoxGeometry(visSpan * 0.998, 0.16, thick * 0.88), asphalt);
  road.position.set(0, deckY, 0);
  road.receiveShadow = true;
  local.add(road);

  const line = new THREE.Mesh(new THREE.BoxGeometry(visSpan * 0.88, 0.04, 0.16), stripe);
  line.position.set(0, deckY + 0.1, 0);
  local.add(line);

  for (const side of [-1, 1]) {
    const z = side * thick * 0.48;
    const walk = new THREE.Mesh(new THREE.BoxGeometry(visSpan, 0.14, thick * 0.08), parapet);
    walk.position.set(0, deckY + 0.08, z);
    local.add(walk);

    const nPost = Math.max(16, Math.round(visSpan / 3.6));
    for (let p = 0; p <= nPost; p++) {
      const px = -visSpan * 0.5 + (p / nPost) * visSpan;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.85, 0.32), parapet);
      post.position.set(px, deckY + 0.55, z);
      local.add(post);
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(visSpan, 0.1, 0.36), parapet);
    cap.position.set(0, deckY + 1.0, z);
    local.add(cap);

    const nLight = Math.max(4, Math.round(visSpan / 22));
    for (let i = 0; i <= nLight; i++) {
      const px = -visSpan * 0.5 + (i / nLight) * visSpan;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 4.4, 6), rail);
      stem.position.set(px, deckY + 2.4, z + side * 0.12);
      local.add(stem);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 1.1), rail);
      arm.position.set(px, deckY + 4.5, z - side * 0.3);
      local.add(arm);
    }
  }

  bridge.add(local);

  // Seat both ends on the dry banks and ramp down to the OSM roads.
  for (const side of [-1, 1]) {
    let wx = mx + ux * side * visSpan * 0.5;
    let wz = mz + uz * side * visSpan * 0.5;
    if (stations) {
      for (let k = 0; k < 10; k++) {
        if (terrainHeightAt(wx, wz, stations) >= SURFACE_Y + 0.55) break;
        wx += ux * side * 2.5;
        wz += uz * side * 2.5;
      }
    }
    const ground = stations ? terrainHeightAt(wx, wz, stations) : deckY;
    const drop = deckY - (ground + 0.28);
    if (drop > 0.35) {
      const rampLen = Math.max(8, Math.min(18, drop * 6));
      const midX = wx + ux * side * rampLen * 0.45;
      const midZ = wz + uz * side * rampLen * 0.45;
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 0.32, thick * 0.88), asphalt);
      ramp.position.set(midX, ground + drop * 0.5 + 0.16, midZ);
      ramp.quaternion.copy(quat);
      ramp.rotateZ(side * -Math.atan2(drop, rampLen) * 0.95);
      ramp.receiveShadow = true;
      bridge.add(ramp);
    }
  }

  const nPier = Math.max(3, Math.min(6, Math.round(visSpan / 22)));
  const shaftGeo = new THREE.CylinderGeometry(pierR, pierR * 1.06, 1, 12);
  const capGeo = new THREE.BoxGeometry(pierR * 2.3, 0.55, thick * 0.5);
  for (let i = 1; i < nPier; i++) {
    const u = i / nPier;
    const px = start.x + (end.x - start.x) * (0.5 + (u - 0.5) * (visSpan / span));
    const pz = start.z + (end.z - start.z) * (0.5 + (u - 0.5) * (visSpan / span));
    if (stations && terrainHeightAt(px, pz, stations) > SURFACE_Y + 1.1) continue;

    const shaft = new THREE.Mesh(shaftGeo, blue);
    shaft.castShadow = true;
    shaft.renderOrder = 12;
    bridge.add(shaft);

    const cap = new THREE.Mesh(capGeo, concrete);
    cap.quaternion.copy(quat);
    bridge.add(cap);

    group.userData.piers.push({
      mesh: shaft,
      cap,
      x: px,
      z: pz,
      deckY: deckY - 0.2,
      d: dMid,
      minD,
      maxD,
    });
  }
}
