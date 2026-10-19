import * as THREE from "three";
import { createWaterMaterial } from "./waterShader.js";
import { state } from "../state.js";
import { isObservedWater } from "../geo/osmWater.js";
import { spatialIndex, neighbors } from "../geo/corridor.js";

export const SURFACE_Y = 9.4;
/**
 * Extra stage above SURFACE_Y for normal (non-flood) viewing.
 * Keep at 0 so the blue sheet sits in the channel — a raised stage made
 * the ribbon float above the banks.
 */
export const BASE_WATER_STAGE_M = 0;
/** Minimum metres the riverbed stays below the water surface (prevents poke-through). */
const MIN_BED_SEPARATION = 0.45;

/** Legend scale for depth colour (matches WATER DEPTH UI: ~0.5–2.0 m). */
export const DEPTH_LEGEND_MIN = 0.5;
export const DEPTH_LEGEND_MAX = 2.0;

export function depthNorm(d, minD = DEPTH_LEGEND_MIN, maxD = DEPTH_LEGEND_MAX) {
  return THREE.MathUtils.clamp(
    (Number(d) - minD) / Math.max(0.001, maxD - minD),
    0,
    1,
  );
}

export function bedElevation(d, _minD, _maxD, acrossU, exag, waterY = SURFACE_Y) {
  // Surveyed depth relative to the active water plane; keep a minimum gap so
  // the bed never coplanar-z-fights or pokes through the surface.
  const depth = Math.max(Number(d) || 0, MIN_BED_SEPARATION);
  return waterY - depth * Math.max(1, exag);
}

/** Water surface stays at real elevation — exaggeration never moves it. */
export function surfaceElevation() {
  return SURFACE_Y;
}

