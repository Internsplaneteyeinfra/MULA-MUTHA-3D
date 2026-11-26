/**
 * Main-stream (Mula–Mutha) BOD/COD points, LIVE from JalNetra.
 *
 * POST /api/bod-cod with the river KML returns `pixels: [{ latitude, longitude, bod_mg_L, cod_mg_L }]`
 * for the nearest clear Landsat/Sentinel-2 day. (Its 10 m `chainages` carry no values, and the old
 * viewer/reaches endpoint is gone, so these pixels are the live main BOD/COD.)
 *
 * Source priority — never downgraded once a better one is loaded:
 *   live    → this session's POST response
 *   recent  → last successful live response saved in IndexedDB (most recent JalNetra values)
 *   bundled → public/data/main_bod_cod_pixels.json (undated saved pixel file)
 *
 * Any point without its own value (a chainage, a hotspot, a click) takes the nearest pixel.
 * `main-bodcod-update` is dispatched on document whenever the active source changes.
 */

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_JALNETRA_API_BASE) ||
  "https://jalnetra-software-production.up.railway.app";
const KML_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_BOD_COD_KML_URL) ||
  "/data/mula_mutha_river.kml";
const BUNDLED_URL = "/data/main_bod_cod_pixels.json";

// Observed 27–130 s per POST; the gateway itself gives up at 300 s.
const REQUEST_TIMEOUT_MS = 280_000;
const RETRY_AFTER_MS = 60_000;
const IDB_NAME = "mm-main-bodcod";
const IDB_STORE = "payload";

export const MAIN_BODCOD_EVENT = "main-bodcod-update";
const RANK = { bundled: 1, recent: 2, live: 3 };

/** Grid cell size in degrees (~33 m). */
const CELL = 0.0003;

/**
 * @typedef {{ lon:number, lat:number, bod:number, cod:number }} Pixel
 * @type {{ points: Pixel[], grid: Map<string, number[]>, source: "live"|"recent"|"bundled",
 *          imageDate: string, refreshedAt: string, raw?: object } | null}
 */
let current = null;
let seedPromise = null;
let livePromise = null;
let liveFailedAt = 0;

function cellKey(lon, lat) {
  return `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;
}

function adopt(points, meta) {
  if (!points.length) return false;
  if (current && RANK[current.source] > RANK[meta.source]) return false;
  const grid = new Map();
  points.forEach((p, i) => {
    const k = cellKey(p.lon, p.lat);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  });
  current = { points, grid, ...meta };
  try {
    document.dispatchEvent(new CustomEvent(MAIN_BODCOD_EVENT, { detail: mainBodCodStatus() }));
  } catch {
    /* non-DOM context */
  }
  return true;
}

function pointsFromLive(data) {
  const out = [];
  for (const row of Array.isArray(data?.pixels) ? data.pixels : []) {
    const lon = Number(row.longitude ?? row.lon);
    const lat = Number(row.latitude ?? row.lat);
    const bod = Number(row.bod_mg_L ?? row.bod);
    const cod = Number(row.cod_mg_L ?? row.cod);
    if ([lon, lat, bod, cod].every(Number.isFinite)) out.push({ lon, lat, bod, cod });
  }
  return out;
}

function liveMeta(data, source) {
  return {
    source,
    imageDate: String(data?.selected_landsat_date || data?.generated || ""),
    refreshedAt: String(data?.data_refreshed_at || data?.generated || ""),
  };
}

/* ---------- IndexedDB: most recent live response ---------- */

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readRecent() {
  try {
    const db = await idbOpen();
    const rec = await new Promise((resolve, reject) => {
      const r = db.transaction(IDB_STORE).objectStore(IDB_STORE).get("latest");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return rec?.data?.pixels?.length ? rec.data : null;
  } catch {
    return null;
  }
}

async function writeRecent(data) {
  try {
    // Keep only what the app needs; the full response also carries 3 000+ empty chainages.
    const slim = {
      generated: data.generated,
      data_refreshed_at: data.data_refreshed_at,
      selected_landsat_date: data.selected_landsat_date,
      selected_sentinel2_date: data.selected_sentinel2_date,
      stats: data.stats,
      pixels: data.pixels,
    };
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ savedAt: Date.now(), data: slim }, "latest");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* best-effort */
  }
}

/* ---------- loaders ---------- */

async function loadBundled() {
  const res = await fetch(BUNDLED_URL, { cache: "force-cache" });
  if (!res.ok) throw new Error(`BOD/COD pixels HTTP ${res.status}`);
  const data = await res.json();
  const points = [];
  for (const row of Array.isArray(data?.points) ? data.points : []) {
    const [lon, lat, bod, cod] = row.map(Number);
    if ([lon, lat, bod, cod].every(Number.isFinite)) points.push({ lon, lat, bod, cod });
  }
  adopt(points, { source: "bundled", imageDate: "", refreshedAt: "" });
}

/**
 * Live JalNetra main BOD/COD POST (one per session, shared by every caller).
 * Resolves to the raw API response; the pixels are adopted as the live source.
 */
export function startLiveMainBodCod() {
  if (livePromise) return livePromise;
  if (liveFailedAt && Date.now() - liveFailedAt < RETRY_AFTER_MS) {
    return Promise.reject(new Error("JalNetra BOD/COD recently failed; retrying later"));
  }
  livePromise = (async () => {
    const kmlRes = await fetch(new URL(KML_URL, window.location.origin).href, { cache: "no-store" });
    if (!kmlRes.ok) throw new Error(`BOD/COD KML fetch HTTP ${kmlRes.status}`);
    const form = new FormData();
    form.append("kml", await kmlRes.blob(), "mula_mutha_river.kml");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, "")}/api/bod-cod`, {
        method: "POST",
        body: form,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`JalNetra BOD/COD HTTP ${res.status}`);
      const data = await res.json();
      const points = pointsFromLive(data);
      if (points.length) {
        adopt(points, liveMeta(data, "live"));
        void writeRecent(data);
      } else {
        console.warn("[main-bodcod] live response has no pixels; keeping", current?.source);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  })().catch((err) => {
    liveFailedAt = Date.now();
    livePromise = null;
    console.warn("[main-bodcod] live JalNetra failed; keeping", current?.source, "—", err?.message || err);
    throw err;
  });
  return livePromise;
}

