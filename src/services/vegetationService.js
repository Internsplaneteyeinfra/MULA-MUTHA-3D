/**
 * JalNetra Vegetation Type API client.
 *
 * Exact OpenAPI contract (POST /api/vegetation-type):
 *   multipart/form-data
 *   - kml: file (application/octet-stream) — required
 *   - start_date: string | null — YYYY-MM-DD (optional)
 *   - end_date: string | null — YYYY-MM-DD (optional)
 *
 * Response (observed): categories[], legend[], kml_id, kml_download_url,
 * analysis stats, buffer metadata. Spatial classes arrive as GroundOverlay PNG
 * inside the downloadable KML (GET /api/vegetation-type/kml/{kml_id}).
 */

import {
  getLatestCompletedMonthDateRange,
  widenStartDate,
} from "../utils/dateRange.js";
import { loadAoiKml, pointInAnyAoi } from "../geo/aoiKml.js";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_JALNETRA_API_BASE) ||
  "https://jalnetra-software-production.up.railway.app";

const VEGETATION_TYPE_URL = `${API_BASE.replace(/\/$/, "")}/api/vegetation-type`;
const CACHE_PREFIX = "vegetation-v3";
const MAX_WIDEN_MONTHS = 3;
const REQUEST_TIMEOUT_MS = 240_000;

const isDev =
  typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

function debug(...args) {
  if (isDev) console.info("[vegetation]", ...args);
}

function cacheKey(aoiHash, endDate) {
  return `${CACHE_PREFIX}-${aoiHash}-${endDate}`;
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    debug("cache write failed", err?.message || err);
  }
}

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST multipart vegetation-type request using exact field names from Swagger.
 */
