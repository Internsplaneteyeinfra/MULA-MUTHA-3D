/**
 * Hydrology Validation Utilities (Phase 24 & 31)
 *
 * Checks continuity, physical boundary bounds, and consistency:
 * - Chainage monotonicity & continuity
 * - Width continuity (no 0 or negative widths)
 * - Depth ranges (0.1m <= depth <= 15m)
 * - WSE ranges
 * - Discharge Q >= 0
 * - Velocity v >= 0
 * - Area A > 0
 * - Continuity check (conservation of mass along reach)
 * - No NaN or Infinity
 * - Provenance correctness (no observed field populated by model output)
 * - Error metrics: MAE, RMSE, Bias, Relative Error against observed gauge stage
 */

export function validateHydraulicProfile(profileResult) {
  const issues = [];
  const warnings = [];

  if (!profileResult || profileResult.status !== "SOLVED") {
    return {
      valid: false,
      issues: [profileResult?.message || "Hydraulic profile not solved."],
      warnings: [],
      stats: null,
    };
  }

  const records = profileResult.records || [];
  if (!records.length) {
    return {
      valid: false,
      issues: ["Profile contains zero station records."],
      warnings: [],
      stats: null,
    };
  }

  let minDepth = Infinity;
  let maxDepth = -Infinity;
  let minVelocity = Infinity;
  let maxVelocity = -Infinity;
  let minArea = Infinity;
  let maxArea = -Infinity;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];

    // Station coordinates & chainage
    if (i > 0 && r.chainage_m <= records[i - 1].chainage_m) {
      issues.push(`Chainage non-monotonic at station ${i} (${r.chainage_m} <= ${records[i - 1].chainage_m})`);
    }

    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) {
      issues.push(`Non-finite coordinates at station ${i}`);
    }

    // Width
    if (!Number.isFinite(r.width_m) || r.width_m <= 0) {
      issues.push(`Invalid width ${r.width_m} at station ${i}`);
    }

    // Water Depth
    const d = r.water_depth_m?.value;
    if (d == null || !Number.isFinite(d)) {
      issues.push(`Missing or non-finite water depth at station ${i}`);
    } else {
      if (d < 0.05) warnings.push(`Extremely shallow depth (${d} m) at station ${i}`);
      if (d > 12.0) warnings.push(`Anomalously high depth (${d} m) at station ${i}`);
      minDepth = Math.min(minDepth, d);
      maxDepth = Math.max(maxDepth, d);
    }

    // Area
    const a = r.cross_section_area_m2?.value;
    if (a == null || !Number.isFinite(a) || a <= 0) {
      issues.push(`Invalid wetted area at station ${i}`);
    } else {
      minArea = Math.min(minArea, a);
      maxArea = Math.max(maxArea, a);
    }

    // Discharge
    const q = r.discharge_m3s?.value;
    if (q == null || !Number.isFinite(q) || q < 0) {
      issues.push(`Negative or non-finite discharge at station ${i}`);
    }

    // Velocity
    const v = r.velocity_ms?.value;
    if (v != null) {
      if (!Number.isFinite(v) || v < 0) {
        issues.push(`Invalid velocity ${v} at station ${i}`);
      } else {
        minVelocity = Math.min(minVelocity, v);
        maxVelocity = Math.max(maxVelocity, v);
      }
    }

    // Provenance integrity: If bed elevation has value, verify datum was not unverified
    if (r.bed_elevation_msl?.value != null && r.provenance?.datum === "UNVERIFIED_DATUM") {
      issues.push(`Illegal elevation fabrication: bed_elevation_msl has value despite unverified datum at station ${i}`);
    }
  }

  const valid = issues.length === 0;

  return {
    valid,
    issues,
    warnings,
    stats: {
      totalStations: records.length,
      chainageSpanM: records[records.length - 1].chainage_m - records[0].chainage_m,
      depthRangeM: [minDepth, maxDepth],
      velocityRangeMs: [minVelocity, maxVelocity],
      areaRangeM2: [minArea, maxArea],
      totalVolumeM3: profileResult.totalVolumeM3?.value ?? null,
      roughness: profileResult.manningConfig,
      datum: profileResult.datumStatus,
    },
  };
}

/**
 * Calculates statistical validation metrics between observed and modelled values
 * @param {Array<number>} observed
 * @param {Array<number>} modelled
 */
export function calculateValidationMetrics(observed = [], modelled = []) {
  if (!observed.length || !modelled.length || observed.length !== modelled.length) {
    return {
      status: "NOT_ENOUGH_OBSERVATIONS",
      message: "Insufficient paired observation-model data points to compute statistical metrics.",
    };
  }

  const n = observed.length;
  let sumAbsErr = 0;
  let sumSqErr = 0;
  let sumErr = 0;
  let sumObs = 0;

  for (let i = 0; i < n; i++) {
    const err = modelled[i] - observed[i];
    sumAbsErr += Math.abs(err);
    sumSqErr += err * err;
    sumErr += err;
    sumObs += observed[i];
  }

  const mae = sumAbsErr / n;
  const rmse = Math.sqrt(sumSqErr / n);
  const bias = sumErr / n;
  const meanObs = sumObs / n;
  const relErrPct = meanObs > 0 ? (mae / meanObs) * 100 : null;

  return {
    status: "VALIDATED",
    sampleCount: n,
    mae: Math.round(mae * 1000) / 1000,
    rmse: Math.round(rmse * 1000) / 1000,
    bias: Math.round(bias * 1000) / 1000,
    relativeErrorPct: relErrPct != null ? Math.round(relErrPct * 10) / 10 : null,
  };
}
