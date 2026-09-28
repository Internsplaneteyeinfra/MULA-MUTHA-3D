/**
 * Scanned garbage pile GLBs (source scans: src/data/Garbage, web copies built by
 * `npm run convert:garbage` into public/assets/garbage).
 */
import * as THREE from "three";
import { loadGltf } from "../../utils/gltfLoader.js";

function garbageAssetUrl(file) {
  const base = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
  const root = String(base).endsWith("/") ? base : `${base}/`;
  return `${root}assets/garbage/${file}`;
}

export const GARBAGE_MODELS = {
  trash: { url: garbageAssetUrl("trash_pile.glb") },
  ewaste: { url: garbageAssetUrl("ewaste_pile.glb") },
};

const cache = new Map();

/**
 * Load one pile as a single reusable prototype: geometry centred in XZ with its
 * base at y = 0, plus the native footprint (largest horizontal extent, metres).
 * @param {"trash"|"ewaste"} id
 * @returns {Promise<{ geometry: THREE.BufferGeometry, material: THREE.Material, footprint: number, height: number }>}
 */
export function loadGarbageModel(id) {
  if (cache.has(id)) return cache.get(id);
  const p = loadGltf(GARBAGE_MODELS[id].url).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    let src = null;
    gltf.scene.traverse((o) => {
      if (!src && o.isMesh) src = o;
    });
    if (!src) throw new Error(`garbage model ${id} has no mesh`);
    const geometry = src.geometry.clone();
    geometry.applyMatrix4(src.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const c = box.getCenter(new THREE.Vector3());
    geometry.translate(-c.x, -box.min.y, -c.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());

    const material = src.material.clone();
    material.side = THREE.DoubleSide;
    material.color.multiplyScalar(1.3);
    if (!material.metalnessMap) {
      material.metalness = 0;
      material.roughness = 0.95;
    }
    return { geometry, material, footprint: Math.max(size.x, size.z), height: size.y };
  });
  cache.set(id, p);
  p.catch(() => cache.delete(id));
  return p;
}
