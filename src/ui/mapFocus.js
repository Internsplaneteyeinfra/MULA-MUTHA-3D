import { state } from "../state.js";

/**
 * Shared map-focus chrome helpers (Land Use / Geology / Pollution).
 * Hides brand/weather/analytics/tools; keeps chainage + river data + theme chips.
 */

const KIND_CLASS = {
  landuse: "land-use-focus",
  geology: "geology-focus",
  pollution: "pollution-focus",
  bodcod: "bod-cod-focus",
  climate: "climate-focus",
  waterquality: "water-quality-focus",
  aqi: "aqi-focus",
};

export function enterMapFocus(root, kind) {
  const prev = state.mapFocusKind;
  if (prev && prev !== kind) {
    root.classList.remove(KIND_CLASS[prev]);
  }
  state.mapFocusKind = kind;
  state.landUseFocusMode = kind === "landuse";
  root.classList.add("map-focus");
  if (KIND_CLASS[kind]) root.classList.add(KIND_CLASS[kind]);
  // Clear peer focus kinds
  for (const [k, cls] of Object.entries(KIND_CLASS)) {
    if (k !== kind) root.classList.remove(cls);
  }
  document.dispatchEvent(new CustomEvent("river-measure-clear"));
  document.dispatchEvent(
    new CustomEvent("map-focus-change", { detail: { on: true, kind } }),
  );
  // Keep legacy event for Land Use HUD reposition listeners
  if (kind === "landuse") {
    document.dispatchEvent(
      new CustomEvent("land-use-focus-change", { detail: { on: true } }),
    );
  }
}

export function exitMapFocus(root, kind = null) {
  const cur = state.mapFocusKind;
  if (kind && cur && kind !== cur) return;
  state.mapFocusKind = null;
  state.landUseFocusMode = false;
  state.landUseSelectedClass = null;
  root.classList.remove(
    "map-focus",
    "land-use-focus",
    "geology-focus",
    "pollution-focus",
    "bod-cod-focus",
    "climate-focus",
    "water-quality-focus",
    "aqi-focus",
  );
  document.dispatchEvent(
    new CustomEvent("map-focus-change", { detail: { on: false, kind: cur } }),
  );
  document.dispatchEvent(
    new CustomEvent("land-use-focus-change", { detail: { on: false } }),
  );
}

/**
 * Top class letter chips + Back button (shared by Geology / Pollution / optional LU).
 */
