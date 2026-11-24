/**
 * Rainfall Simulation schemas / defaults.
 * Assumptions are documented — not field-calibrated (ASSUMED / UNCALIBRATED).
 */

/**
 * Direct-draining twin-corridor catchment used for event runoff (ASSUMED).
 * Not the full upper-basin area — sized so stage response stays plausible on the
 * local Mula–Mutha AOI channel (separate from liveHydrologyService’s 2000 km² fallback).
 */
export const CATCHMENT_AREA_KM2 = 150;

/** Rational / SCS-style runoff coefficient (ASSUMED — Mula–Mutha urbanising basin). */
export const RUNOFF_COEFFICIENT = 0.45;

/** SCS Curve Number for loss model (ASSUMED CN=70 → moderate soils / mixed land use). */
export const CURVE_NUMBER = 70;

/** Catchment lag / travel time to river (hours) — matches liveHydrologyService. */
export const LAG_TIME_HOURS = 2.0;

/** Baseflow when live Q unavailable (m³/s). */
export const BASEFLOW_DRY_M3S = 15;
export const BASEFLOW_MONSOON_M3S = 35;

/** Vertical datum label for HUD. */
export const VERTICAL_DATUM = "scene relative · hydraulic depth vs baseline 1.72 m";

/**
 * Modeled twin-corridor reach length used for volume / affected-length (ASSUMED AOI).
 * Matches approxReachVolume length in the engine — not floodplain extent.
 */
export const REACH_LENGTH_M = 16800;

/**
 * Minimum measurable stage rise (m) for counting a river section as “affected”
 * (ASSUMED display threshold — not gauge-calibrated).
 */
export const STAGE_AFFECTED_MIN_M = 0.02;

/**
 * Absolute cap on total hydrological simulation length (storm + response).
 * Documented maximum horizon — not every event uses this full length.
 */
export const MAX_SIM_HORIZON_HOURS = 36;

/**
 * Direct-runoff fraction of peak at which the river is treated as stabilized
 * (ASSUMED criterion — not gauge-calibrated).
 */
export const STABILIZE_Q_FRAC = 0.02;

/** Consecutive timesteps below stabilize threshold required. */
export const STABILIZE_HOLD_STEPS = 3;

/**
 * Wall-clock mapping at 1×: storm duration hours → 5 real minutes.
 * Playback speed only changes wall-clock pacing — not hydrological results.
 */
export const REAL_MINUTES_FOR_STORM_AT_1X = 5;

/** Preset playback multipliers relative to 1× base mapping. */
export const PLAYBACK_SPEED_PRESETS = Object.freeze([1, 5, 10, 30]);

export const SIM_STATUSES = Object.freeze({
  READY: "READY",
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
});

/** Live hydrological phase labels (derived from model state). */
export const PHASE_STATUSES = Object.freeze({
  READY: "READY",
  RAINING: "RAINING",
  RUNOFF_ROUTING: "RUNOFF ROUTING",
  RIVER_RISING: "RIVER RISING",
  PEAK_RESPONSE: "PEAK RESPONSE",
  RIVER_RECESSION: "RIVER RECESSION",
  STABILIZED: "STABILIZED",
  PAUSED: "PAUSED",
  /** Completed at max horizon without meeting stabilize criterion */
  HORIZON_REACHED: "HORIZON REACHED",
});

/**
 * @typedef {object} RainfallEventInput
 * @property {number} depthMm
 * @property {number} durationHours
 * @property {"uniform"} [distribution]
 * @property {number} [baseflowM3s]
 * @property {number} [dtHours]
 * @property {number|null} [recessionHours]  null = auto from UH / stabilize
 * @property {number} [playbackSpeed]
 */

/**
 * 1× playback: sim-hours per real second so storm duration maps to ~5 minutes.
 * @param {number} durationHours
 */
export function basePlaybackHoursPerSec(durationHours) {
  const stormH = Math.max(1, Number(durationHours) || 1);
  return stormH / (REAL_MINUTES_FOR_STORM_AT_1X * 60);
}

