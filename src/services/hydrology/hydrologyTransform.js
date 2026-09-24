/**
 * Hydrology Transformation & Vertical Datum Pipeline
 *
 * Explicitly manages the conversion from physical hydrology to Three.js scene coordinates:
 *
 * physical elevation / depth
 *         ↓
 * vertical datum normalization
 *         ↓
 * project vertical scale
 *         ↓
 * scene Y
 *
 * CRITICAL:
 * Does NOT assign raw WSE MSL to Three.js Y directly.
 * Preserves the project's local origin and terrain vertical anchor.
 */

import { SURFACE_Y } from "../../scene/river.js";

/** Baseline scene datum for water surface (local meters) */
export const SCENE_WATER_DATUM_Y = SURFACE_Y; // 9.4 m in existing local frame

/** Nominal reference water depth representing the base survey baseline */
export const BASELINE_DEPTH_M = 1.72;

export class HydrologyTransform {
  /**
   * @param {object} [config]
   * @param {number} [config.baseSceneY=SURFACE_Y]
   * @param {number} [config.stageScale=1.0] - Vertical scale applied to dynamic stage fluctuations
   */
  constructor({ baseSceneY = SURFACE_Y, stageScale = 1.0 } = {}) {
    this.baseSceneY = baseSceneY;
    this.stageScale = stageScale;
  }

  /**
   * Transforms a calculated hydraulic depth h into scene water surface elevation Y.
   * When water depth increases by Δh above baseline, water surface rises by Δh * stageScale.
   *
   * @param {number|null} depthM
   * @param {number} [baselineDepthM=BASELINE_DEPTH_M]
   * @returns {number} Three.js local Y coordinate for water surface vertex
   */
  hydraulicDepthToSceneY(depthM, baselineDepthM = BASELINE_DEPTH_M) {
    if (depthM == null || !Number.isFinite(depthM)) {
      return this.baseSceneY;
    }
    const deltaH = depthM - baselineDepthM;
    // Keep stage rise smooth and bounded within physical channel limits
    const clampedDelta = Math.max(-1.5, Math.min(6.0, deltaH));
    return this.baseSceneY + clampedDelta * this.stageScale;
  }

  /**
   * Transforms physical flow velocity v (m/s) into normalized shader flow speed uniform.
   * Configuration range: 0.1 m/s (calm pool) to 3.5 m/s (monsoon freshet).
   *
   * @param {number|null} velocityMs
   * @param {number} [minV=0.2]
   * @param {number} [maxV=2.5]
   * @returns {number} Normalized shader speed uniform (0.15 to 1.25)
   */
  velocityToShaderSpeed(velocityMs, minV = 0.2, maxV = 2.5) {
    if (velocityMs == null || !Number.isFinite(velocityMs) || velocityMs <= 0) {
      return 0.45; // Default calm realistic preset speed
    }
    const norm = Math.max(0, Math.min(1, (velocityMs - minV) / (maxV - minV)));
    // Map to acceptable Three.js shader speed range
    return 0.2 + norm * 0.85;
  }
}

export const hydrologyTransform = new HydrologyTransform();
