/**
 * Cesium TerrainProvider backed by the open AWS "Terrain Tiles" (Terrarium PNG encoding).
 * Source DEMs behind these tiles: SRTM/NASADEM (30 m), ETOPO1 (oceans), plus national DEMs where available.
 * https://registry.opendata.aws/terrain-tiles/   — no API key required.
 *
 * Terrarium: elevation_m = (R * 256 + G + B / 256) - 32768, 256x256 px tiles in Web Mercator XYZ.
 * Cesium's WebMercatorTilingScheme uses the same XYZ addressing, so tiles map 1:1 to heightmap terrain data.
 */
const TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TILE_SIZE = 256;
const MAX_ZOOM = 14;

export const TERRARIUM_TILE_URL = TILE_URL;

const cache = new Map();

/**
 * Stream burning (hydrological conditioning of the displayed DEM): river channels registered here are carved into
 * terrain tiles at zoom >= BURN_MIN_ZOOM. Inside the channel the ground is set just below the conditioned water level;
 * a narrow bank ring is lifted to at least the water level so the water surface meets a bank instead of floating over
 * low DEM noise. Elsewhere the DEM is untouched.
 */
const BURN_MIN_ZOOM = 10;
const BANK_M = 34;
const channels = []; // { pts: [[lon,lat]...], half: [m...], h: [m...], bbox: [w,s,e,n] }
export function registerBurnChannel(profile) {
  const lons = profile.pts.map((p) => p[0]);
  const lats = profile.pts.map((p) => p[1]);
  const pad = 0.01;
  channels.push({ pts: profile.pts, half: profile.half, h: profile.h, bbox: [Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad] });
}

function tileBounds(z, x, y) {
  const n = 2 ** z;
  const lon = (i) => (i / n) * 360 - 180;
  const lat = (j) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return { w: lon(x), e: lon(x + 1), n: lat(y), s: lat(y + 1) };
}

function burnTile(out, W, z, x, y) {
  if (z < BURN_MIN_ZOOM || !channels.length) return;
  const b = tileBounds(z, x, y);
  // Per-sample nearest-segment search, but each segment only visits the grid cells inside its own padded bounding
  // box (was: every sample x every segment, which blocked the main thread for 100+ ms per tile and caused stutter).
  const N = W * W;
  const best = new Float32Array(N).fill(Infinity);
  const bh = new Float32Array(N);
  const bw = new Float32Array(N);
  let touched = false;
  const cosLat = Math.cos((((b.n + b.s) / 2) * Math.PI) / 180);
  const mx = 111320 * cosLat;
  const my = 110574;
  const dLon = (b.e - b.w) / (W - 1);
  const dLat = (b.s - b.n) / (W - 1); // negative (rows go south)
  for (const ch of channels) {
    if (ch.bbox[2] < b.w || ch.bbox[0] > b.e || ch.bbox[3] < b.s || ch.bbox[1] > b.n) continue;
    for (let k = 1; k < ch.pts.length; k++) {
      const a = ch.pts[k - 1];
      const c = ch.pts[k];
      const reach = Math.max(ch.half[k], ch.half[k - 1]) + BANK_M;
      const padLon = reach / mx;
      const padLat = reach / my;
      const minLon = Math.min(a[0], c[0]) - padLon, maxLon = Math.max(a[0], c[0]) + padLon;
      const minLat = Math.min(a[1], c[1]) - padLat, maxLat = Math.max(a[1], c[1]) + padLat;
      if (maxLon < b.w || minLon > b.e || maxLat < b.s || minLat > b.n) continue;
      const i0 = Math.max(0, Math.floor((minLon - b.w) / dLon));
      const i1 = Math.min(W - 1, Math.ceil((maxLon - b.w) / dLon));
      const j0 = Math.max(0, Math.floor((maxLat - b.n) / dLat));
      const j1 = Math.min(W - 1, Math.ceil((minLat - b.n) / dLat));
      const dx = (c[0] - a[0]) * mx;
      const dy = (c[1] - a[1]) * my;
      const len2 = dx * dx + dy * dy || 1;
      for (let j = j0; j <= j1; j++) {
        const lat = b.n + dLat * j;
        const ay = (a[1] - lat) * my;
        for (let i = i0; i <= i1; i++) {
          const ax = (a[0] - (b.w + dLon * i)) * mx;
          const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
          const ex = ax + dx * t;
          const ey = ay + dy * t;
          const d2 = ex * ex + ey * ey;
          const idx = j * W + i;
          if (d2 < best[idx]) {
            best[idx] = d2;
            bh[idx] = ch.h[k - 1] + (ch.h[k] - ch.h[k - 1]) * t;
            bw[idx] = ch.half[k - 1] + (ch.half[k] - ch.half[k - 1]) * t;
            touched = true;
          }
        }
      }
    }
  }
  if (!touched) return;
  for (let idx = 0; idx < N; idx++) {
    if (best[idx] === Infinity) continue;
    const d = Math.sqrt(best[idx]);
    const w = bw[idx];
    if (d <= w) {
      // channel bed: a shallow dish below the water surface
      out[idx] = Math.min(out[idx], bh[idx] - (1.0 + 1.5 * (1 - (d / w) ** 2)));
    } else if (d <= w + BANK_M) {
      // bank: at least at water level, blending back to the natural DEM
      const k = (d - w) / BANK_M;
      const kk = k * k * (3 - 2 * k); // smoothstep blend back to the natural DEM
      out[idx] = Math.max(out[idx], bh[idx] + 0.25) * (1 - kk) + out[idx] * kk;
    }
  }
}

