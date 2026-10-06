import { state } from "../../state.js";
import { metersToStation } from "../../scene/chainageMarkers.js";
import { interpolateChainage, CHAINAGE_DESTINATIONS } from "../../geo/chainage.js";

/** Minimum horizontal gap (px) between neighbouring tick labels before one is hidden. */
const TICK_GAP_PX = 6;

/**
 * Bottom chainage navigator: full-width cyan track with a floating thumb
 * label and kilometre ticks. Snaps to the real chainage stations
 * and drives the canonical `chainage-select` event.
 */
export function mountChainageRuler(root, dataset) {
  const points = [...(dataset?.chainage || [])].sort(
    (a, b) => (a.meters ?? 0) - (b.meters ?? 0),
  );
  if (!points.length) return { el: null, update() {}, dispose() {} };

  const majors = pickRulerStations(points);
  const minM = Number(points[0].meters) || 0;
  const maxM = Math.max(Number(points[points.length - 1].meters) || 0, minM + 1);
  const spanM = Math.max(1, maxM - minM);
  const intervalM =
    Number(dataset?.chainageIntervalM) > 0
      ? Math.round(dataset.chainageIntervalM)
      : Math.max(1, Math.round(Math.abs((points[1]?.meters ?? 10) - (points[0]?.meters ?? 0))) || 10);

  const el = document.createElement("div");
  el.className = "hud chainage-ruler map-chrome chainage-ruler--track-only cr-premium";
  el.id = "chainage-ruler";
  el.setAttribute("aria-label", "Chainage navigator");

  const ticksHtml = majors
    .map((p, i) => {
      const m = Number(p.meters) || 0;
      const pct = ((m - minM) / spanM) * 100;
      const station = formatRulerLabel(p);
      const meters = `${Math.round(m)} m`;
      const edge = i === 0 ? " is-edge-start" : i === majors.length - 1 ? " is-edge-end" : "";
      return `<button type="button" class="chainage-ruler-tick chainage-tick${edge}" data-meters="${m}" style="left:${pct}%" aria-label="${station}, ${meters}">
        <span class="chainage-ruler-tick-mark"></span>
        <span class="chainage-ruler-label">${station}</span>
        <span class="chainage-ruler-meters">${meters}</span>
      </button>`;
    })
    .join("");

  const destinationsHtml = CHAINAGE_DESTINATIONS.map(dest => {
    const pct = ((dest.chainage_m - minM) / spanM) * 100;
    if (pct < 0 || pct > 100) return "";
    const letter = dest.name.charAt(0).toUpperCase();
    return `<button type="button" class="chainage-destination-marker" data-meters="${dest.chainage_m}" style="left:${pct}%" aria-label="${dest.name}" title="${dest.name}">
      ${letter}
    </button>`;
  }).join("");

  el.innerHTML = `
    <div class="chainage-ruler-bands-head" id="chainage-ruler-bands-head" hidden></div>
    <div class="cr-shell">
      <div class="chainage-ruler-track chainage-slider" role="list">
        <div class="cr-rail" aria-hidden="true"><div class="cr-fill" id="chainage-ruler-fill"></div></div>
        <div class="chainage-ruler-bands" id="chainage-ruler-bands" aria-hidden="true" hidden></div>
        <input class="chainage-ruler-input" id="chainage-ruler-input" type="range" min="${minM}" max="${maxM}" step="${intervalM}" value="${state.selectedChainageMeters ?? minM}" aria-label="Select chainage along the river" />
        ${ticksHtml}
        ${destinationsHtml}
        <div class="chainage-ruler-cursor" id="chainage-ruler-cursor" hidden>
          <span class="chainage-ruler-cursor-label" id="chainage-ruler-cursor-label">0+000</span>
          <span class="chainage-ruler-cursor-dot"></span>
        </div>
      </div>
    </div>
  `;
  root.appendChild(el);

  const range = el.querySelector("#chainage-ruler-input");
  const track = el.querySelector(".chainage-ruler-track");
  const fill = el.querySelector("#chainage-ruler-fill");
  const cursor = el.querySelector("#chainage-ruler-cursor");
  const cursorLabel = el.querySelector("#chainage-ruler-cursor-label");
  const tickEls = [...el.querySelectorAll(".chainage-ruler-tick")];
  let inputRaf = 0;
  let pendingMeters = null;
  let dragDispatchTimer = 0;
  let lastDragDispatch = 0;
  let lastSel = undefined;

  function nearestIndex(meters) {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((points[mid].meters ?? 0) < meters) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs((points[lo - 1].meters ?? 0) - meters) <= Math.abs((points[lo].meters ?? 0) - meters)) {
      return lo - 1;
    }
    return lo;
  }

  function nearestPoint(meters) {
    return points[nearestIndex(meters)];
  }

  function dispatchSelect(meters, { focus = true, dragging = false } = {}) {
    if (!Number.isFinite(meters)) return;
    const m = Number(nearestPoint(meters)?.meters);
    if (!Number.isFinite(m)) return;
    state.selectedChainageMeters = m;
    state.showChainage = true;
    document.dispatchEvent(
      new CustomEvent("chainage-select", { detail: { meters: m, focus, dragging } }),
    );
  }

  range?.addEventListener("input", () => {
    pendingMeters = Number(nearestPoint(Number(range.value))?.meters);
    if (inputRaf) return;
    inputRaf = requestAnimationFrame(() => {
      inputRaf = 0;
      state.selectedChainageMeters = pendingMeters;
      state.showChainage = true;
      update();
      const wait = Math.max(0, 50 - (performance.now() - lastDragDispatch));
      window.clearTimeout(dragDispatchTimer);
      dragDispatchTimer = window.setTimeout(() => {
        lastDragDispatch = performance.now();
        document.dispatchEvent(new CustomEvent("chainage-select", {
          detail: { meters: pendingMeters, focus: true, dragging: true },
        }));
      }, wait);
    });
  });

  const settleCamera = () => {
    window.clearTimeout(dragDispatchTimer);
    const raw = Number(range?.value);
    if (!Number.isFinite(raw)) return;
    const m = Number(nearestPoint(raw)?.meters);
    if (!Number.isFinite(m)) return;
    if (range) range.value = String(m);
    dispatchSelect(m, { focus: true, dragging: false });
  };
  range?.addEventListener("change", settleCamera);
  range?.addEventListener("pointerup", settleCamera);

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-meters]");
    if (!btn) return;
    dispatchSelect(Number(btn.dataset.meters));
  });

  /** Hide tick labels that would collide with a kept neighbour (ends always kept). */
  function layoutTicks() {
    const w = track.clientWidth;
    if (!w) return;
    const boxes = tickEls.map((t) => {
      const half = t.querySelector(".chainage-ruler-label").offsetWidth / 2;
      const x = (Number(t.style.left.replace("%", "")) / 100) * w;
      return { t, x0: x - half, x1: x + half };
    });
    const last = boxes[boxes.length - 1];
    let prev = null;
    for (const b of boxes) {
      const keep = b === boxes[0] || b === last ||
        ((!prev || b.x0 >= prev.x1 + TICK_GAP_PX) && b.x1 + TICK_GAP_PX <= last.x0);
      b.t.classList.toggle("is-crowded", !keep);
      if (keep) prev = b;
    }
  }
  const ro = new ResizeObserver(() => layoutTicks());
  ro.observe(track);
  requestAnimationFrame(layoutTicks);

  function update() {
    const show = state.showChainage !== false && !state.cinematicActive;
    el.hidden = !show;
    if (!show) return;

    const sel = state.selectedChainageMeters;
    if (sel === lastSel) return;
    lastSel = sel;

    const hasSel = Number.isFinite(sel);
    const activeTick = hasSel ? majors[nearestMajor(sel)] : null;
    for (const t of tickEls) {
      const on = !!activeTick && Number(t.dataset.meters) === activeTick.meters && Math.abs(activeTick.meters - sel) <= 500;
      t.classList.toggle("is-active", on);
      t.classList.toggle("active", on);
    }

    if (!hasSel) {
      cursor.hidden = true;
      fill.style.width = "0%";
      return;
    }
    const clamped = Math.min(maxM, Math.max(minM, sel));
    if (range) range.value = String(clamped);
    const pct = ((clamped - minM) / spanM) * 100;
    cursor.style.left = `${pct}%`;
    cursor.classList.toggle("is-edge-start", pct <= 3);
    cursor.classList.toggle("is-edge-end", pct >= 97);
    cursor.hidden = false;
    fill.style.width = `${pct}%`;

    const label = interpolateChainage(points, sel)?.label || metersToStation(sel);
    cursorLabel.textContent = String(label).replace(/^\+/, "");
  }

  function nearestMajor(meters) {
    let best = 0;
    for (let i = 1; i < majors.length; i++) {
      if (Math.abs(majors[i].meters - meters) < Math.abs(majors[best].meters - meters)) best = i;
    }
    return best;
  }

  const bandsEl = el.querySelector("#chainage-ruler-bands");
  const bandsHeadEl = el.querySelector("#chainage-ruler-bands-head");

  /**
   * Class bands drawn along the track (e.g. BOD-COD reaches).
   * detail: { title?, legend?: [{ label, style }], segments: [{ startM, endM, color, style?, active?, title? }] } | null
   */
  function onBands(e) {
    const d = e.detail;
    const segs = d?.segments || [];
    if (!segs.length) {
      bandsEl.hidden = true;
      bandsEl.innerHTML = "";
      bandsHeadEl.hidden = true;
      bandsHeadEl.innerHTML = "";
      el.classList.remove("has-bands");
      return;
    }
    bandsEl.innerHTML = segs
      .map((s) => {
        const a = Math.max(minM, Math.min(maxM, Number(s.startM)));
        const b = Math.max(minM, Math.min(maxM, Number(s.endM)));
        if (!(b > a)) return "";
        const left = ((a - minM) / spanM) * 100;
        const width = ((b - a) / spanM) * 100;
        return `<span class="chainage-ruler-band is-${escapeAttr(s.style || "observed")}${s.active ? " is-active" : ""}"
          style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;--band-color:${escapeAttr(s.color || "#6b7a7f")}"
          title="${escapeAttr(s.title || "")}"></span>`;
      })
      .join("");
    bandsEl.hidden = false;
    const legend = (d.legend || [])
      .map((l) => `<span class="chainage-ruler-band-key is-${escapeAttr(l.style)}">${escapeAttr(l.label)}</span>`)
      .join("");
    bandsHeadEl.innerHTML = `${d.title ? `<strong>${escapeAttr(d.title)}</strong>` : ""}${legend}`;
    bandsHeadEl.hidden = !d.title && !legend;
    el.classList.add("has-bands");
  }
  document.addEventListener("chainage-bands", onBands);

  function dispose() {
    window.cancelAnimationFrame(inputRaf);
    window.clearTimeout(dragDispatchTimer);
    document.removeEventListener("chainage-bands", onBands);
    ro.disconnect();
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

  for (let km = 0; km * 1000 <= lastM + 0.5; km++) {
    const m = km * 1000;
    if (!byM.has(m)) byM.set(m, { meters: m, label: metersToStation(m), major: true });
  }

  return [...byM.values()].sort((a, b) => a.meters - b.meters);
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatRulerLabel(p) {
  const label = String(p.label || metersToStation(p.meters)).trim();
  return label.replace(/^\+/, "");
}
