/**
 * Light / moderate / heavy — intensity bands + SCS-consistent metrics.
 * Run: node scripts/test-rainfall-ui-metrics.mjs
 */
import { buildRainfallResponseSeries } from "../src/services/rainfallSimulation/engine.js";
import { emissionRateFromIntensity } from "../src/scene/rainfallSimulationParticles.js";
import { buildReachGeometry } from "../src/services/rainfallSimulation/reachGeometry.js";
import { STAGE_AFFECTED_MIN_M, CURVE_NUMBER } from "../src/services/rainfallSimulation/schemas.js";

function assert(c, m) {
  if (!c) throw new Error(m);
}

const S = 25400 / CURVE_NUMBER - 254;
const Ia = 0.2 * S;

const geom = buildReachGeometry({
  corridor: {
    stations: Array.from({ length: 11 }, (_, i) => ({
      x: i * 1000,
      z: 0,
      meters: i * 1000,
      width: 50,
      halfWidth: 25,
    })),
  },
});

const CASES = [
  { label: "light", depth: 2, hours: 3 },
  { label: "moderate", depth: 20, hours: 2 }, // still ≤ Ia → Pe=0
  { label: "heavy", depth: 50, hours: 2 }, // > Ia
];

console.log("emission bands");
assert(emissionRateFromIntensity(0.5) < emissionRateFromIntensity(5), "light < moderate");
assert(emissionRateFromIntensity(5) < emissionRateFromIntensity(20), "moderate < heavy");

for (const c of CASES) {
  const { meta, peak } = buildRainfallResponseSeries(
    { depthMm: c.depth, durationHours: c.hours },
    { reachGeometry: geom },
  );
  const i = meta.input.intensityMmHr;
  const Pe = meta.totals.effectiveRainfallMm;
  console.log(
    `\n${c.label}: ${c.depth} mm / ${c.hours} h → ${i.toFixed(2)} mm/hr | Pe=${Pe.toFixed(3)} | peak Δ=${peak.deltaStageM} m | vol=${peak.volumeM3} | extra=${peak.volumeExtraM3} | aff=${peak.affectedLengthKm}`,
  );

  if (c.depth <= Ia) {
    assert(Pe < 1e-6 && peak.deltaStageM === 0, "P≤Ia → no fabricated rise");
    assert(peak.affectedLengthKm === 0, "no rise → affected 0");
  } else {
    assert(Pe > 0 && peak.deltaStageM > 0, "P>Ia → real Pe and rise");
    assert(peak.volumeM3 != null && peak.volumeExtraM3 >= 0, "volume from geometry");
    if (peak.deltaStageM >= STAGE_AFFECTED_MIN_M) {
      assert(peak.affectedLengthKm === geom.lengthM / 1000, "affected = chainage span");
    }
  }
}

console.log("\nPASS");
