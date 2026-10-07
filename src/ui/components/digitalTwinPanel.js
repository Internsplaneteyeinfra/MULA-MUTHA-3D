/**
 * Current Hydrology dashboard — Digital Twin left panel.
 *
 * Values are read for the canonical selected chainage
 * (state.selectedChainageMeters + "chainage-select"):
 *   hydrologyStore             → 1D hydraulic profile records
 *   bathymetryService          → river depth at the station centreline
 *   digitalTwinService         → asset risk counts
 *   historicalHydrologyService → replay events (drives refreshHydrologyProfile)
 */

import {
  ArrowDownToLine, ArrowUp, Calendar, ChevronRight, ChevronUp, ChevronLeft,
  CircleAlert, Droplets, Gauge, History, Layers, Mountain, Play, Settings, TriangleAlert, Waves, X,
} from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import { metersToStation } from "../../scene/chainageMarkers.js";
import { hydrologyStore } from "../../services/hydrology/hydrologyStore.js";
import { refreshHydrologyProfile } from "../../services/hydrology/hydrologyProfileService.js";
import { historicalHydrologyService } from "../../services/hydrology/historicalHydrologyService.js";
import { bathymetryService } from "../../services/hydrology/bathymetryService.js";
import { getTwinState } from "../../services/digitalTwinService.js";
import { telemetryService, GAUGE_STATIONS } from "../../services/hydrology/hydrologyTelemetryService.js";
import { dtmElevationAtLonLat } from "../../scene/terrain.js";
import { getLiveDischargeAtChainage } from "../../services/forecastService.js";
import { subscribeLiveHydrology } from "../../services/hydrology/liveHydrologyService.js";
import {
  fetchBodCodViewerData,
  buildBodCodTimeline,
  defaultTimeIndex,
  sampleReachAt,
} from "../../services/bodCodService.js";
import { PROVENANCE_STATUS } from "../../services/hydrology/hydrologyContract.js";

const SPARK_POINTS = 64;
const GAUGE_REACH_M = 400;

/**
 * Water surface elevation (m MSL) at a profile station: a live gauge stage
 * within GAUGE_REACH_M wins; otherwise riverbed (DTM minus surveyed depth)
 * plus the current solved flow depth.
 */
