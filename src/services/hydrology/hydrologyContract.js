/**
 * Hydrology Observation Data Contract & Normalization
 *
 * All physical parameters strictly track scientific provenance:
 * OBSERVED | LIVE | DERIVED | INTERPOLATED | LIVE | VERIFIED | UNAVAILABLE
 *
 * DO NOT fabricate gauge readings, survey timestamps, or absolute MSL bed datums.
 */

export const PROVENANCE_STATUS = Object.freeze({
  OBSERVED: "OBSERVED",
  LIVE: "LIVE",
  DERIVED: "DERIVED",
  INTERPOLATED: "INTERPOLATED",
  LIVE: "LIVE",
  VERIFIED: "VERIFIED",
  UNAVAILABLE: "UNAVAILABLE",
});

/**
 * Creates a physical quantity with explicit provenance tracking.
 * @template T
 * @param {T|null} value
 * @param {string} unit
 * @param {keyof typeof PROVENANCE_STATUS} status
 * @param {string} source
 * @param {string|null} [timestamp=null]
 * @param {string|null} [note=null]
 */
export function createPhysicalValue(value, unit, status, source, timestamp = null, note = null) {
  const isAvailable = value !== null && Number.isFinite(Number(value));
  return {
    value: isAvailable ? Number(value) : null,
    unit,
    status: isAvailable ? status : PROVENANCE_STATUS.UNAVAILABLE,
    source,
    timestamp,
    note,
  };
}

/**
 * Normalized Gauge Station Observation Contract
 */
export function createStationObservation({
  stationId,
  stationName,
  timestamp = null,
  discharge_m3s = null,
  stage_m_msl = null,
  source = "UNKNOWN",
  status = PROVENANCE_STATUS.UNAVAILABLE,
  quality = "UNCALIBRATED",
  lat = null,
  lon = null,
}) {
  return {
    stationId,
    stationName,
    lat,
    lon,
    timestamp,
    discharge: createPhysicalValue(
      discharge_m3s,
      "m³/s",
      discharge_m3s != null ? status : PROVENANCE_STATUS.UNAVAILABLE,
      source,
      timestamp,
    ),
    stage: createPhysicalValue(
      stage_m_msl,
      "m MSL",
      stage_m_msl != null ? status : PROVENANCE_STATUS.UNAVAILABLE,
      source,
      timestamp,
    ),
    quality,
  };
}