export function createRiver(dataset) {
  const bath = dataset.bathymetry;
  const exag = state.depthExaggeration;
  const n = bath.depths.length;

  const surfPos = bath.positions.slice();
  const bedPos = bath.positions.slice();
  const bedCol = new Float32Array(n * 3);
  // Soft bed under translucent water (soil, not water-blue)
  const sand = new THREE.Color("#a89870");
  const silt = new THREE.Color("#6a5c44");
  const deepUnder = new THREE.Color("#3a3228");
  // River OFF — full ground / channel deep view (excavated earth — never blue)
  const groundShallow = new THREE.Color("#d2c4a0");
  const groundMid = new THREE.Color("#9a8458");
  const groundDeep = new THREE.Color("#4a3e30");
  const tmp = new THREE.Color();
  const depthViewCol = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    const d = bath.depths[i];
    const across = bath.acrossU?.[i] ?? 0.5;
    surfPos[i * 3 + 1] = SURFACE_Y;
    bedPos[i * 3 + 1] = bedElevation(d, dataset.minDepth, dataset.maxDepth, across, exag);
    // Colour by legend scale + bank (edges read shallow even when Excel depths are tight)
    const tExcel = depthNorm(d, dataset.minDepth, dataset.maxDepth);
    const bank = Math.abs(across * 2 - 1);
    const t = THREE.MathUtils.clamp(tExcel * (1 - bank * 0.35), 0, 1);
    // Soft bed under water
    const softT = THREE.MathUtils.smoothstep(0.05, 0.95, t) * 0.55;
    tmp.copy(sand).lerp(silt, softT);
    tmp.lerp(deepUnder, softT * 0.85);
    bedCol[i * 3] = tmp.r;
    bedCol[i * 3 + 1] = tmp.g;
    bedCol[i * 3 + 2] = tmp.b;
    // Ground deep view: shallow = light soil, deep = dark excavated bed
    tmp.copy(groundShallow).lerp(groundMid, THREE.MathUtils.smoothstep(0, 0.5, t));
    tmp.lerp(groundDeep, THREE.MathUtils.smoothstep(0.3, 1, t));
    depthViewCol[i * 3] = tmp.r;
    depthViewCol[i * 3 + 1] = tmp.g;
    depthViewCol[i * 3 + 2] = tmp.b;
  }

  const surfGeo = new THREE.BufferGeometry();
  surfGeo.setAttribute("position", new THREE.Float32BufferAttribute(surfPos, 3));
  surfGeo.setAttribute("aDepth", new THREE.Float32BufferAttribute(bath.depths, 1));
  surfGeo.setAttribute("aAlong", new THREE.Float32BufferAttribute(bath.alongT, 1));
  surfGeo.setAttribute("aAcross", new THREE.Float32BufferAttribute(bath.acrossU, 1));
  surfGeo.setAttribute("aFlow", new THREE.Float32BufferAttribute(bath.flow, 2));
  surfGeo.setAttribute("aNarrow", new THREE.Float32BufferAttribute(bath.narrow, 1));
  surfGeo.setAttribute("aWidth", new THREE.Float32BufferAttribute(bath.widthM, 1));
  surfGeo.setAttribute("aCurve", new THREE.Float32BufferAttribute(bath.curve, 1));
  surfGeo.setAttribute("aIsFlood", new THREE.Float32BufferAttribute(new Float32Array(n).fill(0), 1));
  surfGeo.setIndex(bath.indices);
  surfGeo.computeVertexNormals();

  const material = createWaterMaterial(dataset);
  const mesh = new THREE.Mesh(surfGeo, material);
  mesh.name = "riverSurface";
  mesh.renderOrder = 4;

  const bedGeo = new THREE.BufferGeometry();
  bedGeo.setAttribute("position", new THREE.Float32BufferAttribute(bedPos, 3));
  bedGeo.setAttribute("color", new THREE.Float32BufferAttribute(bedCol, 3));
  bedGeo.setAttribute("colorLand", new THREE.Float32BufferAttribute(bedCol.slice(), 3));
  bedGeo.setAttribute("colorDepthView", new THREE.Float32BufferAttribute(depthViewCol, 3));
  bedGeo.setAttribute("aDepth", new THREE.Float32BufferAttribute(bath.depths, 1));
  bedGeo.setAttribute("aAcross", new THREE.Float32BufferAttribute(bath.acrossU, 1));
  const cutCol = new Float32Array(n * 3);
  const cutShallow = new THREE.Color("#7eb8d8");
  const cutMid = new THREE.Color("#3d7aa8");
  const cutDeep = new THREE.Color("#1e4a72");
  for (let i = 0; i < n; i++) {
    const across = bath.acrossU?.[i] ?? 0.5;
    const tExcel = depthNorm(bath.depths[i], dataset.minDepth, dataset.maxDepth);
    const bank = Math.abs(across * 2 - 1);
    const t = THREE.MathUtils.clamp(tExcel * (1 - bank * 0.35), 0, 1);
    tmp.copy(cutShallow).lerp(cutMid, THREE.MathUtils.smoothstep(0, 0.55, t));
    tmp.lerp(cutDeep, THREE.MathUtils.smoothstep(0.35, 1, t));
    cutCol[i * 3] = tmp.r;
    cutCol[i * 3 + 1] = tmp.g;
    cutCol[i * 3 + 2] = tmp.b;
  }
  bedGeo.setAttribute("colorCut", new THREE.Float32BufferAttribute(cutCol, 3));
  bedGeo.setIndex(bath.indices);
  bedGeo.computeVertexNormals();
  const bedMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.04,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });

  const bed = new THREE.Mesh(bedGeo, bedMat);
  bed.name = "riverBed";
  bed.receiveShadow = true;
  bed.renderOrder = 1;

  const walls = createBoundaryWalls(bath, dataset, exag);
  walls.renderOrder = 2;

  // Optional wireframe debug (Layers → Projection Validation also shows KML)
  const wire = new THREE.Mesh(
    surfGeo.clone(),
    new THREE.MeshBasicMaterial({
      color: 0x44e0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
  wire.name = "riverWaterDebug";
  wire.visible = false;
  wire.renderOrder = 20;

  return { mesh, material, bed, walls, wire, bathymetry: bath };
}

/**
 * Rebuild water as a filled ribbon: hydrology wet-width at each station,
 * then a continuous left–right strip (no LULC sawtooth holes).
 *
 * @param {object} [jalnetraWater] — optional JalNetra permanent-water mask
 *   ({ isWaterAtLocal, depthAtLocal }) from POST /api/water-depth.
 *   When present it is the primary extent; LULC/OSM remain fallbacks.
 *   Bridge gaps (SAR miss) are fused to corridor halfWidth when neighbours are wet.
 */
export function clipRiverToHydrology(river, lulc, osmWater, dataset, jalnetraWater = null) {
  const stations = dataset?.corridor?.stations;
  if (!river?.mesh || !stations?.length) return;

  // Slightly denser across samples → smoother bank edge / fewer long triangles.
  const across = 36;
  const built = buildWetRibbon(stations, lulc, osmWater, dataset, across, jalnetraWater);
  if (!built) return;
  applyRibbonToRiver(river, dataset, built);
  console.info("[river] filled hydrology ribbon", {
    stations: stations.length,
    across,
    tris: built.indices.length / 3,
    osmPolygons: osmWater?.count ?? 0,
    jalnetra: !!jalnetraWater?.isWaterAtLocal,
  });
}

/**
 * Water test for ribbon edge.
 * When JalNetra SAR mask is present, use it alone (LULC/OSM over-widen the channel).
 */
function isRibbonWater(lulc, osmWater, jalnetraWater, x, z) {
  if (jalnetraWater?.isWaterAtLocal) {
    return !!jalnetraWater.isWaterAtLocal(x, z);
  }
  return isObservedWater(lulc, osmWater, x, z);
}

/**
 * @param {number} [bridgeHalfM] — neighbour SAR half-width used only under bridges
 */
function wetHalfWidth(st, dirX, dirZ, maxH, lulc, osmWater, jalnetraWater, fuseBridge, bridgeHalfM = 0) {
  const step = 2;
  let seen = false;
  let outer = 6;
  const hasApi = !!jalnetraWater?.isWaterAtLocal;
  // Cap search: with SAR, do not scan full corridor width (that floods banks).
  const searchMax = hasApi
    ? Math.min(maxH, Math.max(18, (Number(st.halfWidth) || 40) * 0.72))
    : maxH + 2;

  for (let d = 0; d <= searchMax; d += step) {
    const x = st.x + dirX * d;
    const z = st.z + dirZ * d;
    if (isRibbonWater(lulc, osmWater, jalnetraWater, x, z)) {
      seen = true;
      outer = d;
    } else if (seen && d > outer + 3) {
      break;
    }
  }

  const corridorHalf = Number(st.halfWidth);

  // Bridge gap only: thin fuse from neighbour SAR width — never full corridor.
  if (!seen && fuseBridge) {
    const fuse = Number.isFinite(bridgeHalfM) && bridgeHalfM > 4
      ? bridgeHalfM * 0.88
      : Number.isFinite(corridorHalf)
        ? corridorHalf * 0.45
        : 12;
    return THREE.MathUtils.clamp(fuse, 6, searchMax);
  }

  if (!seen) {
    // No SAR/LULC water — keep a narrow channel stub (not a wide flood sheet).
    const fallback = hasApi
      ? Math.min(12, (Number.isFinite(corridorHalf) ? corridorHalf : 24) * 0.35)
      : Number.isFinite(corridorHalf)
        ? corridorHalf * 0.55
        : maxH * 0.4;
    return THREE.MathUtils.clamp(fallback, 6, searchMax);
  }

  // Tight pad — match satellite water edge, do not inflate toward banks.
  const pad = hasApi ? 1.0 : 2.5;
  return THREE.MathUtils.clamp(outer + pad, 6, searchMax);
}

/** Distance from (px, pz) to segment a–b in the XZ plane. */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz || 1e-9;
  const t = THREE.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/**
 * Stations whose centreline point lies under a bridge deck get the width interpolated from the
 * nearest stations outside the deck on each side (never narrower than what was measured).
 */
function fuseWidthsUnderBridges(stations, leftW, rightW, bridges) {
  const n = stations.length;
  if (!bridges?.length) return 0;
  const under = new Uint8Array(n);
  for (const b of bridges) {
    const s = b.start;
    const e = b.end;
    if (!s || !e || !Number.isFinite(s.x) || !Number.isFinite(e.x)) continue;
    const reach = (Number(b.widthM) || 12) * 0.5 + 18;
    for (let i = 0; i < n; i++) {
      if (segDist(stations[i].x, stations[i].z, s.x, s.z, e.x, e.z) <= reach) under[i] = 1;
    }
  }
  let fused = 0;
  for (let i = 0; i < n; ) {
    if (!under[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && under[j + 1]) j++;
    // The water mask's gap is often longer than the deck (deck shadow, piers): extend the run
    // while the width is still pinched compared with open water further out (≤ 25 rows).
    const width = (k) => leftW[k] + rightW[k];
    const open = (k, dir) => {
      let m = 0;
      for (let q = 1; q <= 15; q++) {
        const kk = k + dir * q;
        if (kk < 0 || kk >= n) break;
        m = Math.max(m, width(kk));
      }
      return m;
    };
    let a = i;
    while (a > 0 && i - a < 25 && width(a - 1) < 0.7 * open(a - 1, -1)) a--;
    let b = j;
    while (b < n - 1 && b - j < 25 && width(b + 1) < 0.7 * open(b + 1, 1)) b++;
    a = Math.max(0, a - 1);
    b = Math.min(n - 1, b + 1);
    for (let k = a + 1; k < b; k++) {
      const t = b === a ? 0 : (k - a) / (b - a);
      leftW[k] = Math.max(leftW[k], THREE.MathUtils.lerp(leftW[a], leftW[b], t));
      rightW[k] = Math.max(rightW[k], THREE.MathUtils.lerp(rightW[a], rightW[b], t));
      fused++;
    }
    i = j + 1;
  }
  return fused;
}

/**
 * Keep one bank edge (side −1 left, +1 right) advancing downstream: where consecutive edge points
 * step backwards along the flow (offset > local bend radius), shrink that side's half-width.
 */
function preventEdgeFolds(stations, w, side, minHalf = 4) {
  const n = stations.length;
  const orig = Float32Array.from(w);
  const edge = (i) => {
    const st = stations[i];
    return [st.x + side * -st.flowZ * w[i], st.z + side * st.flowX * w[i]];
  };
  for (let pass = 0; pass < 80; pass++) {
    let bad = 0;
    for (let i = 0; i < n - 1; i++) {
      const a = stations[i];
      const b = stations[i + 1];
      let fx = a.flowX + b.flowX;
      let fz = a.flowZ + b.flowZ;
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl;
      fz /= fl;
      const step = Math.max(0.5, (b.x - a.x) * fx + (b.z - a.z) * fz);
      const [ex0, ez0] = edge(i);
      const [ex1, ez1] = edge(i + 1);
      if ((ex1 - ex0) * fx + (ez1 - ez0) * fz >= step * 0.3) continue;
      bad++;
      w[i] = Math.max(minHalf, w[i] * 0.93);
      w[i + 1] = Math.max(minHalf, w[i + 1] * 0.93);
    }
    if (!bad) break;
  }
  // The pairwise shrink leaves a zigzag edge. Where it acted, replace the width with a smoothed
  // running minimum (window ±4) — never wider than the shrunk width, so no fold returns.
  const touched = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (w[i] < orig[i] - 1e-3) touched[i] = 1;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let k = Math.max(0, i - 4); k <= Math.min(n - 1, i + 4); k++) m = Math.min(m, w[k]);
    env[i] = m;
  }
  const sm = smooth1d(env, 3);
  for (let i = 0; i < n; i++) {
    let near = false;
    for (let k = Math.max(0, i - 6); k <= Math.min(n - 1, i + 6) && !near; k++) near = !!touched[k];
    if (near) w[i] = Math.min(w[i], sm[i]);
  }
}

function smooth1d(arr, passes) {
  const n = arr.length;
  let a = Float32Array.from(arr);
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(n);
    b[0] = a[0];
    b[n - 1] = a[n - 1];
    for (let i = 1; i < n - 1; i++) {
      b[i] = a[i - 1] * 0.2 + a[i] * 0.6 + a[i + 1] * 0.2;
    }
    a = b;
  }
  return a;
}

