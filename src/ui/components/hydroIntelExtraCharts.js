/**
 * Extra NadiTwin chart renderers for hydroIntelPanel (LIVE Q/depth, rainfall, rating, today, annual, margins).
 */
import { attachChartHover } from "../chartHover.js";
import {
  getLiveDischargeProfileSeries,
  getLiveDepthProfileSeries,
  getSegmentDischargeProfileSeries,
  getRainfallSeries,
  getRatingCurveSeries,
  getTodaySeries,
  getAnnualHydrographSeries,
  getMarginsChainageSeries,
  getScorecardSeries,
} from "../../services/hydrology/naditwinChartSeries.js";

function svgLayout(opts = {}) {
  const padL = opts.padL ?? 58, padR = opts.padR ?? 20, padT = opts.padT ?? 28, padB = opts.padB ?? 48;
  // Fullscreen Charts: wide dark-dashboard canvas
  const W = opts.W ?? 1280, H = opts.H ?? 480;
  return { padL, padR, padT, padB, W, H, plotW: W - padL - padR, plotH: H - padT - padB };
}

function chartSvg(contentArea) {
  return contentArea.querySelector(".hip-svg-wrap svg");
}

function bindHover(contentArea, spec) {
  const svg = chartSvg(contentArea);
  if (!svg) return;
  attachChartHover(svg, spec);
}
function scaleLinear(domain, range) {
  const [d0, d1] = domain, [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}
function yAxisTicks(yMin, yMax, n = 4) {
  const step = (yMax - yMin) / n;
  return Array.from({ length: n + 1 }, (_, i) => yMin + i * step);
}
function svgPath(xs, ys, scX, scY) {
  if (!xs?.length) return "";
  let d = "";
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (!Number.isFinite(y) || !Number.isFinite(xs[i])) continue;
    d += `${d ? "L" : "M"}${scX(xs[i]).toFixed(1)},${scY(y).toFixed(1)}`;
  }
  return d;
}
function svgBand(xs, ysLo, ysHi, scX, scY) {
  if (!xs?.length) return "";
  const pts = [];
  for (let i = 0; i < xs.length; i++) {
    const lo = ysLo[i];
    const hi = ysHi[i];
    if (!Number.isFinite(xs[i]) || !Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    pts.push(i);
  }
  if (!pts.length) return "";
  const top = pts.map((i, k) => `${k === 0 ? "M" : "L"}${scX(xs[i]).toFixed(1)},${scY(ysHi[i]).toFixed(1)}`).join(" ");
  const base = [...pts].reverse().map((i) => `L${scX(xs[i]).toFixed(1)},${scY(ysLo[i]).toFixed(1)}`).join(" ");
  return `${top} ${base} Z`;
}
function axisFrame(L, C) {
  return `<line x1="${L.padL}" y1="${L.padT}" x2="${L.padL}" y2="${L.padT + L.plotH}" stroke="${C.axis}" stroke-width="1"/>
    <line x1="${L.padL}" y1="${L.padT + L.plotH}" x2="${L.padL + L.plotW}" y2="${L.padT + L.plotH}" stroke="${C.axis}" stroke-width="1"/>`;
}
function yTicks(L, ticks, scY, C, decimals = 2) {
  return ticks.map((v) => {
    const py = scY(v).toFixed(1);
    return `<line x1="${L.padL - 5}" y1="${py}" x2="${L.padL + L.plotW}" y2="${py}" stroke="${C.gridLine}" stroke-dasharray="3,4"/>
      <text x="${L.padL - 7}" y="${parseFloat(py) + 3.5}" fill="${C.muted}" font-size="9" text-anchor="end">${v.toFixed(decimals)}</text>`;
  }).join("");
}
function xLabel(L, text, C) {
  return `<text x="${L.padL + L.plotW / 2}" y="${L.H - 3}" fill="${C.muted}" font-size="9" text-anchor="middle">${text}</text>`;
}
function yLabel(L, text, C) {
  const cx = 11, cy = L.padT + L.plotH / 2;
  return `<text x="${cx}" y="${cy}" fill="${C.muted}" font-size="9" text-anchor="middle" transform="rotate(-90,${cx},${cy})">${text}</text>`;
}
function legendItem(color, label, dash = false) {
  const dashAttr = dash ? ` stroke-dasharray="5,3"` : "";
  return `<svg width="22" height="10" style="vertical-align:middle;margin-right:4px"><line x1="0" y1="5" x2="22" y2="5" stroke="${color}" stroke-width="2"${dashAttr}/></svg><span style="color:${color};font-size:9px;margin-right:10px">${label}</span>`;
}
function fmtCh(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return "—";
  const km = Math.floor(n / 1000);
  const rem = Math.round(n % 1000);
  return `${km}+${String(rem).padStart(3, "0")}`;
}
function provRow(html, C) {
  return `<div class="hip-prov-row">${html}</div>`;
}

/** @param {object} ctx { contentArea, C, chainage_m } */
export async function renderLiveQProfile(ctx) {
  const { contentArea, C, chainage_m } = ctx;
  contentArea.innerHTML = `<div class="hip-loading">Loading live discharge profile…</div>`;
  const [reach, segs] = await Promise.all([
    getLiveDischargeProfileSeries({ ensureMeters: chainage_m }),
    getSegmentDischargeProfileSeries(),
  ]);
  if (!reach.ok) {
    contentArea.innerHTML = `<div class="hip-error">Live Q profile unavailable</div>`;
    return;
  }
  const chKm = reach.chainage_m.map((m) => m / 1000);
  const allY = [...reach.q_now, ...(reach.q_forecast_p50_24h || [])].filter(Number.isFinite);
  const yMin = Math.min(...allY) * 0.95;
  const yMax = Math.max(...allY) * 1.05;
  const L = svgLayout();
  const scX = scaleLinear([0, chKm[chKm.length - 1] || 1], [L.padL, L.padL + L.plotW]);
  const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
  const qPath = svgPath(chKm, reach.q_now, scX, scY);
  const fcPath = reach.q_forecast_p50_24h ? svgPath(chKm, reach.q_forecast_p50_24h, scX, scY) : "";
  let mkr = "";
  if (Number.isFinite(chainage_m)) {
    const ax = scX(chainage_m / 1000).toFixed(1);
    mkr = `<line x1="${ax}" y1="${L.padT}" x2="${ax}" y2="${L.padT + L.plotH}" stroke="${C.active}" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  }
  const segNote = segs.ok
    ? `<div class="hip-sub" style="margin-top:8px">1 km segments: ${segs.segments.length} · rain next 24h (seg0)=${segs.segments[0]?.rain_next_24h_mm ?? "—"} mm</div>`
    : "";
  contentArea.innerHTML = `
    <div class="hip-graph-section">
      <div class="hip-graph-title">Live Discharge Profile <span class="hip-sub">NADITWIN LIVE · hover for values</span></div>
      <div class="hip-legend">
        ${legendItem(C.wse, "Q now (LIVE · MODELLED)")}
        ${fcPath ? legendItem(C.forecast, "Q P50 +24h (FORECAST)", true) : ""}
      </div>
      <div class="hip-svg-wrap">
        <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
          ${axisFrame(L, C)}${yTicks(L, yAxisTicks(yMin, yMax, 4), scY, C, 1)}
          <path d="${qPath}" fill="none" stroke="${C.wse}" stroke-width="2.25"/>
          ${fcPath ? `<path d="${fcPath}" fill="none" stroke="${C.forecast}" stroke-width="1.75" stroke-dasharray="6,3"/>` : ""}
          ${mkr}${yLabel(L, "Discharge (m³/s)", C)}${xLabel(L, "Chainage (km)", C)}
        </svg>
      </div>
      ${provRow(`Source: <strong>${reach.provenance.q_now}</strong> · Updated: <strong>${reach.updatedAt || "—"}</strong> · <span style="color:${C.warn}">${reach.provenance.note}</span>`, C)}
      ${segNote}
    </div>`;
  bindHover(contentArea, {
    L, xs: chKm, scX, scY, unit: "m³/s", decimals: 2,
    subtitle: `Updated ${reach.updatedAt || "—"} · LIVE · MODELLED`,
    fmtX: (km) => `CH ${fmtCh(km * 1000)}`,
    series: [
      { label: "Q now (LIVE)", color: C.wse, ys: reach.q_now },
      ...(reach.q_forecast_p50_24h ? [{ label: "Q +24h P50", color: C.forecast, ys: reach.q_forecast_p50_24h }] : []),
    ],
  });
}

export async function renderLiveDepthProfile(ctx) {
  const { contentArea, C, chainage_m } = ctx;
  contentArea.innerHTML = `<div class="hip-loading">Loading depth profile…</div>`;
  const d = await getLiveDepthProfileSeries({ ensureMeters: chainage_m });
  if (!d.ok) {
    contentArea.innerHTML = `<div class="hip-error">Depth profile unavailable</div>`;
    return;
  }
  const chKm = d.chainage_m.map((m) => m / 1000);
  const allY = [...d.depth_m, ...d.wse_m, ...d.bed_m].filter(Number.isFinite);
  const yMin = Math.min(...allY) - 0.1;
  const yMax = Math.max(...allY) + 0.15;
  const L = svgLayout();
  const scX = scaleLinear([0, chKm[chKm.length - 1] || 1], [L.padL, L.padL + L.plotW]);
  const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
  contentArea.innerHTML = `
    <div class="hip-graph-section">
      <div class="hip-graph-title">Live Depth / Stage Profile <span class="hip-sub">NADITWIN LIVE · hover for values</span></div>
      <div class="hip-legend">
        ${legendItem(C.wse, "WSE (relative)")}
        ${legendItem(C.bed, "Bed")}
        ${legendItem("#38bdf8", "Depth (m)")}
      </div>
      <div class="hip-svg-wrap">
        <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
          ${axisFrame(L, C)}${yTicks(L, yAxisTicks(yMin, yMax, 4), scY, C, 2)}
          <path d="${svgPath(chKm, d.bed_m, scX, scY)}" fill="none" stroke="${C.bed}" stroke-width="1.75"/>
          <path d="${svgPath(chKm, d.wse_m, scX, scY)}" fill="none" stroke="${C.wse}" stroke-width="2.25"/>
          ${yLabel(L, "Level (m · relative)", C)}${xLabel(L, "Chainage (km)", C)}
        </svg>
      </div>
      ${provRow(`Depth: <strong>${d.provenance.depth}</strong> · Datum: <strong style="color:#ff4d4f">RELATIVE</strong> · ${d.provenance.note}`, C)}
    </div>`;
  bindHover(contentArea, {
    L, xs: chKm, scX, scY, decimals: 2,
    subtitle: `Updated ${d.updatedAt || "—"} · RELATIVE · not MSL`,
    fmtX: (km) => `CH ${fmtCh(km * 1000)}`,
    series: [
      { label: "WSE", color: C.wse, ys: d.wse_m, unit: "m" },
      { label: "Bed", color: C.bed, ys: d.bed_m, unit: "m" },
      { label: "Depth", color: "#38bdf8", ys: d.depth_m, unit: "m" },
    ],
  });
}

export async function renderRainfall(ctx) {
  const { contentArea, C, chainage_m, pastHours } = ctx;
  if (!Number.isFinite(chainage_m)) {
    contentArea.innerHTML = `<div class="hip-hint">Select a station for rainfall.</div>`;
    return;
  }
  const lookback = Number.isFinite(pastHours) ? Math.max(24, Math.min(pastHours, 2160)) : 72;
  contentArea.innerHTML = `<div class="hip-loading">Loading rainfall…</div>`;
  const d = await getRainfallSeries(chainage_m, lookback);
  if (!d.ok) {
    contentArea.innerHTML = `<div class="hip-error">Rainfall series unavailable</div>`;
    return;
  }
  const xs = [...d.observed.hours, ...d.forecast.hours];
  const ys = [...d.observed.rain_mmh, ...d.forecast.rain_mmh];
  const yMax = Math.max(0.05, ...ys.filter(Number.isFinite)) * 1.2;
  const L = svgLayout();
  const x0 = xs[0] ?? -lookback, x1 = xs[xs.length - 1] ?? 24;
  const scX = scaleLinear([x0, x1], [L.padL, L.padL + L.plotW]);
  const scY = scaleLinear([0, yMax], [L.padT + L.plotH, L.padT]);
  const barW = Math.max(1.5, (L.plotW / Math.max(xs.length, 1)) * 0.7);
  const bars = xs.map((h, i) => {
    const v = ys[i];
    if (!Number.isFinite(v)) return "";
    const x = scX(h) - barW / 2;
    const y = scY(v);
    const bh = L.padT + L.plotH - y;
    const col = h <= 0 ? C.observed : C.forecast;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" fill="${col}" opacity="0.85"/>`;
  }).join("");
  const nowX = scX(0).toFixed(1);
  contentArea.innerHTML = `
    <div class="hip-graph-section">
      <div class="hip-graph-title">Rainfall at CH ${fmtCh(chainage_m)} <span class="hip-sub">NADITWIN · past ${lookback}h + forecast · hover</span></div>
      <div class="hip-legend">
        ${legendItem(C.observed, "Historical rain (MODELLED)")}
        ${legendItem(C.forecast, "Forecast rain")}
      </div>
      <div class="hip-svg-wrap">
        <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
          ${axisFrame(L, C)}${yTicks(L, yAxisTicks(0, yMax, 4), scY, C, 2)}
          <line x1="${nowX}" y1="${L.padT}" x2="${nowX}" y2="${L.padT + L.plotH}" stroke="${C.active}" stroke-dasharray="4,3"/>
          <text x="${parseFloat(nowX) + 4}" y="${L.padT + 12}" fill="${C.active}" font-size="10" font-weight="700">NOW</text>
          ${bars}${yLabel(L, "Rain (mm/h)", C)}${xLabel(L, "Hours relative to now", C)}
        </svg>
      </div>
      ${provRow(`Past: <strong>${d.provenance.observed}</strong> · Forecast: <strong>${d.provenance.forecast}</strong> · ${d.provenance.note}`, C)}
    </div>`;
  bindHover(contentArea, {
    L, xs, scX, scY, unit: "mm/h", decimals: 2,
    subtitle: "MODELLED · not gauge OBSERVED",
    fmtX: (h) => (h === 0 ? "NOW" : `${h > 0 ? "+" : ""}${Number(h).toFixed(0)} h`),
    series: [{ label: "Rainfall", color: C.observed, ys }],
  });
}

