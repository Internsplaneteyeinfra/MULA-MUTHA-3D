/**
 * Main-stream BOD/COD pixel samples (from main_bod_cod_pixels KML).
 * Used only for RIVER REACH HUD lookup — no map layer.
 *
 * Payload: { points: [[lon, lat, bod, cod], ...] }
 */

const DATA_URL = "/data/main_bod_cod_pixels.json";

/** Within one grid cell (~33 m) the 3×3 neighbourhood is guaranteed to hold the true nearest. */
const NEAR_DIST_DEG = 0.0003;

/** @type {{ lon:number, lat:number, bod:number, cod:number }[] | null} */
let pixels = null;
/** @type {Promise<object[]> | null} */
let loadPromise = null;

/** Grid cell size in degrees (~30 m). */
const CELL = 0.0003;
/** @type {Map<string, number[]> | null} */
let grid = null;

function cellKey(lon, lat) {
  return `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;
}

function buildGrid(list) {
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
  return g;
}

/**
 * @returns {Promise<{ lon:number, lat:number, bod:number, cod:number }[]>}
 */
export function loadBodCodPixels() {
  if (pixels) return Promise.resolve(pixels);
  if (loadPromise) return loadPromise;
  loadPromise = fetch(DATA_URL, { cache: "force-cache" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`BOD/COD pixels HTTP ${res.status}`);
      const data = await res.json();
      const raw = Array.isArray(data?.points) ? data.points : [];
      const list = [];
      for (const row of raw) {
        const lon = Number(row[0]);
        const lat = Number(row[1]);
        const bod = Number(row[2]);
        const cod = Number(row[3]);
        if (
          !Number.isFinite(lon) ||
          !Number.isFinite(lat) ||
          !Number.isFinite(bod) ||
          !Number.isFinite(cod)
        ) {
          continue;
        }
        list.push({ lon, lat, bod, cod });
      }
      if (!list.length) throw new Error("BOD/COD pixels payload empty");
      pixels = list;
      grid = buildGrid(list);
      return list;
    })
    .catch((err) => {
      console.warn("[bod-cod-pixels]", err?.message || err);
      pixels = null;
      grid = null;
      throw err;
    })
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
}

/**
 * Nearest pixel BOD/COD at lon/lat. Always returns the closest KML pixel that has a
 * value (no distance cap), so gaps in the KML show the nearest captured reading.
 * Returns null only when the pixel file itself can't be loaded.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{ bod:number, cod:number, lat:number, lon:number, distDeg:number, distM:number } | null>}
 */
export async function lookupBodCodAt(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;

  try {
    await loadBodCodPixels();
  } catch {
    return null;
  }
  if (!pixels?.length || !grid) return null;

  const cx = Math.floor(lo / CELL);
  const cy = Math.floor(la / CELL);
  let best = null;
  let bestD2 = Infinity;
  const consider = (p) => {
    const dlon = p.lon - lo;
    const dlat = p.lat - la;
    const d2 = dlon * dlon + dlat * dlat;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = p;
    }
  };

  // Fast path: neighbouring grid cells (~90 m).
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(`${cx + dx},${cy + dy}`);
      if (bucket) for (const i of bucket) consider(pixels[i]);
    }
  }
  // Gap in the KML (or far from it): scan everything for the true nearest pixel.
  if (!best || bestD2 > NEAR_DIST_DEG * NEAR_DIST_DEG) {
    for (const p of pixels) consider(p);
  }

  if (!best) return null;
  const distDeg = Math.sqrt(bestD2);
  return {
    bod: best.bod,
    cod: best.cod,
    lat: best.lat,
    lon: best.lon,
    distDeg,
    distM: Math.round(distDeg * 111_000),
  };
}
