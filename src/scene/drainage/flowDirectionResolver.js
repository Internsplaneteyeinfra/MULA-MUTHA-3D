/**
 * Resolve nalla flow direction using:
 * 1) KML/OSM direction attrs (if present)
 * 2) River bank topology (toward confluence)
 * 3) Terrain elevation along draped path
 *
 * Connection uses distance-to-BANK (not centerline), so wide river
 * sections are not falsely marked Disconnected.
 */

/** Max gap outside the river bank edge to count as connected (metres). */
export const RIVER_CONNECTION_THRESHOLD_M = 65;

/**
 * @param {{ pts: {x:number,y:number,z:number,lon?:number,lat?:number}[], meta: object, lengthM: number }} path
 * @param {{ x:number, z:number, halfWidth?:number, flowX?:number, flowZ?:number, along?:number }[]} riverStations
 */
export function resolveNallaFlow(path, riverStations) {
  const pts = path.pts;
  const meta = path.meta || {};
  const id = meta.osmId || meta.name || `nalla_${Math.random().toString(36).slice(2, 8)}`;

  const start = pts[0];
  const end = pts[pts.length - 1];
  const elevStart = start.y;
  const elevEnd = end.y;

  const attrDir = parseAttributeDirection(meta);
  const riverHit = nearestRiverConnection(pts, riverStations, RIVER_CONNECTION_THRESHOLD_M);

  let flowTowardEnd = true;
  let confidence = "unknown";
  let reason = "Flow direction unavailable";

  if (attrDir != null) {
    flowTowardEnd = attrDir;
    confidence = "attribute";
    reason = "Direction from KML/OSM attributes";
  } else if (riverHit) {
    const ds = Math.hypot(start.x - riverHit.riverPoint.x, start.z - riverHit.riverPoint.z);
    const de = Math.hypot(end.x - riverHit.riverPoint.x, end.z - riverHit.riverPoint.z);
    flowTowardEnd = de <= ds;
    confidence = "topology";
    reason = "Flow toward detected river connection";
  } else {
    const dElev = elevStart - elevEnd;
    if (Math.abs(dElev) >= 0.35) {
      flowTowardEnd = dElev > 0;
      confidence = "terrain";
      reason = "Flow direction estimated from terrain";
    } else {
      flowTowardEnd = elevStart >= elevEnd;
      confidence = "unknown";
      reason = "Flow direction unavailable (flat / ambiguous elevation)";
    }
  }

  const bankRef = riverHit || nearestBankReference(flowTowardEnd ? end : start, riverStations);

  const distanceToRiverM =
    bankRef?.distanceToBank != null
      ? bankRef.distanceToBank
      : riverHit?.distanceToBank != null
        ? riverHit.distanceToBank
        : null;

  const connectsToRiver =
    !!riverHit ||
    (distanceToRiverM != null && distanceToRiverM <= RIVER_CONNECTION_THRESHOLD_M);

  // Ensure connection always carries bankPoint when we claim connected
  let connection = riverHit;
  if (!connection && connectsToRiver && bankRef) connection = bankRef;
  if (connection && !connection.bankPoint && bankRef?.bankPoint) {
    connection.bankPoint = bankRef.bankPoint;
    connection.alongM = bankRef.alongM ?? connection.alongM;
  }

  return {
    id: String(id),
    name: meta.name || "Unnamed nullah",
    meta,
    pts,
    lengthM: path.lengthM || pathLength(pts),
    elevStart,
    elevEnd,
    flowTowardEnd,
    flowDirectionConfidence: confidence,
    directionReason: reason,
    connectsToRiver,
    connection,
    distanceToRiverM,
    nearestChainageMeters: connection?.alongM ?? bankRef?.alongM ?? null,
    geographicNote: "Coordinates preserved from drainage KML / local frame",
  };
}

