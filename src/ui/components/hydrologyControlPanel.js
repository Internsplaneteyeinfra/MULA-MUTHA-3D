import { Droplets, Minus, Plus, RotateCcw, X } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import {
  adjustStage,
  currentView,
  publish,
  resetStageAdjustment,
} from "../../services/hydrology/coupledScenario.js";
import {
  pauseFill,
  resetFill,
  resumeFill,
  setFillDuration,
  setFillMode,
  setFillSpeed,
  setScenarioDischarge,
  startFill,
  tickFill,
} from "../../services/hydrology/riverFillClock.js";

/**
 * Compact hydrology scenario panel. Opens from the existing toolbar button.
 * Closing it does not stop rainfall or clear the water response.
 */
export function mountHydrologyControlPanel(root) {
  const panel = document.createElement("section");
  panel.id = "hydrology-control-panel";
  panel.className = "hydrology-control-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Hydrology control");
  panel.innerHTML = `
    <header class="hydrology-control-panel__head">
      <span class="hydrology-control-panel__icon">${lucideHtml(Droplets, { size: 15 })}</span>
      <div>
        <strong>LIVE HYDROLOGY</strong>
        <small data-el="fresh">UNAVAILABLE</small>
      </div>
      <button type="button" class="hydrology-control-panel__x" data-hydro="close" aria-label="Close hydrology panel">${lucideHtml(X, { size: 13 })}</button>
    </header>
    <p class="hydrology-control-panel__meta" data-el="place">—</p>

    <section class="hydrology-control-panel__sec">
      <p>River discharge</p>
      <div class="hydrology-control-panel__grid">
        <span>Chainage Q</span><b data-el="qch">—</b>
        <span>Upstream</span><b data-el="qup">—</b>
        <span>Outlet</span><b data-el="qout">—</b>
        <span>Scenario ΔQ</span><b data-el="qd">+0 m³/s</b>
        <span>Combined Q</span><b data-el="qall">—</b>
        <span>Runoff</span><b data-el="qrun">0 m³/s</b>
      </div>
      <label class="hydrology-control-panel__field">Scenario discharge
        <input type="number" min="0" max="2500" step="1" data-el="q-input" aria-label="Scenario discharge" />
      </label>
      <input type="range" min="0" max="1500" step="1" value="0" data-el="q-slider" aria-label="Scenario discharge slider" />
      <label class="hydrology-control-panel__field">Discharge increase
        <input type="number" min="-400" max="2500" step="1" value="0" data-el="q-inc" aria-label="Discharge increase" />
      </label>
      <button type="button" class="hydrology-control-panel__reset" data-hydro="q-apply">Apply discharge</button>
      <button type="button" class="hydrology-control-panel__reset" data-hydro="q-reset">Reset to LIVE discharge</button>
    </section>

    <section class="hydrology-control-panel__sec">
      <p>Simulation time</p>
      <div class="hydrology-control-panel__modes" role="group" aria-label="Simulation mode">
        <button type="button" data-hydro="mode-discharge" class="is-on">Discharge</button>
        <button type="button" data-hydro="mode-rainfall">Rainfall</button>
        <button type="button" data-hydro="mode-both">Both</button>
      </div>
      <label class="hydrology-control-panel__field">Duration
        <select data-el="dur" aria-label="Simulation duration">
          <option value="1">1 hour</option>
          <option value="2">2 hours</option>
          <option value="6" selected>6 hours</option>
          <option value="12">12 hours</option>
          <option value="24">24 hours</option>
          <option value="48">48 hours</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <label class="hydrology-control-panel__field" data-el="dur-custom-wrap" hidden>Custom hours
        <input type="number" min="0.25" max="168" step="0.25" value="6" data-el="dur-custom" aria-label="Custom duration hours" />
      </label>
      <div class="hydrology-control-panel__play">
        <button type="button" data-hydro="start">Start</button>
        <button type="button" data-hydro="pause">Pause</button>
        <button type="button" data-hydro="resume">Resume</button>
        <button type="button" data-hydro="reset-fill">Reset</button>
      </div>
      <div class="hydrology-control-panel__modes" role="group" aria-label="Playback speed">
        <button type="button" data-speed="1" class="is-on">1×</button>
        <button type="button" data-speed="5">5×</button>
        <button type="button" data-speed="10">10×</button>
        <button type="button" data-speed="30">30×</button>
      </div>
      <p class="hydrology-control-panel__clock" data-el="clock">00:00 / 06:00 · READY</p>
      <div class="hydrology-control-panel__grid">
        <span>Modelled outflow</span><b data-el="qmod">—</b>
        <span>Water-level rise</span><b data-el="rise">—</b>
        <span>Left spread</span><b data-el="left">—</b>
        <span>Right spread</span><b data-el="right">—</b>
        <span>Floodplain</span><b data-el="area">—</b>
        <span>Flood volume</span><b data-el="vol">—</b>
      </div>
    </section>

    <section class="hydrology-control-panel__sec">
      <p>River stage <small data-el="datum">relative · not MSL</small></p>
      <div class="hydrology-control-panel__grid">
        <span>Source stage</span><b data-el="src-stage">—</b>
        <span>Simulated</span><b data-el="sim-stage">—</b>
        <span>Difference</span><b data-el="d-stage">+0.00 m</b>
        <span>Depth</span><b data-el="depth">—</b>
      </div>
      <div class="hydrology-control-panel__level">WATER LEVEL</div>
      <div class="hydrology-control-panel__step" role="group" aria-label="Water level adjustment">
        <button type="button" data-hydro="stage-down" aria-label="Lower water level">${lucideHtml(Minus, { size: 14 })}</button>
        <em data-el="stage-mid">+0.00 m</em>
        <button type="button" data-hydro="stage-up" aria-label="Raise water level">${lucideHtml(Plus, { size: 14 })}</button>
      </div>
      <button type="button" class="hydrology-control-panel__reset" data-hydro="stage-reset">Reset to source level</button>
    </section>

    <p class="hydrology-control-panel__note" data-el="note"></p>
    <button type="button" class="hydrology-control-panel__full" data-hydro="reset-all">
      ${lucideHtml(RotateCcw, { size: 12 })} Reset scenario
    </button>
  `;
  root.appendChild(panel);

  const el = (name) => panel.querySelector(`[data-el="${name}"]`);

  function fmtQ(n) {
    return Number.isFinite(n) ? `${n.toFixed(1)} m³/s` : "—";
  }
  function fmtM(n) {
    return Number.isFinite(n) ? `${n.toFixed(2)} m` : "—";
  }
  function fmtSigned(n, unit) {
    if (!Number.isFinite(n)) return "—";
    return `${n > 0 ? "+" : n < 0 ? "−" : "+"}${Math.abs(n).toFixed(unit === "q" ? 0 : 2)}${unit === "q" ? "" : " m"}`;
  }

  function paint(view = currentView()) {
    const src = view.source || {};
    el("fresh").textContent = src.freshness === "LIVE"
      ? "NADITWIN LIVE"
      : src.freshness || "UNAVAILABLE";
    el("fresh").dataset.fresh = src.freshness || "UNAVAILABLE";
    const when = src.timestamp
      ? new Date(src.timestamp).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }) + " IST"
      : "no timestamp";
    el("place").textContent = `CH ${src.station || "—"} · ${when}`;
    el("qch").textContent = fmtQ(src.qChainage);
    el("qup").textContent = fmtQ(src.qUp);
    el("qout").textContent = fmtQ(src.qOut);
    el("qd").textContent = `${fmtSigned(view.dischargeDeltaM3s, "q")} m³/s`;
    el("qall").textContent = fmtQ(view.combinedQ);
    el("qrun").textContent = fmtQ(view.runoffQ);
    el("src-stage").textContent = fmtM(view.sourceStageRel);
    el("sim-stage").textContent = fmtM(view.simulatedStageRel);
    el("d-stage").textContent = fmtSigned(view.visualRiseM, "m");
    el("depth").textContent = view.depthM != null ? `${fmtM(view.depthM)} modelled` : "UNAVAILABLE";
    el("stage-mid").textContent = fmtSigned(view.stageAdjustM, "m");
    el("datum").textContent = view.datumNote || "relative · not MSL";
    el("note").textContent = view.runoffNote || "";
    const fill = state.riverFill;
    if (fill) {
      el("clock").textContent = `${fmtClock(fill.tHours)} / ${fmtClock(fill.durationH)} · ${fill.speed}× · ${fill.status}`;
    }
    if (fill?.ownsVisual) {
      el("qall").textContent = fmtQ(fill.qIn);
      el("qrun").textContent = fmtQ(fill.runoffQ);
      el("qd").textContent = Number.isFinite(fill.dischargeIncrease) ? `${fmtSigned(fill.dischargeIncrease, "q")} m³/s` : "—";
      el("rise").textContent = Number.isFinite(fill.riseM) ? `${fill.riseM >= 0 ? "+" : ""}${fill.riseM.toFixed(2)} m` : "—";
      el("sim-stage").textContent = fmtM(fill.stageRel);
      el("d-stage").textContent = Number.isFinite(fill.riseM) ? `${fill.riseM >= 0 ? "+" : ""}${fill.riseM.toFixed(2)} m` : "—";
      el("qmod").textContent = fmtQ(fill.qOut);
      el("left").textContent = Number.isFinite(fill.leftM) ? `${fill.leftM.toFixed(0)} m` : "N/A";
      el("right").textContent = Number.isFinite(fill.rightM) ? `${fill.rightM.toFixed(0)} m` : "N/A";
      el("area").textContent = Number.isFinite(fill.areaKm2) ? `${fill.areaKm2.toFixed(3)} km² · MODELLED` : "N/A";
      el("vol").textContent = Number.isFinite(fill.volumeFloodM3) ? `${Math.round(fill.volumeFloodM3).toLocaleString("en-IN")} m³ · MODELLED` : "N/A";
      const srcDepth = Number(view.source?.depth);
      el("depth").textContent = Number.isFinite(srcDepth)
        ? `${(srcDepth + fill.riseM).toFixed(2)} m modelled`
        : "N/A";
      el("note").textContent = fill.note || view.runoffNote || "";
    } else {
      el("rise").textContent = "—";
      el("qmod").textContent = "—";
      el("left").textContent = "N/A";
      el("right").textContent = "N/A";
      el("area").textContent = "N/A";
      el("vol").textContent = "N/A";
    }
  }

  function fmtClock(hours) {
    const h = Math.max(0, Number(hours) || 0);
    const hh = Math.floor(h);
    const mm = Math.min(59, Math.round((h - hh) * 60));
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  function sourceQ() {
    const view = currentView();
    const q = view.source?.qChainage ?? view.source?.qOut ?? view.source?.qUp;
    return Number.isFinite(q) ? q : 0;
  }

  function syncDischargeInputs(q) {
    const input = el("q-input");
    const slider = el("q-slider");
    const inc = el("q-inc");
    if (!input || document.activeElement === input) return;
    const value = Number.isFinite(q) ? q : sourceQ();
    input.value = String(Math.round(value));
    if (slider && document.activeElement !== slider) slider.value = String(Math.max(0, Math.min(1500, Math.round(value))));
    if (inc && document.activeElement !== inc) inc.value = String(Math.round(value - sourceQ()));
  }

  function toggle(force) {
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    if (!panel.hidden) paint(publish());
    document.dispatchEvent(new CustomEvent("hydrology-panel-toggle", { detail: { open: !panel.hidden } }));
    return !panel.hidden;
  }

  panel.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-hydro]");
    if (!btn) return;
    const act = btn.getAttribute("data-hydro");
    if (act === "close") {
      panel.hidden = true;
      document.dispatchEvent(new CustomEvent("hydrology-panel-toggle", { detail: { open: false } }));
      return;
    }
    if (act === "q-apply") {
      setScenarioDischarge(Number(el("q-input").value));
      paint();
    }
    if (act === "q-reset") {
      const q = sourceQ();
      setScenarioDischarge(q);
      syncDischargeInputs(q);
      paint();
    }
    if (act === "mode-discharge" || act === "mode-rainfall" || act === "mode-both") {
      panel.querySelectorAll("[data-hydro^='mode-']").forEach((b) => b.classList.remove("is-on"));
      btn.classList.add("is-on");
      setFillMode(act.replace("mode-", ""));
    }
    if (act === "start") paint(startFill());
    if (act === "pause") paint(pauseFill());
    if (act === "resume") paint(resumeFill());
    if (act === "reset-fill") {
      paint(resetFill());
      syncDischargeInputs(sourceQ());
    }
    if (act === "stage-up") paint(adjustStage(1));
    if (act === "stage-down") paint(adjustStage(-1));
    if (act === "stage-reset") paint(resetStageAdjustment());
    if (act === "reset-all") {
      resetFill();
      document.dispatchEvent(new CustomEvent("coupled-scenario-full-reset"));
      syncDischargeInputs(sourceQ());
      paint();
    }
  });

  panel.querySelector("[data-el='q-slider']")?.addEventListener("input", (e) => {
    const q = Number(e.target.value);
    el("q-input").value = String(q);
    el("q-inc").value = String(Math.round(q - sourceQ()));
    setScenarioDischarge(q);
  });
  panel.querySelector("[data-el='q-input']")?.addEventListener("change", (e) => {
    setScenarioDischarge(Number(e.target.value));
    syncDischargeInputs(Number(e.target.value));
  });
  panel.querySelector("[data-el='q-inc']")?.addEventListener("change", (e) => {
    const q = sourceQ() + Number(e.target.value || 0);
    setScenarioDischarge(q);
    syncDischargeInputs(q);
  });
  panel.querySelector("[data-el='dur']")?.addEventListener("change", (e) => {
    const custom = e.target.value === "custom";
    el("dur-custom-wrap").hidden = !custom;
    setFillDuration(custom ? Number(el("dur-custom").value) : Number(e.target.value));
  });
  panel.querySelector("[data-el='dur-custom']")?.addEventListener("change", (e) => {
    setFillDuration(Number(e.target.value));
  });
  panel.querySelectorAll("[data-speed]").forEach((b) => {
    b.addEventListener("click", () => {
      panel.querySelectorAll("[data-speed]").forEach((n) => n.classList.remove("is-on"));
      b.classList.add("is-on");
      setFillSpeed(Number(b.getAttribute("data-speed")));
    });
  });

  let lastTick = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    const snap = tickFill(dt);
    if (snap && !panel.hidden) paint();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.addEventListener("coupled-scenario-change", (e) => paint(e.detail || currentView()));
  document.addEventListener("river-fill-tick", () => { if (!panel.hidden) paint(); });
  syncDischargeInputs(sourceQ());
  document.addEventListener("chainage-select", () => { if (!panel.hidden) paint(publish()); });
  document.addEventListener("naditwin-hydrology-change", () => paint(publish()));

  paint(currentView());

  return { panel, toggle, isOpen: () => !panel.hidden, paint };
}
