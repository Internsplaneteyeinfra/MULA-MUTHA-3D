/** Large, clear CTA for non-technical users — drainage water on/off. */
export function mountDrainageFlowControl(root) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "hud gis-flow-cta gis-drainage-cta";
  btn.id = "drainage-flow-cta";
  btn.innerHTML = `<span class="cta-icon">💧</span><span class="cta-text">SHOW DRAINAGE FLOW</span>`;
  root.appendChild(btn);
  return btn;
}

export function syncDrainageFlowButton(btn, active) {
  if (!btn) return;
  const text = btn.querySelector(".cta-text");
  if (active) {
    btn.classList.add("active");
    if (text) text.textContent = "WATER FLOWING";
    else btn.textContent = "💧 WATER FLOWING";
  } else {
    btn.classList.remove("active");
    if (text) text.textContent = "SHOW DRAINAGE FLOW";
    else btn.innerHTML = `<span class="cta-icon">💧</span><span class="cta-text">SHOW DRAINAGE FLOW</span>`;
  }
  const label = document.getElementById("drainage-flow-label");
  if (label) label.textContent = active ? "WATER FLOWING — TAP TO STOP" : "SHOW DRAINAGE FLOW";
  const panelBtn = document.getElementById("drainage-flow-toggle");
  if (panelBtn) panelBtn.classList.toggle("active", !!active);
}
