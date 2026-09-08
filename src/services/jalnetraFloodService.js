/**
 * JalNetra Flood Water API client — MODE A (API flood simulation).
 *
 * Exact OpenAPI contract (POST /api/flood-water):
 *   multipart/form-data
 *   - kml: file (application/octet-stream) — required
 *   - start_date: string YYYY-MM-DD — required
 *   - end_date: string YYYY-MM-DD — required
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
 *
 * Empty Sentinel coverage → HTTP 404.
 */

import { formatApiDate } from "../utils/dateRange.js";
import { loadAoiKml, pointInAnyAoi, hashAoiGeometry } from "../geo/aoiKml.js";
import { prepareAoiFromKml } from "../utils/kmlToGeoJSON.js";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_JALNETRA_API_BASE) ||
  "https://jalnetra-software-production.up.railway.app";

const FLOOD_WATER_URL = `${API_BASE.replace(/\/$/, "")}/api/flood-water`;
const CACHE_PREFIX = "jalnetra-flood-v1";
const REQUEST_TIMEOUT_MS = 300_000;
const MAX_WIDEN_DAYS = 75;

/** @type {Map<string, any>} */
const memoryResults = new Map();
/** @type {Map<string, string>} */
const overlayKmlById = new Map();
/** @type {Promise<any> | null} */
let aoiPromise = null;

const isDev = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

/** @type {AbortController | null} */
let activeController = null;

function debug(...args) {
  if (isDev) console.info("[jalnetra-flood]", ...args);
}

