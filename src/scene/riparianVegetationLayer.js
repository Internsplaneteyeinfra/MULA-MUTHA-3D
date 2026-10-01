import * as THREE from "three";
import { lonLatToLocal, localToLonLat } from "../geo/geoReference.js";
import { SURFACE_Y } from "./river.js";
import { preloadTreeAssets, foliageHex } from "./treeRegistry.js";
import { treeTargetHeight } from "./treeOrient.js";
import { loadLulcClassGrid } from "../geo/lulcRaster.js";
import { nearestStation, lateralDistToCenterline } from "../features/fishing/FishingZoneSystem.js";

const FOREST = 1;
const BANK = 2;
/** A cell is kept only when most of its neighbours are land too (drops water-edge speckle). */
const MIN_LAND_NEIGHBOURS = 2;
const MIN_CLUSTER_M2 = 3000;
/** Cells this close to a surveyed bathymetry point (≈12 m grid) are wetted channel and stay water. */
const WATER_CLEAR_M = 9;
export const RIPARIAN_LABEL_MIN_M2 = 10000;
/**
 * Hydrologic continuity: a land strip lying on a path shorter than MAX_CROSSING_M between two
 * separate open-water bodies (each ≥ MIN_WATER_BODY_M2) inside the river polygon would sever the
 * river corridor. Those cells keep their LULC colour but sit just under the water surface
 * (no trees), so the channel stays continuous.
 */
const MAX_CROSSING_M = 80;
const MIN_WATER_BODY_M2 = 2000;
const SUBMERGED_Y = -0.4;
const EDGE_Y = -0.15;
const INTERIOR_Y = 0.3;
const CROWN_Y = 0.35;
const TREE_CHANCE = 0.12;
const UNDERGROWTH_CHANCE = 0.22;
const DEFAULT_MAX_TREES = 2600;

/**
 * Land inside the river polygon where the LULC raster (the 2D LULC layer's source)
 * says Forest or other land and no bathymetry observation lies nearby. The polygon is
 * coarser than the LULC water class, so without this those cells render as open water.
 * Forest cells carry trees; Barren / Crop / Settlements cells are bare bank.
 *
 * @param {object} dataset
 * @param {{ maxTrees?: number, castShadow?: boolean }} [opts]
 */
