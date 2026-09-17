/**
 * Distance-based LOD for garbage visualization.
 * FAR → marker | MEDIUM → marker+debris | NEAR → full | VERY_NEAR → +effects
 */

export const LOD = {
  FAR: "far",
  MEDIUM: "medium",
  NEAR: "near",
  VERY_NEAR: "very_near",
};

/**
 * @param {number} camY
 * @param {number} [distToTarget]
 */
export function resolveGarbageLOD(camY, distToTarget = Infinity) {
  const y = Number(camY) || 800;
  const d = Number(distToTarget) || Infinity;
  const score = Math.min(y, d * 0.85);
  if (score > 700) return LOD.FAR;
  if (score > 280) return LOD.MEDIUM;
  if (score > 90) return LOD.NEAR;
  return LOD.VERY_NEAR;
}

/** Marker world-scale vs camera altitude — compact dots in overview. */
export function markerScaleForCamera(camera) {
  if (!camera) return 1.15;
  const y = camera.position.y;
  if (y < 100) return 0.85;
  if (y < 250) return 1.05;
  if (y < 450) return 1.45;
  if (y < 800) return 2.1;
  if (y < 1400) return 2.9;
  return Math.min(5.2, y / 420);
}
