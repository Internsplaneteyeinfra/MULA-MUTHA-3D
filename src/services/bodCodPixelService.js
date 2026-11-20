/**
 * Main-stream BOD/COD pixel samples (from main_bod_cod_pixels KML).
 * Used only for RIVER REACH HUD lookup — no map layer.
 *
 * Payload: { points: [[lon, lat, bod, cod], ...] }
 */

const DATA_URL = "/data/main_bod_cod_pixels.json";

/** Max search distance (~90 m) so centerline clicks still hit mid-channel pixels. */
const MAX_DIST_DEG = 0.0008;

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
 * Nearest pixel BOD/COD at lon/lat. Returns null if none within ~35 m.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{ bod:number, cod:number, lat:number, lon:number, distDeg:number } | null>}
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
  let bestD2 = MAX_DIST_DEG * MAX_DIST_DEG;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(`${cx + dx},${cy + dy}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const p = pixels[i];
        const dlon = p.lon - lo;
        const dlat = p.lat - la;
        const d2 = dlon * dlon + dlat * dlat;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = p;
        }
      }
    }
  }

  if (!best) return null;
  return {
    bod: best.bod,
    cod: best.cod,
    lat: best.lat,
    lon: best.lon,
    distDeg: Math.sqrt(bestD2),
  };
}
