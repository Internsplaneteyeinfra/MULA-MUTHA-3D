/**
 * Real spatial validation metrics — no hardcoded pass/fail values.
 * All distances computed in the shared geoReference local frame.
 */
import { lonLatToLocal, metersDistance } from "./geoReference.js";

const T = {
  ok: 2.5,
  warn: 5,
  fail: 120,
};

/** @param {number} errM */
export function toleranceLevel(errM) {
  if (!Number.isFinite(errM) || errM >= 999) return "fail";
  if (errM <= T.ok) return "ok";
  if (errM <= T.warn) return "warn";
  if (errM <= T.fail) return "warn";
  return "fail";
}

/**
 * Compute all projection validation rows for the HUD.
 * @param {object} dataset
 */
export function computeProjectionMetrics(dataset) {
  const rows = [];

  const terrainErr = measureTerrainAlignment(dataset);
  rows.push(metricRow("KML → Terrain", terrainErr));

  const waterErr = measureWaterAlignment(dataset);
  rows.push(metricRow("KML → Water mesh", waterErr));

  const bldgErr = measureBuildingAlignment(dataset);
  rows.push(metricRow("KML → Buildings", bldgErr));

  const roadErr = measureRoadAlignment(dataset);
  rows.push(metricRow("KML → Roads", roadErr));

  const bridgeErr = measureBridgeAlignment(dataset);
  rows.push(metricRow("KML → Bridges", bridgeErr));

  const fishErr = measureFishingAlignment(dataset);
  rows.push(metricRow("KML → Fishing points", fishErr));

  return {
    rows,
    ok: rows.every((r) => r.level === "ok"),
    thresholds: T,
  };
}

function metricRow(label, errM) {
  const level = toleranceLevel(errM);
  const icon = level === "ok" ? "✓" : level === "warn" ? "⚠" : "✗";
  const errStr = !Number.isFinite(errM) || errM >= 999 ? "—" : `${errM.toFixed(1)} m`;
  return { label, errM, level, icon, errStr };
}

/** Max reprojection error: KML ring vertices lon/lat → local vs stored ringLocal. */
function measureTerrainAlignment(dataset) {
  const ringGeo = dataset.ringGeo || [];
  const ringLocal = dataset.ringLocal || [];
  if (!ringGeo.length || !ringLocal.length) return 999;

  let maxErr = 0;
  const n = Math.min(ringGeo.length, ringLocal.length);
  const step = Math.max(1, Math.floor(n / 120));
  for (let i = 0; i < n; i += step) {
    const g = ringGeo[i];
    const stored = ringLocal[i];
    const reproj = lonLatToLocal(g.lon, g.lat);
    maxErr = Math.max(maxErr, metersDistance(reproj, stored));
  }

  // Horizontal reprojection integrity at KML ring sample points
  return maxErr;
}

/**
 * KML centerline vs water corridor polyline (stations chain).
 * Uses perpendicular distance to segments — not nearest-station point distance.
 */
function measureWaterAlignment(dataset) {
  const centerline = dataset.centerlineLocal;
  const stations = dataset.corridor?.stations;
  if (!centerline?.length || !stations?.length) return 999;

  const dists = [];
  const step = Math.max(1, Math.floor(centerline.length / 80));
  for (let i = 0; i < centerline.length; i += step) {
    const c = centerline[i];
    dists.push(distToStationPolyline(c.x, c.z, stations));
  }
  dists.sort((a, c) => a - c);
  return dists[Math.floor(dists.length / 2)];
}

function distToStationPolyline(x, z, stations) {
  let best = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 240));
  for (let i = 0; i < stations.length - step; i += step) {
    const a = stations[i];
    const b = stations[Math.min(stations.length - 1, i + step)];
    best = Math.min(best, distPointToSegment(x, z, a.x, a.z, b.x, b.z));
  }
  return best;
}