export async function postVegetationType({ kmlBlob, filename, start_date, end_date }) {
  const form = new FormData();
  form.append("kml", kmlBlob, filename || "aoi.kml");
  if (start_date) form.append("start_date", start_date);
  if (end_date) form.append("end_date", end_date);

  const res = await fetchWithTimeout(VEGETATION_TYPE_URL, {
    method: "POST",
    body: form,
    headers: {
      // Browser sets multipart boundary; skip ngrok warning if proxied
      "ngrok-skip-browser-warning": "true",
    },
  });

  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { detail: text };
  }

  if (!res.ok) {
    const detail =
      (typeof body?.detail === "string" && body.detail) ||
      (Array.isArray(body?.detail) && body.detail.map((d) => d.msg).join("; ")) ||
      `Vegetation API HTTP ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

export async function downloadVegetationTypeKml(kmlIdOrUrl) {
  const url = String(kmlIdOrUrl).startsWith("http")
    ? kmlIdOrUrl
    : `${API_BASE.replace(/\/$/, "")}/api/vegetation-type/kml/${kmlIdOrUrl}`;
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: { "ngrok-skip-browser-warning": "true" },
  }, 120_000);
  if (!res.ok) throw new Error(`Vegetation KML download failed (HTTP ${res.status})`);
  return res.text();
}

/**
 * Parse GroundOverlay LatLonBox + PNG data URL from vegetation type KML.
 */
export function parseVegetationOverlayKml(kmlText) {
  const box = {};
  for (const key of ["north", "south", "east", "west"]) {
    const m = kmlText.match(
      new RegExp(`<(?:\\w+:)?${key}>\\s*([\\d.+-eE]+)\\s*<\\/(?:\\w+:)?${key}>`, "i"),
    );
    if (m) box[key] = Number(m[1]);
  }
  if (
    ![box.north, box.south, box.east, box.west].every((n) => Number.isFinite(n))
  ) {
    throw new Error("Vegetation overlay KML missing LatLonBox.");
  }

  const hrefM = kmlText.match(/<(?:\w+:)?href>\s*(data:image\/png;base64,[^<\s]+)\s*<\/(?:\w+:)?href>/i);
  if (!hrefM) throw new Error("Vegetation overlay KML missing PNG GroundOverlay.");

  return {
    north: box.north,
    south: box.south,
    east: box.east,
    west: box.west,
    imageDataUrl: hrefM[1].trim(),
  };
}

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length < 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function nearestCategory(r, g, b, legend) {
  let best = null;
  let bestD = Infinity;
  for (const cat of legend) {
    const c = cat.rgb;
    if (!c) continue;
    const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = cat;
    }
  }
  // Reject near-white / unmatched noise
  if (!best || bestD > 48 * 48) return null;
  if (/non[- ]?vegetation|bare|built|urban|water/i.test(best.name || "")) return null;
  return best;
}

/**
 * Decode overlay PNG and emit vegetation samples (lon/lat + class).
 * Only samples pixels whose class is vegetation and that fall inside the AOI.
 */
export async function sampleVegetationRaster(overlay, {
  categories = [],
  legend = [],
  aoiPolygons = [],
  stride = 6,
} = {}) {
  const legendRows = (legend?.length ? legend : categories).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    rgb: hexToRgb(c.color),
    area_ha: c.area_ha,
    percent: c.percent,
  }));

  const img = await loadImage(overlay.imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const samples = [];
  const typeCounts = Object.create(null);
  const lonSpan = overlay.east - overlay.west;
  const latSpan = overlay.north - overlay.south;
  const step = Math.max(1, stride | 0);

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < 8) continue;
      const cat = nearestCategory(data[i], data[i + 1], data[i + 2], legendRows);
      if (!cat) continue;

      const lon = overlay.west + ((x + 0.5) / width) * lonSpan;
      const lat = overlay.north - ((y + 0.5) / height) * latSpan;
      if (aoiPolygons.length && !pointInAnyAoi(lon, lat, aoiPolygons)) continue;

      typeCounts[cat.name] = (typeCounts[cat.name] || 0) + 1;
      samples.push({
        id: `${cat.id}:${x}:${y}`,
        longitude: lon,
        latitude: lat,
        vegetationType: cat.name,
        categoryId: cat.id,
        color: cat.color,
        confidence: null,
        geometry: { type: "Point", coordinates: [lon, lat] },
        area: null,
        sourceDate: null,
      });
    }
  }

  return { samples, typeCounts, imageWidth: width, imageHeight: height };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode vegetation overlay PNG."));
    img.src = src;
  });
}

function isNoScenesError(err) {
  return /no sentinel|no scenes|not found between/i.test(err?.message || "");
}

/**
 * Full pipeline: load AOI KML → dynamic dates → API → overlay → samples.
 */
export async function fetchVegetationForAoi(options = {}) {
  const dates = getLatestCompletedMonthDateRange(options.now || new Date());
  let start_date = dates.start_date;
  const end_date = dates.end_date;

  const aoi = options.aoi || (await loadAoiKml(options.aoiOpts));
  const key = cacheKey(aoi.aoiHash, end_date);

  debug("AOI", {
    url: aoi.url,
    filename: aoi.filename,
    polygons: aoi.polygons.length,
    vertices: aoi.polygons[0]?.length,
    aoiHash: aoi.aoiHash,
  });
  debug("date range (completed month)", { start_date, end_date });

  const cached = options.skipCache ? null : readCache(key);
  if (cached?.response && (cached?.overlayKml || cached?.kml_id)) {
    debug("cache hit", key);
    if (!cached.overlayKml && cached.kml_id) {
      cached.overlayKml = await downloadVegetationTypeKml(cached.kml_id);
    }
    return finalizeNormalized(cached, aoi, { fromCache: true });
  }

  const kmlBlob = new Blob([aoi.text], {
    type: "application/vnd.google-earth.kml+xml",
  });

  let response = null;
  let usedStart = start_date;
  let lastErr = null;

  for (let widen = 0; widen <= MAX_WIDEN_MONTHS; widen++) {
    if (widen > 0) {
      usedStart = widenStartDate(dates.start_date, widen);
      debug("widening start_date for Sentinel coverage", { usedStart, end_date, widen });
    }
    try {
      response = await postVegetationType({
        kmlBlob,
        filename: aoi.filename,
        start_date: usedStart,
        end_date,
      });
      start_date = usedStart;
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (!isNoScenesError(err) || widen === MAX_WIDEN_MONTHS) throw err;
    }
  }
  if (!response) throw lastErr || new Error("Vegetation API unavailable.");

  validateVegetationResponse(response);

  const overlayUrl = response.kml_download_url || response.kml_id;
  if (!overlayUrl) throw new Error("Vegetation API response missing kml_id / kml_download_url.");

  const overlayKml = await downloadVegetationTypeKml(response.kml_id);

  const payload = {
    response,
    kml_id: response.kml_id,
    // Prefer re-download by kml_id on cache hit to keep localStorage small
    start_date,
    end_date,
    aoiHash: aoi.aoiHash,
    cachedAt: Date.now(),
  };
  writeCache(key, payload);

  debug("API response summary", {
    start_date: response.start_date,
    end_date: response.end_date,
    sentinel2_image_count: response.sentinel2_image_count,
    total_vegetation_area_ha: response.total_vegetation_area_ha,
    vegetation_cover_percent: response.vegetation_cover_percent,
    categories: (response.categories || []).map((c) => `${c.name}:${c.area_ha}ha`),
    kml_id: response.kml_id,
  });

  return finalizeNormalized({ ...payload, overlayKml }, aoi, { fromCache: false });
}

function validateVegetationResponse(response) {
  if (!response || typeof response !== "object") {
    throw new Error("Invalid vegetation API response.");
  }
  if (!Array.isArray(response.categories) && !Array.isArray(response.legend)) {
    throw new Error("Vegetation API response missing categories/legend.");
  }
}

async function finalizeNormalized(payload, aoi, meta) {
  const response = payload.response;
  const overlay = parseVegetationOverlayKml(payload.overlayKml);
  const { samples, typeCounts, imageWidth, imageHeight } = await sampleVegetationRaster(
    overlay,
    {
      categories: response.categories || [],
      legend: response.legend || [],
      aoiPolygons: aoi.polygons,
      stride: 2,
    },
  );

  const sourceDate = response.end_date || payload.end_date;
  for (const s of samples) s.sourceDate = sourceDate;

  const features = samples.map((s) => ({
    id: s.id,
    latitude: s.latitude,
    longitude: s.longitude,
    vegetationType: s.vegetationType,
    categoryId: s.categoryId,
    confidence: s.confidence,
    geometry: s.geometry,
    area: s.area,
    sourceDate: s.sourceDate,
    color: s.color,
  }));

  debug("normalized", {
    geometries: features.length,
    types: typeCounts,
    imageWidth,
    imageHeight,
    fromCache: !!meta.fromCache,
  });

  return {
    aoi,
    response,
    overlay,
    features,
    typeCounts,
    start_date: payload.start_date || response.start_date,
    end_date: payload.end_date || response.end_date,
    empty: features.length === 0,
    fromCache: !!meta.fromCache,
  };
}

export { VEGETATION_TYPE_URL, API_BASE, cacheKey };
