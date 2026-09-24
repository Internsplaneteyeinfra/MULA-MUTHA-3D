import {
  Mountain,
  Droplets,
  Pickaxe,
  Sprout,
  Sun,
  SunMedium,
  Activity,
} from "lucide";
import { lucideHtml } from "../icons.js";
import { mountGeologyWorkspace } from "./geologyWorkspace.js";
import { mountWaterQualityHud } from "./waterQualityHud.js";
import { mountLandUseHud } from "./landUseHud.js";
import { mountLandUseThemeHud } from "./landUseThemeHud.js";
import { mountFocusThemeHud } from "../mapFocus.js";
import { mountPollutionKeyPoints } from "./pollutionKeyPoints.js";
import { mountBodCodHud } from "./bodCodHud.js";
import { mountClimateImpactHud } from "./climateImpactHud.js";
import { mountAqiHud } from "./aqiHud.js";
import {
  FORECAST_HORIZONS,
  forecastProfile,
  downsampleProfile,
} from "../../services/forecastService.js";
import { metersToStation } from "../../scene/chainageMarkers.js";
import { AQI_FALLBACK_LL } from "../../services/aqiService.js";
import { localToLonLat } from "../../geo/geoReference.js";
import { interpolateChainage } from "../../geo/chainage.js";
import { state } from "../../state.js";

const HYDROLOGY_CATEGORIES = [
  { id: "geology", name: "GEOLOGY" },
  { id: "water_quality", name: "WATER QUALITY" },
  { id: "salinity", name: "SALINITY" },
  { id: "pollution", name: "POLLUTION" },
  { id: "landuse", name: "LAND USE" },
  { id: "aqi", name: "AQI" },
];

/** Icon-only transparent toolbar — independent analytics buttons. */
const NAV_ITEMS = [
  { icon: Activity, tip: "3D Digital Twin", type: "digital_twin", tone: "dt-mode-toggle", badge: null },
  { icon: Mountain, tip: "Geology", type: "vehicle", tone: "tone-mountain", badge: null },
  { icon: Droplets, tip: "Water Quality", type: "Water Quality", tone: "tone-droplet", badge: null },
  { icon: Pickaxe, tip: "Pollution", type: "Pollution", tone: "tone-drill", badge: null },
  { icon: Sprout, tip: "Land Use", type: "Land Use", tone: "tone-plant", badge: null },
  { icon: Sun, tip: "Climate impact", type: "Climate impact", tone: "tone-sun", badge: null },
  { icon: SunMedium, tip: "AQI", type: "AQI", tone: "tone-brightness", badge: null },
];

/**
 * Top analytics nav — fully transparent strip; each icon is a real <button>.
 * Existing Vehicle / Geology / Hydrology / Hydrograph / Simulations / Flood still work.
 */