export async function createRiparianVegetationLayer(dataset, opts = {}) {
  const group = new THREE.Group();
  group.name = "riparianVegetation";
  group.userData = { clusters: [], syncToWater: () => {}, dispose: () => {} };

  const ring = dataset.ringLocal;
  const stations = dataset.corridor?.stations || [];
  if (!ring?.length || !stations.length) return group;

  const lulc = await loadLulcClassGrid();
  const cells = detectLandCells(ring, dataset.points || [], lulc, stations);
  /** Along-river spans where LULC land would sever the channel (drawn under the water surface). */
  group.userData.crossings = cells.crossings;
  const clusters = clusterCells(cells).filter((c) => c.cells.length * cells.cellArea >= MIN_CLUSTER_M2);
  if (!clusters.length) return group;

  const maxTrees = Math.max(200, Number(opts.maxTrees) || DEFAULT_MAX_TREES);
  const forestCells = clusters.reduce((s, c) => s + c.cells.filter((x) => x.kind === FOREST && !x.submerged).length, 0);
  const treeChance = Math.min(TREE_CHANCE, (maxTrees / Math.max(1, forestCells)) * 0.85);
  const rng = mulberry(0x51a7e5);
  const landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });

  const placements = [];
  for (const cluster of clusters) {
    const sub = new THREE.Group();
    sub.name = "riparianCluster";
    // No artificial island mesh is generated. Vegetation polygon is ONLY a mask.
    const forest = cluster.cells.filter((c) => c.kind === FOREST && !c.submerged);
    const raised = cluster.cells.filter((c) => !c.submerged);
    const labelCells = forest.length ? forest : raised.length ? raised : cluster.cells;
    const centre = labelCells.reduce((a, c) => ({ x: a.x + c.x, z: a.z + c.z }), { x: 0, z: 0 });
    centre.x /= labelCells.length;
    centre.z /= labelCells.length;
    let anchor = labelCells[0];
    let best = Infinity;
    for (const c of labelCells) {
      const d = (c.x - centre.x) ** 2 + (c.z - centre.z) ** 2 - c.depth * 400;
      if (d < best) { best = d; anchor = c; }
    }
    const probe = [];
    const probeStep = Math.max(1, Math.floor(labelCells.length / 120));
    for (let i = 0; i < labelCells.length; i += probeStep) probe.push(labelCells[i]);

    const info = {
      group: sub,
      /** Forest (vegetated) area — drives the RIPARIAN / VEGETATED AREA label. */
      areaM2: Math.round(forest.length * cells.cellArea),
      landM2: Math.round(cluster.cells.length * cells.cellArea),
      id: group.userData.clusters.length,
      surfaceVertex: null,
      anchor: new THREE.Vector3(anchor.x, SURFACE_Y + INTERIOR_Y + 6, anchor.z),
      probe,
      waterOffset: 0,
    };
    group.userData.clusters.push(info);

    for (const c of cluster.cells) {
      if (c.kind !== FOREST) continue;
      const p = cells.cornerLocal(c.i + 0.5, c.j + 0.5);
      const baseY = dataset.dtm?.sampleSceneXY?.(p.x, p.z) ?? (SURFACE_Y + 1);
      // Spacing follows how deep the cell sits inside forest. Edges and mixed
      // margins stay open; the interior is vegetation, not a planted grid.
      const local = c.depth >= 4 ? 1 : c.depth >= 2 ? 0.45 : 0.16;
      if (rng() >= treeChance * local) continue;
      const asset = c.depth >= 2 ? riparianTreeAsset(rng) : (rng() < 0.45 ? "grass" : riparianTreeAsset(rng));
      placements.push(treePlacement(c, cells, baseY, stations, info, asset, rng));
    }
  }

  const batches = await buildTreeBatches(placements.slice(0, maxTrees + 800), !!opts.castShadow, rng);
  for (const b of batches) b.info.group.add(b.mesh);

  /** Keep each patch just above the drawn water: follow the nearest river-surface vertex (flood rise excluded by caller). */
  group.userData.syncToWater = (surfaceMesh, floodRiseM = 0) => {
    const pos = surfaceMesh?.geometry?.getAttribute?.("position");
    if (!pos) return;
    for (const info of group.userData.clusters) {
      if (info.surfaceVertex == null || info.surfaceVertex >= pos.count) {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < pos.count; i++) {
          const d = (pos.getX(i) - info.anchor.x) ** 2 + (pos.getZ(i) - info.anchor.z) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
        info.surfaceVertex = best;
      }
      const y = pos.getY(info.surfaceVertex) - Math.max(0, Number(floodRiseM) || 0);
      if (!Number.isFinite(y)) continue;
      const off = y - SURFACE_Y;
      if (Math.abs(off - info.waterOffset) < 0.02) continue;
      info.waterOffset = off;
      info.group.position.y = off;
    }
  };
  group.userData.dispose = () => {
    landMat.dispose();
    group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (o.isInstancedMesh) o.material?.dispose?.();
      }
    });
    group.clear();
  };

  if (import.meta.env?.DEV) {
    console.info("[riparian] LULC land inside river polygon", group.userData.clusters.map((c) => ({
      forestM2: c.areaM2,
      landM2: c.landM2,
      lonLat: localToLonLat(c.anchor.x, c.anchor.z),
    })), { trees: placements.length, channelCrossings: cells.crossings });
  }
  return group;
}

/**
 * Mark LULC land cells (Forest → 1, Barren / Crop / Settlements → 2) whose centre lies
 * inside the river ring and away from any surveyed depth point. One cell = one decoded
 * LULC pixel; cell corners go lon/lat → canonical local frame.
 */
