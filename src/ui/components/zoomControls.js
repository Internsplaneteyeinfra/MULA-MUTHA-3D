export function mountZoomControls(root, { onZoomIn, onZoomOut }) {
  const el = document.createElement("div");
  el.className = "zoom-controls";
  el.innerHTML = `
    <button type="button" class="zoom-btn" id="zoom-in" title="Zoom in">+</button>
    <button type="button" class="zoom-btn" id="zoom-out" title="Zoom out">−</button>
  `;
  const stack = root.querySelector(".gis-tools-stack");
  if (stack) stack.appendChild(el);
  else root.appendChild(el);

  el.querySelector("#zoom-in").addEventListener("click", () => onZoomIn?.());
  el.querySelector("#zoom-out").addEventListener("click", () => onZoomOut?.());
  return el;
}
