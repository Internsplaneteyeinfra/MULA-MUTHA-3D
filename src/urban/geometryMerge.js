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

  // mergeGeometries requires matching attribute sets — strip UV/color if not shared by all
  const allHaveUv = prepared.every((g) => !!g.getAttribute("uv"));
  const allHaveColor = prepared.every((g) => !!g.getAttribute("color"));
  if (!allHaveUv || !allHaveColor) {
    for (const g of prepared) {
      if (!allHaveUv) g.deleteAttribute("uv");
      if (!allHaveUv) g.deleteAttribute("uv1");
      if (!allHaveColor) g.deleteAttribute("color");
    }
  }

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
    for (const g of prepared) {
      if (g !== merged) g.dispose();
    }
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

  // Meshopt + KHR_mesh_quantization store POSITION as normalized Int16 in [-1,1]
  // with real scale on the node matrix. BufferGeometry.applyMatrix4 writes back
  // through setXYZ which re-quantizes/clamps → everything becomes a ~2×2×2 cube.
  // Expand to Float32 first so the world matrix (incl. scale) bakes correctly.
  dequantizeAttributes(g);

  g.applyMatrix4(matrixWorld);
  g.translate(-box.min.x - size.x * 0.5, -box.min.y, -box.min.z - size.z * 0.5);

  // Keep UV when present so textured tree GLBs stay detailed; drop exotic attrs for merge.
  const keep = new Set(["position", "normal", "uv", "uv1", "color"]);
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

/**
 * Convert quantized / non-float buffer attributes to Float32 so matrix bakes work.
 * getX/getY/getZ already return decoded floats for normalized integer attrs.
 */
function dequantizeAttributes(geometry) {
  for (const name of ["position", "normal", "color", "uv", "uv1"]) {
    const attr = geometry.getAttribute(name);
    if (!attr) continue;
    const needsExpand =
      attr.normalized ||
      !(attr.array instanceof Float32Array) ||
      attr.array instanceof Float64Array;
    if (!needsExpand) continue;

    const itemSize = attr.itemSize;
    const count = attr.count;
    const out = new Float32Array(count * itemSize);
    for (let i = 0; i < count; i++) {
      const o = i * itemSize;
      if (itemSize >= 1) out[o] = attr.getX(i);
      if (itemSize >= 2) out[o + 1] = attr.getY(i);
      if (itemSize >= 3) out[o + 2] = attr.getZ(i);
      if (itemSize >= 4) out[o + 3] = attr.getW(i);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
  }
}