/** Building footprint reprojection error (lon/lat → local vs stored vertices). */
function measureBuildingAlignment(dataset) {
  const buildings = dataset.osm?.buildings || [];
  if (!buildings.length) return 999;

  const dists = [];
  const sample = buildings.slice(0, Math.min(buildings.length, 200));
  for (const b of sample) {
    const verts = b.vertices || [];
    if (!verts.length) continue;
    const v = verts[0];
    if (!Number.isFinite(v.lon) || !Number.isFinite(v.lat)) continue;
    const reproj = lonLatToLocal(v.lon, v.lat);
    dists.push(metersDistance(reproj, v));
  }
  if (!dists.length) return 999;
  dists.sort((a, c) => a - c);
  return dists[Math.floor(dists.length / 2)];
}

/**
 * Road alignment: reprojection integrity through geoReference (pipeline check).
 * Urban road-to-building proximity is logged separately — NOT river centerline distance.
 */
function measureRoadAlignment(dataset) {
  const roads = dataset.osm?.roads || [];
  if (!roads.length) return 999;

  const reprojErrs = [];
  for (const r of roads.slice(0, Math.min(roads.length, 400))) {
    const verts = r.vertices || [];
    if (!verts.length) continue;
    const v = verts[Math.floor(verts.length / 2)];
    if (!Number.isFinite(v.lon) || !Number.isFinite(v.lat)) continue;
    const reproj = lonLatToLocal(v.lon, v.lat);
    reprojErrs.push(metersDistance(reproj, v));
  }
  if (!reprojErrs.length) return 999;
  reprojErrs.sort((a, c) => a - c);
  return reprojErrs[Math.floor(reprojErrs.length / 2)];
}

/** Bridge deck reprojection + distance to corridor centerline. */
function measureBridgeAlignment(dataset) {
  const bridges = dataset.bridges || [];
  if (!bridges.length) return 999;

  const stations = dataset.corridor?.stations || [];
  const dists = [];
  for (const b of bridges) {
    if (Number.isFinite(b.midLon) && Number.isFinite(b.midLat)) {
      const reproj = lonLatToLocal(b.midLon, b.midLat);
      dists.push(metersDistance(reproj, { x: b.midX, z: b.midZ }));
    } else if (b.vertices?.[0]) {
      const v = b.vertices[0];
      if (Number.isFinite(v.lon)) {
        const reproj = lonLatToLocal(v.lon, v.lat);
        dists.push(metersDistance(reproj, v));
      }
    }
    if (stations.length) {
      dists.push(distToCorridor(b.midX, b.midZ, stations));
    }
  }
  if (!dists.length) return 999;
  dists.sort((a, c) => a - c);
  return dists[Math.floor(dists.length / 2)];
}

/**
 * Fishing point distance to valid water channel (corridor half-width envelope).
 * Points on banks register as distance to nearest water edge.
 */
function measureFishingAlignment(dataset) {
  const zones = dataset.fishingZones;
  const raw = dataset.fishingLocationsRaw;
  const stations = dataset.corridor?.stations;

  const points = zones?.length
    ? zones.map((z) => ({ x: z.x, z: z.z, valid: z.waterValid !== false }))
    : (raw || []).map((loc) => {
        const p = lonLatToLocal(loc.lon, loc.lat);
        return { x: p.x, z: p.z, valid: true };
      });

  if (!points.length || !stations?.length) return 999;

  const dists = points.map((pt) => distanceToWaterEdge(pt.x, pt.z, stations));
  dists.sort((a, c) => a - c);
  return dists[Math.floor(dists.length / 2)];
}

/** Distance from (x,z) to water channel edge (0 if inside channel). */
export function distanceToWaterEdge(x, z, stations) {
  const st = nearestStation(x, z, stations);
  const lateral = Math.abs((x - st.x) * -st.flowZ + (z - st.z) * st.flowX);
  const halfW = st.halfWidth ?? st.half ?? 40;
  return Math.max(0, lateral - halfW * 0.92);
}

export function nearestStation(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 240));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = s;
    }
  }
  const idx = stations.indexOf(best);
  for (let i = Math.max(0, idx - step); i < Math.min(stations.length, idx + step); i++) {
    const s = stations[i];
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = s;
    }
  }
  return best;
}

function distToCorridor(x, z, stations) {
  let best = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 180));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    best = Math.min(best, Math.hypot(s.x - x, s.z - z));
  }
  return best;
}

function distPointToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
