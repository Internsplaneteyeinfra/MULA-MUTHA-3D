/**
 * Validation: 34 mm over 2 hours — separate rainfall vs river-response clocks.
 * Run: node scripts/test-rainfall-34mm-2h.mjs
 */
import { buildRainfallResponseSeries, sampleAtTime } from "../src/services/rainfallSimulation/engine.js";
import { derivePhase, PHASE_STATUSES, SIM_STATUSES } from "../src/services/rainfallSimulation/schemas.js";
import {
  startSimulation,
  getStatus,
  _clearAll,
} from "../src/services/rainfallSimulation/simulationManager.js";

function assert(c, m) {
  if (!c) throw new Error(m);
}

const DEPTH = 34;
const DUR = 2;

_clearAll();
const { meta, samples, peak } = buildRainfallResponseSeries({
  depthMm: DEPTH,
  durationHours: DUR,
});

console.log("=== 34 mm / 2 h ===");
console.log("intensity:", meta.input.intensityMmHr, "mm/hr");
console.log("storm end:", meta.totals.stormEndHours, "h");
console.log("total hydro hours:", meta.totals.totalHours, "h");
console.log("response hours:", meta.totals.responseHours, "h");
console.log("UH base:", meta.totals.uhBaseHours, "h");
console.log("stabilized:", meta.totals.stabilized, "@", meta.totals.stabilizeTimeHours);
console.log("peak Δstage:", meta.totals.peakDeltaStageM, "m @", meta.totals.timeToPeakHours, "h");
console.log("peak Q:", meta.totals.peakQm3s, "m³/s");
console.log("final Δstage:", samples.at(-1).deltaStageM, "m");

assert(Math.abs(meta.input.intensityMmHr - DEPTH / DUR) < 1e-3, "intensity = 17 mm/hr");
assert(meta.totals.stormEndHours === DUR, "storm end = 2 h");

// Must NOT force a fixed 10 h for a 2 h storm
assert(meta.totals.totalHours !== 10, "must not hardcode 10 h total");
assert(meta.totals.totalHours > DUR, "response continues after rain");
assert(meta.totals.totalHours < 36, "under max horizon");

const atRainEnd = sampleAtTime(samples, DUR);
assert(Math.abs(atRainEnd.cumRainMm - DEPTH) < 0.05, "accumulation reaches 34 mm at rain end");
assert(atRainEnd.rainMmHr === 0 || sampleAtTime(samples, DUR + 0.01).rainMmHr === 0, "rain stops after 2 h");

const after = sampleAtTime(samples, DUR + 0.25);
assert(after.rainMmHr === 0, "no rain after 2 h");

assert(meta.totals.timeToPeakHours > DUR - 1e-6, "peak after / at rain end (delayed runoff)");
assert(peak.deltaStageM === meta.totals.peakDeltaStageM, "peak sample matches totals");

const final = samples.at(-1);
assert(
  Math.abs(final.deltaStageM - meta.totals.peakDeltaStageM) > 0.01 || meta.totals.stabilized,
  "final state distinguishable from peak (or already at stabilize)",
);
assert(final.deltaStageM <= meta.totals.peakDeltaStageM + 1e-4, "final ≤ peak rise");

// Phase derivation
assert(
  derivePhase({
    status: SIM_STATUSES.RUNNING,
    tHours: 1,
    stormEndHours: DUR,
    timeToPeakHours: meta.totals.timeToPeakHours,
    raining: true,
  }) === PHASE_STATUSES.RAINING,
  "RAINING",
);
assert(
  derivePhase({
    status: SIM_STATUSES.RUNNING,
    tHours: DUR + 0.5,
    stormEndHours: DUR,
    timeToPeakHours: meta.totals.timeToPeakHours,
    deltaStageM: 0.5,
    prevDeltaStageM: 0.4,
    Q_m3s: meta.totals.peakQm3s * 0.5,
    peakQm3s: meta.totals.peakQm3s,
    baseflowM3s: meta.input.baseflowM3s,
  }) === PHASE_STATUSES.RUNOFF_ROUTING ||
    derivePhase({
      status: SIM_STATUSES.RUNNING,
      tHours: DUR + 0.5,
      stormEndHours: DUR,
      timeToPeakHours: meta.totals.timeToPeakHours,
      deltaStageM: 0.5,
      prevDeltaStageM: 0.4,
      Q_m3s: meta.totals.peakQm3s * 0.5,
      peakQm3s: meta.totals.peakQm3s,
      baseflowM3s: meta.input.baseflowM3s,
    }) === PHASE_STATUSES.RIVER_RISING,
  "post-rain rising phase",
);

const snap = startSimulation({ depthMm: DEPTH, durationHours: DUR, playbackSpeed: 60 });
assert(snap.rainfall_clock.duration_hours === 2, "rainfall clock duration");
assert(snap.river_clock.horizon_hours === snap.meta.totals.totalHours, "river clock horizon from model");
assert(
  snap.peak_metrics.delta_stage_m === snap.meta.totals.peakDeltaStageM,
  "peak metrics match session totals",
);
assert(
  snap.rainfall_clock.duration_hours !== snap.river_clock.horizon_hours,
  "rainfall duration ≠ total hydro horizon",
);
assert(Math.abs(snap.meta.totals.totalHours - meta.totals.totalHours) < 0.3, "horizon consistent across builds");

// Advance past rain end
const s = getStatus(snap.simulation_id);
// Force time by updating internal — use many status polls with high speed
await new Promise((r) => setTimeout(r, 200));
const mid = getStatus(snap.simulation_id);
if (mid.elapsed_hours >= 2) {
  assert(mid.rainfall_clock.status === "RAIN ENDED", "rain status after 2 h");
  assert(mid.rainfall_clock.accumulation_mm >= DEPTH - 0.05, "34 mm accumulated");
  assert(mid.current.rainMmHr === 0, "particles intensity 0 after rain");
}
assert(mid.peak_metrics.Q_m3s === snap.meta.totals.peakQm3s, "peak Q unchanged by playback");

console.log("✓ rain stops at 2 h; accumulation 34 mm");
console.log("✓ delayed peak @", meta.totals.timeToPeakHours, "h");
console.log("✓ total horizon", meta.totals.totalHours, "h (model-driven, not fixed 10)");
console.log("✓ peak vs final distinguished");
console.log("PASS");
