import { ChevronLeft, ChevronRight } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";

/**
 * Compact drainage navigator above the chainage ruler.
 * ‹  Name (D-n)  i / N  ›
 */
export function mountJoiningStreamsNav(root) {
  const el = document.createElement("div");
  el.className = "joining-streams-nav map-chrome";
  el.id = "joining-streams-nav";
  el.hidden = true;
  el.setAttribute("aria-label", "Joining streams navigation");
  el.innerHTML = `
    <button type="button" class="joining-streams-nav__btn" id="js-nav-prev" aria-label="Previous drainage">
      ${lucideHtml(ChevronLeft, { size: 18, strokeWidth: 2.25 })}
    </button>
    <div class="joining-streams-nav__body">
      <div class="joining-streams-nav__name" id="js-nav-name">—</div>
      <div class="joining-streams-nav__meta" id="js-nav-meta">0 / 0</div>
    </div>
    <button type="button" class="joining-streams-nav__btn" id="js-nav-next" aria-label="Next drainage">
      ${lucideHtml(ChevronRight, { size: 18, strokeWidth: 2.25 })}
    </button>
  `;
  root.appendChild(el);

  const nameEl = el.querySelector("#js-nav-name");
  const metaEl = el.querySelector("#js-nav-meta");

  el.querySelector("#js-nav-prev")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.__MM_SCENE__?.stepJoiningStream?.(-1);
  });
  el.querySelector("#js-nav-next")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.__MM_SCENE__?.stepJoiningStream?.(1);
  });

  function setVisible(on) {
    const show = !!on && !!state.joiningStreamsMode;
    el.hidden = !show;
    if (show) el.style.pointerEvents = "auto";
  }

  function update(rec, list = []) {
    const total = list.length || 0;
    if (!rec || !total) {
      if (nameEl) nameEl.textContent = "—";
      if (metaEl) metaEl.textContent = total ? `0 / ${total}` : "0 / 0";
      return;
    }
    const idx = (rec.navIndex ?? 0) + 1;
    if (nameEl) nameEl.textContent = rec.displayName || rec.name || rec.displayId || "—";
    if (metaEl) metaEl.textContent = `${idx} / ${total}`;
  }

  window.__MM_JOINING_NAV__ = { update, setVisible, el };

  return {
    el,
    update,
    setVisible,
    dispose() {
      el.remove();
      if (window.__MM_JOINING_NAV__?.el === el) delete window.__MM_JOINING_NAV__;
    },
  };
}
