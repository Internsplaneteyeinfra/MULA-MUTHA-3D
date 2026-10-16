/**
 * Flood Compare — pick two JalNetra catalog dates and compare API metrics
 * (flood area, water area, water rise when present).
 */
import { validYmd, fmtYmd, fmtHa, fmtRiseMm, validNumber } from "../floodFieldFormat.js";

const STYLE_ID = "flood-compare-style";
const STYLE = `
.flood-compare{position:relative;left:auto;bottom:auto;z-index:26;width:100%;
  max-height:min(48vh,420px);box-sizing:border-box;display:flex;flex-direction:column;border-radius:12px;color:#e2e8f0;
  background:rgba(8,18,30,.78);border:1px solid rgba(80,190,220,.22);backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);font:inherit;font-size:11px;line-height:1.35;overflow:hidden;
  box-shadow:0 8px 24px rgba(0,0,0,.28)}
.flood-compare[hidden],.flood-legend[hidden]{display:none!important}
.flood-compare__top{display:flex;align-items:center;gap:8px;padding:8px 10px}
.flood-compare__head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0;
  background:transparent;border:0;color:inherit;font:inherit;font-size:10px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;cursor:pointer;text-align:left;flex:1;min-width:0}
.flood-compare__chev{transition:transform .2s;color:#22d3ee}
.flood-compare[data-open="true"] .flood-compare__chev{transform:rotate(180deg)}
.flood-compare__body{display:none;overflow-y:auto;padding:0 10px 10px;min-height:0}
.flood-compare[data-open="true"] .flood-compare__body{display:block}
.flood-compare__picks{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px}
.flood-compare__pick{display:flex;flex-direction:column;gap:4px;min-width:0}
.flood-compare__pick label{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:rgba(148,163,184,.95)}
.flood-compare__pick select{width:100%;height:26px;padding:0 8px;border-radius:7px;
  border:1px solid rgba(80,190,220,.28);background:rgba(10,24,38,.85);color:#e2e8f0;font:inherit;font-size:10px}
.flood-compare__hint{margin:8px 0 0;color:rgba(226,232,240,.65);font-size:10px}
.flood-compare__result{margin-top:8px;padding-top:8px;border-top:1px solid rgba(148,163,184,.16)}
.flood-compare__verdict{margin:0 0 8px;font-size:11px;font-weight:600;color:#67e8f9;line-height:1.4}
.flood-compare__verdict.is-tie{color:#94a3b8}
.flood-compare__verdict.is-empty{color:rgba(226,232,240,.55);font-weight:500}
.flood-compare__metrics{display:grid;gap:5px}
.flood-compare__row{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.95fr) minmax(0,.95fr) minmax(0,1fr);
  gap:4px;align-items:baseline;padding:3px 0;border-bottom:1px solid rgba(148,163,184,.1);font-size:10px}
.flood-compare__row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.flood-compare__row .k{color:rgba(148,163,184,.95)}
.flood-compare__row .a,.flood-compare__row .b{text-align:right;font-variant-numeric:tabular-nums;color:#f1f5f9;font-weight:600}
.flood-compare__row .d{text-align:right;font-variant-numeric:tabular-nums;color:#a5f3fc;font-weight:600}
.flood-compare__row.is-head{border-bottom-color:rgba(80,190,220,.22);padding-bottom:4px}
.flood-compare__row.is-head span{font-size:9px;letter-spacing:.04em;text-transform:uppercase;font-weight:600;color:rgba(186,198,214,.9)}
.flood-compare__row .is-high{color:#4ade80}
.flood-legend{position:fixed;right:84px;bottom:112px;z-index:18;box-sizing:border-box;max-width:min(200px,45vw);white-space:nowrap;padding:7px 10px;
  border-radius:8px;background:rgba(8,22,31,.42);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(8px);
  color:rgba(235,245,250,.92);font-size:10px;line-height:1.5;text-shadow:0 1px 3px rgba(0,0,0,.85)}
.flood-legend strong{display:block;font-size:9px;letter-spacing:.12em;margin-bottom:3px}
.flood-legend i{display:inline-block;width:12px;height:8px;border-radius:2px;margin-right:6px;vertical-align:middle}
@media (max-width:1100px){.flood-legend .fl-val{display:none}}
`;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Prefer API rise (m); values > 20 treated as mm. */
function sceneRiseMm(scene) {
  const raw =
    validNumber(scene?.water_rise) ??
    validNumber(scene?.waterLevelData?.waterRise) ??
    null;
  if (raw == null) return null;
  const m = raw > 20 ? raw / 1000 : raw;
  return Math.round(m * 1000);
}

