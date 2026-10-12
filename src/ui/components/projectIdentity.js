import { Eye } from "lucide";
import { lucideHtml } from "../icons.js";

export function mountProjectIdentity(root) {
  const el = document.createElement("aside");
  el.className = "hud gis-brand gis-brand--compact map-chrome";
  el.id = "hud-brand";
  el.title = "PLANET EYE AI · Mula–Mutha River Intelligence Platform · 3D Terrain + River · Chainage Analysis · EPSG:32643";
  el.innerHTML = `
    <div class="gis-brand-mark">
      <span class="planet-eye-logo" aria-label="Planet Eye logo">${lucideHtml(Eye, { size: 16 })}</span>
      <div class="gis-brand-text">
        <strong>PLANET EYE AI</strong>
        <small>Mula–Mutha River · EPSG:32643</small>
      </div>
    </div>
  `;
  root.appendChild(el);
  return el;
}
