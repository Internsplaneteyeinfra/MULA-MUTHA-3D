import { Eye } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import { formatStation } from "../../geo/chainage.js";
import { hydrologyStore } from "../../services/hydrology/hydrologyStore.js";
import { wseSpatialService } from "../../services/hydrology/wseSpatialService.js";
import { waterLevelAt } from "./digitalTwinPanel.js";
function num(v) {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
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
  el.title = "PLANET EYE AI · Mula–Mutha River Intelligence Platform · Live Hydrology Telemetry";
  el.innerHTML = `
    <div class="gis-brand-mark">
      <span class="planet-eye-logo" aria-label="Planet Eye logo">${lucideHtml(Eye, { size: 20 })}</span>
      <div class="gis-brand-text">
        <strong>PLANET EYE AI · RIVER.EYE</strong>
        <small>Mula–Mutha River · EPSG:32643</small>
      </div>
    </div>
    <div class="brand-telemetry-divider" aria-hidden="true"></div>
    <div class="weather-wq water-telemetry-wq" aria-label="Live river water level, flow velocity, and wetted area">
      <div class="weather-wq-row is-q">
        <i data-short="LIVE WSE">LIVE WATER LEVEL (WSE)</i>
        <b id="brand-water-stage">—</b>
        <em id="brand-water-stage-unit">m MSL</em>
      </div>
      <div class="weather-wq-row is-bod">
        <i data-short="VEL">FLOW VELOCITY</i>
        <b id="brand-water-velocity">—</b>
        <em>m/s</em>
      </div>
      <div class="weather-wq-row is-area">
        <i data-short="AREA">WETTED AREA</i>
        <b id="brand-water-area">—</b>
        <em>m²</em>
      </div>
    </div>
  `;
  root.appendChild(el);

  const stageEl = el.querySelector("#brand-water-stage");
  const velocityEl = el.querySelector("#brand-water-velocity");
  const areaEl = el.querySelector("#brand-water-area");

  let lastMeters = null;

  function update(meters, force = false) {
    if (!Number.isFinite(meters)) return;
    if (meters === lastMeters && !force) return;
    lastMeters = meters;

    const rec = profileRecordAt(meters);
    const hydraulic = wseSpatialService.getWSEAtChainage(meters);
    const summary = hydrologyStore.getSummary();

    const wse = waterLevelAt(rec) ?? num(rec?.wse_msl?.value) ?? num(hydraulic?.wse);
    if (stageEl) stageEl.textContent = wse != null ? wse.toFixed(2) : "—";

    const velocity = num(rec?.velocity_ms?.value) ?? num(summary?.meanVelocity_ms) ?? num(hydraulic?.velocity);
    const area = num(rec?.cross_section_area_m2?.value) ?? num(hydraulic?.wettedArea);
    if (velocityEl) velocityEl.textContent = velocity != null ? velocity.toFixed(2) : "—";
    if (areaEl) areaEl.textContent = area != null ? area.toFixed(1) : "—";
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
      update(m);
    }
  });

  // Journey progress listener
  document.addEventListener("river-journey-progress", (e) => {
    const j = e.detail;
    if (j?.currentChainage != null) {
      update(j.currentChainage);
    }
  });

  // Initial load
  const initialM = state.selectedChainageMeters ?? 1620;
  update(initialM);
  return { el, update };
}