export async function renderRating(ctx) {
  const { contentArea, C, chainage_m } = ctx;
  if (!Number.isFinite(chainage_m)) {
    contentArea.innerHTML = `<div class="hip-hint">Select a station for rating curve.</div>`;
    return;
  }
  contentArea.innerHTML = `<div class="hip-loading">Loading rating curve…</div>`;
  const d = await getRatingCurveSeries(chainage_m);
  if (!d.ok) {
    contentArea.innerHTML = `<div class="hip-error">Rating curve unavailable${d.error ? `: ${d.error}` : ""}</div>`;
    return;
  }
  const qs = d.q_m3s, st = d.stage_m;
  const xMin = Math.min(...qs.filter(Number.isFinite));
  const xMax = Math.max(...qs.filter(Number.isFinite));
  const yMin = Math.min(...st.filter(Number.isFinite)) - 0.05;
  const yMax = Math.max(...st.filter(Number.isFinite)) + 0.1;
  const L = svgLayout({ padL: 58 });
  const scX = scaleLinear([xMin, xMax], [L.padL, L.padL + L.plotW]);
  const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
  const path = svgPath(qs, st, scX, scY);
  let nowDot = "";
  if (Number.isFinite(d.now?.q) && Number.isFinite(d.now?.stage)) {
    nowDot = `<circle cx="${scX(d.now.q).toFixed(1)}" cy="${scY(d.now.stage).toFixed(1)}" r="5" fill="${C.active}" stroke="#fff" stroke-width="2"/>`;
  }
  contentArea.innerHTML = `
    <div class="hip-graph-section">
      <div class="hip-graph-title">Rating Curve · CH ${fmtCh(chainage_m)} <span class="hip-sub">cell ${d.cell} · hover for values</span></div>
      <div class="hip-legend">
        ${legendItem(C.wse, "Q–Stage curve (DERIVED)")}
        ${legendItem(C.active, "Now")}
      </div>
      <div class="hip-svg-wrap">
        <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
          ${axisFrame(L, C)}${yTicks(L, yAxisTicks(yMin, yMax, 4), scY, C, 2)}
          <path d="${path}" fill="none" stroke="${C.wse}" stroke-width="2.25"/>
          ${nowDot}${yLabel(L, "Stage (m · relative)", C)}${xLabel(L, "Discharge (m³/s)", C)}
        </svg>
      </div>
      ${provRow(`Now Q=<strong>${d.now?.q ?? "—"}</strong> m³/s · Stage=<strong>${d.now?.stage ?? "—"}</strong> m · ${d.provenance.note}`, C)}
    </div>`;
  bindHover(contentArea, {
    L, xs: qs, scX, scY, decimals: 2,
    subtitle: `Now Q ${d.now?.q ?? "—"} m³/s · Stage ${d.now?.stage ?? "—"} m`,
    fmtX: (q) => `Q ${Number(q).toFixed(2)} m³/s`,
    series: [{ label: "Stage (rel.)", color: C.wse, ys: st, unit: "m" }],
  });
}

