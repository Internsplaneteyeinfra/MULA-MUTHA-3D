import { getForecastEngine } from "../forecastService.js";
import { bathymetryService } from "./bathymetryService.js";

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const delta_phi = ((lat2 - lat1) * Math.PI) / 180;
    const delta_lambda = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(delta_phi / 2) * Math.sin(delta_phi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(delta_lambda / 2) * Math.sin(delta_lambda / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const delta_lambda = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(delta_lambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
              Math.sin(phi1) * Math.cos(phi2) * Math.cos(delta_lambda);
    return (Math.atan2(y, x) * 180) / Math.PI;
}

export async function getRiverHydrologyAtLatLon({ latitude, longitude, simulationTime }) {
  await bathymetryService.init();
  let chainageMeters = 0;
  let lateralOffsetMeters = 0;

  // Compute nearest centerline and lateral offset in JS just like python script
  if (bathymetryService.centerline && bathymetryService.centerline.length > 0) {
      const stations = bathymetryService.centerline;
      let minDist = Infinity;
      let nearestIdx = 0;
      for (let i = 0; i < stations.length; i++) {
          const d = haversine(stations[i].lat, stations[i].lon, latitude, longitude);
          if (d < minDist) {
              minDist = d;
              nearestIdx = i;
          }
      }

      chainageMeters = stations[nearestIdx].chainageMeters;
      
      let nextIdx = nearestIdx < stations.length - 1 ? nearestIdx + 1 : nearestIdx;
      let prevIdx = nearestIdx > 0 ? nearestIdx - 1 : nearestIdx;
      
      let p1 = stations[prevIdx];
      let p2 = stations[nextIdx];
      if (prevIdx === nextIdx) { p1 = stations[0]; p2 = stations[1]; }
      
      const river_bearing = calculateBearing(p1.lat, p1.lon, p2.lat, p2.lon);
      const point_bearing = calculateBearing(stations[nearestIdx].lat, stations[nearestIdx].lon, latitude, longitude);
      
      const angle_diff = (point_bearing - river_bearing) * (Math.PI / 180);
      lateralOffsetMeters = minDist * Math.sin(angle_diff);
  }

  return getRiverDepthAt({ latitude, longitude, chainageMeters, lateralOffsetMeters, simulationTime });
}

export async function getRiverDepthAt({ latitude, longitude, chainageMeters, lateralOffsetMeters, simulationTime }) {
  await bathymetryService.init();
  
  const eng = await getForecastEngine();
  const hydraulic = eng.currentHydraulic(chainageMeters);
  const cell = eng.cellForChainage(chainageMeters);
  const wse = Array.isArray(hydraulic.wse) ? (hydraulic.wse[cell] ?? null) : null;
  
  const bathy = bathymetryService.getBathymetryAt({ chainageMeters, lateralOffsetMeters });
  
  let depthM = null;
  if (wse != null && bathy.depthM != null) {
      depthM = bathy.depthM;
  }

  return {
    latitude,
    longitude,
    chainageMeters,
    lateralOffsetMeters,
    wse,
    depthM,
    source: bathy.source || "MODELLED",
    provenance: bathy.provenance || "UNAVAILABLE",
    simulationTime: simulationTime || new Date().toISOString(),
    available: depthM != null,
    confidence: bathy.confidence || "LOW",
    supportDistanceM: 0
  };
}
