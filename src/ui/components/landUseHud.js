import { Building2, Layers, Mountain, Trees } from "lucide";
import { lucideHtml } from "../icons.js";

/**
 * Land Use floating HUD — icon-only, no panel/card/title/labels.
 * Labels appear only on hover (CSS tooltips).
 *
 * Order: LULC → Silt Classification → Silt Volume Surface → Vegetation Extent
 */
export const LAND_USE_OPTIONS = [
  {
    id: "lulc",
    tip: "LULC",
    icon: Building2,
    tone: "lu-tone-lulc",
    layerId: "landuse_lulc",
    fallbackLayerId: null,
  },
  {
    id: "silt_classification",
    tip: "Silt Classification",
    icon: Layers,
    tone: "lu-tone-silt",
    layerId: "silt_classification",
    fallbackLayerId: null,
  },
  {
    id: "silt_volume_surface",
    tip: "Silt Volume Surface",
    icon: Mountain,
    tone: "lu-tone-volume",
    layerId: "silt_volume_surface",
    fallbackLayerId: null,
  },
  {
    id: "vegetation_extent",
    tip: "Vegetation Extent",
    icon: Trees,
    tone: "lu-tone-veg",
    layerId: "vegetation_extent",
    fallbackLayerId: null,
  },
];

/**
 * @param {HTMLElement} root
 * @param {{ onSelect?: (opt: object) => void|Promise<void>, onClose?: () => void }} [hooks]
 */
export function mountLandUseHud(root, hooks = {}) {
  const wrap = document.createElement("div");
  wrap.className = "lu-hud";
  wrap.id = "land-use-hud";
  wrap.hidden = true;
  wrap.setAttribute("role", "toolbar");
  wrap.setAttribute("aria-label", "Land Use layers");

  wrap.innerHTML = `
    <div class="lu-hud__row">
      ${LAND_USE_OPTIONS.map(
        (o) => `
        <button type="button"
          class="lu-hud__item ${o.tone}"
          data-lu="${o.id}"
          data-tip="${escapeAttr(o.tip)}"
          aria-label="${escapeAttr(o.tip)}"
          aria-pressed="false">
          <span class="lu-hud__icon" aria-hidden="true">${lucideHtml(o.icon, {
            size: 26,
            strokeWidth: 1.75,
            className: "lu-hud__svg",
          })}</span>
          <span class="lu-hud__dot" aria-hidden="true"></span>
        </button>`,
      ).join("")}
    </div>
    <p class="lu-hud__status" id="lu-hud-status" hidden></p>
  `;

  root.appendChild(wrap);

  const statusEl = wrap.querySelector("#lu-hud-status");
  let activeId = null;
  let open = false;

  function setActiveOption(id) {
    activeId = id;
    wrap.querySelectorAll(".lu-hud__item").forEach((btn) => {
      const on = btn.dataset.lu === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /** Status only after a click (unavailable / errors) — never permanent under icons. */
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

  function positionUnderLandUseIcon() {
    const btn = document.querySelector('.analytics-controls [data-analytics="Land Use"]');
    if (!btn) {
      wrap.style.left = "50%";
      wrap.style.top = "calc(max(14px, env(safe-area-inset-top)) + 62px)";
      return;
    }
    const r = btn.getBoundingClientRect();
    wrap.style.left = `${Math.round(r.left + r.width / 2)}px`;
    wrap.style.top = `${Math.round(r.bottom + 12)}px`;
  }

  wrap.querySelectorAll("[data-lu]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.lu;
      const opt = LAND_USE_OPTIONS.find((o) => o.id === id);
      if (!opt) return;
      setActiveOption(id);
      setStatus("");
      try {
        await hooks.onSelect?.(opt);
      } catch (err) {
        setStatus(
          `<strong>DATA UNAVAILABLE</strong><span>${escapeHtml(err?.message || String(err))}</span>`,
          { unavailable: true },
        );
      }
    });
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  });

  function onResize() {
    if (open) positionUnderLandUseIcon();
  }

  function show() {
    open = true;
    positionUnderLandUseIcon();
    wrap.hidden = false;
    void wrap.offsetWidth;
    wrap.classList.add("is-open");
    root.classList.add("land-use-open");
    window.addEventListener("resize", onResize);
  }

  function hide() {
    open = false;
    wrap.classList.remove("is-open");
    root.classList.remove("land-use-open");
    activeId = null;
    setActiveOption(null);
    setStatus("");
    window.removeEventListener("resize", onResize);
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
    reposition: positionUnderLandUseIcon,
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
