import {
  Waves,
  FlaskConical,
  LeafyGreen,
  Hexagon,
  Bug,
} from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import { unitFor } from "../../geo/layerUnits.js";

/**
 * Water Quality floating HUD — same icon-only chrome as Land Use.
 * Labels appear only on hover (CSS tooltips). Units = Mandovi RiverEye.
 *
 * Order: Salinity → TSS → Chlorophyll-a → Coliform → BOD–COD
 */
export const WATER_QUALITY_OPTIONS = [
  {
    id: "salinity",
    tip: `Salinity (${unitFor("salinity") || "ppt"})`,
    icon: Waves,
    tone: "wq-tone-salinity",
    layerId: "salinity",
    fallbackLayerId: null,
    unit: unitFor("salinity") || "ppt",
  },
  {
    id: "tss",
    tip: `TSS / Turbidity (${unitFor("water_quality_tss") || "mg/L"})`,
    icon: FlaskConical,
    tone: "wq-tone-tss",
    layerId: "water_quality_tss",
    fallbackLayerId: null,
    unit: unitFor("water_quality_tss") || "mg/L",
  },
  {
    id: "ndci",
    tip: `Chlorophyll-a / NDCI (${unitFor("water_quality_ndci") || "index"})`,
    icon: LeafyGreen,
    tone: "wq-tone-ndci",
    layerId: "water_quality_ndci",
    fallbackLayerId: null,
    unit: unitFor("water_quality_ndci") || "index",
  },
  {
    id: "coliform",
    tip: `Coliform / E. coli (${unitFor("water_quality_coliform") || "CFU/100 ml"})`,
    icon: Bug,
    tone: "wq-tone-coliform",
    layerId: "water_quality_coliform",
    fallbackLayerId: null,
    unit: unitFor("water_quality_coliform") || "CFU/100 ml",
  },
  {
    id: "bod_cod",
    tip: `BOD–COD (${unitFor("bod") || "mg/L"} · class A–E)`,
    icon: Hexagon,
    tone: "wq-tone-bod",
    layerId: "water_quality_bod_cod",
    fallbackLayerId: "water_quality",
    unit: unitFor("bod") || "mg/L",
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
            size: 26,
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

  function positionUnderWaterQualityIcon() {
    // When a WQ layer is active, lift icons to the top bar slot (same as Land Use)
    if (
      state.mapFocusKind === "waterquality" ||
      root.classList.contains("water-quality-focus")
    ) {
      wrap.classList.add("wq-hud--top");
      wrap.style.left = "50%";
      wrap.style.top = `calc(max(14px, env(safe-area-inset-top)) + 12px)`;
      wrap.style.transform = "translateX(-50%)";
      return;
    }
    wrap.classList.remove("wq-hud--top");
    wrap.style.transform = "";
    const btn = document.querySelector(
      '.analytics-controls [data-analytics="Water Quality"], .analytics-controls [data-analytics="hydrology"]',
    );
    if (!btn || btn.offsetParent === null) {
      wrap.style.left = "50%";
      wrap.style.top = "calc(max(14px, env(safe-area-inset-top)) + 62px)";
      wrap.style.transform = "translateX(-50%)";
      return;
    }
    const r = btn.getBoundingClientRect();
    wrap.style.left = "50%";
    // Keep clear of the nav tooltip / caret under the droplet
    wrap.style.top = `${Math.round(r.bottom + 22)}px`;
    wrap.style.transform = "translateX(-50%)";
  }

  wrap.querySelectorAll("[data-wq]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
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
      positionUnderWaterQualityIcon();
    });
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  });

  function onResize() {
    if (open) positionUnderWaterQualityIcon();
  }

  function onFocusChange() {
    if (open) positionUnderWaterQualityIcon();
  }

  function show() {
    open = true;
    positionUnderWaterQualityIcon();
    wrap.hidden = false;
    void wrap.offsetWidth;
    wrap.classList.add("is-open");
    root.classList.add("water-quality-open");
    window.addEventListener("resize", onResize);
    document.addEventListener("map-focus-change", onFocusChange);
  }

  function hide() {
    open = false;
    wrap.classList.remove("is-open", "wq-hud--top");
    root.classList.remove("water-quality-open");
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
    reposition: positionUnderWaterQualityIcon,
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
