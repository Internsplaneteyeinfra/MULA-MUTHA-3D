import { defineConfig } from "vite";

/** Portable static hosting (GitHub Pages / Netlify / S3). Override with VITE_BASE. */
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  server: {
    host: true,
    port: 5176,
    strictPort: true,
    open: true,
    // Large GeoJSON / TIFF over tunnels — keep connections warm
    headers: {
      "Cache-Control": "public, max-age=120",
    },
    watch: {
      // Do not ignore public/data entirely — new overlays must be served.
      // Ignore only huge rasters that thrash the watcher.
      ignored: ["**/public/data/**/*.tif", "**/public/data/**/*.csv"],
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  preview: {
    host: true,
    port: 4176,
    strictPort: true,
  },
});
