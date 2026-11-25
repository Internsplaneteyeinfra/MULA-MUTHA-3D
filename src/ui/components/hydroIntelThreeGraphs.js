/**
 * NadiTwin three-graph Charts surface (full-width stack):
 *  1) Discharge Profile (chainage-wise Q)
 *  2) River Stage Profile
 *  3) Hydrograph (stage + Q + rain) — hist selector beside title
 *
 * Expand/collapse recalculates SVG dimensions from cached payloads —
 * no duplicate API polling when maximizing a single graph.
 * Rating Curve is intentionally excluded from this dashboard.
 */
import { attachChartHover } from "../chartHover.js";
import { getRiverStageSeries } from "../../services/hydrology/digitalTwinApi.js";
import {
  getNadiTwinHydrographAtChainage,
  getNadiTwinLiveBundle,
  refreshNadiTwinHydrology,
} from "../../services/hydrology/naditwinHydrologyAdapter.js";
import { fetchNadiTwinHydrographYear } from "../../services/hydrology/naditwinApi.js";
import { normalizeHydrograph, mapLocalChainageToCell } from "../../services/hydrology/hydrologyNormalizer.js";
import { getLiveDischargeProfileSeries } from "../../services/hydrology/naditwinChartSeries.js";
import {
  getHistoricDischargeProfileSeries,
  getHistoricRiverStageSeries,
  parseAtToLocalParts,
} from "../../services/hydrology/naditwinHistoricService.js";
import { buildHistOptions, resolveHistSelection } from "./hydroIntelHistRange.js";

/** @type {null | 'discharge' | 'stage' | 'hydro'} */
let expandedGraph = null;

/** Cached payloads so expand/collapse never re-fetches. */
const cache = {
  contentArea: null,
  C: null,
  chainage_m: null,
  hist: null,
  stretch: null,
  coverage: null,
  onHistChange: null,
  onExitFullscreen: null,
  mode: "live",
  liveMeta: null,
  historicAt: null,
  discharge: null,
  stage: null,
  pack: null,
  histOptions: [],
};

const ICON_EXPAND = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
const ICON_COLLAPSE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;

/**
 * Balanced heights for 1920×1080 / 1600×900 / 1366×768.
 * When historic full-reach spatial series are unavailable, collapse those panels
 * (~100–130 px) and give Hydrograph the primary viewport.
 * Expanded mode uses most of the available content viewport.
 */
export function resolveChartHeights(expandedId = null, opts = {}) {
  const w = typeof window !== "undefined" ? window.innerWidth : 1920;
  const h = typeof window !== "undefined" ? window.innerHeight : 1080;
  const compactSpatial = !!opts.compactSpatial;

  let discharge = 265;
  let stage = 265;
  let hydro = 320;
  if (h <= 768 || w <= 1366) {
    discharge = 230;
    stage = 230;
    hydro = 270;
  } else if (h <= 900 || w <= 1600) {
    discharge = 245;
    stage = 245;
    hydro = 295;
  }

  if (compactSpatial && !expandedId) {
    discharge = 118;
    stage = 118;
    // Hydro takes remaining viewport after header + two compact panels
    hydro = Math.max(380, Math.min(620, Math.floor(h - 360)));
    if (h <= 768 || w <= 1366) hydro = Math.max(320, Math.min(480, Math.floor(h - 340)));
    else if (h <= 900 || w <= 1600) hydro = Math.max(360, Math.min(540, Math.floor(h - 350)));
  }

  // Room for header + live meta + legends (~220–280 px chrome)
  const expandH = Math.max(440, Math.min(720, Math.floor(h - 260)));
  if (expandedId === "discharge") discharge = expandH;
  if (expandedId === "stage") stage = expandH;
  if (expandedId === "hydro") hydro = expandH;

  return { discharge, stage, hydro, font: expandedId ? 11 : 8.5, titleFs: expandedId, compactSpatial };
}

function fmtIstLabel(iso) {
  const p = parseAtToLocalParts(iso);
  return p?.label || iso || "—";
}

function sampleHydroAtTime(pack, atIso) {
  const hg = pack?.hg;
  if (!hg?.times?.length || !atIso) return null;
  const target = Date.parse(atIso);
  if (!Number.isFinite(target)) return null;
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < hg.times.length; i++) {
    const t = Date.parse(hg.times[i]);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  if (best < 0 || bestDiff > 2 * 3600_000) return null;
  const q = hg.observed_q?.[best];
  const stage = hg.observed_stage?.[best];
  const rain = hg.observed_rain?.[best];
  return {
    at: hg.times[best],
    q_m3s: Number.isFinite(Number(q)) ? Number(q) : null,
    wse_m: Number.isFinite(Number(stage)) ? Number(stage) : null,
    rain_mmh: Number.isFinite(Number(rain)) ? Number(rain) : null,
    source: "hydrograph_station_series",
  };
}

/** Compact historical availability panel (~100–130 px) — never an empty chart. */
function renderHistoricAvailabilityPanel(wrap, opts) {
  const {
    title, sub, message, reason, detail, station, kind, C, expanded,
  } = opts;
  wrap.classList.add("hip-graph-section--compact");
  wrap.classList.toggle("hip-graph-section--focused", !!expanded);
  const st = station;
  const stBits = [];
  if (st && Number.isFinite(st.q_m3s) && kind === "discharge") {
    stBits.push(`<div class="hip-avail__metric"><span class="hip-avail__k">Station Q</span><span class="hip-avail__v" style="color:${C.wse}">${st.q_m3s.toFixed(2)} m³/s</span></div>`);
  }
  if (st && Number.isFinite(st.wse_m) && kind === "stage") {
    stBits.push(`<div class="hip-avail__metric"><span class="hip-avail__k">Station stage</span><span class="hip-avail__v" style="color:${C.wse}">${st.wse_m.toFixed(3)} m</span></div>`);
  }
  if (st?.at) {
    stBits.push(`<div class="hip-avail__metric"><span class="hip-avail__k">At</span><span class="hip-avail__v">${fmtIstLabel(st.at)}</span></div>`);
  }
  if (st?.source) {
    stBits.push(`<div class="hip-avail__metric"><span class="hip-avail__k">Station source</span><span class="hip-avail__v">${st.source === "hydrograph_station_series" ? "Hydrograph (station series)" : "Historic state cell"}</span></div>`);
  }
  const reasonLine = reason
    ? `<div class="hip-avail__reason">${reason.replace(/_/g, " ")}</div>`
    : "";
  wrap.innerHTML = `
    <div class="hip-graph-head">
      <div class="hip-graph-title">${title}
        <span class="hip-sub">${sub || ""}</span></div>
      <div class="hip-graph-actions">${expandBtnHtml(kind === "discharge" ? "discharge" : "stage", !!expanded)}</div>
    </div>
    <div class="hip-avail" role="status">
      <div class="hip-avail__main">
        <div class="hip-avail__badge">HISTORICAL · UNAVAILABLE</div>
        <div class="hip-avail__msg">${message}</div>
        ${reasonLine}
        ${detail ? `<div class="hip-avail__detail">${detail}</div>` : ""}
        <div class="hip-avail__note">Full-reach spatial series not shown · LIVE profile is never substituted</div>
      </div>
      ${stBits.length ? `<div class="hip-avail__station">${stBits.join("")}</div>` : ""}
    </div>`;
}

