/**
 * Centered Open-Meteo weather detail popup — past 6 / future 6 day graphs.
 */
import { X } from "lucide";
import { lucideHtml } from "../icons.js";
import {
  fetchWeatherSeries,
  PAST_DAYS,
  FUTURE_DAYS,
  FALLBACK_WEATHER_LL,
} from "../../services/weatherService.js";

/**
 * @param {HTMLElement} root
 */
export function mountWeatherDetailPanel(root) {
  const backdrop = document.createElement("div");
  backdrop.className = "weather-detail-backdrop map-chrome";
  backdrop.id = "weather-detail-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");

  const el = document.createElement("aside");
  el.className = "hud weather-detail-panel";
  el.id = "weather-detail-panel";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Live weather details");
  backdrop.appendChild(el);
  root.appendChild(backdrop);

  /** @type {{ lat?:number, lon?:number, label?:string } | null} */
  let lastPoint = null;
  let loadSerial = 0;

  function hide() {
    backdrop.hidden = true;
    backdrop.setAttribute("aria-hidden", "true");
    el.innerHTML = "";
  }

  function resolvePoint(point) {
    const p = point || lastPoint;
    const lat = Number(p?.lat);
    const lon = Number(p?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon, label: p?.label || null, fallback: false };
    }
    return {
      lat: FALLBACK_WEATHER_LL.lat,
      lon: FALLBACK_WEATHER_LL.lon,
      label: "Mula–Mutha (default)",
      fallback: true,
    };
  }

  /**
   * @param {{ lat?:number, lon?:number, label?:string } | null} point
   * @param {{ bustCache?: boolean }} [opts]
   */
  async function show(point, opts = {}) {
    if (point) lastPoint = point;
    const resolved = resolvePoint(lastPoint);
    lastPoint = { lat: resolved.lat, lon: resolved.lon, label: resolved.label };

    const serial = ++loadSerial;
    backdrop.hidden = false;
    backdrop.setAttribute("aria-hidden", "false");
    el.innerHTML = panelShell({
      title: "Live Weather",
      subtitle: `${resolved.label ? `${escapeHtml(resolved.label)} · ` : ""}${resolved.lat.toFixed(4)}°N, ${resolved.lon.toFixed(4)}°E`,
      body: `<p class="weather-detail-loading">Loading Open-Meteo · past ${PAST_DAYS} / next ${FUTURE_DAYS} days…</p>`,
    });
    bindClose();

    try {
      const series = await fetchWeatherSeries(resolved.lat, resolved.lon, {
        bustCache: !!opts.bustCache,
      });
      if (serial !== loadSerial) return;
      el.innerHTML = panelShell({
        title: "Live Weather",
        subtitle: `${resolved.label ? `${escapeHtml(resolved.label)} · ` : ""}Open-Meteo · past ${series.pastDays} days · next ${series.futureDays} days`,
        body: renderBody(series),
      });
      bindClose();
      try {
        bindChartHovers(el);
      } catch (hoverErr) {
        console.warn("[weather-detail] hover bind", hoverErr?.message || hoverErr);
      }
    } catch (err) {
      if (serial !== loadSerial) return;
      if (isAbortError(err)) return;
      console.warn("[weather-detail]", err?.message || err);
      const msg = err?.message ? String(err.message) : "Weather series unavailable";
      el.innerHTML = panelShell({
        title: "Live Weather",
        subtitle: "Open-Meteo",
        body: `<p class="weather-detail-error">${escapeHtml(msg)}</p>
          <p class="weather-detail-note">Check network access to api.open-meteo.com, then retry.</p>
          <div class="weather-detail-retry-row">
            <button type="button" class="weather-detail-retry" id="weather-detail-retry">Retry live weather</button>
          </div>`,
      });
      bindClose();
      el.querySelector("#weather-detail-retry")?.addEventListener("click", () => {
        void show(lastPoint, { bustCache: true });
      });
    }
  }

  function isAbortError(err) {
    return (
      err?.name === "AbortError" ||
      err?.code === 20 ||
      /aborted|AbortError/i.test(String(err?.message || ""))
    );
  }

  function bindClose() {
    el.querySelector("#weather-detail-close")?.addEventListener("click", hide);
  }

  function bindChartHovers(panel) {
    const tip = panel.querySelector("#weather-detail-tip");
    if (!tip) return;

    panel.querySelectorAll(".weather-detail-chart-wrap").forEach((wrap) => {
      const svg = wrap.querySelector("svg");
      if (!svg) return;
      const hits = [...svg.querySelectorAll("[data-wx-hit]")];
      if (!hits.length) return;

      const highlight = svg.querySelector(".weather-detail-hover-mark");
      const guide = svg.querySelector(".weather-detail-hover-guide");

      const clear = () => {
        tip.hidden = true;
        tip.innerHTML = "";
        wrap.classList.remove("is-hovering");
        if (highlight) highlight.setAttribute("visibility", "hidden");
        if (guide) guide.setAttribute("visibility", "hidden");
        hits.forEach((h) => h.classList.remove("is-active"));
      };

      const showTip = (hit, clientX, clientY) => {
        const date = hit.getAttribute("data-date") || "";
        const label = hit.getAttribute("data-label") || date;
        const value = hit.getAttribute("data-value") || "—";
        const unit = hit.getAttribute("data-unit") || "";
        const kind = hit.getAttribute("data-kind") || "";
        const metric = hit.getAttribute("data-metric") || "";
        const kindText =
          kind === "today" ? "Today" : kind === "future" ? "Forecast" : "Observed";

        tip.hidden = false;
        tip.innerHTML = `
          <strong>${escapeHtml(metric)}</strong>
          <span>${escapeHtml(label)}</span>
          <b>${escapeHtml(value)} <em>${escapeHtml(unit)}</em></b>
          <small>${escapeHtml(kindText)} · live Open-Meteo</small>`;

        const panelRect = panel.getBoundingClientRect();
        const tipW = tip.offsetWidth || 160;
        const tipH = tip.offsetHeight || 72;
        let left = clientX - panelRect.left + 14;
        let top = clientY - panelRect.top - tipH - 10;
        if (left + tipW > panelRect.width - 8) left = clientX - panelRect.left - tipW - 14;
        if (top < 8) top = clientY - panelRect.top + 16;
        tip.style.left = `${Math.max(8, left)}px`;
        tip.style.top = `${Math.max(8, top)}px`;

        hits.forEach((h) => h.classList.toggle("is-active", h === hit));
        wrap.classList.add("is-hovering");

        const cx = Number(hit.getAttribute("data-cx"));
        const cy = Number(hit.getAttribute("data-cy"));
        if (highlight && Number.isFinite(cx) && Number.isFinite(cy)) {
          highlight.setAttribute("cx", String(cx));
          highlight.setAttribute("cy", String(cy));
          highlight.setAttribute("visibility", "visible");
        }
        if (guide && Number.isFinite(cx)) {
          guide.setAttribute("x1", String(cx));
          guide.setAttribute("x2", String(cx));
          guide.setAttribute("visibility", "visible");
        }
      };

      const nearestHit = (clientX) => {
        const rect = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        const scaleX = vb.width / Math.max(1, rect.width);
        const localX = (clientX - rect.left) * scaleX;
        let best = null;
        let bestD = Infinity;
        for (const hit of hits) {
          const cx = Number(hit.getAttribute("data-cx"));
          if (!Number.isFinite(cx)) continue;
          const d = Math.abs(cx - localX);
          if (d < bestD) {
            bestD = d;
            best = hit;
          }
        }
        return best;
      };

      wrap.addEventListener("pointermove", (e) => {
        const hit = nearestHit(e.clientX);
        if (!hit) {
          clear();
          return;
        }
        showTip(hit, e.clientX, e.clientY);
      });
      wrap.addEventListener("pointerleave", clear);
    });
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) hide();
  });

  function onKey(e) {
    if (e.key === "Escape" && !backdrop.hidden) hide();
  }
  document.addEventListener("keydown", onKey);

  return {
    el,
    show,
    hide,
    setPoint(point) {
      lastPoint = point;
    },
    isVisible: () => !backdrop.hidden,
    dispose() {
      hide();
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
    },
  };
}

