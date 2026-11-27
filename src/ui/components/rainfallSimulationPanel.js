import "../../styles/rainfall-simulation.css";
import { CloudDrizzle, Info, X, Play, Pause, RotateCcw } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import {
  startRainfallSimulation,
  updateRainfallSimulation,
  getRainfallStatus,
  pauseRainfallSimulation,
  resumeRainfallSimulation,
  resetRainfallSimulation,
  setRainfallPlaybackSpeed,
  previewSeries,
  getSceneReachGeometry,
  SIM_STATUSES,
  PHASE_STATUSES,
  PLAYBACK_SPEED_PRESETS,
} from "../../services/rainfallSimulation/RainfallSimulationService.js";
import {
  composeCoupled,
  flowRiseM,
  getScenarioAdjustments,
  publish,
  readLiveSource,
  resetScenarioAdjustments,
} from "../../services/hydrology/coupledScenario.js";

/**
 * Compact Rainfall Simulation panel — user-facing rainfall + river response.
 * Provenance stays in the info tooltip. Flood Simulation is never invoked.
 */
export function mountRainfallSimulationPanel(root) {
  const dock = document.createElement("div");
  dock.id = "rainfall-left-dock";
  dock.className = "rainfall-left-dock";
  dock.hidden = true;
  root.appendChild(dock);

  const panel = document.createElement("section");
  panel.className = "rainfall-panel";
  panel.setAttribute("aria-label", "Rainfall Simulation");
  dock.appendChild(panel);

  panel.innerHTML = `
    <div class="rainfall-mode-row" role="group" aria-label="Rain simulation modes">
      <button type="button" data-rain-sim="hydrology" title="Hydrology simulation">Hydrology</button>
      <button type="button" class="is-on" data-rain-sim="rainfall" title="Rainfall simulation">Rainfall</button>
      <button type="button" data-rain-sim="hydrograph" title="Hydrograph simulation">Hydrograph</button>
      <button type="button" data-rain-sim="discharge" title="Discharge simulation">Discharge</button>
    </div>
    <header class="rainfall-panel__head">
      <span class="rainfall-panel__icon" aria-hidden="true">${lucideHtml(CloudDrizzle, { size: 16 })}</span>
      <div class="rainfall-panel__titles">
        <strong>RAINFALL SIMULATION</strong>
        <small>Mula–Mutha River Response</small>
      </div>
      <div class="rainfall-panel__actions">
        <button type="button" class="rainfall-icon-btn" data-act="info" aria-label="About this model" title="About this model">
          ${lucideHtml(Info, { size: 13 })}
        </button>
        <button type="button" class="rainfall-icon-btn" data-act="close" aria-label="Close panel" title="Close">
          ${lucideHtml(X, { size: 13 })}
        </button>
      </div>
    </header>
    <div class="rainfall-status" data-status="READY" data-el="status">READY</div>
    <div class="rainfall-status rainfall-status--couple" data-status="READY" data-el="couple">READY</div>

    <div class="rainfall-section">
      <p class="rainfall-section__label">Rainfall Event</p>
      <div class="rainfall-field">
        <div class="rainfall-field__row"><span>Total rainfall</span><b data-el="depth-label">10.0 mm</b></div>
        <input type="range" min="0" max="100" step="1" value="10" data-el="depth" aria-label="Total rainfall in millimetres" />
      </div>
      <div class="rainfall-field">
        <div class="rainfall-field__row"><span>Duration</span><b data-el="dur-label">2.0 h</b></div>
        <input type="range" min="1" max="24" step="0.5" value="2" data-el="dur" aria-label="Rainfall duration in hours" />
      </div>
      <div class="rainfall-readout">
        <div class="rainfall-readout__card"><span>Avg intensity</span><strong data-el="intensity">5.00 mm/hr</strong></div>
      </div>
    </div>

    <div class="rainfall-controls">
      <button type="button" class="rainfall-btn rainfall-btn--primary" data-act="start">
        ${lucideHtml(Play, { size: 12 })} Start
      </button>
      <button type="button" class="rainfall-btn" data-act="pause" disabled>
        ${lucideHtml(Pause, { size: 12 })} Pause
      </button>
      <button type="button" class="rainfall-btn" data-act="resume" disabled>Resume</button>
      <button type="button" class="rainfall-btn" data-act="reset" disabled>
        ${lucideHtml(RotateCcw, { size: 12 })} Reset
      </button>
    </div>
    <div class="rainfall-speed rainfall-speed--compact" role="group" aria-label="Playback speed">
      ${PLAYBACK_SPEED_PRESETS.map(
        (s) =>
          `<button type="button" class="rainfall-speed__btn${s === 1 ? " is-active" : ""}" data-speed="${s}">${s}×</button>`,
      ).join("")}
    </div>

    <div class="rainfall-section">
      <p class="rainfall-section__label">River Response</p>
      <div class="rainfall-metrics rainfall-metrics--primary">
        <div class="rainfall-metric"><span>Source discharge</span><strong data-m="SrcQ">—</strong></div>
        <div class="rainfall-metric"><span>Scenario discharge</span><strong data-m="ScenQ">—</strong></div>
        <div class="rainfall-metric"><span>Rainfall runoff</span><strong data-m="Runoff">0 m³/s</strong></div>
        <div class="rainfall-metric"><span>Combined inflow</span><strong data-m="CombQ">—</strong></div>
        <div class="rainfall-metric"><span>Water-level rise</span><strong data-m="dStage">+0.00 m</strong></div>
        <div class="rainfall-metric"><span>River water level</span><strong data-m="Stage">—</strong></div>
        <div class="rainfall-metric"><span>River volume</span><strong data-m="VolExtra">—</strong></div>
        <div class="rainfall-metric"><span>Floodplain volume</span><strong data-m="VolFlood">N/A</strong></div>
        <div class="rainfall-metric"><span>Left-bank spread</span><strong data-m="Left">N/A</strong></div>
        <div class="rainfall-metric"><span>Right-bank spread</span><strong data-m="Right">N/A</strong></div>
        <div class="rainfall-metric"><span>Maximum spread</span><strong data-m="Spread">N/A</strong></div>
        <div class="rainfall-metric"><span>Floodplain area</span><strong data-m="Flood" class="is-na">N/A</strong></div>
        <div class="rainfall-metric"><span>Affected length</span><strong data-m="AffKm">—</strong></div>
      </div>
      <div class="rainfall-peak-line">
        <span>Max water-level rise</span>
        <strong data-m="peakDs">—</strong>
      </div>
    </div>

    <div class="rainfall-section">
      <p class="rainfall-section__label">Response Graph</p>
      <div class="rainfall-chart-tabs" role="tablist">
        <button type="button" class="is-active" data-chart="stage">Water level</button>
        <button type="button" data-chart="discharge">Discharge</button>
        <button type="button" data-chart="rain">Rain</button>
        <button type="button" data-chart="area">Flooded area</button>
      </div>
      <canvas class="rainfall-chart" data-el="chart" width="280" height="96" aria-label="River response graph"></canvas>
    </div>

    <div class="rainfall-info-pop" data-el="info" hidden>
      MODELLED / UNCALIBRATED. Storage is ΔV = ∫(Qin − Qout) dt on the mapped channel
      width. Rainfall becomes SCS-CN excess runoff and is added once. It is not written
      back into NadiTwin discharge. Flood spread is the horizontal distance beyond the
      mapped water edge where the DTM is below the water surface and connected to the
      river. Relative stage is not MSL. Not engineering-verified.
    </div>
  `;

  const el = (sel) => panel.querySelector(sel);
  const depthInput = el('[data-el="depth"]');
  const durInput = el('[data-el="dur"]');
  const chartCanvas = el('[data-el="chart"]');
  const ctx = chartCanvas.getContext("2d");

  let simId = state.rainfallSim?.id || null;
  let status = state.rainfallSim?.status || SIM_STATUSES.READY;
  let phase = state.rainfallSim?.phase || PHASE_STATUSES.READY;
  let series = state.rainfallSim?.series || null;
  let chartMode = state.rainfallSim?.chartMode || "stage";
  let playbackMult = state.rainfallSim?.playbackMult || 1;
  let raf = 0;
  let generation = 0;
  let applyingRiver = false;

  function depthMm() {
    return Number(depthInput.value) || 0;
  }
  function durationHours() {
    return Number(durInput.value) || 1;
  }

  function syncSpeedButtons() {
    panel.querySelectorAll("[data-speed]").forEach((b) => {
      b.classList.toggle("is-active", Math.abs(Number(b.getAttribute("data-speed")) - playbackMult) < 1e-6);
    });
  }

  function syncLabels() {
    const d = depthMm();
    const h = durationHours();
    const i = h > 0 ? d / h : 0;
    el('[data-el="depth-label"]').textContent = `${d.toFixed(1)} mm`;
    el('[data-el="dur-label"]').textContent = `${h.toFixed(1)} h`;
    el('[data-el="intensity"]').textContent = `${i.toFixed(2)} mm/hr`;
  }

  function friendlyPhase(p) {
    if (!p) return status;
    if (p === PHASE_STATUSES.READY || p === "READY") return "READY";
    if (p === PHASE_STATUSES.PAUSED || p === "PAUSED") return "PAUSED";
    if (p === PHASE_STATUSES.RAINING || p === "RAINING") return "RAINING";
    if (p === PHASE_STATUSES.STABILIZED || p === "STABILIZED") return "DONE";
    if (p === PHASE_STATUSES.HORIZON_REACHED) return "DONE";
    if (status === SIM_STATUSES.COMPLETED) return "DONE";
    if (p === PHASE_STATUSES.PEAK_RESPONSE) return "PEAK";
    if (p === PHASE_STATUSES.RIVER_RECESSION) return "RECEDING";
    if (p === PHASE_STATUSES.RIVER_RISING) return "RISING";
    if (p === PHASE_STATUSES.RUNOFF_ROUTING) return "ROUTING";
    return String(p);
  }

  function setStatus(s, phaseLabel) {
    status = s;
    if (phaseLabel) phase = phaseLabel;
    const badge = el('[data-el="status"]');
    const display = friendlyPhase(phase || s);
    badge.dataset.status = String(phase || s).replace(/\s+/g, "_");
    badge.textContent = display;
    const running = s === SIM_STATUSES.RUNNING;
    const paused = s === SIM_STATUSES.PAUSED;
    const ready = s === SIM_STATUSES.READY;
    el('[data-act="start"]').disabled = running;
    el('[data-act="pause"]').disabled = !running;
    el('[data-act="resume"]').disabled = !paused;
    el('[data-act="reset"]').disabled = ready && !simId;
    if (state.rainfallSim) {
      state.rainfallSim.status = s;
      state.rainfallSim.phase = phase;
      state.rainfallSim.id = simId;
    }
  }

  function setMetric(key, text, na = false) {
    const node = el(`[data-m="${key}"]`);
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("is-na", !!na);
  }

  function fmtVol(n) {
    if (!Number.isFinite(Number(n))) return "—";
    return `${Math.round(Number(n)).toLocaleString()} m³`;
  }

  /** All primary metrics from snap.result (single source of truth). */
  function applyMetrics(sample, snap) {
    const r = snap?.result;
    const totals = snap?.meta?.totals || series?.meta?.totals;
    const peakDs = r?.maximum_stage_rise_m ?? totals?.peakDeltaStageM;
    if (peakDs != null && Number.isFinite(Number(peakDs))) {
      setMetric("peakDs", `${Number(peakDs) >= 0 ? "+" : ""}${Number(peakDs).toFixed(3)} m`);
    } else {
      setMetric("peakDs", "—");
    }

    const cur = r || sample;
    if (!cur && !sample) {
      paintView(composeCoupled({
        active: false, running: false, paused: false, status, runoffQ: 0, engineRiseM: 0,
        rainMmHr: 0, volumeExtraM3: null, volumeM3: null, affectedKm: null, peakRiseM: null,
      }));
      return;
    }

    paintView(composeCoupled(coupledSample(sample, snap)));
  }

  function paintView(view) {
    if (!view) return;
    paintCouple(view);
    const fill = state.riverFill?.ownsVisual ? state.riverFill : null;
    const sourceQ = fill?.sourceQ ?? view.sourceQ;
    const runoffQ = fill ? fill.runoffQ : view.runoffQ;
    const combinedQ = fill?.qIn ?? view.combinedQ;
    const rise = fill?.riseM ?? view.visualRiseM ?? 0;
    const stage = fill?.stageRel ?? view.simulatedStageRel;
    setMetric("SrcQ", Number.isFinite(sourceQ) ? `${sourceQ.toFixed(1)} m³/s` : "N/A", !Number.isFinite(sourceQ));
    setMetric("ScenQ", Number.isFinite(fill?.scenarioQ) ? `${fill.scenarioQ.toFixed(1)} m³/s` : Number.isFinite(sourceQ) ? `${(sourceQ + (view.dischargeDeltaM3s || 0)).toFixed(1)} m³/s` : "N/A");
    setMetric("Runoff", Number.isFinite(runoffQ) ? `${runoffQ.toFixed(1)} m³/s` : "0.0 m³/s");
    setMetric("CombQ", Number.isFinite(combinedQ) ? `${combinedQ.toFixed(1)} m³/s` : "N/A", !Number.isFinite(combinedQ));
    setMetric("dStage", `${rise >= 0 ? "+" : ""}${Number(rise).toFixed(3)} m · MODELLED`);
    setMetric("Stage", Number.isFinite(stage) ? `${stage.toFixed(2)} m rel` : "N/A", !Number.isFinite(stage));

    const volX = fill?.volumeRiverM3 ?? view.volumeExtraM3;
    const aff = fill?.affectedKm ?? view.affectedLengthKm;
    setMetric("VolExtra", volX != null ? `${fmtVol(volX)} · MODELLED` : "N/A", volX == null);
    setMetric("VolFlood", fill?.volumeFloodM3 != null ? `${fmtVol(fill.volumeFloodM3)} · MODELLED` : "N/A", fill?.volumeFloodM3 == null);
    setMetric("Left", fill?.leftM != null ? `${fill.leftM.toFixed(0)} m` : "N/A", fill?.leftM == null);
    setMetric("Right", fill?.rightM != null ? `${fill.rightM.toFixed(0)} m` : "N/A", fill?.rightM == null);
    setMetric("Spread", fill?.maxM != null ? `${fill.maxM.toFixed(0)} m` : "N/A", fill?.maxM == null);
    setMetric(
      "Flood",
      fill?.areaKm2 != null ? `${fill.areaKm2.toFixed(3)} km² · MODELLED` : "N/A",
      fill?.areaKm2 == null,
    );
    setMetric(
      "AffKm",
      aff != null ? `${Number(aff).toFixed(2)} km · MODELLED` : "N/A",
      aff == null,
    );
  }

  function coupledSample(sample, snap) {
    const cur = sample || snap?.current_sample || snap?.result?.current_sample || null;
    const running = status === SIM_STATUSES.RUNNING;
    const paused = status === SIM_STATUSES.PAUSED;
    const active = running || paused || status === SIM_STATUSES.COMPLETED;
    return {
      active,
      running,
      paused,
      status,
      runoffQ: Number(cur?.qDirect_m3s) || 0,
      engineRiseM: Number(cur?.deltaStageM ?? snap?.result?.current_stage_rise_m) || 0,
      rainMmHr: Number(cur?.rainMmHr ?? snap?.result?.rainfall_intensity_mm_hr) || 0,
      volumeExtraM3: snap?.result?.additional_volume_m3 ?? cur?.volumeExtraM3 ?? null,
      volumeM3: snap?.result?.current_volume_m3 ?? cur?.volumeM3 ?? null,
      affectedKm: snap?.result?.affected_length_km ?? cur?.affectedLengthKm ?? null,
      peakRiseM: snap?.result?.maximum_stage_rise_m ?? null,
    };
  }

  function paintCouple(view) {
    const badge = el('[data-el="couple"]');
    if (!badge) return;
    const labels = {
      COUPLED: "COUPLED SIMULATION ACTIVE",
      RAINFALL: "RAINFALL ACTIVE",
      HYDROLOGY: "HYDROLOGY ACTIVE",
      PAUSED: "PAUSED",
      READY: "READY",
    };
    const mode = view?.mode || "READY";
    badge.dataset.status = mode;
    badge.textContent = labels[mode] || mode;
  }

  function sourceBaseflow() {
    const src = readLiveSource();
    const q = src.qChainage ?? src.qOut ?? src.qUp;
    return Number.isFinite(q) ? q : undefined;
  }

  async function applyRiver(sample, snap) {
    if (applyingRiver) return;
    applyingRiver = true;
    try {
      const scene = window.__MM_SCENE__;
      const view = publish(coupledSample(sample, snap));
      const rainI = view.rainMmHr || 0;
      scene?.rainfallSimParticles?.setFromIntensity?.(rainI, {
        waterY: 9.4 + (view.visualRiseM || 0),
      });
      if (rainI > 0) scene?.riverRain?.setIntensity?.(0.01, 0);
      else scene?.riverRain?.setIntensity?.(null);
    } finally {
      applyingRiver = false;
    }
  }

  function drawChart(snap) {
    const w = chartCanvas.width;
    const h = chartCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const fillSeries = state.riverFill?.series;
    if (fillSeries?.length) {
      const ys = fillSeries.map((p) => {
        if (chartMode === "discharge") return Number(p.qIn) || 0;
        if (chartMode === "rain") return Number(p.rain) || 0;
        if (chartMode === "area") return Number(p.areaKm2) || 0;
        return Number(p.riseM) || 0;
      });
      strokeSeries(fillSeries.map((p) => p.tHours), ys, state.riverFill.durationH || 1, state.riverFill.tHours);
      return;
    }
    const pts =
      series?.samples ||
      snap?.series ||
      previewSeries({ depthMm: depthMm(), durationHours: durationHours() }).samples;
    if (chartMode === "area") {
      ctx.fillStyle = "rgba(180, 210, 220, 0.8)";
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("Flooded area N/A until the filling clock runs", 12, h / 2);
      return;
    }
    if (!pts?.length) return;

    const stormEnd =
      snap?.storm_end_hours ?? series?.meta?.input?.durationHours ?? durationHours();
    const src = readLiveSource();
    const sourceQ = src.qChainage ?? src.qOut ?? src.qUp;
    const adj = getScenarioAdjustments();
    const xs = pts.map((p) => p.tHours);
    const ys = pts.map((p) => {
      if (chartMode === "discharge") {
        const runoff = Number(p.qDirect_m3s) || 0;
        return Number.isFinite(sourceQ) ? sourceQ + runoff + adj.dischargeDeltaM3s : Number(p.Q_m3s) || 0;
      }
      if (chartMode === "rain") return Number(p.rainMmHr) || 0;
      return flowRiseM(sourceQ, Number(p.qDirect_m3s) || 0, adj.dischargeDeltaM3s, p.deltaStageM) + adj.stageAdjustM;
    });
    const x0 = xs[0];
    const x1 = xs[xs.length - 1] || 1;
    const padL = 8;
    const padR = 8;
    const padT = 8;
    const padB = 14;
    let yMin = Math.min(...ys, 0);
    let yMax = Math.max(...ys, 0.01);
    if (yMax === yMin) yMax = yMin + 0.01;
    const xAt = (t) => padL + ((t - x0) / (x1 - x0)) * (w - padL - padR);

    // Rain period shade
    ctx.fillStyle = "rgba(90, 170, 220, 0.12)";
    ctx.fillRect(xAt(x0), padT, Math.max(0, xAt(stormEnd) - xAt(x0)), h - padT - padB);

    ctx.strokeStyle = "rgba(90, 160, 185, 0.25)";
    ctx.beginPath();
    ctx.moveTo(padL, h - padB);
    ctx.lineTo(w - padR, h - padB);
    ctx.stroke();

    ctx.strokeStyle = chartMode === "discharge" ? "#7ee0a8" : chartMode === "rain" ? "#9ecbff" : "#5ee0f5";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = xAt(xs[i]);
      const y = padT + (h - padT - padB) - ((ys[i] - yMin) / (yMax - yMin)) * (h - padT - padB);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Rain end marker
    ctx.strokeStyle = "rgba(200, 180, 255, 0.55)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xAt(stormEnd), padT);
    ctx.lineTo(xAt(stormEnd), h - padB);
    ctx.stroke();
    ctx.setLineDash([]);

    const tNow = snap?.elapsed_hours;
    if (Number.isFinite(tNow) && status !== SIM_STATUSES.READY) {
      ctx.strokeStyle = "rgba(255, 210, 100, 0.9)";
      ctx.beginPath();
      ctx.moveTo(xAt(tNow), padT);
      ctx.lineTo(xAt(tNow), h - padB);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(160, 190, 205, 0.65)";
    ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("0 h", padL, h - 2);
    ctx.fillText(`${x1.toFixed(0)} h`, w - padR - 22, h - 2);
  }

  function strokeSeries(xs, ys, xEnd, tNow) {
    const w = chartCanvas.width;
    const h = chartCanvas.height;
    const padL = 8;
    const padR = 8;
    const padT = 8;
    const padB = 14;
    const x0 = xs[0] ?? 0;
    const x1 = xEnd || xs[xs.length - 1] || 1;
    let yMin = Math.min(...ys, 0);
    let yMax = Math.max(...ys, 0.01);
    if (yMax === yMin) yMax = yMin + 0.01;
    const xAt = (t) => padL + ((t - x0) / Math.max(1e-6, x1 - x0)) * (w - padL - padR);
    ctx.strokeStyle = "rgba(90, 160, 185, 0.25)";
    ctx.beginPath();
    ctx.moveTo(padL, h - padB);
    ctx.lineTo(w - padR, h - padB);
    ctx.stroke();
    ctx.strokeStyle = chartMode === "discharge" ? "#7ee0a8" : chartMode === "rain" ? "#9ecbff" : chartMode === "area" ? "#f0d080" : "#5ee0f5";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const x = xAt(xs[i]);
      const y = padT + (h - padT - padB) - ((ys[i] - yMin) / (yMax - yMin)) * (h - padT - padB);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (Number.isFinite(tNow)) {
      ctx.strokeStyle = "rgba(255, 210, 100, 0.9)";
      ctx.beginPath();
      ctx.moveTo(xAt(tNow), padT);
      ctx.lineTo(xAt(tNow), h - padB);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(160, 190, 205, 0.65)";
    ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("0 h", padL, h - 2);
    ctx.fillText(`${x1.toFixed(0)} h`, w - padR - 22, h - 2);
  }

  function persist(snap) {
    state.rainfallSim = {
      id: simId,
      status,
      phase,
      series: series || (snap ? { samples: snap.series, meta: snap.meta } : null),
      lastSnap: snap || null,
      depthMm: depthMm(),
      durationHours: durationHours(),
      chartMode,
      playbackMult,
    };
  }

  async function tick() {
    if (!simId || status === SIM_STATUSES.READY) return;
    const run = generation;
    try {
      const snap = await getRainfallStatus(simId);
      if (run !== generation) return;
      status = snap.status;
      phase = snap.phase || phase;
      setStatus(status, phase);
      series = { samples: snap.series, meta: snap.meta };
      applyMetrics(snap.current, snap);
      const done = status === SIM_STATUSES.COMPLETED;
      await applyRiver(snap.current, snap, { settled: done });
      drawChart(snap);
      persist(snap);
      if (status === SIM_STATUSES.RUNNING) {
        raf = requestAnimationFrame(() => void tick());
      } else {
        raf = 0;
        if (done && snap.current) {
          window.__MM_SCENE__?.rainfallSimParticles?.setFromIntensity?.(0);
          window.__MM_SCENE__?.settleHydrologySimulation?.();
        }
      }
    } catch (err) {
      console.warn("[rainfall-sim]", err);
      raf = 0;
    }
  }

  function stopLoop() {
    generation += 1;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  async function onStart() {
    stopLoop();
    try {
      const snap = await startRainfallSimulation({
        depthMm: depthMm(),
        durationHours: durationHours(),
        playbackSpeed: playbackMult,
        baseflowM3s: sourceBaseflow(),
        reachGeometry: getSceneReachGeometry(),
      });
      simId = snap.simulation_id;
      series = { samples: snap.series, meta: snap.meta };
      setStatus(SIM_STATUSES.RUNNING, snap.phase || PHASE_STATUSES.RAINING);
      applyMetrics(snap.current, snap);
      window.__MM_SCENE__?.rainfallSimParticles?.clear?.();
      await applyRiver(snap.current, snap);
      drawChart(snap);
      persist(snap);
      raf = requestAnimationFrame(() => void tick());
    } catch (err) {
      console.warn("[rainfall-sim] start failed", err);
      setStatus(SIM_STATUSES.READY, PHASE_STATUSES.READY);
    }
  }

  async function onPause() {
    if (!simId) return;
    const snap = await pauseRainfallSimulation(simId);
    stopLoop();
    setStatus(snap.status, snap.phase);
    applyMetrics(snap.current, snap);
    drawChart(snap);
    persist(snap);
    window.__MM_SCENE__?.rainfallSimParticles?.setPaused?.(true);
  }

  async function onResume() {
    if (!simId) return;
    window.__MM_SCENE__?.rainfallSimParticles?.setPaused?.(false);
    const snap = await resumeRainfallSimulation(simId);
    setStatus(snap.status, snap.phase);
    persist(snap);
    raf = requestAnimationFrame(() => void tick());
  }

  async function onReset() {
    stopLoop();
    if (simId) {
      try {
        await resetRainfallSimulation(simId);
      } catch {
        /* ignore */
      }
    }
    simId = null;
    series = null;
    phase = PHASE_STATUSES.READY;
    setStatus(SIM_STATUSES.READY, PHASE_STATUSES.READY);
    persist(null);
    resetScenarioAdjustments();
    window.__MM_SCENE__?.riverRain?.setPaused?.(false);
    window.__MM_SCENE__?.riverRain?.setIntensity?.(null);
    window.__MM_SCENE__?.rainfallSimParticles?.setPaused?.(false);
    window.__MM_SCENE__?.rainfallSimParticles?.clear?.();
    applyMetrics(null, null);
    setMetric("peakDs", "—");
    drawChart(null);
    persist(null);
  }

  async function applySpeed(mult) {
    playbackMult = Math.max(0.1, Math.min(120, Number(mult) || 1));
    syncSpeedButtons();
    if (simId && status !== SIM_STATUSES.READY) {
      try {
        const snap = await setRainfallPlaybackSpeed(simId, playbackMult);
        setStatus(snap.status, snap.phase);
        persist(snap);
      } catch (err) {
        console.warn("[rainfall-sim] speed", err);
      }
    }
    if (state.rainfallSim) state.rainfallSim.playbackMult = playbackMult;
  }

  let updateTimer = 0;
  function onParamsChanged() {
    syncLabels();
    clearTimeout(updateTimer);
    updateTimer = window.setTimeout(async () => {
      if (simId && status !== SIM_STATUSES.READY) {
        try {
          const snap = await updateRainfallSimulation(simId, {
            depthMm: depthMm(),
            durationHours: durationHours(),
            playbackSpeed: playbackMult,
            baseflowM3s: sourceBaseflow(),
            reachGeometry: getSceneReachGeometry(),
          });
          series = { samples: snap.series, meta: snap.meta };
          setStatus(snap.status, snap.phase);
          applyMetrics(snap.current, snap);
          drawChart(snap);
          persist(snap);
          await applyRiver(snap.current, snap);
          return;
        } catch (err) {
          console.warn("[rainfall-sim] update", err);
        }
      }
      series = previewSeries({
        depthMm: depthMm(),
        durationHours: durationHours(),
        baseflowM3s: sourceBaseflow(),
        reachGeometry: getSceneReachGeometry(),
      });
      drawChart(null);
      // Preview peak from THIS rainfall only — never leave a stale max from another run
      const pDs = series?.meta?.totals?.peakDeltaStageM;
      setMetric(
        "peakDs",
        pDs != null ? `${Number(pDs) >= 0 ? "+" : ""}${Number(pDs).toFixed(3)} m` : "—",
      );
      const s0 = series?.samples?.[0];
      applyMetrics(s0, {
        result: {
          current_stage_rise_m: s0?.deltaStageM ?? 0,
          maximum_stage_rise_m: pDs ?? 0,
          current_volume_m3: s0?.volumeM3 ?? null,
          additional_volume_m3: s0?.volumeExtraM3 ?? null,
          affected_length_km: s0?.affectedLengthKm ?? null,
        },
        meta: series?.meta,
      });
    }, 120);
  }

  depthInput.addEventListener("input", onParamsChanged);
  durInput.addEventListener("input", onParamsChanged);

  const hooks = { onClose: null };

  function selectRainMode(id) {
    panel.querySelectorAll("[data-rain-sim]").forEach((b) => {
      b.classList.toggle("is-on", b.getAttribute("data-rain-sim") === id);
    });
  }

  panel.addEventListener("click", (e) => {
    const modeBtn = e.target.closest("[data-rain-sim]");
    if (modeBtn) {
      const mode = modeBtn.getAttribute("data-rain-sim");
      selectRainMode(mode);
      if (mode === "hydrology") document.querySelector("[data-hydrology-panel]")?.click();
      else if (mode === "hydrograph" || mode === "discharge") {
        document.querySelector(`[data-simulation="${mode}"]`)?.click();
      }
      return;
    }
    const btn = e.target.closest("[data-act],[data-chart],[data-speed]");
    if (!btn) return;
    const speed = btn.getAttribute("data-speed");
    if (speed != null) {
      void applySpeed(speed);
      return;
    }
    const chart = btn.getAttribute("data-chart");
    if (chart) {
      chartMode = chart;
      panel.querySelectorAll("[data-chart]").forEach((b) => b.classList.toggle("is-active", b === btn));
      drawChart(state.rainfallSim?.lastSnap || null);
      if (state.rainfallSim) state.rainfallSim.chartMode = chartMode;
      return;
    }
    const act = btn.getAttribute("data-act");
    if (act === "close") {
      hide();
      hooks.onClose?.();
      return;
    }
    if (act === "info") {
      const info = el('[data-el="info"]');
      info.hidden = !info.hidden;
      return;
    }
    if (act === "start") void onStart();
    if (act === "pause") void onPause();
    if (act === "resume") void onResume();
    if (act === "reset") void onReset();
  });

  function placeRelativeToFlood() {
    const flood = document.getElementById("flood-left-dock");
    if (flood && !flood.hidden && state.showFloodBar) {
      let bottom = flood.getBoundingClientRect().bottom;
      for (const child of flood.children) {
        if (child.hidden) continue;
        const r = child.getBoundingClientRect();
        if (r.height > 0) bottom = Math.max(bottom, r.bottom);
      }
      dock.style.top = `${Math.round(bottom + 10)}px`;
      dock.classList.add("is-below-flood");
    } else {
      dock.style.top = "";
      dock.classList.remove("is-below-flood");
    }
  }

  function show() {
    dock.hidden = false;
    state.showRainfallBar = true;
    root.classList.add("rainfall-sim-open");
    placeRelativeToFlood();
    syncLabels();
    syncSpeedButtons();
    panel.querySelectorAll("[data-chart]").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-chart") === chartMode);
    });
    if (state.rainfallSim?.id) {
      simId = state.rainfallSim.id;
      status = state.rainfallSim.status || SIM_STATUSES.READY;
      phase = state.rainfallSim.phase || PHASE_STATUSES.READY;
      series = state.rainfallSim.series;
      playbackMult = state.rainfallSim.playbackMult || 1;
      if (state.rainfallSim.depthMm != null) depthInput.value = String(state.rainfallSim.depthMm);
      if (state.rainfallSim.durationHours != null) durInput.value = String(state.rainfallSim.durationHours);
      chartMode = state.rainfallSim.chartMode || "stage";
      panel.querySelectorAll("[data-chart]").forEach((b) => {
        b.classList.toggle("is-active", b.getAttribute("data-chart") === chartMode);
      });
      syncLabels();
      syncSpeedButtons();
      setStatus(status, phase);
      if (state.rainfallSim.lastSnap) {
        applyMetrics(state.rainfallSim.lastSnap.current, state.rainfallSim.lastSnap);
        drawChart(state.rainfallSim.lastSnap);
      } else drawChart(null);
      if (status === SIM_STATUSES.RUNNING && !raf) {
        raf = requestAnimationFrame(() => void tick());
      }
    } else {
      setStatus(SIM_STATUSES.READY, PHASE_STATUSES.READY);
      onParamsChanged();
    }
  }

  function hide() {
    dock.hidden = true;
    state.showRainfallBar = false;
    root.classList.remove("rainfall-sim-open");
  }

  function isOpen() {
    return !dock.hidden;
  }

  document.addEventListener("hydrology-panel-toggle", (e) => {
    const open = !!e.detail?.open;
    const current = panel.querySelector("[data-rain-sim].is-on")?.getAttribute("data-rain-sim");
    if (open) selectRainMode("hydrology");
    else if (current === "hydrology") selectRainMode("rainfall");
  });
  document.addEventListener("coupled-scenario-change", (e) => {
    paintView(e.detail);
    drawChart(state.rainfallSim?.lastSnap || null);
  });
  document.addEventListener("river-fill-tick", () => {
    paintView(state.coupledScenario || composeCoupled());
    drawChart(state.rainfallSim?.lastSnap || null);
  });
  document.addEventListener("coupled-scenario-full-reset", () => { void onReset(); });
  window.addEventListener("resize", placeRelativeToFlood);
  syncLabels();
  syncSpeedButtons();
  setStatus(SIM_STATUSES.READY, PHASE_STATUSES.READY);
  onParamsChanged();

  return {
    dock,
    panel,
    show,
    hide,
    isOpen,
    placeRelativeToFlood,
    set onClose(fn) {
      hooks.onClose = fn;
    },
  };
}
