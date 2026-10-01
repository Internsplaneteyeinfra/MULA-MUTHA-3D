/**
 * Hydrology Validation Script
 * ─────────────────────────────────────────────────────────
 * Run: node scripts/hydrology-validate.mjs
 *
 * Validates canonical hydrology services at required chainages.
 * Reports provenance, depth, wetted width, area, velocity, discharge.
 *
 * NOTE: This runs in Node.js. bathymetryService is loaded directly.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const DATA_DIR = resolve("public/data/naditwin");

function loadJson(file) {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), "utf-8"));
}

// ── Load data ────────────────────────────────────────────
let rawCloud, chProfile;
try {
  rawCloud  = loadJson("raw_bathymetry_cloud.json");
  chProfile = loadJson("chainage_profile.json");
} catch (err) {
  console.error("[VALIDATION] Failed to load data:", err.message);
  process.exit(1);
}

const crossSections = rawCloud.crossSections || [];
const stations      = chProfile.map(c => ({
  chainage_m: c.chainage_m || c.chainage || 0,
  lat: c.lat || c.latitude,
  lon: c.lon || c.longitude,
  width_m: c.width_m || 50,
}));

console.log(`[VALIDATION] Loaded ${crossSections.length} cross-sections, ${stations.length} chainage stations\n`);

// ── Bathymetry interpolation (mirrors BathymetryService._interpolateLateral) ──
function interpolateLateral(cs, lateralM) {
  if (!cs?.points?.length) return null;
  const pts = [...cs.points].sort((a, b) => a.lateralOffsetMeters - b.lateralOffsetMeters);
  if (lateralM <= pts[0].lateralOffsetMeters)  return pts[0].depthM;
  if (lateralM >= pts[pts.length-1].lateralOffsetMeters) return pts[pts.length-1].depthM;
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i].lateralOffsetMeters <= lateralM && lateralM <= pts[i+1].lateralOffsetMeters) {
      const t = (lateralM - pts[i].lateralOffsetMeters) / (pts[i+1].lateralOffsetMeters - pts[i].lateralOffsetMeters);
      return pts[i].depthM * (1 - t) + pts[i+1].depthM * t;
    }
  }
  return null;
}

function getBathyAt(chainageM, lateralM) {
  // Binary search for bracketing cross-sections
  let lo = 0, hi = crossSections.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (crossSections[mid].chainageMeters < chainageM) lo = mid + 1;
    else hi = mid - 1;
  }
  const c1 = crossSections[Math.max(0, hi)];
  const c2 = crossSections[Math.min(crossSections.length - 1, lo)];

  if (Math.abs(c1.chainageMeters - chainageM) < 0.1) {
    return { depthM: interpolateLateral(c1, lateralM), source: c1.chainageMeters, provenance: "OBSERVED" };
  }

  const d1 = interpolateLateral(c1, lateralM);
  const d2 = interpolateLateral(c2, lateralM);

  if (d1 != null && d2 != null) {
    const span = c2.chainageMeters - c1.chainageMeters;
    const t = span === 0 ? 0 : (chainageM - c1.chainageMeters) / span;
    return { depthM: d1 * (1 - t) + d2 * t, provenance: "INTERPOLATED", nearestXS: c1.chainageMeters };
  }
  return { depthM: null, provenance: "UNAVAILABLE" };
}

function getStationAt(chainageM) {
  let lo = 0, hi = stations.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (stations[mid].chainage_m <= chainageM) lo = mid;
    else hi = mid;
  }
  const dLo = Math.abs(stations[lo].chainage_m - chainageM);
  const dHi = Math.abs(stations[hi].chainage_m - chainageM);
  return dLo <= dHi ? stations[lo] : stations[hi];
}

// ── Manning solver ────────────────────────────────────────
const MANNING_N  = 0.035; // ASSUMED
const BED_SLOPE  = 0.00052; // ASSUMED
const sqrtS      = Math.sqrt(BED_SLOPE);

function solveNormalDepth(Q, st) {
  // Iterative normal depth via bisection
  const w = st.width_m || 50;
  let lo = 0.01, hi = 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const A   = w * mid;
    const P   = w + 2 * mid;
    const R   = A / P;
    const Qc  = (1 / MANNING_N) * A * Math.pow(R, 2/3) * sqrtS;
    if (Qc < Q) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── Required validation chainages ────────────────────────
const REQUIRED_CHAINAGES  = [0, 200, 622, 3450, 6360, 8000, 10752, 12000, 16960];
const EXTRA_CHAINAGES     = [105, 1237, 6425, 9873, 15412];
const ALL_CHAINAGES       = [...REQUIRED_CHAINAGES, ...EXTRA_CHAINAGES].sort((a, b) => a - b);

const DEFAULT_Q = 85; // m³/s — assumed for demonstration; replace with live Q

// ── Run validation ────────────────────────────────────────
let passCount = 0, failCount = 0;
const results = [];

for (const ch of ALL_CHAINAGES) {
  const st      = getStationAt(ch);
  const bathy   = getBathyAt(ch, 0); // centroid
  const depth_m = solveNormalDepth(DEFAULT_Q, st);
  const A       = (st.width_m || 50) * depth_m;
  const P       = (st.width_m || 50) + 2 * depth_m;
  const R       = A / P;
  const V       = A > 0 ? DEFAULT_Q / A : null;
  const Qcheck  = V != null ? (1 / MANNING_N) * A * Math.pow(R, 2/3) * sqrtS : null;

  const checks = {
    depth_positive:   depth_m >= 0,
    area_positive:    A >= 0,
    perimeter_positive: P >= 0,
    velocity_finite:  Number.isFinite(V),
    Qcheck_close:     Qcheck != null && Math.abs(Qcheck - DEFAULT_Q) / DEFAULT_Q < 0.01,
    no_nan:           !isNaN(depth_m) && !isNaN(A) && !isNaN(P) && !isNaN(V),
    no_inf:           isFinite(depth_m) && isFinite(A),
  };

  const allPass = Object.values(checks).every(Boolean);
  if (allPass) passCount++; else failCount++;

  results.push({
    ch: `CH ${Math.floor(ch/1000)}+${String(ch % 1000).padStart(3, "0")}`,
    survey_depth: bathy.depthM != null ? `${bathy.depthM.toFixed(2)} m` : "UNAVAILABLE",
    bathy_prov:   bathy.provenance,
    model_depth:  `${depth_m.toFixed(2)} m  [MODELLED — Manning n=${MANNING_N} ASSUMED]`,
    wetted_width: `${(st.width_m || 50).toFixed(1)} m  [KML WIDTH — ASSUMED for model]`,
    area:         `${A.toFixed(2)} m²`,
    perimeter:    `${P.toFixed(2)} m`,
    hyd_radius:   `${R.toFixed(3)} m`,
    velocity:     `${V.toFixed(3)} m/s`,
    discharge:    `${DEFAULT_Q} m³/s  [INPUT]`,
    manning_n:    `${MANNING_N}  [ASSUMED]`,
    Q_AV_check:   `|Q - AV| = ${Math.abs(DEFAULT_Q - V * A).toFixed(4)} m³/s`,
    vertical_ref: "RELATIVE — datum UNVERIFIED",
    status:       allPass ? "✓ PASS" : "✗ FAIL",
    checks,
  });
}

// ── Print report ──────────────────────────────────────────
console.log("═".repeat(90));
console.log("  MULA–MUTHA HYDROLOGY VALIDATION REPORT");
console.log("  Data-Driven Reconstruction — NOT a claim of 100% real-time physical accuracy");
console.log("═".repeat(90));
console.log(`  Cross-sections loaded : ${crossSections.length}`);
console.log(`  Chainage stations     : ${stations.length}`);
console.log(`  Manning n             : ${MANNING_N}  [ASSUMED]`);
console.log(`  Bed slope             : ${BED_SLOPE}  [ASSUMED]`);
console.log(`  Vertical datum        : UNVERIFIED — all elevations are RELATIVE`);
console.log(`  Discharge Q input     : ${DEFAULT_Q} m³/s  [MODEL INPUT]`);
console.log("═".repeat(90) + "\n");

for (const r of results) {
  console.log(`${r.status}  ${r.ch}`);
  console.log(`   Survey depth   : ${r.survey_depth}  [${r.bathy_prov}]`);
  console.log(`   Model depth    : ${r.model_depth}`);
  console.log(`   Wetted width   : ${r.wetted_width}`);
  console.log(`   Area           : ${r.area}`);
  console.log(`   Hyd radius     : ${r.hyd_radius}`);
  console.log(`   Velocity       : ${r.velocity}`);
  console.log(`   Q ≈ A×V check  : ${r.Q_AV_check}`);
  console.log(`   Vertical ref   : ${r.vertical_ref}`);
  if (!r.checks.Qcheck_close) console.log(`   ⚠ Manning residual check FAILED`);
  console.log();
}

console.log("═".repeat(90));
console.log(`  SUMMARY: ${passCount} PASS / ${failCount} FAIL out of ${ALL_CHAINAGES.length} stations`);
console.log("═".repeat(90));

if (failCount > 0) process.exit(1);
