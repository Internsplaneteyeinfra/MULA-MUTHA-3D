import * as THREE from "three";
import { lonLatToLocal, localToLonLat } from "../geo/geoReference.js";
import { terrainHeightAt } from "./terrain.js";
import { SURFACE_Y } from "./river.js";
import { preloadTreeAssets, foliageHex } from "./treeRegistry.js";
import { treeTargetHeight } from "./treeOrient.js";
import { VEGETATION_TYPE_LAYER } from "./vegetationTypeGrowLayer.js";

/** Raster pixels per analysis cell (overlay is ≈2.4 m/px → ≈4.7 m cells). */
const CELL_PX = 2;
/** "Trees" class colour as actually encoded in vegetation_type_overlay.png (legend #006400). */
const TREES_RGB = [0, 104, 0];
const TREES_TOL2 = 60 * 60;
/** A cell is kept only when most of its neighbours are trees too (drops bank-edge speckle). */
const MIN_TREE_NEIGHBOURS = 4;
const MIN_CLUSTER_M2 = 3000;
/** Cells this close to a surveyed bathymetry point (≈12 m grid) are wetted channel and stay water. */
const WATER_CLEAR_M = 9;
export const RIPARIAN_LABEL_MIN_M2 = 10000;
const EDGE_Y = -0.15;
const INTERIOR_Y = 0.3;
const CROWN_Y = 0.35;
const TREE_CHANCE = 0.3;
const UNDERGROWTH_CHANCE = 0.22;
const DEFAULT_MAX_TREES = 2600;

/**
 * Tree-covered land inside the river polygon, derived only from the project
 * Vegetation Type raster (Trees class) — islands / riparian bars that the
 * single-polygon water strip would otherwise render as open water.
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

  const cells = await detectTreeCells(ring, dataset.points || []);
  const clusters = clusterCells(cells).filter((c) => c.cells.length * cells.cellArea >= MIN_CLUSTER_M2);
  if (!clusters.length) return group;

  const maxTrees = Math.max(200, Number(opts.maxTrees) || DEFAULT_MAX_TREES);
  const totalCells = clusters.reduce((s, c) => s + c.cells.length, 0);
  const treeChance = Math.min(TREE_CHANCE, (maxTrees / Math.max(1, totalCells)) * 0.85);
  const rng = mulberry(0x51a7e5);
  const landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });

  const placements = [];
  for (const cluster of clusters) {
    const sub = new THREE.Group();
    sub.name = "riparianCluster";
    const land = buildLandMesh(cluster, cells, landMat, rng);
    sub.add(land.mesh);
    group.add(sub);

    const centre = cluster.cells.reduce((a, c) => ({ x: a.x + c.x, z: a.z + c.z }), { x: 0, z: 0 });
    centre.x /= cluster.cells.length;
    centre.z /= cluster.cells.length;
    let anchor = cluster.cells[0];
    let best = Infinity;
    for (const c of cluster.cells) {
      const d = (c.x - centre.x) ** 2 + (c.z - centre.z) ** 2 - c.depth * 400;
      if (d < best) { best = d; anchor = c; }
    }
    const probe = [];
    const probeStep = Math.max(1, Math.floor(cluster.cells.length / 120));
    for (let i = 0; i < cluster.cells.length; i += probeStep) probe.push(cluster.cells[i]);

    const info = {
      group: sub,
      areaM2: Math.round(cluster.cells.length * cells.cellArea),
      id: group.userData.clusters.length,
      surfaceVertex: null,
      anchor: new THREE.Vector3(anchor.x, SURFACE_Y + INTERIOR_Y + 6, anchor.z),
      probe,
      waterOffset: 0,
    };
    group.userData.clusters.push(info);

    for (const c of cluster.cells) {
      const baseY = land.cellY(c);
      const interior = c.depth >= 1;
      if (interior && rng() < treeChance) {
        placements.push(treePlacement(c, cells, baseY, stations, info, riparianTreeAsset(rng), rng));
      } else if (!interior && rng() < UNDERGROWTH_CHANCE) {
        placements.push(treePlacement(c, cells, baseY, stations, info, "grass", rng));
      }
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
    console.info("[riparian] tree-covered areas inside river polygon", group.userData.clusters.map((c) => ({
      areaM2: c.areaM2,
      lonLat: localToLonLat(c.anchor.x, c.anchor.z),
    })), { trees: placements.length });
  }
  return group;
}

/**
 * Decode the overlay once and mark Trees-class cells whose centre lies inside the
 * river ring and away from any surveyed depth point.
 */
