/**
 * NadiTwin HISTORIC snapshot helpers (isolated from LIVE paths).
 * Spatial discharge/stage: GET /api/state?at=<ISO>
 * Margin board: GET /api/margins_locations|margins_chainage?at=<ISO>
 * Hydrograph: station series via /api/hydrograph (hours|year) + cursor at selected time.
 *
 * Do not fabricate spatial profiles when `at` fails.
 */
import { fetchNadiTwinState, fetchNadiTwinMargins, fetchNadiTwinMeta } from "./naditwinApi.js";
import { getNadiTwinRawMeta } from "./naditwinHydrologyAdapter.js";

const IST_OFFSET_MIN = 330;

function r2(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

function asArr(v) {
  return Array.isArray(v) ? v : [];
}

function downsample(n, maxPts = 160, forceIdx = []) {
  if (n <= 0) return [];
  const step = Math.max(1, Math.floor(n / maxPts));
  const keep = new Set();
  for (let i = 0; i < n; i += step) keep.add(i);
  keep.add(n - 1);
  for (const fi of forceIdx) {
    const i = Math.round(Number(fi));
    if (Number.isFinite(i) && i >= 0 && i < n) keep.add(i);
  }
  return [...keep].sort((a, b) => a - b);
}

/** Local calendar parts → ISO string with +05:30 (NadiTwin twin clock). */
export function toNadiTwinAtIso(dateYmd, hour = 0, minute = 0) {
  const m = String(dateYmd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const hh = Math.max(0, Math.min(23, Math.round(Number(hour) || 0)));
  const mm = Math.max(0, Math.min(59, Math.round(Number(minute) || 0)));
  return `${m[1]}-${m[2]}-${m[3]}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`;
}

/** Parse coverage bounds into local YMD / hour for controls. */
export function parseAtToLocalParts(atIso) {
  if (!atIso) return null;
  const ms = Date.parse(atIso);
  if (!Number.isFinite(ms)) return null;
  // Shift to IST wall-clock then read UTC getters on the shifted instant
  const ist = new Date(ms + IST_OFFSET_MIN * 60_000);
  const y = ist.getUTCFullYear();
  const mo = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  const h = ist.getUTCHours();
  const mi = ist.getUTCMinutes();
  return {
    date: `${y}-${mo}-${d}`,
    hour: h,
    minute: mi >= 30 ? 30 : 0,
    label: `${d}/${mo}/${y} ${String(h).padStart(2, "0")}:${String(mi >= 30 ? 30 : 0).padStart(2, "0")} IST`,
    ms,
  };
}

export function clampHistoricAt(atIso, coverage) {
  const parts = parseAtToLocalParts(atIso);
  if (!parts || !coverage?.earliest || !coverage?.latest) return atIso;
  let { date, hour, minute } = parts;
  if (date < coverage.earliest) {
    date = coverage.earliest;
    hour = 0;
    minute = 0;
  }
  if (date > coverage.latest) {
    date = coverage.latest;
    hour = Number.isFinite(coverage.todayHour) ? Number(coverage.todayHour) : 23;
    minute = 0;
  }
  if (date === coverage.latest && Number.isFinite(coverage.todayHour) && hour > coverage.todayHour) {
    hour = coverage.todayHour;
    minute = 0;
  }
  return toNadiTwinAtIso(date, hour, minute);
}

/** Step ±1 hour within coverage (API hour_index resolution). */
export function stepHistoricAt(atIso, deltaHours, coverage) {
  const ms = Date.parse(atIso);
  if (!Number.isFinite(ms)) return atIso;
  const next = new Date(ms + deltaHours * 3600_000).toISOString();
  // Convert stepped UTC ISO back through local parts for +05:30 round-trip
  const parts = parseAtToLocalParts(next);
  if (!parts) return atIso;
  return clampHistoricAt(toNadiTwinAtIso(parts.date, parts.hour, 0), coverage);
}

export function defaultHistoricAt(coverage) {
  if (!coverage?.latest) {
    const now = new Date();
    const parts = parseAtToLocalParts(now.toISOString());
    return toNadiTwinAtIso(parts.date, Math.max(0, parts.hour - 1), 0);
  }
  const hour = Number.isFinite(coverage.todayHour) ? Math.max(0, Number(coverage.todayHour) - 1) : 12;
  return toNadiTwinAtIso(coverage.latest, hour, 0);
}

const HIST_AT_TOLERANCE_MS = 2 * 3600_000;

/**
 * Historical spatial state snapshot.
 * Never accepts a LIVE payload as a historical substitute.
 * LIVE cache remains under key "state"; historic uses "state:at:<iso>".
 * @returns {Promise<{ok:boolean, at:string|null, live:boolean, data:object|null, error?:string, reason?:string}>}
 */
export async function fetchHistoricStateSnapshot(atIso, opts = {}) {
  if (!atIso) {
    return {
      ok: false,
      at: null,
      live: false,
      data: null,
      error: "No historical timestamp selected",
      reason: "missing_at",
    };
  }
  try {
    const res = await fetchNadiTwinState({
      ...opts,
      params: { at: atIso, ...(opts.params || {}) },
      ttlMs: 5 * 60_000,
      // Distinct from LIVE "state" — never poison / never accept LIVE silently
      cacheKey: `state:at:${atIso}`,
      timeoutMs: 25000,
    });
    const data = res.data;
    const asked = Date.parse(atIso);
    const got = Date.parse(data?.at);
    const tsOk = Number.isFinite(asked) && Number.isFinite(got)
      && Math.abs(got - asked) <= HIST_AT_TOLERANCE_MS;

    // live:true means upstream ignored `at` (often mangled "+05:30") — never historic
    if (data?.live === true) {
      return {
        ok: false,
        at: atIso,
        live: true,
        data: null,
        apiAt: data?.at || null,
        error: "HISTORICAL SPATIAL STATE UNAVAILABLE (API returned LIVE)",
        reason: "api_returned_live",
        detail: `Requested ${atIso}; API at=${data?.at || "—"} live=true — rejected as historic snapshot`,
        fetchedAt: res.fetchedAt,
      };
    }

    if (!data?.q_station?.length && !data?.wse?.length) {
      return {
        ok: false,
        at: atIso,
        live: false,
        data: null,
        error: "Empty historical state",
        reason: "empty",
        fetchedAt: res.fetchedAt,
      };
    }

    if (!tsOk) {
      return {
        ok: false,
        at: atIso,
        live: !!data?.live,
        data: null,
        apiAt: data?.at || null,
        error: "HISTORICAL SPATIAL STATE UNAVAILABLE (timestamp mismatch)",
        reason: "timestamp_mismatch",
        detail: `Requested ${atIso}; API at=${data?.at || "—"}`,
        fetchedAt: res.fetchedAt,
      };
    }

    // Accept only live:false (or missing live with matching at)
    if (data.live !== false && data.live != null) {
      return {
        ok: false,
        at: atIso,
        live: !!data.live,
        data: null,
        error: "HISTORICAL SPATIAL STATE UNAVAILABLE (unexpected live flag)",
        reason: "unexpected_live_flag",
        fetchedAt: res.fetchedAt,
      };
    }

    return {
      ok: true,
      at: data.at || atIso,
      live: false,
      hour_index: data.hour_index,
      data,
      fetchedAt: res.fetchedAt,
      reason: "ok",
    };
  } catch (err) {
    return {
      ok: false,
      at: atIso,
      live: false,
      data: null,
      error: err?.message || String(err),
      reason: "fetch_error",
    };
  }
}

/** Station cell sample from a validated historic state payload (never LIVE). */
export function sampleHistoricStation(state, chainage_m, atIso) {
  if (!state || !Number.isFinite(Number(chainage_m))) return null;
  const step = 10;
  const idx = Math.max(0, Math.round(Number(chainage_m) / step));
  const q = state.q_station?.[idx];
  const wse = state.wse?.[idx];
  return {
    chainage_m: Number(chainage_m),
    cell: idx,
    q_m3s: Number.isFinite(Number(q)) ? Number(q) : null,
    wse_m: Number.isFinite(Number(wse)) ? Number(wse) : null,
    at: state.at || atIso || null,
  };
}

export async function getHistoricDischargeProfileSeries(atIso, opts = {}) {
  const snap = await fetchHistoricStateSnapshot(atIso, opts);
  if (!snap.ok || !snap.data?.q_station?.length) {
    return {
      ok: false,
      historic: true,
      at: atIso,
      unavailable: true,
      spatialUnavailable: true,
      message: "HISTORICAL FULL-REACH DISCHARGE UNAVAILABLE",
      error: snap.error,
      reason: snap.reason,
      detail: snap.detail || null,
      apiAt: snap.apiAt || null,
      station: null,
      provenance: { dataClass: "HISTORICAL · UNAVAILABLE", source: "NadiTwin /api/state" },
    };
  }
  const state = snap.data;
  const n = state.q_station.length;
  const step = 10;
  const meta = getNadiTwinRawMeta() || (await fetchNadiTwinMeta().then((r) => r.data).catch(() => null));
  const chFull = Array.from({ length: n }, (_, i) => i * (Number(meta?.chainage_step_m) || step));
  const force = Number.isFinite(Number(opts.ensureMeters))
    ? [Math.round(Number(opts.ensureMeters) / step)]
    : [];
  const idx = downsample(n, 160, force);
  const pick = (arr) => idx.map((i) => r2(arr?.[i] ?? null));
  const station = sampleHistoricStation(state, opts.ensureMeters, snap.at);

  return {
    ok: true,
    historic: true,
    at: snap.at,
    live: false,
    chainage_m: idx.map((i) => chFull[i]),
    q_now: pick(state.q_station),
    // Spatial +24h/+72h medians are LIVE forecast leads — not published for arbitrary historic `at`
    q_forecast_p50_24h: null,
    q_forecast_p50_72h: null,
    rain_chainage_m: null,
    rain_now_mmh: null,
    station,
    updatedAt: snap.at,
    fetchedAt: snap.fetchedAt,
    provenance: {
      q_now: `NADITWIN HISTORICAL · /api/state?at=${snap.at}`,
      forecast: "UNAVAILABLE for historic spatial snapshot",
      rain: "UNAVAILABLE for historic spatial snapshot",
      dataClass: "HISTORICAL · MODELLED · PROVISIONAL",
      unit: "m³/s",
      note: "Chainage-wise Q from historical state — not LIVE · not fabricated from hydrograph",
    },
  };
}

export async function getHistoricRiverStageSeries(atIso, opts = {}) {
  const snap = await fetchHistoricStateSnapshot(atIso, opts);
  if (!snap.ok || !snap.data?.wse?.length) {
    return {
      ok: false,
      historic: true,
      at: atIso,
      unavailable: true,
      spatialUnavailable: true,
      message: "HISTORICAL FULL-REACH STAGE PROFILE UNAVAILABLE",
      error: snap.error,
      reason: snap.reason,
      detail: snap.detail || null,
      apiAt: snap.apiAt || null,
      station: null,
      chainage_m: [],
      wse_now: [],
      bed: [],
      provenance: { dataClass: "HISTORICAL · UNAVAILABLE", source: "NadiTwin /api/state" },
    };
  }
  const state = snap.data;
  const n = state.wse.length;
  const step = 10;
  const meta = getNadiTwinRawMeta() || (await fetchNadiTwinMeta().then((r) => r.data).catch(() => null));
  const chainageFull = Array.from({ length: n }, (_, i) => i * (Number(meta?.chainage_step_m) || step));
  const ensureM = Number(opts.ensureMeters);
  const forceIdx = Number.isFinite(ensureM) ? [Math.round(ensureM / step)] : [];
  const idx = downsample(n, 120, forceIdx);
  const pick = (arr) => idx.map((i) => r2(arr?.[i] ?? null));

  const wseNow = asArr(state.wse);
  const depth = asArr(state.depth);
  const crestSrc = asArr(meta?.crest);
  const bedSrc = asArr(meta?.bed);
  const crestFull = crestSrc.length === n
    ? crestSrc.map((x) => (Number.isFinite(Number(x)) ? Number(x) : null))
    : null;
  const bedMeta = bedSrc.length === n
    ? bedSrc.map((x) => (Number.isFinite(Number(x)) ? Number(x) : null))
    : null;
  const freeboard = Number.isFinite(Number(meta?.freeboard_m)) ? Number(meta.freeboard_m) : 0.8;
  const zoneWarn = Number.isFinite(Number(meta?.zone_warning_m)) ? Number(meta.zone_warning_m) : 0.7;
  const zoneWatch = Number.isFinite(Number(meta?.zone_watch_m)) ? Number(meta.zone_watch_m) : 1.7;

  const bed = Array.from({ length: n }, (_, i) => {
    if (bedMeta) {
      const v = Number(bedMeta[i]);
      return Number.isFinite(v) ? v : null;
    }
    const d = Number(depth[i]);
    const ww = Number(wseNow[i]);
    return Number.isFinite(ww) && Number.isFinite(d) ? ww - d : null;
  });
  const danger = crestFull
    ? crestFull.map((c) => (Number.isFinite(c) ? c - freeboard : null))
    : null;
  const warning = danger ? danger.map((d) => (Number.isFinite(d) ? d - zoneWarn : null)) : null;
  const watch = danger ? danger.map((d) => (Number.isFinite(d) ? d - zoneWatch : null)) : null;

  const station = sampleHistoricStation(state, opts.ensureMeters, snap.at);

  return {
    ok: true,
    historic: true,
    at: snap.at,
    lead_h: null,
    chainage_m: idx.map((i) => chainageFull[i]),
    wse_now: pick(wseNow),
    bed: pick(bed),
    forecast_p50: null,
    forecast_p10: null,
    forecast_p90: null,
    crest: crestFull ? pick(crestFull) : null,
    danger: danger ? pick(danger) : null,
    warning: warning ? pick(warning) : null,
    watch: watch ? pick(watch) : null,
    station,
    threshold_m: null,
    embankment: crestFull ? pick(crestFull) : null,
    provenance: {
      wse_now: `NADITWIN HISTORICAL · /api/state?at=${snap.at}`,
      bed: bedMeta ? "NADITWIN META bed (geometry)" : "DERIVED (WSE − depth)",
      forecast: "UNAVAILABLE for historic snapshot",
      threshold: crestFull
        ? `NADITWIN crest − freeboard ${freeboard} m (MODELLED · relative · provisional)`
        : "N/A",
      note: "Historical spatial stage from state?at — bed/crest geometry from meta · not LIVE overlay",
      dataClass: "HISTORICAL · MODELLED",
    },
  };
}

/**
 * Margin board rows for LIVE (no at) or HISTORIC (with at).
 * Labels status as MODELLED / PROVISIONAL — never unlock Phase 8 boards.
 */
export async function fetchMarginBoardRows(view = "locations", atIso = null) {
  const kind = view === "chainage" ? "chainage" : "locations";
  try {
    const res = await fetchNadiTwinMargins(kind, {
      params: atIso ? { at: atIso } : {},
      ttlMs: atIso ? 5 * 60_000 : 45_000,
      cacheKey: `margins:${kind}:${atIso || "live"}`,
      timeoutMs: 25000,
    });
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) {
      return {
        ok: false,
        view,
        at: atIso,
        rows: [],
        message: atIso
          ? "HISTORICAL MARGIN BOARD DATA UNAVAILABLE"
          : "MARGIN BOARD DATA UNAVAILABLE",
        provisional: true,
      };
    }
    // If historic requested but values match-looking live with live flag absent — still accept
    // because margins_locations with at= was verified to change q_now/status.
    return {
      ok: true,
      view,
      at: atIso,
      rows,
      fetchedAt: res.fetchedAt,
      provisional: true,
      disclaimer:
        "MODELLED / PROVISIONAL — NadiTwin assumed bank heights & relative datum. Not verified engineering safety. Phase 8 boards remain LOCKED.",
    };
  } catch (err) {
    return {
      ok: false,
      view,
      at: atIso,
      rows: [],
      error: err?.message || String(err),
      message: atIso
        ? "HISTORICAL MARGIN BOARD DATA UNAVAILABLE"
        : "MARGIN BOARD DATA UNAVAILABLE",
      provisional: true,
    };
  }
}

export const HISTORIC_CAPABILITIES = {
  station_discharge: true,
  spatial_discharge: true, // /api/state?at=
  station_stage: true,
  spatial_stage: true, // /api/state?at=
  rainfall_station: true, // via hydrograph
  rainfall_spatial_historic: false,
  snapshot_at: true, // at= ISO
  margins_historic: true, // margins_*?at=
  margins_1km: true,
  step_resolution_h: 1,
  at_param: "at",
  timezone: "Asia/Kolkata (+05:30)",
};
