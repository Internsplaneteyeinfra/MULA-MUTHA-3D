import * as THREE from "three";
import { SURFACE_Y } from "./river.js";

const TOP_Y = SURFACE_Y - 0.05;
const BED_LIFT = 0.06;

/**
 * Water column only under the clipped river mesh (LULC + OSM water).
 * Does not widen the river — surface extent stays the original hydrology water.
 */
export function createWaterFill(_terrainMesh, river) {
  const surfGeo = river?.mesh?.geometry;
  const bedGeo = river?.bed?.geometry;
  const sAttr = surfGeo?.attributes?.position;
  const index = surfGeo?.index;
  if (!sAttr || !index) return null;

  const sPos = sAttr.array;
  const bPos = bedGeo?.attributes?.position?.array;
  const idx = index.array;
  const n = sAttr.count;
  if (n < 3 || idx.length < 3) return null;

  const pos = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const x = sPos[i * 3];
    const z = sPos[i * 3 + 2];
    let bot = bPos && bPos.length >= (i + 1) * 3 ? bPos[i * 3 + 1] : TOP_Y - 1.2;
    if (!Number.isFinite(bot)) bot = TOP_Y - 1.2;
    bot = Math.min(bot + BED_LIFT, TOP_Y - 0.12);
    pos[i * 3] = x;
    pos[i * 3 + 1] = TOP_Y;
    pos[i * 3 + 2] = z;
    pos[(n + i) * 3] = x;
    pos[(n + i) * 3 + 1] = bot;
    pos[(n + i) * 3 + 2] = z;
  }

  const tris = [];
  // Bottom only + bank walls. No extra top sheet — river.mesh is the original surface.
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    tris.push(a + n, c + n, b + n);
  }

  const edgeCount = new Map();
  const addEdge = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const e = edgeCount.get(key) || { a, b, count: 0 };
    e.count++;
    edgeCount.set(key, e);
  };
  for (let t = 0; t < idx.length; t += 3) {
    addEdge(idx[t], idx[t + 1]);
    addEdge(idx[t + 1], idx[t + 2]);
    addEdge(idx[t + 2], idx[t]);
  }
  for (const { a, b, count } of edgeCount.values()) {
    if (count !== 1) continue;
    tris.push(a, b, b + n, a, b + n, a + n);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(tris);
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x187a9c,
    roughness: 0.22,
    metalness: 0,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "riverWaterVolume";
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  console.info("[water-fill] column under original river surface", {
    verts: n,
    tris: tris.length / 3,
  });
  return mesh;
}
