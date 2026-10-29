import * as THREE from "three";
import {
  terrainHeightAt,
  renderedTerrainHeightAt,
  rawDtmElevationAt,
  ribbonEdgeDistance,
  makeStationLocator,
  terrainCellDiag,
} from "./terrain.js";
import { channelBankY } from "./channelBanks.js";
import { classifyTreeAsset, preloadTreeAssets, foliageHex } from "./treeRegistry.js";
import { treeTargetHeight } from "./treeOrient.js";
import { loadLulcClassGrid } from "../geo/lulcRaster.js";
import { RIVER_SIDE_M } from "../geo/osmContext.js";
import { SURFACE_Y } from "./river.js";

const MAX_TREES = 16000;

/**
 * Mapped OpenStreetMap tree points plus clearly approximate vegetation instances
 * derived from green-area / land-cover polygons. Polygon samples are visual canopy,
 * not surveyed individual tree locations. Nothing is planted on open water.
 * Uses reference GLB models (palm, broadleaf, conifer, birch, grass).
 * @param {object} dataset
 * @param {{ maxTrees?: number, castShadow?: boolean }} [opts]
 */
export async function createVegetation(dataset, opts = {}) {
  const stations = dataset.corridor.stations;
  const green = dataset.osm?.green || dataset.osm?.vegetation || [];
  const buildings = dataset.osm?.buildings || [];
  const roads = dataset.osm?.roads || [];
  const nearBuilding = createProximityTest(buildings, () => 14);
  const nearRoad = createProximityTest(roads, (road) => (road.widthM || 5) * 0.85);
  const osmTrees = dataset.osm?.trees || [];
  const rng = mulberry(33);
  const placements = [];
  const pickables = [];
  const maxTrees = Math.max(200, Number(opts.maxTrees) || MAX_TREES);
  const castShadow = !!opts.castShadow;
  const lulc = await loadLulcClassGrid().catch((err) => {
    console.warn("[vegetation] LULC unavailable — riparian band skipped:", err?.message || err);
    return null;
  });
  const cell = terrainCellDiag(opts.terrainMesh);
  const blendStart = cell + 6 + cell;
  const outerD = blendStart + cell * 0.35;
  const locate = makeStationLocator(stations);
  // The drawn water sheet only. LULC "water" covers the green banks and was
  // skipping the forest the satellite shows on that land.
  const isOpenWater = (x, z) => {
    const st = locate(x, z);
    if (!st) return false;
    return ribbonEdgeDistance(x, z, stations, st).d < 4;
  };
  const groundY = (x, z) => {
    const st = locate(x, z);
    if (!st) return null;
    let { d } = ribbonEdgeDistance(x, z, stations, st);
    let raw = rawDtmElevationAt(x, z);
    // Naik Bet is dry land inside the mapped river corridor. The river ribbon
    // crosses the island there, so use its land-cover class to retain the DTM
    // surface for vegetation instead of treating the island as submerged.
    const chainage = Number(st.chainage_m);
    const cover = lulc?.classAtLocal?.(x, z);
    if (chainage >= 700 && chainage <= 1980 && d < 90 && cover && cover !== "water") {
      d = Math.max(d, 18);
      raw = Math.max(Number.isFinite(raw) ? raw : SURFACE_Y, SURFACE_Y + 1.4);
    }
    if (d < 4) return null;
    const real = Number.isFinite(raw) ? raw : terrainHeightAt(x, z, stations);
    const meshY = renderedTerrainHeightAt(opts.terrainMesh, x, z);
    const coarse = Number.isFinite(meshY) && meshY > SURFACE_Y - 4 ? meshY : NaN;
    const y = channelBankY(d, real, coarse, SURFACE_Y, blendStart, outerD);
    return y >= SURFACE_Y + 0.2 ? y : null;
  };

  for (const ot of osmTrees) {
    if (isOpenWater(ot.x, ot.z)) continue;
    if (blocked(ot.x, ot.z, nearBuilding, nearRoad, stations, true, true)) continue;
    const rawY = groundY(ot.x, ot.z);
    if (rawY == null) continue;
    const h = ot.tree_height || 8;
    const assetId = classifyTreeAsset(ot, "osm", rng);
    const scale = Math.max(0.45, Math.min(2.6, h / 8));
    const placement = {
      x: ot.x,
      z: ot.z,
      y: rawY,
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
        source: ot.source || "OPENSTREETMAP",
        from_tree_row: !!ot.from_tree_row,
        genus: ot.genus,
        species: ot.species,
        assetId,
      },
    };
    placements.push(placement);
    pickables.push(placement);
  }

  // Add visual trees to Naik Bet (around chainage 0+700–1+980). Use denser
  // placement in classified forest and lighter, scattered planting on its
  // barren/open land so the plain gains trees without becoming a solid canopy.
  const forestCanopy = [];
  const stationGap =
    stations.length > 1
      ? Math.hypot(stations[1].x - stations[0].x, stations[1].z - stations[0].z) || 12
      : 12;
  const forestSpacing = 14;
  const forestAlongStep = Math.max(1, Math.round(forestSpacing / stationGap));
  const mappedTreeCount = placements.filter((p) => p.kind === "osm").length;
  const forestBudget = Math.max(0, maxTrees - mappedTreeCount);
  for (let i = 0; i < stations.length && forestCanopy.length < forestBudget; i += forestAlongStep) {
    const st = stations[i];
    const chainage = Number(st.chainage_m);
    if (chainage < 700 || chainage > 1980) continue;
    const px = -st.flowZ;
    const pz = st.flowX;
    const half = Math.max(8, Number(st.halfWidth) || 20);
    const maxOffset = half + 220;
    for (let dist = -maxOffset; dist <= maxOffset && forestCanopy.length < forestBudget; dist += forestSpacing) {
      const alongJitter = (rng() - 0.5) * forestSpacing * 0.5;
      const bankJitter = (rng() - 0.5) * forestSpacing * 0.5;
      const x = st.x + px * (dist + bankJitter) + st.flowX * alongJitter;
      const z = st.z + pz * (dist + bankJitter) + st.flowZ * alongJitter;
      const cover = lulc?.classAtLocal?.(x, z);
      if (cover !== "forest" && cover !== "barren") continue;
      // Naik Bet land pixels may sit under the centerline's broad water ribbon;
      // groundY restores their mapped land elevation before placement.
      const keepChance = cover === "forest" ? 0.68 : 0.2;
      if (rng() > keepChance) continue;
      if (blocked(x, z, nearBuilding, nearRoad, stations, false, true)) continue;
      const y = groundY(x, z);
      if (y == null) continue;
      forestCanopy.push({
        x,
        z,
        y,
        scale: 0.85 + rng() * 0.35,
        rotY: rng() * Math.PI * 2,
        assetId: classifyTreeAsset({}, "forest", rng),
        kind: "naikForest",
      });
    }
  }
  for (const poly of green) {
    const polyOsmId = String(poly.id || poly.osmId || "");
    if (polyOsmId.includes("61458970")) continue;
    const props = poly;
    const areaHint = polygonArea(poly.vertices);
    const dense = props.natural === "wood" || props.landuse === "forest";
    const targetSpacing = dense ? 6.5 : 16;
    const maxForPoly = dense ? (maxTrees < 3000 ? 220 : 700) : (maxTrees < 3000 ? 60 : 180);
    const count = Math.min(
      maxForPoly,
      Math.max(8, Math.floor(areaHint / (targetSpacing * targetSpacing))),
    );
    for (let i = 0; i < count; i++) {
      const p = randomInPolygon(poly.vertices, rng);
      if (!p) continue;
      if (isOpenWater(p.x, p.z)) continue;
      if (blocked(p.x, p.z, nearBuilding, nearRoad, stations, false, true)) continue;
      const bank = nearest(p.x, p.z, stations);
      if (dataset.lite && bank.lat > bank.half + RIVER_SIDE_M) continue;
      const rawY = groundY(p.x, p.z);
      if (rawY == null) continue;
      const assetId = classifyTreeAsset(props, dense ? "forest" : "park", rng);
      const h = 7.5 + rng() * 6.5;
      const ll = dataset.frame ? dataset.frame.toLonLat(p.x, p.z) : null;
      const treePlacement = {
        x: p.x,
        z: p.z,
        y: rawY,
        scale: 0.95 + rng() * 1.5,
        rotY: rng() * Math.PI * 2,
        assetId,
        kind: dense ? "forest" : "park",
        meta: {
          type: "land-cover vegetation",
          osmId: props.id || props.osmId || `vegetation_${placements.length}`,
          name: props.name || (dense ? "Mapped forest cover" : "Mapped green area"),
          source: "LAND_COVER_DERIVED_VISUAL",
          species: null,
          genus: null,
          height: Math.round(h * 10) / 10,
          height_source: "VISUAL_ESTIMATE",
          lon: ll?.lon,
          lat: ll?.lat,
          assetId,
        },
      };
      placements.push(treePlacement);
      pickables.push(treePlacement);
    }
  }

  // Keep mapped tree points ahead of area-derived instances when the device's
  // budget is reached. No continuous bank rows are fabricated.
  const mappedTrees = placements.filter((p) => p.kind === "osm");
  const areaDerived = placements.filter((p) => p.kind !== "osm");
  const capped = mappedTrees.concat(forestCanopy, areaDerived).slice(0, maxTrees);
  for (const p of capped) {
    if (p.y == null) {
      p.y = terrainHeightAt(p.x, p.z, stations) || SURFACE_Y + 0.5;
    }
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
    const mat = proto.material.clone();
    const mesh = new THREE.InstancedMesh(proto.geometry, mat, list.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    mesh.name = `trees:${assetId}`;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const targetH = treeTargetHeight(assetId, p.scale);
      const uniform = targetH / Math.max(0.5, proto.nativeH);
      const crown = p.kind === "naikForest" ? 1.25 : p.kind === "forest" ? 1.7 : 1;
      // Enlarge crowns modestly only inside mapped forest patches.
      dummy.position.set(p.x, (p.y || 0) + 0.35, p.z);
      dummy.rotation.set(0, p.rotY, 0);
      dummy.scale.set(uniform * crown, uniform, uniform * crown);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const hue = (p.x * 0.001 + p.z * 0.0013) % 1;
      if (mat.vertexColors) {
        color.setRGB(0.92 + hue * 0.08, 0.97, 0.9 + hue * 0.06);
      } else if (p.kind === "forest" || p.kind === "naikForest") {
        // Darker canopy within mapped forest polygons.
        color.set(foliageHex(assetId)).offsetHSL((hue - 0.5) * 0.03, 0.08, -0.08);
      } else {
        color.set(foliageHex(assetId)).offsetHSL((hue - 0.5) * 0.05, 0.04, (hue - 0.5) * 0.03);
      }
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere?.();
    group.add(mesh);
  }

  // Procedural fallback if GLBs missing
  if (!byAsset.size) {
    console.warn("[vegetation] GLB prototypes missing — using procedural trees", {
      placements: capped.length,
      osmTrees: osmTrees.length,
      green: green.length,
    });
    group.add(createProceduralFallback(capped.length ? capped : [{ x: 0, z: 0, y: 0, scale: 1, rotY: 0, kind: "park" }], stations, rng));
  }

  group.userData.pickables = pickables;
  group.userData.treeCount = capped.length;
  group.userData.glbAssets = [...byAsset.keys()];
  return group;
}

