/**
 * JalNetra Water Depth API — original SAR water extent + relative depth.
 *
 * OpenAPI: POST /api/water-depth
 *   multipart: kml (required), depth_min_m, depth_max_m
 * Docs: https://jalnetra-software-production.up.railway.app/docs#/default/water_depth_api_water_depth_post
 *
 * Response:
 *   permanent_water.{kml_id,kml_download_url} — blue Sentinel-1 SAR water
 *   depth.{kml_id, min_m, max_m, mean_m, …} — Sentinel-2 relative depth overlay
 *
 * Depth scale for JalNetra POST /api/water-depth:
 *   min = 1.69 m (survey floor) · max = 3.0 m (requested scale)
 */

import { loadAoiKml, hashAoiGeometry } from "../geo/aoiKml.js";
import { localToLonLat } from "../geo/geoReference.js";
import { parseFloodOverlayKml } from "./jalnetraFloodService.js";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_JALNETRA_API_BASE) ||
  "https://jalnetra-software-production.up.railway.app";

const WATER_DEPTH_URL = `${API_BASE.replace(/\/$/, "")}/api/water-depth`;

/** Depth scale sent to JalNetra water-depth API. */
export const SURVEY_DEPTH_MIN_M = 1.69;
export const SURVEY_DEPTH_MAX_M = 3.0;

const CACHE_PREFIX = "jalnetra-water-depth-v2";
const REQUEST_TIMEOUT_MS = 300_000;

const isDev = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

function debug(...args) {
  if (isDev) console.info("[jalnetra-water-depth]", ...args);
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

function cacheKey(aoiHash, minM, maxM) {
  return `${CACHE_PREFIX}-${aoiHash}-${minM}-${maxM}`;
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
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

/**
 * Prefer the river boundary KML, then AOI polygon fallbacks.
 */
export async function loadMulaMuthaRiverKml() {
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  const urls = [
    `${base}data/mula_mutha_river.kml`,
    `${base}data/${encodeURIComponent("Mula_Mutha_AOI_Polygon(1).kml")}`,
    `${base}data/Mula_MuthaAOI_2.kml`,
  ];
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.length < 200) throw new Error("empty KML");
      const filename = decodeURIComponent(url.split("/").pop() || "mula_mutha.kml");
      return { text, filename, url };
    } catch (err) {
      lastErr = err;
    }
  }
  // Shared AOI loader as last resort
  const aoi = await loadAoiKml();
  return {
    text: aoi.text,
    filename: "Mula_Mutha_AOI.kml",
    url: aoi.url,
    polygons: aoi.polygons,
  };
}

/**
 * POST /api/water-depth with survey min/max depth scale.
 */
