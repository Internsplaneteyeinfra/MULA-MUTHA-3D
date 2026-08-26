/**
 * Phase-1 coordinate / data validation (printed before scene styling).
 * Uses the same EPSG:32643 local frame as the renderer.
 */
import { lonLatToUtm, createLocalFrame } from "./projection.js";

export function buildValidationReport({ depth, ringGeo, bridges, frame, corridor, osm }) {
  const issues = [];
  const kmlBox = boundsLonLat(ringGeo);
  const depthBox = boundsPoints(depth.points);

  const overlap = boxesOverlap(kmlBox, depthBox);
  if (!overlap) issues.push("Bathymetry bbox does not overlap KML AOI");

  let inside = 0;
  for (const p of depth.points) {
    if (pointInRing(p.x, p.z, ringLocalFrom(ringGeo, frame))) inside++;
  }
  const insidePct = (100 * inside) / Math.max(1, depth.points.length);

  const bridgeStats = (bridges || []).map((b) => {
    const dist = distToStations(b.midX, b.midZ, corridor.stations);
    if (dist > 1600) issues.push(`Bridge "${b.name}" far from corridor (${dist.toFixed(0)} m)`);
    return { name: b.name, lengthM: Math.round(b.lengthM), distM: Math.round(dist) };
  });

  if (osm?.alignment && !osm.alignment.ok) {
    issues.push(`OSM alignment: ${(osm.alignment.issues || []).join("; ")}`);
  }

  const alignment = {
    frame: "EPSG:4326 → EPSG:32643 → local (single origin)",
    originE: frame.originE,
    originN: frame.originN,
    flipX: frame.flipX,
    layers: {
      kml: ringGeo.length > 0,
      bathymetry: depth.points.length > 0,
      corridor: corridor.stations.length > 0,
      buildings: (osm?.buildings?.length || 0) > 0,
      roads: (osm?.roads?.length || 0) > 0,
      trees: (osm?.trees?.length || 0) > 0,
    },
    osmMedianDistM: osm?.alignment?.medianDistM ?? null,
  };

  const report = {
    alignment,
    crs: "EPSG:4326 -> EPSG:32643 (UTM 43N) -> local origin",
    localOrigin: { easting: frame.originE, northing: frame.originN },
    kml: {
      source: "Mula_MuthaAOI.kml / mula_mutha_river.kml",
      type: "Polygon",
      vertices: ringGeo.length,
      lon: [kmlBox.minLon, kmlBox.maxLon],
      lat: [kmlBox.minLat, kmlBox.maxLat],
    },
    bathymetry: {
      source: "mula_mutha_water_depth.xlsx",
      points: depth.points.length,
      minDepth: depth.minDepth,
      maxDepth: depth.maxDepth,
      lon: [depthBox.minLon, depthBox.maxLon],
      lat: [depthBox.minLat, depthBox.maxLat],
      approxInsideKmlPct: Number(insidePct.toFixed(1)),
    },
    corridor: {
      stations: corridor.stations.length,
      lengthM: Math.round(corridor.length),
      across: corridor.across,
    },
    bridges: {
      source: "OpenStreetMap / bridges.geojson",
      count: bridges.length,
      items: bridgeStats,
    },
    osm: osm
      ? {
          roads: osm.roads?.length || 0,
          buildings: osm.buildings?.length || 0,
          green: osm.green?.length || 0,
        }
      : { note: "OSM context not loaded" },
    issues,
    ok: issues.length === 0 && depth.points.length > 1000 && ringGeo.length > 50,
  };

  console.info("=== MULA-MUTHA GEOSPATIAL VALIDATION ===", report);
  return report;
}

function ringLocalFrom(ringGeo, frame) {
  return ringGeo.map((c) => {
    const u = lonLatToUtm(c.lon, c.lat);
    const p = frame.toLocal(u.easting, u.northing);
    return { x: p.x, z: p.z };
  });
}

function boundsLonLat(ring) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const c of ring) {
    minLon = Math.min(minLon, c.lon);
    maxLon = Math.max(maxLon, c.lon);
    minLat = Math.min(minLat, c.lat);
    maxLat = Math.max(maxLat, c.lat);
  }
  return { minLon, maxLon, minLat, maxLat };
}

function boundsPoints(points) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
  }
  return { minLon, maxLon, minLat, maxLat };
}

function boxesOverlap(a, b) {
  return !(a.maxLon < b.minLon || b.maxLon < a.minLon || a.maxLat < b.minLat || b.maxLat < a.minLat);
}

function pointInRing(x, z, ring) {
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

function distToStations(x, z, stations) {
  let best = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 200));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    best = Math.min(best, Math.hypot(s.x - x, s.z - z));
  }
  return best;
}

export { createLocalFrame, lonLatToUtm };
