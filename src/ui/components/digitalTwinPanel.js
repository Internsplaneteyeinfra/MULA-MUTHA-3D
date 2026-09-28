/**
 * Current Hydrology dashboard — Digital Twin left panel.
 *
 * Every number is read from the existing pipeline for the canonical selected
 * chainage (state.selectedChainageMeters + "chainage-select"):
 *   hydrologyStore            → 1D hydraulic profile records (1,698 stations)
 *   bathymetryService         → surveyed depth (raw_bathymetry_cloud.json)
 *   digitalTwinService        → asset WSE / threshold / risk status
 *   historicalHydrologyService→ replay events (drives refreshHydrologyProfile)
 *   hydrologyTelemetryService → live gauge feeds
 *   state.liveWeather         → Open-Meteo reading published by the weather widget
 *
 * Provenance chips are derived from each value's `source`, because several
 * contract `status` fields label assumed/modelled values as LIVE/VERIFIED.
 */

import {
  Activity, ArrowDownToLine, ArrowUpToLine, ChevronLeft, ChevronRight, ChevronUp,
  CloudRain, Gauge, History, Layers, RadioTower, Waves, X,
} from "lucide";
import { lucideHtml } from "../icons.js";
import { attachChartHover } from "../chartHover.js";
import { state } from "../../state.js";
import { metersToStation } from "../../scene/chainageMarkers.js";
import { hydrologyStore } from "../../services/hydrology/hydrologyStore.js";
import { refreshHydrologyProfile } from "../../services/hydrology/hydrologyProfileService.js";
import { historicalHydrologyService } from "../../services/hydrology/historicalHydrologyService.js";
import { telemetryService, GAUGE_STATIONS } from "../../services/hydrology/hydrologyTelemetryService.js";
import { bathymetryService } from "../../services/hydrology/bathymetryService.js";
import { getTwinState } from "../../services/digitalTwinService.js";

const STATUS_TEXT = { ok: "NORMAL", warn: "WARNING", critical: "CRITICAL" };
const STATUS_RANK = { critical: 0, warn: 1, ok: 2 };
const ASSET_ROWS = 6;