function createProceduralFallback(trees, stations, rng) {
  const n = Math.max(1, trees.length);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 3.2, 6);
  trunkGeo.translate(0, 1.6, 0);
  const canopyGeo = new THREE.SphereGeometry(1.85, 9, 7);
  canopyGeo.scale(1.15, 1.05, 1.1);
  canopyGeo.translate(0, 4.4, 0);
  const trunks = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({
      color: "#5c4638",
      roughness: 0.95,
      metalness: 0,
      vertexColors: false,
    }),
    n,
  );
  const canopy = new THREE.InstancedMesh(
    canopyGeo,
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.78,
      metalness: 0,
      emissive: "#5aaa4a",
      emissiveIntensity: 0.28,
      vertexColors: false,
      side: THREE.DoubleSide,
    }),
    n,
  );
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    dummy.position.set(t.x, t.y ?? terrainHeightAt(t.x, t.z, stations), t.z);
    dummy.rotation.y = t.rotY || 0;
    dummy.scale.setScalar(t.scale || 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    canopy.setMatrixAt(i, dummy.matrix);
    color.set("#5aaa4a").offsetHSL((rng() - 0.5) * 0.06, 0.04, (rng() - 0.5) * 0.04);
    canopy.setColorAt(i, color);
  }
  trunks.count = trees.length;
  canopy.count = trees.length;
  trunks.instanceMatrix.needsUpdate = true;
  canopy.instanceMatrix.needsUpdate = true;
  if (canopy.instanceColor) canopy.instanceColor.needsUpdate = true;
  const g = new THREE.Group();
  g.add(trunks);
  g.add(canopy);
  return g;
}

