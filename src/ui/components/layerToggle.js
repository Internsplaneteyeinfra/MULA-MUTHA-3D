import { lucideHtml } from "../icons.js";

/** Professional layer row: icon | label | switch */
export function layerRowHtml({ icon, label, id, checked = false, hint = "" }) {
  const iconHtml = typeof icon === "string" ? icon : lucideHtml(icon, { size: 16 });
  const hintHtml = hint ? `<em class="lp-hint">${hint}</em>` : "";
  return `
    <label class="lp-row" for="${id}">
      <span class="lp-row-icon">${iconHtml}</span>
      <span class="lp-row-label">${label}${hintHtml}</span>
      <span class="lp-switch" aria-hidden="true"></span>
      <input id="${id}" type="checkbox"${checked ? " checked" : ""} />
    </label>`;
}

/** Radio option styled like a layer row (mode pickers). */
export function modeRowHtml({ icon, label, id, name, value, checked = false }) {
  const iconHtml = typeof icon === "string" ? icon : lucideHtml(icon, { size: 16 });
  return `
    <label class="lp-row lp-row--radio" for="${id}">
      <span class="lp-row-icon">${iconHtml}</span>
      <span class="lp-row-label">${label}</span>
      <span class="lp-radio" aria-hidden="true"></span>
      <input id="${id}" type="radio" name="${name}" value="${value}"${checked ? " checked" : ""} />
    </label>`;
}

export function bindLayerIndicator(root, id) {
  const input = root.querySelector(`#${id}`);
  if (!input) return;
  const row = input.closest(".lp-row, .layer-row");
  const sync = () => {
    row?.classList.toggle("is-on", !!input.checked);
  };
  input.addEventListener("change", sync);
  sync();
}

export function bindAllLayerIndicators(root, ids) {
  for (const id of ids) bindLayerIndicator(root, id);
}

export function bindRadioRowIndicators(root, name) {
  const sync = () => {
    root.querySelectorAll(`input[type="radio"][name="${name}"]`).forEach((inp) => {
      inp.closest(".lp-row")?.classList.toggle("is-on", !!inp.checked);
    });
  };
  root.querySelectorAll(`input[type="radio"][name="${name}"]`).forEach((inp) => {
    inp.addEventListener("change", sync);
  });
  sync();
}