function panelShell({ title, subtitle, body }) {
  return `
    <header class="weather-detail-head">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${subtitle || ""}</p>
      </div>
      <button type="button" class="weather-detail-close" id="weather-detail-close" aria-label="Close weather details">
        ${lucideHtml(X, { size: 14 })}
      </button>
    </header>
    <div class="weather-detail-body">${body}</div>
    <div class="weather-detail-tip" id="weather-detail-tip" hidden></div>
  `;
}

function renderBody(series) {
  const days = series.days || [];
  if (days.length < 2) {
    return `<p class="weather-detail-error">Not enough daily samples.</p>`;
  }
  const charts = [
    {
      id: "temp",
      title: "Temperature",
      unit: "°C",
      color: "#f0b45a",
      values: days.map((d) => d.temperature_mean),
      hint: "Daily mean",
    },
    {
      id: "precip",
      title: "Precipitation",
      unit: "mm",
      color: "#5bc8e8",
      values: days.map((d) => d.precipitation),
      hint: "Total (all types)",
      bars: true,
    },
    {
      id: "rain",
      title: "Rainfall",
      unit: "mm",
      color: "#4aa8ff",
      values: days.map((d) => d.rainfall),
      hint: "Rain only",
      bars: true,
    },
    {
      id: "wind",
      title: "Wind",
      unit: "km/h",
      color: "#9ee7a8",
      values: days.map((d) => d.wind_max),
      hint: "Max wind speed",
    },
    {
      id: "pm25",
      title: "PM2.5",
      unit: "µg/m³",
      color: "#e8a13d",
      values: days.map((d) => d.pm25),
      hint: "Daily mean · air quality",
    },
    {
      id: "pm10",
      title: "PM10",
      unit: "µg/m³",
      color: "#d48a6a",
      values: days.map((d) => d.pm10),
      hint: "Daily mean · air quality",
    },
  ];

  const todayIdx = days.findIndex((d) => d.kind === "today");
  const rangeStart = days[0]?.date || "";
  const rangeEnd = days[days.length - 1]?.date || "";
  const fetchedAt = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date());

  const banner = `
    <div class="weather-detail-banner">
      <span class="weather-detail-live">LIVE API</span>
      <span>Open-Meteo · ${escapeHtml(rangeStart)} → ${escapeHtml(rangeEnd)}</span>
      <span>Fetched ${escapeHtml(fetchedAt)} IST</span>
    </div>`;

  const legend = `
    <div class="weather-detail-legend">
      <span class="is-past">Past ${series.pastDays} days (solid)</span>
      <span class="is-today">Today</span>
      <span class="is-future">Next ${series.futureDays} days (dashed)</span>
      <span class="is-axis">X = date · Y = value</span>
    </div>`;

  const grid = charts
    .map((c) => {
      let latestIdx = todayIdx >= 0 && Number.isFinite(c.values[todayIdx]) ? todayIdx : -1;
      if (latestIdx < 0) {
        for (let i = c.values.length - 1; i >= 0; i--) {
          if (Number.isFinite(c.values[i])) {
            latestIdx = i;
            break;
          }
        }
      }
      const latest = latestIdx >= 0 ? c.values[latestIdx] : null;
      const latestText = Number.isFinite(latest) ? `${Number(latest).toFixed(1)} ${c.unit}` : "—";
      return `
        <article class="weather-detail-card" data-metric="${c.id}">
          <header>
            <div>
              <strong>${escapeHtml(c.title)} <em>(${escapeHtml(c.unit)})</em></strong>
              <small>${escapeHtml(c.hint)} · hover chart for day values</small>
            </div>
            <b title="Value at today / latest">${escapeHtml(latestText)}</b>
          </header>
          <div class="weather-detail-chart-wrap">
            ${renderChart(days, c.values, c.color, c.unit, todayIdx, !!c.bars, c.title)}
          </div>
        </article>`;
    })
    .join("");

  return `${banner}${legend}<div class="weather-detail-grid">${grid}</div>
    <p class="weather-detail-note">Hover any chart to inspect each day · Live Open-Meteo Forecast + Air Quality APIs</p>`;
}

