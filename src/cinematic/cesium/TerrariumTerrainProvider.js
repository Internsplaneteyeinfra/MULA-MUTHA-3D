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
const MAX_ZOOM = 13;

export const TERRARIUM_TILE_URL = TILE_URL;

const cache = new Map();

export function terrariumTileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

/** Fetch + decode a Terrarium tile to a Float32Array(256*256) of metres. Cached. */
export function loadTerrariumTile(z, x, y) {
  const key = terrariumTileKey(z, x, y);
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const url = TILE_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`terrarium ${key} -> ${res.status}`);
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
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

/** Bilinear terrain height (metres) at lon/lat from Terrarium tiles at the given zoom. */
export async function sampleTerrariumHeight(lonDeg, latDeg, zoom = MAX_ZOOM) {
  const n = 2 ** zoom;
  const latRad = (latDeg * Math.PI) / 180;
  const fx = ((lonDeg + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const tile = await loadTerrariumTile(zoom, tx, ty);
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
      return loadTerrariumTile(level, x, y).then((h) => {
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
