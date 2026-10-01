/**
 * WSE Spatial Service
 * ─────────────────────────────────────────────────────────
 * Single canonical source for Water Surface Elevation (WSE)
 * and hydraulic state at any chainage.
 *
 * Architecture:
 *   hydraulicProfileEngine (1,698 stations)
 *     → hydrologyStore (reactive cache)
 *       → wseSpatialService (binary-search interpolation)
 *         → callers (river.js, terrain.js, queries)
 *
 * Vertical reference: RELATIVE unless verticalDatumPipeline confirms MSL.
 * Manning n = 0.035 — ASSUMED; not field-calibrated.
 *
 * DO NOT invent WSE values. Return UNAVAILABLE when data is absent.
 */

import { hydrologyStore } from "./hydrologyStore.js";
import { bathymetryService } from "./bathymetryService.js";

export const WSE_PROVENANCE = {
  EXACT:         "WSE_EXACT_STATION",
  INTERPOLATED:  "WSE_INTERPOLATED",
  UNAVAILABLE:   "WSE_UNAVAILABLE",
};

class WseSpatialService {
  constructor() {
    this._cachedRecords = null;   // Float64Array[chainage_m] → sorted array of records
    this._cacheKey      = null;   // hash of profile identity
  }

  /** Called whenever hydrologyStore emits a new profile. */
  _refresh(profile) {
    if (!profile || profile.status !== "SOLVED" || !profile.records?.length) {
      this._cachedRecords = null;
      this._cacheKey = null;
      return;
    }
    // Store only the fields needed for fast spatial queries.
    this._cachedRecords = profile.records.map(r => ({
      chainage_m:        r.chainage_m,
      wse:               r.wse_msl?.value ?? null,
      wse_provenance:    r.wse_msl?.status ?? "UNAVAILABLE",
      water_depth_m:     r.water_depth_m?.value ?? null,
      depth_provenance:  r.water_depth_m?.status ?? "UNAVAILABLE",
      velocity:          r.velocity_ms?.value ?? null,
      wettedArea:        r.cross_section_area_m2?.value ?? null,
      wettedWidth:       r.width_m ?? null,
      discharge:         r.discharge_m3s?.value ?? null,
      verticalReference: r.provenance?.datum ?? "RELATIVE",
    }));
    this._cacheKey = profile.records.length + "_" + profile.records[0]?.chainage_m;
  }

  /**
   * Returns interpolated hydraulic state at the given chainage.
   * Uses binary search — O(log N). Never invokes the hydraulic solver.
   *
   * @param {number} chainageMeters
   * @returns {object}
   */
  getWSEAtChainage(chainageMeters) {
    const recs = this._cachedRecords;
    if (!recs || recs.length === 0) {
      return { wse: null, provenance: WSE_PROVENANCE.UNAVAILABLE, available: false };
    }

    const ch = Number(chainageMeters) || 0;
    const first = recs[0];
    const last  = recs[recs.length - 1];

    // Clamp to valid range
    if (ch <= first.chainage_m) return { ...first, provenance: WSE_PROVENANCE.EXACT };
    if (ch >= last.chainage_m)  return { ...last,  provenance: WSE_PROVENANCE.EXACT };

    // Binary search for surrounding bracket
    let lo = 0, hi = recs.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (recs[mid].chainage_m <= ch) lo = mid;
      else hi = mid;
    }

    const r0 = recs[lo];
    const r1 = recs[hi];

    // Exact match
    if (Math.abs(r0.chainage_m - ch) < 0.1) return { ...r0, provenance: WSE_PROVENANCE.EXACT };
    if (Math.abs(r1.chainage_m - ch) < 0.1) return { ...r1, provenance: WSE_PROVENANCE.EXACT };

    // Linear interpolation between bracketing stations
    const span = r1.chainage_m - r0.chainage_m;
    const t    = span > 0 ? (ch - r0.chainage_m) / span : 0;

    const lerp = (a, b) => (a != null && b != null) ? a + (b - a) * t : (a ?? b ?? null);

