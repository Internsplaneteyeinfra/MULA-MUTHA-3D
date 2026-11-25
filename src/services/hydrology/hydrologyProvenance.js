/**
 * Provenance labels for NadiTwin-integrated hydrology.
 * LIVE / FORECAST / SIMULATED / MODELLED must never be conflated in the UI.
 */

import { PROVENANCE_STATUS } from "./hydrologyContract.js";

export const DATA_CLASS = Object.freeze({
  OBSERVED: "OBSERVED",
  LIVE: "LIVE",
  STALE: "STALE",
  FORECAST: "FORECAST",
  SIMULATED: "SIMULATED",
  MODELLED: "MODELLED",
  DERIVED: "DERIVED",
  INTERPOLATED: "INTERPOLATED",
  ASSUMED: "ASSUMED",
  UNAVAILABLE: "UNAVAILABLE",
});

export const NADITWIN_SOURCE = "NADITWIN_API";
export const GLOFAS_FALLBACK_SOURCE = "GLOFAS_OPEN_METEO_FALLBACK";
export const SYNTHETIC_FORECAST_SOURCE = "FORECAST_ENGINE_SYNTHETIC";

/** Dam releases are explicitly not modelled by NadiTwin. */
export const DAM_RELEASES_NOTE =
  "Dam releases (e.g. Khadakwasla) are NOT modelled; GloFAS does not see them.";

export function classifyNadiTwinLive() {
  return {
    dataClass: DATA_CLASS.LIVE,
    provenance: PROVENANCE_STATUS.MODELLED,
    source: NADITWIN_SOURCE,
    note: `NadiTwin live feed · ${DAM_RELEASES_NOTE}`,
  };
}

export function classifyNadiTwinForecast() {
  return {
    dataClass: DATA_CLASS.FORECAST,
    provenance: PROVENANCE_STATUS.MODELLED,
    source: NADITWIN_SOURCE,
    note: "NadiTwin forecast (GloFAS ensemble + routed runoff) — not observed",
  };
}

export function classifySyntheticForecast() {
  return {
    dataClass: DATA_CLASS.FORECAST,
    provenance: PROVENANCE_STATUS.MODELLED,
    source: SYNTHETIC_FORECAST_SOURCE,
    note: "Browser ForecastEngine synthetic ensemble — not live Q",
  };
}

export function classifySimulated() {
  return {
    dataClass: DATA_CLASS.SIMULATED,
    provenance: PROVENANCE_STATUS.MODELLED,
    source: "RAINFALL_SIMULATION",
    note: "Independent scenario — does not replace live observations",
  };
}

export function freshnessLabel(isoTimestamp, maxAgeMs = 15 * 60 * 1000) {
  if (!isoTimestamp) return { fresh: false, ageMs: null, label: "unknown age" };
  const t = Date.parse(isoTimestamp);
  if (!Number.isFinite(t)) return { fresh: false, ageMs: null, label: "invalid timestamp" };
  const ageMs = Date.now() - t;
  const fresh = ageMs >= 0 && ageMs <= maxAgeMs;
  const mins = Math.round(ageMs / 60000);
  return {
    fresh,
    ageMs,
    label: fresh ? `${mins} min ago` : `STALE · ${mins} min ago`,
  };
}
