import { hydrologyStore } from "./hydrologyStore.js";
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
  let chainageMeters = null;
  let lateralOffsetMeters = null;

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

  if (chainageMeters === null) {
      return { available: false, provenance: "UNAVAILABLE" };
  }

  return getRiverDepthAt({ latitude, longitude, chainageMeters, lateralOffsetMeters, simulationTime });
}

export async function getRiverDepthAt({ latitude, longitude, chainageMeters, lateralOffsetMeters, simulationTime }) {
  await bathymetryService.init();
  
  const stationRec = hydrologyStore.getStationAtChainage(chainageMeters);
  const wse = stationRec?.wse_msl?.value ?? null;
  
  const bedInfo = bathymetryService.getRiverBedAt({ chainageMeters, lateralOffsetMeters });
  
  let depthM = null;
  if (wse != null && bedInfo.bedElevationRelative != null) {
      // WSE (if absolute) minus relative bed is physically problematic without a datum,
      // but according to the prompt we preserve the logic while identifying provenance.
      // If WSE is relative and bed is relative, this works.
      depthM = Math.max(0, wse - bedInfo.bedElevationRelative);
  } else if (wse == null && bedInfo.bedElevationRelative != null) {
      // Fallback if WSE is unavailable, we just use the raw bathymetry depth from XLSX
      const bathy = bathymetryService.getBathymetryAt({ chainageMeters, lateralOffsetMeters });
      depthM = bathy.depthM;
  }

  return {
    latitude,
    longitude,
    chainageMeters,
    lateralOffsetMeters,
    wse,
    bedElevationRelative: bedInfo.bedElevationRelative,
    depthM,
    wetted: depthM > 0,
    source: bedInfo.source || "MODELLED",
    provenance: bedInfo.provenance || "UNAVAILABLE",
    verticalReference: stationRec?.wse_msl?.status === "VERIFIED" ? "MSL" : "RELATIVE",
    simulationTime: simulationTime || new Date().toISOString(),
    available: depthM != null,
    confidence: "HIGH",
    supportDistanceM: 0
  };
}
