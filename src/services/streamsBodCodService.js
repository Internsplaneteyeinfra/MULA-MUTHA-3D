/**
 * JalNetra joining-streams BOD/COD.
 * Always POST /api/streams-bod-cod with joining_streams.kml for live values.
 * On network/API failure, fall back to the bundled response JSON (pixel table).
 * Hover along a full stream uses the nearest pixel so BOD/COD numbers stay visible.
 */
import joiningStreamsKmlRaw from "../data/joining_streams.kml?raw";
import fallbackPayload from "../data/streams_bod_cod_fallback.json";
import { classFromBod } from "./bodCodService.js";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_JALNETRA_API_BASE) ||
  "https://jalnetra-software-production.up.railway.app";

// Observed 30–155 s per POST; the gateway itself cuts off at 300 s.
const REQUEST_TIMEOUT_MS = 280_000;
const IDB_NAME = "mm-streams-bod-cod";
const IDB_STORE = "payload";
const IDB_VERSION = 2;
const CACHE_TTL_MS = 6 * 3600_000;
const RETRY_AFTER_MS = 60_000;

/** Grid cell ~30 m for nearest-pixel lookup. */
const CELL = 0.0003;

let memoryCache = null;
let inflight = null;
let lastError = null;
let lastErrorAt = 0;
/** @type {Map<string, number[]> | null} */
let pixelGrid = null;
/** @type {{ lon:number, lat:number, bod:number, cod:number, streamId:string, streamName:string }[] | null} */
let flatPixels = null;

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
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
    if (!rec?.data?.streams?.length) return null;
    if (Date.now() - rec.savedAt > CACHE_TTL_MS) return null;
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

