/**
 * Hydrology Profile Service
 *
 * Orchestrates the complete pipeline:
 * 1. Loads authoritative chainage stations & sounding depths
 * 2. Prefers NadiTwin live Q (via proxy) as LIVE discharge authority
 * 3. Falls back to GloFAS / telemetry / seasonal baseline (never synthetic as LIVE)
 * 4. Solves 1D hydraulic profile using HydraulicProfileEngine
 * 5. Overlays NadiTwin per-station Q onto profile records
 */

import { HydraulicProfileEngine } from "./hydraulicProfileEngine.js";
import { telemetryService } from "./hydrologyTelemetryService.js";
import { hydrologyStore } from "./hydrologyStore.js";
import { PROVENANCE_STATUS } from "./hydrologyContract.js";
import { startLiveHydrologyPolling, subscribeLiveHydrology } from "./liveHydrologyService.js";
import {
  applyNadiTwinQToProfileRecords,
  getNadiTwinDischargeAtChainage,
  getNadiTwinLiveBundle,
  refreshNadiTwinHydrology,
  setLocalChainageStations,
  startNadiTwinHydrologyPolling,
  subscribeNadiTwinHydrology,
} from "./naditwinHydrologyAdapter.js";
import { DATA_CLASS } from "./hydrologyProvenance.js";

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
      setLocalChainageStations(stations);

      // NadiTwin LIVE authority (proxied)
      startNadiTwinHydrologyPolling(60_000);
      subscribeNadiTwinHydrology((snap) => {
        const q = snap?.live?.discharge_m3s;
        if (!Number.isFinite(q) || q <= 0) return;
        refreshHydrologyProfile({
          discharge_m3s: q,
          source: snap.live.source || "NADITWIN_API",
          provenance: snap.live.provenance || PROVENANCE_STATUS.MODELLED,
          dataClass: DATA_CLASS.LIVE,
          allowSynthetic: false,
        });
      });

      // GloFAS fallback only when NadiTwin unavailable
      startLiveHydrologyPolling();
      subscribeLiveHydrology((liveData) => {
        if (getNadiTwinLiveBundle()?.discharge_m3s != null) return;
        if (!liveData?.available || !Number.isFinite(liveData.Q_total) || liveData.Q_total <= 0) return;
        const fromGlofas = Number.isFinite(liveData.Q_glofas);
        refreshHydrologyProfile({
          discharge_m3s: liveData.Q_total,
          source: fromGlofas
            ? `GLOFAS_OPEN_METEO_FALLBACK — Q=${liveData.Q_glofas} m³/s (${liveData.Q_glofas_date})`
            : `LIVE_RAINFALL_RUNOFF_FALLBACK — ${liveData.weatherDescription ?? ""}`,
          provenance: PROVENANCE_STATUS.MODELLED,
          dataClass: DATA_CLASS.MODELLED,
          allowSynthetic: false,
        });
      });

      await refreshNadiTwinHydrology().catch(() => {});
      await refreshHydrologyProfile({ allowSynthetic: false });

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
 * @param {string} [customParams.dataClass]
 * @param {boolean} [customParams.allowSynthetic=false] — synthetic ForecastEngine must not set LIVE
 */
export async function refreshHydrologyProfile(customParams = {}) {
  if (!_engineInstance) {
    await initHydrologyProfileService();
  }
  if (!_engineInstance) return null;

  const allowSynthetic = customParams.allowSynthetic === true;
  let Q = customParams.discharge_m3s ?? null;
  let source = customParams.source ?? "INITIAL_RATING_BASELINE";
  let provenance = customParams.provenance ?? PROVENANCE_STATUS.VERIFIED;
  let dataClass = customParams.dataClass || null;

  if (Q == null) {
    // 1. NadiTwin LIVE
    const nt = getNadiTwinDischargeAtChainage(0) || getNadiTwinLiveBundle();
    const ntQ = nt?.q_m3s ?? nt?.discharge_m3s;
    if (Number.isFinite(ntQ) && ntQ > 0) {
      Q = ntQ;
      source = nt.source || "NADITWIN_API";
      provenance = nt.provenance || PROVENANCE_STATUS.MODELLED;
      dataClass = DATA_CLASS.LIVE;
    }
  }

  if (Q == null) {
    const bundObs = telemetryService.getObservation("cwc_bund_garden");
    if (bundObs?.discharge?.value != null) {
      Q = bundObs.discharge.value;
      source = "CWC_BUND_GARDEN_TELEMETRY";
      provenance = bundObs.discharge.status;
      dataClass = DATA_CLASS.LIVE;
    }
  }

  if (Q == null) {
    const { getCachedLiveHydrology } = await import("./liveHydrologyService.js");
    const live = getCachedLiveHydrology();
    if (live?.available && Number.isFinite(live.Q_total) && live.Q_total > 0) {
      Q = live.Q_total;
      source = Number.isFinite(live.Q_glofas)
        ? `GLOFAS_OPEN_METEO_FALLBACK — Q=${live.Q_glofas} m³/s (${live.Q_glofas_date})`
        : `LIVE_RAINFALL_RUNOFF_FALLBACK`;
      provenance = PROVENANCE_STATUS.MODELLED;
      dataClass = DATA_CLASS.MODELLED;
    }
  }

  // Synthetic ForecastEngine is NEVER used as LIVE authority.
  if (Q == null && allowSynthetic) {
    try {
      const { getLiveDischargeAtChainage } = await import("../forecastService.js");
      const liveQ = await getLiveDischargeAtChainage(0);
      if (Number.isFinite(liveQ) && liveQ > 0) {
        Q = liveQ;
        source = "FORECAST_ENGINE_SYNTHETIC — not LIVE";
        provenance = PROVENANCE_STATUS.MODELLED;
        dataClass = DATA_CLASS.FORECAST;
      }
    } catch {
      /* fall through */
    }
  }

  if (Q == null) {
    Q = 65.0;
    source = "PUNE_URBAN_CORRIDOR_SEASONAL_BASEFLOW";
    provenance = PROVENANCE_STATUS.MODELLED;
    dataClass = DATA_CLASS.MODELLED;
  }

  // Reject accidental synthetic overwrite of an existing LIVE NadiTwin profile
  if (
    !allowSynthetic &&
    typeof source === "string" &&
    /synthetic|forecast engine/i.test(source) &&
    getNadiTwinLiveBundle()?.discharge_m3s != null
  ) {
    console.warn("[HydrologyProfileService] Blocked synthetic Q overwrite of NadiTwin LIVE");
    return hydrologyStore.getProfile();
  }

  const result = _engineInstance.solveProfile({
    upstreamQ_m3s: Q,
    dischargeSource: source,
    dischargeProvenance: provenance,
  });

  if (result?.records?.length) {
    applyNadiTwinQToProfileRecords(result.records);
    const first = result.records[0];
    if (first?.discharge_m3s) {
      first.discharge_m3s.dataClass = dataClass || first.discharge_m3s.dataClass || DATA_CLASS.MODELLED;
    }
  }

  if (result?.summary) {
    result.summary.dataClass = dataClass;
  }

  hydrologyStore.setHydraulicProfile(result);
  return result;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
