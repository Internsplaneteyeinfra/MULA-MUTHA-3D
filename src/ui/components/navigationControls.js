import { MapPinned, Map, Layers, CloudRain, Settings, Droplets } from "lucide";
import { state } from "../../state.js";
import { lucideHtml } from "../icons.js";

/**
 * Right-side view modes: Overview · 2D/3D · Drainage · Layers · Settings · Flood.
 * Keeps the same callbacks / camera modes as before.
 */
export function mountNavigationControls(root, {
  onOverview,
  onRiverSide,
  onLayersToggle,
  onDrainageToggle,
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
  modes.className = "gis-view-modes";
  modes.setAttribute("aria-label", "Map view controls");
  modes.innerHTML = `
    <button type="button" class="map-ctrl-btn map-ctrl-btn--labeled" id="nav-overview" data-mode="overview" aria-label="Overview">
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
    <button type="button" class="map-ctrl-btn map-ctrl-btn--icon drainage-toggle-button" id="drainage-btn" aria-label="Drainage" aria-pressed="false" title="Toggle drainage channels">
      <span class="map-ctrl-icon" aria-hidden="true">${lucideHtml(Droplets, { size: 20, className: "map-ctrl-svg" })}</span>
    </button>
    <button type="button" class="map-ctrl-btn map-ctrl-btn--labeled layers-toggle-button" id="layers-btn" aria-label="Layers" aria-pressed="false">
      <span class="map-ctrl-icon" aria-hidden="true">${lucideHtml(Layers, { size: 20, className: "map-ctrl-svg" })}</span>
      <span class="map-ctrl-label">Layers</span>
    </button>
    <button type="button" class="map-ctrl-btn map-ctrl-btn--labeled settings-toggle-button" id="settings-btn" aria-label="Settings" aria-pressed="false">
      <span class="map-ctrl-icon" aria-hidden="true">${lucideHtml(Settings, { size: 20, className: "map-ctrl-svg" })}</span>
      <span class="map-ctrl-label">Settings</span>
    </button>
    <button type="button" class="map-ctrl-btn map-ctrl-btn--labeled flood-toggle-button" id="flood-btn" aria-label="Flood" aria-pressed="false">
      <span class="map-ctrl-icon" aria-hidden="true">${lucideHtml(CloudRain, { size: 20, className: "map-ctrl-svg" })}</span>
      <span class="map-ctrl-label">Flood</span>
    </button>
  `;
  stack.appendChild(modes);

  const overviewBtn = modes.querySelector("#nav-overview");
  const view2dBtn = modes.querySelector("#nav-2d");
  const view3dBtn = modes.querySelector("#nav-3d");
  const drainageBtn = modes.querySelector("#drainage-btn");
  const layersBtn = modes.querySelector("#layers-btn");
  const settingsBtn = modes.querySelector("#settings-btn");
  const floodBtn = modes.querySelector("#flood-btn");

  overviewBtn.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onOverview?.();
    syncActive();
  });
  view2dBtn.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onRiverSide?.();
    syncActive();
  });
  view3dBtn.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onOverview?.();
    syncActive();
  });
  layersBtn.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onLayersToggle?.();
  });
  drainageBtn.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onDrainageToggle?.();
  });
  settingsBtn.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onSettingsToggle?.();
  });
  floodBtn.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onFloodToggle?.();
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

  function setDrainagePressed(on) {
    drainageBtn.setAttribute("aria-pressed", on ? "true" : "false");
    drainageBtn.classList.toggle("active", !!on);
  }

  function setFloodPressed(open) {
    floodBtn.setAttribute("aria-pressed", open ? "true" : "false");
    floodBtn.classList.toggle("active", !!open);
  }

  syncActive();
  return { wrap: modes, syncActive, setLayersPressed, setSettingsPressed, setDrainagePressed, setFloodPressed };
}