function detectLandCells(ring, depthPoints, lulc, stations) {
  const { west, east, north, south } = lulc.bounds;
  const W = lulc.width;
  const H = lulc.height;
  const toPx = (lon, lat) => ({ px: ((lon - west) / (east - west)) * W, py: ((north - lat) / (north - south)) * H });
  const toLonLat = (px, py) => ({ lon: west + (px / W) * (east - west), lat: north - (py / H) * (north - south) });

  const ringPx = ring.map((p) => {
    const ll = localToLonLat(p.x, p.z);
    return toPx(ll.lon, ll.lat);
  });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of ringPx) {
    minX = Math.min(minX, p.px); maxX = Math.max(maxX, p.px);
    minY = Math.min(minY, p.py); maxY = Math.max(maxY, p.py);
  }
  const px0 = Math.max(0, Math.floor(minX) - 1);
  const py0 = Math.max(0, Math.floor(minY) - 1);
  const gw = Math.max(1, Math.min(W, Math.ceil(maxX) + 1) - px0);
  const gh = Math.max(1, Math.min(H, Math.ceil(maxY) + 1) - py0);

  const mask = document.createElement("canvas");
  mask.width = gw;
  mask.height = gh;
  const mctx = mask.getContext("2d", { willReadFrequently: true });
  mctx.fillStyle = "#fff";
  mctx.beginPath();
  ringPx.forEach((p, i) => {
    if (i === 0) mctx.moveTo(p.px - px0, p.py - py0); else mctx.lineTo(p.px - px0, p.py - py0);
  });
  mctx.closePath();
  mctx.fill();
  const inRing = mctx.getImageData(0, 0, gw, gh).data;

  const land = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      if (inRing[(j * gw + i) * 4 + 3] < 128) continue;
      const ll = toLonLat(px0 + i + 0.5, py0 + j + 0.5);
      const cls = lulc.classAtLonLat(ll.lon, ll.lat);
      if (cls === "forest") land[j * gw + i] = FOREST;
      else if (cls === "barren" || cls === "crop" || cls === "settlement") land[j * gw + i] = BANK;
    }
  }

  const cornerLocal = (ci, cj) => {
    const ll = toLonLat(px0 + ci, py0 + cj);
    return lonLatToLocal(ll.lon, ll.lat);
  };

  // Footprint is the LULC class itself. Bathymetry points and the corridor polygon
  // do not erase forest, barren, crop, or settlement.
  const keep = new Uint8Array(gw * gh);
  for (let j = 1; j < gh - 1; j++) {
    for (let i = 1; i < gw - 1; i++) {
      if (!land[j * gw + i]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && land[(j + dy) * gw + i + dx]) n++;
      if (n >= MIN_LAND_NEIGHBOURS) keep[j * gw + i] = land[j * gw + i];
    }
  }
  const a = cornerLocal(0, 0);
  const b = cornerLocal(1, 1);
  const cellArea = Math.abs((b.x - a.x) * (b.z - a.z));
  const centreCells = [];
  for (const s of stations) {
    const ll = localToLonLat(s.x, s.z);
    const p = toPx(ll.lon, ll.lat);
    const i = Math.floor(p.px) - px0;
    const j = Math.floor(p.py) - py0;
    if (i >= 0 && j >= 0 && i < gw && j < gh) centreCells.push(j * gw + i);
  }
  // Land stays land. Water is clipped out of the water mesh instead of sinking the island.
  const submerged = new Uint8Array(gw * gh);
  return { gw, gh, keep, submerged, crossings: [], cornerLocal, cellArea };
}

/**
 * Land cells on a short land path (< MAX_CROSSING_M) between two separate open-water bodies
 * that both lie on the river centreline. LULC is not changed — only how those cells are drawn.
 */