function svgLayout(opts = {}) {
  const expanded = !!opts.expanded;
  const padL = opts.padL ?? (expanded ? 56 : 50);
  const padR = opts.padR ?? (opts.dualY ? (expanded ? 58 : 54) : (expanded ? 18 : 14));
  const padT = opts.padT ?? (expanded ? 16 : 14);
  const padB = opts.padB ?? (expanded ? 36 : 30);
  const W = opts.W ?? 1200;
  const H = opts.H ?? 260;
  return { padL, padR, padT, padB, W, H, plotW: W - padL - padR, plotH: H - padT - padB, fs: opts.fs ?? 8.5 };
}
function scaleLinear(domain, range) {
  const [d0, d1] = domain, [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}
function yTicks(L, ticks, scY, C, decimals = 2) {
  const fs = L.fs ?? 8.5;
  return ticks.map((v) => {
    const py = scY(v).toFixed(1);
    return `<line x1="${L.padL}" y1="${py}" x2="${L.padL + L.plotW}" y2="${py}" stroke="${C.gridLine}" stroke-dasharray="3,4"/>
      <text x="${L.padL - 6}" y="${parseFloat(py) + 3}" fill="${C.muted}" font-size="${fs}" text-anchor="end">${Number(v).toFixed(decimals)}</text>`;
  }).join("");
}
function axisFrame(L, C) {
  return `<line x1="${L.padL}" y1="${L.padT}" x2="${L.padL}" y2="${L.padT + L.plotH}" stroke="${C.axis}" stroke-width="1"/>
    <line x1="${L.padL}" y1="${L.padT + L.plotH}" x2="${L.padL + L.plotW}" y2="${L.padT + L.plotH}" stroke="${C.axis}" stroke-width="1"/>
    <line x1="${L.padL + L.plotW}" y1="${L.padT}" x2="${L.padL + L.plotW}" y2="${L.padT + L.plotH}" stroke="${C.axis}" stroke-width="1"/>`;
}
function svgPath(xs, ys, scX, scY) {
  let d = "", pen = true;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (!Number.isFinite(y) || !Number.isFinite(xs[i])) { pen = true; continue; }
    d += `${pen ? "M" : "L"}${scX(xs[i]).toFixed(1)},${scY(y).toFixed(1)}`;
    pen = false;
  }
  return d;
}
function svgBand(xs, lo, hi, scX, scY) {
  const pts = [];
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(lo[i]) || !Number.isFinite(hi[i])) continue;
    pts.push(i);
  }
  if (!pts.length) return "";
  const top = pts.map((i, k) => `${k === 0 ? "M" : "L"}${scX(xs[i]).toFixed(1)},${scY(hi[i]).toFixed(1)}`).join(" ");
  const base = [...pts].reverse().map((i) => `L${scX(xs[i]).toFixed(1)},${scY(lo[i]).toFixed(1)}`).join(" ");
  return `${top} ${base} Z`;
}
function legendItem(color, label, dash = false) {
  const dashAttr = dash ? ` stroke-dasharray="5,3"` : "";
  return `<svg width="18" height="9" style="vertical-align:middle;margin-right:3px"><line x1="0" y1="4.5" x2="18" y2="4.5" stroke="${color}" stroke-width="2"${dashAttr}/></svg><span style="color:${color};font-size:10px;margin-right:8px">${label}</span>`;
}
function fmtCh(m) {
  const n = Math.max(0, Math.round(Number(m) || 0));
  return `${Math.floor(n / 1000)}+${String(n % 1000).padStart(3, "0")}`;
}
function niceTicks(min, max, n = 4) {
  if (!(Number.isFinite(min) && Number.isFinite(max)) || max === min) return [min || 0];
  const step = (max - min) / n;
  return Array.from({ length: n + 1 }, (_, i) => min + i * step);
}
function parseIso(t) {
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}
function fmtLocalTick(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`;
}
function horizLevel(L, scY, value, color, label) {
  if (!Number.isFinite(value)) return "";
  const y = scY(value).toFixed(1);
  const fs = L.fs ?? 8.5;
  return `<line x1="${L.padL}" y1="${y}" x2="${L.padL + L.plotW}" y2="${y}" stroke="${color}" stroke-width="1.1" stroke-dasharray="4,3"/>
    <text x="${L.padL + L.plotW - 3}" y="${parseFloat(y) - 2}" fill="${color}" font-size="${fs}" text-anchor="end">${label}</text>`;
}

function expandBtnHtml(graphId, isExpanded) {
  const label = isExpanded ? "Restore graph size" : "Expand graph";
  const icon = isExpanded ? ICON_COLLAPSE : ICON_EXPAND;
  return `<button type="button" class="hip-expand-btn" data-expand="${graphId}" title="${label}" aria-label="${label}" aria-pressed="${isExpanded ? "true" : "false"}">${icon}</button>`;
}

async function ensureLive() {
  let live = getNadiTwinLiveBundle();
  if (!live?.wse?.length) {
    await refreshNadiTwinHydrology().catch(() => {});
    live = getNadiTwinLiveBundle();
  }
  return live;
}

function filterByStretchChainage(series, stretch, arrayKeys) {
  if (!series?.chainage_m?.length || !stretch || stretch.id === "ALL") return series;
  const from = Number(stretch.from_m);
  const to = Number(stretch.to_m);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return series;
  const idx = [];
  for (let i = 0; i < series.chainage_m.length; i++) {
    const m = series.chainage_m[i];
    if (Number.isFinite(m) && m >= from - 1 && m <= to + 1) idx.push(i);
  }
  if (idx.length < 2) return series;
  const pick = (arr) => (arr ? idx.map((i) => arr[i]) : null);
  const out = { ...series, chainage_m: pick(series.chainage_m) };
  for (const key of arrayKeys) out[key] = pick(series[key]);
  return out;
}

function filterStageByStretch(stage, stretch) {
  return filterByStretchChainage(stage, stretch, [
    "wse_now", "bed", "crest", "danger", "warning", "watch",
    "forecast_p50", "forecast_p10", "forecast_p90",
  ]);
}

function filterDischargeByStretch(discharge, stretch) {
  const filtered = filterByStretchChainage(discharge, stretch, [
    "q_now", "q_forecast_p50_24h", "q_forecast_p50_72h",
  ]);
  // Segment rain stays as published midpoints — clip to stretch window only
  if (!filtered?.rain_chainage_m?.length || !stretch || stretch.id === "ALL") return filtered;
  const from = Number(stretch.from_m);
  const to = Number(stretch.to_m);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return filtered;
  const keep = [];
  for (let i = 0; i < filtered.rain_chainage_m.length; i++) {
    const m = filtered.rain_chainage_m[i];
    if (Number.isFinite(m) && m >= from - 1 && m <= to + 1) keep.push(i);
  }
  if (!keep.length) {
    return { ...filtered, rain_chainage_m: null, rain_now_mmh: null };
  }
  return {
    ...filtered,
    rain_chainage_m: keep.map((i) => filtered.rain_chainage_m[i]),
    rain_now_mmh: keep.map((i) => filtered.rain_now_mmh[i]),
  };
}

export async function fetchHydroExact(chainage_m, hist) {
  const live = await ensureLive();
  const step = live?.chainage_step_m || 10;
  const n = live?.n_cells || 1681;
  const cell = mapLocalChainageToCell(chainage_m, n, step) ?? Math.round(chainage_m / step);
  if (hist?.year != null) {
    const res = await fetchNadiTwinHydrographYear(cell, hist.year);
    return { cell, hg: normalizeHydrograph(res.data), fetchedAt: res.fetchedAt || Date.now() };
  }
  const hours = Number(hist?.hours) > 0 ? Number(hist.hours) : 72;
  const hg = await getNadiTwinHydrographAtChainage(chainage_m, hours);
  return { cell, hg, fetchedAt: Date.now() };
}

function stretchTitle(stretch) {
  if (!stretch || stretch.id === "ALL") return "All locations (Sangam → Manjari)";
  return `${stretch.from_name} → ${stretch.to_name}`;
}

function fmtTwinHour(hour, nowIso) {
  if (Number.isFinite(Number(hour))) {
    return `${String(Number(hour)).padStart(2, "0")}:00 twin hour`;
  }
  if (nowIso) {
    const d = new Date(nowIso);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    }
  }
  return "—";
}

function renderLiveMeta(el, meta) {
  if (!el) return;
  const {
    mode = "live",
    twinDate = "—",
    twinHour = "—",
    nowIso = null,
    apiUpdated = "—",
    windowLabel = "—",
    freshness = "LIVE",
    forecastHorizon = "72 h",
    localClock = null,
    selectedIst = null,
    apiTimestamp = null,
    coverageLabel = null,
    source = null,
    dataClass = null,
    lastHistoricFetch = null,
    spatialCoverage = null,
  } = meta || {};
  const hourLabel = typeof twinHour === "number" || /^\d+$/.test(String(twinHour))
    ? fmtTwinHour(twinHour, nowIso)
    : (twinHour || fmtTwinHour(null, nowIso));
  const nowLocal = nowIso
    ? new Date(nowIso).toLocaleString()
    : "—";
  if (mode === "historic") {
    el.classList.add("hip-live-meta--historic");
    el.innerHTML = `
      <span class="hip-meta-selected"><b>Selected (IST):</b> ${selectedIst || fmtIstLabel(nowIso) || "—"}</span>
      <span><b>API timestamp:</b> ${apiTimestamp || nowLocal}</span>
      <span><b>Coverage:</b> ${coverageLabel || "—"}</span>
      <span><b>Spatial:</b> ${spatialCoverage || "—"}</span>
      <span><b>Source:</b> ${source || "NadiTwin"}</span>
      <span><b>Class:</b> ${dataClass || "HISTORICAL · MODELLED · PROVISIONAL"}</span>
      <span><b>Hydro window:</b> ${windowLabel}</span>
      <span><b>Last historic fetch:</b> ${lastHistoricFetch || apiUpdated}</span>
      <span><b>Browser clock:</b> ${localClock || new Date().toLocaleString()}</span>
      <span class="hip-fresh" data-fresh="HISTORICAL">HISTORICAL</span>`;
    return;
  }
  el.classList.remove("hip-live-meta--historic");
  el.innerHTML = `
    <span><b>Mode:</b> LIVE</span>
    <span><b>Twin date:</b> ${twinDate}</span>
    <span><b>Twin hour:</b> ${hourLabel}</span>
    <span><b>Twin now (API):</b> ${nowLocal}</span>
    <span><b>Last successful fetch:</b> ${apiUpdated}</span>
    <span><b>Live / hist window:</b> ${windowLabel}</span>
    <span><b>Forecast horizon:</b> ${forecastHorizon}</span>
    <span><b>Browser clock:</b> ${localClock || new Date().toLocaleString()}</span>
    <span class="hip-fresh" data-fresh="${freshness}">${freshness}</span>`;
}

function renderStageProfile(wrap, C, stage, chainage_m, stretch, height, expanded, stationFallback = null) {
  wrap.classList.remove("hip-graph-section--compact");
  if (stage?.unavailable) {
    renderHistoricAvailabilityPanel(wrap, {
      title: "River stage (water level)",
      sub: `${stretchTitle(stretch)} · CH ${fmtCh(chainage_m)}`,
      message: stage.message || "HISTORICAL FULL-REACH STAGE PROFILE UNAVAILABLE",
      reason: stage.reason || stage.error,
      detail: stage.detail || null,
      station: stage.station || stationFallback,
      kind: "stage",
      C,
      expanded,
    });
    return;
  }
  if (!stage?.chainage_m?.length) {
    wrap.innerHTML = `<div class="hip-error">River stage profile unavailable from NadiTwin</div>`;
    return;
  }
  const filtered = filterStageByStretch(stage, stretch);
  const chKm = filtered.chainage_m.map((m) => m / 1000);
  const seriesY = [
    ...filtered.wse_now, ...filtered.bed,
    ...(filtered.crest || []), ...(filtered.danger || []),
    ...(filtered.warning || []), ...(filtered.watch || []),
  ].filter(Number.isFinite);
  const yMin = Math.min(...seriesY) - 0.12;
  const yMax = Math.max(...seriesY) + 0.12;
  const heights = resolveChartHeights(expanded ? "stage" : null);
  const L = svgLayout({ H: height || heights.stage, padR: 14, expanded, fs: heights.font });
  const scX = scaleLinear([chKm[0] || 0, chKm[chKm.length - 1] || 1], [L.padL, L.padL + L.plotW]);
  const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
  const maxKm = chKm[chKm.length - 1] || 0;
  const minKm = chKm[0] || 0;
  const step = maxKm - minKm > 8 ? 2 : 1;
  const xTicks = [];
  for (let k = Math.floor(minKm); k <= Math.ceil(maxKm) + 0.01; k += step) {
    if (k >= minKm - 0.05 && k <= maxKm + 0.05) xTicks.push(k);
  }
  const xTk = xTicks.map((km) => {
    const x = scX(km).toFixed(1);
    const label = `${Math.floor(km)}+${String(Math.round((km % 1) * 1000)).padStart(3, "0")}`;
    return `<line x1="${x}" y1="${L.padT + L.plotH}" x2="${x}" y2="${L.padT + L.plotH + 4}" stroke="${C.axis}"/>
      <text x="${x}" y="${L.padT + L.plotH + 16}" fill="${C.muted}" font-size="${L.fs}" text-anchor="middle">${label}</text>`;
  }).join("");
  let mkr = "";
  if (Number.isFinite(chainage_m)) {
    const ax = scX(chainage_m / 1000).toFixed(1);
    mkr = `<line x1="${ax}" y1="${L.padT}" x2="${ax}" y2="${L.padT + L.plotH}" stroke="${C.active}" stroke-width="1.4" stroke-dasharray="4,3"/>`;
  }
  const stageAtLabel = stage.historic && stage.at
    ? (parseAtToLocalParts(stage.at)?.label || stage.at)
    : null;
  wrap.classList.toggle("hip-graph-section--focused", !!expanded);
  wrap.innerHTML = `
    <div class="hip-graph-head">
      <div class="hip-graph-title">River stage (water level)
        <span class="hip-sub">${stretchTitle(stretch)} · CH ${fmtCh(chainage_m)}${stageAtLabel ? ` · ${stageAtLabel}` : ""}</span></div>
      <div class="hip-graph-actions">${expandBtnHtml("stage", !!expanded)}</div>
    </div>
    <div class="hip-legend">
      ${legendItem(C.wse, stage.historic ? "Stage at selected time" : "River stage now")}
      ${legendItem(C.bed, "River bed")}
      ${filtered.watch ? legendItem(C.watch, "Watch", true) : ""}
      ${filtered.warning ? legendItem(C.warning, "Warning", true) : ""}
      ${filtered.danger ? legendItem(C.danger, "Danger", true) : ""}
      ${filtered.crest ? legendItem(C.crest, "Bank crest", true) : ""}
    </div>
    <div class="hip-svg-wrap" style="height:${L.H}px">
      <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" height="100%" preserveAspectRatio="none">
        ${axisFrame(L, C)}${yTicks(L, niceTicks(yMin, yMax, expanded ? 6 : 4), scY, C, 2)}${xTk}
        ${filtered.crest ? `<path d="${svgPath(chKm, filtered.crest, scX, scY)}" fill="none" stroke="${C.crest}" stroke-width="1.2" stroke-dasharray="2,3"/>` : ""}
        ${filtered.danger ? `<path d="${svgPath(chKm, filtered.danger, scX, scY)}" fill="none" stroke="${C.danger}" stroke-width="1.2" stroke-dasharray="5,3"/>` : ""}
        ${filtered.warning ? `<path d="${svgPath(chKm, filtered.warning, scX, scY)}" fill="none" stroke="${C.warning}" stroke-width="1.1" stroke-dasharray="5,3"/>` : ""}
        ${filtered.watch ? `<path d="${svgPath(chKm, filtered.watch, scX, scY)}" fill="none" stroke="${C.watch}" stroke-width="1.1" stroke-dasharray="4,3"/>` : ""}
        <path d="${svgPath(chKm, filtered.bed, scX, scY)}" fill="none" stroke="${C.bed}" stroke-width="1.6"/>
        <path d="${svgPath(chKm, filtered.wse_now, scX, scY)}" fill="none" stroke="${C.wse}" stroke-width="2.2"/>
        ${mkr}
        <text x="12" y="${L.padT + L.plotH / 2}" fill="${C.muted}" font-size="${L.fs}" text-anchor="middle" transform="rotate(-90,12,${L.padT + L.plotH / 2})">Level (m WSE)</text>
        <text x="${L.padL + L.plotW / 2}" y="${L.H - 4}" fill="${C.muted}" font-size="${L.fs}" text-anchor="middle">Chainage (km+m)</text>
      </svg>
    </div>`;
  const hover = [
    { label: "River stage now", color: C.wse, ys: filtered.wse_now, unit: "m" },
    { label: "River bed", color: C.bed, ys: filtered.bed, unit: "m" },
  ];
  if (filtered.watch) hover.push({ label: "Watch", color: C.watch, ys: filtered.watch, unit: "m", dot: false });
  if (filtered.warning) hover.push({ label: "Warning", color: C.warning, ys: filtered.warning, unit: "m", dot: false });
  if (filtered.danger) hover.push({ label: "Danger", color: C.danger, ys: filtered.danger, unit: "m", dot: false });
  if (filtered.crest) hover.push({ label: "Bank crest", color: C.crest, ys: filtered.crest, unit: "m", dot: false });
  attachChartHover(wrap.querySelector(".hip-svg-wrap svg"), {
    L, xs: chKm, scX, scY, decimals: 2, unit: "m",
    subtitle: stretchTitle(stretch),
    fmtX: (km) => `CH ${fmtCh(km * 1000)}`,
    series: hover,
  });
}

function renderHydrographExact(wrap, C, pack, chainage_m, hist, histOptions, onHistChange, height, expanded, cursorAtIso = null) {
  const hg = pack?.hg;
  if (!hg?.times?.length) {
    wrap.innerHTML = `<div class="hip-error">Hydrograph unavailable from NadiTwin</div>`;
    return;
  }
  const obsT = hg.times.map(parseIso);
  const fcT = (hg.forecast_times || []).map(parseIso);
  const allT = [...obsT, ...fcT].filter(Number.isFinite);
  const tMin = Math.min(...allT);
  const tMax = Math.max(...allT);
  const cursorMs = cursorAtIso ? parseIso(cursorAtIso) : null;
  const forecastBoundary = fcT.length ? Math.min(...fcT.filter(Number.isFinite)) : Date.now();
  const cursorInRange = Number.isFinite(cursorMs) && cursorMs >= tMin && cursorMs <= tMax;
  const nowMs = Number.isFinite(cursorMs)
    ? Math.min(tMax, Math.max(tMin, cursorMs))
    : forecastBoundary;
  const isSelectedCursor = Number.isFinite(cursorMs);
  const markerLabel = isSelectedCursor ? "SELECTED TIME" : "NOW";
  const selectedTsLabel = isSelectedCursor ? fmtIstLabel(cursorAtIso) : "";

  const stageObs = hg.observed_stage || [];
  const stageFc = Array.isArray(hg.forecast_median) ? hg.forecast_median : [];
  const stageP10 = Array.isArray(hg.forecast_p10) ? hg.forecast_p10 : [];
  const stageP90 = Array.isArray(hg.forecast_p90) ? hg.forecast_p90 : [];
  const qObs = hg.observed_q || [];
  const qFc = Array.isArray(hg.forecast_q_median) ? hg.forecast_q_median : [];
  const rainObs = hg.observed_rain || [];
  const rainFc = Array.isArray(hg.forecast_rain) ? hg.forecast_rain : [];
  const levels = hg.levels || {};
  const hasFcMedian = stageFc.some(Number.isFinite);
  const hasPBand = stageP10.some(Number.isFinite) && stageP90.some(Number.isFinite);
  const hasRain = [...rainObs, ...rainFc].some((v) => Number.isFinite(v) && v > 0);
  const showWatch = Number.isFinite(levels.watch);
  const showWarning = Number.isFinite(levels.warning);
  const showDanger = Number.isFinite(levels.danger);

  const stageAll = [...stageObs, ...stageFc, ...stageP10, ...stageP90,
    levels.watch, levels.warning, levels.danger].filter(Number.isFinite);
  const qAll = [...qObs, ...qFc].filter(Number.isFinite);
  const rainAll = [...rainObs, ...rainFc].filter(Number.isFinite);
  const sMin = Math.min(...stageAll) - 0.12;
  const sMax = Math.max(...stageAll) + 0.12;
  const qMax = Math.max(...qAll, 1) * 1.12;
  const rMax = Math.max(...rainAll, 0.05) * 1.3;

  const L = svgLayout({ H: height || resolveChartHeights(expanded ? "hydro" : null).hydro, dualY: true, expanded, fs: expanded ? 11 : 8.5 });
  const scX = scaleLinear([tMin, tMax], [L.padL, L.padL + L.plotW]);
  const scS = scaleLinear([sMin, sMax], [L.padT + L.plotH, L.padT]);
  const scQ = scaleLinear([0, qMax], [L.padT + L.plotH, L.padT]);
  const scR = scaleLinear([0, rMax], [L.padT, L.padT + L.plotH * 0.32]);
  const band = hasPBand ? svgBand(fcT, stageP10, stageP90, scX, scS) : "";
  const nowX = scX(nowMs).toFixed(1);

  const tickN = expanded ? 9 : 7;
  const xTk = [];
  for (let i = 0; i <= tickN; i++) {
    const t = tMin + ((tMax - tMin) * i) / tickN;
    const x = scX(t).toFixed(1);
    xTk.push(`<line x1="${x}" y1="${L.padT + L.plotH}" x2="${x}" y2="${L.padT + L.plotH + 4}" stroke="${C.axis}"/>
      <text x="${x}" y="${L.padT + L.plotH + 16}" fill="${C.muted}" font-size="${Math.max(7.5, L.fs - 0.5)}" text-anchor="middle">${fmtLocalTick(new Date(t).toISOString())}</text>`);
  }
  const qRightTicks = niceTicks(0, qMax, expanded ? 5 : 3).map((v) => {
    const y = scQ(v).toFixed(1);
    return `<text x="${L.padL + L.plotW + 5}" y="${parseFloat(y) + 3}" fill="#38bdf8" font-size="${L.fs}">${v.toFixed(1)}</text>`;
  }).join("");
  const barW = Math.max(1.1, (L.plotW / Math.max(obsT.length + fcT.length, 1)) * 0.5);
  const rainBars = [
    ...obsT.map((t, i) => ({ t, v: rainObs[i], past: true })),
    ...fcT.map((t, i) => ({ t, v: rainFc[i], past: false })),
  ].map(({ t, v, past }) => {
    if (!Number.isFinite(t) || !Number.isFinite(v) || v <= 0) return "";
    const x = scX(t) - barW / 2;
    const h = Math.max(0, scR(v) - L.padT);
    return `<rect x="${x.toFixed(1)}" y="${L.padT}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${past ? "rgba(148,163,184,0.4)" : "rgba(196,181,253,0.4)"}"/>`;
  }).join("");

  const curId = hist?.id || "72h";
  const optsHtml = (histOptions || []).map((o) =>
    `<option value="${o.value}"${o.disabled ? " disabled" : ""}${o.value === curId ? " selected" : ""}>${o.label}</option>`
  ).join("");

  wrap.classList.remove("hip-graph-section--compact");
  wrap.classList.toggle("hip-graph-section--focused", !!expanded);
  wrap.classList.toggle("hip-graph-section--primary", !!isSelectedCursor && !expanded);
  const cursorStroke = isSelectedCursor ? 2.2 : 1.4;
  const cursorDash = isSelectedCursor ? "" : ` stroke-dasharray="4,3"`;
  const cursorLabelY = L.padT + 12;
  const cursorLabel2Y = L.padT + 24;
  wrap.innerHTML = `
    <div class="hip-graph-head">
      <div class="hip-graph-title">Hydrograph (discharge + river stage + rainfall)
        <span class="hip-sub">CH ${fmtCh(chainage_m)} · cell ${pack.cell}${isSelectedCursor ? ` · ${selectedTsLabel}` : ""}</span></div>
      <div class="hip-graph-actions">
        <label class="hip-hydro-range">
          <span class="hip-sr">Historical range</span>
          <select id="hip-hydro-hist" class="hip-inline-select" title="NadiTwin historical range">${optsHtml}</select>
        </label>
        ${expandBtnHtml("hydro", !!expanded)}
      </div>
    </div>
    <div class="hip-legend">
      ${legendItem(C.observed, "Historical stage")}
      ${hasFcMedian ? legendItem(C.forecast, "Forecast median", true) : ""}
      ${hasPBand ? legendItem(C.p10p90, "P10–P90", true) : ""}
      ${legendItem("#38bdf8", "Historical discharge (right)")}
      ${hasRain ? legendItem("rgba(148,163,184,0.8)", "Rainfall (bars)") : ""}
      ${showWatch ? legendItem(C.watch, "Watch", true) : ""}
      ${showWarning ? legendItem(C.warning, "Warning", true) : ""}
      ${showDanger ? legendItem(C.danger, "Danger", true) : ""}
      ${isSelectedCursor ? legendItem(C.active, "Selected time") : ""}
    </div>
    <div class="hip-svg-wrap" style="height:${L.H}px">
      <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" height="100%" preserveAspectRatio="none">
        ${axisFrame(L, C)}${yTicks(L, niceTicks(sMin, sMax, expanded ? 6 : 4), scS, C, 2)}${xTk.join("")}${qRightTicks}
        ${hasRain ? rainBars : ""}
        ${band ? `<path d="${band}" fill="${C.p10p90}"/>` : ""}
        ${showWatch ? horizLevel(L, scS, levels.watch, C.watch, "Watch") : ""}
        ${showWarning ? horizLevel(L, scS, levels.warning, C.warning, "Warning") : ""}
        ${showDanger ? horizLevel(L, scS, levels.danger, C.danger, "Danger") : ""}
        <path d="${svgPath(obsT, stageObs, scX, scS)}" fill="none" stroke="${C.observed}" stroke-width="2"/>
        ${hasFcMedian ? `<path d="${svgPath(fcT, stageFc, scX, scS)}" fill="none" stroke="${C.forecast}" stroke-width="1.8" stroke-dasharray="5,3"/>` : ""}
        <path d="${svgPath(obsT, qObs, scX, scQ)}" fill="none" stroke="#38bdf8" stroke-width="1.6"/>
        ${qFc.some(Number.isFinite) ? `<path d="${svgPath(fcT, qFc, scX, scQ)}" fill="none" stroke="#38bdf8" stroke-width="1.4" stroke-dasharray="5,3"/>` : ""}
        <line x1="${nowX}" y1="${L.padT}" x2="${nowX}" y2="${L.padT + L.plotH}" stroke="${C.active}" stroke-width="${cursorStroke}"${cursorDash}/>
        <text x="${parseFloat(nowX) + 4}" y="${cursorLabelY}" fill="${C.active}" font-size="${Math.max(10, L.fs + 1)}" font-weight="800">${markerLabel}${isSelectedCursor && !cursorInRange ? " *" : ""}</text>
        ${isSelectedCursor ? `<text x="${parseFloat(nowX) + 4}" y="${cursorLabel2Y}" fill="${C.active}" font-size="${Math.max(8, L.fs)}" opacity="0.92">${selectedTsLabel}</text>` : ""}
        <text x="12" y="${L.padT + L.plotH / 2}" fill="${C.muted}" font-size="${L.fs}" text-anchor="middle" transform="rotate(-90,12,${L.padT + L.plotH / 2})">River stage (m, relative)</text>
        <text x="${L.W - 10}" y="${L.padT + L.plotH / 2}" fill="#38bdf8" font-size="${L.fs}" text-anchor="middle" transform="rotate(90,${L.W - 10},${L.padT + L.plotH / 2})">Discharge (m³/s)</text>
        <text x="${L.padL + L.plotW / 2}" y="${L.H - 4}" fill="${C.muted}" font-size="${L.fs}" text-anchor="middle">Local time (IST wall)</text>
      </svg>
    </div>
    <div class="hip-prov-row">
      ${obsT.length} hist${fcT.length ? ` + ${fcT.length} fc` : ""} · step_h=${hg.step_h ?? "—"} ·
      ${isSelectedCursor ? `Selected ${selectedTsLabel} · ` : ""}
      HISTORICAL · MODELLED · PROVISIONAL${!hasFcMedian ? " · forecast not shown" : " + FORECAST"}
    </div>`;

  const sel = wrap.querySelector("#hip-hydro-hist");
  if (sel && typeof onHistChange === "function") {
    if (hist?.id) sel.value = hist.id;
    sel.addEventListener("change", () => onHistChange(sel.value));
  }

  const xsHover = [...obsT, ...fcT];
  attachChartHover(wrap.querySelector(".hip-svg-wrap svg"), {
    L, xs: xsHover, scX, scY: scS, decimals: 3,
    subtitle: `CH ${fmtCh(chainage_m)} · NADITWIN${isSelectedCursor ? ` · selected ${selectedTsLabel}` : ""}`,
    fmtX: (t) => {
      const iso = new Date(t).toISOString();
      const ist = fmtIstLabel(iso);
      return `${ist} · ${fmtLocalTick(iso)}`;
    },
    series: [
      { label: "Stage", color: C.observed, ys: [...stageObs, ...stageFc], unit: "m" },
      { label: "Discharge", color: "#38bdf8", ys: [...qObs, ...qFc], unit: "m³/s", decimals: 2, dot: false },
      ...(hasRain ? [{ label: "Rain", color: "rgba(148,163,184,0.9)", ys: [...rainObs, ...rainFc], unit: "mm/h", decimals: 2, dot: false }] : []),
    ],
  });

  return {
    firstObs: hg.times?.[0],
    lastObs: hg.times?.[hg.times.length - 1],
    firstFc: hg.forecast_times?.[0],
    lastFc: hg.forecast_times?.[(hg.forecast_times || []).length - 1],
    fetchedAt: pack.fetchedAt,
  };
}

function renderDischargeProfile(wrap, C, discharge, chainage_m, stretch, height, expanded, stationFallback = null) {
  wrap.classList.remove("hip-graph-section--compact");
  if (discharge?.unavailable) {
    renderHistoricAvailabilityPanel(wrap, {
      title: "Discharge at every chainage (10 m)",
      sub: `${stretchTitle(stretch)} · CH ${fmtCh(chainage_m)}`,
      message: discharge.message || "HISTORICAL FULL-REACH DISCHARGE UNAVAILABLE",
      reason: discharge.reason || discharge.error,
      detail: discharge.detail || null,
      station: discharge.station || stationFallback,
      kind: "discharge",
      C,
      expanded,
    });
    return;
  }
  if (!discharge?.ok || !discharge.chainage_m?.length) {
    wrap.innerHTML = `<div class="hip-error">Discharge profile unavailable from NadiTwin</div>`;
    return;
  }
  const filtered = filterDischargeByStretch(discharge, stretch);
  const chKm = filtered.chainage_m.map((m) => m / 1000);
  const qNow = filtered.q_now || [];
  const q24 = filtered.q_forecast_p50_24h || null;
  const q72 = filtered.q_forecast_p50_72h || null;
  const rainCh = filtered.rain_chainage_m || null;
  const rainNow = filtered.rain_now_mmh || null;
  const hasRain = Array.isArray(rainCh) && Array.isArray(rainNow)
    && rainCh.length && rainNow.some(Number.isFinite);

  const seriesY = [...qNow, ...(q24 || []), ...(q72 || [])].filter(Number.isFinite);
  const yMin = Math.min(...seriesY) * 0.96;
  const yMax = Math.max(...seriesY, 0.1) * 1.06;
  const rainMax = hasRain
    ? Math.max(...rainNow.filter(Number.isFinite), 0.05) * 1.25
    : 1;

  const heights = resolveChartHeights(expanded ? "discharge" : null);
  const L = svgLayout({
    H: height || heights.discharge,
    dualY: hasRain,
    expanded,
    fs: heights.font,
    padR: hasRain ? undefined : 14,
  });
  const scX = scaleLinear([chKm[0] || 0, chKm[chKm.length - 1] || 1], [L.padL, L.padL + L.plotW]);
  const scY = scaleLinear([yMin, yMax], [L.padT + L.plotH, L.padT]);
  const scR = hasRain
    ? scaleLinear([0, rainMax], [L.padT + L.plotH, L.padT + L.plotH * 0.55])
    : null;

  const maxKm = chKm[chKm.length - 1] || 0;
  const minKm = chKm[0] || 0;
  const step = maxKm - minKm > 8 ? 2 : 1;
  const xTicks = [];
  for (let k = Math.floor(minKm); k <= Math.ceil(maxKm) + 0.01; k += step) {
    if (k >= minKm - 0.05 && k <= maxKm + 0.05) xTicks.push(k);
  }
  const xTk = xTicks.map((km) => {
    const x = scX(km).toFixed(1);
    const label = `${Math.floor(km)}+${String(Math.round((km % 1) * 1000)).padStart(3, "0")}`;
    return `<line x1="${x}" y1="${L.padT + L.plotH}" x2="${x}" y2="${L.padT + L.plotH + 4}" stroke="${C.axis}"/>
      <text x="${x}" y="${L.padT + L.plotH + 16}" fill="${C.muted}" font-size="${L.fs}" text-anchor="middle">${label}</text>`;
  }).join("");

  let mkr = "";
  if (Number.isFinite(chainage_m)) {
    const ax = scX(chainage_m / 1000).toFixed(1);
    mkr = `<line x1="${ax}" y1="${L.padT}" x2="${ax}" y2="${L.padT + L.plotH}" stroke="${C.active}" stroke-width="1.4" stroke-dasharray="4,3"/>`;
  }

  let rainBars = "";
  if (hasRain && scR) {
    const barW = Math.max(2.5, L.plotW / Math.max(rainCh.length * 2.2, 8));
    rainBars = rainCh.map((m, i) => {
      const v = rainNow[i];
      if (!Number.isFinite(m) || !Number.isFinite(v) || v <= 0) return "";
      const x = scX(m / 1000) - barW / 2;
      const top = scR(v);
      const h = Math.max(0, L.padT + L.plotH - top);
      return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(148,163,184,0.38)"/>`;
    }).join("");
  }

  const rainRightTicks = hasRain && scR
    ? niceTicks(0, rainMax, 3).map((v) => {
      const y = scR(v).toFixed(1);
      return `<text x="${L.padL + L.plotW + 5}" y="${parseFloat(y) + 3}" fill="rgba(148,163,184,0.95)" font-size="${L.fs}">${v.toFixed(1)}</text>`;
    }).join("")
    : "";

  const atLabel = discharge.historic && discharge.at
    ? (parseAtToLocalParts(discharge.at)?.label || discharge.at)
    : null;
  wrap.classList.toggle("hip-graph-section--focused", !!expanded);
  wrap.innerHTML = `
    <div class="hip-graph-head">
      <div class="hip-graph-title">Discharge at every chainage (10 m)
        <span class="hip-sub">${stretchTitle(stretch)} · CH ${fmtCh(chainage_m)}${atLabel ? ` · ${atLabel}` : ""}</span></div>
      <div class="hip-graph-actions">${expandBtnHtml("discharge", !!expanded)}</div>
    </div>
    <div class="hip-legend">
      ${legendItem(C.wse, discharge.historic ? "Q at selected time" : "Q now")}
      ${q24 ? legendItem(C.forecast, "Q +24 h (median)", true) : ""}
      ${q72 ? legendItem("#a78bfa", "Q +72 h (median)", true) : ""}
      ${hasRain ? legendItem("rgba(148,163,184,0.9)", "Rain now (mm/h)") : ""}
    </div>
    <div class="hip-svg-wrap" style="height:${L.H}px">
      <svg viewBox="0 0 ${L.W} ${L.H}" width="100%" height="100%" preserveAspectRatio="none">
        ${axisFrame(L, C)}${yTicks(L, niceTicks(yMin, yMax, expanded ? 6 : 4), scY, C, 1)}${xTk}${rainRightTicks}
        ${rainBars}
        ${q72 ? `<path d="${svgPath(chKm, q72, scX, scY)}" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-dasharray="5,3"/>` : ""}
        ${q24 ? `<path d="${svgPath(chKm, q24, scX, scY)}" fill="none" stroke="${C.forecast}" stroke-width="1.7" stroke-dasharray="6,3"/>` : ""}
        <path d="${svgPath(chKm, qNow, scX, scY)}" fill="none" stroke="${C.wse}" stroke-width="2.2"/>
        ${mkr}
        <text x="12" y="${L.padT + L.plotH / 2}" fill="${C.muted}" font-size="${L.fs}" text-anchor="middle" transform="rotate(-90,12,${L.padT + L.plotH / 2})">Discharge (m³/s)</text>
        ${hasRain ? `<text x="${L.W - 10}" y="${L.padT + L.plotH / 2}" fill="rgba(148,163,184,0.95)" font-size="${L.fs}" text-anchor="middle" transform="rotate(90,${L.W - 10},${L.padT + L.plotH / 2})">Rain (mm/h)</text>` : ""}
        <text x="${L.padL + L.plotW / 2}" y="${L.H - 4}" fill="${C.muted}" font-size="${L.fs}" text-anchor="middle">Chainage (km+m)</text>
      </svg>
    </div>
    <div class="hip-prov-row">
      ${discharge.historic
        ? `${filtered.provenance?.dataClass || "HISTORICAL · MODELLED · PROVISIONAL"} · Q at ${atLabel || "selected time"} · spatial +24h/+72h & rain not published for historic at`
        : `${filtered.provenance?.q_now || "NADITWIN LIVE"} · ${filtered.provenance?.forecast || ""} · ${filtered.provenance?.note || ""}`}
    </div>`;

  const hoverSeries = [
    { label: discharge.historic ? "Q selected" : "Q now", color: C.wse, ys: qNow, unit: "m³/s", decimals: 2 },
  ];
  if (q24) hoverSeries.push({ label: "Q +24 h", color: C.forecast, ys: q24, unit: "m³/s", decimals: 2, dot: false });
  if (q72) hoverSeries.push({ label: "Q +72 h", color: "#a78bfa", ys: q72, unit: "m³/s", decimals: 2, dot: false });
  attachChartHover(wrap.querySelector(".hip-svg-wrap svg"), {
    L, xs: chKm, scX, scY, decimals: 2, unit: "m³/s",
    subtitle: stretchTitle(stretch),
    fmtX: (km) => `CH ${fmtCh(km * 1000)}`,
    series: hoverSeries,
  });
}

