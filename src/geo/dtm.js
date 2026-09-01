import { fromArrayBuffer } from "geotiff";
import { SURFACE_Y } from "../scene/river.js";

/** Exaggerate real relief so hills/valleys read clearly in overview cameras. */
export const TERRAIN_VERTICAL_EXAG = 3.2;
const BANK_ANCHOR_SCENE = SURFACE_Y + 2.5;

/**
 * Load FABDEM DTM (EPSG:4326) and build a scene-aligned elevation sampler.
 * Vertical offset anchors median bank elevation; exag amplifies hills/valleys.
 */
export async function loadFabdemDtm(url, frame, corridor) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DTM fetch failed (${res.status})`);
  const buf = await res.arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const data = await image.readRasters({ interleave: true });

  const lonSpan = east - west;
  const latSpan = north - south;

  function sampleLonLat(lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < west || lon > east || lat < south || lat > north) return null;
    const col = ((lon - west) / lonSpan) * (width - 1);
    const row = ((north - lat) / latSpan) * (height - 1);
    return bilinear(data, width, height, col, row);
  }

  const bankElevs = [];
  const stations = corridor?.stations || [];
  const step = Math.max(1, Math.floor(stations.length / 100));
  for (let i = 0; i < stations.length; i += step) {
    const st = stations[i];
    for (const [bx, bz] of [
      [st.leftX, st.leftZ],
      [st.rightX, st.rightZ],
    ]) {
      const ll = frame.toLonLat(bx, bz);
      const e = sampleLonLat(ll.lon, ll.lat);
      if (e != null) bankElevs.push(e);
    }
  }
  bankElevs.sort((a, b) => a - b);
  const medianBank = bankElevs.length
    ? bankElevs[Math.floor(bankElevs.length * 0.5)]
    : 555;
  const verticalOffset = medianBank - BANK_ANCHOR_SCENE;

  function toSceneY(elevM) {
    const base = elevM - verticalOffset;
    return BANK_ANCHOR_SCENE + (base - BANK_ANCHOR_SCENE) * TERRAIN_VERTICAL_EXAG;
  }

  function sampleSceneXY(x, z) {
    const ll = frame.toLonLat(x, z);
    const elev = sampleLonLat(ll.lon, ll.lat);
    if (elev == null) return null;
    return toSceneY(elev);
  }

  // Scene elevation span for hypsometric tinting
  let minSceneY = Infinity;
  let maxSceneY = -Infinity;
  const sampleStep = Math.max(4, Math.floor(Math.min(width, height) / 24));
  for (let r = 0; r < height; r += sampleStep) {
    for (let c = 0; c < width; c += sampleStep) {
      const lon = west + (c / (width - 1)) * lonSpan;
      const lat = north - (r / (height - 1)) * latSpan;
      const y = toSceneY(data[r * width + c]);
      if (!Number.isFinite(y)) continue;
      minSceneY = Math.min(minSceneY, y);
      maxSceneY = Math.max(maxSceneY, y);
    }
  }
  if (!Number.isFinite(minSceneY)) {
    minSceneY = BANK_ANCHOR_SCENE - 20;
    maxSceneY = BANK_ANCHOR_SCENE + 80;
  }

  return {
    source: url,
    crs: "EPSG:4326",
    bounds: { west, south, east, north },
    width,
    height,
    verticalOffset,
    medianBankM: medianBank,
    minSceneY,
    maxSceneY,
    exag: TERRAIN_VERTICAL_EXAG,
    sampleLonLat,
    sampleSceneXY,
    toSceneY,
  };
}

function bilinear(data, w, h, col, row) {
  const c0 = Math.floor(col);
  const r0 = Math.floor(row);
  const c1 = Math.min(c0 + 1, w - 1);
  const r1 = Math.min(r0 + 1, h - 1);
  const fc = col - c0;
  const fr = row - r0;
  const v00 = data[r0 * w + c0];
  const v10 = data[r0 * w + c1];
  const v01 = data[r1 * w + c0];
  const v11 = data[r1 * w + c1];
  if (![v00, v10, v01, v11].every(Number.isFinite)) return null;
  const v0 = v00 * (1 - fc) + v10 * fc;
  const v1 = v01 * (1 - fc) + v11 * fc;
  return v0 * (1 - fr) + v1 * fr;
}
