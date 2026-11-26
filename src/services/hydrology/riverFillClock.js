/**
 * Level-pool river filling clock.
 * ΔV = (Qin − Qout) Δt on the mapped channel width, then the DTM decides
 * where that water surface sits. MODELLED. Does not write NadiTwin LIVE.
 */
import { state } from "../../state.js";
import { manningDepthFor, manningDischarge } from "../rainfallSimulation/engine.js";
import { readLiveSource, setDischargeDeltaSilent } from "./coupledScenario.js";

const PLAY_SECONDS = 36;

const clock = {
  mode: "discharge",
  scenarioQ: null,
  durationH: 6,
  speed: 1,
  status: "READY",
  tHours: 0,
  h: null,
  h0: null,
  qScale: 1,
  width: null,
  lengthM: null,
  widthClass: null,
  fpArea: 0,
  series: [],
  lastMark: -1,
};

function sourceQ(src = readLiveSource()) {
  const q = src.qChainage ?? src.qOut ?? src.qUp;
  return Number.isFinite(q) ? q : null;
}

function runoffNow() {
  if (clock.mode === "discharge") return { q: 0, rain: 0 };
  const snap = state.rainfallSim?.lastSnap;
  const status = state.rainfallSim?.status;
  const active = status === "RUNNING" || status === "PAUSED" || status === "COMPLETED";
  if (!active) return { q: 0, rain: 0 };
  const cur = snap?.current_sample || snap?.current || snap?.result?.current_sample || null;
  return {
    q: Math.max(0, Number(cur?.qDirect_m3s) || 0),
    rain: Math.max(0, Number(cur?.rainMmHr) || Number(snap?.result?.rainfall_intensity_mm_hr) || 0),
  };
}

function channelGeometry() {
  const stations = window.__MM_SCENE__?.dataset?.corridor?.stations || [];
  if (stations.length < 2) return null;
  let wSum = 0;
  let n = 0;
  let length = 0;
  let mapped = false;
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    const left = Number(s.wetHalfLeft);
    const right = Number(s.wetHalfRight);
    const wet = Number.isFinite(left) && Number.isFinite(right);
    if (wet) mapped = true;
    const w = wet ? left + right : Number(s.width);
    if (w > 4 && w < 400) {
      wSum += w;
      n += 1;
    }
    if (i) length += Math.hypot(s.x - stations[i - 1].x, s.z - stations[i - 1].z);
  }
  if (!n || length < 50) return null;
  return {
    width: wSum / n,
    length,
    widthClass: mapped ? "MAPPED_WET_WIDTH" : "CORRIDOR_WIDTH",
  };
}

function emptySnap(extra = {}) {
  const src = readLiveSource();
  const q0 = sourceQ(src);
  return {
    ownsVisual: clock.status === "RUNNING" || clock.status === "PAUSED" || clock.status === "COMPLETE",
    status: clock.status,
    mode: clock.mode,
    tHours: clock.tHours,
    durationH: clock.durationH,
    speed: clock.speed,
    sourceQ: q0,
    scenarioQ: clock.scenarioQ,
    dischargeIncrease: Number.isFinite(q0) && Number.isFinite(clock.scenarioQ) ? clock.scenarioQ - q0 : null,
    qUp: src.qUp,
    qOutLive: src.qOut,
    qOut: null,
    runoffQ: 0,
    qIn: null,
    riseM: null,
    stageRel: src.stageRel,
    volumeRiverM3: null,
    volumeFloodM3: null,
    leftM: null,
    rightM: null,
    maxM: null,
    areaM2: null,
    areaKm2: null,
    affectedKm: null,
    rain: 0,
    series: clock.series,
    classLabel: "MODELLED",
    note: "Storage uses mapped channel width. Outflow is Manning conveyance scaled to the live source discharge. n = 0.035 and slope = 0.0008 are assumptions. Not engineering-verified.",
    ...extra,
  };
}

function publishSnap(snap) {
  state.riverFill = snap;
  document.dispatchEvent(new CustomEvent("river-fill-tick", { detail: snap }));
  return snap;
}

function floodStats() {
  return window.__MM_SCENE__?.floodLayer?.userData?.floodStats || null;
}

function applyRise(rise) {
  const scene = window.__MM_SCENE__;
  if (!scene?.setHydrologySimulationRise) return;
  if (!Number.isFinite(rise) || rise < 0.0005) {
    scene.clearHydrologySimulation?.();
    return;
  }
  scene.setHydrologySimulationRise(rise, false);
}

export function setFillMode(mode) {
  clock.mode = mode === "rainfall" || mode === "both" ? mode : "discharge";
  return publishSnap(emptySnap());
}

export function setFillDuration(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h)) return clock.durationH;
  clock.durationH = Math.max(0.25, Math.min(168, h));
  return clock.durationH;
}

export function setFillSpeed(speed) {
  const s = Number(speed);
  clock.speed = [1, 5, 10, 30].includes(s) ? s : 1;
  return clock.speed;
}

/** Stores a scenario discharge. Does not change NadiTwin LIVE and does not move the water. */
export function setScenarioDischarge(qAbs) {
  const q = Number(qAbs);
  clock.scenarioQ = Number.isFinite(q) ? Math.max(0, q) : null;
  const q0 = sourceQ();
  if (Number.isFinite(q0) && Number.isFinite(clock.scenarioQ)) {
    setDischargeDeltaSilent(clock.scenarioQ - q0);
  }
  return publishSnap(emptySnap());
}

export function fillSnapshot() {
  return state.riverFill || emptySnap();
}

