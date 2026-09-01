import { state } from "../state.js";
import { computeProjectionMetrics } from "../geo/projectionMetrics.js";
import { computeActiveSceneBounds } from "../geo/sceneBounds.js";

/**
 * Permanent projection validation — visible by default with real ERROR METERS.
 */
export function mountValidationHud(root, dataset) {
  const el = document.createElement("aside");
  el.className = "hud validate-panel";
  el.id = "validate-panel";
  root.appendChild(el);

  function render() {
    const metrics = computeProjectionMetrics(dataset);
    dataset.validation = dataset.validation || {};
    dataset.validation.projectionValidation = metrics;
    state.validationStats = metrics;
    el.innerHTML = `
      <strong>PROJECTION VALIDATION</strong>
      <div class="validate-rows">${metrics.rows.map(renderRow).join("")}</div>
      <em class="validate-note">KML master · WGS84 → EPSG:32643 → ENU · geoReference.js</em>
    `;
  }

  render();

  return {
    el,
    refresh: render,
    setVisible(v) {
      el.hidden = !v;
      el.style.display = v ? "block" : "none";
    },
  };
}

/** Recompute after fishing zones or other late-loaded layers arrive. */
export function refreshProjectionValidation(dataset, hud) {
  if (dataset.fishingZones?.length) {
    dataset.activeSceneBounds = computeActiveSceneBounds(dataset);
  }
  hud?.refresh?.();
}

function renderRow({ label, level, icon, errStr }) {
  return `<div class="validate-row ${level}">
    <span class="validate-icon">${icon}</span>
    <span class="validate-label">${label}</span>
    <span class="validate-detail">${errStr}</span>
  </div>`;
}