/**
 * Validate and normalise user inputs.
 * @param {Partial<RainfallEventInput>} raw
 * @returns {RainfallEventInput}
 */
export function normalizeRainfallInput(raw = {}) {
  const depthMm = clamp(Number(raw.depthMm), 0, 100);
  const durationHours = clamp(Number(raw.durationHours), 1, 24);
  const distribution = raw.distribution === "uniform" ? "uniform" : "uniform";
  const baseflowM3s = Number.isFinite(Number(raw.baseflowM3s))
    ? Math.max(0, Number(raw.baseflowM3s))
    : null;
  const dtHours = clamp(Number(raw.dtHours) || 0.25, 0.1, 1);
  // null → engine chooses post-rain horizon from UH + stabilize (not a fixed 8–10 h).
  let recessionHours = null;
  if (raw.recessionHours != null && Number.isFinite(Number(raw.recessionHours))) {
    recessionHours = clamp(Number(raw.recessionHours), 1, 48);
  }
  const playbackSpeed = clamp(Number(raw.playbackSpeed) || 1, 0.1, 120);
  return {
    depthMm,
    durationHours,
    distribution,
    baseflowM3s,
    dtHours,
    recessionHours,
    playbackSpeed,
  };
}

/**
 * Derive phase from actual sample trajectory (not fixed time buckets).
 */
export function derivePhase({
  status,
  tHours,
  stormEndHours,
  timeToPeakHours,
  lagHours = LAG_TIME_HOURS,
  raining = false,
  deltaStageM = 0,
  prevDeltaStageM = null,
  Q_m3s = null,
  peakQm3s = null,
  baseflowM3s = null,
  dtHours = 0.25,
  stabilized = false,
  maxHorizonReached = false,
}) {
  if (status === SIM_STATUSES.READY) return PHASE_STATUSES.READY;
  if (status === SIM_STATUSES.PAUSED) return PHASE_STATUSES.PAUSED;

  const t = Number(tHours) || 0;
  const stormEnd = Number(stormEndHours) || 0;
  const peakT = Number.isFinite(Number(timeToPeakHours))
    ? Number(timeToPeakHours)
    : stormEnd + (Number(lagHours) || LAG_TIME_HOURS);
  const dt = Math.max(0.05, Number(dtHours) || 0.25);
  const lag = Number(lagHours) || LAG_TIME_HOURS;

  if (status === SIM_STATUSES.COMPLETED) {
    if (stabilized) return PHASE_STATUSES.STABILIZED;
    if (maxHorizonReached) return PHASE_STATUSES.HORIZON_REACHED;
    return PHASE_STATUSES.STABILIZED;
  }

  if (raining || t < stormEnd - 1e-9) return PHASE_STATUSES.RAINING;

  // Stabilized: direct runoff nearly gone
  const bf = Number(baseflowM3s);
  const peakQ = Number(peakQm3s);
  if (
    Number.isFinite(Q_m3s) &&
    Number.isFinite(bf) &&
    Number.isFinite(peakQ) &&
    peakQ > bf + 1e-3
  ) {
    const frac = (Q_m3s - bf) / (peakQ - bf);
    if (t >= peakT && frac <= STABILIZE_Q_FRAC) return PHASE_STATUSES.STABILIZED;
  }
  if (stabilized && t >= peakT) return PHASE_STATUSES.STABILIZED;

  // Peak window from model time-to-peak
  if (Math.abs(t - peakT) <= dt * 0.75) return PHASE_STATUSES.PEAK_RESPONSE;

  const rising =
    prevDeltaStageM == null
      ? t < peakT
      : Number(deltaStageM) >= Number(prevDeltaStageM) - 1e-5;

  if (t < peakT || rising) {
    // Delayed runoff still arriving after rain
    if (t < stormEnd + lag) return PHASE_STATUSES.RUNOFF_ROUTING;
    return PHASE_STATUSES.RIVER_RISING;
  }

  return PHASE_STATUSES.RIVER_RECESSION;
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
