/**
 * In-memory rainfall simulation session manager (browser + Node-compatible).
 * Separate from flood simulation state.
 *
 * Simulation clock advances in model hours. Playback does not stop when rainfall
 * ends — runoff routing, river rise, and recession continue until series end.
 */
import {
  buildRainfallResponseSeries,
  sampleAtTime,
  sampleBeforeTime,
  buildSimulationResult,
} from "./engine.js";
import {
  SIM_STATUSES,
  PHASE_STATUSES,
  normalizeRainfallInput,
  VERTICAL_DATUM,
  basePlaybackHoursPerSec,
  derivePhase,
  LAG_TIME_HOURS,
} from "./schemas.js";

let _seq = 0;
/** @type {Map<string, object>} */
const sessions = new Map();

function newId() {
  _seq += 1;
  return `rain-${Date.now().toString(36)}-${_seq}`;
}

function applySpeed(s, multiplier) {
  const mult = Math.max(0.1, Math.min(120, Number(multiplier) || 1));
  s.playbackMultiplier = mult;
  s.playbackSpeedHoursPerSec = basePlaybackHoursPerSec(s.input.durationHours) * mult;
}

/**
 * @param {import("./schemas.js").RainfallEventInput & { reachGeometry?: object }} input
 */
export function startSimulation(input) {
  const cfg = normalizeRainfallInput(input);
  const reachGeometry = input.reachGeometry || null;
  const series = buildRainfallResponseSeries(cfg, { reachGeometry });
  const id = newId();
  const session = {
    id,
    status: SIM_STATUSES.RUNNING,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    input: cfg,
    meta: series.meta,
    samples: series.samples,
    peak: series.peak,
    reachGeometry,
    /** Simulation clock (hours along series) — continues after rainfall ends. */
    tHours: 0,
    playbackMultiplier: cfg.playbackSpeed,
    playbackSpeedHoursPerSec: 0,
    pausedAt: null,
    lastTickWall: Date.now(),
    verticalDatum: VERTICAL_DATUM,
  };
  applySpeed(session, cfg.playbackSpeed);
  sessions.set(id, session);
  return snapshot(session);
}

/**
 * Recalculate series for a running/paused session (new depth/duration).
 */
export function updateSimulation(id, patch = {}) {
  const s = sessions.get(id);
  if (!s) throw notFound(id);
  const cfg = normalizeRainfallInput({ ...s.input, ...patch });
  if (patch.reachGeometry) s.reachGeometry = patch.reachGeometry;
  const series = buildRainfallResponseSeries(cfg, { reachGeometry: s.reachGeometry });
  s.input = cfg;
  s.meta = series.meta;
  s.samples = series.samples;
  s.peak = series.peak;
  s.tHours = Math.min(s.tHours, series.samples[series.samples.length - 1].tHours);
  applySpeed(s, patch.playbackSpeed != null ? cfg.playbackSpeed : s.playbackMultiplier);
  s.updatedAt = Date.now();
  if (s.status === SIM_STATUSES.COMPLETED) s.status = SIM_STATUSES.RUNNING;
  s.lastTickWall = Date.now();
  return snapshot(s);
}

export function setPlaybackSpeed(id, multiplier) {
  const s = sessions.get(id);
  if (!s) throw notFound(id);
  advance(s);
  applySpeed(s, multiplier);
  s.input.playbackSpeed = s.playbackMultiplier;
  s.updatedAt = Date.now();
  return snapshot(s);
}

export function getStatus(id) {
  const s = sessions.get(id);
  if (!s) throw notFound(id);
  advance(s);
  return snapshot(s);
}

export function pauseSimulation(id) {
  const s = sessions.get(id);
  if (!s) throw notFound(id);
  advance(s);
  if (s.status === SIM_STATUSES.RUNNING) {
    s.status = SIM_STATUSES.PAUSED;
    s.pausedAt = Date.now();
    s.updatedAt = Date.now();
  }
  return snapshot(s);
}

export function resumeSimulation(id) {
  const s = sessions.get(id);
  if (!s) throw notFound(id);
  if (s.status === SIM_STATUSES.PAUSED) {
    s.status = SIM_STATUSES.RUNNING;
    s.lastTickWall = Date.now();
    s.pausedAt = null;
    s.updatedAt = Date.now();
  }
  return snapshot(s);
}

export function resetSimulation(id) {
  const s = sessions.get(id);
  if (!s) throw notFound(id);
  s.tHours = 0;
  s.status = SIM_STATUSES.READY;
  s.lastTickWall = Date.now();
  s.pausedAt = null;
  s.updatedAt = Date.now();
  return snapshot(s);
}

/** Advance simulation clock from wall time (frozen while paused). */
function advance(s) {
  if (s.status !== SIM_STATUSES.RUNNING) return;
  const now = Date.now();
  const dtSec = Math.max(0, (now - s.lastTickWall) / 1000);
  s.lastTickWall = now;
  const end = s.samples[s.samples.length - 1]?.tHours ?? 0;
  s.tHours = Math.min(end, s.tHours + dtSec * s.playbackSpeedHoursPerSec);
  s.updatedAt = now;
  if (s.tHours >= end - 1e-6) {
    s.tHours = end;
    s.status = SIM_STATUSES.COMPLETED;
  }
}

