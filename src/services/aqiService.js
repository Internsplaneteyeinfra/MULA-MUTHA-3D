/**
 * RiverEye live AQI — POST /api/aqi (+ hourly history).
 * Live: https://rivereye-production.up.railway.app/api/aqi
 * Dev uses Vite proxy `/rivereye-api` (CORS only allows localhost:3000 on origin).
 */

const REMOTE_API = "https://rivereye-production.up.railway.app/api";

/** Override with VITE_RIVEREYE_API (e.g. https://…/api or /rivereye-api). */
export function aqiApiBase() {
  const env =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_RIVEREYE_API;
  if (env) return String(env).replace(/\/$/, "");
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    return "/rivereye-api";
  }
  return REMOTE_API;
}

export const AQI_FALLBACK_LL = { lat: 18.52, lon: 73.85 };

export const AQI_CATEGORIES = [
  { id: "good", label: "Good", range: "0–50", min: 0, max: 50, color: "#1c8a55" },
  { id: "moderate", label: "Moderate", range: "50–100", min: 50, max: 100, color: "#96700a" },
  { id: "poor", label: "Poor", range: "100–150", min: 100, max: 150, color: "#d2701a" },
  { id: "unhealthy", label: "Unhealthy", range: "150–200", min: 150, max: 200, color: "#c2372a" },
  { id: "severe", label: "Severe", range: "200–300", min: 200, max: 300, color: "#6d28d9" },
  { id: "hazardous", label: "Hazardous", range: "300+", min: 300, max: 9999, color: "#7f1d1d" },
];

/** Pollutant bars — max matches RiverEye dashboard scale. */
export const AQI_POLLUTANTS = [
  { key: "pm2_5", label: "PM2.5", unit: "µg/m³", max: 75, color: "#c2372a" },
  { key: "pm10", label: "PM10", unit: "µg/m³", max: 150, color: "#b3761a" },
  { key: "no2", label: "NO₂", unit: "µg/m³", max: 200, color: "#1668b3" },
  { key: "so2", label: "SO₂", unit: "µg/m³", max: 125, color: "#6d28d9" },
  { key: "o3", label: "O₃", unit: "µg/m³", max: 180, color: "#1c8a55" },
  { key: "co", label: "CO", unit: "ppm", max: 10, color: "#c02a72" },
];

export const AQI_TREND_METRICS = [
  { id: "aqi", label: "AQI", field: "aqi", color: "#0e8f9c" },
  { id: "pm2_5", label: "PM2.5", field: "pm2_5", color: "#c2372a" },
  { id: "pm10", label: "PM10", field: "pm10", color: "#b3761a" },
];

/** @type {Map<string, { at:number, data:object }>} */
const liveCache = new Map();
/** @type {Map<string, object>} */
const hourlyCache = new Map();

export function aqiCategory(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { id: "unknown", label: "—", color: "#6a7a8a", range: "" };
  }
  for (const c of AQI_CATEGORIES) {
    if (n <= c.max) return c;
  }
  return AQI_CATEGORIES[AQI_CATEGORIES.length - 1];
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {{ date?: string, bustCache?: boolean }} [opts]
 */
export async function fetchLiveAqi(lat, lon, opts = {}) {
  const q = quantizeLonLat(lat, lon);
  const key = `${q.lat.toFixed(2)},${q.lon.toFixed(2)}:${opts.date || "live"}`;
  const hit = liveCache.get(key);
  if (!opts.bustCache && hit && Date.now() - hit.at < 45_000) return hit.data;

  const body = {
    latitude: q.lat,
    longitude: q.lon,
  };
  if (opts.date) body.date = opts.date;

  const data = await postJson(`${aqiApiBase()}/aqi`, body);
  const normalized = normalizeReading(data, q);
  liveCache.set(key, { at: Date.now(), data: normalized });
  pushLocalTrend(q, normalized);
  return normalized;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {string} date YYYY-MM-DD
 */
export async function fetchHourlyAqi(lat, lon, date) {
  const q = quantizeLonLat(lat, lon);
  const day = String(date || todayYmd());
  const key = `${q.lat.toFixed(2)},${q.lon.toFixed(2)}:${day}`;
  if (hourlyCache.has(key)) return hourlyCache.get(key);

  const raw = await postJson(`${aqiApiBase()}/aqi/hourly`, {
    latitude: q.lat,
    longitude: q.lon,
    date: day,
  });
  const records = Array.isArray(raw?.hourly_records)
    ? raw.hourly_records.map((r) => normalizeReading(r, q))
    : [];
  const payload = {
    date: raw?.date || day,
    lat: q.lat,
    lon: q.lon,
    records,
  };
  hourlyCache.set(key, payload);
  return payload;
}

/** Client-side fused live history (RiverEye “60-minute trend”). */
const TREND_KEY = "mm_aqi_trend_v1";
const TREND_MAX = 60;

function trendStoreKey(q) {
  return `${q.lat.toFixed(2)},${q.lon.toFixed(2)}`;
}

function readTrendMap() {
  try {
    return JSON.parse(sessionStorage.getItem(TREND_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeTrendMap(map) {
  try {
    sessionStorage.setItem(TREND_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

function pushLocalTrend(q, reading) {
  const map = readTrendMap();
  const k = trendStoreKey(q);
  const arr = Array.isArray(map[k]) ? map[k] : [];
  const t = Date.now();
  const last = arr[arr.length - 1];
  if (last && t - last.t < 50_000) {
    arr[arr.length - 1] = { t, aqi: reading.aqi, pm2_5: reading.pm2_5, pm10: reading.pm10 };
  } else {
    arr.push({ t, aqi: reading.aqi, pm2_5: reading.pm2_5, pm10: reading.pm10 });
  }
  while (arr.length > TREND_MAX) arr.shift();
  map[k] = arr;
  writeTrendMap(map);
}

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {{ t:number, aqi:number|null, pm2_5:number|null, pm10:number|null }[]}
 */
export function getLocalAqiTrend(lat, lon) {
  const q = quantizeLonLat(lat, lon);
  const map = readTrendMap();
  const arr = map[trendStoreKey(q)];
  return Array.isArray(arr) ? arr : [];
}

export function trendStats(points, field = "aqi") {
  const vals = (points || [])
    .map((p) => Number(p?.[field]))
    .filter((n) => Number.isFinite(n));
  if (!vals.length) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    min: Math.round(min),
    max: Math.round(max),
    avg: Math.round(avg),
    n: vals.length,
  };
}

export function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function shiftYmd(ymd, deltaDays) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function normalizeReading(raw, q) {
  const aqi = num(raw?.aqi);
  return {
    lat: q.lat,
    lon: q.lon,
    aqi,
    aqi_0to3m: num(raw?.aqi_0to3m),
    pm2_5: num(raw?.pm2_5),
    pm10: num(raw?.pm10),
    no2: num(raw?.no2),
    so2: num(raw?.so2),
    o3: num(raw?.o3),
    co: num(raw?.co),
    date: raw?.date || null,
    last_updated: raw?.last_updated || null,
    data_source: raw?.data_source || null,
    category: aqiCategory(aqi),
    correction_factor: raw?.correction_factor || null,
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function quantizeLonLat(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { ...AQI_FALLBACK_LL };
  }
  return {
    lat: Math.round(a * 100) / 100,
    lon: Math.round(b * 100) / 100,
  };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = await res.json();
      if (err?.error) detail = err.error;
    } catch {
      /* ignore */
    }
    throw new Error(`AQI HTTP ${res.status}: ${detail}`);
  }
  return res.json();
}

export function clearAqiCache() {
  liveCache.clear();
  hourlyCache.clear();
}
