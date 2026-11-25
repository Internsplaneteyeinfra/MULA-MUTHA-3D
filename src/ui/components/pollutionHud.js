import { Atom, Fish, Trash2 } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import { unitFor } from "../../geo/layerUnits.js";

/**
 * Pollution floating HUD — icon-only; name on hover only (same chrome as Land Use).
 * Units = Mandovi RiverEye. Order: Garbage → Eutrophication → Nitrogen
 */
export const POLLUTION_OPTIONS = [
  {
    id: "garbage",
    tip: `Garbage / pollution severity (${unitFor("pollution_severity") || "class"})`,
    icon: Trash2,
    tone: "poll-tone-garbage",
    layerId: "pollution",
    unit: unitFor("pollution_severity") || "class",
  },
  {
    id: "eutrophication",
    tip: `Eutrophication (${unitFor("pollution_eutrophication") || "TSI"})`,
    icon: Fish,
    tone: "poll-tone-eutro",
    layerId: "pollution_eutrophication",
    unit: unitFor("pollution_eutrophication") || "TSI",
  },
  {
    id: "nitrogen",
    tip: `Nitrogen (${unitFor("pollution_nitrogen") || "class"} · not mg N/L)`,
    icon: Atom,
    tone: "poll-tone-nitrogen",
    layerId: "pollution_nitrogen",
    unit: unitFor("pollution_nitrogen") || "class",
  },
];

/**
 * @param {HTMLElement} root
 * @param {{ onSelect?: (opt: object) => void|Promise<void>, onClose?: () => void }} [hooks]
 */
export function mountPollutionHud(root, hooks = {}) {
  const wrap = document.createElement("div");
  wrap.className = "poll-hud";
  wrap.id = "pollution-hud";
  wrap.hidden = true;
  wrap.setAttribute("role", "toolbar");
  wrap.setAttribute("aria-label", "Pollution layers");

  wrap.innerHTML = `
    <div class="poll-hud__row">
      ${POLLUTION_OPTIONS.map(
        (o) => `
        <button type="button"
          class="poll-hud__item ${o.tone}"
          data-poll="${o.id}"
          data-tip="${escapeAttr(o.tip)}"
          aria-label="${escapeAttr(o.tip)}"
          aria-pressed="false">
          <span class="poll-hud__icon" aria-hidden="true">${lucideHtml(o.icon, {
            size: 26,
            strokeWidth: 1.75,
            className: "poll-hud__svg",
          })}</span>
          <span class="poll-hud__dot" aria-hidden="true"></span>
        </button>`,
      ).join("")}
    </div>
    <p class="poll-hud__status" id="poll-hud-status" hidden></p>
  `;

  root.appendChild(wrap);

  const statusEl = wrap.querySelector("#poll-hud-status");
  let activeId = null;
  let open = false;

  function setActiveOption(id) {
    activeId = id;
    wrap.querySelectorAll(".poll-hud__item").forEach((btn) => {
      const on = btn.dataset.poll === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setStatus(html, { unavailable = false } = {}) {
    if (!statusEl) return;
    if (!html) {
      statusEl.hidden = true;
      statusEl.innerHTML = "";
      statusEl.classList.remove("is-unavail");
      return;
    }
    statusEl.hidden = false;
    statusEl.classList.toggle("is-unavail", !!unavailable);
    statusEl.innerHTML = html;
  }

  function positionUnderPollutionIcon() {
    // Horizontal centering only — vertical stack is owned by chainageStepHud
    // (SUB_ROW_SELECTORS includes .poll-hud) so we never sit on top of 8+790.
    wrap.style.left = "50%";
    wrap.style.transform = "translateX(-50%)";
    if (
      state.mapFocusKind === "pollution" ||
      root.classList.contains("pollution-focus")
    ) {
      wrap.classList.add("poll-hud--top");
      return;
    }
    wrap.classList.remove("poll-hud--top");
    // Clear any stale inline top so the stacker can place us below analytics.
    wrap.style.removeProperty("top");
  }

  wrap.querySelectorAll("[data-poll]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.poll;
      const opt = POLLUTION_OPTIONS.find((o) => o.id === id);
      if (!opt) return;
      setStatus("");
      try {
        await hooks.onSelect?.(opt);
      } catch (err) {
        setStatus(
          `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(err?.message || String(err))}</span>`,
          { unavailable: true },
        );
      }
      positionUnderPollutionIcon();
    });
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  });

  function onResize() {
    if (open) positionUnderPollutionIcon();
  }

  function onFocusChange() {
    if (open) positionUnderPollutionIcon();
  }

  function show() {
    open = true;
    wrap.hidden = false;
    void wrap.offsetWidth;
    wrap.classList.add("is-open");
    root.classList.add("pollution-hud-open");
    positionUnderPollutionIcon();
    // Let chainageStepHud restack under .poll-hud (MutationObserver + explicit nudge)
    window.dispatchEvent(new Event("resize"));
    window.addEventListener("resize", onResize);
    document.addEventListener("map-focus-change", onFocusChange);
  }

  function hide() {
    open = false;
    wrap.classList.remove("is-open", "poll-hud--top");
    root.classList.remove("pollution-hud-open");
    activeId = null;
    setActiveOption(null);
    setStatus("");
    window.removeEventListener("resize", onResize);
    document.removeEventListener("map-focus-change", onFocusChange);
    window.setTimeout(() => {
      if (!open) wrap.hidden = true;
    }, 220);
    hooks.onClose?.();
  }

  return {
    el: wrap,
    show,
    hide,
    isOpen: () => open,
    setActiveOption,
    setStatus,
    getActiveId: () => activeId,
    reposition: positionUnderPollutionIcon,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