export function terrariumTileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

// Concurrency limit for tile fetches. Unthrottled, the globe plus terrain sampling issued hundreds of simultaneous
// requests, and the browser failed many with ERR_INSUFFICIENT_RESOURCES (missing terrain tiles mid-flight).
const MAX_ACTIVE = 12;
let active = 0;
const queue = [];
function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].priority > queue[best].priority) best = i;
    const job = queue.splice(best, 1)[0];
    active++;
    job.fn().then(job.resolve, job.reject).finally(() => {
      active--;
      pump();
    });
  }
}
function limited(fn, priority = 0) {
  return new Promise((resolve, reject) => {
    queue.push({ priority, fn, resolve, reject });
    pump();
  });
}
export const terrainBusy = () => active + queue.length;

/** Fetch + decode a Terrarium tile to a Float32Array(256*256) of metres. Cached; fetches are concurrency-limited. */
export function loadTerrariumTile(z, x, y, priority = 0) {
  const key = terrariumTileKey(z, x, y);
  if (cache.has(key)) return cache.get(key);
  const p = limited(async () => {
    const url = TILE_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    let res = await fetch(url, { mode: "cors", signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!res || !res.ok) {
      await new Promise((r) => setTimeout(r, 500));
      res = await fetch(url, { mode: "cors", signal: AbortSignal.timeout(20000) }).catch(() => null);
    }
    if (!res || !res.ok) throw new Error(`terrarium ${key} -> ${res ? res.status : "timeout"}`);
    const bmp = await createImageBitmap(await res.blob());
    const cv = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
    const h = new Float32Array(TILE_SIZE * TILE_SIZE);
    for (let i = 0, j = 0; i < h.length; i++, j += 4) {
      h[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
    }
    return h;
  }, priority);
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

/** Bilinear terrain height (metres) at lon/lat from Terrarium tiles at the given zoom. */
export async function sampleTerrariumHeight(lonDeg, latDeg, zoom = MAX_ZOOM) {
  try {
  const n = 2 ** zoom;
  const latRad = (latDeg * Math.PI) / 180;
  const fx = ((lonDeg + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const tile = await loadTerrariumTile(zoom, tx, ty, 3);
  const px = (fx - tx) * (TILE_SIZE - 1);
  const py = (fy - ty) * (TILE_SIZE - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(TILE_SIZE - 1, x0 + 1);
  const y1 = Math.min(TILE_SIZE - 1, y0 + 1);
  const ax = px - x0;
  const ay = py - y0;
  const at = (x, y) => tile[y * TILE_SIZE + x];
  return (
    at(x0, y0) * (1 - ax) * (1 - ay) + at(x1, y0) * ax * (1 - ay) + at(x0, y1) * (1 - ax) * ay + at(x1, y1) * ax * ay
  );
  } catch (err) {
    console.warn("terrain sample skipped", zoom, lonDeg.toFixed(3), latDeg.toFixed(3), err?.message || err);
    return NaN;
  }
}

export function createTerrariumTerrainProvider(Cesium) {
  const tilingScheme = new Cesium.WebMercatorTilingScheme();
  const errorEvent = new Cesium.Event();
  const ready = true;

  return {
    errorEvent,
    credit: new Cesium.Credit("Terrain: AWS Terrain Tiles (SRTM / NASADEM / ETOPO1)"),
    tilingScheme,
    hasWaterMask: false,
    hasVertexNormals: false,
    ready,
    readyPromise: Promise.resolve(true),
    availability: undefined,
    getLevelMaximumGeometricError(level) {
      // Same heuristic Cesium uses for heightmap terrain on a 256-sample grid.
      const maxHeightmapWidth = 65;
      return (
        (Cesium.Ellipsoid.WGS84.maximumRadius * 2 * Math.PI * 0.25) /
        (maxHeightmapWidth * tilingScheme.getNumberOfXTilesAtLevel(0)) /
        (1 << level)
      );
    },
    getTileDataAvailable(x, y, level) {
      return level <= MAX_ZOOM;
    },
    loadTileDataAvailability() {
      return undefined;
    },
    requestTileGeometry(x, y, level) {
      if (level > MAX_ZOOM) return undefined;
      // Always accept the globe's request. Dropping it left the coarse parent tile on screen.
      return loadTerrariumTile(level, x, y, 2).then((h) => {
        // Down-sample 256 -> 65 for the mesh (every 4th sample, plus last edge) to keep tiles light.
        const W = 129;
        const out = new Float32Array(W * W);
        const step = (TILE_SIZE - 1) / (W - 1);
        for (let j = 0; j < W; j++) {
          const sy = Math.min(TILE_SIZE - 1, Math.round(j * step));
          for (let i = 0; i < W; i++) {
            const sx = Math.min(TILE_SIZE - 1, Math.round(i * step));
            out[j * W + i] = h[sy * TILE_SIZE + sx];
          }
        }
        burnTile(out, W, level, x, y);
        return new Cesium.HeightmapTerrainData({
          buffer: out,
          width: W,
          height: W,
          childTileMask: level < MAX_ZOOM ? 15 : 0,
          structure: { heightScale: 1.0, heightOffset: 0.0, elementsPerHeight: 1, stride: 1, elementMultiplier: 256.0 },
        });
      });
    },
  };
}
