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
        <strong>PLANET EYE AI · RIVER.EYE</strong>
        <small>Mula–Mutha River · EPSG:32643</small>
      </div>
      <button type="button" id="return-cinematic-btn" class="hud-cinematic-badge" style="margin-left: 8px; background: rgba(56, 189, 248, 0.18); border: 1px solid rgba(56, 189, 248, 0.45); border-radius: 14px; padding: 4px 10px; font-size: 11px; font-weight: 700; color: #38bdf8; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s;" title="Return to 3D Cinematic Landing Page">▶ 3D Cinematic</button>
    </div>
  `;
  root.appendChild(el);

  const cinematicBtn = el.querySelector("#return-cinematic-btn");
  if (cinematicBtn) {
    cinematicBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("open-cinematic-landing"));
    });
  }
  return el;
}