export function startFill() {
  if (clock.status === "RUNNING") return state.riverFill;
  const geom = channelGeometry();
  const q0 = sourceQ();
  if (!geom || !Number.isFinite(q0)) {
    clock.status = "READY";
    return publishSnap(emptySnap({
      ownsVisual: false,
      classLabel: "UNAVAILABLE",
      note: "Channel width or live discharge is unavailable, so storage was not calculated.",
    }));
  }
  const continuing = clock.h != null && clock.status !== "READY";
  clock.width = geom.width;
  clock.lengthM = geom.length;
  clock.widthClass = geom.widthClass;
  clock.h0 = manningDepthFor(Math.max(0.05, q0), geom.width);
  clock.qScale = q0 / Math.max(1e-3, manningDischarge(clock.h0, geom.width));
  clock.tHours = 0;
  clock.series = [];
  clock.lastMark = -1;
  if (!continuing) {
    clock.h = clock.h0;
    clock.fpArea = 0;
  }
  clock.status = "RUNNING";
  return step(0);
}

export function pauseFill() {
  if (clock.status === "RUNNING") clock.status = "PAUSED";
  return publishSnap(state.riverFill || emptySnap());
}

export function resumeFill() {
  if (clock.status === "PAUSED") clock.status = "RUNNING";
  else if (clock.status !== "RUNNING") return startFill();
  return state.riverFill;
}

export function resetFill() {
  clock.status = "READY";
  clock.tHours = 0;
  clock.h = null;
  clock.h0 = null;
  clock.series = [];
  clock.lastMark = -1;
  clock.fpArea = 0;
  clock.scenarioQ = null;
  setDischargeDeltaSilent(0);
  window.__MM_SCENE__?.floodLayer?.userData?.clearFlood?.();
  window.__MM_SCENE__?.clearHydrologySimulation?.();
  return publishSnap(emptySnap({ ownsVisual: false }));
}

function inflows() {
  const q0 = sourceQ();
  const rain = runoffNow();
  const scenario = Number.isFinite(clock.scenarioQ) ? clock.scenarioQ : q0;
  let qIn = q0;
  if (clock.mode === "discharge") qIn = scenario;
  else if (clock.mode === "rainfall") qIn = (q0 || 0) + rain.q;
  else qIn = (scenario || 0) + rain.q;
  return { q0, scenario, qIn, rain };
}

function step(dtReal) {
  if (clock.status !== "RUNNING" || clock.h == null || !clock.width) return publishSnap(emptySnap());
  const simHours = Math.max(0, dtReal) * (clock.durationH / PLAY_SECONDS) * clock.speed;
  let remain = simHours * 3600;
  const flow = inflows();
  while (remain > 0.01) {
    const dt = Math.min(20, remain);
    const qOut = clock.qScale * manningDischarge(clock.h, clock.width);
    const dV = ((flow.qIn || 0) - qOut) * dt;
    const area = clock.width * clock.lengthM + Math.max(0, clock.fpArea);
    clock.h = Math.max(0.05, clock.h + dV / Math.max(area, 1));
    remain -= dt;
  }
  clock.tHours = Math.min(clock.durationH, clock.tHours + simHours);
  if (clock.tHours >= clock.durationH - 1e-6) {
    clock.tHours = clock.durationH;
    clock.status = "COMPLETE";
  }
  const rise = Math.max(0, clock.h - clock.h0);
  applyRise(rise);
  const stats = floodStats();
  if (stats?.areaM2 != null) clock.fpArea = stats.areaM2;
  const src = readLiveSource();
  const volumeRiver = rise * clock.width * clock.lengthM;
  const snap = emptySnap({
    ownsVisual: true,
    status: clock.status,
    sourceQ: flow.q0,
    scenarioQ: flow.scenario,
    dischargeIncrease: Number.isFinite(flow.q0) && Number.isFinite(flow.scenario) ? flow.scenario - flow.q0 : null,
    qUp: src.qUp,
    qOutLive: src.qOut,
    qOut: clock.qScale * manningDischarge(clock.h, clock.width),
    runoffQ: flow.rain.q,
    qIn: flow.qIn,
    riseM: rise,
    stageRel: Number.isFinite(src.stageRel) ? src.stageRel + rise : null,
    volumeRiverM3: volumeRiver,
    volumeFloodM3: stats?.volumeM3 ?? null,
    leftM: stats?.leftM ?? null,
    rightM: stats?.rightM ?? null,
    maxM: stats?.maxM ?? null,
    areaM2: stats?.areaM2 ?? null,
    areaKm2: stats?.areaKm2 ?? null,
    affectedKm: stats?.affectedKm != null ? stats.affectedKm : rise > 0.02 ? clock.lengthM / 1000 : 0,
    rain: flow.rain.rain,
    reachKm: clock.lengthM / 1000,
    widthM: clock.width,
    widthClass: clock.widthClass,
  });
  if (clock.tHours - clock.lastMark >= clock.durationH / 80 || clock.series.length === 0) {
    clock.lastMark = clock.tHours;
    clock.series.push({
      tHours: clock.tHours,
      riseM: rise,
      qIn: flow.qIn,
      rain: flow.rain.rain,
      areaKm2: snap.areaKm2 || 0,
    });
    if (clock.series.length > 240) clock.series.shift();
  }
  snap.series = clock.series;
  return publishSnap(snap);
}

export function tickFill(dtReal) {
  if (clock.status !== "RUNNING") return state.riverFill || null;
  return step(dtReal);
}
