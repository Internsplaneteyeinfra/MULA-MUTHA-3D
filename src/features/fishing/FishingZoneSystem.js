import { lonLatToLocal } from "../../geo/geoReference.js";
import { distanceToWaterEdge } from "../../geo/projectionMetrics.js";
import { SURFACE_Y, bedElevation } from "../../scene/river.js";
import { state } from "../../state.js";
import { activityLevel } from "./FishSpeciesRegistry.js";

/**
 * Project KML fishing points into existing local frame and bind to corridor/bathymetry.
 */
export function buildFishingZones(rawLocations, dataset) {
  const { ringLocal, corridor, points, bridges } = dataset;
  const stations = corridor.stations;
  const zones = [];

  for (const loc of rawLocations) {
    const p = lonLatToLocal(loc.lon, loc.lat);
    const waterDistM = distanceToWaterEdge(p.x, p.z, stations);
    const waterValid = waterDistM < 2;

    if (!pointInRing(p.x, p.z, ringLocal)) {
      console.warn(`Fishing ${loc.id} outside KML river polygon — skipped`, loc);
      continue;
    }

    if (!waterValid) {
      console.warn(`Fishing ${loc.id} INVALID FISHING LOCATION — ${waterDistM.toFixed(1)} m from water edge`, loc);
    }

    const st = nearestStation(p.x, p.z, stations);
    const depthSample = nearestDepth(p.x, p.z, points) ?? { depth: 1.8 };
    const depthM = depthSample.depth;
    const halfWidth = st.halfWidth;
    const radius = Math.min(60, Math.max(25, halfWidth * 0.85));
    const nearBridge = (bridges || []).some(
      (b) => Math.hypot(b.midX - p.x, b.midZ - p.z) < halfWidth + 40,
    );

    const zone = {
      id: loc.id,
      name: loc.name,
      lon: loc.lon,
      lat: loc.lat,
      easting: p.easting,
      northing: p.northing,
      x: p.x,
      z: p.z,
      flowX: st.flowX,
      flowZ: st.flowZ,
      halfWidth,
      radius,
      depthM,
      nearBridge,
      surfaceY: SURFACE_Y,
      bedY: bedElevation(depthM, dataset.minDepth, dataset.maxDepth, 0.5, state.depthExaggeration),
      activity: "Medium",
      dominant: [],
      waterDistM,
      waterValid,
      invalidReason: waterValid ? null : "INVALID FISHING LOCATION",
    };
    zone.activity = activityLevel(zone);
    zones.push(zone);
  }

  console.info("Fishing zones", {
    source: "Fishing_Locations.kml",
    count: zones.length,
    ids: zones.map((z) => z.id),
  });
  return zones;
}

export function sampleDepthAt(x, z, dataset) {
  const d = nearestDepth(x, z, dataset.points);
  return d?.depth ?? 1.8;
}

export function bedYAt(x, z, dataset, exag = state.depthExaggeration) {
  const depth = sampleDepthAt(x, z, dataset);
  return bedElevation(depth, dataset.minDepth, dataset.maxDepth, 0.5, exag);
}

/**
 * Approximate animated water surface Y at a world XZ (matches water shader swell scale).
 * Does not alter river mesh — used only for fish depth placement.
 */
export function waterSurfaceYAt(x, z, time = 0) {
  const swell =
    Math.sin(x * 0.006 - time * 0.04) * 0.22 +
    Math.sin(z * 0.01 + time * 0.03) * 0.16;
  const wave = Math.sin(x * 0.025 - time * 0.45) * 0.1 + Math.sin(z * 0.03 + time * 0.2) * 0.08;
  return SURFACE_Y + swell + wave;
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
  // refine locally
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

function nearestDepth(x, z, points) {
  if (!points?.length) return null;
  let best = null;
  let bestD = Infinity;
  // coarse grid hash would be better; subsample for speed
  const step = Math.max(1, Math.floor(points.length / 800));
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = p;
    }
  }
  return best;
}

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export function lateralDistToCenterline(x, z, st) {
  return Math.abs((x - st.x) * -st.flowZ + (z - st.z) * st.flowX);
}
