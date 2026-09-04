export function mountCompassNavigation(root, { onCompass, onResetOrientation }) {
  const stack = document.createElement("div");
  stack.className = "gis-tools-stack";
  stack.innerHTML = `
    <div class="compass-nav" role="navigation" aria-label="Compass navigation">
      <button type="button" class="compass-btn" data-dir="nw" title="North-West">↖</button>
      <button type="button" class="compass-btn cardinal" data-dir="n" title="North">N</button>
      <button type="button" class="compass-btn" data-dir="ne" title="North-East">↗</button>
      <button type="button" class="compass-btn cardinal" data-dir="w" title="West">W</button>
      <button type="button" class="compass-btn center" data-dir="center" title="North-up orientation">◎</button>
      <button type="button" class="compass-btn cardinal" data-dir="e" title="East">E</button>
      <button type="button" class="compass-btn" data-dir="sw" title="South-West">↙</button>
      <button type="button" class="compass-btn cardinal" data-dir="s" title="South">S</button>
      <button type="button" class="compass-btn" data-dir="se" title="South-East">↘</button>
    </div>
  `;
  root.appendChild(stack);

  stack.querySelectorAll(".compass-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dir = btn.dataset.dir;
      if (dir === "center") onResetOrientation?.();
      else onCompass?.(dir);
    });
  });

  return stack;
}
