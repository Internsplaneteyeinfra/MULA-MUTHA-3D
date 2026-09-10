import {
  Mountain,
  Activity,
  Droplets,
  GitBranch,
  Sun,
  Waves,
  Layers,
} from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";

/** Reference lithology classes — exact percentages (do not invent). */
export const LITHOLOGY_CLASSES = [
  { id: "water", label: "Water", pct: "1.9%", color: "#3B82F6", icon: "drop" },
  { id: "basaltic", label: "Basaltic / Mafic", pct: "16.4%", color: "#B91C1C", icon: "rock" },
  { id: "weathered", label: "Weathered Rock", pct: "11.7%", color: "#EA580C", icon: "rock" },
  { id: "alluvial", label: "Alluvial / Sedimentary", pct: "8.2%", color: "#EAB308", icon: "layers" },
  { id: "ferruginous", label: "Ferruginous / Iron-rich", pct: "10.3%", color: "#DC2626", icon: "crystal" },
  { id: "clay", label: "Clay-rich", pct: "14.3%", color: "#7C3AED", icon: "layers" },
  { id: "silica", label: "Silica-rich", pct: "34.1%", color: "#94A3B8", icon: "crystal" },
  { id: "mixed", label: "Mixed Rock-soil", pct: "3.0%", color: "#92400E", icon: "soil" },
];

export const GEOLOGY_MODULES = [
  { id: "vehicle", label: "Vehicle", icon: Mountain, color: "#F97316", available: false },
  { id: "spectral_lithology", label: "Spectral Lithology", icon: Activity, color: "#38BDF8", available: true },
  { id: "bank_erosion", label: "Bank Erosion", icon: Droplets, color: "#22D3EE", available: false },
  { id: "joining_streams", label: "Joining Streams", icon: GitBranch, color: "#4ADE80", available: false },
  { id: "main_stem", label: "Main Stem", icon: Sun, color: "#FACC15", available: false },
  { id: "bathymetry", label: "Bathymetry", icon: Waves, color: "#7DD3FC", available: true, dashboard: true },
];

function lithoIconSvg(kind, color) {
  const c = color;
  if (kind === "drop") {
    return `<svg class="geo-litho-svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="${c}" d="M12 2.2C12 2.2 5.5 10.2 5.5 14.6a6.5 6.5 0 0 0 13 0C18.5 10.2 12 2.2 12 2.2z"/><path fill="rgba(255,255,255,.35)" d="M10.2 13.2c.4-2.2 1.6-4.2 1.8-4.5.3.4 1.5 2.4 1.9 4.5-.9.4-2 .4-3.7 0z"/></svg>`;
  }
  if (kind === "layers") {
    return `<svg class="geo-litho-svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="${c}" d="M3.5 8.2 12 4l8.5 4.2L12 12.4 3.5 8.2z"/><path fill="${c}" opacity=".78" d="M3.5 12.2 12 16.4l8.5-4.2v2.2L12 18.8 3.5 14.4v-2.2z"/><path fill="${c}" opacity=".55" d="M3.5 15.6 12 20l8.5-4.4v2.1L12 22.2 3.5 17.7v-2.1z"/></svg>`;
  }
  if (kind === "crystal") {
    return `<svg class="geo-litho-svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="${c}" d="M12 2.5 17.8 8 12 21.5 6.2 8 12 2.5z"/><path fill="rgba(255,255,255,.28)" d="M12 2.5 14.8 8H9.2L12 2.5z"/><path fill="rgba(0,0,0,.18)" d="M12 21.5 17.8 8h-2.2L12 18.2V21.5z"/></svg>`;
  }
  if (kind === "soil") {
    return `<svg class="geo-litho-svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="4" y="14" width="16" height="6" rx="1.5" fill="${c}"/><path fill="${c}" opacity=".75" d="M6 14 9 8h6l3 6H6z"/><circle cx="10" cy="16.8" r="1.1" fill="rgba(255,255,255,.25)"/><circle cx="14.5" cy="17.2" r=".9" fill="rgba(0,0,0,.2)"/></svg>`;
  }
  // rock
  return `<svg class="geo-litho-svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="${c}" d="M4.5 16.5 7 7.5l5-3 6.5 4.2 1 8.3-5.2 4.3-7.8-1.5-2-3.3z"/><path fill="rgba(255,255,255,.2)" d="M7 7.5 12 4.5l2.2 5.2-4.4 1.6L7 7.5z"/><path fill="rgba(0,0,0,.22)" d="M12 4.5 18.5 8.7l-1.2 3.1-5.8-.8.5-6.5z"/></svg>`;
}

/**
 * Horizontal Geology workspace (module row + lithology cards).
 * Does not touch the 3D scene except via existing __MM_SCENE__ hydrology/depth APIs.
 */
