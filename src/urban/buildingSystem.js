import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { terrainHeightAt } from "../scene/terrain.js";
import { computeFootprintMetrics } from "./footprintMetrics.js";
import { classifyBuilding } from "./buildingClassifier.js";
import { setPlacementStations, sampleFootprintElevation } from "./footprintPlacement.js";
import {
  getFarLodMaterial,
  neighborhoodPaletteColor,
} from "./buildingMaterials.js";
import { createRooftopDetails } from "./rooftopDetails.js";
import { createDoorInstances } from "./doorPlacement.js";
import { buildFootprintTier, paintWallRoofGeo } from "./footprintExtrusions.js";
import { buildCityHlod } from "./cityHlod.js";
import { corridorTier, LOD } from "./buildingLodTiers.js";
import { auditBuildingSample } from "./buildingAudit.js";
import { pointInRing } from "../features/fishing/FishingZoneSystem.js";

const WATER_CLEAR_M = 3;

/**
 * Four-tier OSM footprint city (ArcGIS-style principles, Pune geography).
 * Hero → Near → Mid → Distant/HLOD — all actual OSM polygons via geoReference.
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

  const heroRecs = [];
  const nearRecs = [];
  const midRecs = [];
  const distantRecs = [];
  let skippedWater = 0;

  for (const b of raw) {
    const metrics = computeFootprintMetrics(b);
    if (!metrics) continue;
    const dist = distToCorridor(metrics.centroidX, metrics.centroidZ, stations);
    const bank = nearestHalf(metrics.centroidX, metrics.centroidZ, stations);
    if (bank.lat < bank.half * 0.72) {
      skippedWater++;
      continue;
    }
    if (ring.length && overlapsWater(metrics, b, ring, WATER_CLEAR_M)) {
      skippedWater++;
      continue;
    }

    const classification = classifyBuilding(b, metrics);
    const record = { building: b, metrics, classification, dist };
    const tier = corridorTier(dist, classification);
    if (tier === "hero") heroRecs.push(record);
    else if (tier === "near") nearRecs.push(record);
    else if (tier === "mid") midRecs.push(record);
    else distantRecs.push(record);
  }

  const allRecs = [...heroRecs, ...nearRecs, ...midRecs, ...distantRecs];
  auditBuildingSample(allRecs, stations, 20);

  const heroGroup = buildFootprintTier(heroRecs, stations, {
    name: "buildingsHero",
    maxCount: LOD.HERO_MAX,
    individualHero: true,
    roofSlab: true,
  });

  const nearGroup = buildFootprintTier(nearRecs, stations, {
    name: "buildingsNear",
    maxCount: LOD.NEAR_MAX,
    roofSlab: true,
  });

  const midGroup = buildFootprintTier(midRecs, stations, {
    name: "buildingsMid",
    maxCount: LOD.MID_MAX,
    roofSlab: true,
    useMidMaterial: true,
  });

  const distantGroup = buildFarLodExtrusions(distantRecs, stations);
  const hlodGroup = buildCityHlod(distantRecs, stations);

  group.add(heroGroup);
  group.add(nearGroup);
  group.add(midGroup);
  group.add(distantGroup);
  group.add(hlodGroup);

  group.userData.lod = {
    hero: heroGroup,
    near: nearGroup,
    mid: midGroup,
    distant: distantGroup,
    hlod: hlodGroup,
  };

  const doorPlacements = [...heroRecs, ...nearRecs].sort((a, b) => a.dist - b.dist);
  group.add(createDoorInstances(doorPlacements, dataset, { maxDoors: 2200, corridorM: LOD.NEAR_M }));

  const roofSubset = doorPlacements.filter((r) => r.dist < 650).slice(0, 1100);
  group.add(createRooftopDetails(roofSubset, stations));

  console.info("Urban buildings (4-tier OSM footprints)", {
    footprints: raw.length,
    hero: heroRecs.length,
    near: nearRecs.length,
    mid: midRecs.length,
    distant: distantRecs.length,
    skippedWater,
    source: "OSM footprints + geoReference",
  });

  return group;
}

function buildFarLodExtrusions(list, stations) {
  const group = new THREE.Group();
  group.name = "buildingsFarLod";
  const tmp = new THREE.Color();
  const CHUNK = 2200;
  const step = list.length > 20000 ? 2 : 1;
  const geos = [];

  for (let i = 0; i < list.length; i += step) {
    const { building, metrics, classification } = list[i];
    const verts = building.vertices;
    if (!verts || verts.length < 4) continue;
    const shape = new THREE.Shape();
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
    const y = terrainHeightAt(metrics.centroidX, metrics.centroidZ, stations);
    geo.translate(metrics.centroidX, y, metrics.centroidZ);
    tmp.copy(neighborhoodPaletteColor(classification.paletteSeed ?? building.id ?? i, metrics.centroidX, metrics.centroidZ));
    paintWallRoofGeo(geo, tmp);
    geos.push(geo);

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

function paintGeo(geo, color, mult) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r * mult;
    col[i * 3 + 1] = color.g * mult;
    col[i * 3 + 2] = color.b * mult;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
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
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
}
