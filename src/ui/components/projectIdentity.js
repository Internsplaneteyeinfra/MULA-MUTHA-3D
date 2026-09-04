export function mountProjectIdentity(root) {
  const el = document.createElement("aside");
  el.className = "hud gis-brand";
  el.id = "hud-brand";
  el.innerHTML = `
    <strong>MULA–MUTHA</strong>
    <p>3D Terrain + River · Chainage Analysis KML · EPSG:32643</p>
  `;
  root.appendChild(el);
  return el;
}
