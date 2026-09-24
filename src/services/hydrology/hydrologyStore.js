/**
 * Hydrology Store & Reactive State Management
 *
 * Central reactive store for:
 *   - Current hydraulic profile (1,698 stations)
 *   - Boundary conditions & telemetry observations
 *   - Active reach summary (discharge, volume, mean velocity)
 *   - Listeners for smooth 3D scene & UI updates
 */

export class HydrologyStore {
  constructor() {
    this._profile = null;
    this._summary = {
      discharge_m3s: null,
      discharge_status: "UNAVAILABLE",
      meanDepth_m: null,
      meanVelocity_ms: null,
      totalVolume_m3: null,
      timestamp: null,
      source: "INITIALIZING",
    };
    this._listeners = new Set();
  }

  /**
   * Subscribe to hydrology store updates.
   * @param {(data: { profile: any, summary: typeof this._summary }) => void} listener
   * @returns {() => void} unsubscribe function
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Broadcast state change to all subscribers and dispatch DOM event.
   */
  _notify() {
    const payload = {
      profile: this._profile,
      summary: this._summary,
    };
    for (const listener of this._listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error("[HydrologyStore] Listener error:", err);
      }
    }
    if (typeof document !== "undefined") {
      document.dispatchEvent(
        new CustomEvent("hydrology-state-change", { detail: payload }),
      );
    }
  }

  /**
   * Sets new hydraulic profile result.
   * @param {any} profileResult
   */
  setHydraulicProfile(profileResult) {
    this._profile = profileResult;
    if (profileResult?.status === "SOLVED" && profileResult.records?.length) {
      const records = profileResult.records;
      const validDepths = records.map((r) => r.water_depth_m?.value).filter(Number.isFinite);
      const validVelocities = records.map((r) => r.velocity_ms?.value).filter(Number.isFinite);

      const meanD = validDepths.length
        ? validDepths.reduce((a, b) => a + b, 0) / validDepths.length
        : null;
      const meanV = validVelocities.length
        ? validVelocities.reduce((a, b) => a + b, 0) / validVelocities.length
        : null;

      const firstRec = records[0];
      this._summary = {
        discharge_m3s: firstRec.discharge_m3s?.value ?? null,
        discharge_status: firstRec.discharge_m3s?.status ?? "UNAVAILABLE",
        meanDepth_m: meanD != null ? Math.round(meanD * 100) / 100 : null,
        meanVelocity_ms: meanV != null ? Math.round(meanV * 100) / 100 : null,
        totalVolume_m3: profileResult.totalVolumeM3?.value ?? null,
        timestamp: firstRec.timestamp || new Date().toISOString(),
        source: firstRec.discharge_m3s?.source || "1D_HYDRAULIC_PROFILE",
      };
    } else {
      this._summary = {
        discharge_m3s: null,
        discharge_status: "UNAVAILABLE",
        meanDepth_m: null,
        meanVelocity_ms: null,
        totalVolume_m3: null,
        timestamp: new Date().toISOString(),
        source: profileResult?.message || "LIVE_NOT_READY",
      };
    }
    this._notify();
  }

  /**
   * Retrieve current profile.
   */
  getProfile() {
    return this._profile;
  }

  /**
   * Retrieve current summary.
   */
  getSummary() {
    return this._summary;
  }

  /**
   * Fast lookup of station record closest to given chainage in meters.
   * @param {number} meters
   */
  getStationAtChainage(meters) {
    const records = this._profile?.records;
    if (!records || !records.length) return null;
    const m = Number(meters) || 0;
    let lo = 0;
    let hi = records.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (records[mid].chainage_m <= m) lo = mid;
      else hi = mid;
    }
    const dLo = Math.abs(records[lo].chainage_m - m);
    const dHi = Math.abs(records[hi].chainage_m - m);
    return dLo <= dHi ? records[lo] : records[hi];
  }
}

export const hydrologyStore = new HydrologyStore();
