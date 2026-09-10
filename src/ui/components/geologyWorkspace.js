import {
  Mountain,
  Activity,
  Droplets,
  Pickaxe,
  GitBranch,
  Sun,
  Waves,
} from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";

/** Reference lithology classes — exact percentages; colors match geology overlay raster. */
export const LITHOLOGY_CLASSES = [
  {
    id: "water",
    label: "Water",
    pct: "1.9%",
    color: "#00F0F0",
    samples: [
      [0, 248, 248],
      [0, 96, 200],
      [0, 64, 136],
    ],
  },
  {
    id: "basaltic",
    label: "Basaltic / Mafic",
    pct: "16.4%",
    color: "#880000",
    samples: [
      [136, 0, 0],
      [160, 24, 0],
      [120, 0, 0],
    ],
  },
  {
    id: "weathered",
    label: "Weathered Rock",
    pct: "11.7%",
    color: "#F88800",
    samples: [
      [248, 136, 0],
      [248, 128, 0],
      [232, 112, 0],
    ],
  },
  {
    id: "alluvial",
    label: "Alluvial / Sedimentary",
    pct: "8.2%",
    color: "#F8D000",
    samples: [
      [248, 208, 0],
      [248, 200, 0],
      [232, 200, 16],
    ],
  },
  {
    id: "ferruginous",
    label: "Ferruginous / Iron-rich",
    pct: "10.3%",
    color: "#F80000",
    samples: [
      [248, 0, 0],
      [248, 32, 0],
      [232, 0, 0],
    ],
  },
  {
    id: "clay",
    label: "Clay-rich",
    pct: "14.3%",
    color: "#9070D8",
    samples: [
      [144, 112, 216],
      [136, 112, 200],
      [128, 112, 184],
    ],
  },
  {
    id: "silica",
    label: "Silica-rich",
    pct: "34.1%",
    color: "#708090",
    samples: [
      [112, 128, 144],
      [112, 120, 152],
      [120, 120, 160],
    ],
  },
  {
    id: "mixed",
    label: "Mixed Rock-soil",
    pct: "3.0%",
    color: "#92400E",
    samples: [
      [146, 64, 14],
      [184, 56, 0],
      [120, 48, 16],
    ],
  },
];

export const GEOLOGY_MODULES = [
  { id: "vehicle", label: "Vehicle", icon: Mountain, color: "#F97316", available: false },
  { id: "spectral_lithology", label: "Spectral Lithology", icon: Activity, color: "#38BDF8", available: true },
  { id: "bank_erosion", label: "Bank Erosion", icon: Droplets, color: "#22D3EE", available: true },
  { id: "joining_streams", label: "Joining Streams", icon: GitBranch, color: "#4ADE80", available: true },
  { id: "main_stem", label: "Main Stem", icon: Sun, color: "#FACC15", available: true },
  { id: "bathymetry", label: "Bathymetry", icon: Waves, color: "#7DD3FC", available: true, dashboard: true },
];

/**
 * Icon-only geology HUD toolbar (reference order).
 * tip = hover/aria label only — never shown as permanent text.
 * moduleId = existing activateModule() target.
 */
const GEOLOGY_TOOLBAR = [
  { moduleId: "vehicle", tip: "Terrain", icon: Mountain, color: "#F5A623" },
  { moduleId: "spectral_lithology", tip: "Spectral Lithology", icon: Activity, color: "#38BDF8" },
  { moduleId: "bank_erosion", tip: "Bank Erosion", icon: Droplets, color: "#22D3EE" },
  { moduleId: "bank_erosion", tip: "Erosion", icon: Pickaxe, color: "#F08070", key: "erosion-pick" },
  { moduleId: "joining_streams", tip: "Joining Streams", icon: GitBranch, color: "#4ADE80" },
  { moduleId: "main_stem", tip: "Main Stem", icon: Sun, color: "#FACC15" },
  { moduleId: "bathymetry", tip: "Bathymetry", icon: Waves, color: "#7DD3FC" },
];

/** Exact class scale from bank erosion hotspot product (2016–2026). */
export const BANK_EROSION_CLASSES = [
  { id: "none", label: "No erosion", color: "#7CFF2A", pct: "83.1%" },
  { id: "low", label: "Low erosion", color: "#FFE600", pct: "15.5%" },
  { id: "moderate", label: "Moderate erosion", color: "#FF8C00", pct: "1.4%" },
  { id: "high", label: "High erosion", color: "#FF3737", pct: "0%" },
  { id: "very_high", label: "Very high erosion", color: "#A0001E", pct: "0%" },
];

