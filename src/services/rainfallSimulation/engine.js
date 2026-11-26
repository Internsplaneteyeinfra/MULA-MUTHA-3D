/**
 * Event-based rainfall–runoff → river response engine (client-side).
 *
 * Model (ASSUMED / UNCALIBRATED — not field-calibrated):
 * 1. Uniform rainfall intensity i = depth / duration over the storm window.
 * 2. Conventional SCS-CN: S = 25400/CN − 254, Ia = 0.2·S.
 *    If cumulative P ≤ Ia, excess Pe = 0 (no fabricated runoff).
 * 3. Triangular unit hydrograph convolution → direct runoff Q(t).
 * 4. Total discharge = baseflow + direct runoff.
 * 5. Stage from Manning wide-channel depth; Δstage = h(Q) − h(baseflow).
 * 6. Volume from corridor station widths × hydraulic depth along chainage
 *    when geometry is supplied; otherwise volume fields are null (UI → N/A).
 * 7. Affected length from actual chainage span when Δstage ≥ threshold
 *    (lumped uniform stage on AOI — not floodplain area).
 *
 * Does NOT produce floodplain inundation.
 */
import {
  CATCHMENT_AREA_KM2,
  CURVE_NUMBER,
  LAG_TIME_HOURS,
  BASEFLOW_DRY_M3S,
  BASEFLOW_MONSOON_M3S,
  VERTICAL_DATUM,
  MAX_SIM_HORIZON_HOURS,
  STABILIZE_Q_FRAC,
  STABILIZE_HOLD_STEPS,
  STAGE_AFFECTED_MIN_M,
  normalizeRainfallInput,
} from "./schemas.js";
import { BASELINE_DEPTH_M } from "../hydrology/hydrologyTransform.js";
import {
  volumeFromGeometry,
  affectedLengthKmFromGeometry,
  chainageStageResults,
} from "./reachGeometry.js";

const MANNING_N = 0.035;
const BED_SLOPE = 0.0008;
const REF_WIDTH_M = 55;

/**
 * @param {import("./schemas.js").RainfallEventInput} input
 * @param {{ reachGeometry?: object|null }} [opts]
 */
