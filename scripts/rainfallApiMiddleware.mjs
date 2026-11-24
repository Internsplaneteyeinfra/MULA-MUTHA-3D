/**
 * Shared Node middleware for /api/rainfall-simulation/* (Vite + server.mjs).
 * Uses the same JS engine as the twin browser client.
 */
import * as mgr from "../src/services/rainfallSimulation/simulationManager.js";

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

function send(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": buf.length,
  });
  res.end(buf);
}

/**
 * @returns {boolean} true if handled
 */
export async function handleRainfallApi(req, res, pathname) {
  if (!pathname.startsWith("/api/rainfall-simulation")) return false;
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return true;
    }
    if (pathname === "/api/rainfall-simulation/start" && req.method === "POST") {
      const body = await readJson(req);
      send(res, 200, mgr.startSimulation(body));
      return true;
    }
    if (pathname === "/api/rainfall-simulation/update" && req.method === "POST") {
      const body = await readJson(req);
      const id = body.simulation_id || body.simulationId;
      if (!id) {
        send(res, 400, { error: "simulation_id required" });
        return true;
      }
      send(res, 200, mgr.updateSimulation(id, body));
      return true;
    }
    const m = pathname.match(/^\/api\/rainfall-simulation\/([^/]+)\/(status|pause|resume|reset|speed)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const action = m[2];
      if (action === "status" && req.method === "GET") {
        send(res, 200, mgr.getStatus(id));
        return true;
      }
      if (action === "pause" && req.method === "POST") {
        await readJson(req);
        send(res, 200, mgr.pauseSimulation(id));
        return true;
      }
      if (action === "resume" && req.method === "POST") {
        await readJson(req);
        send(res, 200, mgr.resumeSimulation(id));
        return true;
      }
      if (action === "reset" && req.method === "POST") {
        await readJson(req);
        send(res, 200, mgr.resetSimulation(id));
        return true;
      }
      if (action === "speed" && req.method === "POST") {
        const body = await readJson(req);
        const mult = body.playbackSpeed ?? body.playback_speed ?? 1;
        send(res, 200, mgr.setPlaybackSpeed(id, mult));
        return true;
      }
    }
    send(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status === 404 ? 404 : 500;
    send(res, status, { error: err?.message || String(err) });
    return true;
  }
}

/** Vite plugin */
export function rainfallApiPlugin() {
  return {
    name: "rainfall-simulation-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        const handled = await handleRainfallApi(req, res, url.pathname);
        if (!handled) next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        const handled = await handleRainfallApi(req, res, url.pathname);
        if (!handled) next();
      });
    },
  };
}
