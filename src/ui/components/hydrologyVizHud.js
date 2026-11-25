/**
 * Hydrology 3D modes/timeline HUD — retired from Digital Twin entry.
 * Digital Twin opens Charts directly; this module keeps a no-op API for callers.
 */
import { metersToStation } from "../../scene/chainageMarkers.js";
import { state } from "../../state.js";
import {
  HYDRO_VIZ_MODES,
  buildHydroVizSeries,
  getHydroVizSnapshot,
  getRatingPointsAtChainage,
  inspectHydroAtChainage,
  setHydroVizActive,
  setHydroVizMode,
  setHydroVizOffsetHours,
  setHydroVizPlaySpeed,
  setHydroVizPlaying,
  setHydroVizSelectedMeters,
  stepHydroVizOffset,
  subscribeHydroViz,
  getHydroVizSnapshot as peekSnap,
} from "../../services/hydrology/hydrologyVizService.js";

const MODES = [
  { id: HYDRO_VIZ_MODES.DISCHARGE, label: "Discharge" },
  { id: HYDRO_VIZ_MODES.STAGE, label: "Stage" },
  { id: HYDRO_VIZ_MODES.DEPTH, label: "Depth" },
  { id: HYDRO_VIZ_MODES.FORECAST, label: "Forecast" },
  { id: HYDRO_VIZ_MODES.HISTORICAL, label: "Historical" },
  { id: HYDRO_VIZ_MODES.SAFETY, label: "Safety" },
];

function fmt(v, d = 2) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : "N/A";
}

function fmtStation(m) {
  return Number.isFinite(m) ? metersToStation(m) : "N/A";
}

