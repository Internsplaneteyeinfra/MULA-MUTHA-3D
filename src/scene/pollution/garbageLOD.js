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

/** Marker world-scale vs camera altitude (readable in 2D overview). */
export function markerScaleForCamera(camera) {
  if (!camera) return 1.4;
  const y = camera.position.y;
  if (y < 100) return 1.0;
  if (y < 250) return 1.35;
  if (y < 450) return 2.0;
  if (y < 800) return 3.0;
  if (y < 1400) return 4.2;
  return Math.min(8.5, y / 280);
}