async function detectTreeCells(ring, depthPoints) {
  const { west, east, north, south } = VEGETATION_TYPE_LAYER.bounds;
  const res = await fetch(new URL(VEGETATION_TYPE_LAYER.overlay, window.location.origin).href, { cache: "force-cache" });
  if (!res.ok) throw new Error(`vegetation_type overlay unavailable (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const W = bitmap.width;
  const H = bitmap.height;
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
  const px0 = Math.max(0, Math.floor(minX) - CELL_PX);
  const py0 = Math.max(0, Math.floor(minY) - CELL_PX);
  const px1 = Math.min(W, Math.ceil(maxX) + CELL_PX);
  const py1 = Math.min(H, Math.ceil(maxY) + CELL_PX);
  const gw = Math.max(1, Math.floor((px1 - px0) / CELL_PX));
  const gh = Math.max(1, Math.floor((py1 - py0) / CELL_PX));

  const img = document.createElement("canvas");
  img.width = gw * CELL_PX;
  img.height = gh * CELL_PX;
  const ictx = img.getContext("2d", { willReadFrequently: true });
  ictx.imageSmoothingEnabled = false;
  ictx.drawImage(bitmap, px0, py0, img.width, img.height, 0, 0, img.width, img.height);
  bitmap.close?.();
  const pix = ictx.getImageData(0, 0, img.width, img.height).data;

  const mask = document.createElement("canvas");
  mask.width = gw;
  mask.height = gh;
  const mctx = mask.getContext("2d", { willReadFrequently: true });
  mctx.fillStyle = "#fff";
  mctx.beginPath();
  ringPx.forEach((p, i) => {
    const x = (p.px - px0) / CELL_PX;
    const y = (p.py - py0) / CELL_PX;
    if (i === 0) mctx.moveTo(x, y); else mctx.lineTo(x, y);
  });
  mctx.closePath();
  mctx.fill();
  const inRing = mctx.getImageData(0, 0, gw, gh).data;

  const isTree = new Uint8Array(gw * gh);
  const iw = img.width;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      if (inRing[(j * gw + i) * 4 + 3] < 128) continue;
      let hits = 0;
      for (let dy = 0; dy < CELL_PX; dy++) {
        for (let dx = 0; dx < CELL_PX; dx++) {
          const k = ((j * CELL_PX + dy) * iw + i * CELL_PX + dx) * 4;
          if (pix[k + 3] < 40) continue;
          const d = (pix[k] - TREES_RGB[0]) ** 2 + (pix[k + 1] - TREES_RGB[1]) ** 2 + (pix[k + 2] - TREES_RGB[2]) ** 2;
          if (d <= TREES_TOL2) hits++;
        }
      }
      if (hits * 2 >= CELL_PX * CELL_PX) isTree[j * gw + i] = 1;
    }
  }

  const cornerLocal = (ci, cj) => {
    const ll = toLonLat(px0 + ci * CELL_PX, py0 + cj * CELL_PX);
    return lonLatToLocal(ll.lon, ll.lat);
  };

  const wet = new Map();
  for (const p of depthPoints) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    const key = `${Math.floor(p.x / WATER_CLEAR_M)},${Math.floor(p.z / WATER_CLEAR_M)}`;
    if (!wet.has(key)) wet.set(key, []);
    wet.get(key).push(p);
  }
  const nearWater = (x, z) => {
    const cx = Math.floor(x / WATER_CLEAR_M);
    const cz = Math.floor(z / WATER_CLEAR_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const p of wet.get(`${cx + dx},${cz + dz}`) || []) {
          if ((p.x - x) ** 2 + (p.z - z) ** 2 <= WATER_CLEAR_M ** 2) return true;
        }
      }
    }
    return false;
  };
  for (let k = 0; k < isTree.length; k++) {
    if (!isTree[k]) continue;
    const p = cornerLocal((k % gw) + 0.5, ((k / gw) | 0) + 0.5);
    if (nearWater(p.x, p.z)) isTree[k] = 0;
  }

  const keep = new Uint8Array(gw * gh);
  for (let j = 1; j < gh - 1; j++) {
    for (let i = 1; i < gw - 1; i++) {
      if (!isTree[j * gw + i]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && isTree[(j + dy) * gw + i + dx]) n++;
      if (n >= MIN_TREE_NEIGHBOURS) keep[j * gw + i] = 1;
    }
  }
  const a = cornerLocal(0, 0);
  const b = cornerLocal(1, 1);
  const cellArea = Math.abs((b.x - a.x) * (b.z - a.z));
  return { gw, gh, keep, cornerLocal, cellArea };
}

/** 8-connected components of kept cells, with each cell's distance (in cells) from the cluster edge. */
function clusterCells(grid) {
  const { gw, gh, keep, cornerLocal } = grid;
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
        return { k, i, j, x: p.x, z: p.z, depth: depth.get(k) ?? 0 };
      }),
    });
  }
  return clusters;
}

/** One shared-vertex grid mesh per cluster: shoreline corners dip under the water, interior rises gently. */
function buildLandMesh(cluster, grid, material, rng) {
  const { gw, cornerLocal } = grid;
  const cellDepth = new Map(cluster.cells.map((c) => [c.k, c.depth]));
  const cornerIndex = new Map();
  const positions = [];
  const colors = [];
  const cornerY = [];
  const index = [];
  const wet = new THREE.Color("#5a5038");
  const lush = new THREE.Color("#46592c");
  const col = new THREE.Color();

  const corner = (ci, cj) => {
    const key = cj * (gw + 1) + ci;
    let v = cornerIndex.get(key);
    if (v != null) return v;
    let n = 0;
    let dMin = Infinity;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const d = cellDepth.get((cj + dy) * gw + ci + dx);
      if (d != null) { n++; dMin = Math.min(dMin, d); }
    }
    const t = n < 4 ? 0 : Math.min(1, (dMin + 1) / 4);
    const y = SURFACE_Y + (n < 4 ? EDGE_Y : INTERIOR_Y + CROWN_Y * t + (rng() - 0.5) * 0.12);
    const p = cornerLocal(ci, cj);
    v = positions.length / 3;
    positions.push(p.x, y, p.z);
    col.copy(wet).lerp(lush, t).offsetHSL(0, 0, (rng() - 0.5) * 0.04);
    colors.push(col.r, col.g, col.b);
    cornerY.push(y);
    cornerIndex.set(key, v);
    return v;
  };

  for (const c of cluster.cells) {
    const a = corner(c.i, c.j);
    const b = corner(c.i + 1, c.j);
    const d = corner(c.i, c.j + 1);
    const e = corner(c.i + 1, c.j + 1);
    index.push(a, d, b, b, d, e);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  if (geo.getAttribute("normal").getY(0) < 0) {
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    geo.setIndex(index);
    geo.computeVertexNormals();
  }
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "riparianLand";
  mesh.receiveShadow = true;

  const cellY = (c) => {
    const ids = [
      cornerIndex.get(c.j * (gw + 1) + c.i),
      cornerIndex.get(c.j * (gw + 1) + c.i + 1),
      cornerIndex.get((c.j + 1) * (gw + 1) + c.i),
      cornerIndex.get((c.j + 1) * (gw + 1) + c.i + 1),
    ];
    return ids.reduce((s, v) => s + cornerY[v], 0) / 4;
  };
  return { mesh, cellY };
}

function treePlacement(c, grid, baseY, stations, info, assetId, rng) {
  const half = Math.sqrt(grid.cellArea) * 0.45;
  const x = c.x + (rng() - 0.5) * 2 * half;
  const z = c.z + (rng() - 0.5) * 2 * half;
  const ground = terrainHeightAt(x, z, stations);
  const y = Number.isFinite(ground) ? Math.max(ground, baseY) : baseY;
  const scale = assetId === "grass" ? 0.7 + rng() * 0.7 : 1.05 + rng() * 1.35;
  return { x, y: y + 0.05, z, rotY: rng() * Math.PI * 2, scale, assetId, info };
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
      dummy.scale.setScalar(treeTargetHeight(assetId, p.scale) / Math.max(0.5, proto.nativeH));
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
