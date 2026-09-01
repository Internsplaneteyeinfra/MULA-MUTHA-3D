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
  if (assetId === "grass") return 1.2 * placementScale;
  return Math.max(5, Math.min(16, placementScale * 8));
}