export async function renderToday(ctx) {
  const { contentArea, C, chainage_m } = ctx;
  if (!Number.isFinite(chainage_m)) {
    contentArea.innerHTML = `<div class="hip-hint">Select a station for today chart.</div>`;
    return;
  }
  contentArea.innerHTML = `<div class="hip-loading">Loading today series…</div>`;
  const d = await getTodaySeries(chainage_m);
  if (!d.ok) {
    contentArea.innerHTML = `<div class="hip-error">Today series unavailable</div>`;
    return;
  }
  const hours = d.hours;
  const qAll = [...d.q_observed, ...d.q_forecast_p90, ...d.q_forecast_p10, ...d.q_forecast_median]
    .filter(Number.isFinite);
  if (!qAll.length) {
    contentArea.innerHTML = `<div class="hip-error">Today series empty from NadiTwin</div>`;
    return;
  }
  const yMin = Math.min(...qAll) * 0.95;
  const yMax = Math.max(...qAll) * 1.05;
  const L = svgLayout();
  const scX = scaleLinear([0, 23], [L.padL, L.padL + L.plotW]);
  const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
  const band = svgBand(hours, d.q_forecast_p10, d.q_forecast_p90, scX, scY);
  const obsPath = svgPath(hours, d.q_observed, scX, scY);
  const fcPath = svgPath(hours, d.q_forecast_median, scX, scY);
  const curX = Number.isFinite(d.current_hour) ? scX(d.current_hour).toFixed(1) : null;
  contentArea.innerHTML = `
    <div class="hip-graph-section">
      <div class="hip-graph-title">Today Discharge · ${d.date || ""} <span class="hip-sub">NADITWIN LIVE · CH ${fmtCh(chainage_m)} · cell ${d.cell}</span></div>
      <div class="hip-legend">
        ${legendItem(C.observed, "Past hours (NADITWIN · MODELLED)")}
        ${legendItem(C.forecast, "Forecast median (NADITWIN)", true)}
        ${legendItem(C.ok, "P10–P90 (NADITWIN)")}
      </div>
      <div class="hip-svg-wrap">
        <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
          ${axisFrame(L, C)}${yTicks(L, yAxisTicks(yMin, yMax, 4), scY, C, 1)}
          <path d="${band}" fill="${C.p10p90}"/>
          <path d="${obsPath}" fill="none" stroke="${C.observed}" stroke-width="2.25"/>
          <path d="${fcPath}" fill="none" stroke="${C.forecast}" stroke-width="1.75" stroke-dasharray="6,3"/>
          ${curX ? `<line x1="${curX}" y1="${L.padT}" x2="${curX}" y2="${L.padT + L.plotH}" stroke="${C.active}" stroke-dasharray="3,3"/>` : ""}
          ${yLabel(L, "Discharge (m³/s)", C)}${xLabel(L, "Local hour of day", C)}
        </svg>
      </div>
      ${provRow(`NADITWIN <strong>/api/today</strong> · Date <strong>${d.date}</strong> · hour <strong>${d.current_hour}</strong> · Updated <strong>${d.updatedAt || "—"}</strong> · ${d.provenance.note}`, C)}
    </div>`;
  bindHover(contentArea, {
    L, xs: hours, scX, scY, unit: "m³/s", decimals: 2,
    subtitle: `NADITWIN LIVE · ${d.date || ""} · current hour ${d.current_hour ?? "—"}`,
    fmtX: (h) => `${String(h).padStart(2, "0")}:00`,
    series: [
      { label: "Past Q (MODELLED)", color: C.observed, ys: d.q_observed },
      { label: "Forecast P50", color: C.forecast, ys: d.q_forecast_median },
      { label: "P90", color: C.ok, ys: d.q_forecast_p90, dot: false },
      { label: "P10", color: C.ok, ys: d.q_forecast_p10, dot: false },
    ],
  });
}

