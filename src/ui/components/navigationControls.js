import { MapPinned, Layers, CloudRain, Settings, Ruler } from "lucide";
import { state } from "../../state.js";
import { lucideHtml } from "../icons.js";

/**
 * Right-side view modes: Overview · 2D/3D · Silt Measure · Layers · Settings · Flood.
 * Drainage toggle lives in Layers / Geology — not on this toolbar.
 */
export function mountNavigationControls(root, {
  onOverview,
  onRiverSide,
  on3D,
  onSiltToggle,
  onLayersToggle,
  onSettingsToggle,
  onFloodToggle,
}) {
  let stack = root.querySelector(".gis-tools-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "gis-tools-stack";
    root.appendChild(stack);
  }

  const modes = document.createElement("div");
  modes.className = "gis-view-modes right-toolbar";
  modes.setAttribute("aria-label", "Map view controls");
  modes.innerHTML = `
    <button type="button" class="map-ctrl-btn map-ctrl-btn--labeled toolbar-button" id="nav-overview" data-mode="overview" aria-label="Overview">
      <span class="map-ctrl-icon" aria-hidden="true">${lucideHtml(MapPinned, { size: 20, className: "map-ctrl-svg" })}</span>
      <span class="map-ctrl-label">Overview</span>
    </button>
    <div class="view-toggle" role="group" aria-label="View mode">
      <span class="view-toggle-title">VIEW</span>
      <div class="view-toggle-segment">
        <button type="button" class="view-toggle-btn" id="nav-2d" data-mode="aerial" aria-label="2D map view">2D</button>
        <button type="button" class="view-toggle-btn" id="nav-3d" data-mode="overview" aria-label="3D perspective view">3D</button>
      </div>
    </div>
    <button type="button" class="map-ctrl-btn map-ctrl-btn--labeled toolbar-button silt-toggle-button" id="silt-btn" aria-label="Silt Analysis" aria-pressed="false">
      <span class="map-ctrl-icon" aria-hidden="true">${lucideHtml(Ruler, { size: 20, className: "map-ctrl-svg" })}</span>
      <span class="map-ctrl-label">Silt</span>
    </button>
    <button type="button" class="map-ctrl-btn map-ctrl-btn--labeled toolbar-button layers-toggle-button" id="layers-btn" aria-label="Layers" aria-pressed="false">
      <span class="map-ctrl-icon" aria-hidden="true">${lucideHtml(Layers, { size: 20, className: "map-ctrl-svg" })}</span>
      <span class="map-ctrl-label">Layers</span>
    </button>
    <button type="button" class="map-ctrl-btn map-ctrl-btn--labeled toolbar-button settings-toggle-button" id="settings-btn" aria-label="Settings" aria-pressed="false">
      <span class="map-ctrl-icon" aria-hidden="true">${lucideHtml(Settings, { size: 20, className: "map-ctrl-svg" })}</span>
      <span class="map-ctrl-label">Settings</span>
    </button>
    <button type="button" class="map-ctrl-btn map-ctrl-btn--labeled toolbar-button flood-toggle-button" id="flood-btn" aria-label="Flood" aria-pressed="false">
      <span class="map-ctrl-icon" aria-hidden="true">${lucideHtml(CloudRain, { size: 20, className: "map-ctrl-svg" })}</span>
      <span class="map-ctrl-label">Flood</span>
    </button>
  `;
  stack.appendChild(modes);

  const overviewBtn = modes.querySelector("#nav-overview");
  const view2dBtn = modes.querySelector("#nav-2d");
  const view3dBtn = modes.querySelector("#nav-3d");
  const siltBtn = modes.querySelector("#silt-btn");
  const layersBtn = modes.querySelector("#layers-btn");
  const settingsBtn = modes.querySelector("#settings-btn");
  const floodBtn = modes.querySelector("#flood-btn");

  const clearRiverMeasure = () => {
    document.dispatchEvent(new CustomEvent("river-measure-clear"));
  };

  const runNav = (fn) => {
    if (state.cinematicActive) window.__MM_SCENE__?.stopCinematic?.();
    fn();
  };

  overviewBtn.addEventListener("click", () => {
    runNav(() => {
      clearRiverMeasure();
      onOverview?.();
      syncActive();
    });
  });
  view2dBtn.addEventListener("click", () => {
    runNav(() => {
      clearRiverMeasure();
      onRiverSide?.();
      syncActive();
    });
  });
  view3dBtn.addEventListener("click", () => {
    runNav(() => {
      clearRiverMeasure();
      if (on3D) on3D();
      else onOverview?.();
      syncActive();
    });
  });
  siltBtn.addEventListener("click", () => {
    runNav(() => onSiltToggle?.());
  });
  layersBtn.addEventListener("click", () => {
    runNav(() => {
      clearRiverMeasure();
      onLayersToggle?.();
    });
  });
  settingsBtn.addEventListener("click", () => {
    runNav(() => {
      clearRiverMeasure();
      onSettingsToggle?.();
    });
  });
  floodBtn.addEventListener("click", () => {
    runNav(() => {
      clearRiverMeasure();
      onFloodToggle?.();
    });
  });

  document.addEventListener("silt-analysis-ui-open", () => {
    siltBtn.classList.add("active");
    siltBtn.setAttribute("aria-pressed", "true");
  });
  document.addEventListener("silt-analysis-ui-close", () => {
    siltBtn.classList.remove("active");
    siltBtn.setAttribute("aria-pressed", "false");
  });

  function syncActive() {
    overviewBtn.classList.toggle("active", state.cameraMode === "overview");
    const map2d =
      state.cameraMode === "aerial" ||
      state.cameraMode === "top" ||
      state.cameraMode === "2d";
    view2dBtn.classList.toggle("active", map2d);
    view3dBtn.classList.toggle("active", !map2d);
  }

  function setLayersPressed(open) {
    layersBtn.setAttribute("aria-pressed", open ? "true" : "false");
    layersBtn.classList.toggle("active", !!open);
  }

  function setSettingsPressed(open) {
    settingsBtn.setAttribute("aria-pressed", open ? "true" : "false");
    settingsBtn.classList.toggle("active", !!open);
  }

  function setDrainagePressed() {
    /* Drainage toolbar icon removed — Layers / Geology still control drainage. */
  }

  function setFloodPressed(open) {
    floodBtn.setAttribute("aria-pressed", open ? "true" : "false");
    floodBtn.classList.toggle("active", !!open);
  }

  syncActive();
  return { wrap: modes, syncActive, setLayersPressed, setSettingsPressed, setDrainagePressed, setFloodPressed };
}
