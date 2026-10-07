/**
 * Hydrology Profile Service
 *
 * Orchestrates the complete pipeline:
 * 1. Loads authoritative 1,698 chainage stations & sounding depths
 * 2. Checks telemetry service for active gauge observations
 * 3. Solves 1D hydraulic profile using HydraulicProfileEngine
 * 4. Pushes results to HydrologyStore
 */

import { HydraulicProfileEngine } from "./hydraulicProfileEngine.js";
import { telemetryService, GAUGE_STATIONS } from "./hydrologyTelemetryService.js";
import { hydrologyStore } from "./hydrologyStore.js";
import { PROVENANCE_STATUS } from "./hydrologyContract.js";
import { startLiveHydrologyPolling, subscribeLiveHydrology } from "./liveHydrologyService.js";

let _engineInstance = null;
let _initPromise = null;

/**
 * Bootstrap the hydrology profile service (idempotent).
 * @param {Array<{ chainage_m: number, width_m: number, lon: number, lat: number }>} [chainageData]
 * @param {Array<{ chainage_m: number, depth_m: number, flagged?: boolean }>} [soundingData]
 */
export async function initHydrologyProfileService(chainageData = null, soundingData = null) {
  if (!_initPromise) {
    _initPromise = (async () => {
      let stations = chainageData;
      let soundings = soundingData;

      // Ensure stations have required hydraulic properties (chainage_m, width_m)
      if (!stations || !stations.length || stations[0]?.width_m == null) {
        stations = await fetchJson("/data/naditwin/chainage_profile.json").catch(() => []);
      }
      if (!soundings || !soundings.length) {
        soundings = await fetchJson("/data/naditwin/depth_profile.json").catch(() => []);
      }

      if (!stations.length) {
        console.warn("[HydrologyProfileService] Chainage profile unavailable");
        return null;
      }

      _engineInstance = new HydraulicProfileEngine(stations, soundings);

      // Start live Open-Meteo polling (every 15 min, free, no API key)
      startLiveHydrologyPolling();

      // Re-solve hydraulic profile whenever new rainfall data arrives
      subscribeLiveHydrology((liveData) => {
        if (liveData?.available && Number.isFinite(liveData.Q_runoff) && liveData.Q_runoff > 0.5) {
          refreshHydrologyProfile({
            discharge_m3s: liveData.Q_total,
            source: `LIVE_RAINFALL_RUNOFF — ${liveData.weatherDescription ?? ""} — ${liveData.currentRain_mm_hr ?? 0} mm/hr`,
            provenance: PROVENANCE_STATUS.LIVE,
          });
          console.info(
            `[LiveHydrology] Profile updated: Q=${liveData.Q_total.toFixed(1)} m³/s`,
            `(rain=${liveData.currentRain_mm_hr} mm/hr, baseflow=${liveData.Q_baseflow} m³/s)`
          );
        }
      });

      // Attempt initial solve with verified telemetry or initial baseline
      await refreshHydrologyProfile();

      return _engineInstance;
    })();
  }
  return _initPromise;
}

/**
 * Solves the hydraulic profile given current boundary conditions.
 * @param {object} [customParams]
 * @param {number} [customParams.discharge_m3s]
 * @param {string} [customParams.source]
 * @param {string} [customParams.provenance]
 */
export async function refreshHydrologyProfile(customParams = {}) {
  if (!_engineInstance) {
    await initHydrologyProfileService();
  }
  if (!_engineInstance) return null;

  // 1. Check Bund Garden / Khadakwasla telemetry
  let Q = customParams.discharge_m3s ?? null;
  let source = customParams.source ?? "INITIAL_RATING_BASELINE";
  let provenance = customParams.provenance ?? PROVENANCE_STATUS.VERIFIED;

  if (Q == null) {
    const bundObs = telemetryService.getObservation("cwc_bund_garden");
    if (bundObs?.discharge?.value != null) {
      Q = bundObs.discharge.value;
      source = "CWC_BUND_GARDEN_TELEMETRY";
      provenance = bundObs.discharge.status;
    } else {
      const { getCachedLiveHydrology } = await import("./liveHydrologyService.js");
      const live = getCachedLiveHydrology();
      // Rainfall-runoff only when rain is actually contributing (not dry-season baseflow 15/35).
      if (live?.available && Number.isFinite(live.Q_runoff) && live.Q_runoff > 0.5) {
        Q = live.Q_total;
        source = `LIVE_RAINFALL_RUNOFF — ${live.weatherDescription ?? ""} — ${live.currentRain_mm_hr ?? 0} mm/hr`;
        provenance = PROVENANCE_STATUS.LIVE;
      } else {
        try {
          const { getLiveDischargeAtChainage } = await import("../forecastService.js");
          const liveQ = await getLiveDischargeAtChainage(0);
          if (Number.isFinite(liveQ) && liveQ > 0) {
            Q = liveQ;
            source = "LIVE_REACH";
            provenance = PROVENANCE_STATUS.LIVE;
          }
        } catch {
          /* fall through */
        }
        if (Q == null) {
          Q = 65.0;
          source = "PUNE_URBAN_CORRIDOR_SEASONAL_BASEFLOW";
          provenance = PROVENANCE_STATUS.MODELLED ?? PROVENANCE_STATUS.VERIFIED;
        }
      }
    }
  }

  const result = _engineInstance.solveProfile({
    upstreamQ_m3s: Q,
    dischargeSource: source,
    dischargeProvenance: provenance,
  });

  hydrologyStore.setHydraulicProfile(result);
  return result;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
