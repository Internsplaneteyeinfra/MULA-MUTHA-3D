import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { terrainHeightAt } from "../scene/terrain.js";
import { computeFootprintMetrics } from "./footprintMetrics.js";
import { classifyBuilding } from "./buildingClassifier.js";
import { preloadBuildingAssets, prototypeKey } from "./glbRegistry.js";
import { setPlacementStations, sampleFootprintElevation } from "./footprintPlacement.js";
import {
  getFarLodMaterial,
  paletteColor,
  styleClassFromClassification,
} from "./buildingMaterials.js";
import { createRooftopDetails } from "./rooftopDetails.js";
import { pointInRing } from "../features/fishing/FishingZoneSystem.js";

/** Near river → detailed GLB kits + facade PBR; far → extruded LOD with window shader. */
const GLB_CORRIDOR_M = 2800;
const GLB_MAX = 14000;
/** Keep building footprints clear of the KML water polygon. */
const WATER_CLEAR_M = 4;

/**
 * Build urban buildings from OSM footprints + GLB prototypes + Pune PBR facades.
 * Preserves footprint centroids, yaw, and terrain elevation — appearance only.
 */
export async function createBuildingSystem(dataset) {
  const group = new THREE.Group();
  group.name = "buildings";

  const stations = dataset.corridor.stations;
  const ring = dataset.ringLocal || [];
  setPlacementStations(stations);
  const raw = dataset.osm?.buildings || [];
  if (!raw.length) {
    console.warn("No OSM building footprints — building layer empty");
    return group;
  }

  const nearPlacements = [];
  const farBuildings = [];
  let skippedWater = 0;

  for (const b of raw) {
    const metrics = computeFootprintMetrics(b);
    if (!metrics) continue;
    const near = distToCorridor(metrics.centroidX, metrics.centroidZ, stations);
    const bank = nearestHalf(metrics.centroidX, metrics.centroidZ, stations);
    // Stay outside channel + water polygon (fixes buildings looking "in the river")
    if (bank.lat < bank.half * 0.78) {
      skippedWater++;
      continue;
    }
    if (ring.length && overlapsWater(metrics, b, ring, WATER_CLEAR_M)) {
      skippedWater++;
      continue;
    }

    const classification = classifyBuilding(b, metrics);
    const record = { building: b, metrics, classification, dist: near };
    if (near <= GLB_CORRIDOR_M) nearPlacements.push(record);
    else farBuildings.push(record);
  }

  nearPlacements.sort((a, b) => a.dist - b.dist);
  const glbSet = nearPlacements.slice(0, GLB_MAX);
  const overflow = nearPlacements.slice(GLB_MAX);
  farBuildings.push(...overflow);

  const prototypes = await preloadBuildingAssets(glbSet);

  const byAsset = new Map();
  for (const rec of glbSet) {
    const style = styleClassFromClassification(rec.classification);
    const key = prototypeKey(rec.classification.assetId, style);
    if (!prototypes.has(key)) {
      farBuildings.push(rec);
      continue;
    }
    if (!byAsset.has(key)) byAsset.set(key, []);
    byAsset.get(key).push(rec);
  }

  const rooftopSources = [];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  for (const [key, list] of byAsset) {
    const proto = prototypes.get(key);
    if (!proto?.geometry || !list.length) continue;
    const mesh = new THREE.InstancedMesh(proto.geometry, proto.material, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `glb:${key}`;
    mesh.frustumCulled = true;
    mesh.geometry.computeBoundingSphere();

    for (let i = 0; i < list.length; i++) {
      const { metrics, classification, building } = list[i];
      const y = sampleFootprintElevation(metrics, stations);
      const sx = metrics.lengthM / Math.max(0.1, proto.nativeW);
      const sz = metrics.widthM / Math.max(0.1, proto.nativeD);
      const plan = (sx + sz) * 0.5;
      // Slightly under-scale kits so boxes don't spill onto roads / water
      const planSx = clamp(sx, plan * 0.72, plan * 1.2) * 0.9;
      const planSz = clamp(sz, plan * 0.72, plan * 1.2) * 0.9;
      const sy = clamp(classification.heightM / Math.max(0.1, proto.nativeH), 0.55, 2.8);

      dummy.position.set(metrics.centroidX, y, metrics.centroidZ);
      dummy.rotation.set(0, metrics.yaw, 0);
      dummy.scale.set(planSx, sy, planSz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      color.copy(paletteColor(classification.paletteSeed ?? building.id ?? i));
      // Slight deterministic brightness variation
      const tint = ((classification.paletteSeed ?? 0) % 7) / 7;
      color.offsetHSL(0, 0, (tint - 0.5) * 0.06);
      mesh.setColorAt(i, color);

      rooftopSources.push({
        ...list[i],
        roofY: y + classification.heightM * 0.98,
      });
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  if (farBuildings.length) {
    group.add(buildFarLodExtrusions(farBuildings, stations));
  }

  // Rooftops only on nearer corridor buildings (performance)
  const roofSubset = rooftopSources.filter((r) => r.dist < 700).slice(0, 900);
  group.add(createRooftopDetails(roofSubset, stations));

  console.info("Urban buildings", {
    footprints: raw.length,
    detailedKits: glbSet.length,
    farLod: farBuildings.length,
    rooftops: roofSubset.length,
    skippedWater,
    corridorM: GLB_CORRIDOR_M,
    assets: [...byAsset.keys()],
    source: "OSM + Google/Microsoft Open Buildings + GLB kits",
  });

  return group;
}

function buildFarLodExtrusions(list, stations) {
  const group = new THREE.Group();
  group.name = "buildingsFarLod";
  const tmp = new THREE.Color();
  const CHUNK = 2200;

  const step = list.length > 22000 ? 2 : 1;
  const geos = [];
  for (let i = 0; i < list.length; i += step) {
    const { building, metrics, classification } = list[i];
    const verts = building.vertices;
    if (!verts || verts.length < 4) continue;
    const shape = new THREE.Shape();
    // ExtrudeGeometry is XY then rotateX(-π/2) → (x,h,-y). Use -z so footprint keeps +Z = north.
    shape.moveTo(verts[0].x - metrics.centroidX, -(verts[0].z - metrics.centroidZ));
    for (let k = 1; k < verts.length; k++) {
      shape.lineTo(verts[k].x - metrics.centroidX, -(verts[k].z - metrics.centroidZ));
    }
    let geo;
    try {
      geo = new THREE.ExtrudeGeometry(shape, {
        depth: classification.heightM,
        bevelEnabled: false,
        steps: 1,
      });
    } catch {
      continue;
    }
    geo.rotateX(-Math.PI / 2);

    // Thin parapet / roof slab so far LOD is not a bare prism
    const roofH = 0.4;
    let roofGeo = null;
    try {
      roofGeo = new THREE.ExtrudeGeometry(shape, {
        depth: roofH,
        bevelEnabled: false,
        steps: 1,
      });
      roofGeo.rotateX(-Math.PI / 2);
      roofGeo.translate(0, classification.heightM, 0);
    } catch {
      /* ignore */
    }

    const y = terrainHeightAt(metrics.centroidX, metrics.centroidZ, stations);
    geo.translate(metrics.centroidX, y, metrics.centroidZ);
    if (roofGeo) roofGeo.translate(metrics.centroidX, y, metrics.centroidZ);

    tmp.copy(paletteColor(classification.paletteSeed ?? building.id ?? i));
    const paint = (g, darken) => {
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const r = tmp.r * darken;
      const gg = tmp.g * darken;
      const b = tmp.b * darken;
      for (let v = 0; v < n; v++) {
        col[v * 3] = r;
        col[v * 3 + 1] = gg;
        col[v * 3 + 2] = b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geos.push(g);
    };
    paint(geo, 1);
    if (roofGeo) paint(roofGeo, 0.72);

    if (geos.length >= CHUNK) {
      const mesh = flushFarChunk(geos);
      if (mesh) group.add(mesh);
      geos.length = 0;
    }
  }

  if (geos.length) {
    const mesh = flushFarChunk(geos);
    if (mesh) group.add(mesh);
  }
  return group;
}

function flushFarChunk(geos) {
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return null;
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, getFarLodMaterial());
  mesh.name = "buildingsFarLodChunk";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function distToCorridor(x, z, stations) {
  let best = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 180));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    best = Math.min(best, Math.hypot(s.x - x, s.z - z));
  }
  return best;
}

function nearestHalf(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 180));
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

function overlapsWater(metrics, building, ring, clearM) {
  if (pointInRing(metrics.centroidX, metrics.centroidZ, ring)) return true;
  if (distToRingEdge(metrics.centroidX, metrics.centroidZ, ring) < clearM) return true;
  const verts = building.vertices || [];
  for (let i = 0; i < verts.length; i += Math.max(1, Math.floor(verts.length / 6))) {
    const v = verts[i];
    if (pointInRing(v.x, v.z, ring)) return true;
    if (distToRingEdge(v.x, v.z, ring) < clearM * 0.6) return true;
  }
  return false;
}

function distToRingEdge(x, z, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
