/**
 * JalNetra BOD/COD viewer client + timeline sampling.
 * GET /api/bod-cod/viewer/{id}/data — if expired, POST river KML to refresh.
 */
const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_JALNETRA_API_BASE) ||
  "https://jalnetra-software-production.up.railway.app";

/** Prefer env, else last known Mutha twin; refresh may replace. */
export const DEFAULT_BOD_COD_VIEWER_ID =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_BOD_COD_VIEWER_ID) ||
  "d23537a4de064125871e5b852d6aa34f";

const KML_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_BOD_COD_KML_URL) ||
  "/data/mula_mutha_river.kml";

const VIEWER_ID_KEY = "mm-bod-cod-viewer-id-v2";
const REQUEST_TIMEOUT_MS = 90_000;

/** In-memory full payload (history is too large for localStorage). */
let memoryCache = null;

/**
 * @param {string} [viewerId]
 * @returns {Promise<object>}
 */
export async function fetchBodCodViewerData(viewerId) {
  const preferred =
    String(viewerId || readStoredViewerId() || DEFAULT_BOD_COD_VIEWER_ID).trim();

  if (memoryCache?.reaches?.length && memoryCache._viewerId === preferred) {
    return memoryCache;
  }

  try {
    const data = await fetchViewerData(preferred);
    return remember(data, preferred);
  } catch (err) {
    const msg = String(err?.message || err);
    const expired = /404|expired|not found|HTTP 404/i.test(msg);
    if (!expired) throw err;
    console.warn("[bod-cod] viewer expired — refreshing via KML POST", preferred);
    const refreshed = await refreshBodCodFromKml();
    return refreshed;
  }
}

/** POST project river KML → new/same viewer → full /data payload. */
export async function refreshBodCodFromKml(kmlUrl = KML_URL) {
  const url = kmlUrl.startsWith("http")
    ? kmlUrl
    : new URL(kmlUrl, window.location.origin).href;
  const kmlRes = await fetch(url, { cache: "no-store" });
  if (!kmlRes.ok) throw new Error(`BOD/COD KML fetch HTTP ${kmlRes.status}`);
  const blob = await kmlRes.blob();
  const form = new FormData();
  form.append("kml", blob, "mula_mutha_river.kml");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE.replace(/\/$/, "")}/api/bod-cod`, {
      method: "POST",
      body: form,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`BOD/COD refresh HTTP ${res.status}`);
    const meta = await res.json();
    const id = String(meta?.viewer_id || "").trim();
    if (!id) throw new Error("BOD/COD refresh returned no viewer_id");
    writeStoredViewerId(id);
    const data = await fetchViewerData(id);
    return remember(data, id);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViewerData(id) {
  const url = `${API_BASE.replace(/\/$/, "")}/api/bod-cod/viewer/${encodeURIComponent(id)}/data`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "ngrok-skip-browser-warning": "true" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`BOD/COD viewer data HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.reaches?.length) throw new Error("BOD/COD payload has no reaches");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function remember(data, viewerId) {
  memoryCache = { ...data, _viewerId: viewerId, _source: "live" };
  writeStoredViewerId(viewerId);
  return memoryCache;
}

function readStoredViewerId() {
  try {
    return localStorage.getItem(VIEWER_ID_KEY) || "";
  } catch {
    return "";
  }
}

function writeStoredViewerId(id) {
  try {
    localStorage.setItem(VIEWER_ID_KEY, id);
  } catch {
    /* ignore */
  }
}

/** CPCB-style BOD class from p50 + bod_edges [2,3,6,10]. */
export function classFromBod(p50, edges = [2, 3, 6, 10]) {
  const v = Number(p50);
  if (!Number.isFinite(v)) return "NA";
  const e = edges.map(Number);
  if (v <= e[0]) return "A";
  if (v <= e[1]) return "B";
  if (v <= e[2]) return "C";
  if (v <= e[3]) return "D";
  return "E";
}

export function classShortLabel(cls, labels) {
  const full = labels?.[cls] || "";
  if (cls === "A") return "Drinking";
  if (cls === "B") return "Bathing";
  if (cls === "C") return "Treatable";
  if (cls === "D") return "Fisheries";
  if (cls === "E") return "Irrigation";
  if (full) return String(full).split(/—|–|-/)[0].trim().slice(0, 18);
  return cls || "—";
}

