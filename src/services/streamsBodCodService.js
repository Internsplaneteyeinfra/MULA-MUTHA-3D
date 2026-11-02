/**
 * JalNetra joining-streams BOD/COD.
 * POST /api/streams-bod-cod with the same drainage KML the scene draws → one series per placemark.
 * Per-stream viewer ids expire almost immediately, so the POST response itself is the source.
 */
import drainageKmlRaw from "../data/drainage_network.kml?raw";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_JALNETRA_API_BASE) ||
  "https://jalnetra-software-production.up.railway.app";

// Observed 30–155 s per POST; the gateway itself cuts off at 300 s.
const REQUEST_TIMEOUT_MS = 280_000;
const IDB_NAME = "mm-streams-bod-cod";
const IDB_STORE = "payload";
const CACHE_TTL_MS = 6 * 3600_000;

const RETRY_AFTER_MS = 60_000;

let memoryCache = null;
let inflight = null;
let lastError = null;
let lastErrorAt = 0;

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

/** Already-loaded payload (sync, for hover); null until the POST resolves. */
export function peekStreamsBodCod() {
  return memoryCache;
}

/**
 * Display values for a drawn drainage: API `today` of the placemark entering the river.
 * @returns {{ bod:number, cod:number, cls:string, date:string, streamId:string, chainageKm:number } | null}
 */
export function streamBodCodToday(rec, data) {
  const s = streamForDrainage(rec, data);
  const t = s?.today;
  if (!t) return null;
  return {
    bod: Number(t.bod_p50),
    cod: Number(t.cod_p50),
    cls: String(t.class_band || "—"),
    date: String(t.date || data?.generated || ""),
    streamId: String(s.stream_id || ""),
    chainageKm: Number(s.location?.chainage_km),
  };
}

/** @returns {Promise<object>} full /api/streams-bod-cod response */
export function fetchStreamsBodCod() {
  if (memoryCache) return Promise.resolve(memoryCache);
  // Hover calls this constantly — don't re-POST a failing pipeline on every mouse move.
  if (lastError && Date.now() - lastErrorAt < RETRY_AFTER_MS) return Promise.reject(lastError);
  if (!inflight) {
    inflight = loadStreams()
      .then((data) => {
        lastError = null;
        return data;
      })
      .catch((err) => {
        lastError = err;
        lastErrorAt = Date.now();
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Last load error (for "unavailable" vs "loading" labels). */
export function streamsBodCodError() {
  return lastError && Date.now() - lastErrorAt < RETRY_AFTER_MS ? lastError : null;
}

async function loadStreams() {
  const cached = await readCachedPayload();
  if (cached) {
    memoryCache = cached;
    return cached;
  }
  const form = new FormData();
  form.append(
    "kml",
    new Blob([drainageKmlRaw], { type: "application/vnd.google-earth.kml+xml" }),
    "drainage_network.kml",
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
    memoryCache = data;
    void writeCachedPayload(data);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * API stream for a drawn drainage record. Placemark i ↔ streams[i] (S01 = placemark 0).
 * A channel stitched from several placemarks uses the one whose point is nearest its outlet,
 * i.e. the water actually entering the river.
 */
export function streamForDrainage(rec, data) {
  const streams = data?.streams || [];
  const indices = rec?.meta?.placemarkIndices || [];
  const candidates = indices.map((i) => streams[i]).filter(Boolean);
  if (!candidates.length) return null;
  const lat = Number(rec.outletLat);
  const lon = Number(rec.outletLon);
  if (candidates.length === 1 || !Number.isFinite(lat) || !Number.isFinite(lon)) return candidates[0];
  let best = candidates[0];
  let bestD = Infinity;
  for (const s of candidates) {
    const d = Math.hypot(
      (Number(s.location?.latitude) - lat) * 111_000,
      (Number(s.location?.longitude) - lon) * 105_000,
    );
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
