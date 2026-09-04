import { state } from "../../state.js";

export function mountNavigationControls(root, { onOverview, onRiverSide, onLayersToggle }) {
  const wrap = document.createElement("div");
  wrap.className = "gis-nav-wrap";
  wrap.innerHTML = `
    <nav class="navigation-controls" id="navigation-controls" aria-label="Primary navigation">
      <button type="button" class="nav-button" id="nav-overview" data-mode="overview">
        <span class="nav-icon">🏠</span><span>Overview</span>
      </button>
      <button type="button" class="nav-button" id="nav-riverside" data-mode="local">
        <span class="nav-icon">🗺️</span><span>River Side</span>
      </button>
    </nav>
    <button type="button" class="layers-toggle-button" id="layers-btn" aria-pressed="true">
      <span class="nav-icon">📚</span><span>Layers</span>
    </button>
  `;
  root.appendChild(wrap);

  const overviewBtn = wrap.querySelector("#nav-overview");
  const riverBtn = wrap.querySelector("#nav-riverside");
  const layersBtn = wrap.querySelector("#layers-btn");

  overviewBtn.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onOverview?.();
    syncActive();
  });
  riverBtn.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onRiverSide?.();
    syncActive();
  });
  layersBtn.addEventListener("click", () => {
    if (state.cinematicActive) return;
    onLayersToggle?.();
  });

  function syncActive() {
    overviewBtn.classList.toggle("active", state.cameraMode === "overview");
    riverBtn.classList.toggle("active", state.cameraMode === "local");
  }

  function setLayersPressed(open) {
    layersBtn.setAttribute("aria-pressed", open ? "true" : "false");
  }

  syncActive();
  return { wrap, syncActive, setLayersPressed };
}
