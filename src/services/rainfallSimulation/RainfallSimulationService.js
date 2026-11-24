/**
 * Frontend facade for Rainfall Simulation.
 * Uses the in-browser engine/manager (always available).
 * Optionally mirrors calls to /api/rainfall-simulation when the host exposes it.
 */
import * as manager from "./simulationManager.js";
import {
  normalizeRainfallInput,
  SIM_STATUSES,
  PHASE_STATUSES,
  PLAYBACK_SPEED_PRESETS,
  VERTICAL_DATUM,
  basePlaybackHoursPerSec,
} from "./schemas.js";
import { buildRainfallResponseSeries, buildSimulationResult } from "./engine.js";
import { buildReachGeometry } from "./reachGeometry.js";

const API_BASE = "/api/rainfall-simulation";

/** Prefer local manager (works in Vite dev without FastAPI). */
const USE_LOCAL = true;

export {
  SIM_STATUSES,
  PHASE_STATUSES,
  PLAYBACK_SPEED_PRESETS,
  VERTICAL_DATUM,
  normalizeRainfallInput,
  buildRainfallResponseSeries,
  buildSimulationResult,
  buildReachGeometry,
  basePlaybackHoursPerSec,
};

/** Corridor geometry from live scene dataset (or null). */
export function getSceneReachGeometry() {
  try {
    return buildReachGeometry(window.__MM_SCENE__?.dataset);
  } catch {
    return null;
  }
}

export async function startRainfallSimulation(input) {
  if (USE_LOCAL) return manager.startSimulation(input);
  return postJson(`${API_BASE}/start`, input);
}

export async function updateRainfallSimulation(id, patch) {
  if (USE_LOCAL) return manager.updateSimulation(id, patch);
  return postJson(`${API_BASE}/update`, { simulation_id: id, ...patch });
}

export async function getRainfallStatus(id) {
  if (USE_LOCAL) return manager.getStatus(id);
  return getJson(`${API_BASE}/${encodeURIComponent(id)}/status`);
}

export async function pauseRainfallSimulation(id) {
  if (USE_LOCAL) return manager.pauseSimulation(id);
  return postJson(`${API_BASE}/${encodeURIComponent(id)}/pause`, {});
}

export async function resumeRainfallSimulation(id) {
  if (USE_LOCAL) return manager.resumeSimulation(id);
  return postJson(`${API_BASE}/${encodeURIComponent(id)}/resume`, {});
}

export async function resetRainfallSimulation(id) {
  if (USE_LOCAL) return manager.resetSimulation(id);
  return postJson(`${API_BASE}/${encodeURIComponent(id)}/reset`, {});
}

export async function setRainfallPlaybackSpeed(id, multiplier) {
  if (USE_LOCAL) return manager.setPlaybackSpeed(id, multiplier);
  return postJson(`${API_BASE}/${encodeURIComponent(id)}/speed`, {
    playbackSpeed: multiplier,
    playback_speed: multiplier,
  });
}

/**
 * Preview series without starting a session (for chart before Start).
 */
export function previewSeries(input) {
  const reachGeometry = input?.reachGeometry ?? getSceneReachGeometry();
  return buildRainfallResponseSeries(normalizeRainfallInput(input), { reachGeometry });
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readErr(res));
  return res.json();
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(await readErr(res));
  return res.json();
}

async function readErr(res) {
  try {
    const j = await res.json();
    return j.error || j.detail || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