function renderChart(days, values, color, unit, todayIdx, asBars, metricTitle = "") {
  const w = 420;
  const h = 168;
  const padL = 42;
  const padR = 12;
  const padT = 16;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const nums = values.filter(Number.isFinite);
  if (!nums.length) {
    return `<p class="weather-detail-empty">No data from API for this metric</p>`;
  }

  let yMin = Math.min(...nums);
  let yMax = Math.max(...nums);
  if (asBars || yMin >= 0) yMin = Math.min(0, yMin);
  if (yMax - yMin < 1e-3) {
    yMax = yMin + (asBars ? 1 : 2);
  }
  const nice = niceScale(yMin, yMax, 4);
  yMin = nice.min;
  yMax = nice.max;
  const yTicks = nice.ticks;

  const n = days.length;
  const xOf = (i) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yOf = (v) => padT + ((yMax - v) / Math.max(1e-6, yMax - yMin)) * plotH;
  const zeroY = yOf(Math.max(yMin, Math.min(yMax, 0)));

  const gridLines = yTicks
    .map((v) => {
      const y = yOf(v);
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" class="weather-detail-gridline" />
        <text x="${padL - 6}" y="${y + 3}" text-anchor="end" class="weather-detail-tick">${formatTick(v, unit)}</text>`;
    })
    .join("");

  const labelEvery = n <= 9 ? 1 : 2;
  const xLabels = days
    .map((d, i) => {
      const force = i === 0 || i === n - 1 || d.kind === "today" || i % labelEvery === 0;
      if (!force) return "";
      const x = xOf(i);
      const short = shortDate(d.date);
      const cls = d.kind === "today" ? "weather-detail-x is-today" : "weather-detail-x";
      return `<text x="${x.toFixed(1)}" y="${h - 6}" text-anchor="middle" class="${cls}">${escapeHtml(short)}</text>`;
    })
    .join("");

  let seriesSvg = "";
  if (asBars) {
    const bw = Math.max(5, (plotW / n) * 0.58);
    seriesSvg = values
      .map((v, i) => {
        if (!Number.isFinite(v)) return "";
        const cx = xOf(i);
        const x = cx - bw / 2;
        const y = yOf(Math.max(0, v));
        const bh = Math.max(1.5, zeroY - y);
        const kind = days[i]?.kind || "past";
        const op = kind === "future" ? 0.55 : kind === "today" ? 1 : 0.92;
        return `<rect class="weather-detail-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" opacity="${op}" rx="2" />
          <rect class="weather-detail-hit" data-wx-hit ${hitAttrs(days[i], v, unit, metricTitle, cx, y, kind)} x="${(cx - Math.max(bw, 14) / 2).toFixed(1)}" y="${padT}" width="${Math.max(bw, 14).toFixed(1)}" height="${plotH}" fill="transparent" />`;
      })
      .join("");
  } else {
    const pastEnd = todayIdx >= 0 ? todayIdx : Math.floor(n / 2);
    const pastPts = [];
    const futurePts = [];
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(values[i])) continue;
      const p = `${xOf(i).toFixed(1)},${yOf(values[i]).toFixed(1)}`;
      if (i <= pastEnd) pastPts.push(p);
      if (i >= pastEnd) futurePts.push(p);
    }
    const dots = values
      .map((v, i) => {
        if (!Number.isFinite(v)) return "";
        const cx = xOf(i);
        const cy = yOf(v);
        const kind = days[i]?.kind || "past";
        const r = kind === "today" ? 3.8 : 2.6;
        return `<circle class="weather-detail-dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${color}" />
          <circle class="weather-detail-hit" data-wx-hit ${hitAttrs(days[i], v, unit, metricTitle, cx, cy, kind)} cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11" fill="transparent" />`;
      })
      .join("");
    seriesSvg = `
      ${pastPts.length >= 2 ? `<polyline fill="none" stroke="${color}" stroke-width="2.4" points="${pastPts.join(" ")}" />` : ""}
      ${futurePts.length >= 2 ? `<polyline fill="none" stroke="${color}" stroke-width="2.4" stroke-dasharray="5 4" opacity="0.8" points="${futurePts.join(" ")}" />` : ""}
      ${dots}`;
  }

  let todayLine = "";
  if (todayIdx >= 0) {
    const tx = xOf(todayIdx);
    todayLine = `<line x1="${tx.toFixed(1)}" y1="${padT}" x2="${tx.toFixed(1)}" y2="${padT + plotH}" class="weather-detail-today-line" />`;
  }

  return `<svg class="weather-detail-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(metricTitle || unit)} by date — hover for values">
    <text x="10" y="12" class="weather-detail-axis-label">Y: ${escapeHtml(unit)}</text>
    ${gridLines}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" class="weather-detail-axis" />
    <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" class="weather-detail-axis" />
    ${todayLine}
    <line class="weather-detail-hover-guide" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" visibility="hidden" />
    ${seriesSvg}
    <circle class="weather-detail-hover-mark" cx="0" cy="0" r="5.5" visibility="hidden" />
    ${xLabels}
  </svg>`;
}

