import { state } from "../../state.js";
import { metersToStation } from "../../scene/chainageMarkers.js";

/**
 * Top-center chainage step control: ←  0+710  →
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
      <span class="chainage-step-arrow" aria-hidden="true">←</span>
    </button>
    <div class="chainage-step-center">
      <span class="chainage-step-station" id="chainage-step-station">—</span>
      <span class="chainage-step-travel" id="chainage-step-travel" hidden></span>
    </div>
    <button type="button" class="chainage-step-btn is-next" id="chainage-step-next"
      title="Forward ${intervalM} m" aria-label="Next ${intervalM} m">
      <span class="chainage-step-arrow" aria-hidden="true">→</span>
    </button>
    <button type="button" class="chainage-step-btn is-explore" id="chainage-step-explore"
      title="Explore River — travel 0+000 → end" aria-label="Explore river" aria-pressed="false">
      <span class="chainage-step-arrow" aria-hidden="true">▶</span>
    </button>
  `;
  root.appendChild(el);

  const stationEl = el.querySelector("#chainage-step-station");
  const travelEl = el.querySelector("#chainage-step-travel");
  const prevBtn = el.querySelector("#chainage-step-prev");
  const nextBtn = el.querySelector("#chainage-step-next");
  const exploreBtn = el.querySelector("#chainage-step-explore");

  exploreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent("river-explore"));
  });

  function onJourney(e) {
    const j = e.detail;
    el.classList.toggle("is-travelling", !!j);
    const exploring = j?.mode === "full-river-journey";
    exploreBtn.classList.toggle("active", exploring);
    exploreBtn.setAttribute("aria-pressed", String(exploring));
    exploreBtn.querySelector(".chainage-step-arrow").textContent = exploring ? "■" : "▶";
    travelEl.hidden = !j;
    if (!j) {
      update();
      return;
    }
    stationEl.textContent = metersToStation(j.currentChainage);
    travelEl.textContent = `${j.direction > 0 ? "▶ downstream" : "◀ upstream"} → ${metersToStation(j.targetChainage)}`;
  }
  document.addEventListener("river-journey-progress", onJourney);

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
    const sel = state.selectedChainageMeters;
    if (sel == null) return;
    const targetMeters = sel + (dir * intervalM);
    // Clamp to min/max
    const minMeters = points[0]?.meters ?? 0;
    const maxMeters = points[points.length - 1]?.meters ?? 0;
    const clampedMeters = Math.max(minMeters, Math.min(maxMeters, targetMeters));
    if (Math.abs(clampedMeters - sel) < 1) return;
    dispatchSelect(clampedMeters);
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
    if (state.cameraJourney) return;

    const idx = currentIndex();
    const label = metersToStation(state.selectedChainageMeters);
    stationEl.textContent = label;

    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx < 0 || idx >= points.length - 1;
    scheduleLayout();
  }

  // Top icon rows change height per mode (labels, numeric scales, wrapping),
  // so fixed CSS offsets collide. Sit just below whatever is actually visible.
  const SUB_ROW_SELECTORS = [
    ".lu-theme-classes",
    ".lu-hud",
    ".wq-hud",
    ".geology-workspace",
    ".focus-theme-classes",
    ".climate-impact-classes",
    ".aqi-classes",
    ".bod-cod-classes",
  ];
  const TOP_ROW_SELECTORS = [".analytics-controls", ".top-navigation", ...SUB_ROW_SELECTORS];
  const GAP_PX = 10;

  function isVisible(node) {
    if (!node || node === el || node.hidden) return false;
    if (!node.getClientRects().length) return false;
    const cs = getComputedStyle(node);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }

  const NAV_SELECTORS = [".analytics-controls", ".top-navigation"];
  const SUB_ROW_GAP_PX = 6;

  function visibleTopRects(selectors) {
    const rects = [];
    for (const sel of selectors) {
      for (const node of document.querySelectorAll(sel)) {
        ro?.observe(node);
        if (!isVisible(node)) continue;
        const r = node.getBoundingClientRect();
        if (r.bottom <= 0 || r.top > window.innerHeight * 0.5) continue;
        rects.push(r);
      }
    }
    return rects;
  }

  function layoutSubRows() {
    const navRects = visibleTopRects(NAV_SELECTORS);
    for (const row of document.querySelectorAll(SUB_ROW_SELECTORS.join(","))) {
      if (row.closest(".aqi-panel")) continue;
      ro?.observe(row);
      if (!isVisible(row)) continue;
      const rr = row.getBoundingClientRect();
      let navBottom = 0;
      for (const r of navRects) {
        if (r.right < rr.left || r.left > rr.right) continue;
        navBottom = Math.max(navBottom, r.bottom);
      }
      const next = navBottom > 0 ? `${Math.round(navBottom + SUB_ROW_GAP_PX)}px` : "";
      if (row.dataset.stackTop === next) continue;
      row.dataset.stackTop = next;
      if (next) row.style.setProperty("top", next, "important");
      else row.style.removeProperty("top");
    }
  }

  function layout() {
    layoutSubRows();
    if (el.hidden) return;
    const hudW = el.offsetWidth || 260;
    const cx = window.innerWidth / 2;
    const hudLeft = cx - hudW / 2 - 8;
    const hudRight = cx + hudW / 2 + 8;
    let bottom = 0;
    for (const sel of TOP_ROW_SELECTORS) {
      for (const node of document.querySelectorAll(sel)) {
        if (node.closest(".aqi-panel")) continue;
        ro?.observe(node);
        if (!isVisible(node)) continue;
        const r = node.getBoundingClientRect();
        if (r.bottom <= 0 || r.top > window.innerHeight * 0.5) continue;
        if (r.right < hudLeft || r.left > hudRight) continue;
        bottom = Math.max(bottom, r.bottom);
      }
    }
    const nextTop = bottom > 0 ? `${Math.round(bottom + GAP_PX)}px` : "";
    if (nextTop === lastTop) return;
    lastTop = nextTop;
    if (nextTop) el.style.setProperty("top", nextTop, "important");
    else el.style.removeProperty("top");
  }
  let lastTop = null;

  let layoutRaf = 0;
  function scheduleLayout() {
    if (layoutRaf) return;
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0;
      layout();
    });
  }

  const uiRoot = document.getElementById("ui-root") || root;
  const mo = new MutationObserver(scheduleLayout);
  mo.observe(uiRoot, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleLayout) : null;
  ro?.observe(el);
  window.addEventListener("resize", scheduleLayout);
  document.addEventListener("transitionend", scheduleLayout, true);
  document.addEventListener("animationend", scheduleLayout, true);
  const pollId = setInterval(scheduleLayout, 400);

  document.addEventListener("chainage-select", update);

  function dispose() {
    document.removeEventListener("chainage-select", update);
    document.removeEventListener("river-journey-progress", onJourney);
    window.removeEventListener("resize", scheduleLayout);
    document.removeEventListener("transitionend", scheduleLayout, true);
    document.removeEventListener("animationend", scheduleLayout, true);
    clearInterval(pollId);
    mo.disconnect();
    ro?.disconnect();
    cancelAnimationFrame(layoutRaf);
    el.remove();
  }

  update();
  return { el, update, dispose };
}
