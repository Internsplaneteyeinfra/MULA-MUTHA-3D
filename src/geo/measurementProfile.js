/**
 * A→B measurement transect profile.
 * Samples raw DTM + corridor bathymetry in scene coordinates (same datum).
 * Does not collapse a cross-section onto a single chainage row.
 */
import { metersDistance, localToLonLat } from "./geoReference.js";
import { terrainHeightAt, rawDtmElevationAt } from "../scene/terrain.js";
import { formatStation } from "./chainage.js";
import { getCurrentHydraulicSnapshot } from "../services/forecastService.js";
import { SURFACE_Y, bedElevation } from "../scene/river.js";
import { state } from "../state.js";

/**
 * @param {{
 *   pointA: { x:number, y?:number, z:number, lat?:number, lon?:number },
 *   pointB: { x:number, y?:number, z:number, lat?:number, lon?:number },
 *   dataset: object,
 *   sampleCount?: number,
 * }} opts
 */
export async function buildMeasurementProfile({ pointA, pointB, dataset, sampleCount } = {}) {
  if (!pointA || !pointB || !dataset) {
    return emptyProfile("Invalid points");
  }

  const distance_m = metersDistance(pointA, pointB);
  if (!Number.isFinite(distance_m) || distance_m < 0.5) {
    return emptyProfile("Distance too short", { pointA, pointB, distance_m });
  }

  const n = Math.max(
    64,
    Math.min(240, Number(sampleCount) || Math.round(Math.min(240, Math.max(80, distance_m / 1.0)))),
  );

  const stations = dataset.corridor?.stations || [];
  const chainagePts = dataset.chainage || [];

  // Midpoint chainage — discharge only (not used to flatten the profile).
  const midX = (pointA.x + pointB.x) * 0.5;
  const midZ = (pointA.z + pointB.z) * 0.5;
  const midCh = nearestChainageMeters(midX, midZ, chainagePts, stations);

  let hydraulic = null;
  try {
    hydraulic = await getCurrentHydraulicSnapshot(midCh?.meters);
  } catch (err) {
    console.warn("[measurement-profile] hydraulic unavailable", err?.message || err);
  }

  const samples = [];
  let closestLat = Infinity;
  let corridorWidthAtCrossing = null;
  let wetStart = null;
  let wetEnd = null;

  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const x = pointA.x + (pointB.x - pointA.x) * t;
    const z = pointA.z + (pointB.z - pointA.z) * t;
    const distanceFromA = distance_m * t;

    let lat = null;
    let lon = null;
    try {
      const ll = localToLonLat(x, z);
      lat = ll?.lat ?? null;
      lon = ll?.lon ?? null;
    } catch {
      /* hide coords if conversion fails */
    }

    const terrain_elevation = sampleTerrainElevation(x, z, dataset, stations);
    const bath = sampleBathymetryAt(x, z, dataset);
    const nearestChain = nearestChainageMeters(x, z, chainagePts, stations);
    const nearest_chainage_m = nearestChain?.meters ?? bath?.along ?? null;

    const inWater = !!bath?.inWater;
    const depth_m = inWater && Number.isFinite(bath.depth) ? bath.depth : null;
    const depth_quality = bath?.exact ? "measured" : inWater ? "interpolated" : null;
    const acrossU = Number.isFinite(bath?.acrossU) ? bath.acrossU : 0.5;

    // Same bed equation as the 3D river mesh (bank trough + depth exaggeration).
    // Raw Excel depths are often nearly flat across — without bank shaping the chart looks straight.
    const water_surface_elevation = inWater ? SURFACE_Y : null;
    const river_bed_elevation =
      inWater && Number.isFinite(depth_m)
        ? bedElevation(
            depth_m,
            dataset.minDepth,
            dataset.maxDepth,
            acrossU,
            state.depthExaggeration ?? 2,
          )
        : null;

    if (Number.isFinite(bath?.lat) && bath.lat < closestLat) {
      closestLat = bath.lat;
      corridorWidthAtCrossing = bath.width_m;
    }
    if (inWater) {
      if (wetStart == null) wetStart = distanceFromA;
      wetEnd = distanceFromA;
    }

    samples.push({
      distance_m: distanceFromA,
      world_x: x,
      world_y: terrain_elevation,
      world_z: z,
      lat,
      lon,
      terrain_elevation: Number.isFinite(terrain_elevation) ? terrain_elevation : null,
      nearest_chainage_m,
      chainage_label: nearest_chainage_m != null ? formatStation(nearest_chainage_m) : null,
      depth_m: Number.isFinite(depth_m) ? depth_m : null,
      depth_quality,
      width_m: Number.isFinite(bath?.width_m) ? bath.width_m : null,
      in_water: inWater,
      water_surface_elevation,
      water_surface_quality: inWater ? "live" : null,
      river_bed_elevation,
    });
  }

  const wetDepths = samples
    .filter((s) => s.in_water && Number.isFinite(s.depth_m) && s.depth_m > 0)
    .map((s) => s.depth_m);
  const terrains = samples.map((s) => s.terrain_elevation).filter(Number.isFinite);
  const wseVals = samples.map((s) => s.water_surface_elevation).filter(Number.isFinite);

  const measuredWetWidth =
    wetStart != null && wetEnd != null && wetEnd > wetStart ? wetEnd - wetStart : null;
  const width_m =
    Number.isFinite(corridorWidthAtCrossing) && corridorWidthAtCrossing > 0.5
      ? corridorWidthAtCrossing
      : measuredWetWidth;

  const statistics = {
    distance_m,
    min_terrain_m: terrains.length ? Math.min(...terrains) : null,
    max_terrain_m: terrains.length ? Math.max(...terrains) : null,
    terrain_delta_m:
      terrains.length >= 2 ? Math.max(...terrains) - Math.min(...terrains) : null,
    min_depth_m: wetDepths.length ? Math.min(...wetDepths) : null,
    max_depth_m: wetDepths.length ? Math.max(...wetDepths) : null,
    mean_depth_m: wetDepths.length
      ? wetDepths.reduce((a, b) => a + b, 0) / wetDepths.length
      : null,
    width_m: Number.isFinite(width_m) ? width_m : null,
    discharge_m3s: hydraulic?.discharge_m3s ?? null,
    discharge_source: hydraulic?.dischargeSource ?? null,
    discharge_label: hydraulic?.dischargeLabel ?? null,
    water_surface_m: wseVals.length
      ? wseVals.reduce((a, b) => a + b, 0) / wseVals.length
      : null,
    water_surface_quality: wseVals.length ? "live" : null,
    has_real_depth: wetDepths.length > 0,
  };

  return {
    distance_m,
    pointA: enrichPoint(pointA),
    pointB: enrichPoint(pointB),
    samples,
    statistics,
    error: null,
  };
}

