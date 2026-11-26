/**
 * Scenario state for coupled rainfall + river hydrology.
 * Reads NadiTwin LIVE. Never writes it back.
 * Rainfall runoff is SCS excess only (qDirect), added once on top of source Q.
 */
import { state } from "../../state.js";
import { formatStation } from "../../geo/chainage.js";
import { manningDepth } from "../rainfallSimulation/engine.js";
import { STAGE_AFFECTED_MIN_M } from "../rainfallSimulation/schemas.js";
import { affectedLengthKmFromGeometry, buildReachGeometry } from "../rainfallSimulation/reachGeometry.js";
import {
  getNadiTwinDischargeAtChainage,
  getNadiTwinLiveBundle,
} from "./naditwinHydrologyAdapter.js";

const Q_STEP = 5;
const STAGE_STEP = 0.05;
const Q_DELTA_LIMIT = 2500;
const STAGE_LIMIT = 2;

const scenario = {
  dischargeDeltaM3s: 0,
  stageAdjustM: 0,
};

let lastGoodSource = null;

function num(v) {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
}

function cellFor(live, meters) {
  const n = live?.wse?.length || live?.n_cells || 0;
  if (!n || !Number.isFinite(meters)) return null;
  const ch = live.chainage_m;
  if (Array.isArray(ch) && ch.length === n) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i += 1) {
      const d = Math.abs(Number(ch[i]) - meters);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  const step = live.chainage_step_m || 10;
  const idx = Math.round(meters / step);
  return Math.max(0, Math.min(n - 1, idx));
}

/** Read-only NadiTwin snapshot. Relative WSE is not treated as MSL. */
export function readLiveSource(meters = state.selectedChainageMeters) {
  const live = getNadiTwinLiveBundle();
  const m = Number.isFinite(Number(meters)) ? Number(meters) : null;
  if (!live?.wse?.length && !live?.q_station?.length) {
    if (lastGoodSource) {
      return { ...lastGoodSource, freshness: "STALE", chainage_m: m ?? lastGoodSource.chainage_m };
    }
    return {
      available: false,
      freshness: "UNAVAILABLE",
      chainage_m: m,
      station: m != null ? formatStation(m) : "—",
      qChainage: null,
      qUp: null,
      qOut: null,
      stageRel: null,
      depth: null,
      timestamp: null,
      datum: "relative",
    };
  }
  const i = cellFor(live, m ?? 0);
  const hit = m != null ? getNadiTwinDischargeAtChainage(m) : null;
  const source = {
    available: true,
    freshness: "LIVE",
    chainage_m: m,
    station: m != null ? formatStation(m) : "—",
    qChainage: Number.isFinite(hit?.q_m3s) ? hit.q_m3s : num(live.q_station?.[i]),
    qUp: num(live.q_up_now),
    qOut: num(live.q_out_now),
    stageRel: i != null ? num(live.wse?.[i]) : null,
    depth: i != null ? num(live.depth?.[i]) : null,
    timestamp: live.timestamp || null,
    datum: "relative",
    provenance: "NADITWIN LIVE",
  };
  lastGoodSource = source;
  return source;
}

export function getScenarioAdjustments() {
  return {
    dischargeDeltaM3s: scenario.dischargeDeltaM3s,
    stageAdjustM: scenario.stageAdjustM,
  };
}

export function adjustDischarge(direction) {
  const step = direction < 0 ? -Q_STEP : Q_STEP;
  scenario.dischargeDeltaM3s = clamp(scenario.dischargeDeltaM3s + step, -Q_DELTA_LIMIT, Q_DELTA_LIMIT);
  return publish();
}

export function adjustStage(direction) {
  const step = direction < 0 ? -STAGE_STEP : STAGE_STEP;
  scenario.stageAdjustM = round(clamp(scenario.stageAdjustM + step, -STAGE_LIMIT, STAGE_LIMIT), 2);
  return publish();
}

export function resetDischargeAdjustment() {
  scenario.dischargeDeltaM3s = 0;
  return publish();
}

/** Updates the scenario delta for the cards without moving the 3D water. */
export function setDischargeDeltaSilent(delta) {
  scenario.dischargeDeltaM3s = clamp(Number(delta) || 0, -Q_DELTA_LIMIT, Q_DELTA_LIMIT);
  const view = composeCoupled();
  state.coupledScenario = view;
  document.dispatchEvent(new CustomEvent("coupled-scenario-change", { detail: view }));
  return view;
}

export function resetStageAdjustment() {
  scenario.stageAdjustM = 0;
  return publish();
}

export function resetScenarioAdjustments() {
  scenario.dischargeDeltaM3s = 0;
  scenario.stageAdjustM = 0;
  return publish();
}

