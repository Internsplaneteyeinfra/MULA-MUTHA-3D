/**
 * Production server (Railway / any Node host): serves the built `dist/` and forwards
 * `/rivereye-api/*` to the RiverEye API server-side. The RiverEye API only allows
 * CORS from http://localhost:3000, so browsers on the deployed origin cannot call it directly.
 *
 *   npm run build && npm start        (PORT is provided by the platform)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const PORT = Number(process.env.PORT) || 4176;
const RIVEREYE_API = (process.env.RIVEREYE_API_TARGET || "https://rivereye-production.up.railway.app/api").replace(/\/$/, "");
const PROXY_PREFIX = "/rivereye-api";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8", ".kml": "application/vnd.google-earth.kml+xml",
  ".csv": "text/csv; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".tif": "image/tiff", ".tiff": "image/tiff", ".wasm": "application/wasm", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
};
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".geojson", ".kml", ".csv", ".svg", ".txt", ".gltf"]);

async function proxy(req, res, url) {
  const target = `${RIVEREYE_API}${url.pathname.slice(PROXY_PREFIX.length)}${url.search}`;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const upstream = await fetch(target, {
      method: req.method,
      headers: { "content-type": req.headers["content-type"] || "application/json", accept: "application/json" },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      signal: AbortSignal.timeout(30_000),
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    });
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `Upstream unreachable: ${err?.message || err}` }));
  }
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  let file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  let stat = fs.existsSync(file) ? fs.statSync(file) : null;
  if (stat?.isDirectory()) {
    file = path.join(file, "index.html");
    stat = fs.existsSync(file) ? fs.statSync(file) : null;
  }
  if (!stat) {
    // Missing real files (with an extension) must 404 — never answer them with index.html.
    if (path.extname(rel)) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    file = path.join(ROOT, "index.html");
    stat = fs.statSync(file);
  }

  const ext = path.extname(file).toLowerCase();
  const headers = {
    "content-type": MIME[ext] || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": file.split(path.sep).includes("assets") ? "public, max-age=31536000, immutable" : "public, max-age=300",
  };

  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${stat.size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") return void res.end();
    pipeline(fs.createReadStream(file, { start, end }), res, () => {});
    return;
  }

  const gzip = COMPRESSIBLE.has(ext) && stat.size > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  if (gzip) {
    res.writeHead(200, { ...headers, "content-encoding": "gzip", vary: "Accept-Encoding" });
    if (req.method === "HEAD") return void res.end();
    pipeline(fs.createReadStream(file), zlib.createGzip({ level: 6 }), res, () => {});
    return;
  }
  res.writeHead(200, { ...headers, "content-length": stat.size });
  if (req.method === "HEAD") return void res.end();
  pipeline(fs.createReadStream(file), res, () => {});
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    // Open CORS: any origin may read the app's files and the /rivereye-api proxy.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, HEAD, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] || "content-type, range");
    res.setHeader("access-control-expose-headers", "content-range, accept-ranges, content-length");
    res.setHeader("access-control-max-age", "86400");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === PROXY_PREFIX || url.pathname.startsWith(`${PROXY_PREFIX}/`)) {
      void proxy(req, res, url);
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405).end();
      return;
    }
    serveStatic(req, res, url);
  })
  .listen(PORT, "0.0.0.0", () => console.log(`[server] dist on :${PORT}, ${PROXY_PREFIX} → ${RIVEREYE_API}`));