export async function renderAnnual(ctx) {
  const { contentArea, C, chainage_m, histYear } = ctx;
  if (!Number.isFinite(chainage_m)) {
    contentArea.innerHTML = `<div class="hip-hint">Select a station for annual hydrograph.</div>`;
    return;
  }
  const year = Number.isFinite(histYear) ? histYear : new Date().getFullYear() - 1;
  contentArea.innerHTML = `<div class="hip-loading">Loading ${year} hydrograph…</div>`;
  const d = await getAnnualHydrographSeries(chainage_m, year);
  if (!d.ok) {
    contentArea.innerHTML = `<div class="hip-error">Annual hydrograph unavailable${d.error ? `: ${d.error}` : ""}</div>`;
    return;
  }
  const xs = d.times.map((_, i) => i);
  const qs = d.q_m3s;
  const finite = qs.filter(Number.isFinite);
  const qMin = Math.min(...finite);
  const qMax = Math.max(...finite);
  const pad = Math.max((qMax - qMin) * 0.06, 1);
  const yMin = Math.max(0, qMin - pad * 0.25);
  const yMax = qMax + pad;
  const L = svgLayout();
  const scX = scaleLinear([0, xs.length - 1 || 1], [L.padL, L.padL + L.plotW]);
  const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
  contentArea.innerHTML = `
    <div class="hip-graph-section">
      <div class="hip-graph-title">Annual Discharge ${d.year} <span class="hip-sub">HISTORICAL · MODELLED · hover</span></div>
      <div class="hip-legend">${legendItem(C.wse, `Q ${d.year} (NADITWIN)`)}</div>
      <div class="hip-svg-wrap">
        <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
          ${axisFrame(L, C)}${yTicks(L, yAxisTicks(yMin, yMax, 4), scY, C, 1)}
          <path d="${svgPath(xs, qs, scX, scY)}" fill="none" stroke="${C.wse}" stroke-width="2.4"/>
          ${yLabel(L, "Discharge (m³/s)", C)}${xLabel(L, `Year ${d.year} (downsampled)`, C)}
        </svg>
      </div>
      ${provRow(`<strong>${d.provenance.dataClass}</strong> · ${d.provenance.note}`, C)}
    </div>`;
  // Only Q is plotted on this Y-axis. Stage/Rain stay tooltip-only (different units).
  bindHover(contentArea, {
    L, xs, scX, scY, unit: "m³/s", decimals: 2,
    subtitle: `Year ${d.year} · HISTORICAL · MODELLED`,
    fmtX: (_x, i) => {
      const t = d.times[i];
      return t ? String(t).slice(0, 16).replace("T", " ") : `#${i}`;
    },
    series: [
      { label: "Q", color: C.wse, ys: qs, unit: "m³/s" },
      { label: "Stage", color: C.bed, ys: d.stage_m, unit: "m", decimals: 2, dot: false },
      { label: "Rain", color: C.forecast, ys: d.rain_mmh, unit: "mm/h", decimals: 2, dot: false },
    ],
  });
}

