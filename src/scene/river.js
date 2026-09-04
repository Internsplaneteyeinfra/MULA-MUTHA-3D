import * as THREE from "three";
import { createWaterMaterial } from "./waterShader.js";
import { state } from "../state.js";

export const SURFACE_Y = 9.4;
/** Minimum metres the riverbed stays below the water surface (prevents poke-through). */
const MIN_BED_SEPARATION = 0.45;

/**
 * Bed Y = waterSurfaceZ − depth × verticalExaggeration.
 * Always strictly below SURFACE_Y.
 */
export function depthNorm(d, minD, maxD) {
  return THREE.MathUtils.clamp((d - minD) / Math.max(0.001, maxD - minD), 0, 1);
}

export function bedElevation(d, _minD, _maxD, _acrossU, exag) {
  const y = SURFACE_Y - Math.max(d, 0.15) * Math.max(1, exag);
  return Math.min(y, SURFACE_Y - MIN_BED_SEPARATION);
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
  const sand = new THREE.Color("#1a3a44");
  const silt = new THREE.Color("#0c2230");
  const deep = new THREE.Color("#050e18");
  const tmp = new THREE.Color();

  for (let i = 0; i < n; i++) {
    const d = bath.depths[i];
    surfPos[i * 3 + 1] = SURFACE_Y;
    bedPos[i * 3 + 1] = bedElevation(d, dataset.minDepth, dataset.maxDepth, 0.5, exag);
    const t = depthNorm(d, dataset.minDepth, dataset.maxDepth);
    tmp.copy(sand).lerp(silt, THREE.MathUtils.smoothstep(0.15, 0.55, t));
    tmp.lerp(deep, THREE.MathUtils.smoothstep(0.45, 1, t));
    bedCol[i * 3] = tmp.r;
    bedCol[i * 3 + 1] = tmp.g;
    bedCol[i * 3 + 2] = tmp.b;
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
  // One continuous surface — avoid z-fight with bed / walls
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;

  const bedGeo = new THREE.BufferGeometry();
  bedGeo.setAttribute("position", new THREE.Float32BufferAttribute(bedPos, 3));
  bedGeo.setAttribute("color", new THREE.Float32BufferAttribute(bedCol, 3));
  bedGeo.setAttribute("colorLand", new THREE.Float32BufferAttribute(bedCol.slice(), 3));
  bedGeo.setAttribute("aDepth", new THREE.Float32BufferAttribute(bath.depths, 1));
  const cutCol = new Float32Array(n * 3);
  const cShallow = new THREE.Color("#0a3040");
  const cDeep = new THREE.Color("#020814");
  for (let i = 0; i < n; i++) {
    const t = depthNorm(bath.depths[i], dataset.minDepth, dataset.maxDepth);
    tmp.copy(cShallow).lerp(cDeep, t);
    cutCol[i * 3] = tmp.r;
    cutCol[i * 3 + 1] = tmp.g;
    cutCol[i * 3 + 2] = tmp.b;
  }
  bedGeo.setAttribute("colorCut", new THREE.Float32BufferAttribute(cutCol, 3));
  bedGeo.setIndex(bath.indices);
  bedGeo.computeVertexNormals();
  const bed = new THREE.Mesh(
    bedGeo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    }),
  );
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
    const ya = bedElevation(bath.depths[a], dataset.minDepth, dataset.maxDepth, 0.5, exag);
    const yb = bedElevation(bath.depths[b], dataset.minDepth, dataset.maxDepth, 0.5, exag);
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

export function applyRiverLook(river, cutaway) {
  const from = river.bed.geometry.getAttribute(cutaway ? "colorCut" : "colorLand");
  const to = river.bed.geometry.getAttribute("color");
  if (from && to) {
    to.array.set(from.array);
    to.needsUpdate = true;
  }
  for (const child of river.walls.children) {
    const col = child.geometry.attributes.color;
    for (let i = 0; i < col.count; i++) {
      const isBed = i % 4 === 0 || i % 4 === 2;
      if (!cutaway) col.setXYZ(i, 0.42, 0.36, 0.24);
      else if (isBed) col.setXYZ(i, 0.04, 0.2, 0.36);
      else col.setXYZ(i, 0.2, 0.55, 0.62);
    }
    col.needsUpdate = true;
    child.material.transparent = cutaway;
    child.material.opacity = cutaway ? 0.86 : 1;
    child.material.needsUpdate = true;
  }
  river.bed.material.roughness = cutaway ? 0.52 : 0.92;
  river.bed.material.metalness = cutaway ? 0.2 : 0.04;
}

export function applyExaggeration(river, dataset, exag, floodRiseM = 0) {
  const bath = river.bathymetry;
  const pos = river.mesh.geometry.attributes.position;
  const bed = river.bed.geometry.attributes.position;
  const rise = Math.max(0, Number(floodRiseM) || 0);
  const floodY = SURFACE_Y + rise;
  for (let i = 0; i < bath.depths.length; i++) {
    const d = bath.depths[i];
    pos.setY(i, floodY);
    bed.setY(i, bedElevation(d, dataset.minDepth, dataset.maxDepth, 0.5, exag));
  }
  pos.needsUpdate = true;
  bed.needsUpdate = true;
  river.mesh.geometry.computeVertexNormals();
  river.bed.geometry.computeVertexNormals();
  updateWalls(river.walls, bath, dataset, exag, rise);
}

function updateWalls(group, bath, dataset, exag, floodRiseM = 0) {
  const child = group.children[0];
  if (!child) return;
  const attr = child.geometry.attributes.position;
  const wallTop = SURFACE_Y + Math.max(0, floodRiseM) - 0.08;
  let i = 0;
  for (const [a, b] of bath.boundary) {
    const ya = bedElevation(bath.depths[a], dataset.minDepth, dataset.maxDepth, 0.5, exag);
    const yb = bedElevation(bath.depths[b], dataset.minDepth, dataset.maxDepth, 0.5, exag);
    attr.setY(i, ya);
    attr.setY(i + 1, wallTop);
    attr.setY(i + 2, yb);
    attr.setY(i + 3, wallTop);
    i += 4;
  }
  attr.needsUpdate = true;
  child.geometry.computeVertexNormals();
}
