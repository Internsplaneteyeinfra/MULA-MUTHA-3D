/**
 * Hydraulic Calibration & Optimization Service
 *
 * Calibrates Manning's roughness coefficient n against observed stage & discharge.
 * Inverts Manning's equation:
 *   n = (A * R^(2/3) * S^(1/2)) / Q
 *
 * When observations are unavailable or incomplete, reports UNCALIBRATED
 * and retains the VERIFIED n = 0.035 default.
 */

import { PROVENANCE_STATUS } from "./hydrologyContract.js";

export class HydraulicCalibrationService {
  constructor() {
    this.calibratedConfig = null;
    this.observationsUsed = [];
  }

  /**
   * Attempts to calibrate Manning roughness n from observed pairs of (Q, Stage)
   * @param {Array<{ q_m3s: number, stage_m: number, width_m: number, slope: number, timestamp: string }>} observationPairs
   */
  calibrateManning(observationPairs = []) {
    if (!observationPairs || observationPairs.length < 3) {
      return {
        status: "NOT_ENOUGH_OBSERVATIONS",
        message: "At least 3 simultaneous (Q, Stage) gauge observations required for defensible Manning calibration.",
        manningConfig: {
          n_channel: 0.035,
          status: PROVENANCE_STATUS.VERIFIED,
          calibrated: false,
          source: "CHOW_OPEN_CHANNEL_ROUGHNESS_RECOMMENDATION",
        },
        metrics: null,
      };
    }

    const nEstimates = [];
    for (const obs of observationPairs) {
      if (obs.q_m3s > 0 && obs.stage_m > 0 && obs.width_m > 0 && obs.slope > 0) {
        // Approximate hydraulic radius R for wide channel ~ stage_m
        const A = (2.0 / 3.0) * obs.width_m * obs.stage_m;
        const R = A / (obs.width_m + (8.0 * obs.stage_m * obs.stage_m) / (3.0 * obs.width_m));
        const n = (A * Math.pow(R, 2.0 / 3.0) * Math.sqrt(obs.slope)) / obs.q_m3s;
        if (n >= 0.020 && n <= 0.080) {
          nEstimates.push(n);
        }
      }
    }

    if (!nEstimates.length) {
      return {
        status: "CALIBRATION_FAILED_OUT_OF_BOUNDS",
        message: "Computed Manning coefficients fell outside physical bounds for natural rivers (0.02 - 0.08).",
        manningConfig: {
          n_channel: 0.035,
          status: PROVENANCE_STATUS.VERIFIED,
          calibrated: false,
          source: "CHOW_OPEN_CHANNEL_ROUGHNESS_RECOMMENDATION",
        },
        metrics: null,
      };
    }

    // Mean and standard deviation
    const meanN = nEstimates.reduce((a, b) => a + b, 0) / nEstimates.length;
    const variance = nEstimates.reduce((a, b) => a + Math.pow(b - meanN, 2), 0) / nEstimates.length;
    const stdDev = Math.sqrt(variance);

    this.calibratedConfig = {
      n_channel: Math.round(meanN * 1000) / 1000,
      status: PROVENANCE_STATUS.LIVE,
      calibrated: true,
      calibrationPeriod: `${observationPairs[0].timestamp} to ${observationPairs[observationPairs.length - 1].timestamp}`,
      observationsCount: nEstimates.length,
      standardDeviation: Math.round(stdDev * 10000) / 10000,
      confidence: nEstimates.length >= 10 ? "HIGH" : "MEDIUM",
      source: "GAUGE_STAGE_DISCHARGE_MANNING_INVERSION",
    };

    return {
      status: "CALIBRATED",
      message: `Successfully calibrated Manning n = ${this.calibratedConfig.n_channel} from ${nEstimates.length} gauge observations.`,
      manningConfig: this.calibratedConfig,
      metrics: {
        meanN: this.calibratedConfig.n_channel,
        stdDev,
        observationsUsed: nEstimates.length,
      },
    };
  }

  getCalibrationStatus() {
    return this.calibratedConfig
      ? { status: "CALIBRATED", ...this.calibratedConfig }
      : {
          status: "UNCALIBRATED",
          n_channel: 0.035,
          provenance: PROVENANCE_STATUS.VERIFIED,
          note: "Initial assumed literature parameter; awaiting simultaneous gauge stage-discharge series.",
        };
  }
}

export const hydraulicCalibrationService = new HydraulicCalibrationService();