export function buildRainfallResponseSeries(input, opts = {}) {
  const cfg = normalizeRainfallInput(input);
  const geom = opts.reachGeometry || null;
  const intensityMmHr = cfg.durationHours > 0 ? cfg.depthMm / cfg.durationHours : 0;
  const baseflow = cfg.baseflowM3s != null ? cfg.baseflowM3s : defaultBaseflow();
  const S = storageMm(CURVE_NUMBER);
  const Ia = 0.2 * S;

  const dt = cfg.dtHours;
  const stormEnd = cfg.durationHours;
  const uh = triangularUnitHydrograph(dt);
  const uhBaseHours = (uh.length - 1) * dt;
  const Tp = dt / 2 + LAG_TIME_HOURS;

  const autoPostRain = Math.min(
    MAX_SIM_HORIZON_HOURS - stormEnd,
    Math.max(uhBaseHours + LAG_TIME_HOURS * 0.25, Tp * 2.67),
  );
  const postRainCap =
    cfg.recessionHours != null
      ? Math.min(cfg.recessionHours, MAX_SIM_HORIZON_HOURS - stormEnd)
      : Math.max(1, autoPostRain);
  const provisionalEnd = Math.min(MAX_SIM_HORIZON_HOURS, stormEnd + Math.max(0.5, postRainCap));
  const nSteps = Math.max(2, Math.ceil(provisionalEnd / dt) + 1);

  /** Conventional SCS cumulative excess — no C·P fabrication when Pe = 0. */
  const excessMm = [];
  let cumP = 0;
  let cumPe = 0;
  for (let i = 0; i < nSteps; i++) {
    const t0 = i * dt;
    const raining = t0 < stormEnd - 1e-9;
    const pPulse = raining ? intensityMmHr * dt : 0;
    cumP += pPulse;
    const peCum = scsExcessMm(cumP, Ia, S);
    const pePulse = Math.max(0, peCum - cumPe);
    cumPe = peCum;
    excessMm.push(pePulse);
  }

  const qDirect = convolve(excessMm, uh);

  let peakQ = baseflow;
  let peakIdx = 0;
  let peakDirect = 0;
  for (let i = 0; i < nSteps; i++) {
    const qd = Math.max(0, qDirect[i] || 0);
    const Q = baseflow + qd;
    if (Q > peakQ) {
      peakQ = Q;
      peakIdx = i;
      peakDirect = qd;
    }
  }

  let stabilizeIdx = nSteps - 1;
  let stabilized = false;
  const thresh = Math.max(1e-4, peakDirect * STABILIZE_Q_FRAC);
  let hold = 0;
  // If no direct runoff, stabilize immediately after storm
  if (peakDirect < 1e-6) {
    stabilizeIdx = Math.min(nSteps - 1, Math.ceil(stormEnd / dt) + 1);
    stabilized = true;
  } else {
    for (let i = peakIdx; i < nSteps; i++) {
      const qd = Math.max(0, qDirect[i] || 0);
      if (qd <= thresh) {
        hold += 1;
        if (hold >= STABILIZE_HOLD_STEPS) {
          stabilizeIdx = i;
          stabilized = true;
          break;
        }
      } else hold = 0;
    }
  }

  const endIdx = stabilized ? stabilizeIdx : nSteps - 1;
  const maxHorizonReached = !stabilized && provisionalEnd >= MAX_SIM_HORIZON_HOURS - 1e-6;
  const h0 = manningDepth(baseflow);
  const volume0 = geom ? volumeFromGeometry(geom, h0) : null;

  const samples = [];
  let cumRainMm = 0;
  let cumExcessMm = 0;

  for (let i = 0; i <= endIdx; i++) {
    const tHours = i * dt;
    const raining = tHours < stormEnd - 1e-9;
    const rainPulse = raining ? intensityMmHr * dt : 0;
    cumRainMm += rainPulse;
    cumExcessMm += excessMm[i] || 0;
    const Q = baseflow + Math.max(0, qDirect[i] || 0);
    const h = manningDepth(Q);
    const deltaStageM = h - h0;
    const A = approxWettedArea(h);
    const V = Q / Math.max(A, 1e-3);

    const volumeM3 = geom ? volumeFromGeometry(geom, h) : null;
    const volumeExtraM3 =
      volumeM3 != null && volume0 != null ? Math.max(0, volumeM3 - volume0) : null;
    const affectedLengthKm = geom
      ? affectedLengthKmFromGeometry(geom, deltaStageM, STAGE_AFFECTED_MIN_M)
      : null;

    samples.push({
      tHours: round(tHours, 3),
      rainMmHr: raining ? round(intensityMmHr, 4) : 0,
      excessMmHr: round((excessMm[i] || 0) / dt, 4),
      cumRainMm: round(Math.min(cumRainMm, cfg.depthMm), 4),
      cumExcessMm: round(cumExcessMm, 4),
      Q_m3s: round(Q, 3),
      deltaStageM: round(deltaStageM, 4),
      stageM: round(BASELINE_DEPTH_M + deltaStageM, 4),
      hydraulicDepthM: round(h, 4),
      baselineHydraulicDepthM: round(h0, 4),
      velocityMs: round(V, 3),
      wettedAreaM2: round(A, 2),
      volumeM3: volumeM3 != null ? round(volumeM3, 0) : null,
      volumeExtraM3: volumeExtraM3 != null ? round(volumeExtraM3, 0) : null,
      affectedLengthKm: affectedLengthKm != null ? round(affectedLengthKm, 3) : null,
      qDirect_m3s: round(Math.max(0, qDirect[i] || 0), 3),
    });
  }

  let peakSample = samples[0];
  for (const s of samples) {
    if (s.Q_m3s > peakSample.Q_m3s) peakSample = s;
  }

  const responseHours = Math.max(0, samples[samples.length - 1].tHours - stormEnd);
  const peTotal = samples.length ? samples[samples.length - 1].cumExcessMm : 0;
  const runoffVolumeM3 =
    (peTotal / 1000) * CATCHMENT_AREA_KM2 * 1e6; // mm over km² → m³

  return {
    meta: {
      model: "Conventional SCS-CN (Ia=0.2S) + triangular UH → Manning stage (ASSUMED)",
      assumptions: {
        catchmentAreaKm2: CATCHMENT_AREA_KM2,
        curveNumber: CURVE_NUMBER,
        potentialRetentionMm: round(S, 3),
        initialAbstractionMm: round(Ia, 3),
        initialAbstractionRatio: 0.2,
        lagHours: LAG_TIME_HOURS,
        manningN: MANNING_N,
        bedSlope: BED_SLOPE,
        distribution: cfg.distribution,
        verticalDatum: VERTICAL_DATUM,
        baselineDepthM: BASELINE_DEPTH_M,
        stabilizeQFrac: STABILIZE_Q_FRAC,
        maxSimHorizonHours: MAX_SIM_HORIZON_HOURS,
        stageAffectedMinM: STAGE_AFFECTED_MIN_M,
        reachLengthM: geom?.lengthM ?? null,
        baselineVolumeM3: volume0 != null ? round(volume0, 0) : null,
        volumeMethod: geom ? "corridor_width_x_hydraulic_depth_trapezoidal" : "unavailable",
        spatialStage: geom ? "lumped_uniform_on_aoi_reach" : "unavailable",
        note:
          "If total rainfall P ≤ Ia, SCS excess is zero — no fabricated runoff. Not gauge-calibrated.",
      },
      input: {
        depthMm: cfg.depthMm,
        durationHours: cfg.durationHours,
        intensityMmHr: round(intensityMmHr, 4),
        baseflowM3s: round(baseflow, 3),
        dtHours: dt,
        recessionHours: cfg.recessionHours,
        postRainCapHours: round(postRainCap, 3),
      },
      totals: {
        rainfallMm: cfg.depthMm,
        effectiveRainfallMm: round(peTotal, 4),
        runoffVolumeM3: round(runoffVolumeM3, 0),
        peakQm3s: round(peakSample.Q_m3s, 3),
        peakDeltaStageM: round(peakSample.deltaStageM, 4),
        peakStageM: round(peakSample.stageM, 4),
        peakVelocityMs: round(peakSample.velocityMs, 3),
        peakVolumeM3: peakSample.volumeM3,
        peakVolumeExtraM3: peakSample.volumeExtraM3,
        peakAffectedLengthKm: peakSample.affectedLengthKm,
        timeToPeakHours: round(peakSample.tHours, 3),
        stormEndHours: stormEnd,
        responseHours: round(responseHours, 3),
        totalHours: round(samples[samples.length - 1]?.tHours ?? 0, 3),
        uhBaseHours: round(uhBaseHours, 3),
        stabilized,
        stabilizeTimeHours: stabilized ? round(samples[samples.length - 1].tHours, 3) : null,
        maxHorizonReached,
        scsZeroExcess: peTotal < 1e-6,
      },
    },
    samples,
    peak: peakSample,
    reachGeometry: geom,
  };
}

