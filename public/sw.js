/** Cache static assets for fast repeat visits. */
const CACHE = "mula-mutha-v5";
const PRECACHE = ["/", "/index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Never cache hydrology config / bank-erosion raster — must stay fresh
  if (
    url.pathname.includes("/hydrology/hydrologyConfig.json") ||
    url.pathname.includes("/hydrology/bank_erosion/")
  ) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
    return;
  }

  if (
    !url.pathname.startsWith("/data/") &&
    !url.pathname.startsWith("/assets/") &&
    !url.pathname.startsWith("/models/") &&
    !url.pathname.endsWith(".glb") &&
    !url.pathname.endsWith(".geojson") &&
    !url.pathname.endsWith(".kml") &&
    !url.pathname.endsWith(".csv") &&
    !url.pathname.endsWith(".tif") &&
    !url.pathname.endsWith(".png")
  ) {
    return;
  }

  // Network-first for JSON so layer defs are not stuck on stale cache
  if (url.pathname.endsWith(".json")) {
    e.respondWith(
      fetch(e.request)
        .then(async (res) => {
          if (res.ok) {
            const cache = await caches.open(CACHE);
            cache.put(e.request, res.clone());
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (await cache.match(e.request)) || Response.error();
        }),
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return hit || Response.error();
      }
    }),
  );
});
