/**
 * AQI HUD — same chrome pattern as Climate Impact:
 * top metric chips · floating glass card · bottom date sheet.
 */
import { enterMapFocus, exitMapFocus } from "../mapFocus.js";
import {
  AQI_CATEGORIES,
  AQI_FALLBACK_LL,
  AQI_POLLUTANTS,
  AQI_TREND_METRICS,
  aqiCategory,
  fetchHourlyAqi,
  fetchLiveAqi,
  getLocalAqiTrend,
  shiftYmd,
  todayYmd,
  trendStats,
} from "../../services/aqiService.js";

/**
 * @param {HTMLElement} root
 * @param {{ getPoint?: () => { lat?:number, lon?:number, label?:string } | null }} [hooks]
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
  let point = { ...AQI_FALLBACK_LL, label: "Mula–Mutha" };
  let live = null;
  let hourly = null;
  let day = todayYmd();
  let metric = "aqi";
  let busy = false;

  function isOpen() {
    return open;
  }

  function resolvePoint() {
    const p = hooks.getPoint?.() || null;
    const lat = Number(p?.lat);
    const lon = Number(p?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon, label: p?.label || "Selected area" };
    }
    return { ...AQI_FALLBACK_LL, label: "Mula–Mutha" };
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
    classesEl.hidden = false;
    panelEl.hidden = false;
    yearEl.hidden = false;
    panelEl.innerHTML = `<p class="aqi-panel-status">Loading live AQI…</p>`;
    renderMetricChips();
    renderDateSheet();
    await refreshAll({ bustCache: true });
    startPoll();
  }

  function hide() {
    open = false;
    stopPoll();
    classesEl.hidden = true;
    classesEl.innerHTML = "";
    panelEl.hidden = true;
    panelEl.innerHTML = "";
    yearEl.hidden = true;
    yearEl.innerHTML = "";
    backEl.hidden = true;
    root.classList.remove("aqi-focus", "lu-theme-classes-open", "lu-theme-year-open");
    exitMapFocus(root, "aqi");
    live = null;
    hourly = null;
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
    try {
      const [liveData, hourlyData] = await Promise.all([
        fetchLiveAqi(point.lat, point.lon, opts),
        fetchHourlyAqi(point.lat, point.lon, day),
      ]);
      if (serial !== loadSerial || !open) return;
      live = liveData;
      hourly = hourlyData;
      renderMetricChips();
      renderPanel();
      renderDateSheet();
    } catch (err) {
      if (serial !== loadSerial || !open) return;
      console.warn("[aqi]", err?.message || err);
      panelEl.innerHTML = `
        <p class="aqi-panel-status is-error">${escapeHtml(err?.message || "AQI unavailable")}</p>
        <button type="button" class="aqi-retry" id="aqi-retry">Retry</button>`;
      panelEl.querySelector("#aqi-retry")?.addEventListener("click", () => void refreshAll({ bustCache: true }));
    }
  }

  async function refreshLive(opts = {}) {
    try {
      live = await fetchLiveAqi(point.lat, point.lon, opts);
      if (!open) return;
      renderMetricChips();
      renderPanel();
    } catch (err) {
      console.warn("[aqi] poll", err?.message || err);
    }
  }

  function renderMetricChips() {
    const cat = live?.category || aqiCategory(live?.aqi);
    classesEl.innerHTML = AQI_TREND_METRICS.map((m) => {
      const on = m.id === metric;
      const value =
        m.id === "aqi"
          ? live?.aqi
          : m.id === "pm2_5"
            ? live?.pm2_5
            : live?.pm10;
      const tip =
        m.id === "aqi" && cat?.label
          ? `${m.label} · ${cat.label}`
          : m.label;
      return `
      <button type="button" class="lu-theme-class${on ? " is-selected" : ""}"
        role="listitem"
        data-metric="${m.id}"
        style="--lu-class-color:${escapeAttr(m.color)}"
        title="${escapeAttr(tip)}"
        aria-label="${escapeAttr(m.label)}"
        aria-pressed="${on ? "true" : "false"}">
        <span class="lu-theme-class-letter"></span>
        <span class="lu-theme-class-name">${escapeHtml(m.label)}</span>
        <span class="aqi-chip-val">${fmtChip(value)}</span>
      </button>`;
    }).join("");
    classesEl.hidden = false;

    classesEl.querySelectorAll("[data-metric]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        metric = btn.dataset.metric || "aqi";
        renderMetricChips();
        renderPanel();
      });
    });
  }

  function renderPanel() {
    if (!live) {
      panelEl.innerHTML = `<p class="aqi-panel-status">No live reading</p>`;
      return;
    }
    const cat = live.category || aqiCategory(live.aqi);
    const metricDef = AQI_TREND_METRICS.find((m) => m.id === metric) || AQI_TREND_METRICS[0];
    const aqiVal = live.aqi == null ? "—" : Math.round(live.aqi);
    const gaugePct = live.aqi == null ? 0 : Math.min(100, (Number(live.aqi) / 300) * 100);

    const local = getLocalAqiTrend(point.lat, point.lon);
    const useLocal = local.length >= 3;
    const series = useLocal
      ? local.map((p) => ({
          label: minuteLabel(p.t),
          value: Number(p[metricDef.field]),
        }))
      : (hourly?.records || []).map((r) => ({
          label: hourLabel(r.date),
          value: Number(r[metricDef.field]),
        }));
    const stats = useLocal
      ? trendStats(local, metricDef.field)
      : trendStats(
          (hourly?.records || []).map((r) => ({
            aqi: r.aqi,
            pm2_5: r.pm2_5,
            pm10: r.pm10,
          })),
          metricDef.field,
        );

    const pollutants = AQI_POLLUTANTS.map((p) => {
      const value = live[p.key];
      const pct = value == null ? 0 : Math.min(100, (Number(value) / p.max) * 100);
      return { ...p, value, pct };
    });

    panelEl.innerHTML = `
      <header class="aqi-panel-head">
        <div>
          <strong>Air quality</strong>
          <small>Live · ${escapeHtml(point.label || "AOI")}</small>
        </div>
        <div class="aqi-panel-stamp">${escapeHtml(formatStamp(live.last_updated || live.date))}</div>
      </header>

      <div class="aqi-panel-hero">
        <div class="aqi-ring" style="--aqi-color:${escapeAttr(cat.color)};--aqi-pct:${gaugePct.toFixed(1)}%">
          <div class="aqi-ring-track" aria-hidden="true"></div>
          <div class="aqi-ring-core">
            <b>${escapeHtml(String(aqiVal))}</b>
            <span>AQI</span>
          </div>
        </div>
        <div class="aqi-hero-copy">
          <span class="aqi-cat-pill" style="--aqi-color:${escapeAttr(cat.color)}">${escapeHtml(cat.label)}</span>
          <div class="aqi-scale-row" aria-hidden="true">
            ${AQI_CATEGORIES.map(
              (c) => `<i style="background:${escapeAttr(c.color)}" title="${escapeAttr(c.label)}"></i>`,
            ).join("")}
          </div>
          ${
            stats
              ? `<div class="aqi-mini-stats">
                  <span><em>Min</em>${stats.min}</span>
                  <span><em>Avg</em>${stats.avg}</span>
                  <span><em>Max</em>${stats.max}</span>
                </div>`
              : ""
          }
        </div>
      </div>

      <div class="aqi-poll-grid">
        ${pollutants
          .map(
            (p) => `
          <div class="aqi-poll-cell">
            <div class="aqi-poll-top">
              <span>${escapeHtml(p.label)}</span>
              <b>${fmtNum(p.value)}</b>
            </div>
            <div class="aqi-poll-track">
              <i style="width:${p.pct.toFixed(0)}%;background:${escapeAttr(p.color)}"></i>
            </div>
          </div>`,
          )
          .join("")}
      </div>

      <div class="aqi-trend-block">
        <div class="aqi-trend-head">
          <strong>${escapeHtml(metricDef.label)} trend</strong>
          <small>${useLocal ? "Fused live history" : "Hourly · selected day"}</small>
        </div>
        <div class="aqi-chart-wrap">
          ${series.length ? trendSvg(series, metricDef.color) : `<p class="aqi-panel-status">No samples yet</p>`}
        </div>
      </div>`;
  }

  function renderDateSheet() {
    const prev = shiftYmd(day, -1);
    const next = shiftYmd(day, 1);
    const today = todayYmd();
    const nextDisabled = next > today;
    yearEl.innerHTML = `
      <button type="button" class="lu-theme-year-side" id="aqi-day-prev"
        data-day="${escapeAttr(prev)}" aria-label="Previous day">
        <span class="lu-theme-year-arrow" aria-hidden="true">←</span>
        <span class="lu-theme-year-side-val">${escapeHtml(shortDay(prev))}</span>
      </button>
      <div class="lu-theme-year-center">
        <span class="lu-theme-year-eyebrow">Date</span>
        <strong class="lu-theme-year-current">${escapeHtml(day === today ? "Today" : shortDay(day))}</strong>
        <small class="aqi-year-range">${escapeHtml(day)}</small>
      </div>
      <button type="button" class="lu-theme-year-side" id="aqi-day-next"
        ${nextDisabled ? "disabled" : ""} data-day="${escapeAttr(next)}"
        aria-label="Next day">
        <span class="lu-theme-year-side-val">${escapeHtml(nextDisabled ? "—" : shortDay(next))}</span>
        <span class="lu-theme-year-arrow" aria-hidden="true">→</span>
      </button>`;
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
    dispose() {
      hide();
      backEl.remove();
      classesEl.remove();
      panelEl.remove();
      yearEl.remove();
    },
  };
}

function trendSvg(series, color) {
  const w = 360;
  const h = 88;
  const padL = 6;
  const padR = 6;
  const padT = 8;
  const padB = 18;
  const vals = series.map((s) => s.value).filter((n) => Number.isFinite(n));
  if (!vals.length) return `<p class="aqi-panel-status">No samples</p>`;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const pts = series.map((s, i) => {
    const x = padL + (i / Math.max(1, series.length - 1)) * plotW;
    const y = Number.isFinite(s.value)
      ? padT + plotH - ((s.value - min) / span) * plotH
      : padT + plotH / 2;
    return { x, y, label: s.label };
  });
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${padL.toFixed(1)},${(padT + plotH).toFixed(1)} ${line} ${(padL + plotW).toFixed(1)},${(padT + plotH).toFixed(1)}`;
  const uid = `aqiFill${Math.abs(hashColor(color))}`;
  const labels = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]]
    .filter(Boolean)
    .map(
      (p) =>
        `<text x="${p.x.toFixed(1)}" y="${h - 4}" text-anchor="middle">${escapeHtml(p.label || "")}</text>`,
    );

  return `<svg class="aqi-trend-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Trend">
    <defs>
      <linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${escapeAttr(color)}" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="${escapeAttr(color)}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <polygon points="${area}" fill="url(#${uid})"/>
    <polyline points="${line}" fill="none" stroke="${escapeAttr(color)}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <g fill="rgba(210,228,236,0.7)" font-size="9">${labels.join("")}</g>
  </svg>`;
}

function hashColor(c) {
  let h = 0;
  for (const ch of String(c)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

function hourLabel(dateStr) {
  if (!dateStr) return "";
  const m = String(dateStr).match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : String(dateStr).slice(11, 16);
}

function minuteLabel(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
