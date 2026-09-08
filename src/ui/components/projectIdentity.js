import { Eye } from "lucide";
import { lucideHtml } from "../icons.js";

export function mountProjectIdentity(root) {
  const el = document.createElement("aside");
  el.className = "hud gis-brand map-chrome";
  el.id = "hud-brand";
  el.innerHTML = `
    <div class="gis-brand-mark">
      <span class="planet-eye-logo" aria-label="Planet Eye logo">${lucideHtml(Eye, { size: 24 })}</span>
      <div><strong>PLANET EYE AI</strong><b>MULA–MUTHA RIVER</b></div>
    </div>
    <p>River Intelligence Platform</p>
    <small>3D Terrain + River · Chainage Analysis · EPSG:32643</small>
  `;
  root.appendChild(el);
  return el;
}