export function mountFocusThemeHud(root, hooks = {}) {
  const backEl = document.createElement("button");
  backEl.type = "button";
  backEl.className = "lu-theme-back map-chrome focus-theme-back";
  backEl.hidden = true;
  backEl.setAttribute("aria-label", "Back");
  backEl.innerHTML = `<span class="lu-theme-back-arrow" aria-hidden="true">←</span><span>Back</span>`;
  root.appendChild(backEl);

  const classesEl = document.createElement("div");
  classesEl.className = "lu-theme-classes map-chrome focus-theme-classes";
  classesEl.hidden = true;
  classesEl.setAttribute("role", "list");
  classesEl.setAttribute("aria-label", "Layer classes");
  root.appendChild(classesEl);

  const extraEl = document.createElement("div");
  extraEl.className = "focus-theme-extra map-chrome";
  extraEl.hidden = true;
  root.appendChild(extraEl);

  let kind = null;
  let selectedLabel = null;

  function syncSelection() {
    classesEl.querySelectorAll(".lu-theme-class").forEach((btn) => {
      const on = selectedLabel && btn.dataset.label === selectedLabel;
      btn.classList.toggle("is-selected", !!on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    classesEl.classList.toggle("has-selection", !!selectedLabel);
    state.landUseSelectedClass = selectedLabel;
  }

  function letterKey(label, explicit) {
    if (explicit) return String(explicit).slice(0, 2).toUpperCase();
    const s = String(label || "").trim();
    if (/^density\s+low/i.test(s)) return "L";
    if (/^density\s+med/i.test(s)) return "M";
    if (/^density\s+high/i.test(s)) return "H";
    if (/garbage/i.test(s)) return "G";
    if (/no erosion/i.test(s)) return "N";
    if (/low erosion/i.test(s)) return "L";
    if (/moderate/i.test(s)) return "M";
    if (/very high/i.test(s)) return "V";
    if (/high erosion/i.test(s)) return "H";
    if (/basaltic/i.test(s)) return "B";
    if (/weathered/i.test(s)) return "R";
    if (/alluvial/i.test(s)) return "A";
    if (/ferruginous/i.test(s)) return "F";
    if (/clay/i.test(s)) return "C";
    if (/silica/i.test(s)) return "S";
    if (/mixed/i.test(s)) return "X";
    if (/^water$/i.test(s)) return "W";
    if (/^\d/.test(s)) {
      const m = s.match(/(\d+\.\d+)/);
      return m ? m[1].slice(-1) : (s.charAt(0) || "?").toUpperCase();
    }
    if (/fresh/i.test(s)) return "F";
    if (/brack/i.test(s)) return "B";
    if (/saline|salt/i.test(s)) return "S";
    if (/turbid|tss/i.test(s)) return "T";
    if (/chloro|ndci/i.test(s)) return "C";
    if (/temp|wst/i.test(s)) return "W";
    return (s.charAt(0) || "?").toUpperCase();
  }

  /** Prefer % / range text on the chip; keep human names for hover only. */
  function scaleDisplayText(c) {
    const pct = String(c?.pct || "").trim();
    if (pct) return pct;
    const range = String(c?.range || "").trim();
    if (range) return range;
    const label = String(c?.label || c?.id || "").trim();
    // Already-numeric labels (bathymetry depths, silt volume ramp)
    if (/^[<>~]?\d/.test(label) || /\d+\s*[–\-m%]/.test(label)) return label;
    return null;
  }

  function showClasses(classes, focusKind, { extraHtml = "", legendOnly = false } = {}) {
    kind = focusKind;
    selectedLabel = null;
    state.landUseSelectedClass = null;
    enterMapFocus(root, focusKind);
    backEl.hidden = false;

    // Geology / WQ / explicit legend: chips are scale only — no select / filter / dim
    const noSelect =
      legendOnly ||
      focusKind === "geology" ||
      focusKind === "waterquality" ||
      focusKind === "landuse";

    const list = Array.isArray(classes) ? classes : [];
    const preferScale =
      focusKind === "waterquality" ||
      focusKind === "geology" ||
      focusKind === "landuse";
    if (!list.length) {
      classesEl.hidden = true;
      classesEl.innerHTML = "";
      classesEl.classList.remove("is-numeric-scale", "is-legend-only", "has-selection");
      root.classList.remove("lu-theme-classes-open");
    } else {
      const anyScale = preferScale && list.some((c) => !!scaleDisplayText(c));
      classesEl.classList.toggle("is-numeric-scale", anyScale || focusKind === "waterquality");
      classesEl.classList.toggle("is-legend-only", noSelect);
      classesEl.classList.remove("has-selection");
      classesEl.innerHTML = list
        .map((c) => {
          const filterLabel = c.label || c.id || "—";
          const scaleText = preferScale ? scaleDisplayText(c) : null;
          const displayName = scaleText || (preferScale ? "" : filterLabel);
          const key = letterKey(filterLabel, c.key);
          const color = c.color || "#888";
          const tip = scaleText ? `${filterLabel} · ${scaleText}` : filterLabel;
          const tag = noSelect ? "div" : "button";
          const interactiveAttrs = noSelect
            ? `role="listitem" tabindex="0"`
            : `type="button" role="listitem" aria-pressed="false"`;
          return `
          <${tag} class="lu-theme-class${scaleText ? " is-numeric" : ""}${noSelect ? " is-legend-chip" : ""}"
            data-label="${escapeAttr(filterLabel)}"
            style="--lu-class-color:${escapeAttr(color)}"
            title="${escapeAttr(tip)}"
            aria-label="${escapeAttr(tip)}"
            ${interactiveAttrs}>
            <span class="lu-theme-class-letter">${escapeHtml(key)}</span>
            <span class="lu-theme-class-name">${escapeHtml(displayName)}</span>
          </${tag}>`;
        })
        .join("");
      classesEl.hidden = false;
      root.classList.add("lu-theme-classes-open");
      if (!noSelect) {
        classesEl.querySelectorAll(".lu-theme-class").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const label = btn.dataset.label;
            selectedLabel = selectedLabel === label ? null : label;
            document.dispatchEvent(new CustomEvent("river-measure-clear"));
            syncSelection();
            hooks.onClassSelect?.(selectedLabel);
          });
        });
      }
    }

    if (extraHtml) {
      extraEl.innerHTML = extraHtml;
      extraEl.hidden = false;
      hooks.bindExtra?.(extraEl);
    } else {
      extraEl.hidden = true;
      extraEl.innerHTML = "";
    }
  }

  function handleBack() {
    document.dispatchEvent(new CustomEvent("river-measure-clear"));
    // Never use selection as a two-step back — chips are legend-only for geology/WQ
    if (selectedLabel) {
      selectedLabel = null;
      syncSelection();
      hooks.onClassSelect?.(null);
    }
    const k = kind;
    hide();
    hooks.onBack?.(k);
  }

  backEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleBack();
  });

  function hide() {
    const k = kind;
    // Idle instance: never clear peer focus / shared root classes
    if (!k) {
      classesEl.hidden = true;
      classesEl.innerHTML = "";
      classesEl.classList.remove("is-numeric-scale", "is-legend-only", "has-selection");
      extraEl.hidden = true;
      extraEl.innerHTML = "";
      backEl.hidden = true;
      return;
    }
    kind = null;
    selectedLabel = null;
    state.landUseSelectedClass = null;
    classesEl.hidden = true;
    classesEl.innerHTML = "";
    classesEl.classList.remove("is-numeric-scale", "is-legend-only", "has-selection");
    extraEl.hidden = true;
    extraEl.innerHTML = "";
    backEl.hidden = true;
    root.classList.remove("lu-theme-classes-open");
    exitMapFocus(root, k);
  }

  return {
    showClasses,
    hide,
    backEl,
    classesEl,
    isVisible: () => !backEl.hidden,
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