export function mountAnalyticsControls(root, dataset) {
  const el = document.createElement("nav");
  el.className = "analytics-controls top-navigation analytics-controls--glass";
  el.setAttribute("aria-label", "River analytics");
  el.setAttribute("role", "toolbar");
  el.innerHTML = NAV_ITEMS.map(
    ({ icon, tip, type, tone, badge }) =>
      `<button type="button" class="nav-button ${tone}" data-analytics="${type}" data-tip="${tip}" aria-label="${tip}" title="${tip}" aria-pressed="false">` +
      `<span class="nav-button-icon" aria-hidden="true">${lucideHtml(icon, { size: 20, strokeWidth: 1.75, className: "nav-icon-svg" })}</span>` +
      (badge
        ? `<span class="nav-button-badge" aria-hidden="true">${badge}</span>`
        : "") +
      `</button>`,
  ).join("");
  root.appendChild(el);

  const geology = mountGeologyWorkspace(root);

  const waterQualityHud = mountWaterQualityHud(root, {
    async onSelect(opt) {
      await activateWaterQualityMetric(opt);
    },
  });

  const landUseHud = mountLandUseHud(root, {
    async onSelect(opt) {
      await activateLandUseLayer(opt);
    },
  });

  const landUseTheme = mountLandUseThemeHud(root, {
    async onYearChange(year) {
      try {
        const result = await window.__MM_SCENE__?.setLulcYear?.(year);
        if (result?.available) {
          activeHydroId = "landuse_lulc";
          landUseHud.setStatus("");
          renderHydroLegend(result);
        } else if (result) {
          landUseHud.setStatus(
            `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(result.message || result.reason || "Year unavailable")}</span>`,
            { unavailable: true },
          );
        }
      } catch (err) {
        landUseHud.setStatus(
          `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(err?.message || String(err))}</span>`,
          { unavailable: true },
        );
      }
    },
    async onPeriodChange(periodId) {
      const layerId = activeHydroId === "silt_volume_surface" ? "silt_volume_surface" : "silt_classification";
      try {
        const result =
          layerId === "silt_volume_surface"
            ? await window.__MM_SCENE__?.setSiltVolumePeriod?.(periodId)
            : await window.__MM_SCENE__?.setSiltClassificationPeriod?.(periodId);
        if (result?.available) {
          activeHydroId = layerId;
          landUseHud.setStatus("");
          renderHydroLegend(result);
        } else if (result) {
          landUseHud.setStatus(
            `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(result.message || result.reason || "Period unavailable")}</span>`,
            { unavailable: true },
          );
        }
      } catch (err) {
        landUseHud.setStatus(
          `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(err?.message || String(err))}</span>`,
          { unavailable: true },
        );
      }
    },
    onClear() {
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = null;
      clearHydroLegend();
    },
    onBack() {
      // Leave focus chrome; clear map layer so user can pick LULC / silt / veg again
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = null;
      hydroLegend.hidden = true;
      hydroLegend.innerHTML = "";
      landUseHud.setActiveOption(null);
      landUseHud.setStatus("");
      if (!landUseHud.isOpen()) landUseHud.show();
      setActive("Land Use");
    },
  });

  const pollutionTheme = mountFocusThemeHud(root, {
    onBack() {
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = null;
      hydroLegend.hidden = true;
      hydroLegend.innerHTML = "";
      pollutionKeys.hide();
      setActive(null);
    },
    onClassSelect(label) {
      window.__MM_SCENE__?.setGarbageClassFilter?.(label);
      if (label && /density/i.test(label)) {
        window.__MM_SCENE__?.setGarbageDensityVisible?.(true);
      }
      window.__MM_SCENE__?.setGarbageLabelsVisible?.(true);
      pollutionKeys.refresh();
    },
    bindExtra(extraEl) {
      const densBtn = extraEl.querySelector("#focus-garbage-density");
      if (!densBtn) return;
      densBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const on = densBtn.getAttribute("aria-pressed") !== "true";
        window.__MM_SCENE__?.setGarbageDensityVisible?.(on);
        densBtn.classList.toggle("is-active", on);
        densBtn.setAttribute("aria-pressed", on ? "true" : "false");
      });
    },
  });

  const waterQualityTheme = mountFocusThemeHud(root, {
    onBack() {
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = null;
      hydroLegend.hidden = true;
      hydroLegend.innerHTML = "";
      if (!waterQualityHud.isOpen()) waterQualityHud.show();
      else waterQualityHud.reposition?.();
      setActive("Water Quality");
    },
    onClassSelect() {
      // Class filter uses shared landUseSelectedClass for polygon highlight
    },
  });

  const pollutionKeys = mountPollutionKeyPoints(root);

  const bodCodHud = mountBodCodHud(root, {
    onBack() {
      setActive("hydrology");
      if (!waterQualityHud.isOpen()) waterQualityHud.show();
    },
  });

  const climateImpactHud = mountClimateImpactHud(root);
  const aqiHud = mountAqiHud(root, {
    getPoint() {
      const fromState = Number(state.selectedChainageMeters);
      const meters = Number.isFinite(fromState) ? fromState : selectedMeters;
      return resolveAqiPoint(dataset, meters);
    },
  });

  const modal = document.createElement("div");
  modal.className = "river-analysis-modal-backdrop";
  modal.hidden = true;
  modal.innerHTML = `
    <section class="river-analysis-modal analytics-modal" role="dialog" aria-modal="true" aria-labelledby="analytics-title">
      <button type="button" class="river-analysis-close" aria-label="Close">×</button>
      <h2 id="analytics-title"></h2>
      <div id="analytics-body"></div>
    </section>`;
  root.appendChild(modal);

  const hydroLegend = document.createElement("aside");
  hydroLegend.className = "hydro-legend-hud";
  hydroLegend.hidden = true;
  hydroLegend.setAttribute("aria-live", "polite");
  root.appendChild(hydroLegend);

  let selectedMeters = dataset?.chainage?.[0]?.meters ?? 0;
  let activeType = null;
  let forecastLead = 24;
  let forecastCache = null;
  let forecastRequestId = 0;
  let activeHydroId = null;

  document.addEventListener("chainage-select", (event) => {
    if (event.detail?.meters == null) return;
    selectedMeters = event.detail.meters;
    if (activeType === "forecast" && forecastCache && !modal.hidden) {
      renderForecastBody(forecastCache, selectedMeters, forecastLead);
    }
    if (aqiHud.isOpen()) aqiHud.onChainageChange?.();
  });

  function setActive(type) {
    activeType = type;
    el.querySelectorAll(".nav-button").forEach((btn) => {
      const on = btn.dataset.analytics === type;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function closeModal() {
    modal.hidden = true;
  }

  function closeWaterQualityHud() {
    if (waterQualityHud.isOpen()) waterQualityHud.hide();
  }

  function closeLandUseHud() {
    if (landUseHud.isOpen()) landUseHud.hide();
    landUseTheme.hide();
    const luIds = new Set([
      "landuse_lulc",
      "silt_classification",
      "silt_volume_surface",
      "vegetation_extent",
      "vegetation_health",
    ]);
    if (luIds.has(String(activeHydroId || ""))) {
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = null;
    }
  }

  function closeDigitalTwin() {
    const uiRoot = document.getElementById("ui-root");
    const dtPanel = document.querySelector("#dt-panel");
    const dtDock = document.querySelector("#twin-analytics-dock");
    const dtBtn = el.querySelector("[data-analytics='digital_twin']");
    const dtModeBtn = document.querySelector("#dt-mode-toggle");
    if (dtPanel) dtPanel.hidden = true;
    if (dtDock) dtDock.hidden = true;
    // Also close the Hydrology Intelligence Panel backdrop
    window.__MM_HYDRO_INTEL__?.hide?.();
    uiRoot?.classList.remove("dt-mode-active");
    document.body.classList.remove("dt-mode-active");
    for (const btn of [dtBtn, dtModeBtn]) {
      if (!btn) continue;
      btn.classList.remove("active");
      btn.setAttribute("aria-pressed", "false");
    }
  }

  function closeAll() {
    closeModal();
    closeWaterQualityHud();
    closeLandUseHud();
    geology.close();
    if (bodCodHud.isVisible()) bodCodHud.hide();
    if (climateImpactHud.isOpen()) climateImpactHud.hide();
    if (aqiHud.isOpen()) aqiHud.hide();
    closeDigitalTwin();
    clearHydroLegend();
    window.__MM_SCENE__?.hideHydrology?.();
    activeHydroId = null;
    setActive(null);
  }

  function clearHydroLegend() {
    hydroLegend.hidden = true;
    hydroLegend.innerHTML = "";
    landUseTheme.hide();
    pollutionTheme.hide();
    waterQualityTheme.hide();
    pollutionKeys.hide();
  }

  function isLandUseThemeLegend(leg) {
    if (!leg || leg.type !== "classes") return false;
    if (Array.isArray(leg.years) && leg.years.length) return true;
    if (Array.isArray(leg.periods) && leg.periods.length) return true;
    const id = String(leg.layerId || "");
    return (
      id === "landuse_lulc" ||
      id.startsWith("silt_") ||
      id === "vegetation_extent" ||
      id === "vegetation_health" ||
      /lulc|land\s*use|silt|vegetation/i.test(String(leg.title || ""))
    );
  }

  function isPollutionThemeLegend(leg) {
    if (!leg || leg.type !== "classes") return false;
    const id = String(leg.layerId || "");
    return id === "pollution" || !!leg.garbageDensityToggle || /pollution/i.test(String(leg.title || ""));
  }

  function isWaterQualityThemeLegend(leg) {
    if (!leg || leg.type !== "classes") return false;
    if (isLandUseThemeLegend(leg) || isPollutionThemeLegend(leg)) return false;
    const id = String(leg.layerId || activeHydroId || "");
    return (
      id === "salinity" ||
      id.startsWith("water_quality") ||
      /salinity|turbidity|tss|ndci|wst|chlorophyll|temperature/i.test(
        String(leg.title || ""),
      )
    );
  }

  function showWaterQualityTheme(leg) {
    hydroLegend.hidden = true;
    hydroLegend.innerHTML = "";
    landUseTheme.hide();
    pollutionTheme.hide();
    pollutionKeys.hide();
    waterQualityTheme.showClasses(leg.classes || [], "waterquality", { legendOnly: true });
    if (waterQualityHud.isOpen()) waterQualityHud.reposition?.();
  }

  function showPollutionTheme(leg) {
    hydroLegend.hidden = true;
    hydroLegend.innerHTML = "";
    landUseTheme.hide();
    waterQualityTheme.hide();
    const densityOn = !!leg.densityOn;
    pollutionTheme.showClasses(leg.classes || [], "pollution", {
      extraHtml: leg.garbageDensityToggle
        ? `<button type="button" class="focus-density-btn${densityOn ? " is-active" : ""}" id="focus-garbage-density" aria-pressed="${densityOn ? "true" : "false"}">Garbage Density</button>`
        : "",
    });
    window.__MM_SCENE__?.setGarbageLabelsVisible?.(true);
    window.__MM_SCENE__?.setGarbageClassFilter?.(null);
    pollutionKeys.show();
  }

  async function activateWaterQualityMetric(opt) {
    // BOD–COD → JalNetra twin ribbon + focused HUD
    if (opt?.id === "bod_cod") {
      geology.close();
      closeLandUseHud();
      if (climateImpactHud.isOpen()) climateImpactHud.hide();
      hydroLegend.hidden = true;
      hydroLegend.innerHTML = "";
      landUseTheme.hide();
      pollutionTheme.hide();
      waterQualityTheme.hide();
      pollutionKeys.hide();
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = "bod_cod";
      waterQualityHud.setStatus("");
      waterQualityHud.hide();
      await bodCodHud.show();
      return;
    }

    if (bodCodHud.isVisible()) bodCodHud.hide();

    const tryIds = [opt.layerId, opt.fallbackLayerId].filter(Boolean);
    let last = null;
    for (const id of tryIds) {
      try {
        const result = await window.__MM_SCENE__?.showHydrologyLayer?.(id);
        last = result;
        if (!result) continue;
        activeHydroId = id;
        if (result.available) {
          waterQualityHud.setStatus("");
          renderHydroLegend(result);
          return;
        }
      } catch (err) {
        last = { available: false, message: err?.message || String(err) };
      }
    }
    clearHydroLegend();
    const msg =
      last?.message ||
      last?.reason ||
      "No Water Quality dataset is connected for this metric.";
    waterQualityHud.setStatus(
      `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(msg)}</span>`,
      { unavailable: true },
    );
  }

  async function activateLandUseLayer(opt) {
    const layerId = opt?.layerId || null;
    // Same button again → turn layer off (keep Land Use HUD open)
    if (layerId && activeHydroId === layerId) {
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = null;
      clearHydroLegend();
      landUseHud.setActiveOption(null);
      landUseHud.setStatus("");
      if (!landUseHud.isOpen()) landUseHud.show();
      setActive("Land Use");
      return;
    }

    const tryIds = [opt.layerId, opt.fallbackLayerId].filter(Boolean);
    let last = null;
    for (const id of tryIds) {
      try {
        const result =
          (await window.__MM_SCENE__?.showLandUseLayer?.(id)) ||
          (await window.__MM_SCENE__?.showHydrologyLayer?.(id));
        last = result;
        if (!result) continue;
        activeHydroId = id;
        if (result.available) {
          landUseHud.setActiveOption(opt.id);
          landUseHud.setStatus("");
          renderHydroLegend(result);
          return;
        }
      } catch (err) {
        last = { available: false, message: err?.message || String(err), reason: err?.message };
      }
    }
    clearHydroLegend();
    const msg =
      last?.message ||
      last?.reason ||
      "No Land Use dataset is connected for this layer.";
    landUseHud.setStatus(
      `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(msg)}</span>`,
      { unavailable: true },
    );
  }

  function openWaterQualityHud() {
    geology.close();
    closeModal();
    closeLandUseHud();
    if (climateImpactHud.isOpen()) climateImpactHud.hide();
    clearHydroLegend();
    window.__MM_SCENE__?.hideHydrology?.();
    setActive("hydrology");
    waterQualityHud.show();
  }

  function openLandUseHud() {
    geology.close();
    closeModal();
    closeWaterQualityHud();
    if (climateImpactHud.isOpen()) climateImpactHud.hide();
    clearHydroLegend();
    window.__MM_SCENE__?.hideHydrology?.();
    setActive("Land Use");
    landUseHud.show();
  }

  function renderHydroLegend(result) {
    if (!result?.available || !result.legend) {
      clearHydroLegend();
      return;
    }
    const leg = result.legend;

    // Land Use theme: top F/C/B/S/W chips + bottom year/period stepper
    if (isLandUseThemeLegend(leg)) {
      pollutionTheme.hide();
      waterQualityTheme.hide();
      hydroLegend.hidden = true;
      hydroLegend.innerHTML = "";
      landUseTheme.showFromLegend(leg);
      return;
    }

    // Water Quality theme: same letter chips + Back as Land Use
    if (isWaterQualityThemeLegend(leg)) {
      showWaterQualityTheme(leg);
      return;
    }

    // Pollution theme: top G/L/M/H chips + density toggle + Back
    if (isPollutionThemeLegend(leg)) {
      showPollutionTheme(leg);
      return;
    }

    landUseTheme.hide();
    pollutionTheme.hide();
    waterQualityTheme.hide();

    if (leg.type === "image") {
      hydroLegend.innerHTML = `
        <div class="hydro-legend-hud-title">${escapeHtml(leg.title || "GEOLOGY")}</div>
        <img src="${escapeHtml(leg.url)}" alt="Geology legend" class="hydro-legend-hud-img"/>
        <button type="button" class="hydro-legend-clear" id="hydro-clear-layer">Clear layer</button>`;
    } else if (leg.type === "classes") {
      const yearRow =
        Array.isArray(leg.years) && leg.years.length
          ? `<div class="hydro-legend-years" role="group" aria-label="Year">` +
            leg.years
              .map((y) => {
                const on = Number(y) === Number(leg.activeYear);
                return `<button type="button" class="hydro-year-btn${on ? " is-active" : ""}" data-lulc-year="${y}" aria-pressed="${on ? "true" : "false"}">${y}</button>`;
              })
              .join("") +
            `</div>`
          : "";
      const periodRow =
        Array.isArray(leg.periods) && leg.periods.length
          ? `<div class="hydro-legend-years" role="group" aria-label="Period">` +
            leg.periods
              .map((p) => {
                const id = typeof p === "object" ? p.id : p;
                const label = typeof p === "object" ? p.label || p.id : p;
                const on = String(id) === String(leg.activePeriod);
                return `<button type="button" class="hydro-year-btn${on ? " is-active" : ""}" data-silt-period="${escapeHtml(id)}" aria-pressed="${on ? "true" : "false"}">${escapeHtml(label)}</button>`;
              })
              .join("") +
            `</div>`
          : "";
      const rows = (leg.classes || [])
        .map(
          (c) =>
            `<div class="hydro-legend-hud-row">` +
            `<span class="hydro-swatch hydro-swatch--dot" style="background:${escapeHtml(c.color || "#888")}"></span>` +
            `<span class="hydro-legend-hud-label">${escapeHtml(c.label)}</span>` +
            `${c.range ? `<span class="hydro-legend-hud-range">${escapeHtml(c.range)}</span>` : ""}` +
            `</div>`,
        )
        .join("");
      const densityBtn = leg.garbageDensityToggle
        ? `<button type="button" class="hydro-year-btn${leg.densityOn ? " is-active" : ""}" id="hydro-garbage-density" aria-pressed="${leg.densityOn ? "true" : "false"}">Garbage Density</button>`
        : "";
      hydroLegend.innerHTML = `
        <div class="hydro-legend-hud-title">${escapeHtml(leg.title || "LAYER")}</div>
        ${leg.subtitle ? `<div class="hydro-legend-hud-sub">${escapeHtml(leg.subtitle)}</div>` : ""}
        ${yearRow}${periodRow}${densityBtn ? `<div class="hydro-legend-years">${densityBtn}</div>` : ""}
        <div class="hydro-legend-hud-classes">${rows}</div>
        <button type="button" class="hydro-legend-clear" id="hydro-clear-layer">Clear layer</button>`;
    } else {
      clearHydroLegend();
      return;
    }
    hydroLegend.hidden = false;
    hydroLegend.querySelector("#hydro-clear-layer")?.addEventListener("click", () => {
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = null;
      clearHydroLegend();
      if (activeType === "hydrology" && !modal.hidden) openHydrology();
    });
    hydroLegend.querySelectorAll("[data-lulc-year]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const year = Number(btn.dataset.lulcYear);
        if (!Number.isFinite(year)) return;
        try {
          const result = await window.__MM_SCENE__?.setLulcYear?.(year);
          if (result?.available) {
            activeHydroId = "landuse_lulc";
            landUseHud.setStatus("");
            renderHydroLegend(result);
          } else if (result) {
            landUseHud.setStatus(
              `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(result.message || result.reason || "Year unavailable")}</span>`,
              { unavailable: true },
            );
          }
        } catch (err) {
          landUseHud.setStatus(
            `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(err?.message || String(err))}</span>`,
            { unavailable: true },
          );
        }
      });
    });
    hydroLegend.querySelectorAll("[data-silt-period]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const period = btn.dataset.siltPeriod;
        if (!period) return;
        const layerId = leg.layerId || "silt_classification";
        try {
          const result =
            layerId === "silt_volume_surface"
              ? await window.__MM_SCENE__?.setSiltVolumePeriod?.(period)
              : await window.__MM_SCENE__?.setSiltClassificationPeriod?.(period);
          if (result?.available) {
            activeHydroId = layerId;
            landUseHud.setStatus("");
            renderHydroLegend(result);
          } else if (result) {
            landUseHud.setStatus(
              `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(result.message || result.reason || "Period unavailable")}</span>`,
              { unavailable: true },
            );
          }
        } catch (err) {
          landUseHud.setStatus(
            `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(err?.message || String(err))}</span>`,
            { unavailable: true },
          );
        }
      });
    });
    const densBtn = hydroLegend.querySelector("#hydro-garbage-density");
    if (densBtn) {
      densBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const on = densBtn.getAttribute("aria-pressed") !== "true";
        window.__MM_SCENE__?.setGarbageDensityVisible?.(on);
        densBtn.classList.toggle("is-active", on);
        densBtn.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
  }

  function isGeologyNav(type) {
    return type === "geology" || type === "vehicle";
  }

  function openGeologyWorkspace(moduleId = null) {
    closeModal();
    closeWaterQualityHud();
    closeLandUseHud();
    if (climateImpactHud.isOpen()) climateImpactHud.hide();
    clearHydroLegend();
    // Keep top Geology icon unselected — selection lives in the geology toolbar only.
    setActive(null);
    geology.open(moduleId);
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
      if (!isGeologyNav(activeType)) setActive(null);
    }
  });
  modal.querySelector(".river-analysis-close").addEventListener("click", () => {
    closeModal();
    if (!isGeologyNav(activeType)) setActive(null);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (aqiHud.isOpen()) {
      aqiHud.hide();
      setActive(null);
      return;
    }
    if (climateImpactHud.isOpen()) {
      climateImpactHud.hide();
      setActive(null);
      return;
    }
    if (waterQualityTheme.isVisible()) {
      waterQualityTheme.hide();
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = null;
      if (!waterQualityHud.isOpen()) waterQualityHud.show();
      else waterQualityHud.reposition?.();
      setActive("Water Quality");
      return;
    }
    if (pollutionTheme.isVisible()) {
      pollutionTheme.hide();
      pollutionKeys.hide();
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = null;
      setActive(null);
      return;
    }
    if (waterQualityHud.isOpen()) {
      closeWaterQualityHud();
      setActive(null);
      return;
    }
    if (landUseHud.isOpen()) {
      closeLandUseHud();
      setActive(null);
      return;
    }
    if (!modal.hidden) {
      closeModal();
      if (!isGeologyNav(activeType)) setActive(null);
    } else if (geology.isOpen()) {
      closeAll();
    }
  });

  el.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-analytics]");
    if (!button) return;
    document.dispatchEvent(new CustomEvent("river-measure-clear"));
    const type = button.dataset.analytics;

    if (type === "digital_twin") {
      const uiRoot = document.getElementById("ui-root");
      const dtPanel = document.querySelector("#dt-panel");
      const dtDock = document.querySelector("#twin-analytics-dock");
      const isCurrentlyVisible = dtPanel && !dtPanel.hidden;
      const targetState = !isCurrentlyVisible;

      if (targetState) {
        closeModal();
        closeWaterQualityHud();
        closeLandUseHud();
        geology.close();
        if (bodCodHud.isVisible()) bodCodHud.hide();
        if (climateImpactHud.isOpen()) climateImpactHud.hide();
        if (aqiHud.isOpen()) aqiHud.hide();
        clearHydroLegend();
        setActive("digital_twin");
        // Open Hydrology Intelligence Panel
        window.__MM_HYDRO_INTEL__?.show?.();
      } else {
        setActive(null);
        // Close Hydrology Intelligence Panel
        window.__MM_HYDRO_INTEL__?.hide?.();
      }

      if (dtPanel) dtPanel.hidden = !targetState;
      if (dtDock) dtDock.hidden = !targetState;

      uiRoot?.classList.toggle("dt-mode-active", targetState);
      document.body.classList.toggle("dt-mode-active", targetState);
      button.classList.toggle("active", targetState);
      button.setAttribute("aria-pressed", targetState ? "true" : "false");
      if (targetState) {
        window.__MM_SCENE__?.setAssetMarkersVisible?.(false);
      }
      return;
    }

    // Soft extras — reuse existing UI without new routing.
    if (type === "monitoring") {
      closeAll();
      window.__MM_SCENE__?.hideHydrology?.();
      clearHydroLegend();
      document.querySelector("#nav-overview")?.click();
      setActive(null);
      return;
    }
    if (type === "environment") {
      geology.close();
      closeModal();
      closeWaterQualityHud();
      closeLandUseHud();
      clearHydroLegend();
      setActive("environment");
      document.querySelector("#settings-btn")?.click();
      return;
    }
    if (type === "weather") {
      setActive("weather");
      const weather = document.querySelector(".weather-widget");
      weather?.classList.add("is-nav-pulse");
      window.setTimeout(() => weather?.classList.remove("is-nav-pulse"), 1600);
      document.getElementById("weather-icon-btn")?.click();
      return;
    }

    // Mountain / Vehicle → open Geology workspace (no pre-selected module)
    if (type === "vehicle") {
      openGeologyWorkspace(null);
      return;
    }

    // Pickaxe / Geology → toggle Geology workspace (never leave nav icon “selected”)
    if (type === "geology") {
      if (geology.isOpen()) {
        closeAll();
        return;
      }
      openGeologyWorkspace(null);
      return;
    }

    if (type === "home") {
      closeAll();
      window.__MM_SCENE__?.hideHydrology?.();
      clearHydroLegend();
      setActive(null);
      return;
    }

    // Pollution → amber garbage pins along the corridor
    if (type === "Pollution") {
      closeWaterQualityHud();
      closeLandUseHud();
      geology.close();
      closeModal();
      if (climateImpactHud.isOpen()) climateImpactHud.hide();
      setActive("Pollution");
      (async () => {
        try {
          const result = await window.__MM_SCENE__?.showHydrologyLayer?.("pollution");
          activeHydroId = "pollution";
          if (result?.available) renderHydroLegend(result);
          else clearHydroLegend();
        } catch (err) {
          clearHydroLegend();
          console.warn("[pollution]", err);
        }
      })();
      return;
    }

    // Water Quality (droplet): floating icon HUD only — never open the analytics modal.
    if (type === "hydrology" || type === "Water Quality") {
      if (waterQualityHud.isOpen()) {
        closeAll();
        return;
      }
      openWaterQualityHud();
      return;
    }

    // Land Use (sprout): floating icon-only submenu — never open analytics modal.
    if (type === "Land Use") {
      if (landUseHud.isOpen()) {
        closeAll();
        return;
      }
      openLandUseHud();
      return;
    }

    // Climate impact (sun): RiverEye flood / surface-water heatmap periods
    if (type === "Climate impact") {
      if (climateImpactHud.isOpen()) {
        closeAll();
        return;
      }
      closeWaterQualityHud();
      closeLandUseHud();
      geology.close();
      closeModal();
      if (bodCodHud.isVisible()) bodCodHud.hide();
      if (aqiHud.isOpen()) aqiHud.hide();
      clearHydroLegend();
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = "climate_impact";
      setActive("Climate impact");
      void climateImpactHud.show();
      return;
    }

    // AQI (sun-medium): RiverEye live air quality
    if (type === "AQI") {
      if (aqiHud.isOpen()) {
        closeAll();
        return;
      }
      closeWaterQualityHud();
      closeLandUseHud();
      geology.close();
      closeModal();
      if (climateImpactHud.isOpen()) climateImpactHud.hide();
      if (bodCodHud.isVisible()) bodCodHud.hide();
      clearHydroLegend();
      window.__MM_SCENE__?.hideHydrology?.();
      activeHydroId = "aqi";
      setActive("AQI");
      void aqiHud.show();
      return;
    }

    closeWaterQualityHud();
    closeLandUseHud();
    geology.close();
    if (climateImpactHud.isOpen()) climateImpactHud.hide();
    if (aqiHud.isOpen()) aqiHud.hide();
    setActive(type);
    modal.hidden = false;

    if (type === "forecast") {
      modal.querySelector("#analytics-title").textContent = "FORECAST";
      await openForecast();
      return;
    }

    const labels = {
      hydrograph: "HYDROGRAPH",
      simulations: "DATA SIMULATIONS",
      flood: "LIVE FLOOD SCENARIO",
    };
    modal.querySelector("#analytics-title").textContent = labels[type] || type.toUpperCase();
    modal.querySelector("#analytics-body").innerHTML =
      `<p class="analytics-status">Loading model data…</p>`;
    try {
      const payload = await loadLegacyAnalytics(type, selectedMeters, dataset);
      if (activeType !== type) return;
      modal.querySelector("#analytics-body").innerHTML = legacyMarkup(
        type,
        payload,
        selectedMeters,
      );
    } catch (error) {
      if (activeType !== type) return;
      modal.querySelector("#analytics-body").innerHTML = `
        <p class="analytics-unavailable">${escapeHtml(error.message || "Service unavailable")}</p>
        <p class="analytics-note">This modelled analytics endpoint is not available in the production build.</p>`;
    }
  });

  document.addEventListener("click", (event) => {
    const uiRoot = document.getElementById("ui-root");
    const dtOn =
      uiRoot?.classList.contains("dt-mode-active") ||
      document.body.classList.contains("dt-mode-active");
    if (!dtOn) return;
    const isDtPanel    = event.target.closest("#dt-panel");
    const isDtDock     = event.target.closest("#twin-analytics-dock");
    const isDtBtn      =
      event.target.closest("[data-analytics='digital_twin']") ||
      event.target.closest("#dt-mode-toggle");
    const isDtAsset    = event.target.closest(".dt-strip-node");
    const isLeftStack  = event.target.closest("#left-ui-stack");
    // Never close while the Hydrology Intelligence Panel is open —
    // it has pointer-events:none on its backdrop so clicks fall through
    // to this handler, but we must NOT interpret them as "click outside DT".
    const isHydroPanel = event.target.closest("#hydro-intel-panel") ||
                         event.target.closest("#hydro-intel-backdrop");
    const isHydroOpen  = !!(window.__MM_HYDRO_INTEL__?.isOpen?.());
    if (!isDtPanel && !isDtDock && !isDtBtn && !isDtAsset && !isLeftStack &&
        !isHydroPanel && !isHydroOpen) {
      closeDigitalTwin();
    }
  });

  async function openHydrology() {
    const body = modal.querySelector("#analytics-body");
    body.innerHTML = `
      <div class="hydro-panel">
        <p class="model-badge">THEMATIC HYDROLOGY · MULA–MUTHA</p>
        <p class="analytics-note">Select one category. Layers are mutually exclusive.</p>
        <div class="hydro-cat-grid" id="hydro-cat-grid">
          ${HYDROLOGY_CATEGORIES.map(
            (c) =>
              `<button type="button" class="hydro-cat-btn${activeHydroId === c.id ? " is-active" : ""}" data-hydro="${c.id}">${c.name}</button>`,
          ).join("")}
        </div>
        <div id="hydro-status" class="hydro-status" hidden></div>
      </div>`;

    body.querySelectorAll("[data-hydro]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.hydro;

        // Water Quality → floating icon HUD (no panel / no card)
        if (id === "water_quality") {
          openWaterQualityHud();
          return;
        }

        // Land Use → floating icon HUD
        if (id === "landuse") {
          openLandUseHud();
          return;
        }

        closeWaterQualityHud();
        closeLandUseHud();
        const status = body.querySelector("#hydro-status");
        status.hidden = false;
        status.textContent = "Loading…";
        body.querySelectorAll(".hydro-cat-btn").forEach((b) => {
          b.classList.toggle("is-active", b.dataset.hydro === id);
        });
        try {
          const result = await window.__MM_SCENE__?.showHydrologyLayer?.(id);
          if (!result) throw new Error("Hydrology layer manager not ready");
          activeHydroId = id;
          if (!result.available) {
            status.hidden = false;
            status.innerHTML = `
              <div class="hydro-unavail">
                <strong>${escapeHtml(result.message || "DATA UNAVAILABLE")}</strong>
                ${result.reason ? `<p>${escapeHtml(result.reason)}</p>` : ""}
              </div>`;
            clearHydroLegend();
            return;
          }
          status.hidden = true;
          renderHydroLegend(result);
          if (result.stats) {
            console.info("[hydrology]", id, result.stats);
            const v = window.__MM_SCENE__?.validateHydrologyExtent?.();
            if (v) console.info("[hydrology] extent check", v);
          }
        } catch (err) {
          status.hidden = false;
          status.innerHTML = `<div class="hydro-unavail"><strong>Unable to load layer</strong><p>${escapeHtml(err.message || String(err))}</p></div>`;
          clearHydroLegend();
        }
      });
    });
  }

  async function openForecast() {
    const reqId = ++forecastRequestId;
    modal.querySelector("#analytics-body").innerHTML =
      `<p class="analytics-status">Loading forecast…</p>`;
    try {
      const raw = await forecastProfile(forecastLead);
      if (reqId !== forecastRequestId || activeType !== "forecast") return;
      forecastCache = raw;
      renderForecastBody(raw, selectedMeters, forecastLead);
    } catch (error) {
      if (reqId !== forecastRequestId || activeType !== "forecast") return;
      forecastCache = null;
      modal.querySelector("#analytics-body").innerHTML = `
        <div class="forecast-panel">
          <p class="analytics-unavailable">Forecast service unavailable</p>
          <p class="analytics-note">Unable to retrieve model forecast.</p>
          <button type="button" class="forecast-retry" id="forecast-retry">Retry</button>
        </div>`;
      modal.querySelector("#forecast-retry")?.addEventListener("click", () => openForecast());
    }
  }

  function renderForecastBody(raw, meters, lead) {
    const data = downsampleProfile(raw, 160, meters);
    const station = metersToStation(meters);
    const body = modal.querySelector("#analytics-body");
    body.innerHTML = `
      <div class="forecast-panel">
        <p class="model-badge">LIVE FORECAST · P10–P90 uncertainty</p>
        <p class="forecast-subtitle">Water Level Forecast · Water Surface Elevation / Stage</p>
        <div class="forecast-horizons" role="group" aria-label="Forecast horizon">
          <span class="forecast-horizons-label">Forecast horizon</span>
          ${FORECAST_HORIZONS.map(
            (h) =>
              `<button type="button" class="forecast-horizon-btn${h === lead ? " is-active" : ""}" data-lead="${h}">${h}h</button>`,
          ).join("")}
        </div>
        <div class="forecast-meta">
          <span>Current chainage <strong>${escapeHtml(station)}</strong></span>
          <span>Lead <strong>+${lead} h</strong></span>
        </div>
        ${forecastChartSvg(data, meters)}
        <div class="forecast-legend">
          <span class="forecast-leg forecast-leg--p90">P90</span>
          <span class="forecast-leg forecast-leg--med">Forecast Median</span>
          <span class="forecast-leg forecast-leg--p10">P10</span>
        </div>
      </div>`;

    body.querySelectorAll("[data-lead]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const next = Number(btn.dataset.lead);
        if (!Number.isFinite(next) || next === forecastLead) return;
        forecastLead = next;
        await openForecast();
      });
    });
  }

  return el;
}

