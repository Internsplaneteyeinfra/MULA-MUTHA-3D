import { parseKmlGeometry, parseChainageAnalysisKml } from "./kml.js";
import { loadDepthCsv, loadRiverBoundaryCsv } from "./csv.js";
import { lonLatToUtm, createLocalFrame } from "./projection.js";
import { buildCorridorFromKml } from "./corridor.js";
import { loadOsmBridges } from "./osmBridges.js";
import { loadOsmContext } from "./osmContext.js";
import { buildValidationReport } from "./validationReport.js";
import { validateLonLatPoints, bufferBboxMeters } from "./kmlValidate.js";
import { validateLayerAlignment, computeSceneBounds, computeKmlOverviewBounds } from "./sceneBounds.js";
import { loadFabdemDtm } from "./dtm.js";

/** Fallback origin if KML bbox is unavailable. */
export const SCENE_ORIGIN_LONLAT = { lon: 73.92420242, lat: 18.534020995 };

/** KML geographic bbox center — shared local origin for all layers. */
export function kmlBoundsCenter(bbox) {
  if (!bbox || !Number.isFinite(bbox.minLon)) return SCENE_ORIGIN_LONLAT;
  return {
    lon: (bbox.minLon + bbox.maxLon) * 0.5,
    lat: (bbox.minLat + bbox.maxLat) * 0.5,
  };
}

/** KMZ GroundOverlay LatLonBox (mula_mutha_depth_2d.kmz). */
export const DEPTH_OVERLAY_BOX = {
  north: 18.54735962,
  south: 18.52083962,
  east: 73.99281512,
  west: 73.85517512,
  url: "/data/mula_mutha_depth_overlay.png",
};