function storageMm(cn) {
  return 25400 / Math.max(1, cn) - 254;
}

/** Conventional SCS: Pe = 0 when P ≤ Ia. */
function scsExcessMm(P, Ia, S) {
  if (P <= Ia) return 0;
  const num = (P - Ia) ** 2;
  const den = P - Ia + S;
  return den > 0 ? num / den : 0;
}

function triangularUnitHydrograph(dtHours) {
  const tLag = LAG_TIME_HOURS;
  const D = dtHours;
  const Tp = D / 2 + tLag;
  const Tb = 2.67 * Tp;
  const qp = (0.208 * CATCHMENT_AREA_KM2) / Math.max(0.25, Tp);
  const n = Math.max(3, Math.ceil(Tb / dtHours) + 1);
  const u = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const t = i * dtHours;
    if (t <= Tp) u[i] = qp * (t / Tp);
    else if (t <= Tb) u[i] = (qp * (Tb - t)) / (Tb - Tp);
    else u[i] = 0;
  }
  return u;
}

function convolve(excessMm, uh) {
  const out = new Array(excessMm.length).fill(0);
  for (let i = 0; i < excessMm.length; i++) {
    const pe = excessMm[i];
    if (pe <= 0) continue;
    for (let j = 0; j < uh.length; j++) {
      const k = i + j;
      if (k >= out.length) break;
      out[k] += pe * uh[j];
    }
  }
  return out;
}

/** Manning conveyance for a wide rectangular channel. n and slope are documented assumptions. */
export function manningDischarge(depthM, widthM = REF_WIDTH_M) {
  const h = Math.max(0.05, Number(depthM) || 0.05);
  const w = Math.max(5, Number(widthM) || REF_WIDTH_M);
  const A = w * h;
  const P = w + 2 * h;
  const R = A / Math.max(P, 1e-3);
  return (1 / MANNING_N) * A * Math.pow(R, 2 / 3) * Math.sqrt(BED_SLOPE);
}