function syncExpandChrome(contentArea) {
  const three = contentArea?.querySelector(".hip-three");
  const bar = contentArea?.querySelector("#hip-expand-bar");
  if (!three) return;
  if (expandedGraph) {
    three.dataset.expand = expandedGraph;
    three.classList.add("hip-three--expanded");
  } else {
    delete three.dataset.expand;
    three.classList.remove("hip-three--expanded");
  }
  if (bar) bar.hidden = !expandedGraph;
}

/** Re-paint from cache only — no API calls. */
function paintFromCache() {
  const {
    contentArea, C, chainage_m, hist, stretch, onHistChange,
    discharge, stage, pack, histOptions, mode, liveMeta, historicAt,
  } = cache;
  if (!contentArea || !C || !Number.isFinite(chainage_m)) return null;

  const dischargeEl = contentArea.querySelector("#hip-g-discharge");
  const stageEl = contentArea.querySelector("#hip-g-stage");
  const hydroEl = contentArea.querySelector("#hip-g-hydro");
  const metaEl = contentArea.querySelector("#hip-live-meta");
  const three = contentArea.querySelector(".hip-three");

  const dischargeUnavailable = mode === "historic" && !!discharge?.unavailable;
  const stageUnavailable = mode === "historic" && !!stage?.unavailable;
  const compactSpatial = dischargeUnavailable && stageUnavailable;
  const heights = resolveChartHeights(expandedGraph, { compactSpatial });
  // Per-panel heights: unavailable → compact strip; available → normal chart size
  const dischargeH = dischargeUnavailable && !expandedGraph
    ? 118
    : heights.discharge;
  const stageH = stageUnavailable && !expandedGraph
    ? 118
    : heights.stage;
  let hydroH = heights.hydro;
  if ((dischargeUnavailable || stageUnavailable) && !expandedGraph && !compactSpatial) {
    // One spatial panel missing — still grow hydro modestly
    hydroH = Math.max(hydroH, Math.min(520, Math.floor((typeof window !== "undefined" ? window.innerHeight : 1080) - 420)));
  }

  if (three) {
    three.classList.toggle("hip-three--historic-compact", !!(dischargeUnavailable || stageUnavailable) && !expandedGraph);
    three.classList.toggle("hip-three--historic", mode === "historic");
  }

  syncExpandChrome(contentArea);

  const hydroStation = mode === "historic" ? sampleHydroAtTime(pack, historicAt) : null;
  const qStation = discharge?.station || (hydroStation && Number.isFinite(hydroStation.q_m3s)
    ? { ...hydroStation, chainage_m } : null);
  const stageStation = stage?.station || (hydroStation && Number.isFinite(hydroStation.wse_m)
    ? { ...hydroStation, chainage_m } : null);

  if (discharge && dischargeEl) {
    renderDischargeProfile(
      dischargeEl, C, discharge, chainage_m, stretch,
      dischargeH, expandedGraph === "discharge",
      qStation,
    );
  }
  if (stage && stageEl) {
    renderStageProfile(
      stageEl, C, stage, chainage_m, stretch, stageH, expandedGraph === "stage",
      stageStation,
    );
  }
  let hydroMeta = null;
  if (pack && hydroEl) {
    hydroMeta = renderHydrographExact(
      hydroEl, C, pack, chainage_m, hist, histOptions, onHistChange,
      hydroH, expandedGraph === "hydro",
      mode === "historic" ? historicAt : null,
    );
  }

  if (metaEl) {
    const windowLabel = hydroMeta
      ? `${hydroMeta.firstObs || "—"} → ${hydroMeta.lastFc || hydroMeta.lastObs || "—"}`
      : (liveMeta?.windowLabel || "—");
    const cov = cache.coverage || {};
    const spatialLabel = (dischargeUnavailable && stageUnavailable)
      ? "Full-reach spatial unavailable · station/hydro only"
      : dischargeUnavailable
        ? "Discharge spatial unavailable"
        : stageUnavailable
          ? "Stage spatial unavailable"
          : (mode === "historic" ? "Full-reach spatial OK" : "LIVE spatial");
    const apiTs = discharge?.at || stage?.at || historicAt || liveMeta?.nowIso;
    renderLiveMeta(metaEl, {
      mode,
      twinDate: liveMeta?.twinDate || cov.latest || "—",
      twinHour: liveMeta?.twinHour ?? cov.todayHour ?? "—",
      nowIso: liveMeta?.nowIso || historicAt || null,
      apiUpdated: hydroMeta?.fetchedAt
        ? new Date(hydroMeta.fetchedAt).toLocaleString()
        : (liveMeta?.apiUpdated || "—"),
      windowLabel,
      forecastHorizon: "72 h",
      freshness: mode === "historic" ? "HISTORICAL" : "LIVE",
      localClock: liveMeta?.localClock || null,
      selectedIst: mode === "historic" ? fmtIstLabel(historicAt) : null,
      apiTimestamp: apiTs ? (fmtIstLabel(apiTs) + (discharge?.at || stage?.at ? ` · raw ${apiTs}` : "")) : "—",
      coverageLabel: cov.earliest && cov.latest ? `${cov.earliest} → ${cov.latest}` : "—",
      source: "NadiTwin /api/state · /api/hydrograph",
      dataClass: mode === "historic"
        ? "HISTORICAL · MODELLED · PROVISIONAL · UNVERIFIED"
        : "LIVE · MODELLED · PROVISIONAL",
      lastHistoricFetch: mode === "historic"
        ? (discharge?.fetchedAt || stage?.fetchedAt || hydroMeta?.fetchedAt
          ? new Date(discharge?.fetchedAt || stage?.fetchedAt || hydroMeta?.fetchedAt).toLocaleString()
          : liveMeta?.apiUpdated)
        : null,
      spatialCoverage: spatialLabel,
    });
  }

  wireExpandControls(contentArea);
  return { hydroMeta, hist, compactSpatial };
}

