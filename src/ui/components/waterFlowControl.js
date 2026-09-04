export function mountWaterFlowControl(root) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "hud gis-flow-cta";
  btn.id = "start-flow";
  btn.textContent = "💧 START WATER FLOW";
  root.appendChild(btn);
  return btn;
}