function samplePointDepth(x, z, index, fallback) {
  const near = neighbors(index, x, z);
  let w = 0;
  let s = 0;
  for (const p of near) {
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 > 90 * 90) continue;
    const ww = 1 / Math.max(6, d2);
    w += ww;
    s += ww * (Number(p.depth) || 0);
  }
  if (w < 1e-8) return fallback;
  return s / w;
}

/**
 * Pull one side of the ribbon back to the mapped channel. Used only on the
 * Bund Garden bend, where the corridor polygon is about twice the real water.
 */
function trimDryHalf(stations, leftW, rightW, osmWater, ch0, ch1) {
  if (!osmWater?.isWaterAtLocal) return;
  const reach = (st, side, limit) => {
    const px = -st.flowZ * side;
    const pz = st.flowX * side;
    let outer = 0;
    let seen = false;
    const max = Math.max(12, limit);
    for (let d = 0; d <= max; d += 2) {
      if (osmWater.isWaterAtLocal(st.x + px * d, st.z + pz * d)) {
        seen = true;
        outer = d;
      } else if (seen && d > outer + 8) break;
    }
    return Math.min(limit, seen ? outer + 3 : 16);
  };
  for (let i = 0; i < stations.length; i++) {
    const ch = Number(stations[i].chainage_m);
    if (!Number.isFinite(ch) || ch < ch0 || ch > ch1) continue;
    const fade = Math.min(1, (ch - ch0) / 160, (ch1 - ch) / 160);
    const st = stations[i];
    const capL = reach(st, -1, leftW[i]);
    const capR = reach(st, 1, rightW[i]);
    leftW[i] += (capL - leftW[i]) * fade;
    rightW[i] += (capR - rightW[i]) * fade;
  }
}