function cellKey(lon, lat) {
  return `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;
}

function buildPixelIndex(data) {
  const list = [];
  const top = Array.isArray(data?.pixels) ? data.pixels : [];
  const fromTop = top.length
    ? top
    : (data?.streams || []).flatMap((s) => (Array.isArray(s.pixels) ? s.pixels : []));

  for (const row of fromTop) {
    const lon = Number(row.longitude ?? row.lon);
    const lat = Number(row.latitude ?? row.lat);
    const bod = Number(row.bod_mg_L ?? row.bod);
    const cod = Number(row.cod_mg_L ?? row.cod);
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      !Number.isFinite(bod) ||
      !Number.isFinite(cod)
    ) {
      continue;
    }
    list.push({
      lon,
      lat,
      bod,
      cod,
      streamId: String(row.stream_id || ""),
      streamName: String(row.stream_name || ""),
    });
  }

  const g = new Map();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const k = cellKey(p.lon, p.lat);
    let bucket = g.get(k);
    if (!bucket) {
      bucket = [];
      g.set(k, bucket);
    }
    bucket.push(i);
  }
  flatPixels = list;
  pixelGrid = g;
}

function adoptPayload(data, source) {
  const tagged = { ...data, _source: source };
  memoryCache = tagged;
  buildPixelIndex(tagged);
  return tagged;
}

function bundledFallback() {
  if (!fallbackPayload?.streams?.length) {
    throw new Error("Bundled streams BOD/COD fallback is empty");
  }
  return adoptPayload(fallbackPayload, "fallback");
}

/** Already-loaded payload (sync, for hover); null until load resolves. */
export function peekStreamsBodCod() {
  return memoryCache;
}

/**
 * Display values for a drawn drainage (stream mean / legacy today snapshot).
 * Prefer nearest-pixel via lookupStreamBodCodAt when a hover lon/lat is available.
 * @returns {{ bod:number, cod:number, cls:string, date:string, streamId:string, chainageKm:number, source?:string } | null}
 */
export function streamBodCodToday(rec, data) {
  const s = streamForDrainage(rec, data);
  if (!s) return null;

  const t = s.today;
  if (t && (Number.isFinite(Number(t.bod_p50)) || Number.isFinite(Number(t.cod_p50)))) {
    const bod = Number(t.bod_p50);
    const cod = Number(t.cod_p50);
    return {
      bod,
      cod,
      cls: String(t.class_band || classFromBod(bod)),
      date: String(t.date || data?.generated || data?.data_refreshed_at || ""),
      streamId: String(s.stream_id || ""),
      chainageKm: Number(s.location?.chainage_km ?? s.chainage_label),
      source: data?._source || "live",
    };
  }

  const stats = s.stats || {};
  const bod = Number(stats.bod_mg_L_mean);
  const cod = Number(stats.cod_mg_L_mean);
  if (!Number.isFinite(bod) && !Number.isFinite(cod)) return null;
  return {
    bod,
    cod,
    cls: classFromBod(bod),
    date: String(data?.generated || data?.data_refreshed_at || ""),
    streamId: String(s.stream_id || ""),
    chainageKm: Number(String(s.chainage_label || "").replace(/[^\d.]/g, "")) || NaN,
    source: data?._source || "live",
  };
}

/**
 * Values to display for a navigated/selected stream: its own series, else the nearest
 * captured pixel to its outlet (so the panel always has numbers when any data is loaded).
 */
export function streamBodCodForRecord(rec, data) {
  const payload = data || memoryCache;
  if (!payload?.streams?.length) return null;
  const own = streamBodCodToday(rec, payload);
  if (own && Number.isFinite(own.bod) && Number.isFinite(own.cod)) return own;
  const lat = Number(rec?.outletLat ?? rec?.orderedPts?.at?.(-1)?.lat);
  const lon = Number(rec?.outletLon ?? rec?.orderedPts?.at?.(-1)?.lon);
  const near = lookupStreamBodCodAt(lat, lon, rec, payload);
  if (near && Number.isFinite(near.bod) && Number.isFinite(near.cod)) return { ...near, nearestFill: true };
  return own;
}

/**
 * Nearest BOD/COD sample at lon/lat along a joining stream.
 * Prefer pixels for that stream; if none, use nearest pixel overall; else stream mean.
 * @returns {{ bod:number, cod:number, cls:string, date:string, streamId:string, lat:number, lon:number, distM:number, nearest:boolean, source?:string } | null}
 */
export function lookupStreamBodCodAt(lat, lon, rec, data) {
  const payload = data || memoryCache;
  if (!payload?.streams?.length) return null;

  const la = Number(lat);
  const lo = Number(lon);
  const stream = streamForDrainage(rec, payload);
  const streamId = String(stream?.stream_id || "");
  const asOf = String(payload.generated || payload.data_refreshed_at || "");

  if (Number.isFinite(la) && Number.isFinite(lo) && flatPixels?.length && pixelGrid) {
    const nearest = nearestPixel(lo, la, streamId);
    if (nearest) {
      return {
        bod: nearest.bod,
        cod: nearest.cod,
        cls: classFromBod(nearest.bod),
        date: asOf,
        streamId: nearest.streamId || streamId,
        lat: nearest.lat,
        lon: nearest.lon,
        distM: nearest.distM,
        nearest: nearest.distM > 1,
        source: payload._source || "live",
      };
    }
  }

  const mean = streamBodCodToday(rec, payload);
  if (!mean) return null;
  return {
    ...mean,
    lat: Number.isFinite(la) ? la : NaN,
    lon: Number.isFinite(lo) ? lo : NaN,
    distM: NaN,
    nearest: false,
  };
}

function nearestPixel(lon, lat, preferStreamId) {
  const cx = Math.floor(lon / CELL);
  const cy = Math.floor(lat / CELL);

  const scan = (restrictStream) => {
    let best = null;
    let bestD2 = Infinity;
    const consider = (p) => {
      if (restrictStream && preferStreamId && p.streamId !== preferStreamId) return;
      const dlon = p.lon - lon;
      const dlat = p.lat - lat;
      const d2 = dlon * dlon + dlat * dlat;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = p;
      }
    };

    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const bucket = pixelGrid.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const i of bucket) consider(flatPixels[i]);
      }
    }
    if (!best) {
      for (const p of flatPixels) consider(p);
    }
    if (!best) return null;
    const distM = Math.sqrt(bestD2) * 111_000;
    return { ...best, distM };
  };

  return (preferStreamId && scan(true)) || scan(false);
}

/** @returns {Promise<object>} full /api/streams-bod-cod response (or fallback) */
export function fetchStreamsBodCod() {
  // Live already won — reuse for the session
  if (memoryCache?._source === "live") return Promise.resolve(memoryCache);

  if (!inflight) {
    inflight = loadStreams()
      .then((data) => {
        lastError = null;
        return data;
      })
      .catch((err) => {
        lastError = err;
        lastErrorAt = Date.now();
        try {
          return memoryCache || bundledFallback();
        } catch {
          throw err;
        }
      })
      .finally(() => {
        inflight = null;
      });
  }

  // Seed bundled JSON so peek/hover has numbers while the live POST runs.
  // Awaiters still wait on `inflight` for the final live (or fallback) payload.
  if (!memoryCache) {
    try {
      bundledFallback();
    } catch {
      /* live may still succeed */
    }
  }
  return inflight;
}

/** Last load error (for "unavailable" vs "loading" labels). Cleared once any payload is adopted. */
export function streamsBodCodError() {
  if (memoryCache) return null;
  return lastError && Date.now() - lastErrorAt < RETRY_AFTER_MS ? lastError : null;
}

async function loadStreams() {
  // Seed fallback first so joining-stream hover always has BOD/COD numbers,
  // then always hit JalNetra live and upgrade when the POST succeeds.
  if (!memoryCache) {
    try {
      bundledFallback();
    } catch {
      /* continue — live may still succeed */
    }
  }

  try {
    const live = await postLiveStreamsBodCod();
    void writeCachedPayload(live);
    return adoptPayload(live, "live");
  } catch (liveErr) {
    console.warn(
      "[streams-bod-cod] live POST failed, keeping cache/fallback:",
      liveErr?.message || liveErr,
    );
    lastError = liveErr;
    lastErrorAt = Date.now();
    const cached = await readCachedPayload();
    if (cached?.streams?.length) {
      return adoptPayload(cached, "cache");
    }
    if (memoryCache) return memoryCache;
    return bundledFallback();
  }
}

async function postLiveStreamsBodCod() {
  const form = new FormData();
  form.append(
    "kml",
    new Blob([joiningStreamsKmlRaw], { type: "application/vnd.google-earth.kml+xml" }),
    "joining_streams.kml",
  );
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE.replace(/\/$/, "")}/api/streams-bod-cod`, {
      method: "POST",
      body: form,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.json().then((j) => j?.detail, () => "");
      throw new Error(`Streams BOD/COD HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    const data = await res.json();
    if (!data?.streams?.length) throw new Error("Streams BOD/COD payload has no streams");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * API stream for a drawn drainage record.
 * Placemark i ↔ streams[i] (S01 = placemark 0). Name match is the fallback.
 */
export function streamForDrainage(rec, data) {
  const streams = data?.streams || [];
  if (!streams.length) return null;

  const indices = rec?.meta?.placemarkIndices || [];
  for (const i of indices) {
    if (Number.isInteger(i) && streams[i]) return streams[i];
  }

  const name = String(
    rec?.displayName || rec?.name || rec?.meta?.name || rec?.meta?.nameEn || "",
  )
    .trim()
    .toLowerCase();
  if (name) {
    const byName = streams.find((s) => String(s.stream_name || "").trim().toLowerCase() === name);
    if (byName) return byName;
  }

  // Legacy: pick stream whose location is nearest the outlet
  const lat = Number(rec?.outletLat);
  const lon = Number(rec?.outletLon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    let best = null;
    let bestD = Infinity;
    for (const s of streams) {
      const slat = Number(s.location?.latitude ?? s.pixels?.[0]?.latitude);
      const slon = Number(s.location?.longitude ?? s.pixels?.[0]?.longitude);
      if (!Number.isFinite(slat) || !Number.isFinite(slon)) continue;
      const d = Math.hypot((slat - lat) * 111_000, (slon - lon) * 105_000);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) return best;
  }

  return null;
}
