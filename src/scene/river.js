import * as THREE from "three";
import { createWaterMaterial } from "./waterShader.js";
import { state } from "../state.js";
import { wseSpatialService } from "../services/hydrology/wseSpatialService.js";

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
 * Drop water and bed triangles whose centroid is physically dry based on local depth.
 * depth = WSE - bed. If depth <= 0, the triangle is deleted.
 * LULC is used only as a secondary constraint.
 *
 * SAFETY RULE: If wseSpatialService has no hydraulic profile yet (loaded async),
 * default every triangle to wet=true so the river is never accidentally erased.
 * The hydraulic clip will run again once the profile loads via hydrologyStore listener.
 */
export function clipRiverToHydrology(river, lulc) {
  if (!river?.bathymetry) return;
  const bath = river.bathymetry;
  const src = bath.indices;
  const pos = bath.positions;
  const chainages = bath.chainages || new Float32Array(pos.length / 3);
  const lateralOffsets = bath.lateralOffsets || new Float32Array(pos.length / 3);

  // Check if hydraulic profile is available at all before doing depth checks.
  const profileReady = wseSpatialService._cachedRecords != null &&
                       wseSpatialService._cachedRecords.length > 0;

  const keep = [];
  let removed = 0;
  for (let t = 0; t < src.length; t += 3) {
    const a = src[t];
    const b = src[t + 1];
    const c = src[t + 2];

    const x   = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
    const z   = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    const cls = lulc?.classAtLocal?.(x, z);

    // If LULC explicitly says non-water land (not just unclassified), remove it
    if (cls && cls !== "water" && cls !== "wetland") {
      removed++;
      continue;
    }

    // Hydraulic wet/dry — only applied when profile data exists
    if (profileReady) {
      const ch  = (chainages[a] + chainages[b] + chainages[c]) / 3;
      const off = (lateralOffsets[a] + lateralOffsets[b] + lateralOffsets[c]) / 3;
      const depthInfo = wseSpatialService.getDepthAt(ch, off);
      if (!depthInfo.wetted && depthInfo.depthM === 0) {
        // Only remove if we have a confident dry reading, not just unavailable
        if (depthInfo.provenance !== "WSE_UNAVAILABLE") {
          removed++;
          continue;
        }
      }
    }
    // If no profile or profile says wet or unavailable → keep triangle
    keep.push(a, b, c);
  }

  const index = new Uint32Array(keep);
  for (const geo of [river.mesh.geometry, river.bed.geometry, river.wire?.geometry]) {
    if (!geo) continue;
    geo.setIndex(new THREE.BufferAttribute(index.slice(), 1));
    smoothMeshBoundary(geo, 4);
    geo.computeVertexNormals();
  }
  console.info("[river] water clipped to Hydrology", {
    kept: keep.length / 3, removed, profileReady
  });
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

  // 2. Identify boundary vertices and their boundary neighbors
  const boundaryAdj = new Map();
  for (const { count, a, b } of edgeCount.values()) {
    if (count === 1) { // Boundary edge
      if (!boundaryAdj.has(a)) boundaryAdj.set(a, []);
      if (!boundaryAdj.has(b)) boundaryAdj.set(b, []);
      boundaryAdj.get(a).push(b);
      boundaryAdj.get(b).push(a);
    }
  }

  // 3. Laplacian smoothing on boundary vertices only
  const newPos = new Float32Array(pos.array);
  for (let iter = 0; iter < iterations; iter++) {
    const tempPos = new Float32Array(newPos);
    for (const [v, neighbors] of boundaryAdj.entries()) {
      if (neighbors.length < 2) continue; // Skip endpoints or errors
      
      let sumX = 0, sumZ = 0;
      for (const n of neighbors) {
        sumX += tempPos[n * 3];
        sumZ += tempPos[n * 3 + 2];
      }
      
      // Move 50% towards the average of neighbors (Chaikin-like softening)
      const avgX = sumX / neighbors.length;
      const avgZ = sumZ / neighbors.length;
      newPos[v * 3] = tempPos[v * 3] * 0.5 + avgX * 0.5;
      newPos[v * 3 + 2] = tempPos[v * 3 + 2] * 0.5 + avgZ * 0.5;
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
  for (const child of river.walls.children) {
    const col = child.geometry.attributes.color;
    for (let i = 0; i < col.count; i++) {
      const isBed = i % 4 === 0 || i % 4 === 2;
      // Keep the measured channel edge readable beneath translucent blue water.
      // The old brown wall became almost black under Chrome's scene lighting.
      if (look === "water") col.setXYZ(i, 0.32, 0.52, 0.58);
      else if (look === "erosionDark") {
        if (isBed) col.setXYZ(i, 0.04, 0.05, 0.06);
        else col.setXYZ(i, 0.09, 0.1, 0.11);
      } else if (look === "depth") {
        // Cut-bank earth walls for ground deep view — never water-blue
        if (isBed) col.setXYZ(i, 0.42, 0.36, 0.26);
        else col.setXYZ(i, 0.68, 0.60, 0.44);
      } else if (isBed) col.setXYZ(i, 0.12, 0.42, 0.62);
      else col.setXYZ(i, 0.35, 0.65, 0.72);
    }
    col.needsUpdate = true;
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
    bed.setY(i, bedElevation(d, dataset.minDepth, dataset.maxDepth, across, exag));
  }
  pos.needsUpdate = true;
  bed.needsUpdate = true;
  river.mesh.geometry.computeVertexNormals();
  river.bed.geometry.computeVertexNormals();
  updateWalls(river.walls, bath, dataset, exag, rise, waterSurfaceSceneY);
}

function updateWalls(group, bath, dataset, exag, floodRiseM = 0, waterSurfaceSceneY = null) {
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
    attr.setY(i, ya);
    attr.setY(i + 1, wallTopA);
    attr.setY(i + 2, yb);
    attr.setY(i + 3, wallTopB);
    i += 4;
  }
  attr.needsUpdate = true;
  child.geometry.computeVertexNormals();
}
