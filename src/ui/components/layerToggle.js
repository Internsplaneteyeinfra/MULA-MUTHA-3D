/** Single layer row with emoji icon + orange active indicator. */
export function layerRowHtml({ icon, label, id, checked = false, hint = "" }) {
  const hintHtml = hint ? `<em>${hint}</em>` : "";
  return `
    <label class="layer-row" for="${id}">
      <span class="layer-icon">${icon}</span>
      <span class="layer-label">${label}${hintHtml}</span>
      <span class="layer-indicator" aria-hidden="true"></span>
      <input id="${id}" type="checkbox"${checked ? " checked" : ""} />
    </label>`;
}

export function bindLayerIndicator(root, id) {
  const input = root.querySelector(`#${id}`);
  if (!input) return;
  const row = input.closest(".layer-row");
  const indicator = row?.querySelector(".layer-indicator");
  const sync = () => {
    const on = !!input.checked;
    if (indicator) indicator.textContent = on ? "🟧" : "⬜";
    row?.classList.toggle("is-on", on);
  };
  input.addEventListener("change", sync);
  sync();
}

export function bindAllLayerIndicators(root, ids) {
  for (const id of ids) bindLayerIndicator(root, id);
}
