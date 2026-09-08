import {
  CloudSun,
  Sun,
  X,
  ChevronDown,
  Sparkles,
  Clapperboard,
  BarChart3,
  MapPin,
  ListOrdered,
  Route,
  Ruler,
  RotateCcw,
  Waves,
} from "lucide";
import { lucideHtml } from "../icons.js";
import {
  layerRowHtml,
  modeRowHtml,
  bindAllLayerIndicators,
  bindRadioRowIndicators,
} from "./layerToggle.js";

export function mountSettingsPanel(root) {
  const panel = document.createElement("section");
  panel.className = "hud layers-panel lp-panel settings-panel";
  panel.id = "settings-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <header class="layers-panel-header lp-header">
      <div class="lp-header-title">
        ${lucideHtml(Sun, { size: 16 })}
        <strong>SETTINGS</strong>
      </div>
      <button type="button" class="layers-close lp-close" id="settings-close" aria-label="Close settings panel">
        ${lucideHtml(X, { size: 16 })}
      </button>
    </header>
    <div class="layers-panel-body lp-body">
      <details class="lp-section" id="settings-sec-sky">
        <summary class="lp-section-head">
          <span class="lp-section-chevron">${lucideHtml(ChevronDown, { size: 14 })}</span>
          <span class="lp-section-title">Sky & Atmosphere</span>
        </summary>
        <div class="lp-section-body">
          <div class="toolkit sky-controls-block" id="sky-toolkit">
            ${layerRowHtml({ icon: CloudSun, label: "Enable Animated Sky", id: "sky-enabled", checked: true, hint: "Overview cinematic sky" })}
            <div class="lp-select-wrap">
              <span class="lp-slider-label">Sky Preset</span>
              <div class="lp-select">
                ${lucideHtml(Sun, { size: 14 })}
                <select id="sky-preset" aria-label="Sky Preset">
                  <option value="calmRealistic" selected>Calm Realistic</option>
                  <option value="clearBlueDay">Clear Blue Day</option>
                  <option value="cinematicClouds">Cinematic Clouds</option>
                  <option value="floodWeather">Flood Weather</option>
                  <option value="goldenHour">Golden Hour</option>
                </select>
                ${lucideHtml(ChevronDown, { size: 14, className: "lp-icon lp-select-chevron" })}
              </div>
            </div>
            <div class="lp-slider"><span class="lp-slider-label">Cloud Density</span><input id="sky-cloud-density" type="range" min="0" max="100" value="42" aria-label="Cloud Density" /></div>
            <div class="lp-slider"><span class="lp-slider-label">Cloud Movement <em class="lp-hint">very slow</em></span><input id="sky-cloud-speed" type="range" min="8" max="70" value="32" aria-label="Cloud Movement Speed" /></div>
            <div class="lp-slider"><span class="lp-slider-label">Sun Intensity</span><input id="sky-sun" type="range" min="40" max="160" value="100" aria-label="Sun Intensity" /></div>
            <div class="lp-slider"><span class="lp-slider-label">Atmosphere</span><input id="sky-atmosphere" type="range" min="10" max="100" value="55" aria-label="Atmosphere Intensity" /></div>
            <div class="lp-slider"><span class="lp-slider-label">Horizon Haze</span><input id="sky-haze" type="range" min="0" max="100" value="48" aria-label="Horizon Haze" /></div>
            ${layerRowHtml({ icon: CloudSun, label: "Cloud Shadows", id: "sky-shadows", checked: true, hint: "high quality only" })}
            <div class="exag-row compact lp-chip-row">Sky Quality
              <button type="button" data-sky-q="low">Low</button>
              <button type="button" data-sky-q="medium">Med</button>
              <button type="button" data-sky-q="high" class="active">High</button>
            </div>
            <p class="layers-hint lp-hint-text">Daylight cinematic sky · hidden in 2D mode</p>
          </div>
        </div>
      </details>
      <details class="lp-section" id="settings-sec-glassy">
        <summary class="lp-section-head">
          <span class="lp-section-chevron">${lucideHtml(ChevronDown, { size: 14 })}</span>
          <span class="lp-section-title">Glassy Water</span>
        </summary>
        <div class="lp-section-body">
          <div class="toolkit glassy-toolkit" id="glassy-toolkit" hidden>
            ${layerRowHtml({ icon: Sparkles, label: "Animated Flow", id: "glassy-flow", checked: true })}
            <div class="mode-pair lp-mode-pair">
              ${modeRowHtml({ icon: Clapperboard, label: "Cinematic", id: "glassy-mode-cine", name: "glassy-mode", value: "cinematic", checked: true })}
              ${modeRowHtml({ icon: BarChart3, label: "Data", id: "glassy-mode-data", name: "glassy-mode", value: "data" })}
            </div>
            <div class="lp-slider"><span class="lp-slider-label">Glass Opacity</span><input id="glassy-opacity" type="range" min="20" max="95" value="72" /></div>
            <div class="lp-slider"><span class="lp-slider-label">Flow Speed</span><input id="glassy-speed" type="range" min="5" max="120" value="45" /></div>
            <p class="layers-hint lp-hint-text">Click a polygon to inspect</p>
          </div>
        </div>
      </details>
      <details class="lp-section" id="settings-sec-chain">
        <summary class="lp-section-head">
          <span class="lp-section-chevron">${lucideHtml(ChevronDown, { size: 14 })}</span>
          <span class="lp-section-title">Chainage</span>
        </summary>
        <div class="lp-section-body">
          <div class="toolkit" id="chainage-toolkit">
            ${layerRowHtml({ icon: MapPin, label: "Markers", id: "chain", checked: true })}
            ${layerRowHtml({ icon: ListOrdered, label: "Show All Numbers", id: "chain-labels" })}
            <div class="mode-pair lp-mode-pair">
              ${modeRowHtml({ icon: Route, label: "Station", id: "chain-mode-station", name: "chain-mode", value: "station", checked: true })}
              ${modeRowHtml({ icon: Ruler, label: "Meters", id: "chain-mode-meters", name: "chain-mode", value: "meters" })}
            </div>
            <p class="layers-hint lp-hint-text">Click a pin · hover for details</p>
          </div>
        </div>
      </details>
      <details class="lp-section" id="settings-sec-advanced">
        <summary class="lp-section-head">
          <span class="lp-section-chevron">${lucideHtml(ChevronDown, { size: 14 })}</span>
          <span class="lp-section-title">Advanced</span>
        </summary>
        <div class="lp-section-body layers-advanced-body" id="layers-advanced-body">
          <div class="lp-slider"><span class="lp-slider-label">Opacity</span><input id="opacity" type="range" min="15" max="95" value="90" /></div>
          <div class="lp-slider"><span class="lp-slider-label">Flow visibility</span><input id="flowvis" type="range" min="0" max="100" value="55" /></div>
          <div class="exag-row compact lp-chip-row">Z Exag
            <button type="button" data-exag="1">1×</button><button type="button" data-exag="2" class="active">2×</button><button type="button" data-exag="5">5×</button>
          </div>
          <div class="lp-slider"><span class="lp-slider-label">Overall speed</span><input id="water-overall" type="range" min="15" max="100" value="55" /></div>
          <div class="lp-slider"><span class="lp-slider-label">Primary waves</span><input id="water-primary-amp" type="range" min="2" max="30" value="14" /></div>
          <div class="lp-slider"><span class="lp-slider-label">Ripples</span><input id="water-ripple" type="range" min="0" max="12" value="4" /></div>
          <div class="exag-row compact lp-chip-row">Quality
            <button type="button" data-wq="low">Low</button><button type="button" data-wq="medium">Med</button><button type="button" data-wq="high" class="active">High</button>
          </div>
          <button type="button" class="lp-action" id="layer-reset">${lucideHtml(RotateCcw, { size: 14 })}<span>Reset view</span></button>
          <button type="button" class="lp-action" id="layer-bath-cam">${lucideHtml(Waves, { size: 14 })}<span>Bathymetry view</span></button>
          <button type="button" class="lp-action" id="layer-glass-demo">${lucideHtml(Sparkles, { size: 14 })}<span>Glassy water tour</span></button>
          <button type="button" class="lp-action" id="layer-river-cinematic">${lucideHtml(Clapperboard, { size: 14 })}<span>River cinematic tour</span></button>
        </div>
      </details>
    </div>
  `;
  root.appendChild(panel);
  bindAllLayerIndicators(root, ["chain", "chain-labels", "glassy-flow"]);
  bindRadioRowIndicators(root, "glassy-mode");
  bindRadioRowIndicators(root, "chain-mode");
  root.querySelector("#depth-zones")?.addEventListener("change", (event) => {
    const toolkit = root.querySelector("#glassy-toolkit");
    if (toolkit) toolkit.hidden = !event.target.checked;
  });
  root.querySelector("#layer-glass-demo")?.addEventListener("click", () => {
    window.__MM_SCENE__?.startGlassyTour?.();
  });
  return { panel };
}