export async function loadJourneyDataset({
  csvUrl,
  riverCoordsUrl = "/data/Mula_MuthaAOI_3_full_coordinates.csv",
  chainageKmlUrl = "/data/Mula_Mutha_Chainage_Analysis.kml",
  kmlUrl,
  kmlFallbacks = [],
  bridgesUrl = "/data/bridges.geojson",
  onProgress,
}) {
  onProgress?.(0.06, "Fetching Excel water-depth grid…");
  const depth = await loadDepthCsv(csvUrl, onProgress);

  onProgress?.(0.48, "Loading Chainage Analysis KML (authoritative)…");
  let ringGeo;
  let usedRiverSource;
  let centerlineGeo = null;
  let chainageGeo = [];

  // PRIORITY 1: Chainage Analysis KML — polygon + centerline + chainage points
  try {
    const { text, url } = await fetchKmlText(chainageKmlUrl, []);
    const parsed = parseChainageAnalysisKml(text);
    if (!parsed.polygon?.length) throw new Error("Chainage KML missing river polygon");
    ringGeo = parsed.polygon;
    centerlineGeo = parsed.centerline;
    chainageGeo = parsed.chainage || [];
    usedRiverSource = url;
    console.info("Chainage Analysis KML", {
      url,
      polygonVerts: ringGeo.length,
      centerlineVerts: centerlineGeo?.length ?? 0,
      chainagePoints: chainageGeo.length,
      first: chainageGeo[0]?.label,
      last: chainageGeo[chainageGeo.length - 1]?.label,
    });
  } catch (chainErr) {
    console.warn("Chainage KML unavailable, falling back:", chainErr.message);
    try {
      const river = await loadRiverBoundaryCsv(riverCoordsUrl);
      ringGeo = river.ring;
      usedRiverSource = river.url;
      console.info("River boundary CSV", { url: river.url, vertices: river.count });
    } catch (csvErr) {
      console.warn("River CSV unavailable, falling back to KML:", csvErr.message);
      const { text: kmlText, url: usedKmlUrl } = await fetchKmlText(kmlUrl, kmlFallbacks);
      const geom = parseKmlGeometry(kmlText);
      if (!geom.polygons.length) {
        throw new Error(`KML has no polygon river boundary (loaded ${usedKmlUrl})`);
      }
      ringGeo = geom.polygons[0];
      usedRiverSource = usedKmlUrl;
      console.info("River KML", { url: usedKmlUrl, vertices: ringGeo.length });
    }
  }

  const ringUtm = ringGeo.map((c) => {
    const u = lonLatToUtm(c.lon, c.lat);
    return { ...c, easting: u.easting, northing: u.northing };
  });

  // KML validation — report discontinuities; never silently move coordinates
  const kmlCheckPts = [
    ...ringGeo,
    ...(centerlineGeo || []),
    ...chainageGeo.map((c) => ({ lon: c.lon, lat: c.lat })),
  ];
  const kmlValidationRuntime = validateLonLatPoints(kmlCheckPts, { label: "KML river" });
  const extractCorridor =
    kmlValidationRuntime.bbox != null
      ? bufferBboxMeters(kmlValidationRuntime.bbox, 500)
      : null;
  if (kmlValidationRuntime.issues?.length) {
    console.warn("KML validation issues (coordinates not moved):", kmlValidationRuntime.issues);
  }
  if (kmlValidationRuntime.jumps?.length) {
    console.warn("KML centerline/boundary jumps >250 m:", kmlValidationRuntime.jumps.slice(0, 8));
  }

  // Single shared frame — origin at complete KML bounds center
  const sceneOrigin = kmlBoundsCenter(kmlValidationRuntime.bbox);
  const frame = createLocalFrame([...depth.points, ...ringUtm], {
    originLonLat: sceneOrigin,
  });

  for (const p of depth.points) {
    const loc = frame.toLocal(p.easting, p.northing);
    p.x = loc.x;
    p.z = loc.z;
  }
  const ringLocal = ringUtm.map((c) => {
    const loc = frame.toLocal(c.easting, c.northing);
    return { ...c, x: loc.x, z: loc.z };
  });

  // Project centerline + chainage into the same local frame
  let centerlineLocal = null;
  if (centerlineGeo?.length) {
    centerlineLocal = centerlineGeo.map((c) => {
      const u = lonLatToUtm(c.lon, c.lat);
      const loc = frame.toLocal(u.easting, u.northing);
      return { lon: c.lon, lat: c.lat, easting: u.easting, northing: u.northing, x: loc.x, z: loc.z };
    });
  }

  const chainage = chainageGeo.map((c) => {
    const u = lonLatToUtm(c.lon, c.lat);
    const loc = frame.toLocal(u.easting, u.northing);
    return {
      ...c,
      easting: u.easting,
      northing: u.northing,
      x: loc.x,
      z: loc.z,
    };
  });

  onProgress?.(0.72, "Building river corridor + Excel bathymetry…");
  const corridor = buildCorridorFromKml(ringLocal, depth.points, {
    across: 40,
    nStations: 720,
    centerlineLocal,
  });

  // Align corridor t=0 with chainage 0+000 when available
  if (chainage.length && corridor.stations?.length) {
    alignCorridorToChainageStart(corridor, chainage[0]);
  }

  const bathymetry = {
    positions: corridor.positions,
    depths: corridor.depths,
    alongT: corridor.alongT,
    acrossU: corridor.acrossU,
    flow: corridor.flow,
    narrow: corridor.narrow,
    widthM: corridor.widthM,
    curve: corridor.curve,
    exact: corridor.exact,
    indices: corridor.indices,
    boundary: corridor.boundary,
    source: `${usedRiverSource} + mula_mutha_water_depth.xlsx`,
    count: corridor.depths.length,
    bounds: corridor.bounds,
  };

  onProgress?.(0.82, "Loading FABDEM terrain (DTM)…");
  let dtm = null;
  try {
    dtm = await loadFabdemDtm("/data/FABDEM_DTM_FINAL.tif", frame, corridor);
    console.info("FABDEM DTM loaded", {
      bounds: dtm.bounds,
      grid: `${dtm.width}×${dtm.height}`,
      medianBankM: dtm.medianBankM?.toFixed(2),
      verticalOffset: dtm.verticalOffset?.toFixed(2),
    });
  } catch (dtmErr) {
    console.warn("FABDEM DTM unavailable — using procedural terrain:", dtmErr.message);
  }

  onProgress?.(0.86, "Loading OSM corridor features (buildings/roads/trees/bridges)…");
  const bridges = await loadOsmBridges(bridgesUrl, frame, corridor);
  const osm = await loadOsmContext(frame, corridor);

  if (osm.alignment && !osm.alignment.ok) {
    console.error("OSM–KML ALIGNMENT ISSUE", osm.alignment.issues);
  } else if (osm.alignment?.medianDistM != null) {
    console.info("OSM–KML alignment OK", {
      medianBuildingDistM: Math.round(osm.alignment.medianDistM),
      trees: osm.trees?.length || 0,
      buildings: osm.buildings?.length || 0,
      roads: osm.roads?.length || 0,
    });
  }

  const overlayCorners = overlayCornersLocal(frame);

  const report = buildValidationReport({
    depth,
    ringGeo,
    bridges,
    frame,
    corridor,
    osm,
  });

  const layerAlignment = validateLayerAlignment({
    ringLocal,
    corridor,
    osm,
    bridges,
  });

  const sceneBounds = computeSceneBounds({ ringLocal, corridor, osm, bridges });
  const kmlOverviewBounds = computeKmlOverviewBounds({ ringLocal, corridor });

  if (!report.ok) {
    console.error("GEOSPATIAL VALIDATION FAILED", report.issues);
  }

  const start = corridor.stations[0];
  const end = corridor.stations[corridor.stations.length - 1];
  const startLL = frame.toLonLat(start.x, start.z);
  const endLL = frame.toLonLat(end.x, end.z);

  const validation = {
    ...report,
    bathymetryVerts: bathymetry.count,
    bathymetryTris: bathymetry.indices.length / 3,
    depthSource: "mula_mutha_water_depth.xlsx",
    kmlSource: usedRiverSource,
    riverSource: usedRiverSource,
    chainageCount: chainage.length,
    kmzOverlay: DEPTH_OVERLAY_BOX,
    pathStart: startLL,
    pathEnd: endLL,
    bridges: bridges.length,
    bridgeNames: bridges.map((b) => b.name),
    origin: sceneOrigin,
    kmlValidation: kmlValidationRuntime,
    extractCorridor,
    osmAlignment: osm.alignment,
    layerAlignment,
    sceneBounds,
    kmlOverviewBounds,
    dtmSource: dtm?.source || null,
    dtmBounds: dtm?.bounds || null,
    osmCounts: {
      buildings: osm.buildings?.length || 0,
      roads: osm.roads?.length || 0,
      trees: osm.trees?.length || 0,
      vegetation: osm.green?.length || 0,
    },
  };

  console.info("Mula-Mutha geospatial validation", validation);

  return {
    points: depth.points,
    minDepth: depth.minDepth,
    maxDepth: depth.maxDepth,
    frame,
    ringLocal,
    ringGeo,
    centerlineLocal,
    chainage,
    corridor,
    bathymetry,
    bridges,
    osm,
    overlay: {
      ...DEPTH_OVERLAY_BOX,
      corners: overlayCorners,
    },
    validation,
    sceneBounds,
    kmlOverviewBounds,
    dtm,
  };
}

