import { defineConfig } from "vite";

/** Portable static hosting (GitHub Pages / Netlify / S3). Override with VITE_BASE. */
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  server: {
    port: 5176,
    strictPort: true,
    open: true,
    watch: {
      ignored: ["**/public/data/**"],
    },
  },
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  preview: {
    port: 4176,
    strictPort: true,
  },
});