export function mountHydrologyVizHud(root) {
  const el = document.createElement("div");
  el.id = "hydro-viz-hud";
  el.className = "hydro-viz-hud";
  el.hidden = true;
  el.innerHTML = `
    <div class="hv-bar" role="toolbar" aria-label="Hydrology visualization modes">
      <span class="hv-brand">Hydrology 3D</span>
      <div class="hv-modes"></div>
      <button type="button" class="hv-btn hv-charts" title="Optional analytical charts">Charts</button>
      <button type="button" class="hv-btn hv-close" aria-label="Close">×</button>
    </div>
    <div class="hv-meta">
      <span class="hv-badge" data-class>—</span>
      <span class="hv-note"></span>
    </div>
    <div class="hv-timeline" hidden>
      <div class="hv-tl-controls">
        <button type="button" class="hv-btn hv-tl-prev" title="Previous hour">◀</button>
        <button type="button" class="hv-btn hv-tl-play" title="Play/Pause">▶</button>
        <button type="button" class="hv-btn hv-tl-next" title="Next hour">▶|</button>
        <div class="hv-speed" role="group" aria-label="Playback speed">
          <button type="button" class="hv-btn hv-spd active" data-speed="1">1×</button>
          <button type="button" class="hv-btn hv-spd" data-speed="5">5×</button>
          <button type="button" class="hv-btn hv-spd" data-speed="10">10×</button>
        </div>
        <span class="hv-tl-stamp">NOW</span>
      </div>
      <input type="range" class="hv-tl" min="-72" max="72" step="1" value="0" />
      <div class="hv-tl-ends">
        <span>−72 h HIST</span>
        <span class="hv-now-mark">NOW</span>
        <span>+24 / +72 h FORECAST</span>
      </div>
    </div>
    <div class="hv-legend">
      <span class="hv-leg-min">—</span>
      <div class="hv-leg-bar"></div>
      <span class="hv-leg-max">—</span>
      <span class="hv-leg-unit"></span>
    </div>
    <div class="hv-float" hidden></div>
  `;
  root.appendChild(el);

  const modesEl = el.querySelector(".hv-modes");
  MODES.forEach((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hv-mode";
    b.dataset.mode = m.id;
    b.textContent = m.label;
    modesEl.appendChild(b);
  });

  const badge = el.querySelector(".hv-badge");
  const note = el.querySelector(".hv-note");
  const timeline = el.querySelector(".hv-timeline");
  const tl = el.querySelector(".hv-tl");
  const tlStamp = el.querySelector(".hv-tl-stamp");
  const playBtn = el.querySelector(".hv-tl-play");
  const floatEl = el.querySelector(".hv-float");
  const legMin = el.querySelector(".hv-leg-min");
  const legMax = el.querySelector(".hv-leg-max");
  const legUnit = el.querySelector(".hv-leg-unit");
  const legBar = el.querySelector(".hv-leg-bar");

  let syncing = false;
  let lastMeters = Number(state.selectedChainageMeters) || 0;
  let playTimer = 0;
  let lastInfo = null;

  function scene() {
    return window.__MM_SCENE__;
  }

  function showTimelineFor(mode) {
    return (
      mode === HYDRO_VIZ_MODES.FORECAST ||
      mode === HYDRO_VIZ_MODES.HISTORICAL ||
      mode === HYDRO_VIZ_MODES.DISCHARGE
    );
  }

  async function applySeries() {
    const snap = getHydroVizSnapshot();
    const sc = scene();
    if (!sc?.setHydrologyVizSeries) return;

    timeline.hidden = !showTimelineFor(snap.mode);
    tl.value = String(snap.offsetH);
    updateStamp(snap);

    if (snap.mode === HYDRO_VIZ_MODES.SAFETY) {
      const series = await buildHydroVizSeries(snap.mode, snap.offsetH);
      badge.textContent = "LOCKED";
      badge.dataset.class = "UNAVAILABLE";
      note.textContent = series.reason || "Safety boards locked — relative WSE / crest unverified";
      sc.clearHydrologyVizSeries?.();
      legMin.textContent = "—";
      legMax.textContent = "—";
      legUnit.textContent = "";
      return;
    }

    const series = await buildHydroVizSeries(snap.mode, snap.offsetH);
    badge.textContent = series.timeClass || series.dataClass || "—";
    badge.dataset.class = series.timeClass || series.dataClass || "";
    note.textContent = series.note || "";
    if (series.datum) note.textContent += ` · Datum: ${series.datum}`;

    if (series.ok && series.series) {
      sc.setHydrologyVizSeries(series.series, {
        stepM: series.stepM || 10,
        unit: series.unit,
        dataClass: series.dataClass,
        palette: series.palette || "discharge",
        dim: !!series.dim,
      });
      const range = sc.getHydrologyVizRange?.() || {};
      legMin.textContent = fmt(range.min, 2);
      legMax.textContent = fmt(range.max, 2);
      legUnit.textContent = series.unit || "";
      legBar.dataset.palette = series.palette || "discharge";
    } else {
      sc.clearHydrologyVizSeries?.();
      note.textContent = series.error || series.note || "No series";
      legMin.textContent = "—";
      legMax.textContent = "—";
    }
  }

  function updateStamp(snap) {
    const h = snap.offsetH;
    if (h === 0) tlStamp.textContent = "NOW · LIVE";
    else if (h < 0) tlStamp.textContent = `${h} h · HISTORICAL`;
    else tlStamp.textContent = `+${h} h · FORECAST`;
    playBtn.textContent = snap.playing ? "❚❚" : "▶";
  }

  async function renderInspect(meters) {
    const snap = getHydroVizSnapshot();
    setHydroVizSelectedMeters(meters);
    const info = await inspectHydroAtChainage(meters, snap.offsetH);
    lastInfo = info;
    if (!info) {
      floatEl.hidden = true;
      return;
    }

    // Keep canonical selected meters in sync (no duplicate metric-card UI)
    try {
      const { setCanonicalSelectedMeters } = await import(
        "../../services/hydrology/hydrologyCanonicalState.js"
      );
      await setCanonicalSelectedMeters(meters);
    } catch {
      /* optional */
    }

    const depth =
      info.survey_depth_m ?? info.flow_depth_m ?? info.nt_depth_m ?? null;
    const q = info.discharge_m3s;

    // On-river float only — full tables live under Charts
    floatEl.hidden = false;
    floatEl.innerHTML = `
      <div>Q: ${fmt(q, 1)} m³/s</div>
      <div>Depth: ${fmt(depth, 2)} m</div>
      <div>Chainage: ${fmtStation(info.chainage_m)}</div>
    `;

    const sc = scene();
    if (snap.mode === HYDRO_VIZ_MODES.STAGE) {
      sc?.setHydrologyVizStageStem?.({
        bedDepthM: info.survey_depth_m ?? info.bathy_depth_m,
        stageRelM: info.stage_m_relative,
        depthM: depth,
      });
    } else {
      sc?.setHydrologyVizStageStem?.({});
    }
  }

  function stopPlay() {
    _clearPlay();
    setHydroVizPlaying(false);
  }

  function _clearPlay() {
    if (playTimer) {
      window.clearInterval(playTimer);
      playTimer = 0;
    }
  }

  function startPlay() {
    _clearPlay();
    setHydroVizPlaying(true);
    const tickMs = () => {
      const sp = getHydroVizSnapshot().playSpeed || 1;
      return Math.max(80, 1000 / sp);
    };
    const run = () => {
      const snap = getHydroVizSnapshot();
      if (!snap.playing || el.hidden) {
        _clearPlay();
        return;
      }
      let next = snap.offsetH + 1;
      const max = snap.mode === HYDRO_VIZ_MODES.HISTORICAL ? 0 : 72;
      const min = snap.mode === HYDRO_VIZ_MODES.FORECAST ? 0 : -72;
      if (next > max) next = min;
      setHydroVizOffsetHours(next);
      applySeries().then(() => renderInspect(lastMeters));
      playTimer = window.setTimeout(run, tickMs());
    };
    playTimer = window.setTimeout(run, tickMs());
  }

  async function activate(on) {
    // HUD chrome permanently suppressed — DT entry opens Charts instead
    el.hidden = true;
    document.body.classList.remove("hydro-viz-active");
    const sc = scene();
    if (on) {
      setHydroVizActive(false);
      stopPlay();
      sc?.hideHydrologyViz?.();
      window.__MM_HYDRO_INTEL__?.showAnalyticalCharts?.() ||
        window.__MM_HYDRO_INTEL__?.showCharts?.();
      return;
    }
    setHydroVizActive(false);
    stopPlay();
    sc?.hideHydrologyViz?.();
  }

  modesEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    stopPlay();
    setHydroVizMode(btn.dataset.mode);
    if (btn.dataset.mode === HYDRO_VIZ_MODES.HISTORICAL) setHydroVizOffsetHours(-1);
    if (btn.dataset.mode === HYDRO_VIZ_MODES.FORECAST) setHydroVizOffsetHours(0);
    modesEl.querySelectorAll(".hv-mode").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === btn.dataset.mode);
    });
    await applySeries();
    await renderInspect(lastMeters);
  });

  tl.addEventListener("input", async () => {
    stopPlay();
    setHydroVizOffsetHours(Number(tl.value) || 0);
    await applySeries();
    await renderInspect(lastMeters);
  });

  el.querySelector(".hv-tl-prev").addEventListener("click", async () => {
    stopPlay();
    stepHydroVizOffset(-1);
    await applySeries();
    await renderInspect(lastMeters);
  });
  el.querySelector(".hv-tl-next").addEventListener("click", async () => {
    stopPlay();
    stepHydroVizOffset(1);
    await applySeries();
    await renderInspect(lastMeters);
  });
  playBtn.addEventListener("click", () => {
    const snap = getHydroVizSnapshot();
    if (snap.playing) stopPlay();
    else startPlay();
    updateStamp(getHydroVizSnapshot());
  });
  el.querySelectorAll(".hv-spd").forEach((b) => {
    b.addEventListener("click", () => {
      setHydroVizPlaySpeed(Number(b.dataset.speed) || 1);
      el.querySelectorAll(".hv-spd").forEach((x) =>
        x.classList.toggle("active", x === b),
      );
    });
  });

  el.querySelector(".hv-close").addEventListener("click", () => {
    activate(false);
    document.dispatchEvent(new CustomEvent("hydrology-viz-close"));
    const dtBtn = document.querySelector("[data-analytics='digital_twin']");
    dtBtn?.classList.remove("active");
    dtBtn?.setAttribute("aria-pressed", "false");
    document.getElementById("ui-root")?.classList.remove("dt-mode-active");
    document.body.classList.remove("dt-mode-active");
  });

  el.querySelector(".hv-charts").addEventListener("click", () => {
    window.__MM_HYDRO_INTEL__?.showAnalyticalCharts?.() ||
      window.__MM_HYDRO_INTEL__?.showCharts?.();
  });

  document.addEventListener("hydrology-viz-mode", async (e) => {
    const mode = e.detail?.mode;
    if (!mode || el.hidden) return;
    setHydroVizMode(mode);
    modesEl.querySelectorAll(".hv-mode").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === mode);
    });
    await applySeries();
    const m = Number(e.detail?.chainage_m);
    if (Number.isFinite(m)) {
      lastMeters = m;
      await renderInspect(m);
    }
  });

  document.addEventListener("chainage-select", async (e) => {
    const m = Number(e.detail?.meters);
    if (!Number.isFinite(m)) return;
    lastMeters = m;
    if (el.hidden) return;
    scene()?.setHydrologyVizFocus?.(m);
    await renderInspect(m);
  });

  document.addEventListener("river-station-selected", async (e) => {
    const m = Number(e.detail?.chainage_m);
    if (!Number.isFinite(m)) return;
    lastMeters = m;
    if (el.hidden) return;
    scene()?.setHydrologyVizFocus?.(m);
    await renderInspect(m);
  });

  subscribeHydroViz(async (snap) => {
    if (syncing || !snap.active || el.hidden) return;
    syncing = true;
    try {
      updateStamp(snap);
      tl.value = String(snap.offsetH);
      modesEl.querySelectorAll(".hv-mode").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === snap.mode);
      });
      if (snap.from === "naditwin") {
        await applySeries();
        await renderInspect(lastMeters);
      }
    } finally {
      syncing = false;
    }
  });

  modesEl.querySelector(`[data-mode="${HYDRO_VIZ_MODES.DISCHARGE}"]`)?.classList.add("active");

  window.__MM_HYDRO_VIZ__ = {
    show: () => activate(true),
    hide: () => activate(false),
    isOpen: () => !el.hidden,
    setMode: async (m) => {
      setHydroVizMode(m);
      modesEl.querySelectorAll(".hv-mode").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === m);
      });
      if (!el.hidden) {
        await applySeries();
        await renderInspect(lastMeters);
      }
    },
    setOffsetHours: async (h) => {
      setHydroVizOffsetHours(h);
      if (!el.hidden) {
        await applySeries();
        await renderInspect(lastMeters);
      }
    },
    inspectAt: async (m) => {
      const meters = Number(m);
      if (!Number.isFinite(meters)) return null;
      lastMeters = meters;
      scene()?.setHydrologyVizFocus?.(meters);
      await renderInspect(meters);
      return sanitizeInfo(lastInfo);
    },
    getSnapshot: () => peekSnap(),
    getLastInfo: () => sanitizeInfo(lastInfo),
  };

  function sanitizeInfo(info) {
    if (!info) return null;
    const { hydrograph, ...rest } = info;
    return rest;
  }

  return { el, show: () => activate(true), hide: () => activate(false), isOpen: () => !el.hidden };
}
