import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, rmSync, statSync } from "node:fs";
import { normalize, resolve, sep } from "node:path";
import { rainfallApiPlugin } from "./scripts/rainfallApiMiddleware.mjs";

/** The 35 MB film master is the recording source only; visitors stream the 1080p / 720p copies. */
const dropFilmMaster = {
  name: "drop-film-master",
  apply: "build",
  closeBundle() {
    rmSync(resolve("dist/video/landing-film.mp4"), { force: true });
  },
};

/**
 * Serve silt/LULC overlays straight from disk.
 * Vite's publicFiles set misses files added while those folders are watch-ignored
 * (SPA HTML → TextureLoader "Image load error").
 */
function serveHydrologyOverlaysFromDisk() {
  const publicRoot = resolve("public");
  const prefixes = ["/data/hydrology/silt/", "/data/hydrology/lulc/"];
  const types = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".json": "application/json",
    ".kml": "application/vnd.google-earth.kml+xml",
  };

  return {
    name: "serve-hydrology-overlays-from-disk",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = (req.url || "").split("?")[0];
        if (!prefixes.some((p) => raw.startsWith(p))) return next();
        let rel;
        try {
          rel = decodeURIComponent(raw).replace(/^\/+/, "");
        } catch {
          return next();
        }
        const filePath = normalize(resolve(publicRoot, rel));
        if (!filePath.startsWith(publicRoot + sep) && filePath !== publicRoot) return next();
        if (!existsSync(filePath) || !statSync(filePath).isFile()) return next();
        const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
        if (types[ext]) res.setHeader("Content-Type", types[ext]);
        res.setHeader("Cache-Control", "no-store");
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

/** Portable static hosting (GitHub Pages / Netlify / S3). Override with VITE_BASE. */
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  plugins: [react(), dropFilmMaster, rainfallApiPlugin(), serveHydrologyOverlaysFromDisk()],
  assetsInclude: ["**/*.kml"],
  server: {
    host: true,
    port: 5185,
    strictPort: false,
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
      // Ignore locked GIS dumps so Windows watcher does not EBUSY-crash.
      // Overlay PNGs are still served via serveHydrologyOverlaysFromDisk().
      ignored: [
        "**/public/data/**/*.tif",
        "**/public/data/**/*.csv",
        "**/public/data/**/*.kmz",
        "**/public/data/hydrology/lulc/**",
        "**/public/data/hydrology/silt/**",
        "**/src/data/**",
        "**/*.kmz",
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
    port: 4185,
    strictPort: false,
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
