/**
 * JalNetra Flood Water API client — MODE A (API flood simulation).
 *
 * Exact OpenAPI contract (POST /api/flood-water):
 *   multipart/form-data
 *   - kml: file (application/octet-stream) — the ONLY field.
 *   Backend description: "No date input: fixed range 1 June 2026 → today …
 *   Pre/post dates follow Sentinel-1 image sequence."
 *   There is no per-date generation and no catalog endpoint: every POST
 *   reprocesses the whole backend window, and `datewise` lists one row per
 *   real Sentinel-1 acquisition. That list is the availability catalog.
 *
 * Response (observed 200, synchronous — no job polling):
 *   {
 *     start_date, end_date, buffer_m, scene_count, comparison_count,
 *     datewise: [{
 *       pre_date, post_date, date, water_area_ha, flood_area_ha,
 *       categories: [{ id, name, color, area_ha }],
 *       kml_filename, kml_id, kml_download_url
 *     }],
 *     logic, notes
 *   }
 *
 * Spatial product: GET /api/flood-water/kml/{kml_id}
 *   → KML GroundOverlay PNG + LatLonBox
 *   Blue ≈ permanent/common water · Red ≈ flood (extent only — no depth field)
 *   Expired id → HTTP 404 "KML not found or expired. Run POST /api/flood-water again."
 *
 * No water level, water rise or depth field exists anywhere in the response.
 */

import { formatApiDate } from "../utils/dateRange.js";
import { loadAoiKml, pointInAnyAoi, hashAoiGeometry } from "../geo/aoiKml.js";
import { prepareAoiFromKml } from "../utils/kmlToGeoJSON.js";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_JALNETRA_API_BASE) ||
  "https://jalnetra-software-production.up.railway.app";

const FLOOD_WATER_URL = `${API_BASE.replace(/\/$/, "")}/api/flood-water`;
const CACHE_PREFIX = "jalnetra-flood-v4";
try {
  if (typeof localStorage !== "undefined") {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("jalnetra-flood-") && !k.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(k);
      }
    }
  }
} catch {}
const REQUEST_TIMEOUT_MS = 300_000;

/** @type {Promise<any> | null} */
let aoiPromise = null;

const isDev = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

/**
 * One in-flight request per channel, so a scene download never aborts a
 * catalog refresh (and vice versa), while a newer request on the same
 * channel supersedes the stale one.
 * @type {Map<string, AbortController>}
 */
const activeControllers = new Map();

function debug(...args) {
  if (isDev) console.info("[jalnetra-flood]", ...args);
}

/** Abort the request on `channel`, or every flood request when omitted. */
export function cancelJalnetraFloodRequest(channel) {
  for (const [ch, ctrl] of activeControllers) {
    if (channel && ch !== channel) continue;
    ctrl.abort();
    activeControllers.delete(ch);
  }
}

/** @deprecated alias */
export const cancelFloodSimulationRequest = cancelJalnetraFloodRequest;

async function fetchWithAbort(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, channel = "default") {
  cancelJalnetraFloodRequest(channel);
  const ctrl = new AbortController();
  activeControllers.set(channel, ctrl);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const { signal: _ignored, ...rest } = options;
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (activeControllers.get(channel) === ctrl) activeControllers.delete(channel);
  }
}

export function isValidApiDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return false;
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function todayApiDate(now = new Date()) {
  return formatApiDate(now);
}

/** Shift YYYY-MM-DD by `deltaDays` (local calendar). */
export function shiftApiDate(ymd, deltaDays) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  return formatApiDate(dt);
}

/**
 * POST multipart flood-water request using exact Swagger field names.
 */
