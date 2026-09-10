import { Plus, Minus } from "lucide";
import { lucideHtml } from "../icons.js";

/**
 * Zoom in / out — top of the right-side map control stack.
 */
export function mountZoomControls(root, { onZoomIn, onZoomOut }) {
  const el = document.createElement("div");
  el.className = "zoom-controls";
  el.setAttribute("aria-label", "Zoom");
  el.innerHTML = `
    <button type="button" class="map-ctrl-btn map-ctrl-btn--icon toolbar-button zoom-btn" id="zoom-in" title="Zoom in" aria-label="Zoom in">
      ${lucideHtml(Plus, { size: 20, className: "map-ctrl-svg" })}
    </button>
    <button type="button" class="map-ctrl-btn map-ctrl-btn--icon toolbar-button zoom-btn" id="zoom-out" title="Zoom out" aria-label="Zoom out">
      ${lucideHtml(Minus, { size: 20, className: "map-ctrl-svg" })}
    </button>
  `;

  let stack = root.querySelector(".gis-tools-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "gis-tools-stack";
    root.appendChild(stack);
  }

  // After compass, before Overview / 2D / Layers
  const modes = stack.querySelector(".gis-view-modes");
  if (modes) {
    stack.insertBefore(el, modes);
  } else {
    stack.appendChild(el);
  }

  el.querySelector("#zoom-in").addEventListener("click", () => onZoomIn?.());
  el.querySelector("#zoom-out").addEventListener("click", () => onZoomOut?.());
  return el;
}