function markChannelCrossings(grid, inRing, centreCells) {
  const { gw, gh, keep, cornerLocal, cellArea } = grid;
  const N = gw * gh;
  const submerged = new Uint8Array(N);
  const ringAt = (k) => inRing[k * 4 + 3] >= 128;
  const cellM = Math.sqrt(cellArea) || 10;
  const maxSteps = Math.ceil(MAX_CROSSING_M / cellM) + 1;

  // Open-water bodies: 8-connected in-ring cells that are not drawn as land.
  const body = new Int32Array(N).fill(-1);
  const bodySize = [];
  for (let s = 0; s < N; s++) {
    if (body[s] >= 0 || keep[s] || !ringAt(s)) continue;
    const id = bodySize.length;
    let size = 0;
    const stack = [s];
    body[s] = id;
    while (stack.length) {
      const k = stack.pop();
      size++;
      const i = k % gw;
      const j = (k / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = i + dx;
          const nj = j + dy;
          if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
          const nk = nj * gw + ni;
          if (body[nk] < 0 && !keep[nk] && ringAt(nk)) { body[nk] = id; stack.push(nk); }
        }
      }
    }
    bodySize.push(size);
  }
  const onCentreline = new Uint8Array(bodySize.length);
  for (const c of centreCells) {
    const i = c % gw;
    const j = (c / gw) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ni = i + dx;
        const nj = j + dy;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        const id = body[nj * gw + ni];
        if (id >= 0) onCentreline[id] = 1;
      }
    }
  }
  const significant = bodySize.map((n, id) => onCentreline[id] === 1 && n * cellArea >= MIN_WATER_BODY_M2);
  if (significant.filter(Boolean).length < 2) return { submerged, crossings: [] };

  // Multi-source BFS over land from every significant body; each land cell keeps its two nearest distinct bodies.
  const b1 = new Int32Array(N).fill(-1);
  const d1 = new Uint16Array(N);
  const b2 = new Int32Array(N).fill(-1);
  const d2 = new Uint16Array(N);
  let frontier = [];
  for (let k = 0; k < N; k++) {
    if (body[k] < 0 || !significant[body[k]]) continue;
    const i = k % gw;
    const j = (k / gw) | 0;
    for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
      frontier.push(nj * gw + ni, body[k]);
    }
  }
  for (let d = 1; d <= maxSteps && frontier.length; d++) {
    const next = [];
    for (let f = 0; f < frontier.length; f += 2) {
      const k = frontier[f];
      const id = frontier[f + 1];
      if (!keep[k] || !ringAt(k)) continue;
      if (b1[k] === id || b2[k] === id) continue;
      if (b1[k] < 0) { b1[k] = id; d1[k] = d; }
      else if (b2[k] < 0) { b2[k] = id; d2[k] = d; }
      else continue;
      const i = k % gw;
      const j = (k / gw) | 0;
      for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
        next.push(nj * gw + ni, id);
      }
    }
    frontier = next;
  }

  const gap = [];
  for (let k = 0; k < N; k++) {
    if (b2[k] >= 0 && d1[k] + d2[k] <= maxSteps) { submerged[k] = 1; gap.push(k); }
  }

  // Group crossing cells for reporting (8-connected), in local metres.
  const seen = new Uint8Array(N);
  const crossings = [];
  for (const s of gap) {
    if (seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let n = 0, sx = 0, sz = 0;
    while (stack.length) {
      const k = stack.pop();
      const p = cornerLocal((k % gw) + 0.5, ((k / gw) | 0) + 0.5);
      n++; sx += p.x; sz += p.z;
      const i = k % gw;
      const j = (k / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nk = (j + dy) * gw + i + dx;
          if (nk >= 0 && nk < N && submerged[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
        }
      }
    }
    crossings.push({ x: sx / n, z: sz / n, cells: n, areaM2: Math.round(n * cellArea) });
  }
  return { submerged, crossings };
}
/** 8-connected components of kept cells, with each cell's distance (in cells) from the cluster edge. */
function clusterCells(grid) {
  const { gw, gh, keep, submerged, cornerLocal } = grid;
  const seen = new Uint8Array(gw * gh);
  const clusters = [];
  for (let start = 0; start < keep.length; start++) {
    if (!keep[start] || seen[start]) continue;
    const idx = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop();
      idx.push(k);
      const i = k % gw;
      const j = (k / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = i + dx;
          const nj = j + dy;
          if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
          const nk = nj * gw + ni;
          if (keep[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
        }
      }
    }
    const depth = new Map();
    let frontier = [];
    for (const k of idx) {
      const i = k % gw;
      const j = (k / gw) | 0;
      const edge = !keep[k - 1] || !keep[k + 1] || !keep[k - gw] || !keep[k + gw] || i === 0 || j === 0 || i === gw - 1 || j === gh - 1;
      if (edge) { depth.set(k, 0); frontier.push(k); }
    }
    for (let d = 1; frontier.length; d++) {
      const next = [];
      for (const k of frontier) {
        for (const nk of [k - 1, k + 1, k - gw, k + gw]) {
          if (keep[nk] && !depth.has(nk)) { depth.set(nk, d); next.push(nk); }
        }
      }
      frontier = next;
    }
    clusters.push({
      cells: idx.map((k) => {
        const i = k % gw;
        const j = (k / gw) | 0;
        const p = cornerLocal(i + 0.5, j + 0.5);
        return { k, i, j, x: p.x, z: p.z, depth: depth.get(k) ?? 0, kind: keep[k], submerged: submerged[k] === 1 };
      }),
    });
  }
  return clusters;
}



function treePlacement(c, grid, baseY, stations, info, assetId, rng) {
  const half = Math.sqrt(grid.cellArea) * 0.45;
  const x = c.x + (rng() - 0.5) * 2 * half;
  const z = c.z + (rng() - 0.5) * 2 * half;
  // Sit on the island surface. Using the surrounding DTM here lifts the canopy onto the banks
  // and hides the open water channel beside the island.
  const y = baseY;
  const scale = assetId === "grass" ? 0.7 + rng() * 0.7 : 0.85 + rng() * 0.35;
  const heightM = assetId === "grass" ? 1.4 + rng() * 1.2 : 6.5 + rng() * 4;
  return { x, y: y + 0.05, z, rotY: rng() * Math.PI * 2, scale, heightM, assetId, info };
}

function riparianTreeAsset(rng) {
  const r = rng();
  if (r < 0.62) return "broadleaf";
  if (r < 0.8) return "birch";
  if (r < 0.92) return "palm";
  return "conifer";
}

async function buildTreeBatches(placements, castShadow, rng) {
  const prototypes = await preloadTreeAssets(placements.map((p) => p.assetId));
  const groups = new Map();
  for (const p of placements) {
    if (!prototypes.has(p.assetId)) continue;
    const key = `${p.assetId}|${p.info.id}`;
    if (!groups.has(key)) groups.set(key, { assetId: p.assetId, info: p.info, list: [] });
    groups.get(key).list.push(p);
  }
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const out = [];
  for (const { assetId, info, list } of groups.values()) {
    const proto = prototypes.get(assetId);
    const mat = proto.material.clone();
    const vc = !!proto.geometry?.getAttribute?.("color");
    mat.vertexColors = vc;
    mat.color?.set?.(vc ? "#ffffff" : foliageHex(assetId));
    const mesh = new THREE.InstancedMesh(proto.geometry, mat, list.length);
    mesh.name = `riparian:${assetId}`;
    mesh.castShadow = castShadow;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rotY, 0);
      const targetH = Number.isFinite(p.heightM) ? p.heightM : treeTargetHeight(assetId, p.scale);
      dummy.scale.setScalar(targetH / Math.max(0.5, proto.nativeH));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (vc) color.setRGB(0.86 + rng() * 0.1, 0.92 + rng() * 0.06, 0.84 + rng() * 0.1);
      else color.set(foliageHex(assetId)).offsetHSL((rng() - 0.5) * 0.05, 0.03, (rng() - 0.5) * 0.05);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    out.push({ mesh, info });
  }
  return out;
}

function mulberry(a) {
  let seed = a >>> 0;
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