function hitAttrs(day, value, unit, metric, cx, cy, kind) {
  return `data-date="${escapeHtml(day?.date || "")}" data-label="${escapeHtml(day?.label || day?.date || "")}" data-value="${Number(value).toFixed(1)}" data-unit="${escapeHtml(unit)}" data-metric="${escapeHtml(metric)}" data-kind="${escapeHtml(kind)}" data-cx="${Number(cx).toFixed(1)}" data-cy="${Number(cy).toFixed(1)}"`;
}

/** Round scale to readable ticks. */
function niceScale(min, max, tickCount = 4) {
  const span = Math.max(1e-6, max - min);
  const rawStep = span / tickCount;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / mag;
  let step;
  if (residual <= 1.5) step = mag;
  else if (residual <= 3) step = 2 * mag;
  else if (residual <= 7) step = 5 * mag;
  else step = 10 * mag;

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return { min: niceMin, max: niceMax === niceMin ? niceMin + step : niceMax, ticks };
}

function formatTick(v, unit) {
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(0);
  if (unit === "°C" || unit === "mm" || unit === "km/h") return v.toFixed(abs < 1 && abs > 0 ? 1 : 0);
  return abs < 1 && abs > 0 ? v.toFixed(1) : v.toFixed(0);
}

function shortDate(isoDate) {
  try {
    const d = new Date(`${isoDate}T12:00:00+05:30`);
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      timeZone: "Asia/Kolkata",
    }).format(d);
  } catch {
    return String(isoDate || "").slice(5);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