export async function renderMarginsProfile(ctx) {
  const { contentArea, C, chainage_m } = ctx;
  contentArea.innerHTML = `<div class="hip-loading">Loading margins profile…</div>`;
  const d = await getMarginsChainageSeries(1);
  if (!d.ok) {
    contentArea.innerHTML = `<div class="hip-error">Margins chainage unavailable (display-only · safety LOCKED)</div>`;
    return;
  }
  const chKm = d.rows.map((r) => r.chainage_m / 1000);
  const wse = d.rows.map((r) => r.wse_now);
  const danger = d.rows.map((r) => r.danger);
  const crest = d.rows.map((r) => r.crest);
  const allY = [...wse, ...danger, ...crest].filter(Number.isFinite);
  const yMin = Math.min(...allY) - 0.1;
  const yMax = Math.max(...allY) + 0.15;
  const L = svgLayout();
  const scX = scaleLinear([chKm[0] || 0, chKm[chKm.length - 1] || 1], [L.padL, L.padL + L.plotW]);
  const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
  const watch = d.rows.map((r) => r.watch);
  const warning = d.rows.map((r) => r.warning);
  const margin = d.rows.map((r) => r.margin_now_m);
  contentArea.innerHTML = `
    <div class="hip-graph-section">
      <div class="hip-graph-title">Margins along Reach <span class="hip-sub">DISPLAY ONLY · SAFETY LOCKED · hover</span></div>
      <div class="hip-legend">
        ${legendItem(C.wse, "WSE now")}
        ${legendItem(C.critical, "Danger", true)}
        ${legendItem(C.warn || "#ea580c", "Warning", true)}
        ${legendItem(C.observed, "Crest", true)}
      </div>
      <div class="hip-svg-wrap">
        <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" preserveAspectRatio="xMidYMid meet">
          ${axisFrame(L, C)}${yTicks(L, yAxisTicks(yMin, yMax, 4), scY, C, 2)}
          <path d="${svgPath(chKm, crest, scX, scY)}" fill="none" stroke="${C.observed}" stroke-width="1.4" stroke-dasharray="2,3"/>
          <path d="${svgPath(chKm, danger, scX, scY)}" fill="none" stroke="${C.critical}" stroke-width="1.4" stroke-dasharray="5,3"/>
          <path d="${svgPath(chKm, warning, scX, scY)}" fill="none" stroke="${C.warn || "#ea580c"}" stroke-width="1.2" stroke-dasharray="4,3"/>
          <path d="${svgPath(chKm, wse, scX, scY)}" fill="none" stroke="${C.wse}" stroke-width="2.25"/>
          ${yLabel(L, "Level (m · relative)", C)}${xLabel(L, "Chainage (km)", C)}
        </svg>
      </div>
      ${provRow(`<strong>${d.provenance.dataClass}</strong> · ${d.provenance.note}`, C)}
    </div>`;
  bindHover(contentArea, {
    L, xs: chKm, scX, scY, decimals: 2,
    subtitle: "DISPLAY ONLY · safety boards LOCKED",
    fmtX: (km) => `CH ${fmtCh(km * 1000)}`,
    series: [
      { label: "WSE now", color: C.wse, ys: wse, unit: "m" },
      { label: "Watch", color: "#ca8a04", ys: watch, unit: "m", dot: false },
      { label: "Warning", color: C.warn || "#ea580c", ys: warning, unit: "m", dot: false },
      { label: "Danger", color: C.critical, ys: danger, unit: "m", dot: false },
      { label: "Crest", color: C.observed, ys: crest, unit: "m", dot: false },
      { label: "Margin", color: "#22c55e", ys: margin, unit: "m" },
    ],
  });
}

