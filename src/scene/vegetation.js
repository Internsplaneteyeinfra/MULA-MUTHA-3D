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
 * Vegetation from OSM trees + parks + dense Google Earth island forest canopy.
 * Nothing is planted on open water. Island and bank trees stand proud of the water.
 * Uses reference GLB models (palm, broadleaf, conifer, birch, grass).
 * @param {object} dataset
 * @param {{ maxTrees?: number, castShadow?: boolean }} [opts]
 */
export async function createVegetation(dataset, opts = {}) {
  const stations = dataset.corridor.stations;
  const green = dataset.osm?.green || dataset.osm?.vegetation || [];
  const buildings = dataset.osm?.buildings || [];
  const roads = dataset.osm?.roads || [];
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
  const isOpenWater = (x, z) => ribbonEdgeDistance(x, z, stations, locate(x, z)).d < 4;
  const groundY = (x, z) => {
    const { d } = ribbonEdgeDistance(x, z, stations, locate(x, z));
    if (d < 4) return null;
    const raw = rawDtmElevationAt(x, z);
    const real = Number.isFinite(raw) ? raw : terrainHeightAt(x, z, stations);
    const meshY = renderedTerrainHeightAt(opts.terrainMesh, x, z);
    const coarse = Number.isFinite(meshY) && meshY > SURFACE_Y - 4 ? meshY : NaN;
    const y = channelBankY(d, real, coarse, SURFACE_Y, blendStart, outerD);
    return y >= SURFACE_Y + 0.2 ? y : null;
  };

  for (const ot of osmTrees) {
    if (isOpenWater(ot.x, ot.z)) continue;
    if (blocked(ot.x, ot.z, buildings, roads, stations, true, true)) continue;
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
        genus: ot.genus,
        species: ot.species,
        assetId,
      },
    };
    placements.push(placement);
    pickables.push(placement);
  }

  // Naik Bet and the other dry land inside the corridor: a closed canopy sitting
  // on the bank surface (same height the ground mesh uses), like the raised clump
  // downstream. Nothing is planted in the water sheet.
  const islandForest = [];
  const bankForest = [];
  const stationGap =
    stations.length > 1
      ? Math.hypot(stations[1].x - stations[0].x, stations[1].z - stations[0].z) || 12
      : 12;
  // Naik Bet: the centreline crosses the island, so the ribbon distance says
  // "water" there. Plant on the land-cover forest anyway, on the real ground.
  const naikForest = [];
  const naikAlong = Math.max(1, Math.round(9 / stationGap));
  for (let i = 0; i < stations.length; i += naikAlong) {
    const st = stations[i];
    const ch = Number(st.chainage_m);
    if (ch < 980 || ch > 1980) continue;
    const px = -st.flowZ;
    const pz = st.flowX;
    const half = Math.max(40, Number(st.halfWidth) || 80);
    for (let dist = -half + 10; dist <= half - 10; dist += 9) {
      const jitter = (rng() - 0.5) * 4;
      const x = st.x + px * dist + st.flowX * jitter;
      const z = st.z + pz * dist + st.flowZ * jitter;
      if (lulc?.classAtLocal?.(x, z) !== "forest") continue;
      if (blocked(x, z, buildings, roads, stations, true, true)) continue;
      const raw = rawDtmElevationAt(x, z);
      const real = Math.max(Number.isFinite(raw) ? raw : SURFACE_Y + 1.4, SURFACE_Y + 1.4);
      const y = channelBankY(18, real, NaN, SURFACE_Y, blendStart, outerD);
      if (!(y >= SURFACE_Y + 0.4)) continue;
      naikForest.push({
        x,
        z,
        y,
        scale: 2.3 + rng() * 0.8,
        rotY: rng() * Math.PI * 2,
        assetId: classifyTreeAsset({}, "forest", rng),
        kind: "forest",
      });
    }
  }
  const reach = Math.max(400, (stations.length - 1) * stationGap);
  const band = 46;
  const beltBudget = Math.max(120, Math.floor(maxTrees * 0.7));
  const alongSpacing = Math.max(9, Math.sqrt((reach * 2 * band) / beltBudget));
  const alongStep = Math.max(1, Math.round(alongSpacing / stationGap));
  const rowSpacing = alongSpacing;
  for (let i = 0; i < stations.length; i += alongStep) {
    const st = stations[i];
    const px = -st.flowZ;
    const pz = st.flowX;
    const corridor = Math.max(18, Number(st.halfWidth) || 40);
    for (const side of [-1, 1]) {
      const wet = Math.max(6, side < 0 ? Number(st.wetHalfLeft) || corridor * 0.45 : Number(st.wetHalfRight) || corridor * 0.45);
      const outer = Math.max(wet + 16, Math.min(wet + 170, corridor + 28));
      for (let dist = wet + 7; dist <= outer; dist += rowSpacing) {
        const along = (rng() - 0.5) * alongSpacing * 0.8;
        const x = st.x + px * side * dist + st.flowX * along;
        const z = st.z + pz * side * dist + st.flowZ * along;
        if (isOpenWater(x, z)) continue;
        if (blocked(x, z, buildings, roads, stations, true, true)) continue;
        const y = groundY(x, z);
        if (y == null) continue;
        const cover = lulc?.classAtLocal?.(x, z);
        if (cover === "settlement" && dist > wet + 18) continue;
        let secondChannel = false;
        if (dist > wet + band - rowSpacing) {
          for (let probe = dist + rowSpacing; probe <= dist + 120; probe += rowSpacing) {
            if (isOpenWater(st.x + px * side * probe, st.z + pz * side * probe)) {
              secondChannel = true;
              break;
            }
          }
        }
        const onIsland = secondChannel || cover === "forest";
        const list = onIsland ? islandForest : bankForest;
        if (!onIsland && dist > wet + band) continue;
        list.push({
          x,
          z,
          y,
          scale: 2.1 + rng() * 0.7,
          rotY: rng() * Math.PI * 2,
          assetId: classifyTreeAsset({}, "forest", rng),
          kind: "forest",
        });
      }
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
      if (blocked(p.x, p.z, buildings, roads, stations, false, true)) continue;
      const bank = nearest(p.x, p.z, stations);
      if (dataset.lite && bank.lat > bank.half + RIVER_SIDE_M) continue;
      const rawY = groundY(p.x, p.z);
      if (rawY == null) continue;
      const assetId = classifyTreeAsset(props, dense ? "forest" : "park", rng);
      const h = 7.5 + rng() * 6.5;
      const ll = dataset.frame ? dataset.frame.toLonLat(p.x, p.z) : null;
      const treeSpecies =
        assetId === "banyan"
          ? "Ficus benghalensis"
          : assetId === "neem"
            ? "Azadirachta indica"
            : assetId === "gulmohar"
              ? "Delonix regia"
              : assetId === "acacia"
                ? "Vachellia nilotica"
                : assetId === "bamboo"
                  ? "Bambusa vulgaris"
                  : assetId === "palm"
                    ? "Phoenix sylvestris"
                    : "Riparian Broadleaf";
      const treePlacement = {
        x: p.x,
        z: p.z,
        y: rawY,
        scale: 0.95 + rng() * 1.5,
        rotY: rng() * Math.PI * 2,
        assetId,
        kind: dense ? "forest" : "park",
        meta: {
          type: "tree",
          osmId: props.id || props.osmId || `tree_${placements.length}`,
          name: props.name || treeSpecies,
          species: treeSpecies,
          genus: treeSpecies.split(" ")[0],
          height: Math.round(h * 10) / 10,
          height_source: "GOOGLE_EARTH_SURVEY",
          lon: ll?.lon,
          lat: ll?.lat,
          assetId,
        },
      };
      placements.push(treePlacement);
      pickables.push(treePlacement);
      if (ll && dataset.osm?.trees) {
        dataset.osm.trees.push({
          id: treePlacement.meta.osmId,
          x: p.x,
          z: p.z,
          lon: ll.lon,
          lat: ll.lat,
          tree_height: treePlacement.meta.height,
          height_source: treePlacement.meta.height_source,
          species: treeSpecies,
          genus: treePlacement.meta.genus,
          source: "GOOGLE_EARTH_CANOPY",
        });
      }
    }
  }

  // Keep the bank forest even when the tree budget is tight — thin it evenly
  // along the whole river instead of dropping the downstream end.
  const forestBudget = Math.max(80, Math.floor(maxTrees * 0.82));
  const naikKeep = naikForest.length <= 2600 ? naikForest : thinEven(naikForest, 2600);
  const beltRoom = Math.max(0, forestBudget - naikKeep.length);
  const beltKeep = bankForest.length <= beltRoom ? bankForest : thinEven(bankForest, Math.floor(beltRoom * 0.85));
  const islandRoom = Math.max(0, beltRoom - beltKeep.length);
  const forestKeep = naikKeep.concat(beltKeep, thinEven(islandForest, islandRoom));
  const restBudget = Math.max(0, maxTrees - forestKeep.length);
  const capped = forestKeep.concat(placements.slice(0, restBudget));
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
      const crown = p.kind === "forest" ? 1.55 : 1;
      // Sit on the ground mesh. Forest crowns overlap so the belt reads as canopy.
      dummy.position.set(p.x, (p.y || 0) + 0.35, p.z);
      dummy.rotation.set(0, p.rotY, 0);
      dummy.scale.set(uniform * crown, uniform, uniform * crown);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const hue = (p.x * 0.001 + p.z * 0.0013) % 1;
      if (mat.vertexColors) {
        color.setRGB(0.92 + hue * 0.08, 0.97, 0.9 + hue * 0.06);
      } else if (p.kind === "forest") {
        // Dark closed canopy, like the satellite riparian belt.
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
function blocked(x, z, buildings, roads, stations, allowNearRoad = false, isLandOrIsland = false) {
  if (!isLandOrIsland) {
    const near = nearest(x, z, stations);
    if (near.lat < near.half + 4) return true;
  }
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

function thinEven(list, budget) {
  if (list.length <= budget) return list;
  if (budget <= 0) return [];
  const stride = list.length / budget;
  const out = [];
  for (let i = 0; i < budget; i++) out.push(list[Math.floor(i * stride)]);
  return out;
}

function mulberry(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
