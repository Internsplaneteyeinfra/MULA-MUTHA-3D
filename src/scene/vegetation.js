import * as THREE from "three";
import { terrainHeightAt } from "./terrain.js";

/**
 * Vegetation from:
 * 1) Mapped OSM individual trees (exact coordinates)
 * 2) OSM park/forest polygons (distribution inside polygon only)
 * 3) Light riparian buffer along KML corridor banks
 */
export function createVegetation(dataset) {
  const stations = dataset.corridor.stations;
  const green = dataset.osm?.green || dataset.osm?.vegetation || [];
  const buildings = dataset.osm?.buildings || [];
  const roads = dataset.osm?.roads || [];
  const osmTrees = dataset.osm?.trees || [];
  const rng = mulberry(33);
  const trees = [];
  const pickables = [];

  // Exact OSM tree nodes / tree_row samples
  for (const ot of osmTrees) {
    if (blocked(ot.x, ot.z, buildings, roads, stations, true)) continue;
    const h = ot.tree_height || 8;
    const s = Math.max(0.55, Math.min(2.8, h / 6.2));
    const t = makeTree(ot.x, ot.z, stations, rng, s, "osm");
    t.meta = {
      type: "tree",
      osmId: ot.id,
      lon: ot.lon,
      lat: ot.lat,
      height: h,
      height_source: ot.height_source,
      genus: ot.genus,
      species: ot.species,
    };
    trees.push(t);
    pickables.push(t);
  }

  // Riparian buffer (lighter when many OSM trees exist)
  const riparianStep = osmTrees.length > 40 ? 6 : 3;
  const riparianDens = osmTrees.length > 40 ? 0.28 : 0.55;
  for (let i = 0; i < stations.length; i += riparianStep) {
    const st = stations[i];
    for (const side of [-1, 1]) {
      const px = -st.flowZ;
      const pz = st.flowX;
      if (rng() > riparianDens) continue;
      const n = 1 + Math.floor(rng() * 2);
      for (let k = 0; k < n; k++) {
        const dist = st.halfWidth + 10 + rng() * 28;
        const along = (rng() - 0.5) * 18;
        const x = st.x + px * side * dist + st.flowX * along;
        const z = st.z + pz * side * dist + st.flowZ * along;
        if (blocked(x, z, buildings, roads, stations)) continue;
        trees.push(makeTree(x, z, stations, rng, 1.2 + rng() * 1.8, "riparian"));
      }
    }
  }

  // Parks / forest / grass polygons — stay inside polygon
  for (const poly of green) {
    const areaHint = polygonArea(poly.vertices);
    const dense = poly.natural === "wood" || poly.landuse === "forest";
    const count = Math.min(dense ? 64 : 48, Math.max(4, Math.floor(areaHint / (dense ? 700 : 900))));
    for (let i = 0; i < count; i++) {
      const p = randomInPolygon(poly.vertices, rng);
      if (!p) continue;
      if (blocked(p.x, p.z, buildings, roads, stations)) continue;
      trees.push(makeTree(p.x, p.z, stations, rng, 1.6 + rng() * 2.4, dense ? "forest" : "park"));
    }
  }

  const n = Math.max(1, trees.length);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 3.2, 5);
  trunkGeo.translate(0, 1.6, 0);
  const canopyGeo = new THREE.SphereGeometry(1.7, 7, 6);
  canopyGeo.scale(1, 1.15, 1);
  canopyGeo.translate(0, 4.2, 0);
  const shrubGeo = new THREE.SphereGeometry(1.1, 6, 5);
  shrubGeo.scale(1.2, 0.7, 1.2);
  shrubGeo.translate(0, 0.9, 0);

  const trunks = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({ color: "#5c4638", roughness: 0.95 }),
    n,
  );
  const canopy = new THREE.InstancedMesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({ color: "#4f7a48", roughness: 0.82 }),
    n,
  );
  const shrubs = new THREE.InstancedMesh(
    shrubGeo,
    new THREE.MeshStandardMaterial({ color: "#5a7a4a", roughness: 0.9 }),
    n,
  );
  trunks.castShadow = true;
  canopy.castShadow = true;
  shrubs.castShadow = true;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let ti = 0;
  let si = 0;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    dummy.position.set(t.x, t.y, t.z);
    dummy.rotation.y = t.hue * 6.2;
    if (t.kind === "shrub") {
      dummy.scale.set(t.s * t.fat, t.s * 0.85, t.s * t.fat);
      dummy.updateMatrix();
      shrubs.setMatrixAt(si, dummy.matrix);
      color.set("#5a7a4a").offsetHSL((t.hue - 0.5) * 0.1, 0.04, (t.hue - 0.5) * 0.06);
      shrubs.setColorAt(si, color);
      si++;
    } else {
      dummy.scale.set(t.s * t.fat, t.s, t.s * t.fat);
      dummy.updateMatrix();
      trunks.setMatrixAt(ti, dummy.matrix);
      canopy.setMatrixAt(ti, dummy.matrix);
      const base =
        t.kind === "osm" ? "#3a6a38" : t.kind === "forest" ? "#2f5a32" : t.kind === "park" ? "#3f6a3a" : "#4f7a48";
      color.set(base).offsetHSL((t.hue - 0.5) * 0.12, 0.05, (t.hue - 0.5) * 0.08);
      canopy.setColorAt(ti, color);
      ti++;
    }
  }
  trunks.count = ti;
  canopy.count = ti;
  shrubs.count = si;
  if (ti) canopy.instanceColor.needsUpdate = true;
  if (si) shrubs.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.add(trunks);
  group.add(canopy);
  group.add(shrubs);
  group.name = "vegetation";
  group.userData.pickables = pickables;
  return group;
}

function makeTree(x, z, stations, rng, s, kind) {
  const shrub = kind === "riparian" && rng() > 0.55;
  return {
    x,
    z,
    y: terrainHeightAt(x, z, stations),
    s: shrub ? s * 0.55 : s,
    hue: rng(),
    fat: 0.7 + rng() * 0.7,
    kind: shrub ? "shrub" : kind,
  };
}

function blocked(x, z, buildings, roads, stations, allowNearRoad = false) {
  const near = nearest(x, z, stations);
  if (near.lat < near.half + 4) return true;
  for (const b of buildings) {
    if (Math.hypot(b.midX - x, b.midZ - z) < 14) return true;
  }
  if (!allowNearRoad) {
    for (const r of roads) {
      if (Math.hypot(r.midX - x, r.midZ - z) < (r.widthM || 5) * 1.2) return true;
    }
  }
  return false;
}

function nearest(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 160));
  for (let i = 0; i < stations.length; i += step) {
    const st = stations[i];
    const d2 = (st.x - x) ** 2 + (st.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = st;
    }
  }
  const lat = Math.abs((x - best.x) * -best.flowZ + (z - best.z) * best.flowX);
  return { lat, half: best.halfWidth };
}

function polygonArea(verts) {
  let a = 0;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    a += verts[j].x * verts[i].z - verts[i].x * verts[j].z;
  }
  return Math.abs(a) * 0.5;
}

function randomInPolygon(verts, rng) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minZ = Math.min(minZ, v.z);
    maxZ = Math.max(maxZ, v.z);
  }
  for (let tries = 0; tries < 24; tries++) {
    const x = minX + rng() * (maxX - minX);
    const z = minZ + rng() * (maxZ - minZ);
    if (pointInRing(x, z, verts)) return { x, z };
  }
  return null;
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function mulberry(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