/** Exact Jul 2026 depth-class ramp (shallow → deep). */
export const BATHYMETRY_CLASSES = [
  { id: "1.5-1.6", label: "1.5–1.6 m", color: "#87CEFA" },
  { id: "1.6-1.7", label: "1.6–1.7 m", color: "#4AA3E9" },
  { id: "1.7-1.8", label: "1.7–1.8 m", color: "#216FCD" },
  { id: "1.8-1.9", label: "1.8–1.9 m", color: "#103F96" },
  { id: "1.9-2.0", label: "1.9–2.0 m", color: "#051448" },
];

/**
 * Geology workspace — fixed header + module row;
 * Spectral Lithology / Bank Erosion legends dock in the left UI stack.
 */
export function mountGeologyWorkspace(root) {
  const wrap = document.createElement("div");
  wrap.className = "geology-workspace";
  wrap.id = "geology-workspace";
  wrap.hidden = true;
  wrap.setAttribute("aria-label", "Geology workspace");

  wrap.innerHTML = `
    <section class="geology-module-row" aria-label="Geology tools">
      <div class="geology-modules" role="toolbar" aria-label="Geology modules">
        ${GEOLOGY_TOOLBAR.map(
          (m, i) => `
          <button type="button" class="geology-module-btn"
            data-geo-module="${m.moduleId}"
            data-geo-key="${m.key || m.moduleId}"
            data-tip="${m.tip}"
            aria-label="${m.tip}"
            title="${m.tip}"
            aria-pressed="false"
            style="--geo-accent:${m.color}">
            <span class="geology-module-icon" style="color:${m.color}" aria-hidden="true">${lucideHtml(m.icon, { size: 22, strokeWidth: 1.75, className: "geo-mod-svg" })}</span>
          </button>`,
        ).join("")}
      </div>
    </section>

    <div class="geology-content" id="geology-content" aria-live="polite">
      <section class="geology-panel geology-panel--vehicle" data-geo-panel="vehicle" hidden></section>

      <section class="geology-panel geology-panel--lithology" data-geo-panel="spectral_lithology" hidden>
        <aside class="spectral-lithology-legend geo-field-note" aria-label="Spectral lithology scale">
          <header class="geo-field-note__head">
            <strong>Spectral lithology</strong>
            <span class="spectral-lithology-legend__dot" aria-hidden="true"></span>
          </header>
          <ul class="spectral-lithology-legend__list">
            ${LITHOLOGY_CLASSES.map(
              (c) => `
              <li class="spectral-lithology-legend__row">
                <span class="spectral-lithology-legend__swatch" style="background:${c.color}"></span>
                <span class="spectral-lithology-legend__label">${c.label}</span>
                <strong class="spectral-lithology-legend__pct">${c.pct}</strong>
              </li>`,
            ).join("")}
          </ul>
        </aside>
      </section>

      <section class="geology-panel geology-panel--erosion" data-geo-panel="bank_erosion" hidden>
        <aside class="bank-erosion-legend geo-field-note" aria-label="Bank erosion hotspots legend">
          <header class="geo-field-note__head">
            <strong>Bank erosion</strong>
            <small>2016–2026</small>
          </header>
          <ul class="bank-erosion-legend__list">
            ${BANK_EROSION_CLASSES.map(
              (c) => `
              <li class="bank-erosion-legend__row">
                <span class="bank-erosion-legend__swatch" style="background:${c.color}"></span>
                <span class="bank-erosion-legend__label">${c.label}</span>
                <strong class="bank-erosion-legend__pct">${c.pct}</strong>
              </li>`,
            ).join("")}
          </ul>
        </aside>
      </section>
      <section class="geology-panel geology-panel--joining" data-geo-panel="joining_streams" hidden>
        <aside class="joining-streams-panel geo-field-note" aria-label="Joining streams">
          <header class="geo-field-note__head">
            <strong>Joining streams</strong>
            <small>Drainage into Mula–Mutha</small>
          </header>
          <p class="geo-field-note__hint">Click a channel on the map for its name and type.</p>
          <div class="joining-streams-panel__card" id="joining-stream-info" hidden>
            <div class="joining-streams-panel__card-title">Selected channel</div>
            <div class="joining-streams-panel__kv" id="joining-stream-kv"></div>
          </div>
        </aside>
      </section>
      <section class="geology-panel geology-panel--main-stem" data-geo-panel="main_stem" hidden>
        <aside class="main-stem-panel geo-field-note geo-field-note--stem" aria-label="Main stem">
          <header class="geo-field-note__head">
            <strong>Main stem</strong>
            <small>Mula–Mutha centerline</small>
          </header>
          <p class="geo-field-note__hint">Gold line follows the river’s surveyed course.</p>
        </aside>
      </section>

      <section class="geology-panel geology-panel--bathymetry" data-geo-panel="bathymetry" hidden>
        <aside class="bathymetry-legend geo-field-note geo-field-note--bathy" aria-label="Bathymetry depth classes">
          <header class="geo-field-note__head">
            <strong>Bathymetry</strong>
            <small>Jul 2026 depth zones</small>
          </header>
          <div class="bathy-sounding" role="img" aria-label="Depth scale from 1.5 to 2.0 metres">
            <div class="bathy-sounding__bar" aria-hidden="true"></div>
            <div class="bathy-sounding__ticks">
              ${BATHYMETRY_CLASSES.map((c) => `<span>${c.label.replace(" m", "")}</span>`).join("")}
            </div>
            <div class="bathy-sounding__ends">
              <span>Shallower</span>
              <span>Deeper</span>
            </div>
          </div>
          <p class="geo-field-note__hint">Click a coloured patch on the river to read its depth class.</p>
        </aside>
      </section>
    </div>
  `;

  root.appendChild(wrap);

  let leftStack = document.getElementById("left-ui-stack");
  if (!leftStack) {
    leftStack = document.createElement("div");
    leftStack.id = "left-ui-stack";
    leftStack.className = "left-ui-stack";
    root.appendChild(leftStack);
  }
  const erosionPanel = wrap.querySelector(".geology-panel--erosion");
  const lithologyPanel = wrap.querySelector(".geology-panel--lithology");
  const joiningPanel = wrap.querySelector(".geology-panel--joining");
  const mainStemPanel = wrap.querySelector(".geology-panel--main-stem");
  const bathymetryPanel = wrap.querySelector(".geology-panel--bathymetry");
  function dockPanel(panel) {
    if (!panel) return;
    const river = leftStack.querySelector("#river-data-panel");
    if (river) leftStack.insertBefore(panel, river.nextSibling);
    else leftStack.appendChild(panel);
  }
  // Stack: River Data → analysis panels
  dockPanel(erosionPanel);
  dockPanel(lithologyPanel);
  dockPanel(joiningPanel);
  dockPanel(mainStemPanel);
  dockPanel(bathymetryPanel);

  const joiningInfo = wrap.querySelector("#joining-stream-info") || joiningPanel?.querySelector("#joining-stream-info");
  const joiningKv = wrap.querySelector("#joining-stream-kv") || joiningPanel?.querySelector("#joining-stream-kv");

  function waterwayTypeLabel(ww) {
    const s = String(ww || "").toLowerCase();
    if (s === "drain") return "Drain / Nullah";
    if (s === "stream") return "Stream / Nullah";
    if (s === "canal") return "Canal";
    if (s === "ditch") return "Ditch";
    return ww ? String(ww) : "";
  }

  function showJoiningCard(rec) {
    if (!joiningInfo || !joiningKv || !rec) return;
    const m = rec.meta || {};
    const name = String(m.name || rec.name || "").trim();
    const rows = [];
    const add = (k, v) => {
      if (v == null || String(v).trim() === "") return;
      rows.push(`<div class="js-kv"><span class="js-k">${k}</span><span class="js-v">${v}</span></div>`);
    };
    add("Name", name && !/^unnamed/i.test(name) ? name : "Unnamed channel");
    add("Type", waterwayTypeLabel(m.waterway));
    add("Length", rec.lengthM != null ? `${Math.round(rec.lengthM)} m` : "");
    add("Width", m.width ? `${m.width} m` : "");
    add("Tunnel", m.tunnel || "");
    add("Bridge", m.bridge === "yes" ? "Yes" : m.bridge || "");
    add("Intermittent", m.intermittent === "yes" ? "Yes" : m.intermittent || "");
    add("Joins river", rec.connectsToRiver ? "Yes" : "");
    add("Flow", rec.directionReason || "");
    add("OSM id", m.osmId || "");
    joiningKv.innerHTML = rows.join("");
    joiningInfo.hidden = false;
  }

  function clearJoiningCard() {
    if (joiningInfo) joiningInfo.hidden = true;
    if (joiningKv) joiningKv.innerHTML = "";
  }

  window.__MM_JOINING_CARD__ = {
    show: showJoiningCard,
    clear: clearJoiningCard,
  };

  function geologyPanels() {
    const list = [...wrap.querySelectorAll(".geology-panel")];
    for (const panel of [lithologyPanel, erosionPanel, joiningPanel]) {
      if (panel && !list.includes(panel)) list.push(panel);
    }
    return list;
  }

  let activeModule = null;
  let transitionTimer = 0;
  let activateGen = 0;

  function setModuleActive(id) {
    activeModule = id;
    wrap.querySelectorAll(".geology-module-btn").forEach((btn) => {
      const on = id != null && btn.dataset.geoModule === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function hideAllPanels() {
    if (transitionTimer) {
      window.clearTimeout(transitionTimer);
      transitionTimer = 0;
    }
    geologyPanels().forEach((panel) => {
      panel.classList.remove("is-visible", "is-leaving");
      panel.hidden = true;
    });
  }

  function showPanel(id) {
    hideAllPanels();
    const next =
      id === "bank_erosion" && erosionPanel
        ? erosionPanel
        : id === "spectral_lithology" && lithologyPanel
          ? lithologyPanel
          : id === "joining_streams" && joiningPanel
            ? joiningPanel
            : id === "main_stem" && mainStemPanel
              ? mainStemPanel
              : id === "bathymetry" && bathymetryPanel
                ? bathymetryPanel
                : wrap.querySelector(`.geology-panel[data-geo-panel="${id}"]`);
    if (!next) return;
    next.hidden = false;
    void next.offsetWidth;
    next.classList.add("is-visible");
  }

  function clearModuleLayers(exceptId = null) {
    window.__MM_SCENE__?.hideHydrology?.();
    state.hydrologyHidesWater = false;
    state.hydrologyHidesFlood = false;
    state.bankErosionMode = false;
    state.bankErosionTipActive = false;
    state.lithologyMode = false;
    state.lithologyTipActive = false;
    state.joiningStreamsMode = false;
    state.joiningStreamsTipActive = false;
    state.mainStemMode = false;
    state.bathymetryMode = false;
    root.classList.remove(
      "bank-erosion-mode",
      "lithology-mode",
      "joining-streams-mode",
      "main-stem-mode",
      "bathymetry-mode",
    );
    window.__MM_SCENE__?.clearLithologyPick?.();
    window.__MM_SCENE__?.setJoiningStreams?.(false);
    window.__MM_SCENE__?.setMainStem?.(false);
    window.__MM_SCENE__?.setBathymetry?.(false);
    window.__MM_JOINING_CARD__?.clear?.();
  }

  function deactivateModule() {
    activateGen += 1;
    clearModuleLayers();
    hideAllPanels();
    setModuleActive(null);
  }

  async function activateModule(id, opts = {}) {
    const mod = GEOLOGY_MODULES.find((m) => m.id === id);
    if (!mod) return;

    const allowToggle = opts.toggle !== false;
    if (allowToggle && activeModule === id) {
      deactivateModule();
      return;
    }

    const gen = ++activateGen;
    if (id !== "spectral_lithology" && id !== "bank_erosion") {
      window.__MM_SCENE__?.hideHydrology?.();
    }
    if (id !== "bank_erosion") {
      state.bankErosionMode = false;
      state.bankErosionTipActive = false;
      root.classList.remove("bank-erosion-mode");
    }
    if (id !== "spectral_lithology") {
      state.lithologyMode = false;
      state.lithologyTipActive = false;
      root.classList.remove("lithology-mode");
      window.__MM_SCENE__?.clearLithologyPick?.();
    }
    if (id !== "joining_streams") {
      state.joiningStreamsMode = false;
      state.joiningStreamsTipActive = false;
      root.classList.remove("joining-streams-mode");
      window.__MM_SCENE__?.setJoiningStreams?.(false);
      window.__MM_JOINING_CARD__?.clear?.();
    }
    if (id !== "main_stem") {
      state.mainStemMode = false;
      root.classList.remove("main-stem-mode");
      window.__MM_SCENE__?.setMainStem?.(false);
    }
    if (id !== "bathymetry") {
      state.bathymetryMode = false;
      root.classList.remove("bathymetry-mode");
      window.__MM_SCENE__?.setBathymetry?.(false);
    }
    setModuleActive(id);
    showPanel(id);

    if (id === "joining_streams") {
      try {
        state.joiningStreamsMode = true;
        root.classList.add("joining-streams-mode");
        window.__MM_SCENE__?.setJoiningStreams?.(true);
        if (gen !== activateGen) return;
      } catch (err) {
        state.joiningStreamsMode = false;
        root.classList.remove("joining-streams-mode");
        console.warn("[geology] Joining streams:", err);
      }
      return;
    }

    if (id === "main_stem") {
      try {
        state.mainStemMode = true;
        root.classList.add("main-stem-mode");
        const result = window.__MM_SCENE__?.setMainStem?.(true);
        if (gen !== activateGen) return;
        if (result && result.available === false) {
          state.mainStemMode = false;
          root.classList.remove("main-stem-mode");
          console.warn("[geology] Main stem layer unavailable", result);
        }
      } catch (err) {
        state.mainStemMode = false;
        root.classList.remove("main-stem-mode");
        console.warn("[geology] Main stem:", err);
      }
      return;
    }

    if (id === "spectral_lithology") {
      try {
        state.lithologyMode = true;
        root.classList.add("lithology-mode");
        const result = await window.__MM_SCENE__?.showHydrologyLayer?.("geology");
        if (gen !== activateGen) return;
        if (result && result.available === false) {
          state.lithologyMode = false;
          root.classList.remove("lithology-mode");
          console.warn("[geology] Spectral lithology layer:", result.message);
        }
      } catch (err) {
        state.lithologyMode = false;
        root.classList.remove("lithology-mode");
        console.warn("[geology] Spectral lithology:", err);
      }
      return;
    }

    if (id === "bank_erosion") {
      try {
        state.hydrologyHidesWater = true;
        state.hydrologyHidesFlood = true;
        state.bankErosionMode = true;
        root.classList.add("bank-erosion-mode");
        let result = await window.__MM_SCENE__?.showHydrologyLayer?.("bank_erosion");
        if (result?.superseded || (!result?.available && result?.ok !== false)) {
          result = await window.__MM_SCENE__?.showHydrologyLayer?.("bank_erosion");
        }
        if (gen !== activateGen) return;
        if (result?.available && result?.ok !== false && !result?.superseded) {
          state.bankErosionMode = true;
          root.classList.add("bank-erosion-mode");
        } else {
          state.hydrologyHidesWater = false;
          state.hydrologyHidesFlood = false;
          state.bankErosionMode = false;
          state.bankErosionTipActive = false;
          root.classList.remove("bank-erosion-mode");
          console.warn("[geology] Bank erosion layer:", result);
        }
      } catch (err) {
        state.hydrologyHidesWater = false;
        state.hydrologyHidesFlood = false;
        state.bankErosionMode = false;
        state.bankErosionTipActive = false;
        root.classList.remove("bank-erosion-mode");
        console.warn("[geology] Bank erosion:", err);
      }
      return;
    }

    if (id === "bathymetry") {
      try {
        state.bathymetryMode = true;
        root.classList.add("bathymetry-mode");
        const result = window.__MM_SCENE__?.setBathymetry?.(true);
        if (gen !== activateGen) return;
        if (result && result.available === false) {
          state.bathymetryMode = false;
          root.classList.remove("bathymetry-mode");
          console.warn("[geology] Bathymetry layer unavailable", result);
        } else {
          console.info("[geology] Bathymetry on", result?.stats || null);
        }
      } catch (err) {
        state.bathymetryMode = false;
        root.classList.remove("bathymetry-mode");
        console.warn("[geology] Bathymetry:", err);
      }
      return;
    }
  }

  wrap.querySelectorAll("[data-geo-module]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void activateModule(btn.dataset.geoModule);
    });
  });

  return {
    el: wrap,
    open(moduleId = "vehicle") {
      wrap.hidden = false;
      root.classList.add("geology-open");
      void activateModule(moduleId, { toggle: false });
    },
    close() {
      wrap.hidden = true;
      root.classList.remove("geology-open");
      deactivateModule();
    },
    isOpen: () => !wrap.hidden,
    getActiveModule: () => activeModule,
    activateModule,
  };
}