    return {
      chainage_m:       ch,
      wse:              lerp(r0.wse, r1.wse),
      water_depth_m:    lerp(r0.water_depth_m, r1.water_depth_m),
      velocity:         lerp(r0.velocity, r1.velocity),
      wettedArea:       lerp(r0.wettedArea, r1.wettedArea),
      wettedWidth:      lerp(r0.wettedWidth, r1.wettedWidth),
      discharge:        lerp(r0.discharge, r1.discharge),
      verticalReference: r0.verticalReference,
      provenance:       WSE_PROVENANCE.INTERPOLATED,
      available:        r0.wse != null || r1.wse != null,
    };
  }

  /**
   * Returns the local hydraulic depth at a specific chainage + lateral offset.
   * depth = WSE - bedElevationRelative (only if both use the same reference).
   *
   * @param {number} chainageMeters
   * @param {number} lateralOffsetMeters
   * @returns {{ depthM: number|null, wetted: boolean, provenance: string }}
   */
  getDepthAt(chainageMeters, lateralOffsetMeters) {
    const hydraulic = this.getWSEAtChainage(chainageMeters);
    const bedInfo   = bathymetryService.getRiverBedAt({
      chainageMeters,
      lateralOffsetMeters,
    });

    if (hydraulic.wse == null || !bedInfo.available) {
      // Fall back to direct survey depth if WSE unavailable
      const bathy = bathymetryService.getBathymetryAt({ chainageMeters, lateralOffsetMeters });
      const depthM = bathy.depthM ?? null;
      return {
        depthM,
        wetted:     depthM != null && depthM > 0,
        provenance: bathy.provenance ?? "UNAVAILABLE",
        wse:        null,
        bed:        null,
        verticalReference: "RELATIVE_SURVEY",
      };
    }

    // Both WSE and bed are in relative project coordinates — subtraction is valid.
    const depthM = Math.max(0, hydraulic.wse - bedInfo.bedElevationRelative);
    const epsilon = 0.005; // 5 mm numerical noise floor

    return {
      depthM:    depthM < epsilon ? 0 : depthM,
      wetted:    depthM > epsilon,
      wse:       hydraulic.wse,
      bed:       bedInfo.bedElevationRelative,
      provenance: hydraulic.provenance,
      verticalReference: hydraulic.verticalReference,
    };
  }

  /**
   * Sample a river-aligned grid and return wet/dry masks.
   * Used by river.js for geometry generation — no hydraulic solver calls.
   *
   * @param {{ chainageStart, chainageEnd, chainageStep, lateralOffsets: number[] }} opts
   * @returns {{ chainages, offsets, wse, bed, depth, wetMask }}
   */
  sampleGrid({ chainageStart, chainageEnd, chainageStep, lateralOffsets }) {
    const chs  = [];
    const offs = [];
    const wse  = [];
    const bed  = [];
    const dep  = [];
    const wet  = [];

    for (let ch = chainageStart; ch <= chainageEnd + 0.1; ch += chainageStep) {
      const hyd = this.getWSEAtChainage(ch);
      for (const off of lateralOffsets) {
        const bedInfo = bathymetryService.getRiverBedAt({ chainageMeters: ch, lateralOffsetMeters: off });
        let depthM = null;
        let isWet  = false;
        if (hyd.wse != null && bedInfo.available) {
          depthM = Math.max(0, hyd.wse - bedInfo.bedElevationRelative);
          isWet  = depthM > 0.005;
        } else if (!bedInfo.available) {
          // No bathymetry → treat as potentially wet if inside reach
          isWet = Math.abs(off) < 40; // conservative fallback
          depthM = null;
        }
        chs.push(ch);
        offs.push(off);
        wse.push(hyd.wse ?? 0);
        bed.push(bedInfo.bedElevationRelative ?? 0);
        dep.push(depthM ?? 0);
        wet.push(isWet ? 1 : 0);
      }
    }

    return {
      chainages: new Float32Array(chs),
      offsets:   new Float32Array(offs),
      wse:       new Float32Array(wse),
      bed:       new Float32Array(bed),
      depth:     new Float32Array(dep),
      wetMask:   new Uint8Array(wet),
      provenance: "WSE_SPATIAL_SERVICE",
    };
  }
}

export const wseSpatialService = new WseSpatialService();

// Reactively update cache whenever hydrologyStore emits a new profile.
hydrologyStore.subscribe(({ profile }) => wseSpatialService._refresh(profile));
