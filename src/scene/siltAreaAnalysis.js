/**
 * 4-point silt area analysis over the project's own silt rasters
 * (public/data/hydrology/silt — Silt Classification + Silt Volume Surface KMZ GroundOverlays).
 *
 * Geometry is computed in the existing local metric frame (lonLatToLocal / localToLonLat,
 * EPSG:32643-based). Raster cells are sampled at native resolution inside the polygon.
 *
 * Data honesty:
 *  - Classes are decoded from the overlay palette → status DERIVED (never VERIFIED).
 *  - The volume surface legend says "unit unconfirmed" → reported as a DERIVED index only;
 *    silt thickness and volume (m³) stay unavailable. Bathymetry is never used here.
 */
import { lonLatToLocal, localToLonLat } from "../geo/geoReference.js";
import {
  SILT_CLASS_BOUNDS,
  SILT_CLASS_CLASSES,
  SILT_CLASS_PERIODS,
  SILT_VOLUME_MAX,
  SILT_VOLUME_PERIODS,
} from "./hydrologyLayer.js";

/**
 * Nearest-neighbour depth lookup from the bathymetry CSV points array.
 * @param {number} x  local metres
 * @param {number} z  local metres
 * @param {{x:number,z:number,depth:number}[]} pts  dataset.points
 * @returns {number|null}
 */
function sampleBathyDepth(x, z, pts) {
  if (!pts?.length) return null;
  let best = null;
  let bestD2 = Infinity;
  const step = Math.max(1, Math.floor(pts.length / 800));
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = p; }
  }
  return best != null && Number.isFinite(best.depth) ? best.depth : null;
}

/**
 * Sample bathymetry depth at several interior points of the polygon ring.
 * Returns { min, max, mean, samples } or null when no data.
 */
function samplePolygonDepths(ring, pts) {
  if (!pts?.length) return null;
  // centroid
  const n = ring.length;
  const cx = ring.reduce((s, p) => s + p.x, 0) / n;
  const cz = ring.reduce((s, p) => s + p.z, 0) / n;
  // sample centroid + mid-edges
  const probes = [{ x: cx, z: cz }];
  for (let i = 0; i < n; i++) {
    const a = ring[i]; const b = ring[(i + 1) % n];
    probes.push({ x: (a.x + b.x) / 2 * 0.5 + cx * 0.5, z: (a.z + b.z) / 2 * 0.5 + cz * 0.5 });
  }
  const depths = probes.map(p => sampleBathyDepth(p.x, p.z, pts)).filter(v => v != null);
  if (!depths.length) return null;
  const min = Math.min(...depths);
  const max = Math.max(...depths);
  const mean = depths.reduce((s, v) => s + v, 0) / depths.length;
  return { min, max, mean, samples: depths.length };
}

export const STATUS = Object.freeze({
  VERIFIED: "VERIFIED",
  DERIVED: "DERIVED",
  INTERPOLATED: "INTERPOLATED",
  UNAVAILABLE: "UNAVAILABLE",
});

/** Overlay max alpha is ~178 (KMZ layer opacity); a cell is valid at ≥ half of that. */
const VALID_ALPHA = 89;
/** Swatch hues of the classification legend.png (Low → Very High, green-to-red). */
const CLASS_HUE_ANCHORS = [105, 67, 38, 0];
const MIN_CLASS_SATURATION = 0.3;
/** Volume legend.png ramp bar: column 20, rows 27 (max) → 184 (0). */
const VOLUME_RAMP = { x: 20, top: 27, bottom: 184, width: 271, height: 206 };
const VOLUME_RAMP_MAX_D2 = 48 * 48 * 3;
/** Nearest-observation search radius around each clicked point. */
const NEAREST_SEARCH_M = 60;
const MAX_HOTSPOTS = 6;

const bitmapCache = new Map();

function assetUrl(path) {
  const base = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
  return `${base.replace(/\/$/, "")}/${String(path).replace(/^\//, "")}`;
}

