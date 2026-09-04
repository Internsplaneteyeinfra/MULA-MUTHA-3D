/**
 * Resolve nalla flow direction using:
 * 1) KML/OSM direction attrs (if present)
 * 2) River connection topology (toward confluence)
 * 3) Terrain elevation along draped path
 *
 * Does not mutate original KML coordinates.
 */

export const RIVER_CONNECTION_THRESHOLD_M = 95;

/**
 * @param {{ pts: {x:number,y:number,z:number,lon?:number,lat?:number}[], meta: object, lengthM: number }} path
 * @param {{ x:number, z:number }[]} riverStations corridor stations (local XZ)
 * @returns {object} flow record
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

  let flowTowardEnd = true; // progress 0→1 along stored pts order
  let confidence = "unknown";
  let reason = "Flow direction unavailable";

  if (attrDir != null) {
    flowTowardEnd = attrDir;
    confidence = "attribute";
    reason = "Direction from KML/OSM attributes";
  } else if (riverHit) {
    // Endpoint closer to river is downstream (nalla → river)
    const dStart = Math.hypot(start.x - riverHit.nallaPoint.x, start.z - riverHit.nallaPoint.z);
    const dEnd = Math.hypot(end.x - riverHit.nallaPoint.x, end.z - riverHit.nallaPoint.z);
    // connection is on path; check which end of path is nearer to river station
    const ds = Math.hypot(start.x - riverHit.riverPoint.x, start.z - riverHit.riverPoint.z);
    const de = Math.hypot(end.x - riverHit.riverPoint.x, end.z - riverHit.riverPoint.z);
    flowTowardEnd = de <= ds; // end closer to river → flow toward end
    confidence = "topology";
    reason = "Flow toward detected river connection";
  } else {
    const dElev = elevStart - elevEnd;
    if (Math.abs(dElev) >= 0.35) {
      flowTowardEnd = dElev > 0; // higher → lower
      confidence = "terrain";
      reason = "Flow direction estimated from terrain";
    } else {
      // Weak elevation: still prefer downhill if any signal
      flowTowardEnd = elevStart >= elevEnd;
      confidence = "unknown";
      reason = "Flow direction unavailable (flat / ambiguous elevation)";
    }
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
    connectsToRiver: !!riverHit,
    connection: riverHit,
    geographicNote: "Coordinates preserved from drainage KML / local frame",
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
  // intermittent alone is not a direction
  return null;
}

function nearestRiverConnection(pts, stations, thresholdM) {
  if (!stations?.length || !pts?.length) return null;
  let best = null;
  let bestD = thresholdM;
  // Sample path points (not every vertex if very dense)
  const step = Math.max(1, Math.floor(pts.length / 40));
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    const hit = nearestStationXZ(p.x, p.z, stations);
    if (hit.d < bestD) {
      bestD = hit.d;
      best = {
        nallaPoint: { x: p.x, y: p.y, z: p.z, lon: p.lon, lat: p.lat },
        riverPoint: { x: hit.x, z: hit.z },
        distance: hit.d,
        confidence: hit.d < thresholdM * 0.45 ? "high" : "medium",
        pathIndex: i,
      };
    }
  }
  // Also check endpoints explicitly
  for (const p of [pts[0], pts[pts.length - 1]]) {
    const hit = nearestStationXZ(p.x, p.z, stations);
    if (hit.d < bestD) {
      bestD = hit.d;
      best = {
        nallaPoint: { x: p.x, y: p.y, z: p.z, lon: p.lon, lat: p.lat },
        riverPoint: { x: hit.x, z: hit.z },
        distance: hit.d,
        confidence: hit.d < thresholdM * 0.45 ? "high" : "medium",
        pathIndex: p === pts[0] ? 0 : pts.length - 1,
      };
    }
  }
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
  for (let i = Math.max(0, bestI - 20); i <= Math.min(stations.length - 1, bestI + 20); i++) {
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
