import {
  Pickaxe,
  FlaskConical,
  Leaf,
  Droplets,
  Thermometer,
  Hexagon,
} from "lucide";
import { lucideHtml } from "../icons.js";

/**
 * Water Quality floating HUD — icon-only, no panel/card/title/labels.
 * Labels appear only on hover (CSS tooltips).
 *
 * Order: Salinity → Turbidity → NDCI → NDWI → WST → BOD–COD
 *
 * Salinity reuses the project’s Pickaxe mark (same stroke family as top-nav
 * Geology / reference salinity glyph) — not an emoji.
 */
export const WATER_QUALITY_OPTIONS = [
  {
    id: "salinity",
    tip: "Salinity",
    icon: Pickaxe,
    tone: "wq-tone-salinity",
    layerId: "salinity",
    fallbackLayerId: null,
  },
  {
    id: "tss",
    tip: "Turbidity / TSS",
    icon: FlaskConical,
    tone: "wq-tone-tss",
    layerId: "water_quality_tss",
    fallbackLayerId: null,
  },
  {
    id: "ndci",
    tip: "NDCI / Chlorophyll",
    icon: Leaf,
    tone: "wq-tone-ndci",
    layerId: "water_quality_ndci",
    fallbackLayerId: null,
  },
  {
    id: "ndwi",
    tip: "NDWI / Water Detection",
    icon: Droplets,
    tone: "wq-tone-ndwi",
    layerId: "water_quality_ndwi",
    fallbackLayerId: null,
  },
  {
    id: "wst",
    tip: "WST / Temperature",
    icon: Thermometer,
    tone: "wq-tone-wst",
    layerId: "water_quality_wst",
    fallbackLayerId: null,
  },
  {
    id: "bod_cod",
    tip: "BOD–COD / Organic Pollution",
    icon: Hexagon,
    tone: "wq-tone-bod",
    layerId: "water_quality_bod_cod",
    fallbackLayerId: "water_quality",
  },
];

/**
 * @param {HTMLElement} root
 * @param {{ onSelect?: (opt: object) => void|Promise<void>, onClose?: () => void }} [hooks]
 */
export function mountWaterQualityHud(root, hooks = {}) {
  const wrap = document.createElement("div");
  wrap.className = "wq-hud";
  wrap.id = "water-quality-hud";
  wrap.hidden = true;
  wrap.setAttribute("role", "toolbar");
  wrap.setAttribute("aria-label", "Water Quality metrics");

  wrap.innerHTML = `
    <div class="wq-hud__row">
      ${WATER_QUALITY_OPTIONS.map(
        (o) => `
        <button type="button"
          class="wq-hud__item ${o.tone}"
          data-wq="${o.id}"
          data-tip="${escapeAttr(o.tip)}"
          aria-label="${escapeAttr(o.tip)}"
          aria-pressed="false">
          <span class="wq-hud__icon" aria-hidden="true">${lucideHtml(o.icon, {
            size: 28,
            strokeWidth: 1.75,
            className: "wq-hud__svg",
          })}</span>
          <span class="wq-hud__dot" aria-hidden="true"></span>
        </button>`,
      ).join("")}
    </div>
    <p class="wq-hud__status" id="wq-hud-status" hidden></p>
  `;

  root.appendChild(wrap);

  const statusEl = wrap.querySelector("#wq-hud-status");
  let activeId = null;
  let open = false;

  function setActiveOption(id) {
    activeId = id;
    wrap.querySelectorAll(".wq-hud__item").forEach((btn) => {
      const on = btn.dataset.wq === id;
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

  wrap.querySelectorAll("[data-wq]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.wq;
      const opt = WATER_QUALITY_OPTIONS.find((o) => o.id === id);
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
  });

  function show() {
    open = true;
    wrap.hidden = false;
    void wrap.offsetWidth;
    wrap.classList.add("is-open");
    root.classList.add("water-quality-open");
  }

  function hide() {
    open = false;
    wrap.classList.remove("is-open");
    root.classList.remove("water-quality-open");
    activeId = null;
    setActiveOption(null);
    setStatus("");
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