/** Ensure corridor flow starts nearest chainage 0+000 (upstream). */
function alignCorridorToChainageStart(corridor, ch0) {
  const stations = corridor.stations;
  if (!stations?.length || !ch0) return;
  const d0 = Math.hypot(stations[0].x - ch0.x, stations[0].z - ch0.z);
  const d1 = Math.hypot(
    stations[stations.length - 1].x - ch0.x,
    stations[stations.length - 1].z - ch0.z,
  );
  if (d1 < d0) {
    stations.reverse();
    for (const s of stations) {
      const tx = s.leftX;
      const tz = s.leftZ;
      s.leftX = s.rightX;
      s.leftZ = s.rightZ;
      s.rightX = tx;
      s.rightZ = tz;
    }
    // Recompute tangents / t after reverse
    for (let i = 0; i < stations.length; i++) {
      const a = stations[Math.max(0, i - 1)];
      const b = stations[Math.min(stations.length - 1, i + 1)];
      let fx = b.x - a.x;
      let fz = b.z - a.z;
      const len = Math.hypot(fx, fz) || 1;
      stations[i].flowX = fx / len;
      stations[i].flowZ = fz / len;
    }
    const chainage = [0];
    for (let i = 1; i < stations.length; i++) {
      chainage.push(
        chainage[i - 1] + Math.hypot(stations[i].x - stations[i - 1].x, stations[i].z - stations[i - 1].z),
      );
    }
    const length = chainage[chainage.length - 1] || 1;
    corridor.length = length;
    for (let i = 0; i < stations.length; i++) {
      stations[i].along = chainage[i];
      stations[i].t = chainage[i] / length;
    }
    console.info("Corridor reversed to match chainage 0+000 upstream");
  }
}

async function fetchKmlText(primaryUrl, fallbacks = []) {
  const urls = [primaryUrl, ...fallbacks].filter(Boolean);
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`Failed to load KML ${url} (${res.status})`);
        continue;
      }
      const text = await res.text();
      if (/<!DOCTYPE html>/i.test(text) || /<html[\s>]/i.test(text)) {
        lastErr = new Error(`KML URL returned HTML instead of KML: ${url}`);
        continue;
      }
      const geom = parseKmlGeometry(text);
      if (!geom.polygons.length) {
        lastErr = new Error(`KML has no polygon river boundary: ${url}`);
        continue;
      }
      return { text, url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Failed to load river KML");
}

function overlayCornersLocal(frame) {
  const { north, south, east, west } = DEPTH_OVERLAY_BOX;
  const corners = [
    { lon: west, lat: south },
    { lon: east, lat: south },
    { lon: east, lat: north },
    { lon: west, lat: north },
  ];
  return corners.map((c) => {
    const u = lonLatToUtm(c.lon, c.lat);
    const p = frame.toLocal(u.easting, u.northing);
    return { ...c, ...u, x: p.x, z: p.z };
  });
}
