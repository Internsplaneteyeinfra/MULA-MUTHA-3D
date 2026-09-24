/**
 * Hydrology Telemetry Connector Service
 *
 * Authoritative external connector interface for real-time / operational telemetry.
 * Connectors strictly report UNAVAILABLE when live endpoints or credentials
 * are not reachable, and NEVER fabricate fake observations.
 */

import { PROVENANCE_STATUS, createStationObservation } from "./hydrologyContract.js";

/** Authoritative gauge definitions along Mula–Mutha corridor */
export const GAUGE_STATIONS = [
  {
    stationId: "cwc_bund_garden",
    stationName: "Bund Garden (CWC / MWRD)",
    agency: "Central Water Commission / MWRD",
    cwcId: "028-MDH-PUNE",
    lat: 18.543024,
    lon: 73.883100,
    chainage_m: 3451.9,
    warningLevel_m: 546.5,
    dangerLevel_m: 548.0,
    endpointConfig: {
      type: "REST_OR_WRIS",
      url: null, // Configurable via window.__RIVEREYE_TELEMETRY_ENDPOINT__
    },
  },
  {
    stationId: "mwrd_sangam",
    stationName: "Sangam Bridge Gauge (MWRD)",
    agency: "Maharashtra Water Resources Dept",
    lat: 18.5312091,
    lon: 73.8602323,
    chainage_m: 621.9,
    warningLevel_m: 550.0,
    dangerLevel_m: 551.5,
    endpointConfig: {
      type: "MWRD_RTDAS",
      url: null,
    },
  },
  {
    stationId: "khadakwasla_outflow",
    stationName: "Khadakwasla Reservoir Release",
    agency: "MWRD Flood Control Room",
    lat: 18.4419,
    lon: 73.7634,
    chainage_m: 0.0, // Upstream boundary feeder
    endpointConfig: {
      type: "MWRD_BULLETIN",
      url: null,
    },
  },
];

class HydrologyTelemetryService {
  constructor() {
    /** @type {Map<string, ReturnType<typeof createStationObservation>>} */
    this.latestObservations = new Map();
    this._initDefaultState();
  }

  _initDefaultState() {
    for (const g of GAUGE_STATIONS) {
      this.latestObservations.set(
        g.stationId,
        createStationObservation({
          stationId: g.stationId,
          stationName: g.stationName,
          lat: g.lat,
          lon: g.lon,
          timestamp: null,
          discharge_m3s: null,
          stage_m_msl: null,
          source: g.agency,
          status: PROVENANCE_STATUS.UNAVAILABLE,
          quality: "AWAITING_TELEMETRY_FEED",
        }),
      );
    }
  }

  /**
   * Attempt to fetch telemetry from configured endpoints.
   * If not configured or network fails, cleanly sets UNAVAILABLE without fabricating numbers.
   * @param {string} stationId
   */
  async fetchStationTelemetry(stationId) {
    const station = GAUGE_STATIONS.find((s) => s.stationId === stationId);
    if (!station) return null;

    const customUrl = window.__RIVEREYE_TELEMETRY_ENDPOINT__ || station.endpointConfig.url;
    if (!customUrl) {
      const obs = createStationObservation({
        stationId: station.stationId,
        stationName: station.stationName,
        lat: station.lat,
        lon: station.lon,
        timestamp: null,
        discharge_m3s: null,
        stage_m_msl: null,
        source: station.agency,
        status: PROVENANCE_STATUS.UNAVAILABLE,
        quality: "ENDPOINT_UNCONFIGURED",
      });
      this.latestObservations.set(stationId, obs);
      return obs;
    }

    try {
      const res = await fetch(`${customUrl}?station=${encodeURIComponent(station.stationId)}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const obs = createStationObservation({
        stationId: station.stationId,
        stationName: station.stationName,
        lat: station.lat,
        lon: station.lon,
        timestamp: data.timestamp || new Date().toISOString(),
        discharge_m3s: Number.isFinite(data.discharge_m3s) ? data.discharge_m3s : null,
        stage_m_msl: Number.isFinite(data.stage_m_msl) ? data.stage_m_msl : null,
        source: data.source || station.agency,
        status: data.isLive ? PROVENANCE_STATUS.OBSERVED : PROVENANCE_STATUS.UNAVAILABLE,
        quality: data.quality || "LIVE_TELEMETRY",
      });
      this.latestObservations.set(stationId, obs);
      return obs;
    } catch (err) {
      console.warn(`[HydrologyTelemetry] Failed to fetch station ${stationId}:`, err.message);
      const obs = createStationObservation({
        stationId: station.stationId,
        stationName: station.stationName,
        lat: station.lat,
        lon: station.lon,
        timestamp: null,
        discharge_m3s: null,
        stage_m_msl: null,
        source: station.agency,
        status: PROVENANCE_STATUS.UNAVAILABLE,
        quality: "FETCH_FAILED_NETWORK_OR_TIMEOUT",
      });
      this.latestObservations.set(stationId, obs);
      return obs;
    }
  }

  /**
   * Ingest a verified external observation package (e.g. from an operator upload or verified API).
   * @param {string} stationId
   * @param {{ discharge_m3s?: number|null, stage_m_msl?: number|null, timestamp: string, source: string }} payload
   */
  ingestVerifiedObservation(stationId, payload) {
    const station = GAUGE_STATIONS.find((s) => s.stationId === stationId);
    if (!station) return false;

    const obs = createStationObservation({
      stationId: station.stationId,
      stationName: station.stationName,
      lat: station.lat,
      lon: station.lon,
      timestamp: payload.timestamp,
      discharge_m3s: payload.discharge_m3s ?? null,
      stage_m_msl: payload.stage_m_msl ?? null,
      source: payload.source || station.agency,
      status: PROVENANCE_STATUS.OBSERVED,
      quality: "VERIFIED_OPERATOR_INGEST",
    });
    this.latestObservations.set(stationId, obs);
    return true;
  }

  /**
   * Returns current observation record for a station.
   * @param {string} stationId
   */
  getObservation(stationId) {
    return this.latestObservations.get(stationId) || null;
  }

  /**
   * Returns all station observations.
   */
  getAllObservations() {
    return Array.from(this.latestObservations.values());
  }
}

export const telemetryService = new HydrologyTelemetryService();
