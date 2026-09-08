/**
 * Dynamic AOI KML parsing for Vegetation Type API uploads.
 * Supports Polygon, MultiPolygon-like MultiGeometry, and nested LinearRings.
 */

const DEFAULT_AOI_URL = `/data/${encodeURIComponent("Mula_Mutha_AOI_Polygon(1).kml")}`;
const AOI_FALLBACKS = [
  "/data/Mula_MuthaAOI_2.kml",
  `/data/${encodeURIComponent("Mula_MuthaAOI(2).kml")}`,
  "/data/Mula_MuthaAOI.kml",
];

function parseCoords(raw) {
  return String(raw)
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const parts = tok.split(",");
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return { lon, lat };
    })
    .filter(Boolean);
}

function ringsFromPolygonBlock(block) {
  const rings = [];
  const coordsBlocks = [...block.matchAll(/<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/gi)];
  for (const m of coordsBlocks) {
    const pts = parseCoords(m[1]);
    if (pts.length >= 4) rings.push(pts);
  }
  return rings;
}

/**
 * Extract outer rings from KML text (Polygon / MultiGeometry).
 * @returns {{ lon: number, lat: number }[][]}
 */
export function extractAoiPolygonsFromKml(text) {
  if (!text || typeof text !== "string") return [];
  const polygons = [];
  const polyBlocks = [...text.matchAll(/<(?:\w+:)?Polygon\b[\s\S]*?<\/(?:\w+:)?Polygon>/gi)];
  for (const block of polyBlocks) {
    const rings = ringsFromPolygonBlock(block[0]);
    // First ring = outer boundary for our AOI use
    if (rings[0]) polygons.push(rings[0]);
  }
  return polygons;
}

export function validateAoiPolygons(polygons) {
  if (!polygons?.length) {
    return { ok: false, error: "No Polygon / MultiGeometry found in KML AOI." };
  }
  for (let i = 0; i < polygons.length; i++) {
    const ring = polygons[i];
    if (!ring || ring.length < 4) {
      return { ok: false, error: `AOI polygon ${i} has fewer than 4 vertices.` };
    }
    for (const p of ring) {
      if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) {
        return { ok: false, error: `AOI polygon ${i} has invalid coordinates.` };
      }
      if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) {
        return { ok: false, error: `AOI polygon ${i} coordinates out of range.` };
      }
    }
  }
  return { ok: true };
}

/** Stable short hash of AOI geometry for cache keys. */
export function hashAoiGeometry(polygons) {
  let h = 2166136261;
  const push = (n) => {
    const v = Math.round(n * 1e6);
    h ^= v + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h, 16777619);
  };
  for (const ring of polygons || []) {
    push(ring.length);
    for (const p of ring) {
      push(p.lon);
      push(p.lat);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function pointInLonLatRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon;
    const yi = ring[i].lat;
    const xj = ring[j].lon;
    const yj = ring[j].lat;
    const hit = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-18) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export function pointInAnyAoi(lon, lat, polygons) {
  for (const ring of polygons || []) {
    if (pointInLonLatRing(lon, lat, ring)) return true;
  }
  return false;
}

/**
 * Load AOI KML text + parsed polygons. Prefer Mula_Mutha_AOI_Polygon(1).kml.
 */
export async function loadAoiKml(opts = {}) {
  const urls = [opts.url || DEFAULT_AOI_URL, ...(opts.fallbacks || AOI_FALLBACKS)];
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      const polygons = extractAoiPolygonsFromKml(text);
      const validation = validateAoiPolygons(polygons);
      if (!validation.ok) throw new Error(validation.error);
      const filename =
        decodeURIComponent(String(url).split("/").pop() || "aoi.kml") || "aoi.kml";
      return {
        url,
        filename,
        text,
        polygons,
        aoiHash: hashAoiGeometry(polygons),
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Unable to load AOI KML.");
}

export { DEFAULT_AOI_URL, AOI_FALLBACKS };