/**
 * Best available points now (recent/bundled), and kicks off the live POST in the background.
 * @returns {Promise<Pixel[]>}
 */
export function loadBodCodPixels() {
  void startLiveMainBodCod().catch(() => {});
  if (!seedPromise) {
    seedPromise = (async () => {
      const recent = await readRecent();
      if (recent) adopt(pointsFromLive(recent), liveMeta(recent, "recent"));
      if (!current) await loadBundled();
    })().catch((err) => {
      seedPromise = null;
      console.warn("[main-bodcod]", err?.message || err);
    });
  }
  return seedPromise.then(() => current?.points || []);
}

/** Active source info for labels. */
export function mainBodCodStatus() {
  if (!current) return { source: "none", imageDate: "", refreshedAt: "", count: 0 };
  return {
    source: current.source,
    imageDate: current.imageDate,
    refreshedAt: current.refreshedAt,
    count: current.points.length,
  };
}

/** Short provenance text, e.g. "LIVE JalNetra · image 2026-11-24". */
export function mainBodCodLabel(status = mainBodCodStatus()) {
  const date = status.imageDate ? ` · image ${status.imageDate}` : "";
  if (status.source === "live") return `LIVE JalNetra main BOD/COD${date}`;
  if (status.source === "recent") return `Most recent JalNetra main BOD/COD${date} (live pending/unavailable)`;
  if (status.source === "bundled") return "Saved JalNetra pixel file (undated; live pending/unavailable)";
  return "BOD/COD unavailable";
}

function meta(p, d2) {
  const distDeg = Math.sqrt(d2);
  return {
    bod: p.bod,
    cod: p.cod,
    lat: p.lat,
    lon: p.lon,
    distDeg,
    distM: Math.round(distDeg * 111_000),
    source: current.source,
    imageDate: current.imageDate,
  };
}

/**
 * Nearest pixel BOD/COD at lon/lat (no distance cap — gaps take the nearest captured value).
 * Returns null only when no data source could be loaded.
 */
export async function lookupBodCodAt(lat, lon) {
  // Start loading (most recent → saved, plus live) even before a point is known, so the
  // first real lookup — and the MAIN_BODCOD_EVENT re-render — already has values.
  await loadBodCodPixels();
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return lookupBodCodAtSync(la, lo);
}

/** Same as lookupBodCodAt against whatever is loaded right now (null before first load). */
export function lookupBodCodAtSync(lat, lon) {
  if (!current?.points.length) return null;
  const { points, grid } = current;
  const cx = Math.floor(lon / CELL);
  const cy = Math.floor(lat / CELL);
  let best = null;
  let bestD2 = Infinity;
  const consider = (p) => {
    const d2 = (p.lon - lon) ** 2 + (p.lat - lat) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = p;
    }
  };
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(`${cx + dx},${cy + dy}`);
      if (bucket) for (const i of bucket) consider(points[i]);
    }
  }
  // Within one cell the 3×3 neighbourhood is guaranteed to hold the true nearest.
  if (!best || bestD2 > CELL * CELL) for (const p of points) consider(p);
  return best ? meta(best, bestD2) : null;
}

/**
 * Highest-BOD pixel inside a lon/lat box (a hotspot cell); nearest pixel to its centre if empty.
 * @returns {ReturnType<typeof lookupBodCodAtSync> & { inCell:boolean, pixelCount:number }}
 */
export function peakBodCodInBox(lon0, lat0, lon1, lat1) {
  if (!current?.points.length) return null;
  let best = null;
  let n = 0;
  for (const p of current.points) {
    if (p.lon < lon0 || p.lon > lon1 || p.lat < lat0 || p.lat > lat1) continue;
    n++;
    if (!best || p.bod > best.bod || (p.bod === best.bod && p.cod > best.cod)) best = p;
  }
  if (best) return { ...meta(best, 0), inCell: true, pixelCount: n };
  const near = lookupBodCodAtSync((lat0 + lat1) / 2, (lon0 + lon1) / 2);
  return near ? { ...near, inCell: false, pixelCount: 0 } : null;
}