/** Raw FABDEM scene Y — no channel-carve clamp (that was flattening the chart). */
function sampleTerrainElevation(x, z, dataset, stations) {
  const fromDataset = dataset?.dtm?.sampleSceneXY?.(x, z);
  if (Number.isFinite(fromDataset)) return fromDataset;
  const fromActive = rawDtmElevationAt(x, z);
  if (Number.isFinite(fromActive)) return fromActive;
  if (stations?.length) {
    // Last resort: mesh height (may be channel-carved near water).
    return terrainHeightAt(x, z, stations);
  }
  return SURFACE_Y + 2;
}

/**
 * Spatial bathymetry at world XZ.
 * Prefers nearest corridor-raster vertex (true across-channel variation),
 * then bilinear column sample at the nearest station.
 */
function sampleBathymetryAt(x, z, dataset) {
  const stations = dataset?.corridor?.stations || [];
  const bath = dataset?.bathymetry;
  if (!stations.length) return null;

  let bestI = 0;
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 500));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  for (let i = Math.max(0, bestI - 24); i <= Math.min(stations.length - 1, bestI + 24); i++) {
    const s = stations[i];
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }

  let idxA = bestI;
  let idxB = bestI;
  let tLong = 0;

  if (stations.length > 1) {
    let dPrev = Infinity, dNext = Infinity;
    if (bestI > 0) {
      const s = stations[bestI - 1];
      dPrev = (s.x - x) ** 2 + (s.z - z) ** 2;
    }
    if (bestI < stations.length - 1) {
      const s = stations[bestI + 1];
      dNext = (s.x - x) ** 2 + (s.z - z) ** 2;
    }

    if (dNext < dPrev && bestI < stations.length - 1) {
      idxA = bestI;
      idxB = bestI + 1;
    } else if (bestI > 0) {
      idxA = bestI - 1;
      idxB = bestI;
    } else {
      idxA = 0;
      idxB = 1;
    }

    const sA = stations[idxA], sB = stations[idxB];
    const dx = sB.x - sA.x, dz = sB.z - sA.z;
    const l2 = dx * dx + dz * dz;
    if (l2 > 0) {
      tLong = ((x - sA.x) * dx + (z - sA.z) * dz) / l2;
      tLong = Math.max(0, Math.min(1, tLong));
    }
  }

  function getStationMetrics(st) {
    const half = Math.max(
      8,
      Number(st.halfWidth) ||
        (Number.isFinite(st.width) ? st.width * 0.5 : null) ||
        (Number.isFinite(st.half) ? st.half : 20)
    );
    const width_m = Number.isFinite(st.width) ? st.width : half * 2;
    
    let u = 0.5;
    if (Number.isFinite(st.leftX) && Number.isFinite(st.rightX)) {
      const lx = st.rightX - st.leftX;
      const lz = st.rightZ - st.leftZ;
      const len2 = lx * lx + lz * lz || 1;
      u = ((x - st.leftX) * lx + (z - st.leftZ) * lz) / len2;
      u = Math.max(0, Math.min(1, u));
    } else {
      const flowX = Number(st.flowX) || 1;
      const flowZ = Number(st.flowZ) || 0;
      const signed = (x - st.x) * -flowZ + (z - st.z) * flowX;
      u = Math.max(0, Math.min(1, 0.5 + signed / (2 * half)));
    }
    
    const flowX = Number(st.flowX) || 1;
    const flowZ = Number(st.flowZ) || 0;
    const lat = Math.abs((x - st.x) * -flowZ + (z - st.z) * flowX);
    
    return { half, width_m, u, lat };
  }

  const mA = getStationMetrics(stations[idxA]);
  const mB = getStationMetrics(stations[idxB]);

  const half = mA.half * (1 - tLong) + mB.half * tLong;
  const width_m = mA.width_m * (1 - tLong) + mB.width_m * tLong;
  let acrossU = mA.u * (1 - tLong) + mB.u * tLong;
  const lat = mA.lat * (1 - tLong) + mB.lat * tLong;

  let depth = null;
  let exact = false;

  // 1) Nearest raster vertex in world XZ — captures real across-channel depth changes.
  const nearVert = nearestBathymetryVertex(x, z, bath);
  if (nearVert) {
    depth = nearVert.depth;
    exact = nearVert.exact;
    if (Number.isFinite(nearVert.acrossU)) acrossU = nearVert.acrossU;
  }

  // 2) Bilinear sample across columns longitudinally interpolated (smoother trough).
  if (bath?.depths?.length) {
    const cols = (bath.across || 40) + 1;
    const colF = acrossU * (cols - 1);
    const c0 = Math.max(0, Math.min(cols - 2, Math.floor(colF)));
    const c1 = c0 + 1;
    const frac = colF - c0;

    const getDepthForStation = (i) => {
      const i0 = i * cols + c0;
      const i1 = i * cols + c1;
      if (i0 >= 0 && i1 < bath.depths.length) {
        const d0 = Number(bath.depths[i0]);
        const d1 = Number(bath.depths[i1]);
        if (Number.isFinite(d0) && Number.isFinite(d1)) {
          return d0 * (1 - frac) + d1 * frac;
        }
        if (Number.isFinite(d0)) return d0;
        if (Number.isFinite(d1)) return d1;
      }
      return null;
    };

    const dA = getDepthForStation(idxA);
    const dB = getDepthForStation(idxB);

    let blended = null;
    if (dA !== null && dB !== null) {
      blended = dA * (1 - tLong) + dB * tLong;
    } else if (dA !== null) {
      blended = dA;
    } else if (dB !== null) {
      blended = dB;
    }

    if (blended !== null) {
      if (!Number.isFinite(depth) || (nearVert && nearVert.dist > half * 0.35)) {
        depth = blended;
        exact = false;
      } else {
        depth = depth * 0.55 + blended * 0.45;
      }
    }
  }

  if (!Number.isFinite(depth) && dataset.points?.length) {
    const hit = nearestSurveyDepth(x, z, dataset.points);
    if (hit) {
      depth = hit.depth;
      exact = true;
    }
  }

  // Inside banks: treat as wet when we have a positive depth reading.
  // Use acrossU so edge columns still count even if lateral estimate is noisy.
  const nearBank = acrossU > 0.02 && acrossU < 0.98;
  const inWater =
    Number.isFinite(depth) &&
    depth > 0.04 &&
    (lat <= half * 1.12 || (nearBank && lat <= half * 1.35));

  const stA = stations[idxA];
  const stB = stations[idxB];
  const alongA = Number.isFinite(stA.along) ? stA.along : (Number.isFinite(stA.meters) ? stA.meters : null);
  const alongB = Number.isFinite(stB.along) ? stB.along : (Number.isFinite(stB.meters) ? stB.meters : null);
  let along = null;
  if (alongA !== null && alongB !== null) {
    along = alongA * (1 - tLong) + alongB * tLong;
  } else if (alongA !== null) {
    along = alongA;
  } else if (alongB !== null) {
    along = alongB;
  }

  return {
    depth: Number.isFinite(depth) ? depth : 0,
    acrossU,
    lat,
    half,
    width_m,
    along,
    inWater,
    exact,
  };
}

