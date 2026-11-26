import { Eye } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import { formatStation } from "../../geo/chainage.js";
import { hydrologyStore } from "../../services/hydrology/hydrologyStore.js";
import { waterLevelAt } from "./digitalTwinPanel.js";
import {
  fetchStreamsBodCod,
  peekStreamsBodCod,
  streamBodCodForRecord,
} from "../../services/streamsBodCodService.js";
import {
  getNadiTwinLiveBundle,
  getNadiTwinRawMeta,
  getNadiTwinDischargeAtChainage,
  refreshNadiTwinHydrology,
} from "../../services/hydrology/naditwinHydrologyAdapter.js";
import { mapLocalChainageToCell } from "../../services/hydrology/hydrologyNormalizer.js";

function num(v) {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
}

/** Same cell the Digital Twin river-stage chart uses for this chainage. */
function cellForChainage(live, meters) {
  const wse = live?.wse;
  const n = wse?.length || live?.n_cells || 0;
  if (!n) return null;
  const ch = live.chainage_m;
  if (Array.isArray(ch) && ch.length === n) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i += 1) {
      const d = Math.abs(Number(ch[i]) - meters);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  return mapLocalChainageToCell(meters, n, live.chainage_step_m || 10);
}

/**
 * River-stage readings at one chainage.
 * Same arrays and crest/freeboard math as the Digital Twin stage chart.
 * Velocity and wetted area are not published, so they are not estimated.
 */
function stageAtChainage(meters) {
  const live = getNadiTwinLiveBundle();
  if (!live?.wse?.length) return null;
  const meta = getNadiTwinRawMeta();
  const n = live.wse.length;
  const i = cellForChainage(live, meters);
  if (i == null || i < 0 || i >= n) return null;

  const wse = num(live.wse[i]);
  const depth = num(live.depth?.[i]);
  const crestSrc = live.crest?.length === n ? live.crest : meta?.crest;
  const bedSrc = live.bed_meta?.length === n ? live.bed_meta : meta?.bed;
  const crest = Array.isArray(crestSrc) ? num(crestSrc[i]) : null;
  let bed = Array.isArray(bedSrc) ? num(bedSrc[i]) : null;
  if (bed == null && wse != null && depth != null) bed = wse - depth;

  const freeboard = num(live.freeboard_m ?? meta?.freeboard_m) ?? 0.8;
  const zoneWarn = num(live.zone_warning_m ?? meta?.zone_warning_m) ?? 0.7;
  const zoneWatch = num(live.zone_watch_m ?? meta?.zone_watch_m) ?? 1.7;
  const danger = crest != null ? crest - freeboard : null;
  const warning = danger != null ? danger - zoneWarn : null;
  const watch = danger != null ? danger - zoneWatch : null;
  const hit = getNadiTwinDischargeAtChainage(meters);

  return {
    cell: i,
    chainage_m: num(live.chainage_m?.[i]) ?? i * (live.chainage_step_m || 10),
    wse,
    bed,
    crest,
    watch,
    warning,
    danger,
    q: Number.isFinite(hit?.q_m3s) ? hit.q_m3s : num(live.q_station?.[i]),
    timestamp: live.timestamp || null,
  };
}

function interpolateValue(a, b, t) {
  const av = num(a?.value);
  const bv = num(b?.value);
  if (av == null && bv == null) return null;
  return { ...(a || b), value: av != null && bv != null ? av + (bv - av) * t : av ?? bv };
}

function profileRecordAt(meters) {
  const records = hydrologyStore.getProfile()?.records;
  if (!records?.length) return null;
  if (meters <= records[0].chainage_m) return records[0];
  const last = records[records.length - 1];
  if (meters >= last.chainage_m) return last;

  let lo = 0;
  let hi = records.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (records[mid].chainage_m <= meters) lo = mid;
    else hi = mid;
  }
  const a = records[lo];
  const b = records[hi];
  const span = b.chainage_m - a.chainage_m;
  const t = span > 0 ? (meters - a.chainage_m) / span : 0;
  const rec = { ...a, chainage_m: meters };
  for (const key of ["lon", "lat", "width_m", "manning_n"]) {
    const av = num(a[key]);
    const bv = num(b[key]);
    if (av != null && bv != null) rec[key] = av + (bv - av) * t;
  }
  for (const key of ["wse_msl", "survey_depth_m", "water_depth_m", "velocity_ms", "cross_section_area_m2"]) {
    rec[key] = interpolateValue(a[key], b[key], t);
  }
  return rec;
}

