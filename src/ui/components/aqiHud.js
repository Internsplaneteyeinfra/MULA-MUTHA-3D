/**
 * AQI HUD — Climate-style chrome, refreshes with chainage lat/lon.
 */
import {
  Atom, Clock, Cloud, CloudFog, Factory, FlaskConical, Gauge, Leaf, Maximize2, Minimize2, Wind,
} from "lucide";
import { lucideHtml } from "../icons.js";
import { attachChartHover } from "../chartHover.js";
import { enterMapFocus, exitMapFocus } from "../mapFocus.js";
import { metersToStation } from "../../scene/chainageMarkers.js";
import {
  AQI_FALLBACK_LL,
  AQI_POLLUTANTS,
  AQI_TREND_METRICS,
  aqiCategory,
  fetchHourlyAqi,
  fetchLiveAqi,
  getLocalAqiTrend,
  shiftYmd,
  todayYmd,
} from "../../services/aqiService.js";

/**
 * @param {HTMLElement} root
 * @param {{ getPoint?: () => { lat?:number, lon?:number, label?:string, station?:string, meters?:number } | null }} [hooks]
 */
export function mountAqiHud(root, hooks = {}) {
  const backEl = document.createElement("button");
  backEl.type = "button";
  backEl.className = "lu-theme-back map-chrome aqi-back";
  backEl.hidden = true;
  backEl.setAttribute("aria-label", "Back");
  backEl.innerHTML = `<span class="lu-theme-back-arrow" aria-hidden="true">←</span><span>Back</span>`;
  root.appendChild(backEl);

  const classesEl = document.createElement("div");
  classesEl.className = "lu-theme-classes map-chrome aqi-classes";
  classesEl.id = "aqi-classes";
  classesEl.hidden = true;
  classesEl.setAttribute("role", "list");
  classesEl.setAttribute("aria-label", "AQI metrics");
  root.appendChild(classesEl);

  const panelEl = document.createElement("aside");
  panelEl.className = "aqi-panel map-chrome";
  panelEl.id = "aqi-panel";
  panelEl.hidden = true;
  panelEl.setAttribute("aria-label", "Air quality");
  // Bottom strip: metric chips float centred above it, readings sit in bodyEl.
  panelEl.appendChild(classesEl);
  const bodyEl = document.createElement("div");
  bodyEl.className = "aqi-panel-body";
  panelEl.appendChild(bodyEl);
  root.appendChild(panelEl);

  const yearEl = document.createElement("div");
  yearEl.className = "lu-theme-year map-chrome aqi-year";
  yearEl.id = "aqi-year";
  yearEl.hidden = true;
  yearEl.setAttribute("role", "group");
  yearEl.setAttribute("aria-label", "AQI date");
  root.appendChild(yearEl);

  let open = false;
  let loadSerial = 0;
  let pollTimer = null;
  let chainageTimer = null;
  let corridorSerial = 0;
  let point = { ...AQI_FALLBACK_LL, label: "Mula–Mutha" };
  let live = null;
  let hourly = null;
  let day = todayYmd();
  let metric = "aqi";
  let busy = false;
  let lastFetchKey = "";
  /** Trend window: "1h" | "6h" | "24h" | "7d" */
  let range = "24h";
  let expanded = false;
  let weekRecords = null;
  let weekKey = "";
  let weekSerial = 0;
  let loadingWeekKey = "";
  let lastChartWidth = 0;
  let resizeRaf = 0;

  const resizeObs = new ResizeObserver(() => {
    if (!open || !live || resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      const host = bodyEl.querySelector("[data-aqi-chart]");
      if (host && Math.abs(Math.round(host.clientWidth) - lastChartWidth) > 4) drawTrend();
    });
  });
  resizeObs.observe(panelEl);

  function isOpen() {
    return open;
  }

  function resolvePoint() {
    const p = hooks.getPoint?.() || null;
    const lat = Number(p?.lat);
    const lon = Number(p?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return {
        lat,
        lon,
        label: p?.label || "Selected chainage",
        station: p?.station || null,
        meters: Number.isFinite(Number(p?.meters)) ? Number(p.meters) : null,
      };
    }
    return { ...AQI_FALLBACK_LL, label: "Mula–Mutha", station: null, meters: null };
  }

  function pointKey(p) {
    return `${Number(p.lat).toFixed(4)},${Number(p.lon).toFixed(4)}`;
  }

  function hushPeers() {
    root.querySelectorAll(".fishing-panel, .hud.fishing-panel, .bridge-info").forEach((el) => {
      el.hidden = true;
    });
  }

  async function show() {
    open = true;
    point = resolvePoint();
    day = todayYmd();
    metric = "aqi";
    enterMapFocus(root, "aqi");
    hushPeers();
    backEl.hidden = false;
    root.classList.add("aqi-focus", "lu-theme-classes-open", "lu-theme-year-open");
    panelEl.hidden = false;
    panelEl.classList.toggle("is-expanded", expanded);
    yearEl.hidden = false;
    renderStatus("Loading live AQI…");
    renderMetricChips();
    renderDateSheet();
    startRiverColors();
    await refreshAll({ bustCache: true });
    startPoll();
  }

  function hide() {
    open = false;
    stopPoll();
    corridorSerial += 1;
    if (chainageTimer) {
      window.clearTimeout(chainageTimer);
      chainageTimer = null;
    }
    window.__MM_SCENE__?.hideAqiRiver?.();
    classesEl.hidden = true;
    classesEl.innerHTML = "";
    panelEl.hidden = true;
    bodyEl.innerHTML = "";
    yearEl.hidden = true;
    yearEl.innerHTML = "";
    backEl.hidden = true;
    root.classList.remove("aqi-focus", "lu-theme-classes-open", "lu-theme-year-open");
    exitMapFocus(root, "aqi");
    live = null;
    hourly = null;
    lastFetchKey = "";
    weekRecords = null;
    weekKey = "";
    loadingWeekKey = "";
    weekSerial += 1;
  }

  function startRiverColors() {
    const scene = window.__MM_SCENE__;
    if (!scene?.showAqiRiver) return;
    scene.showAqiRiver({ metric, stepM: 280 });
    scene.setAqiRiverFocus?.(point.meters);
    void loadCorridorColors();
  }

  /** Sample AQI along the river and paint category colors onto the ribbon. */
  async function loadCorridorColors() {
    const scene = window.__MM_SCENE__;
    if (!scene?.getAqiRiverSamples || !open) return;
    const serial = ++corridorSerial;
    const samples = scene.getAqiRiverSamples() || [];
    if (!samples.length) return;

    const today = todayYmd();
    const dateOpt = day && day !== today ? { date: day } : {};
    const concurrency = 4;
    let cursor = 0;

    async function worker() {
      while (cursor < samples.length) {
        if (!open || serial !== corridorSerial) return;
        const i = cursor;
        cursor += 1;
        const s = samples[i];
        const lat = Number(s.lat);
        const lon = Number(s.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        try {
          const reading = await fetchLiveAqi(lat, lon, dateOpt);
          if (!open || serial !== corridorSerial) return;
          scene.setAqiRiverReading?.(s.meters, reading);
        } catch (err) {
          console.warn("[aqi-river]", s.meters, err?.message || err);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, samples.length) }, () => worker()),
    );
  }

  /** Called when chainage steps — re-fetch AQI for that lat/lon. */
  function onChainageChange() {
    if (!open) return;
    point = resolvePoint();
    window.__MM_SCENE__?.setAqiRiverFocus?.(point.meters);
    renderPanelLocationOnly();
    if (live) panelEl.classList.add("is-loading");
    if (chainageTimer) window.clearTimeout(chainageTimer);
    chainageTimer = window.setTimeout(() => {
      if (!open) return;
      const key = pointKey(point);
      if (key === lastFetchKey && live) {
        panelEl.classList.remove("is-loading");
        renderPanel();
        return;
      }
      void refreshAll({ bustCache: true });
    }, 220);
  }

  function startPoll() {
    stopPoll();
    pollTimer = window.setInterval(() => {
      if (!open) return;
      void refreshLive({ bustCache: true });
    }, 60_000);
  }

  function stopPoll() {
    if (pollTimer != null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function refreshAll(opts = {}) {
    const serial = ++loadSerial;
    point = resolvePoint();
    const key = pointKey(point);
    panelEl.classList.add("is-loading");
    try {
      const [liveData, hourlyData] = await Promise.all([
        fetchLiveAqi(point.lat, point.lon, opts),
        fetchHourlyAqi(point.lat, point.lon, day),
      ]);
      if (serial !== loadSerial || !open) return;
      live = liveData;
      hourly = hourlyData;
      lastFetchKey = key;
      renderMetricChips();
      renderPanel();
      renderDateSheet();
    } catch (err) {
      if (serial !== loadSerial || !open) return;
      console.warn("[aqi]", err?.message || err);
      renderStatus(err?.message || "AQI unavailable", { error: true, retry: true });
    } finally {
      panelEl.classList.remove("is-loading");
    }
  }

  async function refreshLive(opts = {}) {
    try {
      point = resolvePoint();
      live = await fetchLiveAqi(point.lat, point.lon, opts);
      if (!open) return;
      lastFetchKey = pointKey(point);
      renderMetricChips();
      renderPanel();
    } catch (err) {
      console.warn("[aqi] poll", err?.message || err);
    }
  }

  // Metric selection lives on the AQI / PM2.5 / PM10 cards inside the panel.
  function renderMetricChips() {
    classesEl.innerHTML = "";
    classesEl.hidden = true;
  }

  function selectMetric(id) {
    if (!AQI_TREND_METRICS.some((m) => m.id === id) || id === metric) return;
    metric = id;
    window.__MM_SCENE__?.setAqiRiverMetric?.(metric);
    renderPanel();
  }
  function stationLabel() {
    return (
      point.station ||
      (Number.isFinite(point.meters) ? metersToStation(point.meters) : "—")
    );
  }

  function locationLineHtml() {
    const lat = Number.isFinite(point.lat) ? `${Math.abs(point.lat).toFixed(5)}° ${point.lat >= 0 ? "N" : "S"}` : "—";
    const lon = Number.isFinite(point.lon) ? `${Math.abs(point.lon).toFixed(5)}° ${point.lon >= 0 ? "E" : "W"}` : "—";
    return `Chainage ${escapeHtml(stationLabel())} <span class="aqi-sep">|</span> ${escapeHtml(lat)}, ${escapeHtml(lon)}`;
  }

  function headHtml() {
    const isLive = day === todayYmd();
    const stamp = live ? formatStamp(live.last_updated || live.date) : "";
    return `
      <header class="aqi-head">
        <div class="aqi-head-id">
          <span class="aqi-head-icon">${lucideHtml(Leaf, { size: 20, className: "aqi-ico" })}</span>
          <div class="aqi-head-copy">
            <div class="aqi-head-title">
              <strong>Air Quality</strong>
              <span class="aqi-live${isLive ? "" : " is-history"}"><i></i>${isLive ? "Live" : "History"}</span>
            </div>
            <div class="aqi-head-loc">${locationLineHtml()}</div>
          </div>
        </div>
        <div class="aqi-head-tools">
          ${stamp ? `<span class="aqi-stamp">${lucideHtml(Clock, { size: 14, className: "aqi-ico" })}${escapeHtml(stamp)}</span>` : ""}
          <div class="aqi-range" role="tablist" aria-label="Trend range">
            ${TREND_RANGES.map(
              (r) => `<button type="button" role="tab" data-range="${r.id}"
                class="${r.id === range ? "is-active" : ""}" aria-selected="${r.id === range}">${r.label}</button>`,
            ).join("")}
          </div>
          <button type="button" class="aqi-expand" data-aqi-expand
            aria-label="${expanded ? "Collapse" : "Expand"} panel" aria-pressed="${expanded}">
            ${lucideHtml(expanded ? Minimize2 : Maximize2, { size: 15, className: "aqi-ico" })}
          </button>
        </div>
      </header>`;
  }

  function renderPanelLocationOnly() {
    const el = bodyEl.querySelector(".aqi-head-loc");
    if (el) el.innerHTML = locationLineHtml();
    else if (live) renderPanel();
    else renderStatus("Updating…");
  }

  function renderStatus(message, { error = false, retry = false } = {}) {
    bodyEl.innerHTML = `
      ${headHtml()}
      <div class="aqi-status-row">
        <p class="aqi-panel-status${error ? " is-error" : ""}">${escapeHtml(message)}</p>
        ${retry ? `<button type="button" class="aqi-retry" id="aqi-retry">Retry</button>` : ""}
      </div>`;
    wireHead();
    bodyEl.querySelector("#aqi-retry")?.addEventListener("click", () => void refreshAll({ bustCache: true }));
  }

  function cardsHtml() {
    const cat = live.category || aqiCategory(live.aqi);
    const aqiPct = live.aqi == null ? 0 : Math.min(100, (Number(live.aqi) / 300) * 100);
    const aqiCard = `
      <button type="button" class="aqi-card aqi-card--aqi${metric === "aqi" ? " is-selected" : ""}"
        data-metric="aqi" style="--card-color:${escapeAttr(TREND_COLORS.aqi)}" aria-pressed="${metric === "aqi"}">
        <span class="aqi-card-top">
          <span class="aqi-card-icon">${lucideHtml(Gauge, { size: 16, className: "aqi-ico" })}</span>
          <span class="aqi-card-label">AQI</span>
        </span>
        <span class="aqi-card-main">
          <b>${escapeHtml(fmtChip(live.aqi))}</b>
          <span class="aqi-cat-pill" style="--aqi-color:${escapeAttr(cat.color)}">${escapeHtml(cat.label)}</span>
        </span>
        <span class="aqi-card-scale" aria-hidden="true"><i style="left:${aqiPct.toFixed(1)}%"></i></span>
      </button>`;

    const rest = AQI_POLLUTANTS.map((p) => {
      const value = live[p.key];
      const pct = value == null ? 0 : Math.min(100, (Number(value) / p.max) * 100);
      const color = CARD_COLORS[p.key] || p.color;
      const selectable = AQI_TREND_METRICS.some((m) => m.id === p.key);
      const on = selectable && metric === p.key;
      const tag = selectable ? "button" : "div";
      const attrs = selectable
        ? `type="button" data-metric="${p.key}" aria-pressed="${on}"`
        : "";
      return `
      <${tag} ${attrs} class="aqi-card${on ? " is-selected" : ""}${selectable ? "" : " is-static"}"
        style="--card-color:${escapeAttr(color)}">
        <span class="aqi-card-top">
          <span class="aqi-card-icon">${lucideHtml(CARD_ICONS[p.key] || Wind, { size: 16, className: "aqi-ico" })}</span>
          <span class="aqi-card-label">${escapeHtml(p.label)}</span>
        </span>
        <span class="aqi-card-main">
          <b>${escapeHtml(fmtNum(value))}</b>
          <small>${escapeHtml(p.unit)}</small>
        </span>
        <span class="aqi-card-bar" aria-hidden="true"><i style="width:${pct.toFixed(0)}%"></i></span>
      </${tag}>`;
    }).join("");

    return `<div class="aqi-cards">${aqiCard}${rest}</div>`;
  }

  function renderPanel() {
    if (!live) {
      renderStatus("No live reading");
      return;
    }
    const rangeDef = TREND_RANGES.find((r) => r.id === range) || TREND_RANGES[2];
    bodyEl.innerHTML = `
      ${headHtml()}
      ${cardsHtml()}
      <section class="aqi-trend">
        <div class="aqi-trend-head">
          <strong>AQI Trend <em>(${escapeHtml(day === todayYmd() ? "Live" : shortDay(day))})</em></strong>
          <small>${escapeHtml(rangeDef.caption)}</small>
          <div class="aqi-legend">
            ${AQI_TREND_METRICS.map(
              (m) => `<button type="button" data-metric="${m.id}"
                class="${m.id === metric ? "is-selected" : ""}"
                style="--legend-color:${escapeAttr(TREND_COLORS[m.id])}"><i></i>${escapeHtml(m.label)}</button>`,
            ).join("")}
          </div>
        </div>
        <div class="aqi-chart" data-aqi-chart></div>
      </section>`;
    wireHead();
    bodyEl.querySelectorAll("[data-metric]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectMetric(btn.dataset.metric);
      });
    });
    drawTrend();
  }

  function wireHead() {
    bodyEl.querySelectorAll("[data-range]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = btn.dataset.range;
        if (!next || next === range) return;
        range = next;
        renderPanel();
      });
    });
    bodyEl.querySelector("[data-aqi-expand]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      expanded = !expanded;
      panelEl.classList.toggle("is-expanded", expanded);
      if (live) renderPanel();
      else renderStatus("Updating…");
    });
  }

  /** @returns {{ t:number, aqi:number|null, pm2_5:number|null, pm10:number|null }[] | null} */
  function trendPoints() {
    const hourlyPts = recordsToPoints(hourly?.records);
    const now = Date.now();
    const isToday = day === todayYmd();
    const upTo = (pts) => (isToday ? pts.filter((p) => p.t <= now + 30 * 60_000) : pts);

    if (range === "1h") {
      const local = isToday
        ? getLocalAqiTrend(point.lat, point.lon)
            .filter((p) => Number(p.t) >= now - 60 * 60_000)
            .map((p) => ({ t: Number(p.t), aqi: num(p.aqi), pm2_5: num(p.pm2_5), pm10: num(p.pm10) }))
        : [];
      return local.length >= 2 ? local : upTo(hourlyPts).slice(-2);
    }
    if (range === "6h") return upTo(hourlyPts).slice(-6);
    if (range === "24h") return upTo(hourlyPts).slice(-24);

    const key = `${pointKey(point)}|${day}`;
    if (weekKey === key && weekRecords) return upTo(weekRecords);
    void loadWeek(key);
    return null;
  }

  async function loadWeek(key) {
    if (loadingWeekKey === key) return;
    loadingWeekKey = key;
    const serial = ++weekSerial;
    const days = Array.from({ length: 7 }, (_, i) => shiftYmd(day, i - 6));
    const lat = point.lat;
    const lon = point.lon;
    const results = await Promise.allSettled(days.map((d) => fetchHourlyAqi(lat, lon, d)));
    if (serial !== weekSerial || !open) return;
    const pts = results.flatMap((r) => (r.status === "fulfilled" ? recordsToPoints(r.value?.records) : []));
    pts.sort((a, b) => a.t - b.t);
    weekKey = key;
    weekRecords = pts;
    loadingWeekKey = "";
    if (range === "7d") renderPanel();
  }

  function drawTrend() {
    const host = bodyEl.querySelector("[data-aqi-chart]");
    if (!host) return;
    const pts = trendPoints();
    if (pts === null) {
      host.innerHTML = `<p class="aqi-panel-status">Loading 7-day history…</p>`;
      return;
    }
    if (pts.length < 2) {
      host.innerHTML = `<p class="aqi-panel-status">Not enough samples for this range yet</p>`;
      return;
    }

    const W = Math.max(280, Math.round(host.clientWidth || 800));
    const H = expanded ? 250 : 150;
    const L = { padL: 38, padR: 14, padT: 12, padB: 24 };
    L.plotW = W - L.padL - L.padR;
    L.plotH = H - L.padT - L.padB;

    const ids = AQI_TREND_METRICS.map((m) => m.id);
    const allVals = pts.flatMap((p) => ids.map((id) => p[id])).filter((v) => Number.isFinite(v));
    const { max: yMax, step } = niceAxis(Math.max(50, ...allVals));
    const t0 = pts[0].t;
    const t1 = pts[pts.length - 1].t;
    const xs = pts.map((p) => p.t);
    const scX = (t) => L.padL + ((t - t0) / Math.max(1, t1 - t0)) * L.plotW;
    const scY = (v) => L.padT + L.plotH - (v / yMax) * L.plotH;

    const yTicks = [];
    for (let v = 0; v <= yMax + 1e-6; v += step) yTicks.push(v);
    const grid = yTicks.map((v) => `
      <line x1="${L.padL}" x2="${L.padL + L.plotW}" y1="${scY(v).toFixed(1)}" y2="${scY(v).toFixed(1)}" class="aqi-grid"/>
      <text x="${L.padL - 8}" y="${(scY(v) + 3.5).toFixed(1)}" text-anchor="end" class="aqi-axis">${Math.round(v)}</text>`).join("");

    const nLabels = Math.max(2, Math.min(pts.length, Math.floor(L.plotW / 90)));
    const xLabels = Array.from({ length: nLabels }, (_, k) => {
      const i = Math.round((k / (nLabels - 1)) * (pts.length - 1));
      const x = scX(pts[i].t);
      const anchor = k === 0 ? "start" : k === nLabels - 1 ? "end" : "middle";
      return `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" class="aqi-axis">${escapeHtml(axisLabel(pts[i].t, range))}</text>`;
    }).join("");

    const pathFor = (id) => {
      let d = "";
      let pen = false;
      pts.forEach((p) => {
        const v = p[id];
        if (!Number.isFinite(v)) { pen = false; return; }
        d += `${pen ? "L" : "M"}${scX(p.t).toFixed(1)},${scY(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    };

    const aqiPts = pts.filter((p) => Number.isFinite(p.aqi));
    const area = aqiPts.length >= 2
      ? `M${scX(aqiPts[0].t).toFixed(1)},${scY(0).toFixed(1)}` +
        aqiPts.map((p) => `L${scX(p.t).toFixed(1)},${scY(p.aqi).toFixed(1)}`).join("") +
        `L${scX(aqiPts[aqiPts.length - 1].t).toFixed(1)},${scY(0).toFixed(1)}Z`
      : "";

    const lines = ids
      .filter((id) => id !== metric)
      .concat(metric)
      .map((id) => `<path d="${pathFor(id)}" fill="none" stroke="${TREND_COLORS[id]}"
        stroke-width="${id === metric ? 2.6 : 1.7}" stroke-opacity="${id === metric ? 1 : 0.8}"
        stroke-linecap="round" stroke-linejoin="round"/>`).join("");

    host.innerHTML = `<svg class="aqi-trend-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="AQI trend">
      <defs>
        <linearGradient id="aqiTrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${TREND_COLORS.aqi}" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="${TREND_COLORS.aqi}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      ${area ? `<path d="${area}" fill="url(#aqiTrendFill)"/>` : ""}
      ${lines}
      ${xLabels}
    </svg>`;
    lastChartWidth = W;

    attachChartHover(host.querySelector("svg"), {
      L,
      xs,
      scX,
      scY,
      fmtX: (t) => tooltipLabel(t, range),
      lineColor: "rgba(226,240,255,0.9)",
      series: AQI_TREND_METRICS.map((m) => ({
        label: m.label,
        color: TREND_COLORS[m.id],
        ys: pts.map((p) => p[m.id]),
        fmt: (v) => (m.id === "aqi" ? String(Math.round(v)) : `${v.toFixed(1)} µg/m³`),
      })),
    });
  }

  function renderDateSheet() {
    const prev = shiftYmd(day, -1);
    const next = shiftYmd(day, 1);
    const today = todayYmd();
    const nextDisabled = next > today;
    yearEl.innerHTML = `
      <button type="button" class="lu-theme-year-side aqi-day-nav" id="aqi-day-prev"
        data-day="${escapeAttr(prev)}" aria-label="Previous day">←</button>
      <div class="lu-theme-year-center aqi-day-center">
        <strong class="lu-theme-year-current">${escapeHtml(day === today ? "Today" : shortDay(day))}</strong>
        <small class="aqi-year-range">${escapeHtml(day)}</small>
      </div>
      <button type="button" class="lu-theme-year-side aqi-day-nav" id="aqi-day-next"
        ${nextDisabled ? "disabled" : ""} data-day="${escapeAttr(next)}"
        aria-label="Next day">→</button>`;
    yearEl.hidden = false;
    yearEl.querySelector("#aqi-day-prev")?.addEventListener("click", onDayClick);
    yearEl.querySelector("#aqi-day-next")?.addEventListener("click", onDayClick);
  }

  async function onDayClick(e) {
    const nextDay = e.currentTarget?.dataset?.day;
    if (!nextDay || busy || nextDay === day) return;
    busy = true;
    day = nextDay;
    renderDateSheet();
    try {
      hourly = await fetchHourlyAqi(point.lat, point.lon, day);
      if (open) renderPanel();
      void loadCorridorColors();
    } catch (err) {
      console.warn("[aqi] hourly", err?.message || err);
    } finally {
      busy = false;
    }
  }

  backEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hide();
  });

  return {
    show,
    hide,
    isOpen,
    onChainageChange,
    dispose() {
      hide();
      backEl.remove();
      classesEl.remove();
      resizeObs.disconnect();
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      panelEl.remove();
      yearEl.remove();
    },
  };
}

const TREND_RANGES = [
  { id: "1h", label: "1H", caption: "Last hour" },
  { id: "6h", label: "6H", caption: "Last 6 hours" },
  { id: "24h", label: "24H", caption: "Last 24 hours" },
  { id: "7d", label: "7D", caption: "Last 7 days" },
];

const TREND_COLORS = { aqi: "#4fc3f7", pm2_5: "#ff4d6d", pm10: "#ff9f43" };

const CARD_COLORS = {
  pm2_5: "#ff4d6d",
  pm10: "#ff9f43",
  no2: "#60a5fa",
  so2: "#a78bfa",
  o3: "#34d399",
  co: "#f472b6",
};

const CARD_ICONS = { pm2_5: CloudFog, pm10: Cloud, no2: Factory, so2: FlaskConical, o3: Wind, co: Atom };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseRecordTime(dateStr) {
  if (!dateStr) return NaN;
  const t = Date.parse(String(dateStr).replace(" ", "T"));
  return Number.isFinite(t) ? t : NaN;
}

function recordsToPoints(records) {
  return (records || [])
    .map((r) => ({ t: parseRecordTime(r.date), aqi: num(r.aqi), pm2_5: num(r.pm2_5), pm10: num(r.pm10) }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

function niceAxis(maxVal) {
  const rough = maxVal / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= rough) || 10 * mag;
  return { step, max: step * Math.ceil(maxVal / step) };
}

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function axisLabel(t, range) {
  const d = new Date(t);
  return range === "7d" ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : hhmm(d);
}

function tooltipLabel(t, range) {
  const d = new Date(t);
  return range === "7d" || range === "24h"
    ? `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hhmm(d)}`
    : hhmm(d);
}

function shortDay(ymd) {
  try {
    const [y, m, d] = String(ymd).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  } catch {
    return ymd;
  }
}

function formatStamp(value) {
  if (!value) return "";
  return String(value).replace("T", " ").slice(0, 19);
}

function fmtNum(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmtChip(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return String(Math.round(Number(v)));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
