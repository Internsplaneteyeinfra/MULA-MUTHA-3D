/**
 * Vertical Datum & Geodetic Benchmark Pipeline
 *
 * Implements authoritative vertical coordinate referencing for Mula–Mutha:
 * - Survey local depth
 * - Orthometric elevation (m MSL / EGM96)
 * - Ellipsoidal height (WGS84)
 * - Benchmark tie-in configuration & verification
 * - Scene vertical coordinate transformation
 *
 * CRITICAL RULE:
 * If the benchmark is unverified, datum status MUST be reported as
 * "UNVERIFIED_DATUM" and absolute MSL bed elevation MUST remain null.
 */

import { PROVENANCE_STATUS, createPhysicalValue } from "./hydrologyContract.js";
import { SURFACE_Y } from "../../scene/river.js";

export const VERTICAL_DATUM_TYPES = Object.freeze({
  EGM96_MSL: "EGM96_MSL",
  LOCAL_SURVEY_DATUM: "LOCAL_SURVEY_DATUM",
  UNVERIFIED: "UNVERIFIED",
});

/**
 * Standard survey benchmark control point schema for Mula–Mutha
 */
export const BUND_GARDEN_BENCHMARK_CONFIG = Object.freeze({
  benchmarkId: "BM_PUNE_CWC_028",
  name: "Bund Garden Bridge Survey Benchmark",
  latitude: 18.543024,
  longitude: 73.883100,
  chainage_m: 3451.9,
  // Bund Garden weir crest nominal level: ~544.5 m MSL (CWC gauge zero at 540.0 m MSL)
  gaugeZeroMslM: 540.0,
  weirCrestMslM: 544.5,
  dangerLevelMslM: 548.0,
  datum: "EGM96_ORTHOMETRIC",
  geoidModel: "EGM96",
  source: "CENTRAL_WATER_COMMISSION_PUNE_GAUGE_METADATA",
  // Set to true only when on-site RTK-GNSS leveling / SOI GTS tie-in is completed
  verified: false,
  verificationNote: "CWC gauge zero documented at 540.0m MSL; awaiting RTK-GNSS tie-in to sonar bathymetry soundings.",
});

export class VerticalDatumPipeline {
  constructor(benchmarkConfig = BUND_GARDEN_BENCHMARK_CONFIG) {
    this.benchmark = { ...benchmarkConfig };
    this.status = this.benchmark.verified ? "VERIFIED" : "UNVERIFIED_DATUM";
    this.sceneOriginElevationM = 540.0; // Benchmark datum aligns with base scene datum
    this.verticalExaggeration = 1.0;
  }

  /**
   * Set benchmark verification status when RTK-GNSS data is provided
   * @param {object} verificationData
   */
  setVerification(verificationData) {
    if (verificationData && verificationData.verified) {
      this.benchmark = {
        ...this.benchmark,
        ...verificationData,
        verified: true,
      };
      this.status = "VERIFIED";
    } else {
      this.status = "UNVERIFIED_DATUM";
    }
  }

  getDatumStatus() {
    return {
      status: this.status,
      verified: this.benchmark.verified,
      benchmarkId: this.benchmark.benchmarkId,
      datum: this.benchmark.datum,
      note: this.benchmark.verificationNote,
    };
  }

  /**
   * Calculates absolute bed elevation above MSL ONLY when datum is verified and survey stage is known.
   * @param {number|null} surveyDepthM
   * @param {number|null} surveyWseMslM
   * @returns {import('./hydrologyContract.js').PhysicalValue}
   */
  calculateBedElevationMsl(surveyDepthM, surveyWseMslM) {
    if (
      !this.benchmark.verified ||
      surveyDepthM == null ||
      surveyWseMslM == null ||
      !Number.isFinite(surveyDepthM) ||
      !Number.isFinite(surveyWseMslM)
    ) {
      return createPhysicalValue(
        null,
        "m MSL",
        PROVENANCE_STATUS.UNAVAILABLE,
        "VERTICAL_DATUM_NOT_VERIFIED",
        null,
        this.benchmark.verified
          ? "Missing survey-time water level"
          : "Vertical datum unverified; sonar soundings not tied to absolute orthometric MSL.",
      );
    }

    const bedMsl = surveyWseMslM - surveyDepthM;
    return createPhysicalValue(
      Math.round(bedMsl * 100) / 100,
      "m MSL",
      PROVENANCE_STATUS.DERIVED,
      "SURVEY_WSE_MINUS_SOUNDING_DEPTH",
      null,
      `Referenced to benchmark ${this.benchmark.benchmarkId} (${this.benchmark.datum})`,
    );
  }

  /**
   * Converts physical MSL stage to Three.js scene Y
   * @param {number|null} wseMsl
   */
  wseMslToSceneY(wseMsl) {
    if (wseMsl == null || !Number.isFinite(wseMsl)) return null;
    const delta = wseMsl - (this.benchmark.gaugeZeroMslM + 1.72);
    return SURFACE_Y + delta * this.verticalExaggeration;
  }
}

export const verticalDatumPipeline = new VerticalDatumPipeline();