/** Darken the grass strip beside the channel so the bank reads as forest floor. Heights stay unchanged. */
function blocked(x, z, nearBuilding, nearRoad, stations, allowNearRoad = false, isLandOrIsland = false) {
  if (!isLandOrIsland) {
    const near = nearest(x, z, stations);
    if (near.lat < near.half + 4) return true;
  }
  if (nearBuilding(x, z)) return true;
  if (!allowNearRoad && nearRoad(x, z)) return true;
  return false;
}

/** Build a small point-proximity index so dense forest sampling avoids O(n) scans per tree. */
function createProximityTest(features, radiusFor, cellSize = 32) {
  const cells = new Map();
  const key = (x, z) => `${x}:${z}`;
  for (const feature of features) {
    const x = Number(feature.midX);
    const z = Number(feature.midZ);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const radius = Math.max(0, Number(radiusFor(feature)) || 0);
    const minX = Math.floor((x - radius) / cellSize);
    const maxX = Math.floor((x + radius) / cellSize);
    const minZ = Math.floor((z - radius) / cellSize);
    const maxZ = Math.floor((z + radius) / cellSize);
    const entry = { x, z, radius };
    for (let gx = minX; gx <= maxX; gx++) {
      for (let gz = minZ; gz <= maxZ; gz++) {
        const k = key(gx, gz);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(entry);
      }
    }
  }
  return (x, z) => {
    const bucket = cells.get(key(Math.floor(x / cellSize), Math.floor(z / cellSize)));
    if (!bucket) return false;
    for (const feature of bucket) {
      if (Math.hypot(feature.x - x, feature.z - z) < feature.radius) return true;
    }
    return false;
  };
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
  if (!verts?.length) return 0;
  let a = 0;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const vi = verts[i];
    const vj = verts[j];
    if (!vi || !vj) continue;
    a += vj.x * vi.z - vi.x * vj.z;
  }
  return Math.abs(a) * 0.5;
}

function randomInPolygon(verts, rng) {
  if (!verts?.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of verts) {
    if (!v) continue;
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
    if (!ring[i] || !ring[j]) continue;
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
