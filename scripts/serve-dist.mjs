#!/usr/bin/env node
/**
 * Lightweight static server for Railway / nixpacks fallback (no Docker).
 * Serves dist/ on process.env.PORT (default 3000) with SPA fallback.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".kml": "application/vnd.google-earth.kml+xml",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".ico": "image/x-icon",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  const cleaned = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const rel = cleaned === "/" || cleaned === "" ? "index.html" : cleaned.replace(/^[/\\]+/, "");
  const full = join(ROOT, rel);
  if (!full.startsWith(ROOT)) return null;
  return full;
}

async function send(res, code, body, type) {
  res.writeHead(code, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Cache-Control": code === 200 && type?.includes("html") ? "no-cache" : "public, max-age=3600",
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/health")) {
      return send(res, 200, "ok", "text/plain; charset=utf-8");
    }

    let filePath = safePath(req.url);
    if (!filePath) return send(res, 400, "bad path");

    try {
      const st = await stat(filePath);
      if (st.isDirectory()) filePath = join(filePath, "index.html");
      const body = await readFile(filePath);
      const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
      return send(res, 200, body, type);
    } catch {
      // SPA fallback
      const index = await readFile(join(ROOT, "index.html"));
      return send(res, 200, index, MIME[".html"]);
    }
  } catch (err) {
    console.error(err);
    send(res, 500, "error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Serving dist/ on http://${HOST}:${PORT}`);
});
