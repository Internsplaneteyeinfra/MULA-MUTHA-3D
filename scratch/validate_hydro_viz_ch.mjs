/**
 * Validate CH 0+000, 8+790, 8+820, 16+790 against NadiTwin live.
 * Run: node scratch/validate_hydro_viz_ch.mjs
 */
import {
  mapLocalChainageToCell,
  normalizeLiveState,
  qAtLocalChainage,
} from "../src/services/hydrology/hydrologyNormalizer.js";

const UP = "https://naditwin-production.up.railway.app";
const chs = [0, 8790, 8820, 16790];

const [meta, state, live, fc] = await Promise.all([
  fetch(`${UP}/api/meta?river=Mula-Mutha`).then((r) => r.json()),
  fetch(`${UP}/api/state?river=Mula-Mutha`).then((r) => r.json()),
  fetch(`${UP}/api/live?river=Mula-Mutha`).then((r) => r.json()),
  fetch(`${UP}/api/forecast/profile?river=Mula-Mutha&lead=24`).then((r) => r.json()),
]);

const norm = normalizeLiveState(state, meta, live);
console.log("LIVE at", norm.timestamp, "outlet Q", norm.discharge_m3s, "dataClass", norm.dataClass);
for (const m of chs) {
  const cell = mapLocalChainageToCell(m, norm.n_cells, norm.chainage_step_m);
  console.log({
    ch: m,
    cell,
    Q_selected: qAtLocalChainage(norm, m),
    Q_forecast_p50: fc.q_median_station?.[cell],
    depth_nt: norm.depth?.[cell],
    wse_rel: norm.wse?.[cell],
    outlet_not_confused: norm.discharge_m3s !== qAtLocalChainage(norm, m) || m > 16000,
  });
}
console.log("forecast median is STAGE (rel):", fc.median?.[0], "Q array:", fc.q_median_station?.[0]);
