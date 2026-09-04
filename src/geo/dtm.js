import { fromArrayBuffer } from "geotiff";
import { SURFACE_Y } from "../scene/river.js";

/** Exaggerate real relief so hills/valleys read clearly in overview cameras. */
export const TERRAIN_VERTICAL_EXAG = 3.2;
const BANK_ANCHOR_SCENE = SURFACE_Y + 2.5;
/** Cap decoded grid size — full FABDEM decode was blocking the loading screen. */
const MAX_SAMPLE_DIM = 384;

/**
 * Load FABDEM DTM (EPSG:4326) and build a scene-aligned elevation sampler.
 * Vertical offset anchors median bank elevation; exag amplifies hills/valleys.
 */
export async function loadFabdemDtm(url, frame, corridor, onProgress) {
  onProgress?.("Downloading terrain elevation…");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DTM fetch failed (${res.status})`);
  const buf = await res.arrayBuffer();

  onProgress?.("Decoding terrain elevation…");
  // Yield so the loading bar can paint before heavy geotiff work
  await yieldToBrowser();

  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const [west, south, east, north] = image.getBoundingBox();
  const fullW = image.getWidth();
  const fullH = image.getHeight();

  const scale = Math.min(1, MAX_SAMPLE_DIM / Math.max(fullW, fullH));
  const width = Math.max(48, Math.floor(fullW * scale));
  const height = Math.max(48, Math.floor(fullH * scale));

  onProgress?.(
    scale < 1
      ? `Sampling terrain ${width}×${height} (from ${fullW}×${fullH})…`
      : `Reading terrain ${width}×${height}…`,
  );
  await yieldToBrowser();

  const data = await image.readRasters({
    width,
    height,
    interleave: true,
    resampleMethod: "bilinear",
  });

  await yieldToBrowser();

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
  const step = Math.max(1, Math.floor(stations.length / 80));
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

  let minSceneY = Infinity;
  let maxSceneY = -Infinity;
  const sampleStep = Math.max(4, Math.floor(Math.min(width, height) / 20));
  for (let r = 0; r < height; r += sampleStep) {
    for (let c = 0; c < width; c += sampleStep) {
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
    fullWidth: fullW,
    fullHeight: fullH,
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

/** Race DTM load against a timeout so the app never hangs on terrain. */
export function loadFabdemDtmWithTimeout(url, frame, corridor, onProgress, ms = 4500) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`DTM timed out after ${ms}ms`)), ms);
  });
  return Promise.race([
    loadFabdemDtm(url, frame, corridor, onProgress).finally(() => clearTimeout(timer)),
    timeout,
  ]);
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
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
