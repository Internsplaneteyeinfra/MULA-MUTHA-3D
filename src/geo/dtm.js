import { fromArrayBuffer } from "geotiff";
import { SURFACE_Y } from "../scene/river.js";

/** Gentle relief — the Pune corridor is a floodplain, not a canyon. */
export const TERRAIN_VERTICAL_EXAG = 3.2;
/** Cap decoded grid size — full FABDEM decode was blocking the loading screen. */
const MAX_SAMPLE_DIM = 384;

/**
 * Load FABDEM DTM (EPSG:4326) and build a scene-aligned elevation sampler.
 * Vertical offset anchors median bank elevation; exag amplifies hills/valleys.
 */
export async function loadFabdemDtm(url, frame, corridor, onProgress, options = {}) {
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

  const maxSampleDim = Math.max(96, Number(options.maxSampleDim) || MAX_SAMPLE_DIM);
  const scale = Math.min(1, maxSampleDim / Math.max(fullW, fullH));
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

  const stations = corridor?.stations || [];

  // ── River-relative vertical datum ────────────────────────────────────────────────────────
  // The scene water is one plane (SURFACE_Y) but the real water surface falls ~7 m over the
  // 17 km reach. A single global offset therefore put upstream banks metres above the water
  // and downstream banks below it (×TERRAIN_VERTICAL_EXAG). Instead, measure every elevation
  // from the local water level: a water-surface profile taken from this same DTM along the
  // channel (lowest cross-channel sample, smoothed, non-increasing downstream).
  const wseRef = buildWaterLevelProfile(stations, frame, sampleLonLat);
  const wseMean = wseRef.length ? wseRef.reduce((a, b) => a + b, 0) / wseRef.length : 530;
  const wseGrid = buildNearestStationGrid(stations, frame, wseRef, wseMean, {
    west, east, south, north, width, height,
  });

  function sampleWse(lon, lat) {
    if (lon < west || lon > east || lat < south || lat > north) return wseMean;
    const col = ((lon - west) / lonSpan) * (width - 1);
    const row = ((north - lat) / latSpan) * (height - 1);
    return bilinear(wseGrid, width, height, col, row) ?? wseMean;
  }

  // Kept for logs / diagnostics (no longer used for the conversion).
  const verticalOffset = wseMean - SURFACE_Y;
  const medianBank = wseMean;

  /** Elevation (m MSL) → scene Y: height above the local water level, relief exaggerated. */
  function toSceneY(elevM, wseM = wseMean) {
    return SURFACE_Y + (elevM - wseM) * TERRAIN_VERTICAL_EXAG;
  }

  function sampleSceneXY(x, z) {
    const ll = frame.toLonLat(x, z);
    const elev = sampleLonLat(ll.lon, ll.lat);
    if (elev == null) return null;
    return toSceneY(elev, sampleWse(ll.lon, ll.lat));
  }

  let minSceneY = Infinity;
  let maxSceneY = -Infinity;
  const sampleStep = Math.max(4, Math.floor(Math.min(width, height) / 20));
  for (let r = 0; r < height; r += sampleStep) {
    for (let c = 0; c < width; c += sampleStep) {
      const y = toSceneY(data[r * width + c], wseGrid[r * width + c]);
      if (!Number.isFinite(y)) continue;
      minSceneY = Math.min(minSceneY, y);
      maxSceneY = Math.max(maxSceneY, y);
    }
  }
  if (!Number.isFinite(minSceneY)) {
    minSceneY = SURFACE_Y - 20;
    maxSceneY = SURFACE_Y + 80;
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
    waterLevelProfile: { first: wseRef[0], last: wseRef[wseRef.length - 1], mean: wseMean },
    sampleWaterLevelMsl: (x, z) => {
      const ll = frame.toLonLat(x, z);
      return sampleWse(ll.lon, ll.lat);
    },
    minSceneY,
    maxSceneY,
    exag: TERRAIN_VERTICAL_EXAG,
    sampleLonLat,
    sampleSceneXY,
    toSceneY,
  };
}