function buildWetRibbon(stations, lulc, osmWater, dataset, across, jalnetraWater = null) {
  const n = stations.length;
  // Pre-mark stations that sit on JalNetra permanent water (for bridge fusion).
  const apiWet = new Uint8Array(n);
  if (jalnetraWater?.isWaterAtLocal) {
    for (let i = 0; i < n; i++) {
      const st = stations[i];
      if (jalnetraWater.isWaterAtLocal(st.x, st.z)) apiWet[i] = 1;
      else {
        // Sample a few metres off-centre — piers often sit on the CL
        const px = -st.flowZ;
        const pz = st.flowX;
        if (
          jalnetraWater.isWaterAtLocal(st.x + px * 8, st.z + pz * 8) ||
          jalnetraWater.isWaterAtLocal(st.x - px * 8, st.z - pz * 8)
        ) {
          apiWet[i] = 1;
        }
      }
    }
  }

  const leftW = new Float32Array(n);
  const rightW = new Float32Array(n);
  // Pass 1 — measure SAR/LULC extents (no bridge inflate).
  for (let i = 0; i < n; i++) {
    const st = stations[i];
    const px = -st.flowZ;
    const pz = st.flowX;
    const maxH = Math.max(12, Number(st.halfWidth) || 40);
    leftW[i] = wetHalfWidth(st, -px, -pz, maxH, lulc, osmWater, jalnetraWater, false, 0);
    rightW[i] = wetHalfWidth(st, px, pz, maxH, lulc, osmWater, jalnetraWater, false, 0);
  }
  // Pass 2 — thin bridge fuse from neighbour SAR half-widths only.
  if (jalnetraWater?.isWaterAtLocal) {
    for (let i = 0; i < n; i++) {
      if (apiWet[i]) continue;
      let fuse = false;
      let sumL = 0;
      let sumR = 0;
      let cnt = 0;
      for (let k = Math.max(0, i - 3); k <= Math.min(n - 1, i + 3); k++) {
        if (!apiWet[k] || k === i) continue;
        fuse = true;
        sumL += leftW[k];
        sumR += rightW[k];
        cnt += 1;
      }
      if (!fuse || !cnt) continue;
      const st = stations[i];
      const px = -st.flowZ;
      const pz = st.flowX;
      const maxH = Math.max(12, Number(st.halfWidth) || 40);
      leftW[i] = wetHalfWidth(st, -px, -pz, maxH, lulc, osmWater, jalnetraWater, true, sumL / cnt);
      rightW[i] = wetHalfWidth(st, px, pz, maxH, lulc, osmWater, jalnetraWater, true, sumR / cnt);
    }
  }
  // Bridge decks / shadows read as land in the LULC / SAR masks, which pinched the water to a
  // gap under every bridge. Across a bridge, bridge the width from the open water either side.
  fuseWidthsUnderBridges(stations, leftW, rightW, dataset?.bridges);
  // Light smooth — heavy passes were bloating bank width past the SAR edge.
  const lSm = smooth1d(leftW, jalnetraWater?.isWaterAtLocal ? 4 : 10);
  const rSm = smooth1d(rightW, jalnetraWater?.isWaterAtLocal ? 4 : 10);
  // Edges offset from a curved centreline cross over on the inside of tight bends (folded,
  // inverted triangles). Narrow the inner edge just enough that it keeps moving downstream.
  preventEdgeFolds(stations, lSm, -1);
  preventEdgeFolds(stations, rSm, 1);
  // Bund Garden → Dhanori bend only. The corridor here is ~200 m, but the mapped
  // channel covers about half of that — the other half is land.
  trimDryHalf(stations, lSm, rSm, osmWater, 3400, 5300);
  for (let s = 0; s < n; s++) {
    const st = stations[s];
    st.wetHalfLeft = lSm[s];
    st.wetHalfRight = rSm[s];
    st.wetHalfWidth = (lSm[s] + rSm[s]) * 0.5;
  }

  const pts = dataset.points || [];
  const index = spatialIndex(pts);
  const cols = across + 1;
  const positions = [];
  const depths = [];
  const alongT = [];
  const acrossU = [];
  const flow = [];
  const narrow = [];
  const widthM = [];
  const curve = [];

  for (let s = 0; s < n; s++) {
    const st = stations[s];
    const px = -st.flowZ;
    const pz = st.flowX;
    const lx = st.x - px * lSm[s];
    const lz = st.z - pz * lSm[s];
    const rx = st.x + px * rSm[s];
    const rz = st.z + pz * rSm[s];
    const width = Math.hypot(rx - lx, rz - lz);
    for (let a = 0; a <= across; a++) {
      const u = a / across;
      const x = lx + (rx - lx) * u;
      const z = lz + (rz - lz) * u;
      const bank = Math.abs(u * 2 - 1);
      const fallback = 0.55 + 1.25 * (1 - bank);
      // Prefer JalNetra relative depth when the mask has water here.
      const apiD = jalnetraWater?.depthAtLocal?.(x, z);
      const d = Number.isFinite(apiD)
        ? Math.max(0.35, apiD)
        : Math.max(0.35, samplePointDepth(x, z, index, fallback));
      positions.push(x, SURFACE_Y, z);
      depths.push(d);
      alongT.push(st.t);
      acrossU.push(u);
      flow.push(st.flowX, st.flowZ);
      narrow.push(st.narrow || 0);
      widthM.push(width);
      curve.push(st.curve || 0);
    }
  }

  const indices = [];
  // Naik Bet (about chainage 1+000–2+000). The centreline runs across the island,
  // so a solid ribbon covers the forest. Keep a quad only when every corner is
  // mapped water; the two channels stay, the island stays land.
  const NAIK_CH0 = 980;
  const NAIK_CH1 = 1980;
  const at = (idx) => lulc?.classAtLocal?.(positions[idx * 3], positions[idx * 3 + 2]);
  for (let s = 0; s < n - 1; s++) {
    const chA = Number(stations[s].chainage_m);
    const chB = Number(stations[s + 1].chainage_m);
    const naik = lulc?.classAtLocal && chA >= NAIK_CH0 && chA <= NAIK_CH1 && chB >= NAIK_CH0 && chB <= NAIK_CH1;
    for (let a = 0; a < across; a++) {
      const i0 = s * cols + a;
      const i1 = i0 + 1;
      const i2 = i0 + cols;
      const i3 = i2 + 1;
      if (naik && (at(i0) !== "water" || at(i1) !== "water" || at(i2) !== "water" || at(i3) !== "water")) {
        continue;
      }
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }
  if (indices.length >= 3) {
    const a = indices[0];
    const b = indices[1];
    const c = indices[2];
    const ny =
      (positions[b * 3] - positions[a * 3]) * (positions[c * 3 + 2] - positions[a * 3 + 2]) -
      (positions[b * 3 + 2] - positions[a * 3 + 2]) * (positions[c * 3] - positions[a * 3]);
    if (ny < 0) {
      for (let i = 0; i < indices.length; i += 3) {
        const t = indices[i + 1];
        indices[i + 1] = indices[i + 2];
        indices[i + 2] = t;
      }
    }
  }

  const boundary = [];
  for (let s = 0; s < n - 1; s++) {
    boundary.push([s * cols, (s + 1) * cols]);
    boundary.push([s * cols + across, (s + 1) * cols + across]);
  }

  return {
    positions: new Float32Array(positions),
    depths: new Float32Array(depths),
    alongT: new Float32Array(alongT),
    acrossU: new Float32Array(acrossU),
    flow: new Float32Array(flow),
    narrow: new Float32Array(narrow),
    widthM: new Float32Array(widthM),
    curve: new Float32Array(curve),
    indices: new Uint32Array(indices),
    boundary,
    across,
    count: depths.length,
    source: "hydrology-ribbon",
  };
}

function applyRibbonToRiver(river, dataset, bath) {
  const exag = state.depthExaggeration || 1;
  const n = bath.count;
  const surfPos = bath.positions.slice();
  const bedPos = bath.positions.slice();
  const bedCol = new Float32Array(n * 3);
  const depthViewCol = new Float32Array(n * 3);
  const cutCol = new Float32Array(n * 3);
  const sand = new THREE.Color("#a89870");
  const silt = new THREE.Color("#6a5c44");
  const deepUnder = new THREE.Color("#3a3228");
  const groundShallow = new THREE.Color("#d2c4a0");
  const groundMid = new THREE.Color("#9a8458");
  const groundDeep = new THREE.Color("#4a3e30");
  const cutShallow = new THREE.Color("#7eb8d8");
  const cutMid = new THREE.Color("#3d7aa8");
  const cutDeep = new THREE.Color("#1e4a72");
  const tmp = new THREE.Color();

  for (let i = 0; i < n; i++) {
    const d = bath.depths[i];
    const across = bath.acrossU[i];
    surfPos[i * 3 + 1] = SURFACE_Y;
    bedPos[i * 3 + 1] = bedElevation(d, dataset.minDepth, dataset.maxDepth, across, exag);
    const tExcel = depthNorm(d, dataset.minDepth, dataset.maxDepth);
    const bank = Math.abs(across * 2 - 1);
    const t = THREE.MathUtils.clamp(tExcel * (1 - bank * 0.35), 0, 1);
    const softT = THREE.MathUtils.smoothstep(0.05, 0.95, t) * 0.55;
    tmp.copy(sand).lerp(silt, softT);
    tmp.lerp(deepUnder, softT * 0.85);
    bedCol[i * 3] = tmp.r;
    bedCol[i * 3 + 1] = tmp.g;
    bedCol[i * 3 + 2] = tmp.b;
    tmp.copy(groundShallow).lerp(groundMid, THREE.MathUtils.smoothstep(0, 0.5, t));
    tmp.lerp(groundDeep, THREE.MathUtils.smoothstep(0.3, 1, t));
    depthViewCol[i * 3] = tmp.r;
    depthViewCol[i * 3 + 1] = tmp.g;
    depthViewCol[i * 3 + 2] = tmp.b;
    tmp.copy(cutShallow).lerp(cutMid, THREE.MathUtils.smoothstep(0, 0.55, t));
    tmp.lerp(cutDeep, THREE.MathUtils.smoothstep(0.35, 1, t));
    cutCol[i * 3] = tmp.r;
    cutCol[i * 3 + 1] = tmp.g;
    cutCol[i * 3 + 2] = tmp.b;
  }

  const surfGeo = new THREE.BufferGeometry();
  surfGeo.setAttribute("position", new THREE.Float32BufferAttribute(surfPos, 3));
  surfGeo.setAttribute("aDepth", new THREE.Float32BufferAttribute(bath.depths, 1));
  surfGeo.setAttribute("aAlong", new THREE.Float32BufferAttribute(bath.alongT, 1));
  surfGeo.setAttribute("aAcross", new THREE.Float32BufferAttribute(bath.acrossU, 1));
  surfGeo.setAttribute("aFlow", new THREE.Float32BufferAttribute(bath.flow, 2));
  surfGeo.setAttribute("aNarrow", new THREE.Float32BufferAttribute(bath.narrow, 1));
  surfGeo.setAttribute("aWidth", new THREE.Float32BufferAttribute(bath.widthM, 1));
  surfGeo.setAttribute("aCurve", new THREE.Float32BufferAttribute(bath.curve, 1));
  surfGeo.setAttribute("aIsFlood", new THREE.Float32BufferAttribute(new Float32Array(n).fill(0), 1));
  surfGeo.setIndex(new THREE.BufferAttribute(bath.indices, 1));
  surfGeo.computeVertexNormals();

  const bedGeo = new THREE.BufferGeometry();
  bedGeo.setAttribute("position", new THREE.Float32BufferAttribute(bedPos, 3));
  bedGeo.setAttribute("color", new THREE.Float32BufferAttribute(bedCol, 3));
  bedGeo.setAttribute("colorLand", new THREE.Float32BufferAttribute(bedCol.slice(), 3));
  bedGeo.setAttribute("colorDepthView", new THREE.Float32BufferAttribute(depthViewCol, 3));
  bedGeo.setAttribute("aDepth", new THREE.Float32BufferAttribute(bath.depths, 1));
  bedGeo.setAttribute("aAcross", new THREE.Float32BufferAttribute(bath.acrossU, 1));
  bedGeo.setAttribute("colorCut", new THREE.Float32BufferAttribute(cutCol, 3));
  bedGeo.setIndex(new THREE.BufferAttribute(bath.indices.slice(), 1));
  bedGeo.computeVertexNormals();

  river.mesh.geometry.dispose();
  river.mesh.geometry = surfGeo;
  river.bed.geometry.dispose();
  river.bed.geometry = bedGeo;
  if (river.wire) {
    river.wire.geometry.dispose();
    river.wire.geometry = surfGeo.clone();
  }

  while (river.walls.children.length) {
    const child = river.walls.children[0];
    river.walls.remove(child);
    child.geometry?.dispose();
    child.material?.dispose?.();
  }
  const walls = createBoundaryWalls(bath, dataset, exag);
  for (const child of [...walls.children]) river.walls.add(child);
  river.walls.userData.boundary = bath.boundary;
  river.walls.userData.bath = bath;
  river.bathymetry = bath;
}

function boundaryEdges(indices) {
  const edgeCount = new Map();
  const addEdge = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const entry = edgeCount.get(key) || { count: 0, a, b };
    entry.count++;
    edgeCount.set(key, entry);
  };
  for (let i = 0; i < indices.length; i += 3) {
    addEdge(indices[i], indices[i + 1]);
    addEdge(indices[i + 1], indices[i + 2]);
    addEdge(indices[i + 2], indices[i]);
  }
  return edgeCount;
}