function setExpandedGraph(id) {
  expandedGraph = id || null;
  paintFromCache();
}

function wireExpandControls(contentArea) {
  if (!contentArea || contentArea.dataset.expandWired === "1") {
    // Re-bind buttons after innerHTML replaces them
  }
  contentArea.querySelectorAll(".hip-expand-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute("data-expand");
      if (!id) return;
      setExpandedGraph(expandedGraph === id ? null : id);
    };
  });

  const back = contentArea.querySelector("#hip-back-all");
  if (back) {
    back.onclick = (e) => {
      e.preventDefault();
      setExpandedGraph(null);
    };
  }
  const exitFs = contentArea.querySelector("#hip-exit-fs");
  if (exitFs) {
    exitFs.onclick = (e) => {
      e.preventDefault();
      setExpandedGraph(null);
      if (typeof cache.onExitFullscreen === "function") cache.onExitFullscreen();
    };
  }
}

let resizeTimer = null;
function onViewportResize() {
  if (!cache.contentArea?.querySelector(".hip-three")) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => paintFromCache(), 120);
}
if (typeof window !== "undefined") {
  window.addEventListener("resize", onViewportResize);
}

/**
 * @param {object} ctx
 * @param {'all'|'hydro'|'stage'|'discharge'} [ctx.only]
 */
