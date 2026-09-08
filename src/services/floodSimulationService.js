/**
 * Compatibility shim — JalNetra client lives in jalnetraFloodService.js.
 * @deprecated Import from ./jalnetraFloodService.js
 */
export {
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
  FLOOD_WATER_URL,
  API_BASE,
} from "./jalnetraFloodService.js";
