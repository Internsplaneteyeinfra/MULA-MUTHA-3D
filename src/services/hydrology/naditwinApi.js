/**
 * NadiTwin HTTP client — always via same-origin /naditwin-api proxy.
 * Never call the Railway host directly from the browser (CORS + central timeouts).
 */

import { createTtlCache } from "./hydrologyCache.js";

const PROXY_BASE = "/naditwin-api";
const RIVER = "Mula-Mutha";
const DEFAULT_TTL_MS = 60_000;
const LIVE_TTL_MS = 45_000;
const META_TTL_MS = 10 * 60_000;

const cache = createTtlCache();

function buildUrl(path, params = {}) {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${PROXY_BASE}${clean}`, "http://localhost");
  const q = new URLSearchParams(url.search);
  if (!q.has("river") && clean !== "/api/rivers" && clean !== "/api/timerange" && clean !== "/api/endpoints") {
    q.set("river", RIVER);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    q.set(k, String(v));
  }
  const qs = q.toString();
  return `${PROXY_BASE}${clean}${qs ? `?${qs}` : ""}`;
}

/**
 * @param {string} path e.g. "/api/state"
 * @param {object} [opts]
 */
export async function naditwinFetch(path, opts = {}) {
  const {
    params = {},
    ttlMs = DEFAULT_TTL_MS,
    cacheKey = null,
    signal = null,
    timeoutMs = 18000,
  } = opts;

  const key = cacheKey || buildUrl(path, params);
  const cached = cache.get(key);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const url = buildUrl(path, params);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.("abort", onAbort);

  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    const latencyHeader = res.headers.get("x-naditwin-latency-ms");
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = new Error(json?.error || json?.message || `NadiTwin HTTP ${res.status}`);
      err.status = res.status;
      err.body = json ?? text?.slice?.(0, 400);
      throw err;
    }
    const payload = {
      ok: true,
      data: json,
      raw: json,
      fetchedAt: new Date().toISOString(),
      upstreamStatus: Number(res.headers.get("x-naditwin-upstream-status") || res.status),
      latencyMs: latencyHeader != null ? Number(latencyHeader) : null,
      url,
      fromCache: false,
    };
    cache.set(key, payload, ttlMs);
    return payload;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

export function getNadiTwinCached(path, params = {}) {
  return cache.peek(buildUrl(path, params));
}

export function clearNadiTwinCache() {
  cache.clear();
}

export async function fetchNadiTwinMeta(opts) {
  return naditwinFetch("/api/meta", { ...opts, ttlMs: META_TTL_MS, cacheKey: "meta" });
}

export async function fetchNadiTwinState(opts = {}) {
  const at = opts.params?.at;
  return naditwinFetch("/api/state", {
    ...opts,
    ttlMs: at ? 5 * 60_000 : LIVE_TTL_MS,
    // Must vary by `at` — a fixed "state" key would serve LIVE into HISTORIC
    cacheKey: opts.cacheKey || (at ? `state:at:${at}` : "state"),
  });
}

export async function fetchNadiTwinLive(opts) {
  return naditwinFetch("/api/live", { ...opts, ttlMs: LIVE_TTL_MS, cacheKey: "live" });
}

export async function fetchNadiTwinDischargeProfile(opts) {
  return naditwinFetch("/api/discharge_profile", { ...opts, ttlMs: LIVE_TTL_MS, cacheKey: "discharge_profile" });
}

export async function fetchNadiTwinHydrograph(cell, hours = 72, opts = {}) {
  return naditwinFetch("/api/hydrograph", {
    ...opts,
    params: { cell, hours, ...(opts.params || {}) },
    ttlMs: LIVE_TTL_MS,
    cacheKey: `hydrograph:${cell}:${hours}`,
  });
}

export async function fetchNadiTwinForecastProfile(lead = 24, opts = {}) {
  return naditwinFetch("/api/forecast/profile", {
    ...opts,
    params: { lead, ...(opts.params || {}) },
    ttlMs: LIVE_TTL_MS,
    cacheKey: `forecast_profile:${lead}`,
  });
}

export async function fetchNadiTwinMargins(kind = "landmarks", opts = {}) {
  const path =
    kind === "chainage"
      ? "/api/margins_chainage"
      : kind === "locations"
        ? "/api/margins_locations"
        : "/api/margins";
  const params = kind === "chainage" ? { step_km: 1, ...(opts.params || {}) } : opts.params || {};
  const at = params.at || "";
  return naditwinFetch(path, {
    ...opts,
    params,
    ttlMs: at ? 5 * 60_000 : LIVE_TTL_MS,
    cacheKey: opts.cacheKey || `margins:${kind}:${at || "live"}`,
  });
}

export async function fetchNadiTwinStations(loc = "L1", opts = {}) {
  return naditwinFetch("/api/stations", {
    ...opts,
    params: { loc, ...(opts.params || {}) },
    ttlMs: LIVE_TTL_MS,
    cacheKey: `stations:${loc}`,
  });
}

/** Stage–discharge rating curve at a NadiTwin cell. */
export async function fetchNadiTwinRating(cell, opts = {}) {
  return naditwinFetch("/api/rating", {
    ...opts,
    params: { cell, ...(opts.params || {}) },
    ttlMs: LIVE_TTL_MS,
    cacheKey: `rating:${cell}`,
  });
}

/** Today observed + forecast hours at a cell (local tz offset minutes). */
export async function fetchNadiTwinToday(cell, tzOffsetMin = 330, opts = {}) {
  return naditwinFetch("/api/today", {
    ...opts,
    params: { cell, tz: tzOffsetMin, ...(opts.params || {}) },
    ttlMs: LIVE_TTL_MS,
    cacheKey: `today:${cell}:${tzOffsetMin}`,
  });
}

/** Live/historic epoch window metadata. */
export async function fetchNadiTwinTimerange(opts = {}) {
  return naditwinFetch("/api/timerange", {
    ...opts,
    ttlMs: META_TTL_MS,
    cacheKey: "timerange",
  });
}

/** Hindcast scorecard metrics (may be sparse). */
export async function fetchNadiTwinScorecard(opts = {}) {
  return naditwinFetch("/api/scorecard", {
    ...opts,
    ttlMs: META_TTL_MS,
    cacheKey: "scorecard",
  });
}

/** Named location stretches. */
export async function fetchNadiTwinLocations(opts = {}) {
  return naditwinFetch("/api/locations", {
    ...opts,
    ttlMs: META_TTL_MS,
    cacheKey: "locations",
  });
}

/** Active alerts per chainage segment. */
export async function fetchNadiTwinAlertsChainage(stepKm = 1, opts = {}) {
  return naditwinFetch("/api/alerts_chainage", {
    ...opts,
    params: { step_km: stepKm, ...(opts.params || {}) },
    ttlMs: LIVE_TTL_MS,
    cacheKey: `alerts_chainage:${stepKm}`,
  });
}

/** Landmark / bridge alerts. */
export async function fetchNadiTwinAlerts(opts = {}) {
  return naditwinFetch("/api/alerts", {
    ...opts,
    ttlMs: LIVE_TTL_MS,
    cacheKey: "alerts",
  });
}

/**
 * Hydrograph by calendar year (HISTORICAL · MODELLED).
 * @param {number} cell
 * @param {number} year
 */
export async function fetchNadiTwinHydrographYear(cell, year, opts = {}) {
  return naditwinFetch("/api/hydrograph", {
    ...opts,
    params: { cell, year, ...(opts.params || {}) },
    ttlMs: META_TTL_MS,
    cacheKey: `hydrograph_year:${cell}:${year}`,
    timeoutMs: 45000,
  });
}
