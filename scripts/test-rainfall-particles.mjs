/**
 * Validate intensity→density mapping and post-rain stage behavior.
 * Run: node scripts/test-rainfall-particles.mjs
 */
import { buildRainfallResponseSeries, sampleAtTime } from "../src/services/rainfallSimulation/engine.js";
import { emissionRateFromIntensity } from "../src/scene/rainfallSimulationParticles.js";

const CASES = [
  [1, 3],
  [5, 2],
  [10, 1],
  [25, 2],
  [47, 3],
  [50, 3],
];

function assert(c, m) {
  if (!c) throw new Error(m);
}

console.log("intensity → emission rate (drops/s)");
let prev = -1;
for (const [d, h] of CASES) {
  const i = d / h;
  const rate = emissionRateFromIntensity(i);
  console.log(`  ${d} mm / ${h} h → ${i.toFixed(2)} mm/hr → ${rate.toFixed(0)} /s`);
  assert(rate >= prev, "emission rate must not decrease with intensity");
  if (rate < 950) assert(rate > prev || prev < 0, "below cap, rate should rise");
  prev = rate;
}
assert(emissionRateFromIntensity(0) === 0, "zero intensity → no emission");

console.log("\nhydrological series checks");
for (const [d, h] of CASES) {
  const { meta, samples } = buildRainfallResponseSeries({ depthMm: d, durationHours: h });
  const i = meta.input.intensityMmHr;
  assert(Math.abs(i - d / h) < 1e-3, "intensity = depth/duration");

  const midRain = sampleAtTime(samples, h * 0.5);
  assert(midRain.rainMmHr > 0, "raining mid-storm");
  const after = sampleAtTime(samples, h + 0.01);
  assert(after.rainMmHr === 0, "rain intensity 0 just after storm end");

  const peakT = meta.totals.timeToPeakHours;
  const atStormEnd = sampleAtTime(samples, h);
  const atPeak = sampleAtTime(samples, peakT);

  if (peakT > h + 0.05) {
    assert(
      atPeak.deltaStageM + 1e-4 >= atStormEnd.deltaStageM,
      `${d}/${h}: stage continues rising after rainfall stops (peak ${peakT}h)`,
    );
    console.log(`  ✓ ${d}mm/${h}h post-rain rise (peak @ ${peakT}h, Δ=${meta.totals.peakDeltaStageM} m)`);
  } else {
    console.log(`  · ${d}mm/${h}h peak during storm @ ${peakT}h (Δ=${meta.totals.peakDeltaStageM} m)`);
  }

  // Recession is model-driven: after peak, Q declines toward baseflow
  const last = samples[samples.length - 1];
  if (last.tHours > peakT + 1) {
    const late = sampleAtTime(samples, (peakT + last.tHours) / 2);
    assert(late.Q_m3s <= atPeak.Q_m3s + 1e-3, "recession Q ≤ peak Q");
  }
}

console.log("\nPASS — density scales with intensity; stage follows model, not rain timer");
