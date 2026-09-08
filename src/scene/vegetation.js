import * as THREE from "three";
import { terrainHeightAt } from "./terrain.js";
import { classifyTreeAsset, preloadTreeAssets } from "./treeRegistry.js";
import { treeTargetHeight } from "./treeOrient.js";

const MAX_TREES = 11000;

/**
 * Vegetation from OSM trees + parks + riparian buffer.
 * Uses reference GLB models (palm, broadleaf, conifer, birch, grass).
 */
export async function createVegetation(dataset) {
  const stations = dataset.corridor.stations;
  const green = dataset.osm?.green || dataset.osm?.vegetation || [];
  const buildings = dataset.osm?.buildings || [];
  const roads = dataset.osm?.roads || [];
  const osmTrees = dataset.osm?.trees || [];
  const rng = mulberry(33);
  const placements = [];
  const pickables = [];

  for (const ot of osmTrees) {
    if (blocked(ot.x, ot.z, buildings, roads, stations, true)) continue;
    const h = ot.tree_height || 8;
    const assetId = classifyTreeAsset(ot, "osm", rng);
    const scale = Math.max(0.45, Math.min(2.6, h / 8));
    placements.push({
      x: ot.x,
      z: ot.z,
      scale,
      rotY: rng() * Math.PI * 2,
      assetId,
      kind: "osm",
      meta: {
        type: "tree",
        osmId: ot.id,
        lon: ot.lon,
        lat: ot.lat,
        height: h,
        height_source: ot.height_source,
        genus: ot.genus,
        species: ot.species,
        assetId,
      },
    });
    pickables.push(placements[placements.length - 1]);
  }

  const riparianStep = osmTrees.length > 40 ? 2 : 1;
  const riparianDens = osmTrees.length > 40 ? 0.78 : 0.92;
  for (let i = 0; i < stations.length; i += riparianStep) {
    const st = stations[i];
    for (const side of [-1, 1]) {
      const px = -st.flowZ;
      const pz = st.flowX;
      if (rng() > riparianDens) continue;
      const n = 2 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const dist = st.halfWidth + 8 + rng() * 36;
        const along = (rng() - 0.5) * 22;
        const x = st.x + px * side * dist + st.flowX * along;
        const z = st.z + pz * side * dist + st.flowZ * along;
        if (blocked(x, z, buildings, roads, stations)) continue;
        placements.push({
          x,
          z,
          scale: 0.9 + rng() * 1.25,
          rotY: rng() * Math.PI * 2,
          assetId: classifyTreeAsset({}, "riparian", rng),
          kind: "riparian",
        });
      }
    }
  }

  for (const poly of green) {
    const props = poly;
    const areaHint = polygonArea(poly.vertices);
    const dense = props.natural === "wood" || props.landuse === "forest";
    const count = Math.min(dense ? 160 : 120, Math.max(10, Math.floor(areaHint / (dense ? 260 : 360))));
    for (let i = 0; i < count; i++) {
      const p = randomInPolygon(poly.vertices, rng);
      if (!p) continue;
      if (blocked(p.x, p.z, buildings, roads, stations)) continue;
      placements.push({
        x: p.x,
        z: p.z,
        scale: 0.95 + rng() * 1.5,
        rotY: rng() * Math.PI * 2,
        assetId: classifyTreeAsset(props, dense ? "forest" : "park", rng),
        kind: dense ? "forest" : "park",
      });
    }
  }

  const capped = placements.slice(0, MAX_TREES);
  for (const p of capped) {
    p.y = terrainHeightAt(p.x, p.z, stations);
  }

  const assetIds = capped.map((p) => p.assetId);
  const prototypes = await preloadTreeAssets(assetIds);

  const group = new THREE.Group();
  group.name = "vegetation";

  const byAsset = new Map();
  for (const p of capped) {
    if (!prototypes.has(p.assetId)) continue;
    if (!byAsset.has(p.assetId)) byAsset.set(p.assetId, []);
    byAsset.get(p.assetId).push(p);
  }

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  for (const [assetId, list] of byAsset) {
    const proto = prototypes.get(assetId);
    const mesh = new THREE.InstancedMesh(proto.geometry, proto.material, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `trees:${assetId}`;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const targetH = treeTargetHeight(assetId, p.scale);
      const uniform = targetH / Math.max(0.5, proto.nativeH);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rotY, 0);
      dummy.scale.setScalar(uniform);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const hue = (p.x * 0.001 + p.z * 0.0013) % 1;
      color.set(assetId === "grass" ? "#5a8a48" : "#4a7a42").offsetHSL((hue - 0.5) * 0.08, 0.04, (hue - 0.5) * 0.06);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  // Procedural fallback if GLBs missing
  if (!byAsset.size) {
    group.add(createProceduralFallback(capped.length ? capped : [{ x: 0, z: 0, y: 0, scale: 1, rotY: 0, kind: "park" }], stations, rng));
  }

  group.userData.pickables = pickables;
  return group;
}

function createProceduralFallback(trees, stations, rng) {
  const n = Math.max(1, trees.length);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 3.2, 5);
  trunkGeo.translate(0, 1.6, 0);
  const canopyGeo = new THREE.SphereGeometry(1.7, 7, 6);
  canopyGeo.scale(1, 1.15, 1);
  canopyGeo.translate(0, 4.2, 0);
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
  const dummy = new THREE.Object3D();
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    dummy.position.set(t.x, t.y ?? terrainHeightAt(t.x, t.z, stations), t.z);
    dummy.rotation.y = t.rotY || 0;
    dummy.scale.setScalar(t.scale || 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    canopy.setMatrixAt(i, dummy.matrix);
  }
  trunks.count = trees.length;
  canopy.count = trees.length;
  const g = new THREE.Group();
  g.add(trunks);
  g.add(canopy);
  return g;
}

function blocked(x, z, buildings, roads, stations, allowNearRoad = false) {
  const near = nearest(x, z, stations);
  if (near.lat < near.half + 4) return true;
  for (const b of buildings) {
    if (Math.hypot(b.midX - x, b.midZ - z) < 14) return true;
  }
  if (!allowNearRoad) {
    for (const r of roads) {
      if (Math.hypot(r.midX - x, r.midZ - z) < (r.widthM || 5) * 0.85) return true;
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
