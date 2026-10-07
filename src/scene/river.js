import * as THREE from "three";
import { createWaterMaterial } from "./waterShader.js";
import { state } from "../state.js";
import { isObservedWater } from "../geo/osmWater.js";

export const SURFACE_Y = 9.4;
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

export function bedElevation(d, _minD, _maxD, acrossU, exag) {
  // Use ACTUAL verified bathymetric depth, strictly relative to water surface.
  // The lateral interpolation is already handled spatially by the bathymetry cloud/service.
  const depth = Number(d) || 0;
  const y = SURFACE_Y - depth * Math.max(1, exag);
  // We don't enforce a minimum separation for the real bed; 
  // if depth is 0, it means bank elevation.
  return y;
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
 * Keep water and bed triangles only where LULC 2026 or live OSM records water.
 * The AOI / corridor polygon is not treated as a water mask.
 */
export function clipRiverToHydrology(river, lulc, osmWater) {
  if (!river?.bathymetry) return;
  const bath = river.bathymetry;
  const src = bath.indices;
  const pos = bath.positions;
  const nVert = (pos.length / 3) | 0;

  const wet = new Uint8Array(nVert);
  for (let i = 0; i < nVert; i++) {
    wet[i] = isObservedWater(lulc, osmWater, pos[i * 3], pos[i * 3 + 2]) ? 1 : 0;
  }

  const adj = Array.from({ length: nVert }, () => []);
  const seen = new Set();
  const link = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    adj[a].push(b);
    adj[b].push(a);
  };
  for (let t = 0; t < src.length; t += 3) {
    link(src[t], src[t + 1]);
    link(src[t + 1], src[t + 2]);
    link(src[t + 2], src[t]);
  }

  const next = new Uint8Array(nVert);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < nVert; i++) {
      const nb = adj[i];
      if (!nb.length) {
        next[i] = wet[i];
        continue;
      }
      let s = wet[i];
      for (const j of nb) s += wet[j];
      next[i] = s * 2 >= nb.length + 1 ? 1 : 0;
    }
    wet.set(next);
  }

  const keep = [];
  let removed = 0;
  for (let t = 0; t < src.length; t += 3) {
    const a = src[t];
    const b = src[t + 1];
    const c = src[t + 2];
    if (wet[a] + wet[b] + wet[c] < 2) {
      removed++;
      continue;
    }
    keep.push(a, b, c);
  }

  const index = new Uint32Array(keep);
  for (const geo of [river.mesh.geometry, river.bed.geometry, river.wire?.geometry]) {
    if (!geo) continue;
    geo.setIndex(new THREE.BufferAttribute(index.slice(), 1));
    subdivideBoundaryEdges(geo, 12, 3);
    smoothMeshBoundary(geo, 14);
    geo.computeVertexNormals();
  }
  console.info("[river] water clipped to LULC water + OSM (not KML corridor)", {
    kept: keep.length / 3,
    removed,
    osmPolygons: osmWater?.count ?? 0,
  });
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
  
  // 1. Find all edges
  function addEdge(a, b) {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const entry = edgeCount.get(key) || { count: 0, a, b };
    entry.count++;
    edgeCount.set(key, entry);
  }
  
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
      newPos[v * 3] = tempPos[v * 3] * 0.22 + avgX * 0.78;
      newPos[v * 3 + 2] = tempPos[v * 3 + 2] * 0.22 + avgZ * 0.78;
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

export function applyExaggeration(river, dataset, exag, floodRiseM = 0, waterSurfaceSceneY = null) {
  const bath = river.bathymetry;
  const pos = river.mesh.geometry.attributes.position;
  const bed = river.bed.geometry.attributes.position;
  const rise = Math.max(0, Number(floodRiseM) || 0);
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
    const x = bath.positions[i * 3];
    const z = bath.positions[i * 3 + 2];
    const dtmY = river.dtmHeightAt?.(x, z);
    const fromSurvey = bedElevation(d, dataset.minDepth, dataset.maxDepth, across, exag);
    const bedY = Number.isFinite(dtmY)
      ? Math.min(dtmY, finalWaterY - 0.08)
      : fromSurvey;
    bed.setY(i, bedY);
  }
  pos.needsUpdate = true;
  bed.needsUpdate = true;
  river.mesh.geometry.computeVertexNormals();
  river.bed.geometry.computeVertexNormals();
  updateWalls(river.walls, bath, dataset, exag, rise, waterSurfaceSceneY, river.dtmHeightAt);
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

    const wallTopA = surfaceYa + Math.max(0, floodRiseM) - 0.08;
    const wallTopB = surfaceYb + Math.max(0, floodRiseM) - 0.08;

    const xa = bath.positions[a * 3];
    const za = bath.positions[a * 3 + 2];
    const xb = bath.positions[b * 3];
    const zb = bath.positions[b * 3 + 2];
    const dtmA = dtmHeightAt?.(xa, za);
    const dtmB = dtmHeightAt?.(xb, zb);
    const ya = Number.isFinite(dtmA)
      ? Math.min(dtmA, wallTopA - 0.02)
      : bedElevation(bath.depths[a], dataset.minDepth, dataset.maxDepth, bath.acrossU?.[a] ?? 0.5, exag);
    const yb = Number.isFinite(dtmB)
      ? Math.min(dtmB, wallTopB - 0.02)
      : bedElevation(bath.depths[b], dataset.minDepth, dataset.maxDepth, bath.acrossU?.[b] ?? 0.5, exag);
    attr.setY(i, ya);
    attr.setY(i + 1, wallTopA);
    attr.setY(i + 2, yb);
    attr.setY(i + 3, wallTopB);
    i += 4;
  }
  attr.needsUpdate = true;
  child.geometry.computeVertexNormals();
}