function rainfallSample() {
  const snap = state.rainfallSim?.lastSnap;
  const cur = snap?.current_sample || snap?.current || snap?.result?.current_sample || null;
  const status = state.rainfallSim?.status || "READY";
  const running = status === "RUNNING";
  const paused = status === "PAUSED";
  const active = running || paused || status === "COMPLETED";
  return {
    active: active && status !== "READY",
    running,
    paused,
    status,
    runoffQ: num(cur?.qDirect_m3s) ?? 0,
    engineRiseM: num(cur?.deltaStageM) ?? num(snap?.result?.current_stage_rise_m) ?? 0,
    rainMmHr: num(cur?.rainMmHr) ?? num(snap?.result?.rainfall_intensity_mm_hr) ?? 0,
    volumeExtraM3: num(snap?.result?.additional_volume_m3) ?? num(cur?.volumeExtraM3),
    volumeM3: num(snap?.result?.current_volume_m3) ?? num(cur?.volumeM3),
    affectedKm: num(snap?.result?.affected_length_km) ?? num(cur?.affectedLengthKm),
    peakRiseM: num(snap?.result?.maximum_stage_rise_m),
  };
}

/**
 * Stage rise from source Q to source + scenario runoff + discharge adjustment.
 * Rainfall millimetres are not added to stage. Runoff is counted once.
 */
export function flowRiseM(sourceQ, runoffQ, dischargeDelta, engineRiseM) {
  const runoff = Math.max(0, Number(runoffQ) || 0);
  const delta = Number(dischargeDelta) || 0;
  if (Number.isFinite(sourceQ)) {
    const q0 = Math.max(0.05, sourceQ);
    const q1 = Math.max(0.05, sourceQ + runoff + delta);
    return manningDepth(q1) - manningDepth(q0);
  }
  return (Number(engineRiseM) || 0);
}

export function composeCoupled(sample = rainfallSample()) {
  const src = readLiveSource();
  const sourceQ = src.qChainage ?? src.qOut ?? src.qUp;
  const runoffQ = sample.active ? Math.max(0, sample.runoffQ || 0) : 0;
  const delta = scenario.dischargeDeltaM3s;
  const stageAdjust = scenario.stageAdjustM;
  const riseFromFlow = flowRiseM(sourceQ, runoffQ, delta, sample.active ? sample.engineRiseM : 0);
  const visualRiseM = riseFromFlow + stageAdjust;
  const combinedQ = Number.isFinite(sourceQ) ? sourceQ + runoffQ + delta : null;
  const hydrologyActive = Math.abs(delta) > 1e-6 || Math.abs(stageAdjust) > 1e-6;
  const rainfallActive = !!sample.running;
  let mode = "READY";
  if (sample.paused) mode = "PAUSED";
  else if (rainfallActive && hydrologyActive) mode = "COUPLED";
  else if (rainfallActive) mode = "RAINFALL";
  else if (hydrologyActive) mode = "HYDROLOGY";
  else if (sample.active && sample.status === "COMPLETED") mode = "RAINFALL";

  const sourceStage = src.stageRel;
  const simulatedStage = sourceStage != null ? sourceStage + visualRiseM : null;
  const depth = src.depth != null ? src.depth + visualRiseM : null;

  const floodplain = "UNAVAILABLE";
  const buildings = "UNAVAILABLE";
  const geom = typeof window !== "undefined" ? buildReachGeometry(window.__MM_SCENE__?.dataset) : null;
  const affectedKm = geom
    ? affectedLengthKmFromGeometry(geom, visualRiseM, STAGE_AFFECTED_MIN_M)
    : null;
  const affectedClass = affectedKm != null ? "APPROXIMATED" : "UNAVAILABLE";

  return {
    source: src,
    sourceQ,
    runoffQ,
    dischargeDeltaM3s: delta,
    stageAdjustM: stageAdjust,
    combinedQ,
    riseFromFlowM: riseFromFlow,
    visualRiseM,
    sourceStageRel: sourceStage,
    simulatedStageRel: simulatedStage,
    depthM: depth,
    volumeM3: sample.volumeM3,
    volumeExtraM3: sample.active && Math.abs(delta) < 1e-6 && Math.abs(stageAdjust) < 1e-6
      ? sample.volumeExtraM3
      : null,
    volumeExtraClass: sample.volumeExtraM3 != null && Math.abs(delta) < 1e-6 && Math.abs(stageAdjust) < 1e-6
      ? "MODELLED"
      : "UNAVAILABLE",
    affectedLengthKm: affectedKm,
    affectedClass,
    floodplainArea: floodplain,
    buildings,
    rainMmHr: sample.running ? sample.rainMmHr : 0,
    peakRiseM: sample.peakRiseM,
    mode,
    rainfallActive,
    hydrologyActive,
    rainfallStatus: sample.status,
    datumNote: "relative · not MSL",
    runoffNote: "Scenario SCS excess only. NadiTwin Q is not increased by the same rain again.",
  };
}

export function publish(sample) {
  const view = composeCoupled(sample || rainfallSample());
  state.coupledScenario = view;
  applyVisual(view);
  document.dispatchEvent(new CustomEvent("coupled-scenario-change", { detail: view }));
  return view;
}

function applyVisual(view) {
  if (state.riverFill?.ownsVisual) return;
  const scene = window.__MM_SCENE__;
  if (!scene?.setHydrologySimulationRise) return;
  const rise = Number(view.visualRiseM);
  // A zero scenario must release the sheet so the Layers flood-stage slider can move the water.
  if (!Number.isFinite(rise) || Math.abs(rise) < 0.0005) {
    scene.clearHydrologySimulation?.();
    return;
  }
  scene.setHydrologySimulationRise(rise, false);
}

export function currentView() {
  return state.coupledScenario || composeCoupled();
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function round(n, d) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
