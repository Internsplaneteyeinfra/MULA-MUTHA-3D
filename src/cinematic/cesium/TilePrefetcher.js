/**
 * Look-ahead tile prefetcher for the cinematic camera path.
 *
 * Instead of blocking the start of the film while the camera is jumped to every upcoming shot (the old pre-stream,
 * which showed a near-black loading screen for ~10–20 s), this estimates which imagery and terrain tiles each upcoming
 * camera pose will need and downloads them in the background, in film-time order, while the film plays:
 *  - Imagery: fetches the exact ArcGIS World Imagery tile URLs Cesium requests (…/tile/{z}/{y}/{x}, cacheable), so
 *    Cesium's own request is then served from the browser HTTP cache. Terrain is left to Cesium: decoding
 *    heightmaps ahead of the photos is what painted the flat brown ground.
 * The camera never moves for this, so nothing is shown that the viewer doesn't see in the film.
 */
const IMAGERY = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

function tileXY(lon, lat, z) {
  const n = 2 ** z;
  const la = Math.max(-85, Math.min(85, lat)) * (Math.PI / 180);
  return [
    Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n))),
    Math.max(0, Math.min(n - 1, Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n))),
  ];
}

function dest(lon, lat, brgDeg, m) {
  const b = (brgDeg * Math.PI) / 180;
  return [lon + (Math.sin(b) * m) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (Math.cos(b) * m) / 110574];
}

/**
 * @param poses  [{ t, lon, lat, heading (deg), pitch (deg), range (m) }] in film-time order
 * @param opts   { viewportH, fovDeg, sse } — used to pick the zoom level Cesium will want at each distance
 * @returns {{ start(), stop(), progress(): {done,total}, readyUntil(t): boolean }}
 */
export function createTilePrefetcher(poses, { viewportH = 720, fovDeg = 52, sse = 1, concurrency = 8 } = {}) {
  const fov = (fovDeg * Math.PI) / 180;
  const jobs = []; // { t, kind, z, x, y }
  const seen = new Set();
  const add = (t, kind, z, x, y) => {
    if (z < 0 || x < 0 || y < 0) return;
    const n = 2 ** z;
    if (x >= n || y >= n) return;
    const k = `${kind}/${z}/${x}/${y}`;
    if (seen.has(k)) return;
    seen.add(k);
    jobs.push({ t, kind, z, x, y });
  };

  for (const p of poses) {
    if (p.range > 2.5e5) continue; // global/continental views: low-level tiles, Cesium loads them quickly itself
    const pr = (Math.abs(p.pitch) * Math.PI) / 180;
    const D = p.range * Math.cos(pr); // horizontal camera-target distance
    const H = p.range * Math.sin(pr);
    const close = p.range < 6000;
    // The near ground (bottom of an oblique frame) needs a finer tile than the river at the centre.
    const alongs = close ? [-0.9, -0.15, 0.8] : [0, 1.15];
    const acrosses = close ? [-0.9, 0, 0.9] : [-0.7, 0.7];
    for (const along of alongs) {
      const dAlong = along * Math.max(D, 0.6 * H);
      const ground = Math.hypot(D + dAlong, H);
      const half = ground * Math.tan(fov / 2) * 1.7; // horizontal half-width at that distance (16:9)
      // One imagery texel per screen pixel. ceil, not round: rounding down prefetches the coarse parent
      // that Cesium then magnifies across the frame.
      const pixel = (ground * fov) / Math.max(64, viewportH) * Math.max(0.75, sse);
      for (const across of acrosses) {
        const [lo, la] = dest(...dest(p.lon, p.lat, p.heading, dAlong), p.heading + 90, across * half);
        const zFloat = Math.log2((156543 * Math.cos((la * Math.PI) / 180)) / Math.max(pixel, 0.05));
        // Close shots use the next finer level. Rounding down there is the magnified parent tile.
        const z = Math.max(4, Math.min(17, close ? Math.ceil(zFloat) : Math.round(zFloat)));
        const [x, y] = tileXY(lo, la, z);
        const ring = close && along < -0.5 ? 1 : 0;
        for (let dy = -ring; dy <= ring; dy++) {
          for (let dx = -ring; dx <= ring; dx++) add(p.t, "img", z, x + dx, y + dy);
        }
        // A coarse photograph of the same place. Without it the globe paints a flat terrain colour
        // until the sharp tile arrives. These few tiles are what stop the blank frames.
        if (along === alongs[0] && across === acrosses[0]) {
          for (const zc of [8, 11, 13]) {
            const [cx, cy] = tileXY(lo, la, zc);
            add(p.t, "img", zc, cx, cy);
          }
        }
      }
    }
  }
  // Prepare the Ganga valley before its close approach, and prepare Khadakwasla several seconds before the cut.
  // The old 5.3→6.0 camera relocation outran this queue and landed on unrefined terrain tiles.
  const priorityTime = (t) => (t >= 18.5 ? t - 8 : t >= 11 && t < 16 ? t - 6 : t >= 5.3 && t < 8.5 ? t - 5.3 : t);
  jobs.sort((a, b) => priorityTime(a.t) - priorityTime(b.t) || a.t - b.t || (a.kind === b.kind ? 0 : a.kind === "img" ? -1 : 1));

  let next = 0, active = 0, done = 0, failed = 0, stopped = true;
  const finished = new Uint8Array(jobs.length);
  const run = () => {
    while (!stopped && active < concurrency && next < jobs.length) {
      const i = next++;
      const j = jobs[i];
      active++;
      const p = fetch(`${IMAGERY}/${j.z}/${j.y}/${j.x}`, { mode: "cors", credentials: "omit", signal: AbortSignal.timeout(8000) }).then((r) => {
        if (!r.ok) throw new Error(`imagery ${j.z}/${j.x}/${j.y} -> ${r.status}`);
        return r.arrayBuffer();
      });
      p.catch(() => { failed++; }).finally(() => {
        active--;
        done++;
        finished[i] = 1;
        run();
      });
    }
  };
  return {
    start() { stopped = false; run(); },
    stop() { stopped = true; },
    progress: () => ({ done, total: jobs.length, active, next, failed }),
    /** true when every tile needed for poses up to film time t has been downloaded */
    readyUntil(t) {
      for (let i = 0; i < jobs.length; i++) if (jobs[i].t <= t && !finished[i]) return false;
      return true;
    },
  };
}