export function mountGeologyWorkspace(root) {
  const wrap = document.createElement("div");
  wrap.className = "geology-workspace";
  wrap.id = "geology-workspace";
  wrap.hidden = true;
  wrap.setAttribute("aria-label", "Geology workspace");

  wrap.innerHTML = `
    <section class="geology-module-row geo-glass">
      <div class="geology-intro">
        <div class="geology-intro-head">
          <span class="geology-intro-icon" aria-hidden="true">${lucideHtml(Layers, { size: 18, className: "geo-intro-svg" })}</span>
          <h2 class="geology-intro-title">Geology</h2>
        </div>
        <p class="geology-intro-sub">Spectral lithology, bank erosion, joining streams and bathymetry along Mula–Mutha river.</p>
      </div>
      <div class="geology-modules" role="tablist" aria-label="Geology modules">
        ${GEOLOGY_MODULES.map(
          (m) => `
          <button type="button" class="geology-module-btn${m.id === "spectral_lithology" ? " is-active" : ""}"
            data-geo-module="${m.id}" role="tab"
            aria-selected="${m.id === "spectral_lithology" ? "true" : "false"}"
            style="--geo-accent:${m.color}">
            <span class="geology-module-icon" style="color:${m.color}">${lucideHtml(m.icon, { size: 18, className: "geo-mod-svg" })}</span>
            <span class="geology-module-label">${m.label}</span>
            ${m.dashboard ? `<span class="geology-module-chip">Dashboard</span>` : ""}
          </button>`,
        ).join("")}
      </div>
    </section>

    <section class="geology-lithology-row geo-glass" id="geology-lithology-row" aria-label="Lithology composition">
      ${LITHOLOGY_CLASSES.map(
        (c) => `
        <article class="geology-litho-card" data-litho="${c.id}" style="--litho-color:${c.color}">
          <span class="geology-litho-icon">${lithoIconSvg(c.icon, c.color)}</span>
          <div class="geology-litho-text">
            <span class="geology-litho-name">${c.label}</span>
            <strong class="geology-litho-pct">${c.pct}</strong>
          </div>
        </article>`,
      ).join("")}
    </section>

    <div class="geology-status geo-glass" id="geology-status" hidden></div>
  `;

  root.appendChild(wrap);

  const lithoRow = wrap.querySelector("#geology-lithology-row");
  const statusEl = wrap.querySelector("#geology-status");
  let activeModule = "spectral_lithology";

  function setStatus(html, show = true) {
    if (!show || !html) {
      statusEl.hidden = true;
      statusEl.innerHTML = "";
      return;
    }
    statusEl.hidden = false;
    statusEl.innerHTML = html;
  }

  function setModuleActive(id) {
    activeModule = id;
    wrap.querySelectorAll(".geology-module-btn").forEach((btn) => {
      const on = btn.dataset.geoModule === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  async function activateModule(id) {
    setModuleActive(id);
    const mod = GEOLOGY_MODULES.find((m) => m.id === id);
    if (!mod) return;

    if (id === "spectral_lithology") {
      lithoRow.hidden = false;
      setStatus("");
      try {
        const result = await window.__MM_SCENE__?.showHydrologyLayer?.("geology");
        if (result && !result.available) {
          setStatus(`<strong>Spectral Lithology</strong><p>${escapeHtml(result.message || "Layer unavailable")}</p>`);
        }
      } catch (err) {
        setStatus(`<strong>Unable to load Spectral Lithology</strong><p>${escapeHtml(err.message || String(err))}</p>`);
      }
      return;
    }

    if (id === "bathymetry") {
      lithoRow.hidden = true;
      // Use existing depth-zones layer as Bathymetry Dashboard (no new 3D systems)
      stateShowDepthZones(true);
      setStatus(`
        <div class="geology-bathy-dash">
          <span class="geology-bathy-icon" style="color:#7DD3FC">${lucideHtml(Waves, { size: 16 })}</span>
          <div>
            <strong>Bathymetry Dashboard</strong>
            <p>River depth zones from the existing survey overlay. Use Layers → Depth Zones for visibility controls.</p>
          </div>
        </div>`);
      return;
    }

    lithoRow.hidden = true;
    window.__MM_SCENE__?.hideHydrology?.();
    setStatus(`
      <strong>${escapeHtml(mod.label)}</strong>
      <p>DATA UNAVAILABLE — Mula–Mutha layer not connected in this build.</p>`);
  }

  wrap.querySelectorAll("[data-geo-module]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void activateModule(btn.dataset.geoModule);
    });
  });

  return {
    el: wrap,
    open() {
      wrap.hidden = false;
      root.classList.add("geology-open");
      void activateModule(activeModule || "spectral_lithology");
    },
    close() {
      wrap.hidden = true;
      root.classList.remove("geology-open");
      setStatus("");
      // Remove geology overlay when leaving Geology workspace
      window.__MM_SCENE__?.hideHydrology?.();
    },
    isOpen: () => !wrap.hidden,
    getActiveModule: () => activeModule,
  };
}

function stateShowDepthZones(on) {
  const el = document.querySelector("#depth-zones");
  if (el) {
    el.checked = !!on;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  state.showDepthZones = !!on;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
