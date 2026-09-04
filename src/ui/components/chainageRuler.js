import { state } from "../../state.js";
import { metersToStation } from "../../scene/chainageMarkers.js";

/**
 * Bottom chainage ruler — every station readable, proportionally placed.
 */
export function mountChainageRuler(root, dataset) {
  const points = [...(dataset?.chainage || [])].sort(
    (a, b) => (a.meters ?? 0) - (b.meters ?? 0),
  );
  if (!points.length) return { el: null, update() {}, dispose() {} };

  const majors = pickRulerStations(points);
  const maxM = Math.max(...majors.map((p) => Number(p.meters) || 0), 1);

  const el = document.createElement("div");
  el.className = "hud chainage-ruler";
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
      const alt = i % 2 === 1 ? " is-alt" : "";
      return `<button type="button" class="chainage-ruler-tick${edge}${alt}" data-meters="${m}" style="left:${pct}%" title="${station} · ${meters}">
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
        ${ticksHtml}
        <div class="chainage-ruler-cursor" id="chainage-ruler-cursor" hidden>
          <span class="chainage-ruler-cursor-label" id="chainage-ruler-cursor-label">0+000</span>
          <span class="chainage-ruler-cursor-dot"></span>
        </div>
      </div>
    </div>
  `;
  root.appendChild(el);

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
    const pct = Math.min(100, Math.max(0, (sel / maxM) * 100));
    cursor.style.left = `${pct}%`;
    cursor.hidden = false;
    if (cursorLabel) {
      cursorLabel.textContent = `${metersToStation(sel)} · ${Math.round(sel)} m`;
    }
  }

  function dispose() {
    el.remove();
  }

  update();
  return { el, update, dispose, points: majors };
}

/** Unique km stations + endpoints; drop near-duplicates so labels stay readable. */
function pickRulerStations(points) {
  const byM = new Map();
  for (const p of points) {
    const m = Number(p.meters) || 0;
    if (p.major || m % 1000 === 0) byM.set(m, { ...p, meters: m });
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first) byM.set(Number(first.meters) || 0, { ...first, meters: Number(first.meters) || 0 });
  if (last) byM.set(Number(last.meters) || 0, { ...last, meters: Number(last.meters) || 0 });

  const sorted = [...byM.values()].sort((a, b) => a.meters - b.meters);
  const maxM = Math.max(...sorted.map((p) => p.meters), 1);
  const out = [];
  for (const p of sorted) {
    if (!out.length) {
      out.push(p);
      continue;
    }
    const prev = out[out.length - 1];
    const gapPct = ((p.meters - prev.meters) / maxM) * 100;
    if (gapPct < 2.5) {
      // Prefer exact kilometre; otherwise keep the later (end) station
      const prevIsKm = prev.meters % 1000 === 0;
      const nextIsKm = p.meters % 1000 === 0;
      if (!prevIsKm || nextIsKm || p === sorted[sorted.length - 1]) {
        out[out.length - 1] = p;
      }
    } else {
      out.push(p);
    }
  }
  return out;
}

function formatRulerLabel(p) {
  const label = String(p.label || metersToStation(p.meters)).trim();
  // Normalize "+1+000" style to "1+000"
  return label.replace(/^\+/, "");
}