function subdivideBoundaryEdges(geo, maxEdgeM = 16, passes = 3) {
  const posAttr = geo.getAttribute("position");
  if (!posAttr || !geo.getIndex()) return;

  const attrNames = Object.keys(geo.attributes);
  const arrays = {};
  const sizes = {};
  for (const name of attrNames) {
    const attr = geo.getAttribute(name);
    arrays[name] = Array.from(attr.array);
    sizes[name] = attr.itemSize;
  }
  let indices = Array.from(geo.getIndex().array);

  const vertCount = () => arrays.position.length / 3;

  const lerpVert = (a, b) => {
    const id = vertCount();
    for (const name of attrNames) {
      const size = sizes[name];
      const arr = arrays[name];
      for (let k = 0; k < size; k++) {
        arr.push((arr[a * size + k] + arr[b * size + k]) * 0.5);
      }
    }
    return id;
  };

  const dist = (a, b) => {
    const ax = arrays.position[a * 3];
    const az = arrays.position[a * 3 + 2];
    const bx = arrays.position[b * 3];
    const bz = arrays.position[b * 3 + 2];
    return Math.hypot(ax - bx, az - bz);
  };

  for (let pass = 0; pass < passes; pass++) {
    const edges = boundaryEdges(indices);
    const next = [];
    const mid = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (mid.has(key)) return mid.get(key);
      const id = lerpVert(a, b);
      mid.set(key, id);
      return id;
    };
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      const ab = a < b ? `${a},${b}` : `${b},${a}`;
      const bc = b < c ? `${b},${c}` : `${c},${b}`;
      const ca = c < a ? `${c},${a}` : `${a},${c}`;
      const splitAB = edges.get(ab)?.count === 1 && dist(a, b) > maxEdgeM;
      const splitBC = edges.get(bc)?.count === 1 && dist(b, c) > maxEdgeM;
      const splitCA = edges.get(ca)?.count === 1 && dist(c, a) > maxEdgeM;
      const n = (splitAB ? 1 : 0) + (splitBC ? 1 : 0) + (splitCA ? 1 : 0);
      if (n === 0) {
        next.push(a, b, c);
        continue;
      }
      if (n === 1) {
        if (splitAB) {
          const m = midpoint(a, b);
          next.push(a, m, c, m, b, c);
        } else if (splitBC) {
          const m = midpoint(b, c);
          next.push(a, b, m, a, m, c);
        } else {
          const m = midpoint(c, a);
          next.push(a, b, m, b, c, m);
        }
        continue;
      }
      if (splitAB && splitBC && !splitCA) {
        const mab = midpoint(a, b);
        const mbc = midpoint(b, c);
        next.push(a, mab, c, mab, b, mbc, mab, mbc, c);
      } else if (splitBC && splitCA && !splitAB) {
        const mbc = midpoint(b, c);
        const mca = midpoint(c, a);
        next.push(a, b, mca, b, mbc, mca, mbc, c, mca);
      } else if (splitCA && splitAB && !splitBC) {
        const mca = midpoint(c, a);
        const mab = midpoint(a, b);
        next.push(a, mab, mca, mab, b, c, mab, c, mca);
      } else {
        const mab = midpoint(a, b);
        const mbc = midpoint(b, c);
        const mca = midpoint(c, a);
        next.push(a, mab, mca, mab, b, mbc, mca, mbc, c, mab, mbc, mca);
      }
    }
    indices = next;
  }

  for (const name of attrNames) {
    const attr = geo.getAttribute(name);
    geo.setAttribute(name, new THREE.Float32BufferAttribute(arrays[name], attr.itemSize));
  }
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
}

