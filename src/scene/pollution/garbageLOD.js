/**
 * Distance-based LOD for garbage visualization.
 * FAR → marker | MEDIUM → marker+debris | NEAR → full | VERY_NEAR → +effects
 * Adjusted thresholds for better visibility at normal camera distances
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
  // Adjusted thresholds for better garbage visibility
  if (score > 900) return LOD.FAR;        // Increased from 700
  if (score > 350) return LOD.MEDIUM;     // Increased from 280
  if (score > 120) return LOD.NEAR;       // Increased from 90
  return LOD.VERY_NEAR;
}

/** Marker world-scale vs camera altitude — keep markers small. */
export function markerScaleForCamera(camera) {
  if (!camera) return 0.8;
  const y = camera.position.y;
  // Adjusted scaling for better marker visibility while keeping them small
  if (y < 120) return 0.7;    // Increased from 0.6
  if (y < 280) return 0.8;    // Increased from 0.7
  if (y < 500) return 1.0;    // Increased from 0.9
  if (y < 900) return 1.3;    // Increased from 1.2
  if (y < 1600) return 1.6;   // Increased from 1.5
  return Math.min(2.8, y / 520); // Slightly increased maximum
}