export async function renderScorecard(ctx) {
  const { contentArea, C } = ctx;
  contentArea.innerHTML = `<div class="hip-loading">Loading scorecard…</div>`;
  const d = await getScorecardSeries();
  if (!d.ok) {
    contentArea.innerHTML = `<div class="hip-error">Scorecard unavailable or empty</div>`;
    return;
  }

  const findRow = (...needles) => {
    const row = d.rows.find((r) => {
      const m = String(r.metric || r.name || "").toLowerCase();
      return needles.every((n) => m.includes(String(n).toLowerCase()));
    });
    return row ? String(row.value ?? "—") : null;
  };

  const rmse = findRow("rmse") ?? "—";
  const hits = findRow("hit") ?? "—";
  const misses = findRow("miss") ?? "—";
  const falseAlarms = findRow("false") ?? "—";
  const ensemble = findRow("ensemble") ?? "—";
  const sourceRow = d.rows.find((r) => /data source/i.test(String(r.metric || "")));
  const sourceText = sourceRow ? String(sourceRow.value || "") : "";

  // NadiTwin scorecard does not currently expose observation-pair counts.
  // Treat missing / zero RMSE with zero hits+misses+false as insufficient for skill claims.
  const nHits = Number(hits);
  const nMiss = Number(misses);
  const nFa = Number(falseAlarms);
  const pairProxy = [nHits, nMiss, nFa].filter(Number.isFinite).reduce((a, b) => a + b, 0);
  const rmseNum = Number.parseFloat(String(rmse));
  const insufficient =
    !Number.isFinite(pairProxy) ||
    pairProxy <= 0 ||
    (Number.isFinite(rmseNum) && rmseNum === 0 && pairProxy === 0);

  const cards = [
    {
      label: "Forecast RMSE",
      value: rmse,
      unit: "",
      hint: "Stage 24 h forecast RMSE (hindcast · modelled). Not gauge-validated skill unless observation pairs exist.",
      warn: insufficient,
    },
    {
      label: "Threshold hits",
      value: hits,
      unit: "events",
      hint: "Threshold-exceedance hits in the evaluation window.",
    },
    {
      label: "Misses",
      value: misses,
      unit: "events",
      hint: "Exceedances that were not forecast.",
    },
    {
      label: "False alarms",
      value: falseAlarms,
      unit: "events",
      hint: "Forecast exceedances that did not occur.",
    },
    {
      label: "Ensemble size",
      value: ensemble,
      unit: "members",
      hint: "NadiTwin ensemble member count used for P10/P50/P90.",
    },
    {
      label: "Observation pairs",
      value: insufficient ? "0" : String(pairProxy),
      unit: "pairs",
      hint: "Genuine gauge OBSERVED pairs are required for validated forecast skill.",
      warn: insufficient,
    },
    {
      label: "Evaluation period",
      value: "24 h",
      unit: "",
      hint: "Scorecard window reported by NadiTwin (threshold / RMSE rows).",
    },
    {
      label: "Validation status",
      value: insufficient ? "INSUFFICIENT" : "HINDCAST",
      unit: "",
      hint: insufficient
        ? "INSUFFICIENT OBSERVATION DATA — do not treat zero RMSE as accuracy."
        : "Hindcast / modelled metrics only — not gauge-validated skill.",
      warn: insufficient,
    },
  ];

  const cardHtml = cards.map((c) => `
    <article class="hip-kpi-card${c.warn ? " is-warn" : ""}">
      <header class="hip-kpi-label">${c.label}</header>
      <div class="hip-kpi-value">${c.value}${c.unit ? `<span class="hip-kpi-unit">${c.unit}</span>` : ""}</div>
      <p class="hip-kpi-hint">${c.hint}</p>
    </article>`).join("");

  contentArea.innerHTML = `
    <div class="hip-graph-section hip-scorecard">
      <div class="hip-graph-title">Hindcast Scorecard <span class="hip-sub">NADITWIN · VALIDATION</span></div>
      ${insufficient ? `<div class="hip-banner-warn">INSUFFICIENT OBSERVATION DATA — zero RMSE is not proof of forecast accuracy without gauge OBSERVED pairs.</div>` : ""}
      <div class="hip-kpi-grid">${cardHtml}</div>
      ${sourceText ? `<div class="hip-score-source"><strong>Data source</strong><p>${sourceText}</p></div>` : ""}
      ${provRow(`<strong>${d.provenance.dataClass}</strong> · Updated <strong>${d.updatedAt || "—"}</strong> · ${d.provenance.note}`, C)}
    </div>`;
}