export function mountProjectIdentity(root, dataset = null) {
  const el = document.createElement("aside");
  el.className = "hud brand-telemetry-bar";
  el.id = "hud-brand";
  el.title = "PLANET EYE AI · Mula–Mutha River Intelligence Platform · Hydraulic profile telemetry";
  el.innerHTML = `
    <div class="gis-brand-mark">
      <span class="planet-eye-logo" aria-label="Planet Eye logo">${lucideHtml(Eye, { size: 20 })}</span>
      <div class="gis-brand-text">
        <strong>PLANET EYE AI · RIVER.EYE</strong>
        <small>Mula–Mutha River · EPSG:32643</small>
      </div>
    </div>
    <div class="brand-telemetry-divider" aria-hidden="true"></div>
    <div class="weather-wq water-telemetry-wq" aria-label="Water stage and river bed at the selected chainage">
      <div class="weather-wq-row is-q">
        <i data-short="STAGE">WATER STAGE</i>
        <b id="brand-water-stage">—</b>
        <em id="brand-water-stage-unit" title="Same water stage as the Digital Twin chart at this chainage.">m</em>
      </div>
      <div class="weather-wq-row is-bod">
        <i data-short="BED">RIVER BED</i>
        <b id="brand-water-velocity">—</b>
        <em>m</em>
      </div>
      <div class="weather-wq-row is-area" hidden>
        <i data-short="CLASS">BOD CLASS</i>
        <b id="brand-water-area">—</b>
        <em></em>
      </div>
    </div>
  `;
  root.appendChild(el);

  const stageEl = el.querySelector("#brand-water-stage");
  const velocityEl = el.querySelector("#brand-water-velocity");
  const areaEl = el.querySelector("#brand-water-area");
  const classRow = el.querySelector(".weather-wq-row.is-area");
  const rows = [...el.querySelectorAll(".water-telemetry-wq .weather-wq-row")];
  const HYDRAULIC_LABELS = [
    { label: "WATER STAGE", short: "STAGE", unit: "m" },
    { label: "RIVER BED", short: "BED", unit: "m" },
  ];
  const STREAM_LABELS = [
    { label: "STREAM BOD", short: "BOD", unit: "mg/L" },
    { label: "STREAM COD", short: "COD", unit: "mg/L" },
    { label: "BOD CLASS", short: "CLASS", unit: "" },
  ];

  let lastMeters = null;

  /** Joining Streams: big numbers show the stream's BOD/COD where it enters the river. */
  let selectedStream = null;
  let hoverStream = null;
  let shownStream = undefined;
  let streamToken = 0;

  function setLabels(labels, title) {
    rows.forEach((r, i) => {
      const l = labels[i];
      if (!l) return;
      const iEl = r.querySelector("i");
      const unitEl = r.querySelector("em");
      if (iEl) {
        iEl.textContent = l.label;
        iEl.dataset.short = l.short;
      }
      if (unitEl) {
        unitEl.textContent = l.unit;
        unitEl.hidden = !l.unit;
      }
    });
    if (classRow) classRow.hidden = labels.length < 3;
    el.querySelector(".water-telemetry-wq")?.setAttribute("title", title);
  }

  async function renderStream() {
    const rec = state.joiningStreamsMode ? hoverStream || selectedStream : null;
    if (rec === shownStream) return;
    shownStream = rec;
    const token = ++streamToken;
    if (!rec) {
      setLabels(HYDRAULIC_LABELS, "");
      if (lastMeters != null) update(lastMeters, true);
      return;
    }
    setLabels(STREAM_LABELS, "");
    const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : "—");
    const paint = (v, failed) => {
      stageEl.textContent = fmt(v?.bod);
      velocityEl.textContent = fmt(v?.cod);
      areaEl.textContent = v?.cls || "—";
      setLabels(
        STREAM_LABELS,
        v
          ? `JalNetra streams BOD/COD · ${v.streamId} · ${v.date}${
              v.nearestFill ? " · nearest pixel" : ""
            }${v.source && v.source !== "live" ? ` · ${v.source}` : ""}`
          : failed
            ? "Streams BOD/COD unavailable"
            : "No BOD/COD series for this stream",
      );
    };
    // Show bundled/cached numbers immediately; upgrade when the live payload resolves.
    const pending = fetchStreamsBodCod();
    const early = streamBodCodForRecord(rec, peekStreamsBodCod());
    if (early) paint(early, false);
    else {
      stageEl.textContent = "…";
      velocityEl.textContent = "…";
      areaEl.textContent = "…";
    }
    let v = null;
    let failed = false;
    try {
      v = streamBodCodForRecord(rec, await pending);
    } catch {
      failed = true;
    }
    if (token !== streamToken) return;
    // Let the next hover/select retry once the backoff allows it
    if (failed) shownStream = undefined;
    if (!v && early) return; // keep the numbers already shown
    paint(v, failed);
  }

  document.addEventListener("joining-stream-bod", (e) => {
    const d = e.detail || {};
    if ("selected" in d) selectedStream = d.selected || null;
    if ("hover" in d) hoverStream = d.hover || null;
    void renderStream();
  });

  const stageUnitEl = el.querySelector("#brand-water-stage-unit");

  function update(meters, force = false) {
    if (!Number.isFinite(meters)) return;
    if (meters === lastMeters && !force) return;
    lastMeters = meters;
    // Stream BOD/COD owns the numbers while a joining stream is shown
    if (shownStream) return;

    const stage = stageAtChainage(meters);
    const fmt = (n) => (n != null ? n.toFixed(2) : "—");
    const chLabel = formatStation(meters);

    if (stage) {
      if (stageEl) stageEl.textContent = fmt(stage.wse);
      if (velocityEl) velocityEl.textContent = fmt(stage.bed);
      if (stageUnitEl) {
        stageUnitEl.textContent = "m";
        stageUnitEl.title = `NADITWIN water stage · CH ${formatStation(stage.chainage_m)} · same series as the Digital Twin chart`;
      }
      setLabels(HYDRAULIC_LABELS, `Water stage @ ${chLabel} · same chainage series as the Digital Twin chart`);
      return;
    }

    const rec = profileRecordAt(meters);
    const wse = waterLevelAt(rec) ?? num(rec?.wse_msl?.value);
    if (stageEl) stageEl.textContent = fmt(wse);
    if (velocityEl) velocityEl.textContent = "—";
    if (stageUnitEl) {
      stageUnitEl.textContent = "m";
      stageUnitEl.title = "Profile water level (NadiTwin stage series unavailable)";
    }
    setLabels(HYDRAULIC_LABELS, `River stage @ ${chLabel} (NadiTwin unavailable)`);
  }

  // Subscribe to hydrology store updates (e.g. solve completion, live Q sync, profile recalculations)
  hydrologyStore.subscribe(() => {
    if (lastMeters != null) {
      update(lastMeters, true);
    }
  });

  // Chainage selection listener
  document.addEventListener("chainage-select", (e) => {
    const m = Number(e.detail?.meters);
    if (Number.isFinite(m)) {
      update(m, true);
    }
  });

  document.addEventListener("river-station-selected", (e) => {
    const m = Number(e.detail?.chainage_m);
    if (Number.isFinite(m)) update(m, true);
  });

  document.addEventListener("naditwin-hydrology-change", () => {
    if (lastMeters != null) update(lastMeters, true);
  });

  // Journey progress listener
  document.addEventListener("river-journey-progress", (e) => {
    const j = e.detail;
    if (j?.currentChainage != null) {
      update(j.currentChainage, true);
    }
  });

  // Initial load — refresh NadiTwin then paint selected chainage
  const initialM = state.selectedChainageMeters ?? 1620;
  void (async () => {
    if (!getNadiTwinLiveBundle()) {
      await refreshNadiTwinHydrology().catch(() => {});
    }
    update(initialM, true);
  })();
  return { el, update };
}
