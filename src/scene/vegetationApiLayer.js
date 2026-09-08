import * as THREE from "three";
import { lonLatToLocal } from "../geo/geoReference.js";
import { terrainHeightAt } from "./terrain.js";
import { classifyTreeAsset, preloadTreeAssets } from "./treeRegistry.js";
import { treeTargetHeight } from "./treeOrient.js";
import { SURFACE_Y } from "./river.js";

const MAX_INSTANCES = 14000;
const BUILDING_CLEAR_M = 10;
const RIVER_CLEAR_EXTRA_M = 3;

/**
 * Build an independent Three.js InstancedMesh vegetation layer from
 * JalNetra vegetation-type samples (API is spatial source of truth).
 */
export async function createVegetationApiLayer(dataset, vegetationData) {
  const group = new THREE.Group();
  group.name = "vegetationApi";
  group.visible = true;

  const features = vegetationData?.features || [];
  if (!features.length) {
    group.userData.instanceCount = 0;
    group.userData.empty = true;
    return group;
  }

  const stations = dataset.corridor?.stations || [];
  const buildings = dataset.osm?.buildings || [];
  const roads = dataset.osm?.roads || [];
  const riverRing = dataset.ringLocal || null;
  const rng = mulberry(hashSeed(vegetationData.end_date || "veg", features.length));

  const placements = [];
  for (const f of features) {
    if (placements.length >= MAX_INSTANCES) break;
    const lon = f.longitude;
    const lat = f.latitude;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    let local;
    try {
      local = lonLatToLocal(lon, lat);
    } catch {
      continue;
    }

    const kind = classToKind(f.vegetationType);
    const cluster = densifyCount(kind, rng);
    for (let c = 0; c < cluster; c++) {
      if (placements.length >= MAX_INSTANCES) break;
      const jitter = c === 0 ? 0 : 2.5 + rng() * 8;
      const ang = rng() * Math.PI * 2;
      const x = local.x + Math.cos(ang) * jitter;
      const z = local.z + Math.sin(ang) * jitter;

      if (riverRing && pointInRing(x, z, riverRing)) continue;
      if (blocked(x, z, buildings, roads, stations)) continue;

      const y = terrainHeightAt(x, z, stations);
      if (!Number.isFinite(y) || y < SURFACE_Y - 0.5) continue;

      const assetId = assetForKind(kind, rng);
      const scale = scaleForKind(kind, rng);

      placements.push({
        x,
        z,
        y,
        rotY: rng() * Math.PI * 2,
        scale,
        assetId,
        kind,
        meta: f,
      });
    }
  }

  const prototypes = await preloadTreeAssets(placements.map((p) => p.assetId));
  const byAsset = new Map();
  for (const p of placements) {
    if (!prototypes.has(p.assetId)) continue;
    if (!byAsset.has(p.assetId)) byAsset.set(p.assetId, []);
    byAsset.get(p.assetId).push(p);
  }

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  if (!byAsset.size) {
    group.add(createProceduralFallback(placements, stations));
  } else {
    for (const [assetId, list] of byAsset) {
      const proto = prototypes.get(assetId);
      const mesh = new THREE.InstancedMesh(proto.geometry, proto.material, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `vegApi:${assetId}`;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const targetH = treeTargetHeight(assetId, p.scale);
        const uniform = targetH / Math.max(0.5, proto.nativeH);
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rotY, 0);
        dummy.scale.setScalar(uniform);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const base = assetId === "grass" ? "#5a8a48" : "#3f6f3a";
        color.set(base).offsetHSL((rng() - 0.5) * 0.06, 0.03, (rng() - 0.5) * 0.05);
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    }
  }

  group.userData.instanceCount = placements.length;
  group.userData.typeCounts = vegetationData.typeCounts || {};
  group.userData.empty = placements.length === 0;
  group.userData.source = "jalnetra-vegetation-type";
  group.userData.visualizationOnly = true;

  if (import.meta.env?.DEV) {
    console.info("[vegetation] instances generated", {
      samples: features.length,
      placed: placements.length,
      types: vegetationData.typeCounts,
    });
  }

  return group;
}

function densifyCount(kind, rng) {
  if (kind === "trees") return 4 + Math.floor(rng() * 3); // 4–6
  if (kind === "mixed") return 3 + Math.floor(rng() * 2); // 3–4
  if (kind === "shrub") return 2 + (rng() < 0.6 ? 1 : 0);
  return 1 + (rng() < 0.5 ? 1 : 0);
}

function classToKind(name = "") {
  const n = String(name).toLowerCase();
  if (/tree|forest|high/.test(n)) return "trees";
  if (/shrub|scrub|bush/.test(n)) return "shrub";
  if (/grass|herb|low/.test(n)) return "grass";
  if (/mixed|diverse|dense/.test(n)) return "mixed";
  return "mixed";
}

function assetForKind(kind, rng) {
  if (kind === "grass") return rng() < 0.35 ? "birch" : "grass";
  if (kind === "shrub") return rng() < 0.45 ? classifyTreeAsset({}, "park", rng) : "grass";
  return classifyTreeAsset({}, kind === "trees" ? "forest" : "park", rng);
}

function scaleForKind(kind, rng) {
  if (kind === "grass") return 0.7 + rng() * 0.7;
  if (kind === "shrub") return 0.85 + rng() * 0.7;
  if (kind === "mixed") return 1.0 + rng() * 1.2;
  return 1.15 + rng() * 1.55;
}

function blocked(x, z, buildings, roads, stations) {
  if (stations?.length) {
    const near = nearest(x, z, stations);
    if (near.lat < near.half + RIVER_CLEAR_EXTRA_M) return true;
  }
  for (const b of buildings) {
    if (Math.hypot(b.midX - x, b.midZ - z) < BUILDING_CLEAR_M) return true;
  }
  for (const r of roads) {
    if (Math.hypot(r.midX - x, r.midZ - z) < (r.widthM || 5) * 0.9) return true;
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

function createProceduralFallback(trees, stations) {
  const n = Math.max(1, trees.length);
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.34, 2.8, 5);
  trunkGeo.translate(0, 1.4, 0);
  const canopyGeo = new THREE.SphereGeometry(1.5, 7, 6);
  canopyGeo.scale(1, 1.1, 1);
  canopyGeo.translate(0, 3.6, 0);
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

function hashSeed(a, b) {
  let h = 2166136261;
  const s = `${a}:${b}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
