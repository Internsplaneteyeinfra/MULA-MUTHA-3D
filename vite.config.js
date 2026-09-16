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
      // Do not ignore entire hydrology overlay folders — Vite then fails to serve
      // newly added PNGs under those paths (SPA HTML fallback → TextureLoader error).
      // Ignore only huge / locked binary data that thrash the Windows watcher.
      ignored: [
        "**/public/data/**/*.tif",
        "**/public/data/**/*.csv",
        // Do NOT ignore *.kml — Vite then returns SPA HTML for newly added public KMLs
        "**/public/data/**/*.kmz",
        "**/public/data/**/*.geojson",
        "**/tmp_*/**",
        "**/*.zip",
      ],
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
