export function mountCompassNavigation(root, { onCompass, onResetOrientation }) {
  let stack = root.querySelector(".gis-tools-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "gis-tools-stack";
    root.appendChild(stack);
  }

  const compass = document.createElement("div");
  compass.className = "compass-nav";
  compass.setAttribute("role", "navigation");
  compass.setAttribute("aria-label", "Compass navigation");
  compass.innerHTML = `
    <button type="button" class="icon-button compass-btn" data-dir="nw" data-tip="North-West" aria-label="North-West">↖</button>
    <button type="button" class="icon-button compass-btn cardinal" data-dir="n" data-tip="North" aria-label="North">N</button>
    <button type="button" class="icon-button compass-btn" data-dir="ne" data-tip="North-East" aria-label="North-East">↗</button>
    <button type="button" class="icon-button compass-btn cardinal" data-dir="w" data-tip="West" aria-label="West">W</button>
    <button type="button" class="icon-button compass-btn center" data-dir="center" data-tip="North up" aria-label="North-up orientation">◎</button>
    <button type="button" class="icon-button compass-btn cardinal" data-dir="e" data-tip="East" aria-label="East">E</button>
    <button type="button" class="icon-button compass-btn" data-dir="sw" data-tip="South-West" aria-label="South-West">↙</button>
    <button type="button" class="icon-button compass-btn cardinal" data-dir="s" data-tip="South" aria-label="South">S</button>
    <button type="button" class="icon-button compass-btn" data-dir="se" data-tip="South-East" aria-label="South-East">↘</button>
  `;

  // Keep primary stack order: Compass → Zoom → Overview/2D/Layers
  const zoom = stack.querySelector(".zoom-controls");
  if (zoom) {
    stack.insertBefore(compass, zoom);
  } else {
    stack.insertBefore(compass, stack.firstChild);
  }

  compass.querySelectorAll(".compass-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dir = btn.dataset.dir;
      if (dir === "center") onResetOrientation?.();
      else onCompass?.(dir);
    });
  });

  return stack;
}
