import { POLLUTION_KEY_SIDES } from "../../scene/pollution/pollutionSides.js";
import { state } from "../../state.js";

/**
 * Arrow HUD:  ←  Sangam side  1/6  →
 * Steps through the 6 corridor sides; within a side, steps each garbage site
 * so the tour covers every location.
 *
 * Important: do NOT re-sync from chainage after a tour step — many western
 * sites share CH 0+000 and that was resetting every Next click back to site 1.
 */
export function mountPollutionKeyPoints(root) {
  const el = document.createElement("div");
  el.className = "pollution-keypoints pollution-side-hud map-chrome";
  el.id = "pollution-keypoints";
  el.hidden = true;
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Pollution location sides");
  root.appendChild(el);

  let visible = false;
  let sideIndex = 0;
  let siteIndex = 0;
  /** When true, ignore chainage-select (tour owns the index). */
  let tourDriving = false;

  function sides() {
    const list = window.__MM_SCENE__?.getPollutionSides?.();
    if (list?.length) return list;
    return POLLUTION_KEY_SIDES.map((s) => ({ ...s, count: 0, sites: [] }));
  }

  function currentSide() {
    const list = sides();
    if (!list.length) return null;
    sideIndex = Math.max(0, Math.min(list.length - 1, sideIndex));
    return list[sideIndex];
  }

  function render() {
    if (!visible) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    const list = sides();
    if (!list.length) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    sideIndex = Math.max(0, Math.min(list.length - 1, sideIndex));
    const side = list[sideIndex];
    const siteCount = side.sites?.length || side.count || 0;
    if (siteCount > 0) {
      siteIndex = Math.max(0, Math.min(siteCount - 1, siteIndex));
    } else {
      siteIndex = 0;
    }

    const focus = side.sites?.[siteIndex] || null;
    const siteMeta =
      siteCount > 1
        ? `site ${siteIndex + 1}/${siteCount}`
        : siteCount === 1
          ? "1 site"
          : "no sites";
    const nameBit = focus?.name ? String(focus.name) : "";
    const ch =
      (focus?.chainageLabel && `CH ${focus.chainageLabel}`) ||
      "";

    el.innerHTML = `
      <button type="button" class="pollution-side-btn is-prev" id="pollution-side-prev"
        ${sideIndex <= 0 && siteIndex <= 0 ? "disabled" : ""}
        aria-label="Previous pollution location">
        <span class="pollution-side-arrow" aria-hidden="true">←</span>
      </button>
      <div class="pollution-side-center">
        <span class="pollution-side-eyebrow">${side.index || sideIndex + 1} / ${list.length}</span>
        <strong class="pollution-side-name">${escapeHtml(side.name)}</strong>
        <span class="pollution-side-meta">${escapeHtml(
          [siteMeta, nameBit, ch].filter(Boolean).join(" · "),
        )}</span>
      </div>
      <button type="button" class="pollution-side-btn is-next" id="pollution-side-next"
        ${sideIndex >= list.length - 1 && siteIndex >= Math.max(0, siteCount - 1) ? "disabled" : ""}
        aria-label="Next pollution location">
        <span class="pollution-side-arrow" aria-hidden="true">→</span>
      </button>
    `;
    el.hidden = false;

    el.querySelector("#pollution-side-prev")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      step(-1);
    });
    el.querySelector("#pollution-side-next")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      step(1);
    });
  }

  function focusCurrent() {
    const side = currentSide();
    if (!side) return;
    document.dispatchEvent(new CustomEvent("river-measure-clear"));
    tourDriving = true;
    const result = window.__MM_SCENE__?.focusPollutionSide?.(side.id, {
      siteIndex,
    });
    if (result?.meters != null && Number.isFinite(result.meters)) {
      state.selectedChainageMeters = result.meters;
      state.showChainage = true;
      document.dispatchEvent(
        new CustomEvent("chainage-select", {
          detail: { meters: result.meters, focus: false, fromPollutionTour: true },
        }),
      );
    }
    render();
    // Keep tour in control briefly so chainage listeners cannot snap index back
    window.setTimeout(() => {
      tourDriving = false;
    }, 50);
  }

  function step(dir) {
    const list = sides();
    if (!list.length) return;
    const side = list[sideIndex];
    const siteCount = side?.sites?.length || side?.count || 0;

    if (dir > 0) {
      if (siteIndex < siteCount - 1) {
        siteIndex += 1;
      } else if (sideIndex < list.length - 1) {
        sideIndex += 1;
        siteIndex = 0;
      } else {
        return;
      }
    } else if (siteIndex > 0) {
      siteIndex -= 1;
    } else if (sideIndex > 0) {
      sideIndex -= 1;
      const prev = list[sideIndex];
      const prevCount = prev?.sites?.length || prev?.count || 0;
      siteIndex = Math.max(0, prevCount - 1);
    } else {
      return;
    }
    focusCurrent();
  }

  function syncIndexFromChainage() {
    const list = sides();
    if (!list.length) return;
    const near = state.selectedChainageMeters;
    if (!Number.isFinite(near)) return;

    let bestI = 0;
    let bestD = Infinity;
    let bestSite = 0;
    let matched = false;
    list.forEach((side, i) => {
      const siteList = side.sites || [];
      siteList.forEach((s, j) => {
        if (!Number.isFinite(s.meters)) return;
        const d = Math.abs(s.meters - near);
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestSite = j;
          matched = true;
        }
      });
    });
    if (matched) {
      sideIndex = bestI;
      siteIndex = bestSite;
    }
  }

  function show() {
    visible = true;
    sideIndex = 0;
    siteIndex = 0;
    render();
    focusCurrent();
  }

  function hide() {
    visible = false;
    tourDriving = false;
    el.hidden = true;
    el.innerHTML = "";
    window.__MM_SCENE__?.clearPollutionSideFilter?.();
  }

  function onChainage(e) {
    if (!visible || tourDriving) return;
    if (e?.detail?.fromPollutionTour) return;
    // Manual ruler scrub — sync tour index, but do not re-fly
    syncIndexFromChainage();
    render();
  }

  function onFocusChange(e) {
    if (e?.detail?.kind === "pollution" && e?.detail?.on) show();
    else if (!e?.detail?.on || e?.detail?.kind !== "pollution") {
      if (visible && state.mapFocusKind !== "pollution") hide();
    }
  }

  document.addEventListener("chainage-select", onChainage);
  document.addEventListener("map-focus-change", onFocusChange);

  return {
    el,
    show,
    hide,
    refresh: render,
    isVisible: () => visible && !el.hidden,
    dispose() {
      document.removeEventListener("chainage-select", onChainage);
      document.removeEventListener("map-focus-change", onFocusChange);
      el.remove();
    },
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