export async function postWaterDepth({
  kmlBlob,
  filename,
  depth_min_m = SURVEY_DEPTH_MIN_M,
  depth_max_m = SURVEY_DEPTH_MAX_M,
} = {}) {
  if (!kmlBlob) throw new Error("Water-depth API requires a KML file.");
  const form = new FormData();
  form.append("kml", kmlBlob, filename || "mula_mutha.kml");
  form.append("depth_min_m", String(depth_min_m));
  form.append("depth_max_m", String(depth_max_m));

  const res = await fetchWithTimeout(WATER_DEPTH_URL, {
    method: "POST",
    body: form,
    headers: { "ngrok-skip-browser-warning": "true" },
  });

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { detail: text };
  }
  if (!res.ok) {
    const detail =
      (typeof body?.detail === "string" && body.detail) ||
      (Array.isArray(body?.detail) && body.detail.map((d) => d.msg).join("; ")) ||
      `Water-depth API HTTP ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function downloadWaterDepthKml(kmlIdOrUrl) {
  const url = String(kmlIdOrUrl).startsWith("http")
    ? kmlIdOrUrl.replace(/^http:\/\//i, "https://")
    : String(kmlIdOrUrl).startsWith("/")
      ? `${API_BASE.replace(/\/$/, "")}${kmlIdOrUrl}`
      : `${API_BASE.replace(/\/$/, "")}/api/water-depth/kml/${kmlIdOrUrl}`;
  const res = await fetchWithTimeout(
    url,
    { method: "GET", headers: { "ngrok-skip-browser-warning": "true" } },
    120_000,
  );
  if (!res.ok) {
    const err = new Error(
      res.status === 404
        ? "Water-depth KML expired on JalNetra — re-run POST /api/water-depth."
        : `Water-depth KML download failed (HTTP ${res.status})`,
    );
    err.status = res.status;
    throw err;
  }
  return res.text();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode water-depth overlay PNG."));
    img.src = src;
  });
}

/** Blue permanent/SAR water pixel (matches JalNetra permanent_water legend #0000FF). */
function isPermanentWaterPixel(r, g, b, a) {
  if (a < 20) return false;
  // Strong blue channel, not flood-red
  if (b >= 90 && b > r + 20 && b >= g) return true;
  if (b >= 70 && r <= 40 && g <= 80) return true;
  return false;
}

/**
 * Relative depth from green→yellow→orange→red depth overlay.
 * Returns null for non-water / transparent.
 */
function depthFromPixel(r, g, b, a, minM, maxM) {
  if (a < 20) return null;
  // Skip pure blue permanent-water legend if present on depth sheet
  if (b > r + 40 && b > g + 20 && r < 60) return (minM + maxM) * 0.5;
  // Map hue-ish: green (low) → yellow → orange → red (high)
  const span = Math.max(0.05, maxM - minM);
  let t = 0.5;
  if (g >= r && g >= b) {
    // green → yellow continuum
    t = r > 40 ? 0.25 + (r / 255) * 0.25 : 0.05 + (g / 255) * 0.2;
  } else if (r >= g && r >= b) {
    // orange/red
    t = 0.55 + (1 - g / 255) * 0.4;
  } else {
    t = 0.45;
  }
  t = Math.max(0, Math.min(1, t));
  return minM + t * span;
}

/**
 * Build a lon/lat water + depth sampler from permanent_water + depth GroundOverlays.
 */
export async function buildWaterDepthMask(permanentOverlay, depthOverlay, meta = {}) {
  const minM = Number(meta.min_m) || SURVEY_DEPTH_MIN_M;
  const maxM = Number(meta.max_m) || SURVEY_DEPTH_MAX_M;

  const waterImg = await loadImage(permanentOverlay.imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = waterImg.width;
  canvas.height = waterImg.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(waterImg, 0, 0);
  const waterData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  let depthData = null;
  let depthW = 0;
  let depthH = 0;
  if (depthOverlay?.imageDataUrl) {
    const depthImg = await loadImage(depthOverlay.imageDataUrl);
    depthW = depthImg.width;
    depthH = depthImg.height;
    const dc = document.createElement("canvas");
    dc.width = depthW;
    dc.height = depthH;
    const dctx = dc.getContext("2d", { willReadFrequently: true });
    dctx.drawImage(depthImg, 0, 0);
    depthData = dctx.getImageData(0, 0, depthW, depthH).data;
  }

  const { north, south, east, west } = permanentOverlay;
  const w = canvas.width;
  const h = canvas.height;
  const lonSpan = east - west || 1e-9;
  const latSpan = north - south || 1e-9;

  let waterPixels = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (isPermanentWaterPixel(waterData[o], waterData[o + 1], waterData[o + 2], waterData[o + 3])) {
      waterPixels += 1;
    }
  }

  function sampleAtLonLat(lon, lat) {
    if (!(lon >= west && lon <= east && lat >= south && lat <= north)) {
      return { water: false, depth_m: null };
    }
    const u = (lon - west) / lonSpan;
    const v = (north - lat) / latSpan;
    const ix = Math.max(0, Math.min(w - 1, Math.floor(u * w)));
    const iy = Math.max(0, Math.min(h - 1, Math.floor(v * h)));
    const o = (iy * w + ix) * 4;
    const water = isPermanentWaterPixel(
      waterData[o],
      waterData[o + 1],
      waterData[o + 2],
      waterData[o + 3],
    );
    let depth_m = null;
    if (water && depthData) {
      const dx = Math.max(0, Math.min(depthW - 1, Math.floor(u * depthW)));
      const dy = Math.max(0, Math.min(depthH - 1, Math.floor(v * depthH)));
      const od = (dy * depthW + dx) * 4;
      depth_m = depthFromPixel(
        depthData[od],
        depthData[od + 1],
        depthData[od + 2],
        depthData[od + 3],
        minM,
        maxM,
      );
    } else if (water) {
      depth_m = (minM + maxM) * 0.5;
    }
    return { water, depth_m };
  }

  return {
    north,
    south,
    east,
    west,
    waterPixels,
    min_m: minM,
    max_m: maxM,
    isWaterAtLonLat: (lon, lat) => sampleAtLonLat(lon, lat).water,
    isWaterAtLocal: (x, z) => {
      const ll = localToLonLat(x, z);
      return sampleAtLonLat(ll.lon, ll.lat).water;
    },
    depthAtLocal: (x, z) => {
      const ll = localToLonLat(x, z);
      return sampleAtLonLat(ll.lon, ll.lat).depth_m;
    },
    sampleAtLonLat,
  };
}

/**
 * Full pipeline: load Mula–Mutha KML → POST water-depth → mask.
 * Cached in localStorage by AOI hash + depth range (KML ids; re-download overlays).
 */
export async function fetchJalnetraWaterDepth(opts = {}) {
  const depthMin = Number(opts.depth_min_m) || SURVEY_DEPTH_MIN_M;
  const depthMax = Number(opts.depth_max_m) || SURVEY_DEPTH_MAX_M;

  const kmlInfo = await loadMulaMuthaRiverKml();
  let aoiHash = "river";
  try {
    const aoi = await loadAoiKml();
    aoiHash = hashAoiGeometry(aoi.polygons) || "river";
  } catch {
    /* ignore */
  }

  const key = cacheKey(aoiHash, depthMin, depthMax);
  let meta = opts.force ? null : readCache(key);

  if (!meta?.permanent_water?.kml_id || !meta?.depth?.kml_id) {
    const blob = new Blob([kmlInfo.text], { type: "application/octet-stream" });
    debug("POST water-depth", { depthMin, depthMax, file: kmlInfo.filename });
    meta = await postWaterDepth({
      kmlBlob: blob,
      filename: kmlInfo.filename,
      depth_min_m: depthMin,
      depth_max_m: depthMax,
    });
    writeCache(key, {
      permanent_water: meta.permanent_water,
      depth: meta.depth,
      water_area_ha: meta.water_area_ha,
      input_depth_range_m: meta.input_depth_range_m,
      analysis_date: meta.analysis_date,
      image_date: meta.image_date,
      sentinel1_image_date: meta.sentinel1_image_date,
      sentinel2_image_date: meta.sentinel2_image_date,
      legend: meta.legend,
      cachedAt: new Date().toISOString(),
    });
  } else {
    debug("using cached water-depth meta", meta.analysis_date || meta.cachedAt);
  }

  const [permText, depthText] = await Promise.all([
    downloadWaterDepthKml(meta.permanent_water.kml_id || meta.permanent_water.kml_download_url),
    downloadWaterDepthKml(meta.depth.kml_id || meta.depth.kml_download_url),
  ]);

  const permanentOverlay = parseFloodOverlayKml(permText);
  const depthOverlay = parseFloodOverlayKml(depthText);
  if (!permanentOverlay.imageDataUrl) {
    throw new Error("Permanent water KML missing GroundOverlay PNG.");
  }

  const mask = await buildWaterDepthMask(permanentOverlay, depthOverlay, {
    min_m: meta.depth?.min_m ?? depthMin,
    max_m: meta.depth?.max_m ?? depthMax,
  });

  const result = {
    mask,
    meta,
    permanentOverlay,
    depthOverlay,
    depth_min_m: depthMin,
    depth_max_m: depthMax,
    water_area_ha: meta.water_area_ha ?? null,
    provenance: {
      source: "JALNETRA_WATER_DEPTH",
      permanent: `Sentinel-1 SAR permanent water (${meta.sentinel1_image_date || meta.permanent_water?.kml_filename || "n/a"})`,
      depth: `Sentinel-2 relative depth (${meta.sentinel2_image_date || meta.depth?.kml_filename || "n/a"})`,
      scale: `depth_min_m=${depthMin}, depth_max_m=${depthMax} (survey CSV range)`,
      note: "Depth overlay is relative band-ratio — not survey-grade bathymetry. Extent is live SAR water.",
    },
  };

  console.info("[jalnetra-water-depth] ready", {
    water_area_ha: result.water_area_ha,
    waterPixels: mask.waterPixels,
    depth: { min: mask.min_m, max: mask.max_m, api: meta.depth },
    dates: {
      s1: meta.sentinel1_image_date,
      s2: meta.sentinel2_image_date,
    },
  });

  return result;
}