/** Race DTM load against a timeout so the app never hangs on terrain. */
export function loadFabdemDtmWithTimeout(url, frame, corridor, onProgress, ms = 90_000, options = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`DTM timed out after ${ms}ms`)), ms);
  });
  return Promise.race([
    loadFabdemDtm(url, frame, corridor, onProgress, options).finally(() => clearTimeout(timer)),
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
  const samples = [
    [data[r0 * w + c0], (1 - fc) * (1 - fr)],
    [data[r0 * w + c1], fc * (1 - fr)],
    [data[r1 * w + c0], (1 - fc) * fr],
    [data[r1 * w + c1], fc * fr],
  ];
  // A nodata corner (common on the water edge) must not blank the whole sample.
  let acc = 0;
  let wsum = 0;
  for (const [v, wgt] of samples) {
    if (!Number.isFinite(v) || wgt <= 0) continue;
    acc += v * wgt;
    wsum += wgt;
  }
  return wsum > 1e-6 ? acc / wsum : null;
}

/**
 * Local water-surface elevation (m MSL) per station from the DTM itself: lowest of a few samples
 * across the channel (the DEM records the water surface there), a running low percentile to
 * reject bridge decks / noise, then the best non-increasing (downstream) fit.
 */
function buildWaterLevelProfile(stations, frame, sampleLonLat) {
  const n = stations.length;
  if (!n) return [];
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const st = stations[i];
    const half = Math.max(4, (Number(st.halfWidth) || 20) * 0.45);
    const px = -(st.flowZ || 0);
    const pz = st.flowX || 0;
    let lo = Infinity;
    for (const k of [-1, -0.5, 0, 0.5, 1]) {
      const ll = frame.toLonLat(st.x + px * half * k, st.z + pz * half * k);
      const e = sampleLonLat(ll.lon, ll.lat);
      if (Number.isFinite(e)) lo = Math.min(lo, e);
    }
    raw[i] = lo;
  }
  // Fill gaps from neighbours.
  let last = NaN;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(raw[i])) last = raw[i];
    else raw[i] = last;
  }
  for (let i = n - 1; i >= 0; i--) {
    if (Number.isFinite(raw[i])) last = raw[i];
    else raw[i] = last;
  }
  // Running 25th percentile over ±15 stations (~±150 m).
  const W = 15;
  const pct = new Float64Array(n);
  const buf = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    for (let k = Math.max(0, i - W); k <= Math.min(n - 1, i + W); k++) buf.push(raw[k]);
    buf.sort((a, b) => a - b);
    pct[i] = buf[Math.floor((buf.length - 1) * 0.25)];
  }
  return isotonicNonIncreasing(pct);
}

/** Pool-adjacent-violators: least-squares non-increasing fit. */
function isotonicNonIncreasing(y) {
  const vals = [];
  const wts = [];
  for (let i = 0; i < y.length; i++) {
    vals.push(y[i]);
    wts.push(1);
    while (vals.length > 1 && vals[vals.length - 2] < vals[vals.length - 1]) {
      const w = wts[wts.length - 2] + wts[wts.length - 1];
      const v = (vals[vals.length - 2] * wts[wts.length - 2] + vals[vals.length - 1] * wts[wts.length - 1]) / w;
      vals.splice(-2, 2, v);
      wts.splice(-2, 2, w);
    }
  }
  const out = [];
  vals.forEach((v, i) => {
    for (let k = 0; k < wts[i]; k++) out.push(v);
  });
  return out;
}

/** Per-DTM-cell water level of the nearest station (lon/lat spatial hash). */
function buildNearestStationGrid(stations, frame, wseRef, fallback, g) {
  const grid = new Float32Array(g.width * g.height).fill(fallback);
  if (!stations.length) return grid;
  const ll = stations.map((s) => frame.toLonLat(s.x, s.z));
  const cell = 0.002; // degrees (~200 m)
  const bins = new Map();
  ll.forEach((p, i) => {
    const k = `${Math.floor(p.lon / cell)},${Math.floor(p.lat / cell)}`;
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(i);
  });
  const cosLat = Math.cos((((g.north + g.south) / 2) * Math.PI) / 180);
  for (let r = 0; r < g.height; r++) {
    const lat = g.north - (r / (g.height - 1)) * (g.north - g.south);
    for (let c = 0; c < g.width; c++) {
      const lon = g.west + (c / (g.width - 1)) * (g.east - g.west);
      const cx = Math.floor(lon / cell);
      const cy = Math.floor(lat / cell);
      let best = -1;
      let bestD = Infinity;
      for (let rad = 1; rad <= 40 && best < 0; rad *= 2) {
        for (let i = -rad; i <= rad; i++) {
          for (let j = -rad; j <= rad; j++) {
            const list = bins.get(`${cx + i},${cy + j}`);
            if (!list) continue;
            for (const k of list) {
              const d = ((ll[k].lon - lon) * cosLat) ** 2 + (ll[k].lat - lat) ** 2;
              if (d < bestD) {
                bestD = d;
                best = k;
              }
            }
          }
        }
      }
      if (best >= 0) grid[r * g.width + c] = wseRef[best];
    }
  }
  return grid;
}