function waterLevelAt(rec) {
  if (!rec) return null;
  for (const g of GAUGE_STATIONS) {
    if (Math.abs(g.chainage_m - rec.chainage_m) > GAUGE_REACH_M) continue;
    const stage = num(telemetryService.getObservation(g.stationId)?.stage_m_msl);
    if (stage != null) return stage;
  }
  const wse = num(rec.wse_msl?.value);
  if (wse != null) return wse;
  const ground = dtmElevationAtLonLat(rec.lon, rec.lat);
  const flow = num(rec.water_depth_m?.value);
  if (ground == null || flow == null) return null;
  return ground - (num(rec.survey_depth_m?.value) ?? 0) + flow;
}

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
  const metricsEl = $("#hyd-metrics");
  const summaryEl = $("#hyd-summary");
  const replaySelect = $("#hyd-replay");
  const replayTime = $("#hyd-replay-time");

  let collapsed = false;
  let twin = getTwinState() || null;
  let records = hydrologyStore.getProfile()?.records || [];
  let sparks = null;
  let bathyRequested = false;
  let bathySettled = false;
  let pending = false;
  let eventMeters = null;
  let liveQ = null;
  let liveQMeters = null;
  let profileSyncTimer = 0;
  let bodData = null;
  let bodTimeline = { dates: [], historyCount: 0 };
  let bodTimeIndex = 0;

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

  function selectedMeters() {
    const m = Number(eventMeters ?? state.selectedChainageMeters);
    return Number.isFinite(m) ? m : records[0]?.chainage_m ?? null;
  }

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

  // ─── Data subscriptions ───────────────────────────────────────────────────
  hydrologyStore.subscribe(({ profile }) => {
    records = profile?.records || [];
    sparks = null;
    schedule();
  });
  document.addEventListener("chainage-select", (e) => {
    const m = Number(e.detail?.meters);
    if (Number.isFinite(m)) eventMeters = m;
    schedule();
    pullLiveQ(m);
  });
  document.addEventListener("chainage-discharge", (e) => {
    const q = Number(e.detail?.q);
    const m = Number(e.detail?.meters);
    if (!Number.isFinite(q)) return;
    liveQ = q;
    if (Number.isFinite(m)) liveQMeters = m;
    schedule();
    syncProfileQ(q);
  });
  document.addEventListener("twin-state-change", (e) => {
    twin = e.detail || twin;
    schedule();
  });
  subscribeLiveHydrology(() => schedule());
  fetchBodCodViewerData()
    .then((data) => {
      bodData = data;
      bodTimeline = buildBodCodTimeline(data);
      bodTimeIndex = defaultTimeIndex(bodTimeline);
      schedule();
    })
    .catch(() => {});

  function pullLiveQ(meters) {
    const m = Number.isFinite(meters) ? meters : selectedMeters();
    if (!Number.isFinite(m)) return;
    getLiveDischargeAtChainage(m)
      .then((q) => {
        if (!Number.isFinite(q)) return;
        liveQ = q;
        liveQMeters = m;
        schedule();
        syncProfileQ(q);
      })
      .catch(() => {});
  }

  function syncProfileQ(q) {
    if (!Number.isFinite(q) || q <= 0) return;
    const current = num(hydrologyStore.getSummary()?.discharge_m3s);
    if (current != null && Math.abs(current - q) < 15) return;
    window.clearTimeout(profileSyncTimer);
    profileSyncTimer = window.setTimeout(() => {
      refreshHydrologyProfile({
        discharge_m3s: q,
        source: "LIVE_REACH",
        provenance: PROVENANCE_STATUS.LIVE,
      }).catch(() => {});
    }, 280);
  }
  new MutationObserver(() => {
    if (!el.hidden) {
      ensureBathymetry();
      schedule();
    }
  }).observe(el, { attributes: true, attributeFilter: ["hidden"] });

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
    renderMetrics(m, rec);
    renderSummary();
    renderReplay(rec);
  }

  function replayEvent() {
    const id = historicalHydrologyService.selectedEventId;
    return id ? historicalHydrologyService.getEventById(id) : null;
  }

  function renderHeader(rec) {
    const ev = replayEvent();
    stateBadge.dataset.kind = ev ? "replay" : "live";
    stateBadge.innerHTML = `<i aria-hidden="true"></i>${ev ? "EVENT REPLAY" : "LIVE DATA"}`;
    const ts = ev?.timestamp || rec?.discharge_m3s?.timestamp || rec?.timestamp || "";
    stateTime.textContent = ts ? formatIst(ts, true) : "";
    stateTime.dateTime = ts;
  }

  function renderMetrics(m, rec) {
    const wse = waterLevelAt(rec);
    if (!sparks || (!sparks.wse && wse != null)) sparks = buildSparks();
    const manningN = rec?.manning_n ?? hydrologyStore.getProfile()?.manningConfig?.n_channel ?? 0.035;
    const bathy = bathymetryService.ready && Number.isFinite(m)
      ? bathymetryService.getBathymetryAt({ chainageMeters: m, lateralOffsetMeters: 0 })
      : null;
    const depth = num(bathy?.depthM) ?? num(rec?.survey_depth_m?.value) ?? num(rec?.water_depth_m?.value);
    const depthLoading = depth == null && !bathySettled && !bathymetryService.ready;
    const width = num(rec?.width_m);
    const q =
      (Number.isFinite(liveQ) && (liveQMeters == null || Math.abs(liveQMeters - m) < 80) ? liveQ : null)
      ?? num(rec?.discharge_m3s?.value)
      ?? num(hydrologyStore.getSummary()?.discharge_m3s);
    const area =
      num(rec?.cross_section_area_m2?.value)
      ?? (width != null && depth != null ? (2 / 3) * width * Math.max(0.05, depth) : null);
    const vel =
      num(rec?.velocity_ms?.value)
      ?? (q != null && area != null && area > 0.5 ? q / area : null);
    const wq = liveWaterQuality(m);
    const ch = Number.isFinite(m) ? `CH ${metersToStation(m)}` : "";

    metricsEl.innerHTML = [
      card("q", Waves, "Discharge (Q)", fmt(q, 1), "m³/s", sparks.q, ch ? `${ch} · live` : "live"),
      card("wse", ArrowUp, "Water level (WSE)", fmt(wse, 2), "m MSL", sparks.wse, ch),
      card("depth", ArrowDownToLine, "River depth", depthLoading ? "…" : fmt(depth, 2), "m", sparks.depth, ch),
      card("vel", Gauge, "Flow velocity", fmt(vel, 2), "m/s", sparks.vel, q != null && area != null ? "v = Q / A" : ""),
      card("area", Mountain, "Wetted area", fmt(area, 1), "m²", sparks.area, width != null ? `width ${fmt(width, 0)} m` : ""),
      card("n", Settings, "Manning n", fmt(manningN, 3), "", sparks.n),
      card("bod", Droplets, "BOD", fmt(wq.bod, 1), "mg/L", "", ch),
      card("cod", Droplets, "COD", fmt(wq.cod, 1), "mg/L", "", ch),
    ].join("");
  }

  function liveWaterQuality(m) {
    const list = bodData?.reaches || [];
    if (!list.length || !Number.isFinite(m)) return { bod: null, cod: null };
    const km = m / 1000;
    let reach = list.find((r) => {
      const [a, b] = Array.isArray(r.km) ? r.km : [0, 2];
      return km >= Number(a) && km <= Number(b) + 1e-6;
    });
    if (!reach) {
      let bestD = Infinity;
      for (const r of list) {
        const [a, b] = Array.isArray(r.km) ? r.km : [0, 2];
        const d = Math.abs((Number(a) + Number(b)) / 2 - km);
        if (d < bestD) {
          bestD = d;
          reach = r;
        }
      }
    }
    const sample = sampleReachAt(reach, bodTimeIndex, bodData, bodTimeline);
    return { bod: num(sample?.p50), cod: num(sample?.cod_p50) };
  }

  function buildSparks() {
    const step = Math.max(1, Math.floor(records.length / SPARK_POINTS));
    const pts = [];
    for (let i = 0; i < records.length; i += step) pts.push(records[i]);
    const n = hydrologyStore.getProfile()?.manningConfig?.n_channel;
    const series = (pick) => sparkPath(pts.map(pick));
    return {
      q: series((r) => num(r.discharge_m3s?.value)),
      wse: series(waterLevelAt),
      depth: series((r) => num(r.survey_depth_m?.value) ?? num(r.water_depth_m?.value)),
      vel: series((r) => num(r.velocity_ms?.value)),
      area: series((r) => num(r.cross_section_area_m2?.value)),
      n: series((r) => num(r.manning_n) ?? num(n)),
    };
  }

  function renderSummary() {
    const counts = twin?.riskCounts;
    const cell = (key, icon, label) => {
      const n = counts ? counts[key] ?? 0 : null;
      return `<div class="hyd-cond hyd-cond--${key}">
        <span class="hyd-cond__icon" aria-hidden="true">${lucideHtml(icon, { size: 22 })}</span>
        <div class="hyd-cond__text">
          <b>${n == null ? "—" : n}</b>
          <span>${label}</span>
          <small>${n === 1 ? "location" : "locations"}</small>
        </div>
      </div>`;
    };
    summaryEl.innerHTML = cell("ok", Waves, "Normal") + cell("warn", TriangleAlert, "Warning") + cell("critical", CircleAlert, "Critical");
  }

  function renderReplay(rec) {
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
    const ts = replayEvent()?.timestamp || rec?.timestamp || "";
    replayTime.textContent = ts ? formatIst(ts, true) : "";
    replayTime.dateTime = ts;
  }

  function skeleton() {
    return `
      <header class="dt-panel__header hyd-head">
        <strong class="hyd-head__title">Current Hydrology</strong>
        <div class="hyd-head__state">
          <span id="hyd-state" class="hyd-state" data-kind="live"><i aria-hidden="true"></i>LIVE DATA</span>
          <time id="hyd-time" class="hyd-time"></time>
        </div>
        <div class="dt-panel__controls">
          <button id="dt-toggle-btn" class="dt-icon-btn" type="button" aria-expanded="true" aria-label="Collapse panel">${lucideHtml(ChevronUp, { size: 15 })}</button>
          <button id="dt-close-btn" class="dt-icon-btn" type="button" aria-label="Close panel">${lucideHtml(X, { size: 15 })}</button>
        </div>
      </header>
      <div class="dt-panel__body hyd-body">
        <section id="hyd-metrics" class="hyd-metrics" aria-label="Hydrology metrics"></section>

        <section class="hyd-section" aria-labelledby="hyd-summary-title">
          <h4 id="hyd-summary-title" class="hyd-section__title">River condition summary</h4>
          <div id="hyd-summary" class="hyd-summary"></div>
        </section>

        <section class="hyd-section" aria-labelledby="hyd-replay-title">
          <div class="hyd-section__row">
            <h4 id="hyd-replay-title" class="hyd-section__title">${lucideHtml(History, { size: 16 })} Hydrological event replay</h4>
            <span class="hyd-section__date">${lucideHtml(Calendar, { size: 14 })}<time id="hyd-replay-time"></time></span>
          </div>
          <label class="hyd-replay">
            <span class="hyd-replay__play" aria-hidden="true">${lucideHtml(Play, { size: 16 })}</span>
            <select id="hyd-replay" class="hyd-select" aria-labelledby="hyd-replay-title"></select>
          </label>
          <button id="dt-btn-cross-section" class="hyd-xs-btn" type="button">
            ${lucideHtml(Layers, { size: 18 })}<span>View Channel Cross-Sections &amp; Profile</span>${lucideHtml(ChevronRight, { size: 18 })}
          </button>
        </section>
      </div>`;
  }

  schedule();
  pullLiveQ(selectedMeters());

  return {
    el,
    show() { el.hidden = false; },
    hide() { el.hidden = true; },
    render: schedule,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function card(key, icon, label, value, unit, spark, ctx = "") {
  const hasValue = value !== "—" && value !== "…";
  return `<article class="hyd-card hyd-card--${key}">
    <span class="hyd-card__icon" aria-hidden="true">${lucideHtml(icon, { size: 26 })}</span>
    <div class="hyd-card__main">
      <span class="hyd-card__label">${esc(label).replace(/ n$/, ' <i class="hyd-lc">n</i>')}</span>
      <div class="hyd-card__value"><b>${esc(value)}</b>${hasValue && unit ? `<small>${esc(unit)}</small>` : ""}</div>
      ${ctx ? `<span class="hyd-card__ctx">${esc(ctx)}</span>` : ""}
    </div>
    <svg class="hyd-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">${spark}</svg>
  </article>`;
}

/** Area + line path of a series normalised into a 100×24 box. */
function sparkPath(values) {
  const raw = values.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  if (raw.length < 2) return "";
  const win = 2;
  const pts = raw.map(([i], k) => {
    const s = raw.slice(Math.max(0, k - win), k + win + 1);
    return [i, s.reduce((a, [, v]) => a + v, 0) / s.length];
  });
  const sorted = pts.map(([, v]) => v).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)];
  const hi = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const span = hi - lo;
  const last = values.length - 1 || 1;
  const xy = pts.map(([i, v]) => {
    const t = span > 1e-9 ? Math.max(0, Math.min(1, (v - lo) / span)) : 0.35;
    const y = 21 - t * 14;
    return `${((i / last) * 100).toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M${xy.join("L")}`;
  const x0 = xy[0].split(",")[0];
  const x1 = xy[xy.length - 1].split(",")[0];
  return `<path class="hyd-spark__area" d="${line}L${x1},24L${x0},24Z"/><path class="hyd-spark__line" d="${line}"/>`;
}

function formatIst(iso, withDate = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const opts = { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false };
  if (withDate) Object.assign(opts, { day: "2-digit", month: "short", year: "numeric" });
  return `${d.toLocaleString("en-IN", opts)} IST`;
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
