import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Merge mesh geometries for InstancedMesh.
 * GLB parts often mix indexed/non-indexed and differing attrs — normalize first.
 */
export function mergeMeshesForInstancing(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!Number.isFinite(size.x) || size.x <= 0) {
    throw new Error("Empty bounding box");
  }

  const prepared = [];
  let material = null;
  let best = null;
  let bestVerts = 0;

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const g = normalizeGeometry(obj.geometry, obj.matrixWorld, box, size);
    if (!g) return;
    prepared.push(g);
    const verts = g.getAttribute("position")?.count || 0;
    if (verts > bestVerts) {
      bestVerts = verts;
      best = g;
    }
    if (!material) {
      material = Array.isArray(obj.material) ? obj.material[0]?.clone() : obj.material?.clone();
    }
  });

  if (!prepared.length) throw new Error("No mesh geometries");

  let merged = null;
  if (prepared.length === 1) {
    merged = prepared[0];
  } else {
    merged = mergeGeometries(prepared, false);
    if (!merged) {
      // Keep largest part as fallback before disposing inputs
      merged = best ? best.clone() : null;
      console.warn("mergeGeometries failed — using largest mesh part");
    }
    for (const g of prepared) g.dispose();
  }

  if (!merged?.getAttribute("position")) {
    throw new Error("Empty geometry after merge");
  }

  if (!merged.getAttribute("normal")) {
    merged.computeVertexNormals();
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  return {
    geometry: merged,
    material:
      material ||
      new THREE.MeshStandardMaterial({ color: "#b4aea8", roughness: 0.88, metalness: 0.04 }),
    nativeW: size.x,
    nativeD: size.z,
    nativeH: size.y,
  };
}

function normalizeGeometry(source, matrixWorld, box, size) {
  let g = source.clone();
  if (g.index) g = g.toNonIndexed();
  g.applyMatrix4(matrixWorld);
  g.translate(-box.min.x - size.x * 0.5, -box.min.y, -box.min.z - size.z * 0.5);

  // Keep only attributes every BufferGeometry shares for a clean merge
  const keep = new Set(["position", "normal"]);
  for (const name of Object.keys(g.attributes)) {
    if (!keep.has(name)) g.deleteAttribute(name);
  }
  g.clearGroups();
  if (!g.getAttribute("normal")) g.computeVertexNormals();

  const pos = g.getAttribute("position");
  if (!pos || pos.count < 3) {
    g.dispose();
    return null;
  }
  return g;
}
