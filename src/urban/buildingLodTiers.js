/**
 * Camera-distance LOD — all tiers stay visible with height; never flat footprints.
 */
import * as THREE from "three";
import { LOD as LOD_CONST } from "./buildingLodConstants.js";

export { LOD_CONST as LOD };

export function corridorTier(distM, classification) {
  if (distM <= LOD_CONST.HERO_M || (classification?.tier <= 2 && distM <= 500)) return "hero";
  if (distM <= LOD_CONST.NEAR_M) return "near";
  if (distM <= LOD_CONST.MID_M) return "mid";
  return "distant";
}

const _camPos = new THREE.Vector3();

export function cacheLodGroupCenters(buildingRoot) {
  if (!buildingRoot?.userData?.lod) return;
  const { hero, near, mid, distant, hlod } = buildingRoot.userData.lod;
  buildingRoot.userData.lodCenters = {
    hero: centerOf(hero),
    near: centerOf(near),
    mid: centerOf(mid),
    distant: centerOf(distant),
    hlod: centerOf(hlod),
  };
}

function centerOf(group) {
  if (!group) return null;
  if (group.userData.lodCenter) return group.userData.lodCenter;
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return null;
  const c = box.getCenter(new THREE.Vector3());
  group.userData.lodCenter = c;
  return c;
}

/**
 * Every OSM footprint tier stays visible with full opacity.
 * HLOD supplements distant skyline only when camera is high.
 */
export function updateBuildingLodVisibility(buildingRoot, camera) {
  if (!buildingRoot?.userData?.lod) return;
  const { hlod } = buildingRoot.userData.lod;
  if (hlod) {
    const camH = camera.position.y;
    hlod.visible = camH > 1600;
  }
}