export function manningDepthFor(Q, widthM = REF_WIDTH_M) {
  const q = Math.max(0.05, Number(Q) || 0);
  const w = Math.max(5, Number(widthM) || REF_WIDTH_M);
  let h = 1.0;
  for (let k = 0; k < 14; k++) {
    const A = w * h;
    const P = w + 2 * h;
    const R = A / Math.max(P, 1e-3);
    const Qcalc = (1 / MANNING_N) * A * Math.pow(R, 2 / 3) * Math.sqrt(BED_SLOPE);
    const err = Qcalc - q;
    const dQdh =
      (1 / MANNING_N) *
      Math.sqrt(BED_SLOPE) *
      (Math.pow(R, 2 / 3) * w +
        A * (2 / 3) * Math.pow(Math.max(R, 1e-3), -1 / 3) * ((w * P - A * 2) / (P * P)));
    h = Math.max(0.15, h - err / Math.max(dQdh, 1e-3));
  }
  return h;
}

export function manningDepth(Q) {
  return manningDepthFor(Q, REF_WIDTH_M);
}

function approxWettedArea(h) {
  return REF_WIDTH_M * Math.max(0.15, h);
}

function defaultBaseflow() {
  const m = new Date().getMonth() + 1;
  return m >= 6 && m <= 10 ? BASEFLOW_MONSOON_M3S : BASEFLOW_DRY_M3S;
}

function round(n, d) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

export function sampleAtTime(samples, tHours) {
  if (!samples?.length) return null;
  if (tHours <= samples[0].tHours) return { ...samples[0] };
  const last = samples[samples.length - 1];
  if (tHours >= last.tHours) return { ...last };
  let chosen = samples[0];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].tHours <= tHours) chosen = samples[i];
    else break;
  }
  return { ...chosen };
}

export function sampleBeforeTime(samples, tHours) {
  if (!samples?.length) return null;
  let prev = null;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].tHours < tHours - 1e-9) prev = samples[i];
    else break;
  }
  return prev ? { ...prev } : null;
}

/**
 * Single source of truth for UI + Three.js at simulation time t.
 */
export function buildSimulationResult({ samples, meta, peak, reachGeometry, tHours, status, phase }) {
  const current = sampleAtTime(samples, tHours);
  const totals = meta?.totals || {};
  const assumptions = meta?.assumptions || {};
  const input = meta?.input || {};
  const rise = current?.deltaStageM ?? 0;
  const chainage = reachGeometry
    ? chainageStageResults(
        reachGeometry,
        assumptions.baselineDepthM ?? BASELINE_DEPTH_M,
        rise,
        assumptions.stageAffectedMinM ?? STAGE_AFFECTED_MIN_M,
      )
    : null;

  return {
    simulation_time: round(Number(tHours) || 0, 3),
    status: status || null,
    phase: phase || null,
    rainfall_total_mm: input.depthMm ?? totals.rainfallMm ?? null,
    rainfall_duration_hours: input.durationHours ?? null,
    rainfall_intensity_mm_hr: current?.rainMmHr ?? 0,
    rainfall_completed_mm: current?.cumRainMm ?? 0,
    effective_rainfall_mm: current?.cumExcessMm ?? 0,
    scs: {
      CN: assumptions.curveNumber ?? CURVE_NUMBER,
      S_mm: assumptions.potentialRetentionMm ?? null,
      Ia_mm: assumptions.initialAbstractionMm ?? null,
      Pe_mm: totals.effectiveRainfallMm ?? 0,
      zero_excess: !!totals.scsZeroExcess,
    },
    baseline_stage_m: assumptions.baselineDepthM ?? BASELINE_DEPTH_M,
    current_stage_m: current?.stageM ?? assumptions.baselineDepthM ?? BASELINE_DEPTH_M,
    current_stage_rise_m: rise,
    maximum_stage_rise_m: totals.peakDeltaStageM ?? 0,
    peak_stage_m: totals.peakStageM ?? null,
    peak_stage_time: totals.timeToPeakHours ?? null,
    discharge_m3_s: current?.Q_m3s ?? null,
    velocity_m_s: current?.velocityMs ?? null,
    baseline_volume_m3: assumptions.baselineVolumeM3 ?? null,
    current_volume_m3: current?.volumeM3 ?? null,
    additional_volume_m3: current?.volumeExtraM3 ?? null,
    maximum_volume_m3: totals.peakVolumeM3 ?? null,
    affected_length_km: current?.affectedLengthKm ?? null,
    maximum_affected_length_km: totals.peakAffectedLengthKm ?? null,
    runoff_volume_m3: totals.runoffVolumeM3 ?? null,
    chainage_stage_results: chainage,
    current_sample: current,
    peak_sample: peak || null,
  };
}
