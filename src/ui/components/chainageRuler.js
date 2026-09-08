import { state } from "../../state.js";
import { metersToStation } from "../../scene/chainageMarkers.js";
import { interpolateChainage } from "../../geo/chainage.js";

/**
 * Bottom chainage ruler — every kilometre + endpoints, map-first styling.
 */
export function mountChainageRuler(root, dataset) {
  const points = [...(dataset?.chainage || [])].sort(
    (a, b) => (a.meters ?? 0) - (b.meters ?? 0),
  );
  if (!points.length) return { el: null, update() {}, dispose() {} };

  const majors = pickRulerStations(points);
  const minM = Number(points[0].meters) || 0;
  const maxM = Math.max(Number(points[points.length - 1].meters) || 0, minM + 1);

  const el = document.createElement("div");
  el.className = "hud chainage-ruler map-chrome";
  el.id = "chainage-ruler";
  el.setAttribute("aria-label", "Chainage ruler");

  const ticksHtml = majors
    .map((p, i) => {
      const m = Number(p.meters) || 0;
      const pct = (m / maxM) * 100;
      const station = formatRulerLabel(p);
      const meters = `${Math.round(m)} m`;
      const edge =
        i === 0 ? " is-edge-start" : i === majors.length - 1 ? " is-edge-end" : "";
      const sparse = m % 2000 !== 0 && i !== 0 && i !== majors.length - 1 ? " is-sparse" : "";
      return `<button type="button" class="chainage-ruler-tick${edge}${sparse}" data-meters="${m}" style="left:${pct}%" aria-label="${station}, ${meters}">
        <span class="chainage-ruler-tick-mark"></span>
        <span class="chainage-ruler-label">${station}</span>
        <span class="chainage-ruler-meters">${meters}</span>
      </button>`;
    })
    .join("");

  el.innerHTML = `
    <div class="chainage-ruler-row">
      <div class="chainage-ruler-title">CHAINAGE</div>
      <div class="chainage-ruler-track" role="list">
        <div class="chainage-ruler-line" aria-hidden="true"></div>
        <input class="chainage-ruler-input" id="chainage-ruler-input" type="range" min="${minM}" max="${maxM}" step="1" value="${state.selectedChainageMeters ?? minM}" aria-label="Select chainage along the river" />
        ${ticksHtml}
        <div class="chainage-ruler-cursor" id="chainage-ruler-cursor" hidden>
          <span class="chainage-ruler-cursor-label" id="chainage-ruler-cursor-label">0+000</span>
          <span class="chainage-ruler-cursor-dot"></span>
        </div>
      </div>
    </div>
  `;
  root.appendChild(el);

  const range = el.querySelector("#chainage-ruler-input");
  let inputRaf = 0;
  let pendingMeters = null;
  let dragDispatchTimer = 0;
  let lastDragDispatch = 0;
  range?.addEventListener("input", () => {
    pendingMeters = Number(range.value);
    if (inputRaf) return;
    inputRaf = requestAnimationFrame(() => {
      inputRaf = 0;
      const m = pendingMeters;
      state.selectedChainageMeters = m;
      state.showChainage = true;
      // Avoid restarting the expensive 3D camera tween every render frame.
      // The latest value is retained, while camera updates are capped at 20 Hz.
      const now = performance.now();
      const wait = Math.max(0, 50 - (now - lastDragDispatch));
      window.clearTimeout(dragDispatchTimer);
      dragDispatchTimer = window.setTimeout(() => {
        lastDragDispatch = performance.now();
        document.dispatchEvent(new CustomEvent("chainage-select", {
          detail: { meters: pendingMeters, focus: true, dragging: true },
        }));
      }, wait);
    });
  });

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-meters]");
    if (!btn) return;
    const m = Number(btn.dataset.meters);
    if (!Number.isFinite(m)) return;
    state.selectedChainageMeters = m;
    state.showChainage = true;
    document.dispatchEvent(
      new CustomEvent("chainage-select", { detail: { meters: m, focus: true } }),
    );
  });

  const cursor = el.querySelector("#chainage-ruler-cursor");
  const cursorLabel = el.querySelector("#chainage-ruler-cursor-label");

  function update() {
    const show = state.showChainage !== false && !state.cinematicActive;
    el.hidden = !show;
    if (!show) return;

    const sel = state.selectedChainageMeters;
    el.querySelectorAll(".chainage-ruler-tick").forEach((t) => {
      t.classList.toggle("is-active", Number(t.dataset.meters) === sel);
    });

    if (sel == null || !cursor) {
      if (cursor) cursor.hidden = true;
      return;
    }
    if (range && Number.isFinite(sel)) range.value = String(Math.min(maxM, Math.max(minM, sel)));
    const pct = Math.min(100, Math.max(0, ((sel - minM) / Math.max(1, maxM - minM)) * 100));
    cursor.style.left = `${pct}%`;
    cursor.hidden = false;
    if (cursorLabel) {
      const p = interpolateChainage(points, sel);
      cursorLabel.textContent = `${p?.label || metersToStation(sel)} · ${Math.round(sel)} m`;
    }
  }

  function dispose() {
    window.cancelAnimationFrame(inputRaf);
    window.clearTimeout(dragDispatchTimer);
    el.remove();
  }

  update();
  return { el, update, dispose, points: majors };
}

/** Every 1000 m station + first/last endpoints. */
function pickRulerStations(points) {
  const byM = new Map();
  for (const p of points) {
    const m = Number(p.meters) || 0;
    if (p.major || m % 1000 === 0) byM.set(m, { ...p, meters: m });
  }
  const first = points[0];
  const last = points[points.length - 1];
  const firstM = Number(first?.meters) || 0;
  const lastM = Number(last?.meters) || 0;
  if (first) byM.set(firstM, { ...first, meters: firstM });
  if (last) byM.set(lastM, { ...last, meters: lastM });

  // Ensure full kilometre ladder 0 … floor(last/1000)*1000
  for (let km = 0; km * 1000 <= lastM + 0.5; km++) {
    const m = km * 1000;
    if (!byM.has(m)) byM.set(m, { meters: m, label: metersToStation(m), major: true });
  }

  return [...byM.values()].sort((a, b) => a.meters - b.meters);
}

function formatRulerLabel(p) {
  const label = String(p.label || metersToStation(p.meters)).trim();
  return label.replace(/^\+/, "");
}
