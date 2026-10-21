import "../../styles/hydrology-simulation.css";
import { ChartNoAxesCombined, ChartSpline, MoveVertical } from "lucide";
import { lucideHtml } from "../icons.js";
import { getWaterLevelSimulationSeries } from "../../services/hydrology/digitalTwinApi.js";
import { state } from "../../state.js";

const MODES = [
  { id: "discharge", label: "Discharge Simulation", icon: ChartNoAxesCombined },
  { id: "stage", label: "River Stage Simulation", icon: MoveVertical },
  { id: "hydrograph", label: "Hydrograph Simulation", icon: ChartSpline },
];
const RESOLUTIONS = [
  { id: "hourly", short: "H", label: "Hourly" },
  { id: "daily", short: "D", label: "Daily" },
  { id: "weekly", short: "W", label: "Weekly", disabled: true },
];
const RUN_MS = 28000;
const MESSAGE_MS = 7000;
const STABLE_TOLERANCE_M = 0.02;

export function mountHydrologySimulationControls(root) {
  const el = document.createElement("div");
  el.className = "hydrology-simulation-controls";
  el.hidden = false;
  el.setAttribute("aria-label", "Hydrology simulations");
  el.innerHTML = `
    <div class="hydrology-simulation-mode-row">
      ${MODES.map(({ id, label, icon }) => `
        <button type="button" class="map-ctrl-btn map-ctrl-btn--icon hydrology-simulation-button" data-simulation="${id}" aria-label="${label}" title="${label}">
          ${lucideHtml(icon, { size: 17, className: "hydrology-simulation-icon" })}
        </button>`).join("")}
    </div>
    <div class="hydrology-resolution-row" role="group" aria-label="Simulation time resolution">
      ${RESOLUTIONS.map(({ id, short, label, disabled }) => `
        <button type="button" class="hydrology-resolution-button${id === "hourly" ? " is-selected" : ""}" data-resolution="${id}" aria-label="${label} simulation" title="${disabled ? "Weekly playback unavailable: the longest available water-level series is under seven days." : `${label} simulation`}"${disabled ? " disabled" : ""}>${short}</button>`).join("")}
    </div>`;
  root.appendChild(el);

  const message = document.createElement("div");
  message.className = "hydrology-simulation-completion";
  message.hidden = true;
  message.setAttribute("aria-live", "polite");
  document.getElementById("ui-root")?.appendChild(message);

  const indicator = document.createElement("div");
  indicator.className = "hydrology-level-change";
  indicator.hidden = true;
  indicator.setAttribute("aria-live", "off");
  indicator.innerHTML = `
    <div class="hydrology-measure hydrology-measure-rise"><span class="hydrology-measure-arrow" aria-hidden="true">↑</span><span class="hydrology-measure-stack"><span class="hydrology-measure-label">TOTAL RISE</span><span data-measure="rise">+0.00 m</span></span></div>
    <div class="hydrology-measure hydrology-measure-net"><span class="hydrology-measure-label">NET CHANGE FROM START</span><span data-measure="net">0.00 m</span></div>
    <div class="hydrology-measure hydrology-measure-fall"><span class="hydrology-measure-arrow" aria-hidden="true">↓</span><span class="hydrology-measure-stack"><span class="hydrology-measure-label">TOTAL FALL</span><span data-measure="fall">−0.00 m</span></span></div>
    <div class="hydrology-simulation-progress" data-measure="progress"></div>`;
  document.getElementById("ui-root")?.appendChild(indicator);

  const measure = (key) => indicator.querySelector(`[data-measure="${key}"]`);
  let phase = "ready";
  let frame = 0;
  let generation = 0;
  let selectedResolution = "hourly";
  let simulationDock = null;

  function dockControls() {
    const panel = document.getElementById("hydro-intel-panel");
    const header = panel?.querySelector(".hip-header");
    if (!panel || !header) return;
    simulationDock = panel.querySelector(".hydrology-simulation-dock");
    if (!simulationDock) {
      simulationDock = document.createElement("div");
      simulationDock.className = "hydrology-simulation-dock";
      header.insertAdjacentElement("afterend", simulationDock);
    }
    simulationDock.appendChild(el);
    el.classList.add("is-panel-docked");
    el.hidden = phase === "simulating" || phase === "settling";
  }

  function undockControls() {
    root.appendChild(el);
    el.classList.remove("is-panel-docked");
    simulationDock?.remove();
    simulationDock = null;
    el.hidden = phase === "simulating" || phase === "settling";
  }

  function cancelPlayback() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    generation++;
  }

  function failRun(run, scene, initialRise, error) {
    if (run !== generation) return;
    console.warn("[hydrology-simulation] playback failed:", error);
    scene?.setHydrologySimulationRise?.(initialRise);
    phase = "ready";
    el.hidden = false;
    indicator.hidden = true;
    message.replaceChildren();
    const title = document.createElement("span");
    title.className = "hydrology-simulation-completion-label";
    title.textContent = "SIMULATION COULD NOT RUN";
    const detail = document.createElement("strong");
    detail.className = "hydrology-simulation-error-detail";
    detail.textContent = error?.message || "The hydrology series is unavailable. Try another time resolution.";
    message.append(title, detail);
    message.hidden = false;
    message.classList.remove("is-visible");
    requestAnimationFrame(() => message.classList.add("is-visible"));
    const completedAt = performance.now();
    const dismiss = (time) => {
      if (run !== generation) return;
      if (time - completedAt >= MESSAGE_MS - 400) message.classList.remove("is-visible");
      if (time - completedAt >= MESSAGE_MS) {
        message.hidden = true;
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(dismiss);
    };
    frame = requestAnimationFrame(dismiss);
  }

  async function start(kind) {
    if (phase === "simulating" || phase === "settling") return;
    cancelPlayback();
    const run = generation;
    phase = "simulating";
    el.hidden = true;
    message.hidden = true;
    message.classList.remove("is-visible");
    indicator.hidden = false;
    measure("progress").textContent = `STARTING ${kind.toUpperCase()} SIMULATION…`;
    const scene = window.__MM_SCENE__;
    // Each mode/resolution is an independent run against the normal-WSE baseline.
    // Do not carry the previous simulation's endpoint into the next series.
    const initialRise = 0;
    try {
      if (!scene?.setHydrologySimulationRise?.(initialRise, true)) {
        throw new Error("The 3D river could not reset to the normal water level.");
      }
      const chainage = Number.isFinite(state.selectedChainageMeters)
        ? state.selectedChainageMeters
        : 0;
      const series = await getWaterLevelSimulationSeries(kind, chainage, selectedResolution);
      if (run !== generation) return;
      if (!series.available || series.samples.length < 2) throw new Error(series.reason || "This water-level resolution is unavailable.");
      const { samples, resolution } = series;
      const first = samples[0].value;
      const last = samples[samples.length - 1].value;
      if (!Number.isFinite(first) || !Number.isFinite(last)) throw new Error("The hydrology series has invalid elevations.");

      const stats = { initialLevel: first, currentLevel: first, minimumLevel: first, maximumLevel: first };
      const started = performance.now();
      const updateIndicator = (trend, sampleIndex) => {
        const net = stats.currentLevel - stats.initialLevel;
        const rise = Math.max(0, stats.maximumLevel - stats.initialLevel);
        const fall = Math.max(0, stats.initialLevel - stats.minimumLevel);
        measure("rise").textContent = `+${rise.toFixed(2)} m`;
        measure("net").textContent = `${net > 0 ? "+" : net < 0 ? "−" : ""}${Math.abs(net).toFixed(2)} m`;
        measure("fall").textContent = `−${fall.toFixed(2)} m`;
        const direction = Math.abs(trend) <= STABLE_TOLERANCE_M ? "stable" : trend > 0 ? "rising" : "falling";
        indicator.classList.toggle("is-rising", direction === "rising");
        indicator.classList.toggle("is-falling", direction === "falling");
        indicator.classList.toggle("is-stable", direction === "stable");
        const unit = resolution === "hourly" ? "Hour" : resolution === "daily" ? "Day" : "Week";
        const sample = samples[Math.min(sampleIndex, samples.length - 1)];
        const trendMark = direction === "rising" ? "↑ RISING" : direction === "falling" ? "↓ FALLING" : "→ STABLE";
        measure("progress").textContent = `${trendMark} · ${sample.provenance} · ${unit} ${String(Math.min(sampleIndex + 1, samples.length)).padStart(2, "0")}/${samples.length}`;
      };

      const update = (now) => {
        if (run !== generation) return;
        // The first RAF timestamp can precede performance.now() by one frame.
        // Clamp the lower bound too, otherwise floor(-ε) selects samples[-1].
        const p = Math.max(0, Math.min(1, (now - started) / RUN_MS));
        const indexF = p * (samples.length - 1);
        const index = Math.min(samples.length - 2, Math.floor(indexF));
        const t = p >= 1 ? 1 : indexF - index;
        const sampleA = samples[index];
        const sampleB = samples[index + 1];
        if (!sampleA || !sampleB || !Number.isFinite(sampleA.value) || !Number.isFinite(sampleB.value)) {
          failRun(run, scene, initialRise, new Error("The hydrology forecast contains a missing time step."));
          return;
        }
        const level = p >= 1 ? last : sampleA.value + (sampleB.value - sampleA.value) * t;
        const simulatedAt = p >= 1
          ? sampleB.timestamp
          : sampleA.timestamp + (sampleB.timestamp - sampleA.timestamp) * t;
        const rise = initialRise + (level - first);
        if (!Number.isFinite(rise) || !scene?.setHydrologySimulationRise?.(rise)) {
          failRun(run, scene, initialRise, new Error("The 3D river could not apply this water level."));
          return;
        }
        stats.currentLevel = level;
        stats.minimumLevel = Math.min(stats.minimumLevel, level);
        stats.maximumLevel = Math.max(stats.maximumLevel, level);
        const sampleIndex = Math.min(Math.floor(indexF), samples.length - 1);
        updateIndicator(sampleB.value - sampleA.value, sampleIndex);
        measure("progress").textContent += ` | ${formatSimulationTime(simulatedAt)} | WATER CHANGE ${formatSigned(level - first)} m`;
        if (p < 1) {
          frame = requestAnimationFrame(update);
          return;
        }

        frame = 0;
        phase = "settling";
        const finalRise = initialRise + (last - first);
        scene.setHydrologySimulationRise(finalRise, true);
        const showCompletion = () => {
          if (run !== generation) return;
          if (Math.abs((scene.getRenderedHydrologySimulationRise?.() ?? NaN) - finalRise) > 0.015) {
            frame = requestAnimationFrame(showCompletion);
            return;
          }
          updateIndicator(0, samples.length - 1);
          indicator.hidden = true;
          const finalChange = last - first;
          const lastSample = samples[samples.length - 1];
          const timeUnit = resolution === "hourly" ? "HOUR" : "DAY";
          message.innerHTML = `<span class="hydrology-simulation-completion-label">WATER LEVEL CHANGE AT ${formatSimulationTime(lastSample.timestamp)}</span><strong>${formatSigned(finalChange)} m</strong><span class="hydrology-simulation-completion-datum">FROM START | ${timeUnit} ${samples.length}/${samples.length} | ${lastSample.provenance}</span>`;
          message.hidden = false;
          phase = "ready";
          el.hidden = false;
          requestAnimationFrame(() => message.classList.add("is-visible"));
          // Keep the final timestamp and WSE change visible until another run starts.
        };
        frame = requestAnimationFrame(showCompletion);
      };
      frame = requestAnimationFrame(update);
    } catch (error) {
      if (run !== generation) return;
      failRun(run, scene, initialRise, error);
    }
  }

  const onClick = (event) => {
    const resolutionButton = event.target.closest("[data-resolution]");
    if (resolutionButton && !resolutionButton.disabled) {
      selectedResolution = resolutionButton.dataset.resolution;
      el.querySelectorAll("[data-resolution]").forEach((button) => button.classList.toggle("is-selected", button === resolutionButton));
      return;
    }
    const button = event.target.closest("[data-simulation]");
    if (button) void start(button.dataset.simulation);
  };
  const onPanelOpen = () => {
    dockControls();
  };
  const onPanelClose = () => {
    undockControls();
  };
  const onExternalScenarioChange = () => {
    cancelPlayback();
    phase = "ready";
    indicator.hidden = true;
    message.hidden = true;
    message.classList.remove("is-visible");
    el.hidden = false;
    window.__MM_SCENE__?.clearHydrologySimulation?.();
  };
  el.addEventListener("click", onClick);
  document.addEventListener("hydrology-intel-open", onPanelOpen);
  document.addEventListener("hydrology-intel-close", onPanelClose);
  document.addEventListener("hydrology-scenario-change", onExternalScenarioChange);

  return {
    el,
    dispose() {
      cancelPlayback();
      el.removeEventListener("click", onClick);
      document.removeEventListener("hydrology-intel-open", onPanelOpen);
      document.removeEventListener("hydrology-intel-close", onPanelClose);
      document.removeEventListener("hydrology-scenario-change", onExternalScenarioChange);
      el.remove();
      simulationDock?.remove();
      message.remove();
      indicator.remove();
    },
  };
}

function formatSigned(value) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
}

function formatSimulationTime(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "time unavailable";
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }) + " IST";
}
