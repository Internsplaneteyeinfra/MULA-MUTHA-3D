/** Register service worker for KML / OSM / GLB caching on repeat visits. */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then(async (reg) => {
        // Drop stale caches that may hold SPA HTML for data/*.kml paths
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((k) => k.startsWith("mula-mutha-") && k !== "mula-mutha-v8")
              .map((k) => caches.delete(k)),
          );
        }
        reg.update?.();
      })
      .catch((err) => {
        console.warn("Service worker registration failed:", err.message);
      });
  });
}