/** Remaining analytics still optional / external — Forecast no longer uses this. */
async function loadLegacyAnalytics(type, meters, dataset) {
  const profile = dataset?.chainage || [];
  const cell = nearestIndex(profile, meters);
  const base = typeof import.meta !== "undefined" && import.meta.env?.VITE_ANALYTICS_API_BASE
    ? String(import.meta.env.VITE_ANALYTICS_API_BASE).replace(/\/$/, "")
    : "";
  if (!base) {
    throw new Error("Modelled analytics service not configured");
  }
  if (type === "hydrograph") return fetchJson(`${base}/api/hydrograph?cell=${cell}`);
  if (type === "simulations") return fetchJson(`${base}/api/state`);
  const [margins, alerts] = await Promise.all([
    fetchJson(`${base}/api/margins`),
    fetchJson(`${base}/api/alerts`),
  ]);
  return { margins, alerts };
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error(`Analytics endpoint unavailable (${response.status})`);
  return response.json();
}

function legacyMarkup(type, data, meters) {
  if (type === "hydrograph") {
    return `<p class="model-badge">LIVE HYDROGRAPH</p>${svgChart(data.observed || [], "#7fb8d8", "Modelled history")}${svgChart(data.forecast?.median || [], "#8f78d8", "Modelled forecast")}`;
  }
  if (type === "simulations") {
    return `<p class="model-badge">LIVE DATA · SIMULATION STATE</p><p><b>Simulation time</b> ${data.q_now != null ? `${data.q_now} discharge units` : "Available"}</p><p><b>Water surface stations</b> ${data.wse?.length ?? 0}</p>`;
  }
  return `<p class="model-badge">LIVE FLOOD SCENARIO</p><p><b>Landmark margins</b> ${data.margins?.length ?? 0}</p><p><b>Active modelled alerts</b> ${data.alerts?.length ?? 0}</p><p><b>Selected chainage</b> ${Math.round(meters)} m</p>`;
}

