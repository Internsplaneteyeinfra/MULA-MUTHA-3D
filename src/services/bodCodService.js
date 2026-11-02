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
// The live pipeline routinely takes 40–130 s (and the gateway gives up at 300 s).
const REQUEST_TIMEOUT_MS = 240_000;

/** In-memory full payload (history is too large for localStorage). */
let memoryCache = null;
/** Shared in-flight requests: every caller awaits the same (slow) server round trip. */
let inflightFetch = null;
let inflightRefresh = null;

/** Viewer ids expire server-side within hours, so the payload itself is cached (IndexedDB, same day). */
const IDB_NAME = "mm-bod-cod";
const IDB_STORE = "payload";
const CACHE_TTL_MS = 6 * 3600_000;

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCachedPayload() {
  try {
    const db = await idbOpen();
    const rec = await new Promise((resolve, reject) => {
      const r = db.transaction(IDB_STORE).objectStore(IDB_STORE).get("latest");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    if (!rec?.data?.reaches?.length) return null;
    if (Date.now() - rec.savedAt > CACHE_TTL_MS) return null;
    // "today" snapshot is per calendar day — never show yesterday's as today.
    if (new Date(rec.savedAt).toDateString() !== new Date().toDateString()) return null;
    return rec.data;
  } catch {
    return null;
  }
}

async function writeCachedPayload(data) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ savedAt: Date.now(), data }, "latest");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* cache is best-effort */
  }
}

/**
 * @param {string} [viewerId]
 * @returns {Promise<object>}
 */
export function fetchBodCodViewerData(viewerId) {
  if (viewerId) return loadBodCod(viewerId);
  if (!inflightFetch) {
    inflightFetch = loadBodCod().finally(() => {
      inflightFetch = null;
    });
  }
  return inflightFetch;
}

async function loadBodCod(viewerId) {
  const preferred =
    String(viewerId || readStoredViewerId() || DEFAULT_BOD_COD_VIEWER_ID).trim();

  if (memoryCache?.reaches?.length && (viewerId ? memoryCache._viewerId === preferred : true)) {
    return memoryCache;
  }

  if (!viewerId) {
    const cached = await readCachedPayload();
    if (cached) {
      memoryCache = { ...cached, _viewerId: cached._viewerId || preferred, _source: "cache" };
      return memoryCache;
    }
  }

  try {
    const data = await fetchViewerData(preferred);
    return remember(data, preferred);
  } catch (err) {
    const msg = String(err?.message || err);
    const expired = /404|expired|not found|HTTP 404/i.test(msg);
    if (!expired) throw err;
    console.warn("[bod-cod] viewer expired — refreshing via KML POST", preferred);
    return refreshBodCodFromKml();
  }
}

/** POST project river KML → new/same viewer → full /data payload. */
export function refreshBodCodFromKml(kmlUrl = KML_URL) {
  if (!inflightRefresh) {
    inflightRefresh = doRefreshBodCodFromKml(kmlUrl).finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
}

async function doRefreshBodCodFromKml(kmlUrl) {
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
  void writeCachedPayload(memoryCache);
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

/** 2 dp by default — the API publishes mg/L at 2 dp, so shown values match it exactly. */
export function formatMgL(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)} mg/L`;
}

/**
 * Unified history → today → forecast timeline (hourly).
 * The API's `today` snapshot is its own point (it differs from the last history hour),
 * so the default view shows exactly what the endpoint reports for today.
 * @returns {{ dates: string[], historyCount: number, forecastCount: number, todayIndex: number }}
 */
export function buildBodCodTimeline(data) {
  const r0 = data?.reaches?.[0];
  const hist = Array.isArray(r0?.history?.dates) ? r0.history.dates : [];
  const fcst = Array.isArray(r0?.forecast?.dates) ? r0.forecast.dates : [];
  const hasToday = Number.isFinite(Number(r0?.today?.p50));
  const todayDate = String(r0?.today?.date || data?.generated || "");
  return {
    dates: hasToday ? [...hist, todayDate, ...fcst] : [...hist, ...fcst],
    historyCount: hist.length,
    forecastCount: fcst.length,
    todayIndex: hasToday ? hist.length : -1,
  };
}

/**
 * Sample one reach at timeline index.
 * @returns {{ p10,p50,p90,cod_p10,cod_p50,cod_p90,cls,support,tier,kind:'history'|'forecast'|'today' }}
 */
export function sampleReachAt(reach, timeIndex, data, timeline) {
  const edges = data?.bod_edges || [2, 3, 6, 10];
  const histN = timeline?.historyCount ?? reach?.history?.dates?.length ?? 0;
  const todayIndex = timeline?.todayIndex ?? -1;
  const dates = timeline?.dates || [];
  const i = Math.max(0, Math.min(dates.length - 1, Number(timeIndex) || 0));

  if (i !== todayIndex && i < histN && reach?.history?.p50?.length) {
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

  const fi = i - histN - (todayIndex >= 0 ? 1 : 0);
  if (i !== todayIndex && reach?.forecast?.p50?.length && fi >= 0 && fi < reach.forecast.p50.length) {
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
    date: dates[i] || data?.generated || "",
  };
}

/** Scene river length (m) the twin's km are mapped onto. */
export function corridorLengthM(dataset) {
  const chainage = Array.isArray(dataset?.chainage) ? dataset.chainage : [];
  const stations = dataset?.corridor?.stations || [];
  return (
    Number(dataset?.corridor?.length) ||
    Number(chainage[chainage.length - 1]?.meters) ||
    Number(stations[stations.length - 1]?.along) ||
    17000
  );
}

/**
 * Chainage meters per JalNetra km. The twin chains the same KML, but its total km can
 * differ slightly from ours, so reaches are stretched to end where the river ends.
 * Every chainage → reach lookup (ribbon, HUD, weather, inspect) must use this.
 */
export function bodCodKmToM(data, corridorLenM) {
  const maxKm = Math.max(...(data?.reaches || []).map((r) => Number(r.km?.[1]) || 0), 0.001);
  return corridorLenM / maxKm;
}

/** Reach index covering a chainage (meters), else nearest by midpoint; -1 when no data. */
export function reachIndexAtMeters(data, meters, corridorLenM) {
  const list = data?.reaches || [];
  if (!list.length) return -1;
  const m = Number(meters);
  if (!Number.isFinite(m)) return 0;
  const kmToM = bodCodKmToM(data, corridorLenM);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < list.length; i++) {
    const [a, b] = Array.isArray(list[i].km) ? list[i].km : [0, 0];
    const m0 = Number(a) * kmToM;
    const m1 = Number(b) * kmToM;
    if (m >= m0 && m <= m1 + 0.5) return i;
    const d = Math.abs((m0 + m1) / 2 - m);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
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

/** Default time index = API `today` snapshot, else last history hour, else last date. */
export function defaultTimeIndex(timeline) {
  const n = timeline?.dates?.length || 0;
  if (!n) return 0;
  if (timeline.todayIndex >= 0) return timeline.todayIndex;
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
