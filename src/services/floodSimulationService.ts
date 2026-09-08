/**
 * TypeScript entry alias for JalNetra Flood Water API.
 * Implementation lives in jalnetraFloodService.js (Vite ESM).
 */
export {
  API_BASE,
  FLOOD_WATER_URL,
  cancelJalnetraFloodRequest,
  cancelFloodSimulationRequest,
  isValidApiDate,
  todayApiDate,
  shiftApiDate,
  postFloodWater,
  downloadFloodWaterKml,
  parseFloodOverlayKml,
  sampleFloodRaster,
  fetchJalnetraFlood,
  fetchFloodSimulation,
  runFloodSimulation,
  getFloodStatus,
  normalizeFloodResult,
} from "./jalnetraFloodService.js";
