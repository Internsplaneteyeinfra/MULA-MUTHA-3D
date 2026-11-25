/**
 * Phase 4 smoke tests: normalizer + live upstream (direct) + proxy allowlist.
 * Run: node scratch/test_naditwin_phase4.mjs
 */
import {
  buildNadiTwinChainageMeters,
  mapLocalChainageToCell,
  normalizeLiveState,
  qAtLocalChainage,
  validateChainageAlignment,
} from "../src/services/hydrology/hydrologyNormalizer.js";
import { handleNadiTwinApi } from "../scripts/naditwinApiMiddleware.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- Normalizer unit checks ---
const chain = buildNadiTwinChainageMeters(5, 10, 1);
assert(JSON.stringify(chain) === JSON.stringify([0, 10, 20, 30, 40]), "chainage meters");
assert(mapLocalChainageToCell(25, 1681, 10) === 3, "map 25→3");
assert(mapLocalChainageToCell(-5, 1681, 10) === 0, "negative → 0");

const meta = { n_cells: 1681, chainage_step_m: 10, reach_km: 16.796, datum: "relative" };
const local = Array.from({ length: 1698 }, (_, i) => ({ chainage_m: -19.6 + i * 10 }));
const align = validateChainageAlignment(meta, local);
assert(align.joinMethod === "nearest_positive_chainage_m", "join method");
assert(align.datumVerifiedMsl === false, "datum not MSL");
console.log("alignment ok=", align.ok, "issues=", align.issues);

const live = normalizeLiveState(
  {
    q_up_now: 9.2,
    q_now: 9.2,
    q_out_now: 10.9,
    at: new Date().toISOString(),
    q_station: [9.2, 9.3, 9.5],
    wse: [0, 0.1, 0.2],
    depth: [1, 1.1, 1.2],
    datum: "relative",
  },
  meta,
  {
    weather: { rain_now_mmh: 0, temperature_c: 25 },
    assumptions: { note: "Dam releases NOT modelled" },
    q_source: "GloFAS",
  },
);
assert(live.discharge_m3s === 10.9, "outlet Q authority");
assert(live.dataClass === "LIVE", "LIVE class");
assert(live.damReleasesModelled === false, "no dam releases");
assert(qAtLocalChainage(live, 10) === 9.3, "q at 10 m");
console.log("normalizer OK", { Q: live.discharge_m3s, class: live.dataClass });

// --- Allowlist: blocked path ---
{
  let status = null;
  let body = "";
  const res = {
    writeHead(s) {
      status = s;
      return this;
    },
    end(b) {
      body += b || "";
    },
  };
  const handled = handleNadiTwinApi({ method: "GET" }, res, "/naditwin-api/api/admin", "");
  assert(handled === true, "handled");
  assert(status === 403, `expected 403 got ${status}`);
  console.log("proxy allowlist OK");
}

// --- Live upstream sample (direct, discovery) ---
const upstream = await fetch(
  "https://naditwin-production.up.railway.app/api/state?river=Mula-Mutha",
  { signal: AbortSignal.timeout(20000) },
);
assert(upstream.ok, `upstream state ${upstream.status}`);
const state = await upstream.json();
assert(Number.isFinite(state.q_out_now), "q_out_now");
assert(Array.isArray(state.q_station) && state.q_station.length > 1000, "q_station length");
console.log("upstream LIVE OK", {
  q_out_now: state.q_out_now,
  n: state.q_station.length,
  at: state.at,
});

console.log("\nPhase 4 smoke tests passed.");
