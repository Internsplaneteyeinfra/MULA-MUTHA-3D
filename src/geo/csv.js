import { lonLatToUtm } from "./projection.js";

export async function loadDepthCsv(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load CSV (${res.status})`);
  const text = await res.text();
  onProgress?.(0.28, "Parsing depth samples…");

  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const iLat = header.indexOf("latitude");
  const iLon = header.indexOf("longitude");
  const iDepth = header.indexOf("depth_m");
  if (iLat < 0 || iLon < 0 || iDepth < 0) {
    throw new Error("CSV requires latitude, longitude, depth_m");
  }

  const points = [];
  let minD = Infinity;
  let maxD = -Infinity;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const lat = Number(cols[iLat]);
    const lon = Number(cols[iLon]);
    const depth = Number(cols[iDepth]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(depth) || depth <= 0) continue;
    const utm = lonLatToUtm(lon, lat);
    points.push({
      id: points.length,
      lat,
      lon,
      depth,
      easting: utm.easting,
      northing: utm.northing,
    });
    minD = Math.min(minD, depth);
    maxD = Math.max(maxD, depth);
  }

  return { points, minDepth: minD, maxDepth: maxD };
}

/**
 * Parse river-bank polygon CSV: vertex_id,longitude,latitude,altitude
 * Coordinates are WGS84 lon/lat — same order as KML. Does not invent points.
 */
export function parseRiverBoundaryCsv(text) {
  if (!text || /<!DOCTYPE html>/i.test(text) || /<html[\s>]/i.test(text)) return [];
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 4) return [];
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const iLon = header.indexOf("longitude");
  const iLat = header.indexOf("latitude");
  if (iLon < 0 || iLat < 0) return [];

  const ring = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const lon = Number(cols[iLon]);
    const lat = Number(cols[iLat]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    ring.push({ lon, lat });
  }
  // Drop duplicate closing vertex if present (corridor closeRing handles it too)
  if (ring.length > 2) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (Math.abs(a.lon - b.lon) < 1e-12 && Math.abs(a.lat - b.lat) < 1e-12) {
      ring.pop();
    }
  }
  return ring;
}

export async function loadRiverBoundaryCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load river coordinates CSV (${res.status})`);
  const text = await res.text();
  const ring = parseRiverBoundaryCsv(text);
  if (ring.length < 4) throw new Error(`River coordinates CSV has no valid polygon ring (${url})`);
  return { ring, url, count: ring.length };
}

