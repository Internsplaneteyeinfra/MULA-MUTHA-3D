import { state } from "../../state.js";
import { enterMapFocus, exitMapFocus } from "../mapFocus.js";
import {
  fetchBodCodViewerData,
  DEFAULT_BOD_COD_VIEWER_ID,
  classShortLabel,
  formatMgL,
  buildBodCodTimeline,
  sampleReachAt,
  sampleAllReachesAt,
  alertsForDate,
  riverAccuracyAt,
  defaultTimeIndex,
  formatTimelineLabel,
  formatTimelineScaleLabel,
  supportStyle,
} from "../../services/bodCodService.js";

/**
 * BOD–COD live twin HUD (JalNetra):
 * top alerts · time −/+ / scrubber · end-to-end class ribbon · reach card · accuracy
 */
export function mountBodCodHud(root, hooks = {}) {
  const backEl = document.createElement("button");
  backEl.type = "button";
  backEl.className = "lu-theme-back map-chrome bod-cod-back";
  backEl.hidden = true;
  backEl.setAttribute("aria-label", "Back from BOD-COD");
  backEl.innerHTML = `<span class="lu-theme-back-arrow" aria-hidden="true">←</span><span>Back</span>`;
  root.appendChild(backEl);

  const alertsEl = document.createElement("div");
  alertsEl.className = "bod-cod-alerts map-chrome";
  alertsEl.hidden = true;
  alertsEl.setAttribute("aria-label", "BOD-COD alerts");
  root.appendChild(alertsEl);

  const timeEl = document.createElement("div");
  timeEl.className = "bod-cod-time map-chrome";
  timeEl.hidden = true;
  timeEl.setAttribute("role", "group");
  timeEl.setAttribute("aria-label", "BOD-COD time selection");
  root.appendChild(timeEl);

  const classesEl = document.createElement("div");
  classesEl.className = "bod-cod-classes map-chrome";
  classesEl.hidden = true;
  classesEl.setAttribute("role", "list");
  classesEl.setAttribute("aria-label", "BOD water-use classes");
  root.appendChild(classesEl);

  const tourEl = document.createElement("div");
  tourEl.className = "bod-cod-tour map-chrome";
  tourEl.hidden = true;
  tourEl.setAttribute("role", "group");
  tourEl.setAttribute("aria-label", "BOD-COD reach tour");
  root.appendChild(tourEl);

  const stripEl = document.createElement("div");
  stripEl.className = "bod-cod-strip map-chrome";
  stripEl.hidden = true;
  stripEl.setAttribute("role", "listbox");
  stripEl.setAttribute("aria-label", "River end to end by class");
  root.appendChild(stripEl);

  const cardEl = document.createElement("aside");
  cardEl.className = "bod-cod-card map-chrome";
  cardEl.hidden = true;
  cardEl.setAttribute("aria-live", "polite");
  root.appendChild(cardEl);

  const accuracyEl = document.createElement("aside");
  accuracyEl.className = "bod-cod-accuracy map-chrome";
  accuracyEl.hidden = true;
  root.appendChild(accuracyEl);

  let visible = false;
  let data = null;
  let timeline = { dates: [], historyCount: 0, forecastCount: 0 };
  let timeIndex = 0;
  let reachIndex = 0;
  let busy = false;
  let filterCls = null;
  let syncingFromHud = false;
  /** @type {ReturnType<typeof sampleAllReachesAt>} */
  let snaps = [];

  /** After this idle dwell, auto-step to the next reach so the view keeps changing. */
  const IDLE_DWELL_MS = 12_000;
  let idleTimer = 0;

  function clearIdleAdvance() {
    window.clearTimeout(idleTimer);
    idleTimer = 0;
    tourEl.querySelector(".bod-cod-idle-bar")?.classList.remove("is-running");
  }

  function bumpIdleAdvance() {
    clearIdleAdvance();
    if (!visible || !reaches().length) return;
    const bar = tourEl.querySelector(".bod-cod-idle-bar");
    if (bar) {
      bar.classList.remove("is-running");
      // Restart CSS fill so the dwell progress is visible
      void bar.offsetWidth;
      bar.classList.add("is-running");
    }
    idleTimer = window.setTimeout(() => {
      idleTimer = 0;
      if (!visible) return;
      autoAdvanceReach();
    }, IDLE_DWELL_MS);
  }

  function autoAdvanceReach() {
    const list = reaches();
    if (!list.length) return;
    // Wrap end → start so a parked session keeps producing fresh frames
    reachIndex = (reachIndex + 1) % list.length;
    filterCls = null;
    renderClasses();
    focusReach({ moveCamera: true, preferMeters: null });
  }

  function reaches() {
    return data?.reaches || [];
  }

  function current() {
    const list = reaches();
    if (!list.length) return null;
    reachIndex = Math.max(0, Math.min(list.length - 1, reachIndex));
    return list[reachIndex];
  }

  function currentSample() {
    const r = current();
    if (!r) return null;
    return sampleReachAt(r, timeIndex, data, timeline);
  }

  function pickIndexForMeters(meters) {
    const idx = window.__MM_SCENE__?.findBodCodReachAtMeters?.(meters);
    if (Number.isFinite(idx) && idx >= 0) return idx;
    const list = reaches();
    if (!list.length || !Number.isFinite(meters)) return 0;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const [a, b] = list[i].km || [0, 2];
      const mid = ((Number(a) + Number(b)) / 2) * 1000;
      const d = Math.abs(mid - meters);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function applyTime(nextIndex, { rebuildRibbon = true } = {}) {
    const n = timeline.dates.length;
    if (!n) return;
    timeIndex = Math.max(0, Math.min(n - 1, nextIndex));
    snaps = sampleAllReachesAt(data, timeIndex, timeline);
    if (rebuildRibbon) window.__MM_SCENE__?.applyBodCodSnapshot?.(snaps);
    document.dispatchEvent(
      new CustomEvent("bod-cod-time-change", {
        detail: { timeIndex, date: timeline.dates[timeIndex], data, snaps },
      }),
    );
    renderTime();
    renderAlerts();
    renderClasses();
    renderTour();
    renderStrip();
    renderCard();
    renderAccuracy();
  }

  function renderTime() {
    const n = timeline.dates.length;
    if (!n) {
      timeEl.hidden = true;
      return;
    }
    const label = formatTimelineLabel(timeline.dates[timeIndex]);
    const start = formatTimelineScaleLabel(timeline.dates[0]);
    const end = formatTimelineScaleLabel(timeline.dates[n - 1]);
    const fcstH = timeline.forecastCount || 0;
    const endNote = fcstH ? ` · +${fcstH}h` : "";
    const kind =
      timeIndex >= timeline.historyCount
        ? "Forecast"
        : snaps[0]?.sample?.support === "sat" || snaps[0]?.sample?.support === "anchor"
          ? "Observed"
          : "History";
    timeEl.innerHTML = `
      <div class="bod-cod-time-row">
        <button type="button" class="bod-cod-time-nav" id="bod-cod-time-prev" aria-label="Previous hour" ${timeIndex <= 0 ? "disabled" : ""}>−</button>
        <div class="bod-cod-time-center">
          <strong id="bod-cod-time-label">${escapeHtml(label)}</strong>
          <span class="bod-cod-time-kind">${escapeHtml(kind)}</span>
        </div>
        <button type="button" class="bod-cod-time-nav" id="bod-cod-time-next" aria-label="Next hour" ${timeIndex >= n - 1 ? "disabled" : ""}>+</button>
      </div>
      <input type="range" class="bod-cod-time-slider" id="bod-cod-time-slider"
        min="0" max="${n - 1}" step="1" value="${timeIndex}"
        aria-label="Scrub BOD-COD timeline" />
      <div class="bod-cod-time-scale">
        <span title="History start">${escapeHtml(start)}</span>
        <span class="bod-cod-time-scale-sep" aria-hidden="true">→</span>
        <span title="Forecast end">${escapeHtml(end)}${escapeHtml(endNote)}</span>
      </div>
    `;
    timeEl.hidden = false;
    timeEl.querySelector("#bod-cod-time-prev")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyTime(timeIndex - 1);
    });
    timeEl.querySelector("#bod-cod-time-next")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyTime(timeIndex + 1);
    });
    const slider = timeEl.querySelector("#bod-cod-time-slider");
    slider?.addEventListener("input", () => {
      applyTime(Number(slider.value));
    });
  }

  function renderAlerts() {
    const date = snaps[0]?.sample?.date || timeline.dates[timeIndex] || data?.generated;
    const list = alertsForDate(data, date);
    if (!list.length) {
      alertsEl.hidden = true;
      alertsEl.innerHTML = "";
      return;
    }
    alertsEl.innerHTML = `
      <div class="bod-cod-alerts-head">
        <span>Alert inbox</span>
        <em>${list.length}</em>
      </div>
      <div class="bod-cod-alerts-track">
        ${list
          .slice(0, 4)
          .map((a) => {
            const tier = String(a.tier || "alert");
            return `<article class="bod-cod-alert-card" data-tier="${escapeAttr(tier)}">
              <header><strong>${escapeHtml(tier)}</strong>
                <span>[${escapeHtml(a.basis || "—")}] ${escapeHtml(a.reach_id || "")}</span>
              </header>
              <p>${escapeHtml(cleanText(a.text || ""))}</p>
            </article>`;
          })
          .join("")}
      </div>
    `;
    alertsEl.hidden = false;
  }

  function renderClasses() {
    const colors = data?.class_colors || {};
    const labels = data?.class_labels || {};
    const edges = data?.bod_edges || [2, 3, 6, 10];
    const order = ["A", "B", "C", "D", "E"];
    const counts = Object.fromEntries(order.map((c) => [c, 0]));
    for (const s of snaps) {
      const cls = String(s.sample?.cls || "").toUpperCase();
      if (counts[cls] != null) counts[cls] += 1;
    }
    const edgeTips = {
      A: `≤ ${edges[0]} mg/L`,
      B: `≤ ${edges[1]} mg/L`,
      C: `≤ ${edges[2]} mg/L`,
      D: `≤ ${edges[3]} mg/L`,
      E: `> ${edges[3]} mg/L`,
    };
    classesEl.innerHTML = order
      .map((cls) => {
        const color = colors[cls] || "#888";
        const tip = `${labels[cls] || cls} · ${edgeTips[cls] || ""}`;
        const on = filterCls === cls ? " is-active" : "";
        const n = counts[cls] || 0;
        return `
        <button type="button" class="bod-cod-class${on}" role="listitem"
          data-cls="${cls}"
          style="--bod-class-color:${escapeAttr(color)}"
          title="${escapeAttr(cleanText(tip))}"
          aria-pressed="${filterCls === cls ? "true" : "false"}"
          aria-label="${escapeAttr(classShortLabel(cls, labels))}">
          <span class="bod-cod-class-letter">${cls}</span>
          <span class="bod-cod-class-name">${escapeHtml(classShortLabel(cls, labels))}</span>
          ${n ? `<span class="bod-cod-class-count">${n}</span>` : ""}
        </button>`;
      })
      .join("");
    classesEl.hidden = false;
    classesEl.querySelectorAll(".bod-cod-class").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cls = btn.dataset.cls;
        if (filterCls === cls) filterCls = null;
        else {
          filterCls = cls;
          const idx = snaps.findIndex((s) => String(s.sample?.cls || "").toUpperCase() === cls);
          if (idx >= 0) {
            reachIndex = idx;
            focusReach({ moveCamera: true, preferMeters: null });
            return;
          }
        }
        renderClasses();
        renderStrip();
      });
    });
  }

  function renderTour() {
    const list = reaches();
    const r = current();
    const sample = currentSample();
    if (!r || !sample) {
      tourEl.hidden = true;
      return;
    }
    const cls = String(sample.cls || "—").toUpperCase();
    const color = data?.class_colors?.[cls] || "#E8A13D";
    const km = Array.isArray(r.km) ? `${fmtKm(r.km[0])}–${fmtKm(r.km[1])} km` : "";
    const m = Number(state.selectedChainageMeters);
    const station = Number.isFinite(m)
      ? `${Math.floor(m / 1000)}+${String(Math.round(m) % 1000).padStart(3, "0")}`
      : "";
    tourEl.innerHTML = `
      <button type="button" class="bod-cod-nav is-prev" id="bod-cod-prev"
        aria-label="Previous reach">
        <span aria-hidden="true">←</span>
      </button>
      <div class="bod-cod-tour-center">
        <span class="bod-cod-tour-eyebrow">${reachIndex + 1} / ${list.length}${km ? ` · ${km}` : ""}${station ? ` · ${station}` : ""}</span>
        <strong class="bod-cod-tour-name">${escapeHtml(cleanText(r.name || r.id))}</strong>
        <span class="bod-cod-tour-class" style="--bod-class-color:${escapeAttr(color)}">Class ${escapeHtml(cls)}</span>
        <span class="bod-cod-idle-bar" aria-hidden="true"></span>
      </div>
      <button type="button" class="bod-cod-nav is-next" id="bod-cod-next"
        aria-label="Next reach">
        <span aria-hidden="true">→</span>
      </button>
    `;
    tourEl.hidden = false;
    tourEl.querySelector("#bod-cod-prev")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      step(-1);
    });
    tourEl.querySelector("#bod-cod-next")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      step(1);
    });
    bumpIdleAdvance();
  }

  function renderStrip() {
    const list = reaches();
    if (!list.length) {
      stripEl.hidden = true;
      return;
    }
    const colors = data?.class_colors || {};
    const maxKm = Math.max(...list.map((r) => Number(r.km?.[1] ?? 0)), 1);
    stripEl.innerHTML = `
      <div class="bod-cod-strip-head">
        <span>The river, end to end</span>
        <em>${escapeHtml(cleanText(data?.river_name || "Mutha"))}</em>
      </div>
      <div class="bod-cod-strip-track" role="presentation">
        ${list
          .map((r, i) => {
            const [a, b] = Array.isArray(r.km) ? r.km : [i * 2, i * 2 + 2];
            const w = Math.max(2, ((Number(b) - Number(a)) / maxKm) * 100);
            const sample = snaps[i]?.sample || sampleReachAt(r, timeIndex, data, timeline);
            const cls = String(sample.cls || "NA").toUpperCase();
            const color = colors[cls] || colors.NA || "#6B7A7F";
            const style = supportStyle(sample.support);
            const on = i === reachIndex ? " is-active" : "";
            const dim = filterCls && filterCls !== cls ? " is-dim" : "";
            return `<button type="button" class="bod-cod-seg is-${style}${on}${dim}" role="option"
              data-idx="${i}" aria-selected="${i === reachIndex}"
              style="--bod-class-color:${escapeAttr(color)}; flex-grow:${w.toFixed(2)}; flex-basis:0"
              title="${escapeAttr(cleanText(r.name || r.id))} · Class ${cls} · ${style}"
              aria-label="${escapeAttr(cleanText(r.name || r.id))}, class ${cls}"></button>`;
          })
          .join("")}
      </div>
      <div class="bod-cod-strip-legend">
        <span class="is-observed">Observed</span>
        <span class="is-prior">Prior</span>
        <span class="is-forecast">Forecast</span>
      </div>
      <div class="bod-cod-strip-scale">
        <span>0 km</span>
        <span>${fmtKm(maxKm)} km</span>
      </div>
    `;
    stripEl.hidden = false;
    stripEl.querySelectorAll(".bod-cod-seg").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        if (!Number.isFinite(idx)) return;
        reachIndex = idx;
        filterCls = null;
        renderClasses();
        focusReach({ moveCamera: true, preferMeters: null });
      });
    });
  }

  function renderCard() {
    const r = current();
    const t = currentSample();
    if (!r || !t) {
      cardEl.hidden = true;
      return;
    }
    const cls = String(t.cls || "—").toUpperCase();
    const color = data?.class_colors?.[cls] || "#E8A13D";
    const alert = alertsForDate(data, t.date).find((a) => a.reach_id === r.id);
    cardEl.innerHTML = `
      <header class="bod-cod-card-head">
        <span class="bod-cod-card-kicker">Reach detail</span>
        <strong>${escapeHtml(cleanText(r.name || r.id))}</strong>
        <span class="bod-cod-card-time">${escapeHtml(formatTimelineLabel(t.date))}</span>
      </header>
      <div class="bod-cod-metrics">
        <div class="bod-cod-metric">
          <span class="bod-cod-metric-lab">BOD</span>
          <strong>${escapeHtml(formatMgL(t.p50))}</strong>
          <em>${escapeHtml(formatMgL(t.p10))} – ${escapeHtml(formatMgL(t.p90))}</em>
        </div>
        <div class="bod-cod-metric">
          <span class="bod-cod-metric-lab">COD</span>
          <strong>${escapeHtml(formatMgL(t.cod_p50))}</strong>
          <em>${escapeHtml(formatMgL(t.cod_p10))} – ${escapeHtml(formatMgL(t.cod_p90))}</em>
        </div>
        <div class="bod-cod-metric is-class" style="--bod-class-color:${escapeAttr(color)}">
          <span class="bod-cod-metric-lab">Class</span>
          <strong>${escapeHtml(cls)}</strong>
          <em>${escapeHtml(classShortLabel(cls, data?.class_labels))}</em>
        </div>
      </div>
      <div class="bod-cod-tags">
        <span class="bod-cod-tag" style="--bod-class-color:${escapeAttr(color)}">CLASS ${escapeHtml(cls)}</span>
        <span class="bod-cod-tag">${escapeHtml(t.tier || "—")}</span>
        <span class="bod-cod-tag">support: ${escapeHtml(t.support || "—")}</span>
      </div>
      ${
        alert
          ? `<p class="bod-cod-alert" data-tier="${escapeAttr(alert.tier || "")}">${escapeHtml(cleanText(alert.text || ""))}</p>`
          : ""
      }
      <p class="bod-cod-footnote">${escapeHtml(cleanText(data?.river_name || "River"))} · ${escapeHtml(cleanText(data?.tagline || "BOD/COD twin"))}</p>
    `;
    cardEl.hidden = false;
  }

  function renderAccuracy() {
    const acc = riverAccuracyAt(data, timeIndex, timeline);
    accuracyEl.innerHTML = `
      <header class="bod-cod-accuracy-head">Accuracy measure</header>
      <dl class="bod-cod-accuracy-grid">
        <div><dt>Selected</dt><dd>${escapeHtml(formatTimelineLabel(acc.date))}</dd></div>
        <div><dt>BOD river mean</dt><dd>${escapeHtml(formatMgL(acc.bodMean))}</dd></div>
        <div><dt>COD river mean</dt><dd>${escapeHtml(formatMgL(acc.codMean))}</dd></div>
        <div><dt>Above bathing</dt><dd>${acc.aboveBathing} / ${acc.reachCount}</dd></div>
        <div><dt>Highest BOD</dt><dd>${escapeHtml(acc.highestId)} · ${escapeHtml(formatMgL(acc.highestBod))}</dd></div>
      </dl>
    `;
    accuracyEl.hidden = false;
  }

  function focusReach({ moveCamera = true, preferMeters = null } = {}) {
    const r = current();
    if (!r) return;
    document.dispatchEvent(new CustomEvent("river-measure-clear"));
    const prefer =
      preferMeters != null
        ? preferMeters
        : Number.isFinite(state.selectedChainageMeters)
          ? state.selectedChainageMeters
          : undefined;
    const result = window.__MM_SCENE__?.focusBodCodReach?.(r.id, {
      preferMeters: prefer,
    });
    if (result?.meters != null) {
      state.selectedChainageMeters = result.meters;
      state.showChainage = true;
      syncingFromHud = true;
      document.dispatchEvent(
        new CustomEvent("chainage-select", {
          detail: {
            meters: result.meters,
            focus: !!moveCamera,
            fromBodCod: true,
          },
        }),
      );
      queueMicrotask(() => {
        syncingFromHud = false;
      });
    }
    renderTour();
    renderStrip();
    renderCard();
    hooks.onReach?.(r);
  }

  function step(dir) {
    const list = reaches();
    if (!list.length) return;
    // Manual step wraps so Next at the end continues the tour
    reachIndex = (reachIndex + dir + list.length) % list.length;
    filterCls = null;
    renderClasses();
    focusReach({ moveCamera: true, preferMeters: null });
  }

  function onChainage(e) {
    if (!visible || syncingFromHud || e.detail?.fromBodCod) return;
    const m = e.detail?.meters;
    if (m == null) return;
    const idx = pickIndexForMeters(m);
    if (idx === reachIndex) {
      const r = reaches()[idx];
      if (r) window.__MM_SCENE__?.focusBodCodReach?.(r.id, { preferMeters: m });
      bumpIdleAdvance();
      return;
    }
    reachIndex = idx;
    filterCls = null;
    renderClasses();
    focusReach({ moveCamera: false, preferMeters: m });
  }

  function onUserActivity() {
    if (!visible) return;
    bumpIdleAdvance();
  }

  backEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hide();
    hooks.onBack?.();
  });

  document.addEventListener("chainage-select", onChainage);
  document.addEventListener("pointerdown", onUserActivity, { passive: true });
  document.addEventListener("wheel", onUserActivity, { passive: true });
  document.addEventListener("keydown", onUserActivity);

  async function show(viewerId = DEFAULT_BOD_COD_VIEWER_ID) {
    if (busy) return;
    busy = true;
    try {
      visible = true;
      filterCls = null;
      enterMapFocus(root, "bodcod");
      backEl.hidden = false;
      cardEl.innerHTML = `<p class="bod-cod-loading">Loading BOD / COD twin…</p>`;
      cardEl.hidden = false;

      data = await fetchBodCodViewerData(viewerId);
      timeline = buildBodCodTimeline(data);
      timeIndex = defaultTimeIndex(timeline);
      snaps = sampleAllReachesAt(data, timeIndex, timeline);

      const result = await window.__MM_SCENE__?.showBodCod?.(data);
      if (result?.available === false) {
        cardEl.innerHTML = `<p class="bod-cod-error">${escapeHtml(result.message || "Unable to show ribbon")}</p>`;
        return;
      }
      window.__MM_SCENE__?.applyBodCodSnapshot?.(snaps);

      const here = Number(state.selectedChainageMeters);
      reachIndex = pickIndexForMeters(Number.isFinite(here) ? here : 0);
      applyTime(timeIndex, { rebuildRibbon: true });
      focusReach({
        moveCamera: true,
        preferMeters: Number.isFinite(here) ? here : null,
      });
    } catch (err) {
      cardEl.hidden = false;
      cardEl.innerHTML = `<p class="bod-cod-error"><strong>DATA UNAVAILABLE</strong><span>${escapeHtml(err?.message || String(err))}</span></p>`;
      console.warn("[bod-cod]", err);
    } finally {
      busy = false;
    }
  }

  function hide() {
    visible = false;
    clearIdleAdvance();
    data = null;
    snaps = [];
    filterCls = null;
    backEl.hidden = true;
    alertsEl.hidden = true;
    alertsEl.innerHTML = "";
    timeEl.hidden = true;
    timeEl.innerHTML = "";
    classesEl.hidden = true;
    classesEl.innerHTML = "";
    tourEl.hidden = true;
    tourEl.innerHTML = "";
    stripEl.hidden = true;
    stripEl.innerHTML = "";
    cardEl.hidden = true;
    cardEl.innerHTML = "";
    accuracyEl.hidden = true;
    accuracyEl.innerHTML = "";
    root.classList.remove("bod-cod-focus", "lu-theme-classes-open");
    exitMapFocus(root, "bodcod");
    window.__MM_SCENE__?.hideBodCod?.();
  }

  return {
    show,
    hide,
    isVisible: () => visible,
    refresh: () => applyTime(timeIndex),
    dispose() {
      document.removeEventListener("chainage-select", onChainage);
      document.removeEventListener("pointerdown", onUserActivity);
      document.removeEventListener("wheel", onUserActivity);
      document.removeEventListener("keydown", onUserActivity);
      hide();
    },
  };
}

function fmtKm(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function cleanText(s) {
  return String(s || "")
    .replace(/\uFFFD/g, "")
    .replace(/â€”|â€“|Ã¢â‚¬â€/g, "—")
    .replace(/Â·/g, "·")
    .replace(/–|—/g, "–")
    .replace(/\?\?/g, "–")
    .trim();
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