/** Nearest corridor bathymetry grid point (positions are x,y,z interleaved). */
function nearestBathymetryVertex(x, z, bath) {
  const pos = bath?.positions;
  const depths = bath?.depths;
  if (!pos?.length || !depths?.length) return null;
  const n = depths.length;
  let best = 0;
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(n / 2500));
  for (let i = 0; i < n; i += step) {
    const dx = pos[i * 3] - x;
    const dz = pos[i * 3 + 2] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const refine = Math.max(step * 2, 48);
  for (let i = Math.max(0, best - refine); i <= Math.min(n - 1, best + refine); i++) {
    const dx = pos[i * 3] - x;
    const dz = pos[i * 3 + 2] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const depth = Number(depths[best]);
  if (!Number.isFinite(depth)) return null;
  return {
    depth,
    acrossU: Number.isFinite(bath.acrossU?.[best]) ? bath.acrossU[best] : null,
    dist: Math.sqrt(bestD),
    exact: bath.exact?.[best] === 1 || bath.exact?.[best] === true,
    index: best,
  };
}

function nearestSurveyDepth(x, z, points) {
  if (!points?.length) return null;
  let best = null;
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(points.length / 900));
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (!best || bestD > 40 * 40) return null;
  return { depth: Number(best.depth), d: Math.sqrt(bestD) };
}

