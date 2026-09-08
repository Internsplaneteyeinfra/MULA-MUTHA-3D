/** Minimal non-blocking vegetation analysis status chip. */

export function mountVegetationStatus(root) {
  let el = root.querySelector("#veg-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "veg-status";
    el.className = "veg-status";
    el.hidden = true;
    root.appendChild(el);
  }

  return {
    show(message, kind = "loading") {
      el.hidden = false;
      el.dataset.kind = kind;
      el.textContent = message;
    },
    hide() {
      el.hidden = true;
      el.textContent = "";
    },
    el,
  };
}
