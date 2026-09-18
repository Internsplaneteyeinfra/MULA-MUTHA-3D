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
    // RiverEye API CORS only allows localhost:3000 — proxy for local AQI/weather
    proxy: {
      "/rivereye-api": {
        target: "https://rivereye-production.up.railway.app",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/rivereye-api/, "/api"),
      },
    },
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
        // Do NOT ignore *.kml / *.geojson — Vite then returns SPA HTML for newly added public assets
        "**/public/data/**/*.kmz",
        "**/tmp/**",
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
    proxy: {
      "/rivereye-api": {
        target: "https://rivereye-production.up.railway.app",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/rivereye-api/, "/api"),
      },
    },
  },
});
