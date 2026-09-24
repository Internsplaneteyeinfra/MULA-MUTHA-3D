/**
 * Attach Mula–Mutha river geometry relationships to garbage records.
 * Uses corridor stations only — no invented measurements.
 */
import { lonLatToLocal } from "../../geo/geoReference.js";
import { nearestStationU, stationAt, smoothTangent } from "../riverCamera.js";
import { terrainHeightAt } from "../terrain.js";
import { SURFACE_Y } from "../river.js";

/** Distance ≤ halfWidth → in/on river water; ≤ 2.5× half → near river. */
const RIVER_FACTOR = 1.0;
const NEAR_FACTOR = 2.5;

/**
 * @param {object[]} records
 * @param {object[]} stations
 * @param {number} floodRiseM - Current flood rise in meters (added to SURFACE_Y)
 */
export function processGarbageAgainstRiver(records, stations = [], floodRiseM = 0) {
  const out = [];
  let riverAssociated = 0;
  let nearRiver = 0;
  let outsideRiver = 0;

  for (const r of records) {
    const local = lonLatToLocal(r.lon, r.lat);
    const x = local.x;
    const z = local.z;

    let nearestRiverPoint = null;
    let distanceToRiver = null;
    let distanceToCenterline = null;
    let riverChainageMeters = null;
    let riverStation = null;
    let isRiverAssociated = false;
    let associationStatus = "Outside River";
    let flowDirection = { x: 1, z: 0 };
    let halfWidth = 40;

    if (stations?.length) {
      const u = nearestStationU(stations, x, z);
      const st = stationAt(stations, u);
      halfWidth = Math.max(8, st.half || 40);
      nearestRiverPoint = { x: st.x, z: st.z, u };
      distanceToCenterline = Math.hypot(x - st.x, z - st.z);
      // Distance outside water (0 if inside bank-to-bank width)
      distanceToRiver = Math.max(0, distanceToCenterline - halfWidth);
      riverChainageMeters = Number.isFinite(st.along) ? st.along : null;
      riverStation = st;
      const tan = smoothTangent(stations, u, 0.03);
      flowDirection = { x: tan.x, z: tan.z };

      if (distanceToCenterline <= halfWidth * RIVER_FACTOR) {
        isRiverAssociated = true;
        associationStatus = "River";
        riverAssociated += 1;
      } else if (distanceToCenterline <= halfWidth * NEAR_FACTOR) {
        isRiverAssociated = true;
        associationStatus = "Near River";
        nearRiver += 1;
      } else {
        outsideRiver += 1;
      }
    } else {
      outsideRiver += 1;
    }

    const onWater = associationStatus === "River";
    const terrainY = stations?.length ? terrainHeightAt(x, z, stations) : SURFACE_Y;
    const waterY = SURFACE_Y + Math.max(0, floodRiseM || 0);
    // On water → sit on water surface; near/outside → terrain (never invent river placement)
    const baseY = onWater ? waterY + 0.12 : Math.max(terrainY, waterY) + 0.2;

    const phase = ((r.sourceIndex || 1) * 0.6180339887) % (Math.PI * 2);
    const velocity = onWater ? 0.08 + (Math.abs(Math.sin(phase)) * 0.06) : 0;
    const rotationSpeed = onWater ? 0.15 + Math.abs(Math.cos(phase)) * 0.1 : 0.04;

    out.push({
      ...r,
      x,
      z,
      homeX: x,
      homeZ: z,
      baseY,
      y: baseY,
      nearestRiverPoint,
      distanceToRiver,
      distanceToCenterline,
      riverChainageMeters,
      riverStationU: nearestRiverPoint?.u ?? null,
      isRiverAssociated,
      associationStatus,
      onWater,
      flowDirection,
      velocity,
      phase,
      rotationSpeed,
      halfWidth,
      // Store for dynamic flood updates:
      // - For water garbage: fixed offset 0.12 above water surface
      // - For non-water garbage: terrain height (won't change with flood)
      terrainHeight: terrainY,
      waterOffset: onWater ? 0.12 : 0.2, // Offset above reference surface
    });
  }

  return {
    records: out,
    report: {
      riverAssociated,
      nearRiver,
      outsideRiver,
      total: out.length,
    },
  };
}

/**
 * Spatial density from actual record counts only (not pollution chemistry).
 * @param {object[]} records
 * @param {number} [cellM=60]
 */
export function computeGarbageDensity(records, cellM = 60) {
  /** @type {Map<string, { count:number, x:number, z:number, ids:string[] }>} */
  const bins = new Map();
  for (const r of records) {
    const ix = Math.floor(r.x / cellM);
    const iz = Math.floor(r.z / cellM);
    const key = `${ix}:${iz}`;
    let b = bins.get(key);
    if (!b) {
      b = { count: 0, x: (ix + 0.5) * cellM, z: (iz + 0.5) * cellM, ids: [] };
      bins.set(key, b);
    }
    b.count += 1;
    b.ids.push(r.id);
  }

  const counts = [...bins.values()].map((b) => b.count).sort((a, b) => a - b);
  const q1 = counts[Math.floor(counts.length * 0.33)] || 1;
  const q2 = counts[Math.floor(counts.length * 0.66)] || 2;

  const cells = [...bins.values()].map((b) => {
    let level = "LOW";
    if (b.count > q2) level = "HIGH";
    else if (b.count > q1) level = "MEDIUM";
    return { ...b, level, cellM };
  });

  return { cells, q1, q2, cellM };
}
