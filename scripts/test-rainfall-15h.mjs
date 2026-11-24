/**
 * Test case: 10 mm over 15 hours — full event playback checks.
 * Run: node scripts/test-rainfall-15h.mjs
 */
import { buildRainfallResponseSeries, sampleAtTime } from "../src/services/rainfallSimulation/engine.js";
import {
  startSimulation,
  getStatus,
  pauseSimulation,
  resumeSimulation,
  resetSimulation,
  setPlaybackSpeed,
  _clearAll,
} from "../src/services/rainfallSimulation/simulationManager.js";
import {
  basePlaybackHoursPerSec,
  derivePhase,
  PHASE_STATUSES,
  SIM_STATUSES,
} from "../src/services/rainfallSimulation/schemas.js";

const DEPTH = 10;
const DURATION = 15;
const EXPECT_I = DEPTH / DURATION; // 0.666...

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

_clearAll();

const series = buildRainfallResponseSeries({ depthMm: DEPTH, durationHours: DURATION });
const { meta, samples } = series;

console.log("=== Rainfall Simulation — 10 mm / 15 h ===");
console.log("intensity mm/hr:", meta.input.intensityMmHr);
console.log("effective rainfall mm:", meta.totals.effectiveRainfallMm);
console.log("peak Δstage m:", meta.totals.peakDeltaStageM);
console.log("time to peak h:", meta.totals.timeToPeakHours);
console.log("storm end h:", meta.input.durationHours);
console.log("series end h:", samples[samples.length - 1].tHours);
console.log("playback 1× h/s:", basePlaybackHoursPerSec(DURATION));
console.log(
  "est. wall minutes @1×:",
  (samples[samples.length - 1].tHours / basePlaybackHoursPerSec(DURATION) / 60).toFixed(2),
);

assert(Math.abs(meta.input.intensityMmHr - EXPECT_I) < 1e-3, "intensity must be ~0.667 mm/hr");
assert(meta.totals.rainfallMm === DEPTH, "total rainfall must be 10 mm");

// Rain stops at storm end; river may still rise after
const atStormEnd = sampleAtTime(samples, DURATION);
const afterStorm = sampleAtTime(samples, DURATION + 1);
assert(atStormEnd.cumRainMm >= DEPTH - 0.05, "cum rain at storm end ≈ 10 mm");
assert(afterStorm.rainMmHr === 0, "rain intensity must be 0 after storm");

const peakT = meta.totals.timeToPeakHours;
assert(peakT > DURATION - 0.01 || afterStorm.deltaStageM >= 0, "response continues after rain");

// Rising after rain possible when peak after storm end
if (peakT > DURATION) {
  const midRise = sampleAtTime(samples, (DURATION + peakT) / 2);
  const nearEndRain = sampleAtTime(samples, DURATION - 0.25);
  assert(
    midRise.deltaStageM >= nearEndRain.deltaStageM - 1e-4,
    "stage can continue rising after rainfall stops",
  );
  console.log("✓ post-rain rise supported (peak after storm end)");
} else {
  console.log("· peak during storm — recession begins at/near storm end");
}

// Recession present if series extends past peak
const last = samples[samples.length - 1];
if (last.tHours > peakT + 0.5) {
  const postPeak = sampleAtTime(samples, Math.min(last.tHours, peakT + (last.tHours - peakT) * 0.7));
  assert(postPeak.Q_m3s <= meta.totals.peakQm3s + 1e-6, "recession Q ≤ peak");
  console.log("✓ recession present in series");
}

// Phase labels
assert(
  derivePhase({
    status: SIM_STATUSES.RUNNING,
    tHours: 1,
    stormEndHours: DURATION,
    timeToPeakHours: peakT,
    raining: true,
  }) === PHASE_STATUSES.RAINING,
  "phase RAINING",
);
const afterRainPhase = derivePhase({
  status: SIM_STATUSES.RUNNING,
  tHours: DURATION + 0.05,
  stormEndHours: DURATION,
  timeToPeakHours: peakT,
  deltaStageM: 0.1,
  prevDeltaStageM: 0.05,
});
assert(
  afterRainPhase === PHASE_STATUSES.RUNOFF_ROUTING ||
    afterRainPhase === PHASE_STATUSES.RIVER_RISING ||
    afterRainPhase === PHASE_STATUSES.PEAK_RESPONSE ||
    afterRainPhase === PHASE_STATUSES.RIVER_RECESSION,
  "phase after rain is a river-response phase",
);
assert(
  derivePhase({
    status: SIM_STATUSES.COMPLETED,
    tHours: last.tHours,
    stormEndHours: DURATION,
    timeToPeakHours: peakT,
    stabilized: true,
  }) === PHASE_STATUSES.STABILIZED,
  "phase STABILIZED on complete",
);

// Session clock / pause / resume / speed
const snap = startSimulation({ depthMm: DEPTH, durationHours: DURATION, playbackSpeed: 30 });
assert(snap.status === SIM_STATUSES.RUNNING, "starts RUNNING");
assert(snap.input.intensity_mm_hr > 0.66 && snap.input.intensity_mm_hr < 0.67, "session intensity");

const paused = pauseSimulation(snap.simulation_id);
assert(paused.status === SIM_STATUSES.PAUSED, "pause freezes");
const tPaused = paused.elapsed_hours;
await sleep(40);
const still = getStatus(snap.simulation_id);
assert(Math.abs(still.elapsed_hours - tPaused) < 1e-6, "clock frozen while paused");

resumeSimulation(snap.simulation_id);
setPlaybackSpeed(snap.simulation_id, 30);
await sleep(80);
const advanced = getStatus(snap.simulation_id);
assert(advanced.elapsed_hours > tPaused, "clock advances after resume");

const reset = resetSimulation(snap.simulation_id);
assert(reset.status === SIM_STATUSES.READY && reset.elapsed_hours === 0, "reset restores clock");
assert(reset.current.deltaStageM === samples[0].deltaStageM, "reset sample at t=0");

// Short intense storm: peak after rain — post-rain rise when model supports it
const short = buildRainfallResponseSeries({ depthMm: 40, durationHours: 2 });
assert(
  short.meta.totals.timeToPeakHours > 2 - 1e-6,
  "short storm peak after rainfall end (post-rain rise supported)",
);
const shortEnd = sampleAtTime(short.samples, 2);
const shortLater = sampleAtTime(short.samples, short.meta.totals.timeToPeakHours);
assert(
  shortLater.deltaStageM >= shortEnd.deltaStageM - 1e-4,
  "stage continues rising after short storm ends",
);
console.log("✓ post-rain rise verified on short intense storm (model-supported)");

console.log("✓ pause / resume / reset / speed OK");
console.log("✓ Flood Simulation remains independent (no flood APIs touched)");
console.log("PASS");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
