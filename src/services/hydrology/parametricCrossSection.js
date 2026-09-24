/**
 * Parametric Cross-Section Model for Mula–Mutha River
 *
 * NOTE: The current dataset does NOT contain true surveyed irregular 3D transects.
 * This module generates explicitly marked PARAMETRIC cross-sections from:
 *   - Bank-to-bank width W(s)
 *   - Sounding center depth d(s)
 *
 * All calculated cross-sectional areas are labelled DERIVED_FROM_PARAMETRIC_SECTION.
 * This model can be seamlessly replaced when true cross-sectional survey transects are collected.
 */

import { PROVENANCE_STATUS, createPhysicalValue } from "./hydrologyContract.js";

export const SECTION_TYPES = Object.freeze({
  PARABOLIC: "PARABOLIC",
  TRAPEZOIDAL: "TRAPEZOIDAL",
  SURVEYED_TRANSECT: "SURVEYED_TRANSECT", // Target future state
});

export class ParametricCrossSection {
  /**
   * @param {object} options
   * @param {number} options.widthM - Top width in meters (W)
   * @param {number|null} options.surveyDepthM - Bathymetric depth in meters (d)
   * @param {string} [options.type=SECTION_TYPES.PARABOLIC]
   * @param {number} [options.sideSlope=1.5] - Side slope z (horizontal:vertical) for trapezoid
   */
  constructor({ widthM, surveyDepthM, type = SECTION_TYPES.PARABOLIC, sideSlope = 1.5 }) {
    this.widthM = Math.max(4.0, Number(widthM) || 20.0);
    this.surveyDepthM = surveyDepthM != null && Number.isFinite(Number(surveyDepthM)) ? Number(surveyDepthM) : null;
    this.type = type;
    this.sideSlope = sideSlope;
  }

  /**
   * Computes wetted area A given a water depth h (m).
   * For a parabolic channel: A = (2/3) * W * h
   * For a trapezoidal channel: A = (W - z*h) * h  (with b = W - 2*z*h, min b = 0.2*W)
   * @param {number} depthM
   */
  computeWettedArea(depthM) {
    if (!Number.isFinite(depthM) || depthM <= 0) {
      return createPhysicalValue(null, "m²", PROVENANCE_STATUS.UNAVAILABLE, "PARAMETRIC_CROSS_SECTION");
    }

    let area = 0;
    if (this.type === SECTION_TYPES.PARABOLIC) {
      area = (2.0 / 3.0) * this.widthM * depthM;
    } else {
      const bottomWidth = Math.max(0.2 * this.widthM, this.widthM - 2.0 * this.sideSlope * depthM);
      area = ((this.widthM + bottomWidth) / 2.0) * depthM;
    }

    return createPhysicalValue(
      Math.round(area * 100) / 100,
      "m²",
      PROVENANCE_STATUS.DERIVED,
      `PARAMETRIC_${this.type}_SECTION`,
      null,
      "Calculated from parametric geometry; uncalibrated against surveyed irregular transects.",
    );
  }

  /**
   * Computes wetted perimeter P given a water depth h (m).
   * @param {number} depthM
   */
  computeWettedPerimeter(depthM) {
    if (!Number.isFinite(depthM) || depthM <= 0) return null;
    if (this.type === SECTION_TYPES.PARABOLIC) {
      // Approximation for shallow parabolic channel: P ≈ W + (8 * h^2) / (3 * W)
      return this.widthM + (8.0 * depthM * depthM) / (3.0 * this.widthM);
    }
    const bottomWidth = Math.max(0.2 * this.widthM, this.widthM - 2.0 * this.sideSlope * depthM);
    const sideLen = Math.sqrt(depthM * depthM + Math.pow((this.widthM - bottomWidth) / 2.0, 2));
    return bottomWidth + 2.0 * sideLen;
  }

  /**
   * Hydraulic radius R = A / P (m).
   * @param {number} depthM
   */
  computeHydraulicRadius(depthM) {
    const area = this.computeWettedArea(depthM)?.value;
    const p = this.computeWettedPerimeter(depthM);
    if (!area || !p || p <= 0) return null;
    return area / p;
  }
}