function nearestBankReference(point, stations) {
  if (!point || !stations?.length) return null;
  const hit = nearestStationXZ(point.x, point.z, stations);
  const station = stations[hit.index];
  if (!station) return null;
  const half = Math.max(8, station.halfWidth || 40);
  const fx = station.flowX ?? 0;
  const fz = station.flowZ ?? 1;
  const lx = -fz;
  const lz = fx;
  const lat = Math.abs((point.x - station.x) * lx + (point.z - station.z) * lz);
  const gap = Math.max(0, lat - half);
  const side = Math.sign((point.x - station.x) * lx + (point.z - station.z) * lz) || 1;
  return {
    nallaPoint: { x: point.x, y: point.y, z: point.z, lon: point.lon, lat: point.lat },
    riverPoint: { x: station.x, z: station.z, y: station.y },
    bankPoint: {
      x: station.x + lx * half * side,
      z: station.z + lz * half * side,
      y: point.y,
      alongM: Number.isFinite(station.along) ? station.along : null,
      stationIndex: hit.index,
    },
    distance: hit.d,
    distanceToBank: gap,
    stationIndex: hit.index,
    alongM: Number.isFinite(station.along) ? station.along : null,
    pathIndex: -1,
    confidence: gap < 20 ? "high" : "medium",
  };
}

function parseAttributeDirection(meta) {
  const keys = ["direction", "flow", "flow_direction", "waterway:flow"];
  for (const k of keys) {
    const raw = meta[k] || meta.props?.[k];
    if (!raw) continue;
    const s = String(raw).toLowerCase();
    if (/down|forward|with|outlet|out/.test(s)) return true;
    if (/up|back|reverse|inlet|in/.test(s)) return false;
  }
  return null;
}

/**
 * Prefer the path vertex closest to the *bank edge* (lateral gap),
 * not the corridor centerline — avoids false Disconnected on wide reaches.
 */
function nearestRiverConnection(pts, stations, thresholdM) {
  if (!stations?.length || !pts?.length) return null;
  let best = null;
  let bestGap = thresholdM;

  const consider = (p, pathIndex) => {
    const hit = nearestStationXZ(p.x, p.z, stations);
    const st = stations[hit.index];
    if (!st) return;
    const half = Math.max(8, st.halfWidth || 40);
    const fx = st.flowX ?? 0;
    const fz = st.flowZ ?? 1;
    const lx = -fz;
    const lz = fx;
    const lat = Math.abs((p.x - st.x) * lx + (p.z - st.z) * lz);
    const gap = Math.max(0, lat - half);
    if (gap < bestGap || (gap === bestGap && best && hit.d < best.distance)) {
      bestGap = gap;
      const side = Math.sign((p.x - st.x) * lx + (p.z - st.z) * lz) || 1;
      best = {
        nallaPoint: { x: p.x, y: p.y, z: p.z, lon: p.lon, lat: p.lat },
        riverPoint: { x: st.x, z: st.z, y: st.y },
        bankPoint: {
          x: st.x + lx * half * 0.98 * side,
          z: st.z + lz * half * 0.98 * side,
          y: p.y,
          alongM: Number.isFinite(st.along) ? st.along : null,
          stationIndex: hit.index,
        },
        distance: hit.d,
        distanceToBank: gap,
        confidence: gap < thresholdM * 0.35 ? "high" : "medium",
        pathIndex,
        stationIndex: hit.index,
        alongM: Number.isFinite(st.along) ? st.along : null,
      };
    }
  };

  const step = Math.max(1, Math.floor(pts.length / 48));
  for (let i = 0; i < pts.length; i += step) consider(pts[i], i);
  consider(pts[0], 0);
  consider(pts[pts.length - 1], pts.length - 1);

  return best;
}

function nearestStationXZ(x, z, stations) {
  let bestI = 0;
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 500));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  for (let i = Math.max(0, bestI - 24); i <= Math.min(stations.length - 1, bestI + 24); i++) {
    const s = stations[i];
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const s = stations[bestI];
  return { x: s.x, z: s.z, d: bestD, index: bestI };
}

function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return L;
}
