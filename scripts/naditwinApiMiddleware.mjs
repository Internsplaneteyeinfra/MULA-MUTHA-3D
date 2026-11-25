/**
 * Secure proxy: /naditwin-api/* → NadiTwin production API.
 * Used by Vite (dev/preview) and server.mjs (static host).
 * No API secrets — NadiTwin is a public read API; proxy exists for CORS + timeouts.
 */
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

const UPSTREAM =
  process.env.NADITWIN_API_BASE || "https://naditwin-production.up.railway.app";
const PREFIX = "/naditwin-api";
const DEFAULT_RIVER = "Mula-Mutha";
const TIMEOUT_MS = Number(process.env.NADITWIN_PROXY_TIMEOUT_MS || 20000);
const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** GET-only allowlist (path without query). Prevents open proxy abuse. */
const ALLOWED_PATHS = new Set([
  "/api/endpoints",
  "/api/rivers",
  "/api/sources",
  "/api/meta",
  "/api/timerange",
  "/api/state",
  "/api/live",
  "/api/discharge_profile",
  "/api/stations",
  "/api/stations.csv",
  "/api/hydrograph",
  "/api/rating",
  "/api/forecast/profile",
  "/api/today",
  "/api/margins",
  "/api/margins_locations",
  "/api/margins_chainage",
  "/api/alerts",
  "/api/alerts_chainage",
  "/api/locations",
  "/api/scorecard",
  "/api/refresh_live",
]);

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": buf.length,
  });
  res.end(buf);
}

/**
 * Recover ISO offsets mangled by query decoding: "+" → space
 * e.g. "2024-07-15T06:00:00 05:30" → "2024-07-15T06:00:00+05:30"
 * Without this, upstream `/api/state?at=` ignores the timestamp and returns LIVE.
 */
function repairAtParam(params) {
  const at = params.get("at");
  if (!at || typeof at !== "string") return;
  let fixed = at.trim();
  // Space where a timezone sign belonged
  if (/T\d{2}:\d{2}:\d{2} \d{2}:\d{2}/.test(fixed)) {
    fixed = fixed.replace(/(T\d{2}:\d{2}:\d{2}) (\d{2}:\d{2})/, "$1+$2");
  }
  // Bare "Z" / offset already fine; strip accidental double spaces
  fixed = fixed.replace(/\s+/g, "");
  if (fixed !== at) params.set("at", fixed);
}

function rewritePath(pathname, searchParams) {
  // /naditwin-api/api/state → /api/state
  let upstreamPath = pathname.slice(PREFIX.length) || "/";
  if (!upstreamPath.startsWith("/")) upstreamPath = `/${upstreamPath}`;
  if (upstreamPath === "/") upstreamPath = "/api/endpoints";

  const basePath = upstreamPath.split("?")[0];
  if (!ALLOWED_PATHS.has(basePath)) {
    return { ok: false, error: `Path not allowlisted: ${basePath}` };
  }

  const params = new URLSearchParams(searchParams);
  repairAtParam(params);
  if (!params.has("river") && basePath !== "/api/rivers" && basePath !== "/api/timerange" && basePath !== "/api/endpoints") {
    params.set("river", DEFAULT_RIVER);
  }
  // Explicitly encode `at` so upstream never sees a literal "+" as space
  const atVal = params.get("at");
  const parts = [];
  for (const [k, v] of params.entries()) {
    if (k === "at" && atVal != null) {
      parts.push(`at=${encodeURIComponent(atVal)}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  const q = parts.join("&");
  return { ok: true, path: q ? `${basePath}?${q}` : basePath };
}

function proxyUpstream(req, res, upstreamPath) {
  const target = new URL(upstreamPath, UPSTREAM);
  const lib = target.protocol === "https:" ? httpsRequest : httpRequest;
  const started = Date.now();

  const upstreamReq = lib(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: target.pathname + target.search,
      method: "GET",
      headers: {
        accept: "application/json,text/csv,*/*",
        "user-agent": "RiverEye-NadiTwin-Proxy/1.0",
      },
      timeout: TIMEOUT_MS,
    },
    (upRes) => {
      const chunks = [];
      upRes.on("data", (c) => chunks.push(c));
      upRes.on("end", () => {
        const body = Buffer.concat(chunks);
        const ct = upRes.headers["content-type"] || "application/json; charset=utf-8";
        const headers = {
          "content-type": ct,
          "cache-control": "no-store",
          "content-length": body.length,
          "x-naditwin-proxy": "1",
          "x-naditwin-upstream-status": String(upRes.statusCode || 0),
          "x-naditwin-latency-ms": String(Date.now() - started),
          "x-naditwin-url": target.toString(),
        };
        res.writeHead(upRes.statusCode || 502, headers);
        res.end(body);
      });
    },
  );

  upstreamReq.on("timeout", () => {
    upstreamReq.destroy();
    sendJson(res, 504, {
      error: "NadiTwin upstream timeout",
      timeout_ms: TIMEOUT_MS,
      upstream: target.toString(),
    });
  });

  upstreamReq.on("error", (err) => {
    sendJson(res, 502, {
      error: "NadiTwin upstream unavailable",
      message: err?.message || String(err),
      upstream: target.toString(),
    });
  });

  upstreamReq.end();
}

/**
 * @returns {boolean} true if handled
 */
export function handleNadiTwinApi(req, res, pathname, search = "") {
  if (!pathname.startsWith(PREFIX)) return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "content-type",
    }).end();
    return true;
  }

  if (!ALLOWED_METHODS.has(req.method || "GET")) {
    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  }

  if (req.method === "HEAD") {
    // Treat HEAD like GET for upstream (some hosts reject HEAD)
  }

  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rewritten = rewritePath(pathname, params);
  if (!rewritten.ok) {
    sendJson(res, 403, { error: rewritten.error });
    return true;
  }

  proxyUpstream(req, res, rewritten.path);
  return true;
}

/** Vite plugin */
export function naditwinApiPlugin() {
  return {
    name: "naditwin-api-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");
          const handled = handleNadiTwinApi(req, res, url.pathname, url.search);
          if (!handled) next();
        } catch (err) {
          sendJson(res, 500, { error: err?.message || String(err) });
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        try {
          const url = new URL(req.url || "/", "http://localhost");
          const handled = handleNadiTwinApi(req, res, url.pathname, url.search);
          if (!handled) next();
        } catch (err) {
          sendJson(res, 500, { error: err?.message || String(err) });
        }
      });
    },
  };
}

export const NADITWIN_PROXY_PREFIX = PREFIX;
export const NADITWIN_UPSTREAM = UPSTREAM;