function smoothMeshBoundary(geo, iterations = 3) {
  const pos = geo.getAttribute("position");
  const idx = geo.getIndex();
  if (!pos || !idx) return;

  const indices = idx.array;
  const edgeCount = new Map();
  const addEdge = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const entry = edgeCount.get(key) || { count: 0, a, b };
    entry.count++;
    edgeCount.set(key, entry);
  };
  for (let i = 0; i < indices.length; i += 3) {
    addEdge(indices[i], indices[i + 1]);
    addEdge(indices[i + 1], indices[i + 2]);
    addEdge(indices[i + 2], indices[i]);
  }

  const boundaryAdj = new Map();
  for (const { count, a, b } of edgeCount.values()) {
    if (count !== 1) continue;
    if (!boundaryAdj.has(a)) boundaryAdj.set(a, []);
    if (!boundaryAdj.has(b)) boundaryAdj.set(b, []);
    boundaryAdj.get(a).push(b);
    boundaryAdj.get(b).push(a);
  }

  const newPos = new Float32Array(pos.array);
  for (let iter = 0; iter < iterations; iter++) {
    const tempPos = new Float32Array(newPos);
    for (const [v, neighbors] of boundaryAdj.entries()) {
      if (neighbors.length < 2) continue;
      let sumX = 0;
      let sumZ = 0;
      for (const n of neighbors) {
        sumX += tempPos[n * 3];
        sumZ += tempPos[n * 3 + 2];
      }
      const avgX = sumX / neighbors.length;
      const avgZ = sumZ / neighbors.length;
      newPos[v * 3] = tempPos[v * 3] * 0.35 + avgX * 0.65;
      newPos[v * 3 + 2] = tempPos[v * 3 + 2] * 0.35 + avgZ * 0.65;
    }
  }

  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, newPos[i * 3]);
    pos.setZ(i, newPos[i * 3 + 2]);
  }
  pos.needsUpdate = true;
}

