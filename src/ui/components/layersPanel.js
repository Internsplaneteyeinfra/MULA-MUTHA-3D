import { layerRowHtml, bindAllLayerIndicators } from "./layerToggle.js";

/** User-facing layer checkbox IDs (no urban / fish / bridges / debug). */
const LAYER_IDS = [
  "water",
  "drainage",
  "map-ref-grid",
  "depth-zones",
  "br-names",
  "chain",
];

export function mountLayersPanel(root) {
  const panel = document.createElement("section");
  panel.className = "hud layers-panel";
  panel.id = "layers-panel";
  panel.innerHTML = `
    <header class="layers-panel-header">
      <strong>LAYERS</strong>
      <button type="button" class="layers-close" id="layers-close" aria-label="Close layers panel">✕</button>
    </header>
    <div class="layers-panel-body">
      <div class="layers-group">
        ${layerRowHtml({ icon: "🌊", label: "River", id: "water", checked: true })}
        ${layerRowHtml({ icon: "💧", label: "Small channels (Nullahs)", id: "drainage", hint: "animated flow" })}
        <div class="layers-stats" id="drainage-stats"></div>
        ${layerRowHtml({
          icon: "▦",
          label: "Map Reference Grid",
          id: "map-ref-grid",
          hint: "KML + coordinates",
        })}
        ${layerRowHtml({ icon: "🏷️", label: "Bridge Names", id: "br-names" })}
      </div>

      <div class="depth-zones-section" id="depth-zones-section">
        <div class="section-head">
          <span class="section-head-title">💎 Depth Zones</span>
          <span class="section-head-sub">Jul 2026 · glassy</span>
        </div>
        ${layerRowHtml({ icon: "💎", label: "Show depth zones", id: "depth-zones" })}
        <div class="layers-stats depth" id="depth-zones-stats"></div>
        <div class="toolkit glassy-toolkit" id="glassy-toolkit" hidden>
          <div class="section-head tight">
            <span class="section-head-title">Glassy water</span>
          </div>
          ${layerRowHtml({ icon: "✨", label: "Animated flow", id: "glassy-flow", checked: true })}
          <div class="mode-pair">
            <label class="layer-row compact" for="glassy-mode-cine">
              <span class="layer-icon">🎬</span>
              <span class="layer-label">Cinematic</span>
              <span class="layer-indicator">🟧</span>
              <input id="glassy-mode-cine" type="radio" name="glassy-mode" value="cinematic" checked />
            </label>
            <label class="layer-row compact" for="glassy-mode-data">
              <span class="layer-icon">📊</span>
              <span class="layer-label">Data</span>
              <span class="layer-indicator">⬜</span>
              <input id="glassy-mode-data" type="radio" name="glassy-mode" value="data" />
            </label>
          </div>
          <div class="ctrl-row compact">Glass opacity
            <input id="glassy-opacity" type="range" min="20" max="95" value="72" />
          </div>
          <div class="ctrl-row compact">Flow speed
            <input id="glassy-speed" type="range" min="5" max="120" value="45" />
          </div>
          <p class="layers-hint">Click a polygon to inspect</p>
        </div>
      </div>

      <div class="toolkit" id="chainage-toolkit">
        <div class="section-head tight">
          <span class="section-head-title">Chainage</span>
        </div>
        ${layerRowHtml({ icon: "📍", label: "Markers", id: "chain", checked: true })}
        ${layerRowHtml({ icon: "🔢", label: "Show all numbers", id: "chain-labels" })}
        <div class="mode-pair">
          <label class="layer-row compact" for="chain-mode-station">
            <span class="layer-icon">📏</span>
            <span class="layer-label">Station</span>
            <span class="layer-indicator">🟧</span>
            <input id="chain-mode-station" type="radio" name="chain-mode" value="station" checked />
          </label>
          <label class="layer-row compact" for="chain-mode-meters">
            <span class="layer-icon">📐</span>
            <span class="layer-label">Meters</span>
            <span class="layer-indicator">⬜</span>
            <input id="chain-mode-meters" type="radio" name="chain-mode" value="meters" />
          </label>
        </div>
        <p class="layers-hint">Click a pin · hover for details</p>
      </div>

      <div class="toolkit water-controls-block">
        <div class="section-head tight">
          <span class="section-head-title">Water controls</span>
        </div>
        <div class="ctrl-row compact">Opacity
          <input id="opacity" type="range" min="15" max="95" value="72" />
        </div>
        <div class="ctrl-row compact">Flow speed
          <input id="flow" type="range" min="0" max="150" value="65" />
        </div>
        <div class="ctrl-row compact">Flow visibility
          <input id="flowvis" type="range" min="0" max="100" value="0" />
        </div>
        <div class="ctrl-row compact">Flood stage <span id="flood-label" class="ctrl-value">+0.0 m</span>
          <input id="flood" type="range" min="0" max="4000" step="5" value="0" />
        </div>
        <div class="exag-row compact">Z Exag
          <button type="button" data-exag="1">1×</button>
          <button type="button" data-exag="2" class="active">2×</button>
          <button type="button" data-exag="5">5×</button>
        </div>
      </div>

      <div class="layers-advanced">
        <button type="button" class="layers-advanced-btn" id="layers-advanced-toggle">▸ Advanced</button>
        <div class="layers-advanced-body" id="layers-advanced-body" hidden>
          <button type="button" class="nav-button" id="layer-reset">
            <span class="nav-icon">🔄</span><span>Reset view</span>
          </button>
          <button type="button" class="nav-button" id="layer-bath-cam">
            <span class="nav-icon">🌊</span><span>Bathymetry view</span>
          </button>
          <button type="button" class="nav-button" id="layer-glass-demo">
            <span class="nav-icon">💎</span><span>Glassy water tour</span>
          </button>
          <button type="button" class="nav-button" id="layer-river-cinematic">
            <span class="nav-icon">🎬</span><span>River cinematic tour</span>
          </button>
        </div>
      </div>
    </div>
  `;
  root.appendChild(panel);
  bindAllLayerIndicators(root, [...LAYER_IDS, "chain-labels", "glassy-flow"]);

  panel.querySelector("#layer-glass-demo")?.addEventListener("click", () => {
    window.__MM_SCENE__?.startGlassyTour?.();
  });

  panel.querySelector("#layers-advanced-toggle")?.addEventListener("click", () => {
    const body = panel.querySelector("#layers-advanced-body");
    const btn = panel.querySelector("#layers-advanced-toggle");
    const open = body?.hidden;
    if (body) body.hidden = !open;
    if (btn) btn.textContent = open ? "▾ Advanced" : "▸ Advanced";
  });

  return { panel, layerIds: LAYER_IDS };
}