function enrichPoint(p) {
  if (!p) return null;
  let lat = p.lat;
  let lon = p.lon;
  if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && Number.isFinite(p.x) && Number.isFinite(p.z)) {
    try {
      const ll = localToLonLat(p.x, p.z);
      lat = ll?.lat;
      lon = ll?.lon;
    } catch {
      /* leave null */
    }
  }
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    elevation: Number.isFinite(p.y) ? p.y : null,
  };
}

function emptyProfile(message, extra = {}) {
  return {
    distance_m: extra.distance_m ?? null,
    pointA: extra.pointA ? enrichPoint(extra.pointA) : null,
    pointB: extra.pointB ? enrichPoint(extra.pointB) : null,
    samples: [],
    statistics: {},
    error: message,
  };
}

function nearestChainageMeters(x, z, chainagePts, stations) {
  if (stations?.length) {
    let best = stations[0];
    let bestD = Infinity;
    const step = Math.max(1, Math.floor(stations.length / 500));
    for (let i = 0; i < stations.length; i += step) {
      const s = stations[i];
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    const bi = stations.indexOf(best);
    for (let i = Math.max(0, bi - 20); i <= Math.min(stations.length - 1, bi + 20); i++) {
      const s = stations[i];
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (Number.isFinite(best?.along)) return { meters: best.along, station: best };
    if (Number.isFinite(best?.meters)) return { meters: best.meters, station: best };
    if (Number.isFinite(best?.t) && chainagePts?.length) {
      const last = chainagePts[chainagePts.length - 1];
      const m = best.t * (Number(last?.meters) || 1);
      return { meters: m, station: best };
    }
  }
  if (chainagePts?.length) {
    let best = chainagePts[0];
    let bestD = Infinity;
    for (const p of chainagePts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (Number.isFinite(best?.meters)) return { meters: best.meters, station: best };
  }
  return null;
}

export function formatProfileDistance(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} km`;
  return `${n.toFixed(1)} m`;
}

export function sampleAtDistance(profile, distanceM) {
  const samples = profile?.samples || [];
  if (!samples.length) return null;
  const d = Number(distanceM);
  if (!Number.isFinite(d)) return samples[0];
  let best = samples[0];
  let bestD = Infinity;
  for (const s of samples) {
    const dd = Math.abs(s.distance_m - d);
    if (dd < bestD) {
      bestD = dd;
      best = s;
    }
  }
  return best;
}