export function mountDigitalTwinPanel(root) {
  const el = document.createElement("aside");
  el.id = "dt-panel";
  el.className = "dt-panel hud hyd-panel";
  el.setAttribute("aria-label", "Current hydrology dashboard");
  el.innerHTML = skeleton();
  root.appendChild(el);

  const $ = (sel) => el.querySelector(sel);
  const stateBadge = $("#hyd-state");
  const stateTime = $("#hyd-time");
  const slider = $("#hyd-ch-slider");
  const chLabel = $("#hyd-ch-label");
  const chMeta = $("#hyd-ch-meta");
  const chMin = $("#hyd-ch-min");
  const chMax = $("#hyd-ch-max");
  const metricsEl = $("#hyd-metrics");
  const summaryEl = $("#hyd-summary");
  const summaryNote = $("#hyd-summary-note");
  const replaySelect = $("#hyd-replay");
  const replayNote = $("#hyd-replay-note");
  const detailsEl = $("#hyd-details");
  const detailsTitle = $("#hyd-details-title");
  const assetsEl = $("#hyd-assets");
  const chartHost = $("#hyd-chart");
  const chartNote = $("#hyd-chart-note");

  let collapsed = false;
  let twin = getTwinState() || null;
  let records = hydrologyStore.getProfile()?.records || [];
  let chart = null;
  let bathyRequested = false;
  let bathySettled = false;
  let pending = false;
  let dragTimer = 0;

  // ─── Header controls ──────────────────────────────────────────────────────
  $("#dt-toggle-btn").addEventListener("click", () => {
    collapsed = !collapsed;
    el.classList.toggle("dt-panel--collapsed", collapsed);
    $("#dt-toggle-btn").setAttribute("aria-expanded", String(!collapsed));
    $("#dt-toggle-btn").innerHTML = lucideHtml(collapsed ? ChevronLeft : ChevronUp, { size: 15 });
  });
  $("#dt-close-btn").addEventListener("click", () => {
    el.hidden = true;
  });

  // ─── Chainage selector (writes the canonical selection only) ─────────────
  let eventMeters = null;
  function selectedMeters() {
    const m = Number(eventMeters ?? state.selectedChainageMeters);
    return Number.isFinite(m) ? m : records[0]?.chainage_m ?? null;
  }

  function nearestIndex(m) {
    if (!records.length || !Number.isFinite(m)) return 0;
    let lo = 0;
    let hi = records.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (records[mid].chainage_m <= m) lo = mid;
      else hi = mid;
    }
    return Math.abs(records[lo].chainage_m - m) <= Math.abs(records[hi].chainage_m - m) ? lo : hi;
  }

  function selectChainage(meters, { dragging = false } = {}) {
    if (!Number.isFinite(meters)) return;
    state.selectedChainageMeters = meters;
    eventMeters = meters;
    state.showChainage = true;
    document.dispatchEvent(
      new CustomEvent("chainage-select", { detail: { meters, focus: true, dragging, fromHydrology: true } }),
    );
  }

  function stepStation(dir, e) {
    if (!records.length) return;
    const n = e?.shiftKey ? 10 : 1;
    const i = Math.max(0, Math.min(records.length - 1, nearestIndex(selectedMeters()) + dir * n));
    selectChainage(records[i].chainage_m);
  }
  $("#hyd-ch-prev").addEventListener("click", (e) => stepStation(-1, e));
  $("#hyd-ch-next").addEventListener("click", (e) => stepStation(1, e));

  slider.addEventListener("input", () => {
    const rec = records[Number(slider.value)];
    if (!rec) return;
    chLabel.textContent = `CH ${metersToStation(rec.chainage_m)}`;
    window.clearTimeout(dragTimer);
    dragTimer = window.setTimeout(() => selectChainage(rec.chainage_m, { dragging: true }), 60);
  });
  slider.addEventListener("change", () => {
    window.clearTimeout(dragTimer);
    const rec = records[Number(slider.value)];
    if (rec) selectChainage(rec.chainage_m);
  });

  // ─── Replay (drives the existing hydraulic profile solve) ────────────────
  replaySelect.addEventListener("change", async () => {
    const id = replaySelect.value;
    const ev = id ? historicalHydrologyService.selectEvent(id) : (historicalHydrologyService.selectEvent(null), null);
    replaySelect.disabled = true;
    schedule();
    try {
      if (ev) {
        await refreshHydrologyProfile({
          discharge_m3s: ev.discharge_m3s,
          source: ev.source,
          provenance: ev.provenance,
        });
      } else {
        await refreshHydrologyProfile();
      }
    } finally {
      replaySelect.disabled = false;
    }
  });

  // ─── Cross-section (existing modal, current station) ─────────────────────
  $("#dt-btn-cross-section").addEventListener("click", () => {
    const m = selectedMeters();
    const station = Number.isFinite(m) ? hydrologyStore.getStationAtChainage(m) : null;
    document.dispatchEvent(new CustomEvent("cross-section-modal-open", { detail: { station } }));
  });

  // ─── Asset rows → select that chainage ────────────────────────────────────
  assetsEl.addEventListener("click", (e) => {
    const row = e.target.closest("[data-asset-m]");
    if (row) selectChainage(Number(row.dataset.assetM));
  });

  // ─── Data subscriptions ───────────────────────────────────────────────────
  hydrologyStore.subscribe(({ profile }) => {
    records = profile?.records || [];
    chart = null;
    schedule();
  });
  document.addEventListener("chainage-select", (e) => {
    const m = Number(e.detail?.meters);
    if (Number.isFinite(m)) eventMeters = m;
    schedule();
  });
  document.addEventListener("twin-state-change", (e) => {
    twin = e.detail || twin;
    schedule();
  });
  document.addEventListener("chainage-weather", schedule);
  new MutationObserver(() => {
    if (!el.hidden) {
      ensureBathymetry();
      schedule();
    }
  }).observe(el, { attributes: true, attributeFilter: ["hidden"] });
  new ResizeObserver(() => {
    if (!el.hidden && chart && Math.abs(chartHost.clientWidth - chart.width) > 6) {
      chart = null;
      schedule();
    }
  }).observe(chartHost);

  function ensureBathymetry() {
    if (bathyRequested) return;
    bathyRequested = true;
    bathymetryService.init().finally(() => {
      bathySettled = true;
      schedule();
    });
  }

  function schedule() {
    if (el.hidden || pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (!el.hidden) render();
    });
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  function render() {
    const m = selectedMeters();
    const rec = Number.isFinite(m) ? hydrologyStore.getStationAtChainage(m) : null;
    renderHeader(rec);
    renderChainage(m, rec);
    renderMetrics(m, rec);
    renderChart(m);
    renderSummary();
    renderReplay();
    renderDetails(rec);
    renderAssets(m);
  }

  function replayEvent() {
    const id = historicalHydrologyService.selectedEventId;
    return id ? historicalHydrologyService.getEventById(id) : null;
  }

  function renderHeader(rec) {
    const ev = replayEvent();
    const qClass = classifyDischarge(rec?.discharge_m3s);
    let kind;
    let text;
    let time;
    if (!rec) {
      kind = "idle";
      text = "SOLVING PROFILE";
      time = "";
    } else if (ev) {
      kind = "replay";
      text = "HISTORICAL REPLAY";
      time = formatIst(ev.timestamp, true);
    } else if (qClass === "OBSERVED") {
      kind = "live";
      text = "LIVE DATA";
      time = formatIst(rec.discharge_m3s.timestamp || rec.timestamp);
    } else {
      kind = "model";
      text = "MODELLED · NO LIVE FEED";
      time = `Solved ${formatIst(rec.timestamp)}`;
    }
    stateBadge.dataset.kind = kind;
    stateBadge.innerHTML = `<i aria-hidden="true"></i>${text}`;
    stateTime.textContent = time;
    stateTime.dateTime = ev?.timestamp || rec?.timestamp || "";
  }

  function renderChainage(m, rec) {
    const ready = records.length > 0;
    slider.disabled = !ready;
    $("#hyd-ch-prev").disabled = !ready;
    $("#hyd-ch-next").disabled = !ready;
    if (!ready) {
      chLabel.textContent = Number.isFinite(m) ? `CH ${metersToStation(m)}` : "CH —";
      chMeta.textContent = "Solving hydraulic profile…";
      return;
    }
    slider.max = String(records.length - 1);
    const idx = nearestIndex(m);
    if (document.activeElement !== slider) slider.value = String(idx);
    chMin.textContent = metersToStation(records[0].chainage_m);
    chMax.textContent = metersToStation(records[records.length - 1].chainage_m);
    chLabel.textContent = `CH ${metersToStation(m)}`;
    const parts = [`Station ${idx + 1} / ${records.length.toLocaleString("en-IN")}`];
    if (Number.isFinite(rec?.width_m)) parts.push(`width ${rec.width_m.toFixed(1)} m`);
    if (Number.isFinite(rec?.lat)) parts.push(`${rec.lat.toFixed(5)}° N, ${rec.lon.toFixed(5)}° E`);
    chMeta.textContent = parts.join(" · ");
  }

  function renderMetrics(m, rec) {
    const station = Number.isFinite(m) ? `CH ${metersToStation(m)}` : "—";
    const q = rec?.discharge_m3s;
    const qClass = classifyDischarge(q);
    const bathyLoaded = bathymetryService.ready;
    const bathyDone = bathyLoaded || bathySettled;
    const bathy = bathyLoaded && Number.isFinite(m)
      ? bathymetryService.getBathymetryAt({ chainageMeters: m, lateralOffsetMeters: 0 })
      : null;
    const wse = rec?.wse_msl;
    const hasWse = Number.isFinite(wse?.value);
    const flowDepth = rec?.water_depth_m?.value;
    const weather = state.liveWeather;
    const rain = Number.isFinite(weather?.precipitation) ? weather.precipitation : null;
    const obs = telemetryService.getAllObservations();
    const liveGauges = obs.filter((o) => o.discharge?.status === "OBSERVED" || o.stage?.status === "OBSERVED").length;

    const cards = [
      card({
        icon: Waves,
        label: "Reach discharge (Q)",
        value: fmt(q?.value, 1),
        unit: "m³/s",
        ctx: q?.value != null ? `Upstream boundary · same at all stations` : "Profile not solved",
        prov: qClass,
        title: q?.source ? `Source: ${humanSource(q.source)}` : "",
      }),
      card({
        icon: ArrowUpToLine,
        label: "Water level (WSE)",
        value: hasWse ? fmt(wse.value, 2) : "—",
        unit: hasWse ? "m MSL" : "",
        ctx: hasWse
          ? station
          : `Datum unverified · relative mode${Number.isFinite(flowDepth) ? ` · ${flowDepth.toFixed(2)} m above bed (modelled)` : ""}`,
        prov: hasWse ? (wse.status === "OBSERVED" ? "OBSERVED" : "DERIVED") : "UNAVAILABLE",
        provText: hasWse ? null : "DATUM UNVERIFIED",
      }),
      card({
        icon: ArrowDownToLine,
        label: "River depth",
        value: bathy ? fmt(bathy.depthM, 2) : bathyDone ? "—" : "…",
        unit: bathy?.depthM != null ? "m" : "",
        ctx: bathy?.depthM != null ? `${station} · survey centreline` : bathyDone ? "Data unavailable" : "Loading bathymetry…",
        prov: bathy?.depthM != null ? "INTERPOLATED" : bathyDone ? "UNAVAILABLE" : "PENDING",
        title: bathy?.source ? `Source: ${bathy.source}` : "",
      }),
      card({
        icon: CloudRain,
        label: "Rainfall",
        value: rain != null ? fmt(rain, 1) : "—",
        unit: rain != null ? "mm" : "",
        ctx: rain != null ? "Open-Meteo · current interval" : weather?.error ? "Data unavailable" : "Awaiting weather feed",
        prov: rain != null ? "MODELLED" : "UNAVAILABLE",
        title: rain != null ? "Open-Meteo numerical-weather model value, not a rain gauge" : "",
      }),
      card({
        icon: Gauge,
        label: "Flow velocity",
        value: fmt(rec?.velocity_ms?.value, 2),
        unit: rec?.velocity_ms?.value != null ? "m/s" : "",
        ctx: rec?.velocity_ms?.value != null
          ? `Q ÷ A · 1D Manning${rec.froude_number != null ? ` · Fr ${rec.froude_number.toFixed(2)}` : ""}`
          : "Profile not solved",
        prov: rec?.velocity_ms?.value != null ? "MODELLED" : "UNAVAILABLE",
      }),
      card({
        icon: RadioTower,
        label: "Active stations",
        value: `${liveGauges} / ${GAUGE_STATIONS.length}`,
        unit: "live gauges",
        ctx: `${(records.length || 0).toLocaleString("en-IN")} chainage stations (model grid)`,
        prov: liveGauges > 0 ? "OBSERVED" : "UNAVAILABLE",
        provText: liveGauges > 0 ? "OBSERVED" : "NO LIVE FEED",
      }),
    ];
    metricsEl.innerHTML = cards.join("");
  }

  function renderChart(m) {
    if (!records.length) {
      chartHost.innerHTML = `<p class="hyd-empty">Hydraulic profile not solved yet</p>`;
      chart = null;
      return;
    }
    if (!chart) chart = buildChart();
    if (!chart) return;
    const x = chart.scX(Math.max(chart.x0, Math.min(chart.x1, m ?? chart.x0)));
    chart.marker.setAttribute("x1", x.toFixed(1));
    chart.marker.setAttribute("x2", x.toFixed(1));
    chart.markerLabel.setAttribute("x", x.toFixed(1));
    chart.markerLabel.setAttribute("text-anchor", x > chart.width - 60 ? "end" : x < 60 ? "start" : "middle");
    chart.markerLabel.textContent = `CH ${metersToStation(m)}`;
    const rec = hydrologyStore.getStationAtChainage(m);
    const parts = [];
    if (Number.isFinite(rec?.survey_depth_m?.value)) parts.push(`survey ${rec.survey_depth_m.value.toFixed(2)} m`);
    if (Number.isFinite(rec?.water_depth_m?.value)) parts.push(`modelled flow ${rec.water_depth_m.value.toFixed(2)} m`);
    chartNote.textContent = parts.length ? `At CH ${metersToStation(m)}: ${parts.join(" · ")}` : "";
  }

  function buildChart() {
    const W = Math.max(220, Math.round(chartHost.clientWidth || 320));
    const H = 132;
    const L = { padL: 34, padT: 16, padR: 8, padB: 20 };
    L.plotW = W - L.padL - L.padR;
    L.plotH = H - L.padT - L.padB;

    const step = Math.max(1, Math.ceil(records.length / 260));
    const pts = [];
    for (let i = 0; i < records.length; i += step) pts.push(records[i]);
    if (pts[pts.length - 1] !== records[records.length - 1]) pts.push(records[records.length - 1]);

    const xs = pts.map((r) => r.chainage_m);
    const survey = pts.map((r) => num(r.survey_depth_m?.value));
    const flow = pts.map((r) => num(r.water_depth_m?.value));
    const vals = [...survey, ...flow].filter(Number.isFinite);
    if (!vals.length) {
      chartHost.innerHTML = `<p class="hyd-empty">No depth series available</p>`;
      return null;
    }
    const lo = Math.max(0, Math.floor(Math.min(...vals) * 2) / 2 - 0.5);
    const hi = Math.ceil(Math.max(...vals) * 2) / 2 + 0.5;
    const x0 = xs[0];
    const x1 = xs[xs.length - 1];
    const scX = (v) => L.padL + ((v - x0) / Math.max(1, x1 - x0)) * L.plotW;
    const scY = (v) => L.padT + L.plotH - ((v - lo) / Math.max(0.01, hi - lo)) * L.plotH;

    const path = (ys) => {
      let d = "";
      let pen = false;
      ys.forEach((v, i) => {
        if (!Number.isFinite(v)) { pen = false; return; }
        d += `${pen ? "L" : "M"}${scX(xs[i]).toFixed(1)},${scY(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    };

    const yStep = niceStep((hi - lo) / 3);
    let grid = "";
    for (let v = Math.ceil(lo / yStep) * yStep; v <= hi + 1e-6; v += yStep) {
      const y = scY(v).toFixed(1);
      grid += `<line x1="${L.padL}" x2="${L.padL + L.plotW}" y1="${y}" y2="${y}" class="hyd-grid"/>`;
      grid += `<text x="${L.padL - 5}" y="${(Number(y) + 3).toFixed(1)}" text-anchor="end" class="hyd-axis">${v.toFixed(yStep < 1 ? 1 : 0)}</text>`;
    }
    const kmStep = x1 - x0 > 10000 ? 4000 : 2000;
    let xt = "";
    for (let v = Math.ceil(x0 / kmStep) * kmStep; v <= x1; v += kmStep) {
      xt += `<text x="${scX(v).toFixed(1)}" y="${H - 5}" text-anchor="middle" class="hyd-axis">${v / 1000} km</text>`;
    }

    const hasSurvey = survey.some(Number.isFinite);
    const hasFlow = flow.some(Number.isFinite);
    chartHost.innerHTML = `<svg class="hyd-chart-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="Depth along chainage">
      ${grid}${xt}
      <text x="${L.padL}" y="10" class="hyd-axis">Depth (m)</text>
      ${hasFlow ? `<path d="${path(flow)}" fill="none" stroke="#38bdf8" stroke-width="1.8"/>` : ""}
      ${hasSurvey ? `<path d="${path(survey)}" fill="none" stroke="#fbbf24" stroke-width="1.4"/>` : ""}
      <line class="hyd-marker" y1="${L.padT}" y2="${L.padT + L.plotH}"/>
      <text class="hyd-marker-label" y="${L.padT - 4}"></text>
    </svg>`;
    const svg = chartHost.querySelector("svg");
    const series = [];
    if (hasFlow) series.push({ label: "Modelled flow depth", color: "#38bdf8", ys: flow, fmt: (v) => `${v.toFixed(2)} m` });
    if (hasSurvey) series.push({ label: "Survey sounding", color: "#fbbf24", ys: survey, fmt: (v) => `${v.toFixed(2)} m` });
    attachChartHover(svg, {
      L, xs, scX, scY, series,
      fmtX: (v) => `CH ${metersToStation(v)}`,
      lineColor: "rgba(226,240,255,0.85)",
    });
    $("#hyd-chart-legend").innerHTML = [
      hasFlow ? `<span style="--c:#38bdf8">Modelled flow depth <em>MODELLED</em></span>` : "",
      hasSurvey ? `<span style="--c:#fbbf24">Survey sounding <em>OBSERVED / INTERP.</em></span>` : "",
    ].join("");
    return {
      width: W, x0, x1, scX,
      marker: svg.querySelector(".hyd-marker"),
      markerLabel: svg.querySelector(".hyd-marker-label"),
    };
  }

  function renderSummary() {
    const counts = twin?.riskCounts;
    const assets = twin?.assets || [];
    const cell = (key, label, noun) => {
      const n = counts ? counts[key] ?? 0 : null;
      return `<div class="hyd-cond hyd-cond--${key}">
        <b>${n == null ? "—" : n}</b>
        <span>${label}</span>
        <small>${n === 1 ? noun : `${noun}s`}</small>
      </div>`;
    };
    summaryEl.innerHTML = cell("ok", "Normal", "location") + cell("warn", "Warning", "location") + cell("critical", "Critical", "location");
    summaryNote.textContent = counts
      ? `${assets.length} landmark assets · ensemble WSE vs class thresholds (assumed) · MODELLED`
      : "Asset risk model not ready";
  }

  function renderReplay() {
    const events = historicalHydrologyService.getEvents();
    const sel = historicalHydrologyService.selectedEventId || "";
    const opts = [`<option value="">Live / Current hydrology</option>`]
      .concat(events.map((e) => `<option value="${esc(e.eventId)}">${esc(formatIst(e.timestamp, true))} · ${esc(e.name)} (${fmt(e.discharge_m3s, 0)} m³/s)</option>`))
      .join("");
    if (replaySelect.dataset.sig !== opts) {
      replaySelect.innerHTML = opts;
      replaySelect.dataset.sig = opts;
    }
    replaySelect.value = sel;
    const ev = replayEvent();
    replayNote.textContent = ev
      ? `${humanSource(ev.source)} · confidence ${ev.confidence || "—"} · ASSUMED`
      : "Current boundary condition from the hydraulic profile service";
  }

  function renderDetails(rec) {
    const ev = replayEvent();
    const q = rec?.discharge_m3s;
    const qClass = classifyDischarge(q);
    detailsTitle.textContent = qClass === "OBSERVED" && !ev ? "Data details (live)" : "Data details";
    const profile = hydrologyStore.getProfile();
    const manning = profile?.manningConfig;
    const area = rec?.cross_section_area_m2;
    const sounding = rec?.survey_depth_m;
    const weather = state.liveWeather;
    const rain = Number.isFinite(weather?.precipitation) ? weather.precipitation : null;
    const wse = rec?.wse_msl;

    const items = [
      detail("Discharge", q?.value != null ? `${fmt(q.value, 1)} m³/s` : "—", q?.source ? humanSource(q.source) : "Unavailable", qClass),
      detail(
        "WSE",
        Number.isFinite(wse?.value) ? `${fmt(wse.value, 2)} m MSL` : "—",
        Number.isFinite(wse?.value) ? humanSource(wse.source) : "Vertical datum not verified",
        Number.isFinite(wse?.value) ? "DERIVED" : "UNAVAILABLE",
      ),
      detail("Rainfall", rain != null ? `${fmt(rain, 1)} mm` : "—", rain != null ? "Open-Meteo forecast API" : "Data unavailable", rain != null ? "MODELLED" : "UNAVAILABLE"),
      detail(
        "Manning n",
        Number.isFinite(manning?.n_channel) ? manning.n_channel.toFixed(3) : "—",
        manning ? `Model parameter · ${manning.calibrated ? "calibrated" : "uncalibrated default"}` : "Unavailable",
        manning ? (manning.calibrated ? "DERIVED" : "ASSUMED") : "UNAVAILABLE",
      ),
      detail(
        "Wetted area",
        area?.value != null ? `${fmt(area.value, 1)} m²` : "—",
        area?.source ? humanSource(area.source) : "Unavailable",
        area?.value == null ? "UNAVAILABLE" : area.status === "OBSERVED" ? "OBSERVED" : area.status === "INTERPOLATED" ? "INTERPOLATED" : "MODELLED",
      ),
      detail(
        "Station sounding",
        sounding?.value != null ? `${fmt(sounding.value, 2)} m` : "—",
        sounding?.value != null ? sounding.note || "depth_profile.json" : "No sounding at this station",
        sounding?.value == null ? "UNAVAILABLE" : sounding.status === "OBSERVED" ? "OBSERVED" : "INTERPOLATED",
      ),
    ];
    detailsEl.innerHTML = items.join("");
  }

  function renderAssets(m) {
    const assets = twin?.assets || [];
    if (!assets.length) {
      assetsEl.innerHTML = `<p class="hyd-empty">${twin ? "No monitored assets" : "Asset risk model not ready"}</p>`;
      return;
    }
    const ref = Number.isFinite(m) ? m : 0;
    const rows = [...assets]
      .map((a) => ({ ...a, dist: a.chainage_m - ref }))
      .sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) || Math.abs(a.dist) - Math.abs(b.dist))
      .slice(0, ASSET_ROWS);
    assetsEl.innerHTML = rows
      .map((a) => {
        const d = Math.abs(a.dist);
        const dir = d < 5 ? "at station" : a.dist > 0 ? "downstream" : "upstream";
        const distText = d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
        const margin = Number.isFinite(a.margin_m) ? `${a.margin_m >= 0 ? "+" : ""}${a.margin_m.toFixed(2)} m` : "—";
        const status = STATUS_TEXT[a.status] || "—";
        return `<button type="button" class="hyd-asset hyd-asset--${esc(a.status)}" data-asset-m="${a.chainage_m}"
            aria-label="${esc(a.name)}, ${status}, ${distText} ${dir}">
          <span class="hyd-asset__dot" aria-hidden="true"></span>
          <span class="hyd-asset__name">${esc(a.name)}<small>${distText} ${dir} · CH ${metersToStation(a.chainage_m)}</small></span>
          <span class="hyd-asset__val">${margin}<small>margin</small></span>
          <span class="hyd-asset__status">${status}</span>
          <span class="hyd-asset__chev" aria-hidden="true">${lucideHtml(ChevronRight, { size: 14 })}</span>
        </button>`;
      })
      .join("");
  }

  function skeleton() {
    return `
      <header class="dt-panel__header hyd-head">
        <div class="hyd-head__title">
          <span class="hyd-head__icon">${lucideHtml(Activity, { size: 16 })}</span>
          <strong>Current Hydrology</strong>
        </div>
        <div class="hyd-head__state">
          <span id="hyd-state" class="hyd-state" data-kind="idle"><i aria-hidden="true"></i>—</span>
          <time id="hyd-time" class="hyd-time"></time>
        </div>
        <div class="dt-panel__controls">
          <button id="dt-toggle-btn" class="dt-icon-btn" type="button" aria-expanded="true" aria-label="Collapse panel">${lucideHtml(ChevronUp, { size: 15 })}</button>
          <button id="dt-close-btn" class="dt-icon-btn" type="button" aria-label="Close panel">${lucideHtml(X, { size: 15 })}</button>
        </div>
      </header>
      <div class="dt-panel__body hyd-body">
        <section class="hyd-chainage" aria-label="Current chainage">
          <div class="hyd-chainage__row">
            <button id="hyd-ch-prev" class="hyd-step" type="button" aria-label="Previous station (Shift: 10 stations)">${lucideHtml(ChevronLeft, { size: 16 })}</button>
            <div class="hyd-chainage__center">
              <span class="hyd-eyebrow">Current chainage</span>
              <strong id="hyd-ch-label">CH —</strong>
            </div>
            <button id="hyd-ch-next" class="hyd-step" type="button" aria-label="Next station (Shift: 10 stations)">${lucideHtml(ChevronRight, { size: 16 })}</button>
          </div>
          <input id="hyd-ch-slider" class="hyd-slider" type="range" min="0" max="0" step="1" value="0" aria-label="Select chainage station" disabled />
          <div class="hyd-chainage__ends"><span id="hyd-ch-min">—</span><span id="hyd-ch-meta" class="hyd-chainage__meta"></span><span id="hyd-ch-max">—</span></div>
        </section>

        <section id="hyd-metrics" class="hyd-metrics" aria-label="Hydrology metrics"></section>

        <section class="hyd-section" aria-labelledby="hyd-profile-title">
          <h4 id="hyd-profile-title" class="hyd-section__title">Longitudinal depth profile</h4>
          <div id="hyd-chart" class="hyd-chart"></div>
          <div id="hyd-chart-legend" class="hyd-legend"></div>
          <p id="hyd-chart-note" class="hyd-note"></p>
        </section>

        <section class="hyd-section" aria-labelledby="hyd-summary-title">
          <h4 id="hyd-summary-title" class="hyd-section__title">River condition summary</h4>
          <div id="hyd-summary" class="hyd-summary"></div>
          <p id="hyd-summary-note" class="hyd-note"></p>
        </section>

        <section class="hyd-section" aria-labelledby="hyd-replay-title">
          <h4 id="hyd-replay-title" class="hyd-section__title">${lucideHtml(History, { size: 13 })} Hydrological event replay</h4>
          <select id="hyd-replay" class="hyd-select" aria-labelledby="hyd-replay-title"></select>
          <p id="hyd-replay-note" class="hyd-note"></p>
        </section>

        <button id="dt-btn-cross-section" class="hyd-xs-btn" type="button">
          ${lucideHtml(Layers, { size: 16 })}<span>View Channel Cross-Sections &amp; Profile</span>${lucideHtml(ChevronRight, { size: 16 })}
        </button>

        <section class="hyd-section" aria-labelledby="hyd-details-title">
          <h4 id="hyd-details-title" class="hyd-section__title">Data details</h4>
          <div id="hyd-details" class="hyd-details"></div>
        </section>

        <section class="hyd-section" aria-labelledby="hyd-assets-title">
          <h4 id="hyd-assets-title" class="hyd-section__title">Key assets by risk</h4>
          <div id="hyd-assets" class="hyd-assets"></div>
        </section>
      </div>`;
  }

  schedule();

  return {
    el,
    show() { el.hidden = false; },
    hide() { el.hidden = true; },
    render: schedule,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function card({ icon, label, value, unit, ctx, prov, provText = null, title = "" }) {
  return `<article class="hyd-card"${title ? ` title="${esc(title)}"` : ""}>
    <header><span class="hyd-card__icon">${lucideHtml(icon, { size: 15 })}</span><span class="hyd-card__label">${esc(label)}</span></header>
    <div class="hyd-card__value"><b>${esc(value)}</b>${unit ? `<small>${esc(unit)}</small>` : ""}</div>
    <p class="hyd-card__ctx">${esc(ctx)}</p>
    <span class="hyd-prov" data-prov="${esc(prov)}">${esc(provText || prov)}</span>
  </article>`;
}

function detail(label, value, source, prov) {
  return `<div class="hyd-detail">
    <span class="hyd-detail__k">${esc(label)}</span>
    <b class="hyd-detail__v">${esc(value)}</b>
    <span class="hyd-detail__src">${esc(source)}</span>
    <span class="hyd-prov" data-prov="${esc(prov)}">${esc(prov)}</span>
  </div>`;
}

/** Honest class for the profile boundary discharge, read from its source. */
function classifyDischarge(pv) {
  if (!pv || pv.value == null) return "UNAVAILABLE";
  const src = String(pv.source || "").toUpperCase();
  if (/TELEMETRY|GAUGE|INGEST/.test(src) && pv.status === "OBSERVED") return "OBSERVED";
  if (/SCENARIO/.test(src)) return "SCENARIO";
  if (/ESTIMATE|BASEFLOW|BASELINE|ASSUMED/.test(src)) return "ASSUMED";
  if (pv.status === "OBSERVED") return "OBSERVED";
  return "MODELLED";
}

const SOURCE_NAMES = {
  PUNE_URBAN_CORRIDOR_SEASONAL_BASEFLOW: "Seasonal baseflow (no gauge feed)",
  CWC_BUND_GARDEN_TELEMETRY: "CWC Bund Garden telemetry",
  INITIAL_RATING_BASELINE: "Initial rating baseline",
  USER_SCENARIO: "User scenario",
  PRIORITY_1_SURVEYED: "Surveyed transect",
  PRIORITY_4_PARAMETRIC: "Parametric section",
};

function humanSource(src) {
  if (!src) return "—";
  const key = String(src);
  if (SOURCE_NAMES[key]) return SOURCE_NAMES[key];
  return key.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatIst(iso, withDate = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts = { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false };
  if (withDate) Object.assign(opts, { day: "2-digit", month: "short", year: "numeric" });
  return `${d.toLocaleString("en-IN", opts)} IST`;
}

function niceStep(raw) {
  const mag = 10 ** Math.floor(Math.log10(Math.max(1e-6, raw)));
  return [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) || 10 * mag;
}

function num(v) {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
}

function fmt(v, d) {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? "—" : n.toFixed(d);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