function snapshot(s) {
  advance(s);
  const current = sampleAtTime(s.samples, s.tHours);
  const prev = sampleBeforeTime(s.samples, s.tHours);
  const stormEnd = s.input.durationHours;
  const totals = s.meta?.totals || {};
  const raining = !!(current && current.rainMmHr > 0 && s.tHours < stormEnd - 1e-9);
  const phase = derivePhase({
    status: s.status,
    tHours: s.tHours,
    stormEndHours: stormEnd,
    timeToPeakHours: totals.timeToPeakHours,
    lagHours: s.meta?.assumptions?.lagHours ?? LAG_TIME_HOURS,
    raining,
    deltaStageM: current?.deltaStageM,
    prevDeltaStageM: prev?.deltaStageM,
    Q_m3s: current?.Q_m3s,
    peakQm3s: totals.peakQm3s,
    baseflowM3s: s.meta?.input?.baseflowM3s,
    dtHours: s.input.dtHours,
    stabilized: !!totals.stabilized,
    maxHorizonReached: !!totals.maxHorizonReached,
  });

  const rainElapsed = Math.min(s.tHours, stormEnd);
  const rainRemaining = Math.max(0, stormEnd - s.tHours);
  const totalH = s.samples[s.samples.length - 1]?.tHours ?? 0;
  const responseElapsed = Math.max(0, s.tHours - Math.min(s.tHours, stormEnd));
  const responseTotal = Math.max(0, totalH - stormEnd);
  const responseProgress =
    responseTotal > 1e-6 ? Math.min(1, responseElapsed / responseTotal) : s.tHours >= stormEnd ? 1 : 0;

  /** Single source of truth for UI metrics + Three.js. */
  const result = buildSimulationResult({
    samples: s.samples,
    meta: s.meta,
    peak: s.peak,
    reachGeometry: s.reachGeometry,
    tHours: s.tHours,
    status: s.status,
    phase,
  });

  return {
    simulation_id: s.id,
    status: s.status,
    phase,
    result,
    vertical_datum: s.verticalDatum,
    input: {
      depth_mm: s.input.depthMm,
      duration_hours: s.input.durationHours,
      intensity_mm_hr: s.meta.input.intensityMmHr,
      distribution: s.input.distribution,
      recession_hours: s.input.recessionHours,
      post_rain_cap_hours: s.meta.input.postRainCapHours,
    },
    /** A. Rainfall clock */
    rainfall_clock: {
      duration_hours: stormEnd,
      elapsed_hours: round(rainElapsed, 3),
      remaining_hours: round(rainRemaining, 3),
      accumulation_mm: round(current?.cumRainMm ?? 0, 4),
      intensity_mm_hr: round(current?.rainMmHr ?? 0, 4),
      active: raining,
      status: raining ? "RAINING" : s.tHours <= 0 ? "READY" : "RAIN ENDED",
    },
    /** B. River-response clock */
    river_clock: {
      total_hours: round(s.tHours, 3),
      horizon_hours: round(totalH, 3),
      response_elapsed_hours: round(responseElapsed, 3),
      response_horizon_hours: round(responseTotal, 3),
      routing_lag_hours: s.meta?.assumptions?.lagHours ?? LAG_TIME_HOURS,
      phase,
      progress: round(responseProgress, 3),
      stabilized: !!totals.stabilized,
      max_horizon_reached: !!totals.maxHorizonReached,
    },
    elapsed_hours: round(s.tHours, 3),
    storm_end_hours: stormEnd,
    total_hours: totalH,
    rainfall_completed_mm: round(current?.cumRainMm ?? 0, 4),
    effective_rainfall_mm: round(current?.cumExcessMm ?? 0, 4),
    playback: {
      multiplier: s.playbackMultiplier,
      hours_per_sec: round(s.playbackSpeedHoursPerSec, 6),
      base_hours_per_sec: round(basePlaybackHoursPerSec(s.input.durationHours), 6),
      note: "Playback speed changes wall-clock pacing only — hydrological series unchanged.",
    },
    current,
    peak: s.peak,
    peak_metrics: {
      delta_stage_m: totals.peakDeltaStageM,
      stage_m: totals.peakStageM,
      Q_m3s: totals.peakQm3s,
      velocity_ms: totals.peakVelocityMs,
      time_hours: totals.timeToPeakHours,
    },
    meta: s.meta,
    series: s.samples,
    updated_at: s.updatedAt,
  };
}

function notFound(id) {
  const err = new Error(`Rainfall simulation not found: ${id}`);
  err.status = 404;
  return err;
}

function round(n, d) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

/** Test helper — clear all sessions. */
export function _clearAll() {
  sessions.clear();
}

export { PHASE_STATUSES };
