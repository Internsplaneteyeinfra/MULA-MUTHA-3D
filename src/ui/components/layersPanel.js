import {
  Waves,
  Grid3x3,
  Landmark,
  Layers3,
  Layers,
  Trees,
  X,
  ChevronDown,
  CloudRain,
} from "lucide";
import { lucideHtml } from "../icons.js";
import {
  layerRowHtml,
  bindAllLayerIndicators,
} from "./layerToggle.js";

/** User-facing layer checkbox IDs (no urban / fish / bridges / debug). */
const LAYER_IDS = [
  "water",
  "map-ref-grid",
  "br-names",
  "veg",
  "depth-zones",
  "flood-sim",
  "chain",
];

function sectionHtml(id, title, body, { open = true } = {}) {
  return `
    <details class="lp-section" id="${id}" ${open ? "open" : ""}>
      <summary class="lp-section-head">
        <span class="lp-section-chevron">${lucideHtml(ChevronDown, { size: 14 })}</span>
        <span class="lp-section-title">${title}</span>
      </summary>
      <div class="lp-section-body">${body}</div>
    </details>`;
}

export function mountLayersPanel(root) {
  const panel = document.createElement("section");
  panel.className = "hud layers-panel lp-panel";
  panel.id = "layers-panel";
  panel.innerHTML = `
    <header class="layers-panel-header lp-header">
      <div class="lp-header-title">
        ${lucideHtml(Layers, { size: 16 })}
        <strong>LAYERS</strong>
      </div>
      <button type="button" class="layers-close lp-close" id="layers-close" aria-label="Close layers panel">
        ${lucideHtml(X, { size: 16 })}
      </button>
    </header>
    <div class="layers-panel-body lp-body">
      ${sectionHtml(
        "lp-sec-base",
        "Base Layers",
        `
        ${layerRowHtml({ icon: Waves, label: "River", id: "water", checked: true })}
        ${layerRowHtml({ icon: Grid3x3, label: "Map Reference Grid", id: "map-ref-grid", hint: "KML + coordinates" })}
        ${layerRowHtml({ icon: Landmark, label: "Bridge Names", id: "br-names" })}
        ${layerRowHtml({
          icon: Trees,
          label: "Vegetation",
          id: "veg",
          checked: true,
          hint: "always on · dense cover",
        })}
      `,
      )}

      ${sectionHtml(
        "lp-sec-depth",
        "Depth Zones",
        `
        <div class="depth-zones-section" id="depth-zones-section">
          ${layerRowHtml({ icon: Layers3, label: "Show Depth Zones", id: "depth-zones" })}
          <div class="layers-stats depth lp-stats" id="depth-zones-stats"></div>
        </div>
      `,
      )}

      ${sectionHtml(
        "lp-sec-flood",
        "Flood Controls",
        `
        <div class="lp-flood-data" id="lp-flood-data">
          <div class="lp-flood-data__title">API FLOOD SIMULATION</div>
          <p class="lp-hint-text">Flood extent generated from JalNetra Flood API results.</p>
          <div class="lp-flood-status" id="lp-flood-status" aria-live="polite">
            <span class="lp-flood-status-dot" data-kind=""></span>
            <span class="lp-flood-status-text">Status · Idle</span>
          </div>
          ${layerRowHtml({
            icon: CloudRain,
            label: "Show API Flood",
            id: "flood-sim",
            checked: true,
            hint: "JalNetra extent",
          })}
          <div class="layers-stats lp-stats" id="flood-sim-stats"></div>
        </div>

        <div class="lp-illustrative-stage" id="lp-illustrative-stage">
          <div class="lp-flood-data__title">ILLUSTRATIVE WATER STAGE</div>
          <div class="lp-slider">
            <span class="lp-slider-label">Flood Stage <span id="flood-label" class="ctrl-value">+0.0 m</span></span>
            <input id="flood" type="range" min="0" max="4000" step="5" value="0" aria-label="Illustrative water stage" />
          </div>
          <p class="lp-hint-text lp-disclaimer-warn">
            ⚠ Elevation-based visualization. Not a hydrodynamic flood model.
          </p>
        </div>
      `,
      )}

    </div>
  `;
  root.appendChild(panel);
  bindAllLayerIndicators(root, LAYER_IDS);

  return { panel, layerIds: LAYER_IDS };
}
