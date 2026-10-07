/**
 * LULC land-cover classes for 3D placement, decoded from the same GroundOverlay
 * (index.json LatLonBox, WGS84) that the 2D LULC layer drapes. Local X/Z go through
 * the canonical geoReference pipeline, so 2D overlay and 3D placement share one CRS.
 */
import { localToLonLat } from "./geoReference.js";
import { shouldUseLiteAssets } from "../perf/quality.js";

/** Year shown by default in the 2D LULC layer (hydrologyLayer lulcYear). */
export const LULC_REFERENCE_YEAR = 2026;

/** Colours as actually encoded in each overlay PNG (not the legend swatches). */
const ENCODED_CLASSES = {
  2026: [
    ["water", 0, 72, 224],
    ["settlement", 224, 0, 0],
    ["forest", 0, 104, 0],
    ["crop", 248, 208, 0],
    ["barren", 144, 72, 0],
  ],
  2025: [
    ["water", 0, 136, 248],
    ["settlement", 200, 0, 0],
    ["forest", 0, 104, 0],
    ["crop", 240, 144, 0],
    ["barren", 176, 176, 176],
  ],
};
const CLASS_IDS = ["", "water", "settlement", "forest", "crop", "barren"];
/** Pixels further than this from every class colour stay unclassified. */
const MAX_COLOR_DIST2 = 110 * 110;
/** Decode at ≤ this width (2026 overlay: 6737 px ≈ 2.3 m → ≈ 4.6 m cells). */
const MAX_DECODE_W = 3400;
const MAX_DECODE_W_LITE = 1400;

const cache = new Map();

/**
 * @param {number} [year]
 * @returns {Promise<{ year:number, bounds:{north:number,south:number,east:number,west:number}, width:number, height:number,
 *   classAtLonLat:(lon:number,lat:number)=>string|null, classAtLocal:(x:number,z:number)=>string|null }>}
 */
export function loadLulcClassGrid(year = LULC_REFERENCE_YEAR) {
  if (!cache.has(year)) {
    const p = decode(year);
    p.catch(() => cache.delete(year));
    cache.set(year, p);
  }
  return cache.get(year);
}

async function decode(year) {
  const palette = ENCODED_CLASSES[year];
  if (!palette) throw new Error(`No LULC class palette for ${year}`);
  const base = (import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  const index = await (await fetch(`${base}data/hydrology/lulc/index.json`, { cache: "force-cache" })).json();
  const entry = index.years?.find((y) => Number(y.year) === year);
  if (!entry?.bounds || !entry.overlay) throw new Error(`LULC ${year} not in index.json`);
  const res = await fetch(`${base}${entry.overlay.replace(/^\//, "")}`, { cache: "force-cache" });
  if (!res.ok) throw new Error(`LULC ${year} overlay unavailable (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const maxW = shouldUseLiteAssets() ? MAX_DECODE_W_LITE : MAX_DECODE_W;
  const scale = Math.min(1, maxW / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const px = ctx.getImageData(0, 0, width, height).data;

  const cls = new Uint8Array(width * height);
  for (let k = 0, i = 0; k < cls.length; k++, i += 4) {
    if (px[i + 3] < 20) continue;
    let best = 0;
    let bestD = MAX_COLOR_DIST2;
    for (let c = 0; c < palette.length; c++) {
      const [, r, g, b] = palette[c];
      const d = (px[i] - r) ** 2 + (px[i + 1] - g) ** 2 + (px[i + 2] - b) ** 2;
      if (d < bestD) { bestD = d; best = CLASS_IDS.indexOf(palette[c][0]); }
    }
    cls[k] = best;
  }

  const { north, south, east, west } = entry.bounds;
  const classAtLonLat = (lon, lat) => {
    if (!(lon >= west && lon < east && lat > south && lat <= north)) return null;
    const i = Math.min(width - 1, Math.floor(((lon - west) / (east - west)) * width));
    const j = Math.min(height - 1, Math.floor(((north - lat) / (north - south)) * height));
    return CLASS_IDS[cls[j * width + i]] || null;
  };
  const classAtLocal = (x, z) => {
    const ll = localToLonLat(x, z);
    return classAtLonLat(ll.lon, ll.lat);
  };
  return { year, bounds: { north, south, east, west }, width, height, classAtLonLat, classAtLocal };
}