function createBoundaryWalls(bath, dataset, exag) {
  const pos = [];
  const col = [];
  // Top of wall slightly below surface to avoid z-fighting with water
  const wallTop = SURFACE_Y - 0.08;
  for (const [a, b] of bath.boundary) {
    const ax = bath.positions[a * 3];
    const az = bath.positions[a * 3 + 2];
    const bx = bath.positions[b * 3];
    const bz = bath.positions[b * 3 + 2];
    const ya = bedElevation(
      bath.depths[a],
      dataset.minDepth,
      dataset.maxDepth,
      bath.acrossU?.[a] ?? 0.5,
      exag,
    );
    const yb = bedElevation(
      bath.depths[b],
      dataset.minDepth,
      dataset.maxDepth,
      bath.acrossU?.[b] ?? 0.5,
      exag,
    );
    const i0 = pos.length / 3;
    pos.push(ax, ya, az, ax, wallTop, az, bx, yb, bz, bx, wallTop, bz);
    for (let k = 0; k < 4; k++) col.push(0.42, 0.36, 0.24);
    pos._idx = pos._idx || [];
    pos._idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(pos._idx || []);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  mesh.receiveShadow = true;
  mesh.name = "channelWalls";
  const group = new THREE.Group();
  group.name = "channelWalls";
  group.add(mesh);
  group.userData.boundary = bath.boundary;
  group.userData.bath = bath;
  return group;
}

/**
 * @param {"water"|"depth"|"cutaway"|"erosionDark"} mode
 *   water  — soft bed under living water
 *   depth  — River off: excavated ground / channel deep view (earth tones)
 *   cutaway — exaggerated cutaway look
 *   erosionDark — near-black channel so neon bank-erosion overlay pops
 */
export function applyRiverLook(river, mode = "water") {
  const look =
    mode === true || mode === "cutaway"
      ? "cutaway"
      : mode === false || mode === "water"
        ? "water"
        : mode === "erosionDark"
          ? "erosionDark"
          : mode === "depth"
            ? "depth"
            : mode;
  const attrName =
    look === "cutaway"
      ? "colorCut"
      : look === "depth" || look === "erosionDark"
        ? "colorDepthView"
        : "colorLand";
  const from = river.bed.geometry.getAttribute(attrName)
    || river.bed.geometry.getAttribute("colorLand");
  const to = river.bed.geometry.getAttribute("color");
  if (from && to) {
    to.array.set(from.array);
    to.needsUpdate = true;
  }
  if (look === "erosionDark" && to) {
    const arr = to.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] *= 0.1;
      arr[i + 1] *= 0.12;
      arr[i + 2] *= 0.14;
    }
    to.needsUpdate = true;
  }
  // Hide channel walls in water mode — a vertical turquoise face reads as a
  // floating water block. Terrain carve brings banks up to the waterline instead.
  river.walls.visible = look !== "water";
  for (const child of river.walls.children) {
    const col = child.geometry.attributes.color;
    for (let i = 0; i < col.count; i++) {
      const isBed = i % 4 === 0 || i % 4 === 2;
      if (look === "water") col.setXYZ(i, 0.52, 0.56, 0.42);
      else if (look === "erosionDark") {
        if (isBed) col.setXYZ(i, 0.04, 0.05, 0.06);
        else col.setXYZ(i, 0.09, 0.1, 0.11);
      } else if (look === "depth") {
        if (isBed) col.setXYZ(i, 0.42, 0.36, 0.26);
        else col.setXYZ(i, 0.68, 0.60, 0.44);
      } else if (isBed) col.setXYZ(i, 0.12, 0.42, 0.62);
      else col.setXYZ(i, 0.35, 0.65, 0.72);
    }
    col.needsUpdate = true;
    child.material.transparent = look === "cutaway";
    child.material.opacity = look === "cutaway" ? 0.86 : 1.0;
    child.material.needsUpdate = true;
  }
  // Base tint: depth mode must read as soil/rock, not water
  if (river.bed.material?.color) {
    if (look === "erosionDark") river.bed.material.color.set("#080a0c");
    else if (look === "depth") river.bed.material.color.set("#c4b896");
    else if (look === "cutaway") river.bed.material.color.set("#ffffff");
    else river.bed.material.color.set("#ffffff");
  }
  river.bed.material.roughness = look === "cutaway" ? 0.52 : 0.92;
  river.bed.material.metalness = look === "cutaway" ? 0.2 : 0.02;
  river.bed.material.needsUpdate = true;
}