export function formatMgL(v, digits = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)} mg/L`;
}

/**
 * Unified history + forecast timeline (hourly).
 * @returns {{ dates: string[], historyCount: number, forecastCount: number }}
 */
export function buildBodCodTimeline(data) {
  const r0 = data?.reaches?.[0];
  const hist = Array.isArray(r0?.history?.dates) ? r0.history.dates : [];
  const fcst = Array.isArray(r0?.forecast?.dates) ? r0.forecast.dates : [];
  return {
    dates: [...hist, ...fcst],
    historyCount: hist.length,
    forecastCount: fcst.length,
  };
}

/**
 * Sample one reach at timeline index.
 * @returns {{ p10,p50,p90,cod_p10,cod_p50,cod_p90,cls,support,tier,kind:'history'|'forecast'|'today' }}
 */
export function sampleReachAt(reach, timeIndex, data, timeline) {
  const edges = data?.bod_edges || [2, 3, 6, 10];
  const histN = timeline?.historyCount ?? reach?.history?.dates?.length ?? 0;
  const dates = timeline?.dates || [];
  const i = Math.max(0, Math.min(dates.length - 1, Number(timeIndex) || 0));

  if (i < histN && reach?.history?.p50?.length) {
    const h = reach.history;
    const p50 = Number(h.p50[i]);
    const support = String(h.support?.[i] || "prior");
    return {
      p10: Number(h.p10?.[i]),
      p50,
      p90: Number(h.p90?.[i]),
      cod_p10: Number(h.cod_p10?.[i]),
      cod_p50: Number(h.cod_p50?.[i]),
      cod_p90: Number(h.cod_p90?.[i]),
      cls: classFromBod(p50, edges),
      support,
      tier: support === "sat" || support === "anchor" ? "Observed" : "Estimated",
      kind: "history",
      date: dates[i],
    };
  }

  const fi = i - histN;
  if (reach?.forecast?.p50?.length && fi >= 0 && fi < reach.forecast.p50.length) {
    const f = reach.forecast;
    const p50 = Number(f.p50[fi]);
    return {
      p10: Number(f.p10?.[fi]),
      p50,
      p90: Number(f.p90?.[fi]),
      cod_p10: Number(f.cod_p10?.[fi]),
      cod_p50: Number(f.cod_p50?.[fi]),
      cod_p90: Number(f.cod_p90?.[fi]),
      cls: classFromBod(p50, edges),
      support: "forecast",
      tier: "Forecast",
      kind: "forecast",
      date: dates[i],
    };
  }

  const t = reach?.today || {};
  return {
    p10: Number(t.p10),
    p50: Number(t.p50),
    p90: Number(t.p90),
    cod_p10: Number(t.cod_p10),
    cod_p50: Number(t.cod_p50),
    cod_p90: Number(t.cod_p90),
    cls: String(t.cls || classFromBod(t.p50, edges)).toUpperCase(),
    support: String(t.support || "prior"),
    tier: String(t.tier || "Estimated"),
    kind: "today",
    date: data?.generated || dates[i] || "",
  };
}

/** Snapshot all reaches at one time index (for ribbon + strip). */
export function sampleAllReachesAt(data, timeIndex, timeline) {
  const tl = timeline || buildBodCodTimeline(data);
  return (data?.reaches || []).map((r) => ({
    id: r.id,
    name: r.name,
    km: r.km,
    sample: sampleReachAt(r, timeIndex, data, tl),
  }));
}

/** Alerts for the selected calendar day (YYYY-MM-DD). */
export function alertsForDate(data, dateStr) {
  const day = String(dateStr || "").slice(0, 10);
  const list = Array.isArray(data?.alerts) ? data.alerts : [];
  if (!day) return list.slice(0, 12);
  const exact = list.filter((a) => String(a.date || "").slice(0, 10) === day);
  if (exact.length) return exact;
  // Fallback: show all (API often stamps alerts on "today" only)
  return list.slice(0, 12);
}

/** River-wide accuracy / summary for the selected hour. */
export function riverAccuracyAt(data, timeIndex, timeline) {
  const snaps = sampleAllReachesAt(data, timeIndex, timeline);
  const edges = data?.bod_edges || [2, 3, 6, 10];
  const bath = Number(edges[1]) || 3;
  const bods = snaps.map((s) => s.sample.p50).filter(Number.isFinite);
  const cods = snaps.map((s) => s.sample.cod_p50).filter(Number.isFinite);
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
  const aboveBath = snaps.filter((s) => Number(s.sample.p50) > bath).length;
  let highest = null;
  for (const s of snaps) {
    if (!Number.isFinite(s.sample.p50)) continue;
    if (!highest || s.sample.p50 > highest.sample.p50) highest = s;
  }
  const date = snaps[0]?.sample?.date || "";
  return {
    date,
    bodMean: mean(bods),
    codMean: mean(cods),
    aboveBathing: aboveBath,
    highestId: highest?.id || "—",
    highestBod: highest?.sample?.p50,
    reachCount: snaps.length,
  };
}

/** Default time index = last history hour (today), else last date. */
export function defaultTimeIndex(timeline) {
  const n = timeline?.dates?.length || 0;
  if (!n) return 0;
  const h = timeline.historyCount || 0;
  if (h > 0) return h - 1;
  return n - 1;
}

export function formatTimelineLabel(dateStr) {
  if (!dateStr) return "—";
  const raw = String(dateStr).trim();
  // Prefer short readable: 18 Jun 2026 · 23:00
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mon = months[Number(m[2]) - 1] || m[2];
    return `${Number(m[3])} ${mon} ${m[1]} · ${m[4]}:${m[5]}`;
  }
  return raw.replace("T", " ").slice(0, 16);
}

/** Compact ends for the scrubber scale (avoid long jammed strings). */
export function formatTimelineScaleLabel(dateStr) {
  if (!dateStr) return "—";
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return `${m[3]}/${m[2]} ${m[4]}:${m[5]}`;
  return String(dateStr).replace("T", " ").slice(0, 11);
}

/** Segment fill style for end-to-end bar. */
export function supportStyle(support) {
  const s = String(support || "").toLowerCase();
  if (s === "forecast") return "forecast";
  if (s === "sat" || s === "anchor" || s === "obs" || s === "observed") return "observed";
  return "prior";
}