function forecastChartSvg(data, selectedMeters) {
  const med = (data.median || []).map(Number);
  const p10 = (data.p10 || []).map(Number);
  const p90 = (data.p90 || []).map(Number);
  const ch = (data.chainage_m || []).map(Number);
  if (!med.length || med.length !== p10.length || med.length !== p90.length) {
    return `<p class="analytics-note">No forecast series available.</p>`;
  }

  const w = 520;
  const h = 200;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const all = [...med, ...p10, ...p90].filter(Number.isFinite);
  const minY = Math.min(...all);
  const maxY = Math.max(...all);
  const spanY = maxY - minY || 1;
  const minX = ch[0] ?? 0;
  const maxX = ch[ch.length - 1] ?? 1;
  const spanX = maxX - minX || 1;

  const toX = (meters) => padL + ((meters - minX) / spanX) * plotW;
  const toY = (v) => padT + plotH - ((v - minY) / spanY) * plotH;

  const poly = (arr) =>
    arr
      .map((v, i) => `${toX(ch[i]).toFixed(1)},${toY(v).toFixed(1)}`)
      .join(" ");

  // Uncertainty envelope (p90 top → p10 bottom reversed)
  const band = [
    ...p90.map((v, i) => `${toX(ch[i]).toFixed(1)},${toY(v).toFixed(1)}`),
    ...[...p10]
      .map((v, i) => ({ v, i }))
      .reverse()
      .map(({ v, i }) => `${toX(ch[i]).toFixed(1)},${toY(v).toFixed(1)}`),
  ].join(" ");

  let selX = null;
  let selY = null;
  let selLabel = "";
  if (Number.isFinite(selectedMeters) && ch.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < ch.length; i += 1) {
      const d = Math.abs(ch[i] - selectedMeters);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    selX = toX(ch[best]);
    selY = toY(med[best]);
    selLabel = metersToStation(ch[best]);
  }

  const yTicks = [minY, (minY + maxY) / 2, maxY];

  return `<div class="forecast-chart analytics-chart">
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Water surface elevation forecast along chainage">
      <text x="12" y="${padT + plotH / 2}" class="forecast-axis-label" transform="rotate(-90 12 ${padT + plotH / 2})">WSE (m)</text>
      ${yTicks
        .map((v) => {
          const y = toY(v);
          return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="rgba(120,200,220,0.1)" />
            <text x="${padL - 6}" y="${y + 3}" text-anchor="end" class="forecast-tick">${v.toFixed(2)}</text>`;
        })
        .join("")}
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="rgba(120,200,220,0.28)" />
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(120,200,220,0.28)" />
      <polygon points="${band}" fill="rgba(91,200,232,0.16)" stroke="none" />
      <polyline points="${poly(p90)}" fill="none" stroke="rgba(125,211,252,0.55)" stroke-width="1.2" stroke-dasharray="4 3" />
      <polyline points="${poly(p10)}" fill="none" stroke="rgba(125,211,252,0.55)" stroke-width="1.2" stroke-dasharray="4 3" />
      <polyline points="${poly(med)}" fill="none" stroke="#5bc8e8" stroke-width="2.4" stroke-linejoin="round" />
      ${
        selX != null
          ? `<line x1="${selX}" y1="${padT}" x2="${selX}" y2="${padT + plotH}" stroke="rgba(245,158,11,0.7)" stroke-width="1.5" stroke-dasharray="3 3" />
             <circle cx="${selX}" cy="${selY}" r="5" fill="#f59e0b" stroke="#eaf8fb" stroke-width="1.5" />
             <text x="${selX}" y="${padT + 12}" text-anchor="middle" class="forecast-sel-label">${escapeHtml(selLabel)}</text>`
          : ""
      }
      <text x="${padL}" y="${h - 6}" class="forecast-tick">${formatCh(minX)}</text>
      <text x="${padL + plotW}" y="${h - 6}" text-anchor="end" class="forecast-tick">${formatCh(maxX)}</text>
      <text x="${padL + plotW / 2}" y="${h - 6}" text-anchor="middle" class="forecast-axis-label">Chainage</text>
    </svg>
  </div>`;
}

function formatCh(meters) {
  if (!Number.isFinite(meters)) return "—";
  return metersToStation(meters);
}

function svgChart(values, color, label) {
  if (!values.length) return `<p class="analytics-note">No series available.</p>`;
  const nums = values.map(Number).filter(Number.isFinite);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const points = nums
    .map((value, i) => `${(i / Math.max(1, nums.length - 1)) * 320},${84 - ((value - min) / span) * 68}`)
    .join(" ");
  return `<div class="analytics-chart"><svg viewBox="0 0 320 92" role="img" aria-label="${label}"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" /></svg><small>${label}</small></div>`;
}