function cacheKey(aoiHash, startDate, endDate) {
  return `${CACHE_PREFIX}-${aoiHash}-${startDate}-${endDate}`;
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

export function cancelJalnetraFloodRequest() {
  if (activeController) {
    activeController.abort();
    activeController = null;
  }
}

/** @deprecated alias */
export const cancelFloodSimulationRequest = cancelJalnetraFloodRequest;

async function fetchWithAbort(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  cancelJalnetraFloodRequest();
  const ctrl = new AbortController();
  activeController = ctrl;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const { signal: _ignored, ...rest } = options;
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (activeController === ctrl) activeController = null;
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
export async function postFloodWater({ kmlBlob, filename, start_date, end_date, signal }) {
  if (!kmlBlob) throw new Error("Flood API requires a KML AOI file.");
  if (!isValidApiDate(start_date) || !isValidApiDate(end_date)) {
    throw new Error("Invalid date. Use YYYY-MM-DD for start and end.");
  }
  if (start_date > end_date) {
    throw new Error("Start date must be on or before end date.");
  }

  const form = new FormData();
  form.append("kml", kmlBlob, filename || "aoi.kml");
  form.append("start_date", start_date);
  form.append("end_date", end_date);

  const res = await fetchWithAbort(
    FLOOD_WATER_URL,
    {
      method: "POST",
      body: form,
      headers: { "ngrok-skip-browser-warning": "true" },
      signal,
    },
    REQUEST_TIMEOUT_MS,
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
    : `${API_BASE.replace(/\/$/, "")}/api/flood-water/kml/${kmlIdOrUrl}`;
  const res = await fetchWithAbort(
    url,
    { method: "GET", headers: { "ngrok-skip-browser-warning": "true" } },
    120_000,
  );
  if (!res.ok) throw new Error(`Flood KML download failed (HTTP ${res.status})`);
  return res.text();
}

/**
 * Parse GroundOverlay LatLonBox + PNG data URL from flood KML.
 */
export function parseFloodOverlayKml(kmlText) {
  if (!kmlText || typeof kmlText !== "string") {
    throw new Error("Empty flood KML.");
  }
  const box = {};
  for (const key of ["north", "south", "east", "west"]) {
    const m = kmlText.match(
      new RegExp(`<(?:\\w+:)?${key}>\\s*([\\d.+-eE]+)\\s*<\\/(?:\\w+:)?${key}>`, "i"),
    );
    if (m) box[key] = Number(m[1]);
  }
  if (![box.north, box.south, box.east, box.west].every((n) => Number.isFinite(n))) {
    throw new Error("Flood overlay KML missing LatLonBox.");
  }

  const hrefM = kmlText.match(
    /<(?:\w+:)?href>\s*(data:image\/png;base64,[^<\s]+)\s*<\/(?:\w+:)?href>/i,
  );
  if (!hrefM) throw new Error("Flood overlay KML missing PNG GroundOverlay.");

  return {
    north: box.north,
    south: box.south,
    east: box.east,
    west: box.west,
    imageDataUrl: hrefM[1].trim(),
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
  // API Flood ≈ #FF0000 (allow anti-alias / compression)
  if (r >= 140 && r > g + 35 && r > b + 35) return true;
  // Some exports use bright magenta-red
  if (r >= 160 && g <= 100 && b <= 120 && r >= g && r >= b) return true;
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

  // Mask at reduced resolution for faster mesh sampling (still smooth at map scale)
  const maskW = Math.min(width, 512);
  const maskH = Math.min(height, 256);
  const mask = new Float32Array(maskW * maskH);
  const sx = width / maskW;
  const sy = height / maskH;

  for (let my = 0; my < maskH; my++) {
    const y0 = Math.min(height - 1, Math.floor(my * sy));
    for (let mx = 0; mx < maskW; mx++) {
      const x0 = Math.min(width - 1, Math.floor(mx * sx));
      const i = (y0 * width + x0) * 4;
      const on = isFloodPixel(data[i], data[i + 1], data[i + 2], data[i + 3]) ? 1 : 0;
      mask[my * maskW + mx] = on;
      if (on) floodPixels += 1;
    }
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
    mask,
    width: maskW,
    height: maskH,
    overlay,
  };
}

function isNoScenesError(err) {
  return /no sentinel|no scenes|not found/i.test(err?.message || "");
}

function validateFloodResponse(response) {
  if (!response || typeof response !== "object") {
    throw new Error("Invalid flood API response.");
  }
  if (!Array.isArray(response.datewise) || !response.datewise.length) {
    throw new Error("Flood API returned no datewise scenes.");
  }
}

function pickBestScene(datewise, preferDate) {
  const list = Array.isArray(datewise) ? datewise.filter((d) => d?.kml_id) : [];
  if (!list.length) return null;
  if (!preferDate) return list[list.length - 1];
  let best = list[0];
  let bestScore = Infinity;
  for (const row of list) {
    const d = row.date || row.post_date || "";
    const score = Math.abs(Date.parse(d) - Date.parse(preferDate)) || 0;
    if (score < bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best;
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
  const scenes = (response.datewise || [])
    .filter((d) => d?.kml_id)
    .map((d, index) => ({
      index,
      date: d.date || d.post_date || null,
      pre_date: d.pre_date || null,
      post_date: d.post_date || null,
      flood_area_ha:
        typeof d.flood_area_ha === "number" ? d.flood_area_ha : null,
      water_area_ha:
        typeof d.water_area_ha === "number" ? d.water_area_ha : null,
      categories: Array.isArray(d.categories) ? d.categories : null,
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

async function hydrateSceneRaster(scene, aoi, onProgress) {
  const kmlId = scene.kml_id;
  onProgress?.(`Receiving flood extent… (${scene.date || kmlId})`);

  let overlayKml = overlayKmlById.get(kmlId) || null;
  if (!overlayKml) {
    overlayKml = await downloadFloodWaterKml(kmlId);
    overlayKmlById.set(kmlId, overlayKml);
  }

  const memByKml = [...memoryResults.values()].find(
    (r) => r?.scene?.kml_id === kmlId && r?.overlay && r?.raster,
  );
  let overlay = memByKml?.overlay || scene.overlay;
  let raster = memByKml?.raster || scene.raster;
  if (!overlay || !raster) {
    onProgress?.("Building visualization…");
    overlay = parseFloodOverlayKml(overlayKml);
    raster = await sampleFloodRaster(overlay, {
      aoiPolygons: aoi.polygons,
      stride: 3,
    });
  }

  return {
    ...scene,
    overlay,
    overlayKml,
    raster,
  };
}

/**
 * Primary entry: original AOI KML → JalNetra → normalized multi-scene result.
 */
export async function runFloodSimulation(options = {}) {
  setFloodStatus("loading", "Preparing KML…");
  try {
    const onProgress = (msg) => {
      options.onProgress?.(msg);
      const lower = String(msg || "").toLowerCase();
      if (lower.includes("preparing") || lower.includes("aoi") || lower.includes("kml")) {
        setFloodStatus("loading", msg || "Preparing KML…");
      } else if (lower.includes("contact") || lower.includes("analys") || lower.includes("widen")) {
        setFloodStatus("running", msg || "Analysing flood conditions…");
      } else if (lower.includes("receiv") || lower.includes("download") || lower.includes("overlay")) {
        setFloodStatus("running", msg || "Receiving flood extent…");
      } else if (lower.includes("build") || lower.includes("sampl") || lower.includes("visual")) {
        setFloodStatus("running", msg || "Building visualization…");
      } else {
        setFloodStatus("running", msg || "Analysing flood conditions…");
      }
    };

    const result = await fetchJalnetraFlood({
      ...options,
      onProgress,
      loadAllScenes: options.loadAllScenes !== false,
    });
    setFloodStatus("ready", "Flood Ready");
    return result;
  } catch (err) {
    if (err?.name === "AbortError" || /cancel/i.test(err?.message || "")) {
      setFloodStatus("idle", "");
      throw err;
    }
    setFloodStatus(
      "error",
      "Flood simulation could not be completed.",
      err?.message || String(err),
    );
    throw err;
  }
}

/**
 * Full pipeline: Mula–Mutha AOI KML → JalNetra Flood API → overlay → flood mask.
 * Synchronous HTTP. Caches by AOI hash + date range.
 * Returns multi-scene payload when loadAllScenes is true (default).
 */
export async function fetchJalnetraFlood(options = {}) {
  let start_date = options.start_date || options.startDate;
  let end_date = options.end_date || options.endDate;
  const preferDate = options.preferDate || end_date;
  const autoWiden = options.autoWiden !== false;
  const loadAllScenes = options.loadAllScenes !== false;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

  if (!isValidApiDate(start_date) || !isValidApiDate(end_date)) {
    throw new Error("Invalid date. Use YYYY-MM-DD for start and end.");
  }
  if (start_date > end_date) {
    throw new Error("Start date must be on or before end date.");
  }

  onProgress?.("Preparing KML…");
  if (!aoiPromise) aoiPromise = loadAoiKml(options.aoiOpts);
  const loaded = options.aoi || (await aoiPromise);

  const prepared = prepareAoiFromKml(loaded.text, { filename: loaded.filename });
  const aoi = {
    ...loaded,
    polygons: prepared.polygons,
    geojson: prepared.geojson,
    aoiHash: loaded.aoiHash || hashAoiGeometry(prepared.polygons),
    kmlBlob: prepared.kmlBlob,
  };
  const key = cacheKey(aoi.aoiHash, start_date, end_date);

  debug("AOI", {
    url: aoi.url,
    filename: aoi.filename,
    polygons: aoi.polygons.length,
    aoiHash: aoi.aoiHash,
  });
  debug("date range", { start_date, end_date, preferDate, autoWiden });

  if (!options.skipCache && memoryResults.has(key)) {
    debug("memory hit", key);
    onProgress?.("Using cached flood…");
    const hit = memoryResults.get(key);
    return {
      ...hit,
      info: buildInfo(hit.response, hit.scene, {
        start_date,
        end_date,
        fromCache: true,
      }),
    };
  }

  async function finalizeMulti(response, meta) {
    const normalized = normalizeFloodResult(response, {
      ...meta,
      preferDate,
    });
    onProgress?.("Receiving flood extent…");

    const hydrated = [];
    for (let i = 0; i < normalized.scenes.length; i++) {
      if (!loadAllScenes && i !== normalized.currentScene) {
        hydrated.push({ ...normalized.scenes[i] });
        continue;
      }
      const scene = await hydrateSceneRaster(normalized.scenes[i], aoi, onProgress);
      hydrated.push(scene);
    }

    let currentScene = normalized.currentScene;
    if (!hydrated[currentScene]?.raster?.floodPixels) {
      const alt = hydrated.findIndex((s) => s.raster?.floodPixels > 0);
      if (alt >= 0) currentScene = alt;
    }

    const active = hydrated[currentScene];
    if (!active?.overlay || !active?.raster) {
      throw new Error("Flood overlay contained no usable flood geometry.");
    }
    if (!active.raster.floodPixels) {
      throw new Error("Flood overlay contained no flood-class pixels.");
    }

    const info = buildInfo(response, active, {
      start_date: meta.start_date ?? start_date,
      end_date: meta.end_date ?? end_date,
      fromCache: !!meta.fromCache,
    });
    info.scene_count = normalized.scene_count;
    info.comparison_count = normalized.comparison_count;
    info.buffer_m = normalized.buffer_m;
    info.current_scene = currentScene + 1;
    info.total_scenes = hydrated.length;

    const result = {
      aoi,
      response,
      scene: active,
      scenes: hydrated,
      currentScene,
      overlay: active.overlay,
      overlayKml: active.overlayKml,
      raster: active.raster,
      info,
      normalized,
      depthAvailable: false,
      disclaimer: "Flood extent generated from JalNetra Flood API results.",
    };
    memoryResults.set(key, result);
    return result;
  }

  const cached = options.skipCache ? null : readCache(key);
  if (cached?.response?.datewise?.length) {
    debug("storage cache hit", key);
    return finalizeMulti(cached.response, {
      fromCache: true,
      start_date: cached.start_date || start_date,
      end_date: cached.end_date || end_date,
    });
  }

  const kmlBlob = aoi.kmlBlob || prepared.kmlBlob;
  let response = null;
  let usedStart = start_date;
  let lastErr = null;
  const widenSteps = autoWiden ? Math.ceil(MAX_WIDEN_DAYS / 15) : 0;

  for (let step = 0; step <= widenSteps; step++) {
    if (step > 0) {
      usedStart = shiftApiDate(start_date, -15 * step);
      debug("widening start_date", { usedStart, end_date, step });
    }
    onProgress?.(
      step === 0
        ? "Analysing flood conditions…"
        : `Widening date range for Sentinel-1 (attempt ${step + 1})…`,
    );
    try {
      response = await postFloodWater({
        kmlBlob,
        filename: aoi.filename || prepared.filename,
        start_date: usedStart,
        end_date,
      });
      start_date = usedStart;
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (err?.name === "AbortError") throw new Error("Flood simulation cancelled.");
      if (!isNoScenesError(err) || step === widenSteps) throw err;
    }
  }
  if (!response) throw lastErr || new Error("Flood API unavailable.");

  validateFloodResponse(response);

  writeCache(key, {
    response,
    scene: pickBestScene(response.datewise, preferDate),
    start_date,
    end_date,
    aoiHash: aoi.aoiHash,
    cachedAt: Date.now(),
  });

  return finalizeMulti(response, {
    fromCache: false,
    start_date,
    end_date,
  });
}

/** @deprecated Prefer runFloodSimulation */
export const fetchFloodSimulation = (...args) => runFloodSimulation(...args);

export { FLOOD_WATER_URL, API_BASE };
