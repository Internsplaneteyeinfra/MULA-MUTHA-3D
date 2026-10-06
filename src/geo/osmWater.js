/**
 * Live OSM water polygons (public/data/osm_water.geojson), sampled in WGS84
 * then converted with the same geoReference pipeline as LULC.
 */
import { localToLonLat } from "./geoReference.js";

let cached = null;

/**
 * @returns {Promise<{ isWaterAtLonLat:(lon:number,lat:number)=>boolean, isWaterAtLocal:(x:number,z:number)=>boolean, count:number }>}
 */
export function loadOsmWater() {
  if (!cached) {
    cached = decode().catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

async function decode() {
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  const res = await fetch(`${base}data/osm_water.geojson`, { cache: "force-cache" });
  if (!res.ok) {
    console.warn("[osm-water] geojson unavailable", res.status);
    return empty();
  }
  const fc = await res.json();
  const feats = Array.isArray(fc.features) ? fc.features : [];
  if (!feats.length) return empty();

  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  const rings = [];
  for (const f of feats) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) {
      const ring = poly[0];
      if (!ring || ring.length < 4) continue;
      rings.push(ring);
      for (const p of ring) {
        west = Math.min(west, p[0]);
        east = Math.max(east, p[0]);
        south = Math.min(south, p[1]);
        north = Math.max(north, p[1]);
      }
    }
  }
  if (!rings.length) return empty();

  const cellDeg = 0.00008; // ~9 m
  const width = Math.max(8, Math.min(2048, Math.ceil((east - west) / cellDeg)));
  const height = Math.max(8, Math.min(2048, Math.ceil((north - south) / cellDeg)));
  const grid = new Uint8Array(width * height);
  for (const ring of rings) rasterRing(grid, width, height, west, south, east, north, ring);

  const isWaterAtLonLat = (lon, lat) => {
    if (!(lon >= west && lon < east && lat > south && lat <= north)) return false;
    const i = Math.min(width - 1, Math.floor(((lon - west) / (east - west)) * width));
    const j = Math.min(height - 1, Math.floor(((north - lat) / (north - south)) * height));
    return grid[j * width + i] === 1;
  };
  const isWaterAtLocal = (x, z) => {
    const ll = localToLonLat(x, z);
    return isWaterAtLonLat(ll.lon, ll.lat);
  };
  console.info("[osm-water] live OSM water ready", { polygons: rings.length, grid: `${width}x${height}` });
  return { isWaterAtLonLat, isWaterAtLocal, count: rings.length };
}

function empty() {
  return {
    isWaterAtLonLat: () => false,
    isWaterAtLocal: () => false,
    count: 0,
  };
}

function rasterRing(grid, width, height, west, south, east, north, ring) {
  const spanX = east - west || 1;
  const spanY = north - south || 1;
  const xs = [];
  const ys = [];
  for (const p of ring) {
    xs.push(((p[0] - west) / spanX) * width);
    ys.push(((north - p[1]) / spanY) * height);
  }
  const n = xs.length;
  let minY = height, maxY = 0;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, Math.floor(ys[i]));
    maxY = Math.max(maxY, Math.ceil(ys[i]));
  }
  minY = Math.max(0, minY);
  maxY = Math.min(height - 1, maxY);
  for (let row = minY; row <= maxY; row++) {
    const y = row + 0.5;
    const hits = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = ys[i], yj = ys[j];
      if ((yi > y) === (yj > y)) continue;
      const t = (y - yi) / (yj - yi || 1e-9);
      hits.push(xs[i] + t * (xs[j] - xs[i]));
    }
    hits.sort((a, b) => a - b);
    for (let h = 0; h + 1 < hits.length; h += 2) {
      const a = Math.max(0, Math.floor(hits[h]));
      const b = Math.min(width - 1, Math.ceil(hits[h + 1]));
      for (let x = a; x <= b; x++) grid[row * width + x] = 1;
    }
  }
}

/** True where LULC 2026 is water, or live OSM water where LULC has no land class. */
export function isObservedWater(lulc, osm, x, z) {
  const cls = lulc?.classAtLocal?.(x, z);
  if (cls === "water" || cls === "wetland") return true;
  if (cls === "forest" || cls === "settlement" || cls === "crop" || cls === "barren") return false;
  return !!osm?.isWaterAtLocal?.(x, z);
}