export function applyExaggeration(
  river,
  dataset,
  exag,
  floodRiseM = 0,
  waterSurfaceSceneY = null,
  { includeBaseStage = true, allowNegativeRise = false } = {},
) {
  const bath = river.bathymetry;
  const pos = river.mesh.geometry.attributes.position;
  const bed = river.bed.geometry.attributes.position;
  // During API flood playback the rise is the physical WSE delta — skip base stage.
  const base = includeBaseStage ? BASE_WATER_STAGE_M : 0;
  const requestedRise = Number(floodRiseM) || 0;
  const rise = base + (allowNegativeRise ? requestedRise : Math.max(0, requestedRise));
  const cols = (bath.across || 40) + 1;
  const nRows = Math.floor(bath.depths.length / cols);

  for (let i = 0; i < bath.depths.length; i++) {
    const d = bath.depths[i];
    const across = bath.acrossU?.[i] ?? 0.5;
    const row = Math.min(nRows - 1, Math.floor(i / cols));

    // Station-specific physical WSE when available, falling back to SURFACE_Y + rise
    let baseSurfaceY = SURFACE_Y;
    if (waterSurfaceSceneY && Array.isArray(waterSurfaceSceneY) && waterSurfaceSceneY.length > row) {
      baseSurfaceY = waterSurfaceSceneY[row];
    }
    const finalWaterY = baseSurfaceY + rise;

    pos.setY(i, finalWaterY);
    // Bed = water surface − surveyed depth (× display exaggeration). The DTM is not used here:
    // over water FABDEM records the water surface, not the bed, and pulling the bed down to it
    // made depth (water − bed) disagree with the survey by up to 3.6 m.
    let bedY = bedElevation(d, dataset.minDepth, dataset.maxDepth, across, exag, finalWaterY);
    bedY = Math.min(bedY, finalWaterY - MIN_BED_SEPARATION);
    bed.setY(i, bedY);
  }
  pos.needsUpdate = true;
  bed.needsUpdate = true;
  river.mesh.geometry.computeVertexNormals();
  river.bed.geometry.computeVertexNormals();
  updateWalls(river.walls, bath, dataset, exag, rise, waterSurfaceSceneY, river.dtmHeightAt);
  // Bank strip (channelBanks.js): toe on the new bed edge, shore at the new water level.
  river.banksSync?.(SURFACE_Y + rise);
}

function updateWalls(group, bath, dataset, exag, floodRiseM = 0, waterSurfaceSceneY = null, dtmHeightAt = null) {
  const child = group.children[0];
  if (!child) return;
  const attr = child.geometry.attributes.position;
  const cols = (bath.across || 40) + 1;
  const nRows = Math.floor(bath.depths.length / cols);

  let i = 0;
  for (const [a, b] of bath.boundary) {
    const rowA = Math.min(nRows - 1, Math.floor(a / cols));
    const rowB = Math.min(nRows - 1, Math.floor(b / cols));

    let surfaceYa = SURFACE_Y;
    let surfaceYb = SURFACE_Y;
    if (waterSurfaceSceneY && Array.isArray(waterSurfaceSceneY)) {
      if (waterSurfaceSceneY.length > rowA) surfaceYa = waterSurfaceSceneY[rowA];
      if (waterSurfaceSceneY.length > rowB) surfaceYb = waterSurfaceSceneY[rowB];
    }

    const wallTopA = surfaceYa + floodRiseM - 0.08;
    const wallTopB = surfaceYb + floodRiseM - 0.08;

    const xa = bath.positions[a * 3];
    const za = bath.positions[a * 3 + 2];
    const xb = bath.positions[b * 3];
    const zb = bath.positions[b * 3 + 2];
    const dtmA = dtmHeightAt?.(xa, za);
    const dtmB = dtmHeightAt?.(xb, zb);
    let ya = bedElevation(
      bath.depths[a],
      dataset.minDepth,
      dataset.maxDepth,
      bath.acrossU?.[a] ?? 0.5,
      exag,
      wallTopA + 0.08,
    );
    let yb = bedElevation(
      bath.depths[b],
      dataset.minDepth,
      dataset.maxDepth,
      bath.acrossU?.[b] ?? 0.5,
      exag,
      wallTopB + 0.08,
    );
    if (Number.isFinite(dtmA) && dtmA < wallTopA - MIN_BED_SEPARATION) ya = Math.min(ya, dtmA);
    if (Number.isFinite(dtmB) && dtmB < wallTopB - MIN_BED_SEPARATION) yb = Math.min(yb, dtmB);
    ya = Math.min(ya, wallTopA - MIN_BED_SEPARATION);
    yb = Math.min(yb, wallTopB - MIN_BED_SEPARATION);
    attr.setY(i, ya);
    attr.setY(i + 1, wallTopA);
    attr.setY(i + 2, yb);
    attr.setY(i + 3, wallTopB);
    i += 4;
  }
  attr.needsUpdate = true;
  child.geometry.computeVertexNormals();
}