async function loadBitmap(path) {
  const url = assetUrl(path);
  if (!bitmapCache.has(url)) {
    const p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url} → ${r.status}`);
        return r.blob();
      })
      .then((b) => createImageBitmap(b));
    p.catch(() => bitmapCache.delete(url));
    bitmapCache.set(url, p);
  }
  return bitmapCache.get(url);
}

function readPixels(bitmap, sx, sy, sw, sh) {
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  return ctx.getImageData(0, 0, sw, sh).data;
}

async function loadVolumeRamp(legendPath) {
  const bmp = await loadBitmap(legendPath);
  if (bmp.width !== VOLUME_RAMP.width || bmp.height !== VOLUME_RAMP.height) return null;
  const rows = VOLUME_RAMP.bottom - VOLUME_RAMP.top + 1;
  const data = readPixels(bmp, VOLUME_RAMP.x, VOLUME_RAMP.top, 1, rows);
  const ramp = [];
  for (let i = 0; i < rows; i++) {
    const value = SILT_VOLUME_MAX * (1 - i / (rows - 1));
    ramp.push({ r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2], value });
  }
  const top = ramp[0];
  const bot = ramp[rows - 1];
  // Guard: must be the dark-brown → pale-yellow YlOrBr bar, otherwise treat as unavailable.
  if (top.r + top.g + top.b > 300 || bot.r + bot.g + bot.b < 600) return null;
  return ramp;
}

function periodOf(list, id) {
  return list.find((p) => p.id === id) || list[list.length - 1];
}

function rgbHueSat(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  if (d === 0) return { h: 0, s };
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h > 300) h -= 360;
  return { h, s };
}

/** 0..3 (Low..Very High) or -1 when the colour is not on the class palette. */
function classIndexFromRgb(r, g, b) {
  const { h, s } = rgbHueSat(r, g, b);
  if (s < MIN_CLASS_SATURATION || h < -30 || h > 140) return -1;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < CLASS_HUE_ANCHORS.length; i++) {
    const d = Math.abs(h - CLASS_HUE_ANCHORS[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function volumeFromRgb(ramp, r, g, b) {
  let best = null;
  let bestD = Infinity;
  for (const c of ramp) {
    const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= VOLUME_RAMP_MAX_D2 ? best.value : null;
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Edges P1P2×P3P4 or P2P3×P4P1 crossing → bow-tie; reorder around the mean point. */
export function orderRing(points) {
  const [a, b, c, d] = points;
  const crossed = segmentsCross(a, b, c, d) || segmentsCross(b, c, d, a);
  if (!crossed) return { ring: points.slice(), reordered: false };
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const mz = points.reduce((s, p) => s + p.z, 0) / points.length;
  const ring = points
    .slice()
    .sort((p, q) => Math.atan2(p.z - mz, p.x - mx) - Math.atan2(q.z - mz, q.x - mx));
  return { ring, reordered: true };
}

export function ringGeometry(ring) {
  let a2 = 0;
  let cx = 0;
  let cz = 0;
  let perim = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const cross = p.x * q.z - q.x * p.z;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cz += (p.z + q.z) * cross;
    perim += Math.hypot(q.x - p.x, q.z - p.z);
  }
  const area = Math.abs(a2) / 2;
  const centroid = a2 !== 0 ? { x: cx / (3 * a2), z: cz / (3 * a2) } : { ...ring[0] };
  return { areaM2: area, perimeterM: perim, centroid };
}

function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * @param {{x:number,z:number}[]} points  P1..P4 in local metres
 * @param {{ classPeriod?: string, volumePeriod?: string, dataset?: object }} [opts]
 */
export async function analyzeSiltPolygon(points, opts = {}) {
  const { ring, reordered } = orderRing(points);
  const geom = ringGeometry(ring);
  const centroidLL = localToLonLat(geom.centroid.x, geom.centroid.z);

  const classPeriod = periodOf(SILT_CLASS_PERIODS, opts.classPeriod);
  const volumePeriod = periodOf(SILT_VOLUME_PERIODS, opts.volumePeriod);
  const { west, east, north, south } = SILT_CLASS_BOUNDS;

  const base = {
    ring,
    reordered,
    selectedAreaM2: geom.areaM2,
    perimeterM: geom.perimeterM,
    centroid: { ...geom.centroid, lon: centroidLL.lon, lat: centroidLL.lat },
    source: {
      classification: `Silt Classification · ${classPeriod.label} ${classPeriod.year}`,
      classificationPath: classPeriod.overlay,
      volume: `Silt Volume Surface · ${volumePeriod.label} ${volumePeriod.year}`,
      classPeriod: classPeriod.id,
      volumePeriod: volumePeriod.id,
    },
    thickness: { status: STATUS.UNAVAILABLE, note: "No silt thickness layer in project data" },
    volumeM3: { status: STATUS.UNAVAILABLE, note: "Needs thickness in metres" },
    bathymetryDepth: null, // populated below if dataset is available
  };

  // --- Bathymetry depth sampling (from CSV dataset.points) ---
  const bathyPts = opts.dataset?.points ?? null;
  const polyDepthStats = samplePolygonDepths(ring, bathyPts);
  if (polyDepthStats) {
    base.bathymetryDepth = {
      status: STATUS.INTERPOLATED,
      ...polyDepthStats,
      note: "Nearest-neighbour from bathymetry CSV · not a verified silt-thickness measurement",
    };
  }

  let clsBmp;
  try {
    clsBmp = await loadBitmap(classPeriod.overlay);
  } catch (err) {
    console.warn("[silt-analysis] classification raster unavailable", err);
    return { ...base, available: false, reason: "Silt dataset unavailable" };
  }
  const W = clsBmp.width;
  const H = clsBmp.height;
  const lonToPx = (lon) => ((lon - west) / (east - west)) * W;
  const latToPy = (lat) => ((north - lat) / (north - south)) * H;
  const pxToLon = (px) => west + (px / W) * (east - west);
  const pyToLat = (py) => north - (py / H) * (north - south);

  const ringLL = ring.map((p) => localToLonLat(p.x, p.z));
  const cellLocal = (() => {
    const lon = centroidLL.lon;
    const lat = centroidLL.lat;
    const o = lonLatToLocal(lon, lat);
    const ex = lonLatToLocal(lon + (east - west) / W, lat);
    const ny = lonLatToLocal(lon, lat - (north - south) / H);
    const ux = { x: ex.x - o.x, z: ex.z - o.z };
    const uy = { x: ny.x - o.x, z: ny.z - o.z };
    return { ux, uy, areaM2: Math.abs(ux.x * uy.z - ux.z * uy.x), dxM: Math.hypot(ux.x, ux.z), dyM: Math.hypot(uy.x, uy.z) };
  })();
  const marginPx = Math.ceil(NEAREST_SEARCH_M / Math.min(cellLocal.dxM, cellLocal.dyM)) + 1;

  const pxs = ringLL.map((p) => lonToPx(p.lon));
  const pys = ringLL.map((p) => latToPy(p.lat));
  const x0 = Math.max(0, Math.floor(Math.min(...pxs)) - marginPx);
  const x1 = Math.min(W, Math.ceil(Math.max(...pxs)) + marginPx);
  const y0 = Math.max(0, Math.floor(Math.min(...pys)) - marginPx);
  const y1 = Math.min(H, Math.ceil(Math.max(...pys)) + marginPx);

  const raster = {
    width: W,
    height: H,
    cellAreaM2: cellLocal.areaM2,
    dxM: cellLocal.dxM,
    dyM: cellLocal.dyM,
  };

  if (x1 <= x0 || y1 <= y0) {
    return {
      ...base,
      available: true,
      raster,
      outsideExtent: true,
      coverage: { coveredM2: 0, uncoveredM2: geom.areaM2, pct: 0 },
      silt: null,
      classes: [],
      volumeIndex: { status: STATUS.UNAVAILABLE },
      hotspots: [],
      points: points.map((p, i) => pointResultUnavailable(p, i)),
    };
  }

  const cw = x1 - x0;
  const ch = y1 - y0;
  const cls = readPixels(clsBmp, x0, y0, cw, ch);

  let vol = null;
  let ramp = null;
  try {
    const volBmp = await loadBitmap(volumePeriod.overlay);
    if (volBmp.width === W && volBmp.height === H) {
      ramp = await loadVolumeRamp(volumePeriod.legend);
      if (ramp) vol = readPixels(volBmp, x0, y0, cw, ch);
    }
  } catch (err) {
    console.warn("[silt-analysis] volume surface unavailable", err);
  }

  // Local coords of crop pixel centres via the projected corners (bilinear; exact to mm here).
  const c00 = lonLatToLocal(pxToLon(x0 + 0.5), pyToLat(y0 + 0.5));
  const c10 = lonLatToLocal(pxToLon(x1 - 0.5), pyToLat(y0 + 0.5));
  const c01 = lonLatToLocal(pxToLon(x0 + 0.5), pyToLat(y1 - 0.5));
  const c11 = lonLatToLocal(pxToLon(x1 - 0.5), pyToLat(y1 - 0.5));
  const localAt = (ix, iy) => {
    const u = cw > 1 ? ix / (cw - 1) : 0;
    const v = ch > 1 ? iy / (ch - 1) : 0;
    const x = (1 - v) * ((1 - u) * c00.x + u * c10.x) + v * ((1 - u) * c01.x + u * c11.x);
    const z = (1 - v) * ((1 - u) * c00.z + u * c10.z) + v * ((1 - u) * c01.z + u * c11.z);
    return { x, z };
  };

  const n = cw * ch;
  const inside = new Uint8Array(n);
  const clsIdx = new Int8Array(n).fill(-1);
  const volVal = new Float32Array(n).fill(NaN);
  const volDone = new Uint8Array(n);
  const volAt = (k) => {
    if (!vol) return null;
    if (!volDone[k]) {
      volDone[k] = 1;
      const i4 = k * 4;
      if (vol[i4 + 3] >= VALID_ALPHA) {
        const v = volumeFromRgb(ramp, vol[i4], vol[i4 + 1], vol[i4 + 2]);
        if (v != null) volVal[k] = v;
      }
    }
    return Number.isNaN(volVal[k]) ? null : volVal[k];
  };
  const clip = new Uint8ClampedArray(n * 4);
  const classCells = [0, 0, 0, 0];
  const volValues = [];
  let insideCells = 0;
  let validCells = 0;

  for (let iy = 0; iy < ch; iy++) {
    for (let ix = 0; ix < cw; ix++) {
      const k = iy * cw + ix;
      const i4 = k * 4;
      if (cls[i4 + 3] >= VALID_ALPHA) {
        clsIdx[k] = classIndexFromRgb(cls[i4], cls[i4 + 1], cls[i4 + 2]);
      }
      if (vol && vol[i4 + 3] >= VALID_ALPHA) {
        const v = volumeFromRgb(ramp, vol[i4], vol[i4 + 1], vol[i4 + 2]);
        if (v != null) volVal[k] = v;
      }
      const p = localAt(ix, iy);
      if (!pointInRing(p.x, p.z, ring)) continue;
      inside[k] = 1;
      insideCells++;
      const c = clsIdx[k];
      if (c < 0) continue;
      validCells++;
      classCells[c]++;
      const v = volAt(k);
      if (v != null) volValues.push(v);
      clip[i4] = cls[i4];
      clip[i4 + 1] = cls[i4 + 1];
      clip[i4 + 2] = cls[i4 + 2];
      clip[i4 + 3] = 225;
    }
  }

  const cellA = cellLocal.areaM2;
  const coveredM2 = Math.min(geom.areaM2, validCells * cellA);
  const siltAreaM2 = coveredM2;
  const classes = SILT_CLASS_CLASSES.map((c, i) => ({
    ...c,
    cells: classCells[i],
    areaM2: classCells[i] * cellA,
    pct: validCells ? (classCells[i] / validCells) * 100 : 0,
  }));

  let volumeIndex = { status: STATUS.UNAVAILABLE, note: vol ? "No volume-surface cells in polygon" : "Volume surface unavailable" };
  if (volValues.length) {
    const sorted = Float32Array.from(volValues).sort();
    const sum = volValues.reduce((s, v) => s + v, 0);
    volumeIndex = {
      status: STATUS.DERIVED,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: sum / sorted.length,
      median: median(sorted),
      total: sum,
      cells: sorted.length,
      scaleMax: SILT_VOLUME_MAX,
      note: "Colour-decoded; unit unconfirmed in source legend",
    };
  }

  const cellInfo = (k) => {
    const ix = k % cw;
    const iy = (k / cw) | 0;
    const p = localAt(ix, iy);
    const ll = localToLonLat(p.x, p.z);
    const c = clsIdx[k];
    return {
      x: p.x,
      z: p.z,
      lon: ll.lon,
      lat: ll.lat,
      classIndex: c,
      classLabel: c >= 0 ? SILT_CLASS_CLASSES[c].label : null,
      classColor: c >= 0 ? SILT_CLASS_CLASSES[c].color : null,
      volumeIndex: volAt(k),
    };
  };

  const hotspots = findHotspots({ cw, ch, inside, clsIdx, cellA, cellInfo }).map((h) => ({
    ...h,
    status: STATUS.DERIVED,
    source: base.source.classification,
  }));

  const pointResults = points.map((p, idx) => {
    const ll = localToLonLat(p.x, p.z);
    const ix = Math.floor(lonToPx(ll.lon)) - x0;
    const iy = Math.floor(latToPy(ll.lat)) - y0;
    const depthAtPoint = sampleBathyDepth(p.x, p.z, bathyPts);
    const res = { ...pointResultUnavailable(p, idx, ll), depthM: depthAtPoint };
    if (ix < 0 || iy < 0 || ix >= cw || iy >= ch) return res;
    const k = iy * cw + ix;
    if (clsIdx[k] >= 0) {
      const info = cellInfo(k);
      return {
        ...res,
        classLabel: info.classLabel,
        classColor: info.classColor,
        volumeIndex: info.volumeIndex,
        nearestM: 0,
        status: STATUS.DERIVED,
        verification: "Decoded from source raster cell",
      };
    }
    let bestD2 = Infinity;
    const r = marginPx;
    for (let yy = Math.max(0, iy - r); yy <= Math.min(ch - 1, iy + r); yy++) {
      for (let xx = Math.max(0, ix - r); xx <= Math.min(cw - 1, ix + r); xx++) {
        if (clsIdx[yy * cw + xx] < 0) continue;
        const q = localAt(xx, yy);
        const d2 = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
        if (d2 < bestD2) bestD2 = d2;
      }
    }
    const d = Math.sqrt(bestD2);
    return { ...res, nearestM: d <= NEAREST_SEARCH_M ? d : null };
  });

  return {
    ...base,
    available: true,
    raster,
    outsideExtent: insideCells === 0,
    insideCells,
    validCells,
    coverage: {
      coveredM2,
      uncoveredM2: Math.max(0, geom.areaM2 - coveredM2),
      pct: geom.areaM2 > 0 ? (coveredM2 / geom.areaM2) * 100 : 0,
    },
    silt: validCells
      ? {
          areaM2: siltAreaM2,
          coveragePct: geom.areaM2 > 0 ? (siltAreaM2 / geom.areaM2) * 100 : 0,
          status: STATUS.DERIVED,
        }
      : null,
    classes,
    volumeIndex,
    hotspots,
    points: pointResults,
    clip: validCells
      ? {
          width: cw,
          height: ch,
          data: clip,
          corners: {
            nw: lonLatToLocal(pxToLon(x0), pyToLat(y0)),
            ne: lonLatToLocal(pxToLon(x1), pyToLat(y0)),
            sw: lonLatToLocal(pxToLon(x0), pyToLat(y1)),
            se: lonLatToLocal(pxToLon(x1), pyToLat(y1)),
          },
        }
      : null,
    searchRadiusM: NEAREST_SEARCH_M,
  };
}

function pointResultUnavailable(p, idx, ll = localToLonLat(p.x, p.z)) {
  return {
    id: `P${idx + 1}`,
    x: p.x,
    z: p.z,
    lon: ll.lon,
    lat: ll.lat,
    classLabel: null,
    classColor: null,
    volumeIndex: null,
    nearestM: null,
    status: STATUS.UNAVAILABLE,
    verification: "No nearby verified observation",
  };
}

/** Connected High / Very High cells (dataset classes 3–4) inside the polygon, largest first. */
function findHotspots({ cw, ch, inside, clsIdx, cellA, cellInfo }) {
  const seen = new Uint8Array(cw * ch);
  const comps = [];
  const stack = [];
  for (let k0 = 0; k0 < cw * ch; k0++) {
    if (seen[k0] || !inside[k0] || clsIdx[k0] < 2) continue;
    seen[k0] = 1;
    stack.push(k0);
    let count = 0;
    let vh = 0;
    let sx = 0;
    let sy = 0;
    let bestK = k0;
    let bestScore = -Infinity;
    const cells = [];
    while (stack.length) {
      const k = stack.pop();
      const x = k % cw;
      const y = (k / cw) | 0;
      count++;
      if (clsIdx[k] === 3) vh++;
      sx += x;
      sy += y;
      cells.push(k);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const nk = ny * cw + nx;
          if (seen[nk] || !inside[nk] || clsIdx[nk] < 2) continue;
          seen[nk] = 1;
          stack.push(nk);
        }
      }
    }
    const mx = sx / count;
    const my = sy / count;
    const dominantIdx = vh * 2 >= count ? 3 : 2;
    for (const k of cells) {
      const score = (clsIdx[k] === dominantIdx ? 1e6 : 0) - ((k % cw) - mx) ** 2 - (((k / cw) | 0) - my) ** 2;
      if (score > bestScore) {
        bestScore = score;
        bestK = k;
      }
    }
    comps.push({ count, vh, bestK });
  }
  comps.sort((a, b) => b.count - a.count);
  return comps.slice(0, MAX_HOTSPOTS).map((c, i) => {
    const info = cellInfo(c.bestK);
    return {
      id: `H${i + 1}`,
      ...info,
      areaM2: c.count * cellA,
      dominant: c.vh * 2 >= c.count ? "Very High" : "High",
      totalHotspots: comps.length,
    };
  });
}
