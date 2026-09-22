import * as THREE from "three";

/**
 * Rotate imported models (Z-up / X-up) so tallest axis aligns with Three.js Y-up.
 */
export function standTreeUpright(root) {
  root.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(root).getSize(size);

  if (size.y >= size.x && size.y >= size.z) return;

  if (size.z >= size.x && size.z >= size.y) {
    root.rotation.x = -Math.PI / 2;
  } else {
    root.rotation.z = Math.PI / 2;
  }
  root.updateMatrixWorld(true);
}

export function treeTargetHeight(assetId, placementScale = 1) {
  const s = Math.max(0.6, Number(placementScale) || 1);
  if (assetId === "grass") return 2.0 * s;
  if (assetId === "palm") return Math.max(9, Math.min(18, s * 12));
  if (assetId === "conifer") return Math.max(10, Math.min(20, s * 13));
  if (assetId === "birch") return Math.max(8, Math.min(15, s * 10));
  return Math.max(9, Math.min(18, s * 11.5));
}
