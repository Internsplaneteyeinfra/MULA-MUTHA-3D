/**
 * Hydrological consistency + single-source result checks.
 * Run: node scripts/test-rainfall-hydro-sync.mjs
 */
import {
  buildRainfallResponseSeries,
  buildSimulationResult,
  sampleAtTime,
} from "../src/services/rainfallSimulation/engine.js";
import { buildReachGeometry } from "../src/services/rainfallSimulation/reachGeometry.js";
import { CURVE_NUMBER } from "../src/services/rainfallSimulation/schemas.js";

function assert(c, m) {
  if (!c) throw new Error(m);
}

const S = 25400 / CURVE_NUMBER - 254;
const Ia = 0.2 * S;
console.log(`SCS CN=${CURVE_NUMBER} S=${S.toFixed(2)} mm Ia=${Ia.toFixed(2)} mm`);

/** Synthetic corridor for volume/affected-length tests */
const fakeDataset = {
  corridor: {
    stations: Array.from({ length: 21 }, (_, i) => ({
      x: i * 800,
      z: 0,
      meters: i * 800,
      width: 40 + (i % 5) * 2,
      halfWidth: 20 + (i % 5),
    })),
  },
};
const geom = buildReachGeometry(fakeDataset);
assert(geom && Math.abs(geom.lengthM - 16000) < 1, "geometry length from chainage");

const CASES = [
  [1, 3],
  [5, 2],
  [10, 1],
  [10, 2],
  [25, 2],
  [50, 3],
  [88, 1],
];

for (const [depth, hours] of CASES) {
  const built = buildRainfallResponseSeries(
    { depthMm: depth, durationHours: hours },
    { reachGeometry: geom },
  );
  const { meta, samples, peak } = built;
  const Pe = meta.totals.effectiveRainfallMm;
  const expectZero = depth <= Ia + 1e-6;

  console.log(
    `\n${depth} mm / ${hours} h | i=${meta.input.intensityMmHr.toFixed(2)} | Pe=${Pe.toFixed(4)} mm | peakΔ=${meta.totals.peakDeltaStageM} m | peakQ=${meta.totals.peakQm3s}`,
  );

  if (expectZero) {
    assert(Pe < 1e-6, `${depth}mm: Pe must be 0 when P≤Ia`);
    assert(Math.abs(meta.totals.peakDeltaStageM) < 1e-6, `${depth}mm: no fabricated stage rise`);
    assert(meta.totals.scsZeroExcess === true, "scsZeroExcess flag");
  } else {
    assert(Pe > 0, `${depth}mm: Pe > 0 when P>Ia`);
    assert(meta.totals.peakDeltaStageM > 0, `${depth}mm: positive peak rise`);
  }

  // Peak preserved across series — max of samples equals totals
  let maxRise = -Infinity;
  for (const s of samples) maxRise = Math.max(maxRise, s.deltaStageM);
  assert(Math.abs(maxRise - meta.totals.peakDeltaStageM) < 1e-6, "peak rise = max(series)");

  // Current at end vs peak: may differ after recession
  const last = samples[samples.length - 1];
  const midT = meta.totals.timeToPeakHours;
  const atPeak = sampleAtTime(samples, midT);

  const resultPeak = buildSimulationResult({
    samples,
    meta,
    peak,
    reachGeometry: geom,
    tHours: midT,
    status: "RUNNING",
    phase: "PEAK RESPONSE",
  });
  assert(
    Math.abs(resultPeak.current_stage_rise_m - atPeak.deltaStageM) < 1e-6,
    "result rise matches sample at peak time",
  );
  assert(
    Math.abs(resultPeak.maximum_stage_rise_m - meta.totals.peakDeltaStageM) < 1e-6,
    "result max rise preserved",
  );

  if (!expectZero) {
    assert(resultPeak.current_volume_m3 != null, "volume available with geometry");
    assert(resultPeak.additional_volume_m3 >= 0, "extra volume ≥ 0 at peak");
    assert(resultPeak.affected_length_km > 0, "affected length > 0 when risen");
    assert(
      Math.abs(resultPeak.affected_length_km - geom.lengthM / 1000) < 0.01,
      "affected length = chainage span",
    );
  }

  const resultEnd = buildSimulationResult({
    samples,
    meta,
    peak,
    reachGeometry: geom,
    tHours: last.tHours,
    status: "COMPLETED",
    phase: "STABILIZED",
  });
  // Max must NOT be overwritten by recession
  assert(
    Math.abs(resultEnd.maximum_stage_rise_m - meta.totals.peakDeltaStageM) < 1e-6,
    "max rise survives recession",
  );
  assert(
    Math.abs(resultEnd.current_stage_rise_m - last.deltaStageM) < 1e-6,
    "current rise = end sample",
  );

  // Graph series and result use same samples
  assert(resultPeak.current_sample.Q_m3s === atPeak.Q_m3s, "Q sync");
}

// Without geometry → N/A volumes
const bare = buildRainfallResponseSeries({ depthMm: 88, durationHours: 1 }, { reachGeometry: null });
assert(bare.samples[0].volumeM3 == null, "no geometry → volume null");
assert(bare.samples[0].affectedLengthKm == null, "no geometry → affected null");
const rBare = buildSimulationResult({
  samples: bare.samples,
  meta: bare.meta,
  peak: bare.peak,
  reachGeometry: null,
  tHours: bare.meta.totals.timeToPeakHours,
});
assert(rBare.current_volume_m3 == null && rBare.affected_length_km == null, "result N/A without geom");

console.log("\nPASS — SCS honest; peak preserved; metrics share one result object");