function sceneMetrics(scene) {
  if (!scene) return null;
  const floodHa = validNumber(scene.flood_area_ha) ?? validNumber(scene.floodExtent?.floodAreaHa);
  const waterHa = validNumber(scene.water_area_ha) ?? validNumber(scene.floodExtent?.waterAreaHa);
  const riseMm = sceneRiseMm(scene);
  const totalHa =
    floodHa != null || waterHa != null ? (floodHa || 0) + (waterHa || 0) : null;
  return {
    date: validYmd(scene.date) || validYmd(scene.post_date),
    floodHa,
    waterHa,
    totalHa,
    riseMm,
  };
}

function fmtSignedHa(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)} ha`;
}

function fmtSignedMm(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const a = Math.abs(n);
  return a >= 1000 ? `${sign}${(a / 1000).toFixed(2)} m` : `${sign}${Math.round(a)} mm`;
}

function avg(a, b) {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return (a + b) / 2;
}

export function mountFloodComparePanel(root, { dataset: _dataset } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  const panel = document.createElement("aside");
  panel.className = "flood-compare";
  panel.dataset.open = "false";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Flood comparison");
  panel.innerHTML = `
    <div class="flood-compare__top">
      <button type="button" class="flood-compare__head" aria-expanded="false">
        <span>Flood Compare</span><span class="flood-compare__chev" aria-hidden="true">▾</span>
      </button>
    </div>
    <div class="flood-compare__body">
      <div class="flood-compare__picks">
        <div class="flood-compare__pick">
          <label for="fc-date-a">Date A</label>
          <select id="fc-date-a" aria-label="Compare date A"></select>
        </div>
        <div class="flood-compare__pick">
          <label for="fc-date-b">Date B</label>
          <select id="fc-date-b" aria-label="Compare date B"></select>
        </div>
      </div>
      <p class="flood-compare__hint" id="fc-hint">Select two available JalNetra dates to compare.</p>
      <div class="flood-compare__result" id="fc-result" hidden></div>
    </div>`;

  const uiRoot = root.closest?.("#ui-root") || document.getElementById("ui-root") || root;
  root.appendChild(panel);

  const legend = document.createElement("aside");
  legend.className = "flood-legend";
  legend.hidden = true;
  legend.setAttribute("aria-label", "Flood area legend");
  uiRoot.appendChild(legend);

  const head = panel.querySelector(".flood-compare__head");
  const selA = panel.querySelector("#fc-date-a");
  const selB = panel.querySelector("#fc-date-b");
  const hint = panel.querySelector("#fc-hint");
  const resultEl = panel.querySelector("#fc-result");

  /** @type {any | null} */
  let catalog = null;

  const GAP = 10;
  const visibleRect = (el) => {
    if (!el || el.hidden || el.closest("[hidden]")) return null;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };
  let layoutRaf = 0;
  function layout() {
    layoutRaf = 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ruler = visibleRect(document.getElementById("chainage-ruler"));
    const clearBottom = ruler ? vh - ruler.top + GAP : 112;
    const dl = visibleRect(document.getElementById("depth-legend"));
    if (dl) {
      legend.style.right = `${Math.max(0, Math.round(vw - dl.right))}px`;
      legend.style.bottom = `${Math.round(vh - dl.top + GAP)}px`;
    } else {
      legend.style.right = "84px";
      legend.style.bottom = `${Math.round(clearBottom)}px`;
    }
  }
  const scheduleLayout = () => {
    if (!layoutRaf) layoutRaf = requestAnimationFrame(layout);
  };
  window.addEventListener("resize", scheduleLayout);
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(scheduleLayout);
    for (const id of ["chainage-ruler", "depth-legend"]) {
      const el = document.getElementById(id);
      if (el) ro.observe(el);
    }
    setTimeout(() => {
      for (const id of ["chainage-ruler", "depth-legend"]) {
        const el = document.getElementById(id);
        if (el) ro.observe(el);
      }
      scheduleLayout();
    }, 1500);
  }

  function verifiedScenes() {
    return (catalog?.scenes || []).filter((s) => validYmd(s?.date));
  }

  function sceneFor(ymd) {
    return verifiedScenes().find((s) => s.date === ymd) || null;
  }

  function fillSelect(sel, prefer) {
    const dates = verifiedScenes()
      .map((s) => s.date)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    const prev = prefer || sel.value;
    sel.innerHTML = "";
    if (!dates.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No dates";
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    for (const ymd of dates) {
      const opt = document.createElement("option");
      opt.value = ymd;
      opt.textContent = fmtYmd(ymd, true) || ymd;
      sel.appendChild(opt);
    }
    if (prev && dates.includes(prev)) sel.value = prev;
    else if (dates.length >= 2 && sel === selB) sel.value = dates[1];
    else sel.value = dates[0];
  }

  function setOpen(open) {
    panel.dataset.open = open ? "true" : "false";
    head.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) renderCompare();
    scheduleLayout();
  }
  head.addEventListener("click", () => setOpen(panel.dataset.open !== "true"));

  function renderCompare() {
    const dates = verifiedScenes();
    if (!dates.length) {
      hint.textContent = "No JalNetra flood dates available yet.";
      resultEl.hidden = true;
      resultEl.innerHTML = "";
      return;
    }

    const aYmd = validYmd(selA.value);
    const bYmd = validYmd(selB.value);
    const a = sceneMetrics(sceneFor(aYmd));
    const b = sceneMetrics(sceneFor(bYmd));

    if (!a || !b) {
      hint.textContent = "Select two available dates to compare.";
      resultEl.hidden = true;
      return;
    }

    if (aYmd === bYmd) {
      hint.textContent = "Pick two different dates for a comparison.";
      resultEl.hidden = true;
      return;
    }

    hint.textContent = "Comparison uses catalog metrics from JalNetra (extent areas; rise only when the API provides it).";

    const dFlood = a.floodHa != null && b.floodHa != null ? b.floodHa - a.floodHa : null;
    const dWater = a.waterHa != null && b.waterHa != null ? b.waterHa - a.waterHa : null;
    const dTotal = a.totalHa != null && b.totalHa != null ? b.totalHa - a.totalHa : null;
    const dRise = a.riseMm != null && b.riseMm != null ? b.riseMm - a.riseMm : null;

    const avgFlood = avg(a.floodHa, b.floodHa);
    const avgWater = avg(a.waterHa, b.waterHa);
    const avgRise = avg(a.riseMm, b.riseMm);

    // Primary “which is higher” from flood extent (API), then water area, then rise.
    let verdict = "";
    let verdictClass = "";
    const primary = dFlood != null ? { key: "flood area", delta: dFlood, unit: "ha" }
      : dWater != null ? { key: "water area", delta: dWater, unit: "ha" }
        : dRise != null ? { key: "water rise", delta: dRise, unit: "mm" }
          : null;

    if (!primary) {
      verdict = "Both dates are in the catalog, but no comparable numeric fields were returned.";
      verdictClass = "is-empty";
    } else if (Math.abs(primary.delta) < 1e-6) {
      verdict = `Same ${primary.key} on both dates.`;
      verdictClass = "is-tie";
    } else if (primary.delta > 0) {
      const amount =
        primary.unit === "mm" ? fmtSignedMm(primary.delta) : fmtSignedHa(primary.delta);
      verdict = `${fmtYmd(bYmd, true)} is higher in ${primary.key} by ${amount.replace(/^[+−]/, "")}.`;
    } else {
      const amount =
        primary.unit === "mm" ? fmtSignedMm(-primary.delta) : fmtSignedHa(-primary.delta);
      verdict = `${fmtYmd(aYmd, true)} is higher in ${primary.key} by ${amount.replace(/^[+−]/, "")}.`;
    }

    if (dRise != null && Math.abs(dRise) >= 1 && primary?.unit !== "mm") {
      const higher = dRise > 0 ? fmtYmd(bYmd, false) : fmtYmd(aYmd, false);
      verdict += ` Water rise is higher on ${higher} by ${fmtSignedMm(Math.abs(dRise)).replace(/^[+−]/, "")}.`;
    }

    const labelA = fmtYmd(aYmd, false) || "A";
    const labelB = fmtYmd(bYmd, false) || "B";

    const row = (label, va, vb, diff, { highA, highB } = {}) => {
      const aCls = highA ? " a is-high" : " a";
      const bCls = highB ? " b is-high" : " b";
      return `<div class="flood-compare__row"><span class="k">${esc(label)}</span><span class="${aCls.trim()}">${esc(va)}</span><span class="${bCls.trim()}">${esc(vb)}</span><span class="d">${esc(diff)}</span></div>`;
    };

    resultEl.hidden = false;
    resultEl.innerHTML = `
      <p class="flood-compare__verdict ${verdictClass}">${esc(verdict)}</p>
      <div class="flood-compare__metrics">
        <div class="flood-compare__row is-head">
          <span class="k">Metric</span><span class="a">${esc(labelA)}</span><span class="b">${esc(labelB)}</span><span class="d">Δ B−A</span>
        </div>
        ${row(
          "Flood area",
          fmtHa(a.floodHa) || "—",
          fmtHa(b.floodHa) || "—",
          fmtSignedHa(dFlood),
          {
            highA: dFlood != null && dFlood < 0,
            highB: dFlood != null && dFlood > 0,
          },
        )}
        ${row(
          "Water area",
          fmtHa(a.waterHa) || "—",
          fmtHa(b.waterHa) || "—",
          fmtSignedHa(dWater),
          {
            highA: dWater != null && dWater < 0,
            highB: dWater != null && dWater > 0,
          },
        )}
        ${row(
          "Total wet",
          fmtHa(a.totalHa) || "—",
          fmtHa(b.totalHa) || "—",
          fmtSignedHa(dTotal),
          {
            highA: dTotal != null && dTotal < 0,
            highB: dTotal != null && dTotal > 0,
          },
        )}
        ${row(
          "Water rise",
          fmtRiseMm(a.riseMm) || "—",
          fmtRiseMm(b.riseMm) || "—",
          fmtSignedMm(dRise),
          {
            highA: dRise != null && dRise < 0,
            highB: dRise != null && dRise > 0,
          },
        )}
        ${row("Avg flood area", fmtHa(avgFlood) || "—", "·", "—")}
        ${row("Avg water area", fmtHa(avgWater) || "—", "·", "—")}
        ${row("Avg water rise", fmtRiseMm(avgRise) || "—", "·", "—")}
      </div>`;
  }

  function setCatalog(next) {
    catalog = next || null;
    const dates = verifiedScenes().map((s) => s.date);
    fillSelect(selA, selA.value);
    fillSelect(selB, selB.value);
    // Default: latest vs previous when both empty / same
    if (dates.length >= 2 && (!selA.value || !selB.value || selA.value === selB.value)) {
      selA.value = dates[0];
      selB.value = dates[1];
    }
    renderCompare();
  }

  selA.addEventListener("change", () => {
    setOpen(true);
    renderCompare();
  });
  selB.addEventListener("change", () => {
    setOpen(true);
    renderCompare();
  });

  function syncLegend() {
    const L = window.__MM_SCENE__?.apiFloodLayer;
    const has = !!L?.userData?.hasFlood;
    legend.hidden = !has;
    if (!has) return;
    scheduleLayout();
    const info = L.userData.getInfo?.() || {};
    const fl = Number(info.flood_area_ha);
    const wa = Number(info.water_area_ha);
    legend.innerHTML = `<strong>FLOOD AREA</strong>
      <div><i style="background:rgba(255,48,48,.65);border:1px solid #ff3030"></i>Flood extent<span class="fl-val">${Number.isFinite(fl) && fl > 0 ? ` · ${fl.toFixed(2)} ha (API)` : ""}</span></div>
      <div><i style="background:rgba(63,155,255,.55);border:1px solid #3f9bff"></i>River water<span class="fl-val">${Number.isFinite(wa) && wa > 0 ? ` · ${wa.toFixed(2)} ha` : ""}</span></div>`;
  }

  document.addEventListener("flood-geometry-ready", () => {
    syncLegend();
    scheduleLayout();
  });
  document.addEventListener("flood-geometry-cleared", () => {
    legend.hidden = true;
  });

  const sync = () => {
    const show = uiRoot.classList.contains("flood-sim-open");
    panel.hidden = !show;
    if (show) {
      syncLegend();
      renderCompare();
    }
    scheduleLayout();
  };
  new MutationObserver(sync).observe(uiRoot, { attributes: true, attributeFilter: ["class"] });
  sync();

  return {
    el: panel,
    legend,
    setCatalog,
    refresh: () => renderCompare(),
  };
}