export async function renderThreeGraphs(ctx) {
  const {
    contentArea, C, chainage_m, hist, stretch, coverage,
    onHistChange, onExitFullscreen, mode = "live", liveMeta = null, only = "all",
    historicAt = null,
  } = ctx;

  if (!Number.isFinite(chainage_m)) {
    contentArea.innerHTML = `<div class="hip-hint">Select a river stretch or station to load the three NadiTwin graphs.</div>`;
    return null;
  }

  cache.contentArea = contentArea;
  cache.C = C;
  cache.chainage_m = chainage_m;
  cache.hist = hist;
  cache.stretch = stretch;
  cache.coverage = coverage || {};
  cache.onHistChange = onHistChange;
  cache.onExitFullscreen = onExitFullscreen || null;
  cache.mode = mode;
  cache.liveMeta = liveMeta;
  cache.historicAt = mode === "historic" ? historicAt : null;

  let scope = only || "all";
  // Rebuild shell when missing, or when migrating away from the old rating-curve layout
  const needShell = !contentArea.querySelector(".hip-three")
    || !contentArea.querySelector("#hip-g-discharge")
    || !!contentArea.querySelector("#hip-g-rating");
  if (needShell) scope = "all";
  if (needShell || scope === "all") {
    if (needShell) expandedGraph = null;
    contentArea.innerHTML = `
      <div id="hip-live-meta" class="hip-live-meta" aria-live="polite"></div>
      <div id="hip-expand-bar" class="hip-expand-bar" hidden>
        <button type="button" id="hip-back-all" class="hip-expand-bar__btn">Back to all 3 graphs</button>
        <button type="button" id="hip-exit-fs" class="hip-expand-bar__btn hip-expand-bar__btn--ghost">Exit fullscreen</button>
      </div>
      <div class="hip-three">
        <section class="hip-graph-section" id="hip-g-discharge"></section>
        <section class="hip-graph-section" id="hip-g-stage"></section>
        <section class="hip-graph-section" id="hip-g-hydro"></section>
      </div>`;
  }

  const histOptions = buildHistOptions(coverage || {});
  let histSel = hist?.id ? hist : resolveHistSelection(hist?.id || "72h", coverage || {});
  // When historic clock picks a calendar day outside the active lookback window,
  // prefer that year's hydrograph so the SELECTED cursor can land on real times.
  if (mode === "historic" && historicAt && histSel.year == null) {
    const parts = parseAtToLocalParts(historicAt);
    const year = parts?.date ? Number(parts.date.slice(0, 4)) : null;
    if (Number.isFinite(year) && (coverage?.years || []).includes(year)) {
      const inLookback = (() => {
        // Keep user lookback if selected time is within ~lookback hours of coverage.latest
        if (!coverage?.latestMs || !Number.isFinite(histSel.hours)) return false;
        const t = Date.parse(historicAt);
        return Number.isFinite(t) && (coverage.latestMs - t) <= histSel.hours * 3600_000;
      })();
      if (!inLookback) {
        histSel = resolveHistSelection(`year:${year}`, coverage || {});
      }
    }
  }
  cache.hist = histSel;
  cache.histOptions = histOptions;

  try {
    const isHistoric = mode === "historic" && !!historicAt;
    let dischargeP = null, stageP = null, packP = null;
    if (scope === "all" || scope === "discharge") {
      dischargeP = isHistoric
        ? getHistoricDischargeProfileSeries(historicAt, { ensureMeters: chainage_m })
        : getLiveDischargeProfileSeries({ ensureMeters: chainage_m });
    }
    if (scope === "all" || scope === "stage") {
      stageP = isHistoric
        ? getHistoricRiverStageSeries(historicAt, { ensureMeters: chainage_m })
        : getRiverStageSeries(24, { ensureMeters: chainage_m });
    }
    if (scope === "all" || scope === "hydro") {
      packP = fetchHydroExact(chainage_m, histSel);
    }
    const [discharge, stage, pack] = await Promise.all([
      dischargeP || Promise.resolve(null),
      stageP || Promise.resolve(null),
      packP || Promise.resolve(null),
    ]);

    if (discharge) cache.discharge = discharge;
    if (stage) cache.stage = stage;
    if (pack) cache.pack = pack;

    return paintFromCache();
  } catch (err) {
    contentArea.innerHTML = `<div class="hip-error">NadiTwin three-graph load failed: ${err?.message || err}</div>`;
    return null;
  }
}

/** Clear expand state when the Charts panel closes. */
export function resetThreeGraphExpand() {
  expandedGraph = null;
}

/** @returns {boolean} true if an expanded graph was collapsed (no panel close). */
export function collapseThreeGraphExpandIfNeeded() {
  if (!expandedGraph) return false;
  setExpandedGraph(null);
  return true;
}
