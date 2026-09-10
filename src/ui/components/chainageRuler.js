import { PenLine, ChevronLeft, ChevronRight } from "lucide";
import { state } from "../../state.js";
import { metersToStation } from "../../scene/chainageMarkers.js";
import { interpolateChainage } from "../../geo/chainage.js";
import { lucideHtml } from "../icons.js";

/**
 * Bottom chainage ruler — every kilometre + endpoints, map-first styling.
 * Single source of truth for scrubbing: state.selectedChainageMeters + chainage-select.
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
      return `<button type="button" class="chainage-ruler-tick chainage-tick${edge}${sparse}" data-meters="${m}" style="left:${pct}%" aria-label="${station}, ${meters}">
        <span class="chainage-ruler-tick-mark"></span>
        <span class="chainage-ruler-label">${station}</span>
        <span class="chainage-ruler-meters">${meters}</span>
      </button>`;
    })
    .join("");

  el.innerHTML = `
    <div class="chainage-ruler-row">
      <div class="chainage-ruler-head">
        <button type="button" class="chainage-ruler-step" id="chainage-ruler-prev" title="Previous station" aria-label="Previous station">
          ${lucideHtml(ChevronLeft, { size: 16 })}
        </button>
        <div class="chainage-ruler-title">
          <span>CHAINAGE</span>
          <span class="chainage-ruler-title-sep" aria-hidden="true">|</span>
          <strong id="chainage-ruler-selected">${formatRulerLabel(points[0])}</strong>
        </div>
        <button type="button" class="chainage-ruler-step" id="chainage-ruler-next" title="Next station" aria-label="Next station">
          ${lucideHtml(ChevronRight, { size: 16 })}
        </button>
        <button type="button" class="chainage-ruler-anno" id="chainage-ruler-anno" title="Annotations" aria-label="Open annotations">
          ${lucideHtml(PenLine, { size: 13 })}
          <span>Annotation</span>
        </button>
      </div>
      <div class="chainage-ruler-track chainage-slider" role="list">
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
  const selectedTitle = el.querySelector("#chainage-ruler-selected");
  let inputRaf = 0;
  let pendingMeters = null;
  let dragDispatchTimer = 0;
  let lastDragDispatch = 0;

  function dispatchSelect(meters, { focus = true, dragging = false } = {}) {
    if (!Number.isFinite(meters)) return;
    state.selectedChainageMeters = meters;
    state.showChainage = true;
    document.dispatchEvent(
      new CustomEvent("chainage-select", { detail: { meters, focus, dragging } }),
    );
  }

  function nearestPoint(meters) {
    let best = points[0];
    let dist = Infinity;
    for (const p of points) {
      const d = Math.abs((p.meters ?? 0) - meters);
      if (d < dist) {
        dist = d;
        best = p;
      }
    }
    return best;
  }

  function stepStation(dir) {
    const sel = state.selectedChainageMeters ?? minM;
    const idx = points.findIndex((p) => Math.abs((p.meters ?? 0) - sel) < 0.5);
    let nextIdx;
    if (idx < 0) {
      const nearest = nearestPoint(sel);
      const nIdx = points.indexOf(nearest);
      nextIdx = Math.min(points.length - 1, Math.max(0, nIdx + dir));
    } else {
      nextIdx = Math.min(points.length - 1, Math.max(0, idx + dir));
    }
    const target = points[nextIdx];
    if (!target) return;
    dispatchSelect(Number(target.meters) || 0);
  }

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

  // Final settle when the user releases the slider (not every drag sample)
  const settleCamera = () => {
    window.clearTimeout(dragDispatchTimer);
    const m = Number(range?.value);
    if (!Number.isFinite(m)) return;
    state.selectedChainageMeters = m;
    state.showChainage = true;
    document.dispatchEvent(
      new CustomEvent("chainage-select", { detail: { meters: m, focus: true, dragging: false } }),
    );
  };
  range?.addEventListener("change", settleCamera);
  range?.addEventListener("pointerup", settleCamera);

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-meters]");
    if (!btn || btn.closest(".chainage-ruler-head")) return;
    const m = Number(btn.dataset.meters);
    if (!Number.isFinite(m)) return;
    dispatchSelect(m);
  });

  el.querySelector("#chainage-ruler-prev")?.addEventListener("click", () => stepStation(-1));
  el.querySelector("#chainage-ruler-next")?.addEventListener("click", () => stepStation(1));
  el.querySelector("#chainage-ruler-anno")?.addEventListener("click", () => {
    document.dispatchEvent(
      new CustomEvent("chainage-panel-open", {
        detail: { meters: state.selectedChainageMeters ?? minM, notes: false },
      }),
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
      const active = Number(t.dataset.meters) === sel;
      t.classList.toggle("is-active", active);
      t.classList.toggle("active", active);
    });

    if (sel == null || !cursor) {
      if (cursor) cursor.hidden = true;
      if (selectedTitle) selectedTitle.textContent = "—";
      return;
    }
    if (range && Number.isFinite(sel)) range.value = String(Math.min(maxM, Math.max(minM, sel)));
    const pct = Math.min(100, Math.max(0, ((sel - minM) / Math.max(1, maxM - minM)) * 100));
    cursor.style.left = `${pct}%`;
    cursor.hidden = false;
    const p = interpolateChainage(points, sel);
    const label = p?.label || metersToStation(sel);
    if (cursorLabel) {
      cursorLabel.textContent = `${label} · ${Math.round(sel)} m`;
    }
    if (selectedTitle) selectedTitle.textContent = label;
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
