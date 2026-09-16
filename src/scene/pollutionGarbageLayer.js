/**
 * Pollution garbage layer — thin adapter over the full garbage system.
 * Kept so hydrologyLayer imports remain stable.
 */
export { createGarbageSystem as createPollutionGarbageLayer } from "./pollution/garbageSystem.js";