function nearestIndex(points, meters) {
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const d = Math.abs((points[i].meters ?? 0) - meters);
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best;
}

/**
 * Resolve live AQI query point from the selected chainage (true lat/lon).
 * Prefers interpolated KML lon/lat; falls back to local→WGS84.
 */
function resolveAqiPoint(dataset, meters) {
  const m = Number(meters);
  const points = Array.isArray(dataset?.chainage) ? dataset.chainage : [];
  const station = Number.isFinite(m) && points.length ? interpolateChainage(points, m) : null;

  let lat = Number(station?.lat);
  let lon = Number(station?.lon);

  if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && station) {
    const x = Number(station.x);
    const z = Number(station.z);
    if (Number.isFinite(x) && Number.isFinite(z)) {
      try {
        const ll = localToLonLat(x, z);
        lat = Number(ll?.lat);
        lon = Number(ll?.lon);
      } catch {
        /* geo ref not ready */
      }
    }
  }

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const stationLabel =
      station?.label || (Number.isFinite(m) ? metersToStation(m) : null);
    return {
      lat,
      lon,
      meters: Number.isFinite(m) ? m : station?.meters ?? null,
      station: stationLabel,
      label: stationLabel ? `Chainage ${stationLabel}` : "Selected chainage",
    };
  }

  const origin = dataset?.origin || dataset?.geoOrigin || null;
  const oLat = Number(origin?.lat ?? origin?.latitude);
  const oLon = Number(origin?.lon ?? origin?.longitude);
  if (Number.isFinite(oLat) && Number.isFinite(oLon)) {
    return { lat: oLat, lon: oLon, label: "Mula–Mutha AOI", station: null, meters: null };
  }
  return { ...AQI_FALLBACK_LL, label: "Mula–Mutha", station: null, meters: null };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]),
  );
}
