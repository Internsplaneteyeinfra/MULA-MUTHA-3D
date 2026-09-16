import { state } from "../../state.js";
import { metersToStation } from "../../scene/chainageMarkers.js";

/**
 * Top-center chainage step control: clickable `10m ←  0+710  → 10m`.
 * Replaces bottom-ruler prev/next for ±interval navigation.
 */
export function mountChainageStepHud(root, dataset) {
  const points = [...(dataset?.chainage || [])].sort(
    (a, b) => (a.meters ?? 0) - (b.meters ?? 0),
  );
  if (!points.length) return { el: null, update() {}, dispose() {} };

  const intervalM =
    Number(dataset?.chainageIntervalM) > 0
      ? Math.round(dataset.chainageIntervalM)
      : Math.max(
          1,
          Math.round(Math.abs((points[1]?.meters ?? 10) - (points[0]?.meters ?? 0))) || 10,
        );

  const el = document.createElement("div");
  el.className = "hud chainage-step-hud map-chrome";
  el.id = "chainage-step-hud";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", `${intervalM} meter chainage step`);
  el.hidden = true;

  el.innerHTML = `
    <button type="button" class="chainage-step-btn is-prev" id="chainage-step-prev"
      title="Back ${intervalM} m" aria-label="Previous ${intervalM} m">
      <span class="chainage-step-delta">${intervalM}m</span>
      <span class="chainage-step-arrow" aria-hidden="true">←</span>
    </button>
    <span class="chainage-step-station" id="chainage-step-station">—</span>
    <button type="button" class="chainage-step-btn is-next" id="chainage-step-next"
      title="Forward ${intervalM} m" aria-label="Next ${intervalM} m">
      <span class="chainage-step-arrow" aria-hidden="true">→</span>
      <span class="chainage-step-delta">${intervalM}m</span>
    </button>
  `;
  root.appendChild(el);

  const stationEl = el.querySelector("#chainage-step-station");
  const prevBtn = el.querySelector("#chainage-step-prev");
  const nextBtn = el.querySelector("#chainage-step-next");

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

  function currentIndex() {
    const sel = state.selectedChainageMeters;
    if (sel == null) return -1;
    const exact = points.findIndex((p) => Math.abs((p.meters ?? 0) - sel) < 0.5);
    if (exact >= 0) return exact;
    return points.indexOf(nearestPoint(sel));
  }

  function dispatchSelect(meters) {
    if (!Number.isFinite(meters)) return;
    state.selectedChainageMeters = meters;
    state.showChainage = true;
    document.dispatchEvent(
      new CustomEvent("chainage-select", { detail: { meters, focus: true } }),
    );
  }

  function step(dir) {
    const idx = currentIndex();
    if (idx < 0) return;
    const nextIdx = Math.min(points.length - 1, Math.max(0, idx + dir));
    const target = points[nextIdx];
    if (!target || nextIdx === idx) return;
    dispatchSelect(Number(target.meters) || 0);
  }

  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    step(-1);
  });
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    step(1);
  });

  function update() {
    const show =
      state.showChainage !== false &&
      !state.cinematicActive &&
      state.selectedChainageMeters != null;
    el.hidden = !show;
    if (!show) return;

    const idx = currentIndex();
    const p = idx >= 0 ? points[idx] : null;
    const label = p?.label || metersToStation(state.selectedChainageMeters);
    stationEl.textContent = label;

    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx < 0 || idx >= points.length - 1;
  }

  document.addEventListener("chainage-select", update);

  function dispose() {
    document.removeEventListener("chainage-select", update);
    el.remove();
  }

  update();
  return { el, update, dispose };
}