export async function postFloodWater({ kmlBlob, filename, signal }) {
  if (!kmlBlob) throw new Error("Flood API requires a KML AOI file.");

  const form = new FormData();
  form.append("kml", kmlBlob, filename || "aoi.kml");

  const res = await fetchWithAbort(
    FLOOD_WATER_URL,
    {
      method: "POST",
      body: form,
      headers: { "ngrok-skip-browser-warning": "true" },
      signal,
    },
    REQUEST_TIMEOUT_MS,
    "catalog",
  );

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
      `Flood API HTTP ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

export async function downloadFloodWaterKml(kmlIdOrUrl) {
  const url = String(kmlIdOrUrl).startsWith("http")
    ? kmlIdOrUrl.replace(/^http:\/\//i, "https://")
    : String(kmlIdOrUrl).startsWith("/")
    ? `${API_BASE.replace(/\/$/, "")}${kmlIdOrUrl}`
    : `${API_BASE.replace(/\/$/, "")}/api/flood-water/kml/${kmlIdOrUrl}`;
  const res = await fetchWithAbort(
    url,
    { method: "GET", headers: { "ngrok-skip-browser-warning": "true" } },
    120_000,
    "scene",
  );
  if (!res.ok) {
    const err = new Error(
      res.status === 404
        ? "This date's flood product has expired on the JalNetra server."
        : `Flood KML download failed (HTTP ${res.status})`,
    );
    err.status = res.status;
    if (res.status === 404) err.code = "EXPIRED";
    throw err;
  }
  return res.text();
}

/**
 * Parse GroundOverlay LatLonBox + PNG data URL from flood KML.
 */
export function parseFloodOverlayKml(kmlText) {
  if (!kmlText || typeof kmlText !== "string") {
    throw new Error("Empty flood KML.");
  }
  
  const polygons = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(kmlText, "text/xml");
    const polyNodes = doc.getElementsByTagName("Polygon");

    const parseCoords = (text) => {
      if (!text) return [];
      const pairs = text.trim().split(/\s+/);
      const coords = [];
      for (const pair of pairs) {
        if (!pair) continue;
        const parts = pair.split(",");
        if (parts.length >= 2) {
          const lon = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          if (Number.isFinite(lon) && Number.isFinite(lat)) {
            coords.push({ lon, lat });
          }
        }
      }
      return coords;
    };
    
    for (let i = 0; i < polyNodes.length; i++) {
      const pNode = polyNodes[i];
      let outerRing = [];
      const outerNodes = pNode.getElementsByTagName("outerBoundaryIs");
      if (outerNodes.length > 0) {
        const cNodes = outerNodes[0].getElementsByTagName("coordinates");
        if (cNodes.length > 0) outerRing = parseCoords(cNodes[0].textContent);
      } else {
        const cNodes = pNode.getElementsByTagName("coordinates");
        if (cNodes.length > 0) outerRing = parseCoords(cNodes[0].textContent);
      }
      
      const holes = [];
      const innerNodes = pNode.getElementsByTagName("innerBoundaryIs");
      for (let j = 0; j < innerNodes.length; j++) {
        const cNodes = innerNodes[j].getElementsByTagName("coordinates");
        if (cNodes.length > 0) {
          const hole = parseCoords(cNodes[0].textContent);
          if (hole.length > 2) holes.push(hole);
        }
      }
      
      if (outerRing.length > 2) {
        polygons.push({ outer: outerRing, holes });
      }
    }
  } catch(e) {
    console.error("Failed to parse KML polygons", e);
  }

  const box = {};
  for (const key of ["north", "south", "east", "west"]) {
    const m = kmlText.match(
      new RegExp(`<(?:\\w+:)?${key}>\\s*([\\d.+-eE]+)\\s*<\\/(?:\\w+:)?${key}>`, "i"),
    );
    if (m) box[key] = Number(m[1]);
  }
  
  if (polygons.length > 0) {
    if (!Number.isFinite(box.north)) {
      let n = -90, s = 90, e = -180, w = 180;
      for (const poly of polygons) {
        for (const pt of poly.outer) {
          if (pt.lat > n) n = pt.lat;
          if (pt.lat < s) s = pt.lat;
          if (pt.lon > e) e = pt.lon;
          if (pt.lon < w) w = pt.lon;
        }
      }
      box.north = n;
      box.south = s;
      box.east = e;
      box.west = w;
    }
  }

  if (polygons.length === 0 && ![box.north, box.south, box.east, box.west].every((n) => Number.isFinite(n))) {
    throw new Error("Flood KML missing valid Polygons or LatLonBox.");
  }

  const hrefM = kmlText.match(
    /<(?:\w+:)?href>\s*(data:image\/png;base64,[^<\s]+)\s*<\/(?:\w+:)?href>/i,
  );
  const imageDataUrl = hrefM ? hrefM[1].trim() : null;

  return {
    north: box.north,
    south: box.south,
    east: box.east,
    west: box.west,
    imageDataUrl,
    polygons,
    text: kmlText
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode flood overlay PNG."));
    img.src = src;
  });
}

function isFloodPixel(r, g, b, a) {
  if (a < 12) return false;
  // Flood water is explicitly indicated in RED in the satellite / KML overlay product.
  // Permanent river water is BLUE (b > r + 15), which is represented by the 3D river mesh.
  // Red pixels strictly represent newly inundated floodwater / water rise.
  if (r >= 95 && r > g * 1.18 && r > b * 1.18) return true;
  if (r >= 120 && r > g + 16 && r > b + 16) return true;
  if (r >= 140 && g <= 130 && b <= 130) return true;
  if (r > 150 && (r - g) > 35 && (r - b) > 35) return true;
  return false;
}

/**
 * Sample flood-class pixels from overlay PNG (API source of truth).
 * Permanent water (blue) is ignored — river mesh already represents it.
 */
export async function sampleFloodRaster(overlay, { aoiPolygons = [], stride = 3 } = {}) {
  const img = await loadImage(overlay.imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const lonSpan = overlay.east - overlay.west;
  const latSpan = overlay.north - overlay.south;
  const step = Math.max(1, stride | 0);
  const samples = [];
  let floodPixels = 0;

  // Area actually mapped by the overlay (full-resolution red pixels × true pixel footprint).
  let rawFloodPx = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (isFloodPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) rawFloodPx += 1;
  }
  const mLat = ((overlay.north - overlay.south) * Math.PI) / 180 * 6371000;
  const mLon =
    ((overlay.east - overlay.west) * Math.PI) / 180 * 6371000 *
    Math.cos((((overlay.north + overlay.south) / 2) * Math.PI) / 180);
  const mappedFloodHa = (rawFloodPx * (mLat * mLon)) / (width * height) / 1e4;

  // Mask at reduced resolution for faster mesh sampling (still smooth at map scale)
  const maskW = Math.min(width, 512);
  const maskH = Math.min(height, 256);
  const rawMask = new Uint8Array(maskW * maskH);
  const sx = width / maskW;
  const sy = height / maskH;

  for (let my = 0; my < maskH; my++) {
    const y0 = Math.floor(my * sy);
    const y1 = Math.min(height, Math.ceil((my + 1) * sy));
    for (let mx = 0; mx < maskW; mx++) {
      const x0 = Math.floor(mx * sx);
      const x1 = Math.min(width, Math.ceil((mx + 1) * sx));
      let on = 0;
      for (let py = y0; py < y1 && !on; py++) {
        for (let px = x0; px < x1 && !on; px++) {
          const i = (py * width + px) * 4;
          if (isFloodPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) {
            on = 1;
          }
        }
      }
      rawMask[my * maskW + mx] = on;
      if (on) floodPixels += 1;
    }
  }

  // Keep exact satellite / API flood footprint without artificial dilation
  const mask = new Float32Array(maskW * maskH);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = rawMask[i];
  }

  // Sparse AOI samples for emptiness check only
  for (let y = 0; y < height; y += step * 2) {
    for (let x = 0; x < width; x += step * 2) {
      const i = (y * width + x) * 4;
      if (!isFloodPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      const lon = overlay.west + ((x + 0.5) / width) * lonSpan;
      const lat = overlay.north - ((y + 0.5) / height) * latSpan;
      if (aoiPolygons.length && !pointInAnyAoi(lon, lat, aoiPolygons)) continue;
      samples.push({ lon, lat });
      if (samples.length > 80) break;
    }
    if (samples.length > 80) break;
  }

  return {
    samples,
    floodPixels,
    mappedFloodHa: Number.isFinite(mappedFloodHa) ? mappedFloodHa : null,
    mask,
    floodMask: mask,
    width: maskW,
    height: maskH,
    overlay,
  };
}

function validateFloodResponse(response) {
  if (!response || typeof response !== "object") {
    throw new Error("Invalid flood API response.");
  }
  if (!Array.isArray(response.datewise) || !response.datewise.length) {
    throw new Error("Flood API returned no datewise scenes.");
  }
}

function buildInfo(response, scene, meta = {}) {
  const info = {
    status: "ready",
    start_date: response.start_date ?? meta.start_date ?? null,
    end_date: response.end_date ?? meta.end_date ?? null,
    scene_date: scene?.date || scene?.post_date || null,
    pre_date: scene?.pre_date ?? null,
    post_date: scene?.post_date ?? null,
    flood_area_ha:
      typeof scene?.flood_area_ha === "number" ? scene.flood_area_ha : null,
    water_area_ha:
      typeof scene?.water_area_ha === "number" ? scene.water_area_ha : null,
    scene_count:
      typeof response.scene_count === "number" ? response.scene_count : null,
    comparison_count:
      typeof response.comparison_count === "number"
        ? response.comparison_count
        : null,
    buffer_m: typeof response.buffer_m === "number" ? response.buffer_m : null,
    categories: Array.isArray(scene?.categories) ? scene.categories : [],
    kml_id: scene?.kml_id ?? null,
    logic: typeof response.logic === "string" ? response.logic : null,
    fromCache: !!meta.fromCache,
    retrievedAt: new Date().toISOString(),
    depth_note: "Depth not supplied by JalNetra Flood API (extent only).",
    max_depth_m: null,
    avg_depth_m: null,
  };
  return info;
}

/** @type {{ status: string, message: string, details: string|null, updatedAt: number }} */
let floodStatus = {
  status: "idle",
  message: "",
  details: null,
  updatedAt: Date.now(),
};

function setFloodStatus(status, message = "", details = null) {
  floodStatus = {
    status,
    message: message || "",
    details: details || null,
    updatedAt: Date.now(),
  };
  return getFloodStatus();
}

/** Live request status for UI (Loading / Preparing KML / …). */
export function getFloodStatus() {
  return { ...floodStatus };
}

/**
 * Normalize JalNetra flood-water JSON into a stable scene list.
 * Does not invent fields — only maps API datewise rows.
 */
export function normalizeFloodResult(response, meta = {}) {
  validateFloodResponse(response);
  
  debug("raw flood response", response);

  const scenes = (response.datewise || [])
    .filter((d) => d?.kml_id)
    .map((d, index) => ({
      index,
      date: d.date || d.post_date || null,
      rawResponse: d,
      waterLevelData: {
        initialWaterSurfaceElevation: typeof d.initial_water_level === "number" ? d.initial_water_level : null,
        finalWaterSurfaceElevation: typeof d.final_water_level === "number" ? d.final_water_level : null,
        waterRise: typeof d.water_rise === "number" ? d.water_rise : null,
        stage: typeof d.stage === "number" ? d.stage : null,
      },
      waterSurfaceProfile: d.water_surface_profile || null,
      floodDepthData: d.depth_data || null,
      floodExtent: {
        waterAreaHa: typeof d.water_area_ha === "number" ? d.water_area_ha : null,
        floodAreaHa: typeof d.flood_area_ha === "number" ? d.flood_area_ha : null,
      },
      floodKML: {
        filename: d.kml_filename || null,
        id: d.kml_id,
        downloadUrl: d.kml_download_url || null,
      },
      sourceMetadata: {
        preDate: d.pre_date || null,
        postDate: d.post_date || null,
        categories: Array.isArray(d.categories) ? d.categories : [],
      },
      status: "NORMALIZED",
      // Legacy UI fallbacks (do not rely on these for physical math)
      pre_date: d.pre_date || null,
      post_date: d.post_date || null,
      flood_area_ha: typeof d.flood_area_ha === "number" ? d.flood_area_ha : null,
      water_area_ha: typeof d.water_area_ha === "number" ? d.water_area_ha : null,
      water_rise: typeof d.water_rise === "number" ? d.water_rise : null,
      final_water_level: typeof d.final_water_level === "number" ? d.final_water_level : null,
      kml_id: d.kml_id,
      kml_filename: d.kml_filename || null,
      kml_download_url: d.kml_download_url || null,
    }));

  if (!scenes.length) {
    throw new Error("Flood API returned no scenes with kml_id.");
  }

  const preferDate = meta.preferDate || meta.end_date || response.end_date;
  let currentScene = scenes.length - 1;
  if (preferDate) {
    let bestScore = Infinity;
    for (let i = 0; i < scenes.length; i++) {
      const d = scenes[i].date || "";
      const score = Math.abs(Date.parse(d) - Date.parse(preferDate)) || 0;
      if (score < bestScore) {
        bestScore = score;
        currentScene = i;
      }
    }
  }

  return {
    start_date: response.start_date || meta.start_date || null,
    end_date: response.end_date || meta.end_date || null,
    buffer_m: typeof response.buffer_m === "number" ? response.buffer_m : null,
    scene_count: response.scene_count ?? scenes.length,
    comparison_count:
      typeof response.comparison_count === "number"
        ? response.comparison_count
        : null,
    notes: response.notes || null,
    logic: response.logic || null,
    scenes,
    currentScene,
    response,
    fromCache: !!meta.fromCache,
  };
}

/** kml_id → downloaded + rasterised flood product (session cache). */
const sceneProducts = new Map();
/** @type {any | null} */
let catalogMemory = null;
/** @type {Promise<any> | null} */
let catalogInflight = null;

function catalogKey(aoiHash) {
  return `${CACHE_PREFIX}-catalog-${aoiHash}`;
}

function dayNumber(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

async function resolveAoi(options = {}) {
  if (!aoiPromise) aoiPromise = loadAoiKml(options.aoiOpts);
  const loaded = options.aoi || (await aoiPromise);
  const prepared = prepareAoiFromKml(loaded.text, { filename: loaded.filename });
  return {
    ...loaded,
    polygons: prepared.polygons,
    geojson: prepared.geojson,
    aoiHash: loaded.aoiHash || hashAoiGeometry(prepared.polygons),
    kmlBlob: prepared.kmlBlob,
    filename: loaded.filename || prepared.filename,
  };
}

/**
 * Availability catalog built only from rows JalNetra actually returned.
 * Dates absent from `scenes` have no Sentinel-1 acquisition in the backend window.
 */
function buildCatalog(response, aoiHash, meta) {
  if (!response || typeof response !== "object") {
    throw new Error("Invalid flood API response.");
  }
  const scenes = (Array.isArray(response.datewise) ? response.datewise : [])
    .filter((d) => d?.kml_id && isValidApiDate(d.date || d.post_date))
    .map((d) => ({
      date: d.date || d.post_date,
      pre_date: d.pre_date || null,
      post_date: d.post_date || null,
      flood_area_ha: typeof d.flood_area_ha === "number" ? d.flood_area_ha : null,
      water_area_ha: typeof d.water_area_ha === "number" ? d.water_area_ha : null,
      categories: Array.isArray(d.categories) ? d.categories : [],
      kml_id: d.kml_id,
      kml_filename: d.kml_filename || null,
      kml_download_url: d.kml_download_url || null,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const gaps = [];
  for (let i = 1; i < scenes.length; i++) {
    gaps.push(dayNumber(scenes[i].date) - dayNumber(scenes[i - 1].date));
  }
  gaps.sort((a, b) => a - b);
  const cadenceDays = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const latestDate = scenes.length ? scenes[scenes.length - 1].date : null;

  return {
    aoiHash,
    windowStart: isValidApiDate(response.start_date) ? response.start_date : null,
    windowEnd: isValidApiDate(response.end_date) ? response.end_date : null,
    fetchedAt: meta.fetchedAt,
    fromCache: !!meta.fromCache,
    scenes,
    earliestDate: scenes.length ? scenes[0].date : null,
    latestDate,
    cadenceDays,
    nextExpectedDate:
      latestDate && cadenceDays ? shiftApiDate(latestDate, cadenceDays) : null,
    bufferM: typeof response.buffer_m === "number" ? response.buffer_m : null,
    logic: typeof response.logic === "string" ? response.logic : null,
    response,
  };
}

export function getFloodSceneForDate(catalog, ymd) {
  return catalog?.scenes?.find((s) => s.date === ymd) || null;
}

/** True when this session already holds the date's flood product (instant load). */
export function hasLoadedFloodProduct(scene) {
  return !!scene?.kml_id && sceneProducts.has(scene.kml_id);
}

export function isFloodCatalogRefreshing() {
  return !!catalogInflight;
}

/**
 * Discover which dates JalNetra has flood products for.
 * `force: false` returns the last known catalog (memory → localStorage) without
 * a network call; `force: true` re-runs POST /api/flood-water, which is the only
 * way the backend publishes new scenes and fresh kml_ids.
 */
export async function fetchFloodCatalog({ force = false, onProgress } = {}) {
  const aoi = await resolveAoi();
  const key = catalogKey(aoi.aoiHash);

  if (!force) {
    if (catalogMemory?.aoiHash === aoi.aoiHash) return catalogMemory;
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "null");
      if (raw?.response) {
        catalogMemory = buildCatalog(raw.response, aoi.aoiHash, {
          fetchedAt: raw.fetchedAt,
          fromCache: true,
        });
        return catalogMemory;
      }
    } catch {
      /* fall through to network */
    }
  }

  if (catalogInflight) return catalogInflight;
  catalogInflight = (async () => {
    onProgress?.("Checking JalNetra for Sentinel-1 flood scenes…");
    let response;
    try {
      response = await postFloodWater({ kmlBlob: aoi.kmlBlob, filename: aoi.filename });
    } catch (err) {
      if (err?.name === "AbortError") throw new Error("Flood catalog request cancelled.");
      throw err;
    }
    const fetchedAt = Date.now();
    try {
      localStorage.setItem(key, JSON.stringify({ response, fetchedAt }));
    } catch (err) {
      debug("catalog cache write failed", err?.message || err);
    }
    catalogMemory = buildCatalog(response, aoi.aoiHash, { fetchedAt, fromCache: false });
    debug("catalog", {
      scenes: catalogMemory.scenes.length,
      window: [catalogMemory.windowStart, catalogMemory.windowEnd],
      latest: catalogMemory.latestDate,
    });
    return catalogMemory;
  })().finally(() => {
    catalogInflight = null;
  });
  return catalogInflight;
}

async function loadSceneProduct(scene, aoi, onProgress) {
  const cached = sceneProducts.get(scene.kml_id);
  if (cached) return cached;
  onProgress?.(`Downloading flood extent for ${scene.date}…`);
  const overlayKml = await downloadFloodWaterKml(scene.kml_download_url || scene.kml_id);
  onProgress?.("Building visualization…");
  const overlay = parseFloodOverlayKml(overlayKml);
  const raster = overlay.imageDataUrl
    ? await sampleFloodRaster(overlay, { aoiPolygons: aoi.polygons, stride: 3 })
    : {
        mask: new Float32Array(0),
        width: 0,
        height: 0,
        fromPolygons: true,
        floodPixels: overlay.polygons.length,
      };
  const product = { overlay, overlayKml, raster };
  sceneProducts.set(scene.kml_id, product);
  return product;
}

function codedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Load exactly one date's flood simulation from the catalog.
 * Throws with `code`:
 *   NOT_IN_CATALOG — JalNetra has no Sentinel-1 scene for this date
 *   EXPIRED        — scene is listed but its KML product expired (regenerate)
 *   NO_FLOOD       — scene exists but contains no flood-class pixels
 */
export async function loadFloodSimulationForDate(ymd, { catalog, onProgress } = {}) {
  const aoi = await resolveAoi();
  const cat = catalog || (await fetchFloodCatalog({ onProgress }));
  const scene = getFloodSceneForDate(cat, ymd);
  if (!scene) {
    throw codedError(`JalNetra has no Sentinel-1 flood scene for ${ymd}.`, "NOT_IN_CATALOG");
  }
  const { overlay, overlayKml, raster } = await loadSceneProduct(scene, aoi, onProgress);
  if (!raster?.floodPixels) {
    throw codedError(
      `Sentinel-1 shows no flood-class pixels on ${ymd}` +
        (scene.water_area_ha != null ? ` (water ${scene.water_area_ha.toFixed(1)} ha).` : "."),
      "NO_FLOOD",
    );
  }

  const fullScene = { ...scene, index: 0, overlay, overlayKml, raster };
  const info = buildInfo(cat.response, fullScene, { fromCache: cat.fromCache });
  info.source = "Sentinel-1 VH change detection · JalNetra Flood API";
  info.catalog_updated_at = cat.fetchedAt ? new Date(cat.fetchedAt).toISOString() : null;
  info.current_scene = 1;
  info.total_scenes = 1;

  return {
    aoi,
    response: cat.response,
    scene: fullScene,
    scenes: [fullScene],
    currentScene: 0,
    overlay,
    overlayKml,
    raster,
    info,
    catalog: cat,
    depthAvailable: false,
    disclaimer: "Flood extent generated from JalNetra Flood API results.",
  };
}

/**
 * Regenerate an expired date: re-run the backend processing (fresh kml_ids for
 * every scene in its window), then load the date only if it is still listed.
 */
export async function regenerateFloodSimulationForDate(ymd, { onProgress } = {}) {
  onProgress?.("Regenerating flood products on JalNetra…");
  const cat = await fetchFloodCatalog({ force: true, onProgress });
  if (!getFloodSceneForDate(cat, ymd)) {
    throw codedError(
      `After regeneration JalNetra no longer lists a Sentinel-1 scene for ${ymd}.`,
      "NOT_IN_CATALOG",
    );
  }
  return loadFloodSimulationForDate(ymd, { catalog: cat, onProgress });
}

/**
 * Compat entry used by window.__MM_FLOOD__.run: loads the requested (or latest)
 * catalog date, regenerating once if its cached product has expired.
 */
export async function runFloodSimulation(options = {}) {
  setFloodStatus("loading", "Preparing KML…");
  const onProgress = (msg) => {
    options.onProgress?.(msg);
    setFloodStatus("running", msg || "Analysing flood conditions…");
  };
  try {
    const result = await fetchJalnetraFlood({ ...options, onProgress });
    setFloodStatus("ready", "Flood Ready");
    return result;
  } catch (err) {
    if (err?.name === "AbortError" || /cancel/i.test(err?.message || "")) {
      setFloodStatus("idle", "");
      throw err;
    }
    setFloodStatus("error", "Flood simulation could not be completed.", err?.message || String(err));
    throw err;
  }
}

export async function fetchJalnetraFlood(options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  onProgress?.("Preparing KML…");
  const catalog = await fetchFloodCatalog({ force: !!options.skipCache, onProgress });
  if (!catalog.scenes.length) {
    throw codedError("JalNetra returned no Sentinel-1 flood scenes for this AOI.", "NOT_IN_CATALOG");
  }
  const want = options.date || options.preferDate;
  const date = getFloodSceneForDate(catalog, want)?.date || catalog.latestDate;
  try {
    return await loadFloodSimulationForDate(date, { catalog, onProgress });
  } catch (err) {
    if (err?.code === "EXPIRED" && catalog.fromCache) {
      return regenerateFloodSimulationForDate(date, { onProgress });
    }
    throw err;
  }
}

/** @deprecated Prefer runFloodSimulation */
export const fetchFloodSimulation = (...args) => runFloodSimulation(...args);

export { FLOOD_WATER_URL, API_BASE };
