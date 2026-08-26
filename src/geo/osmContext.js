import { lonLatToUtm } from "./projection.js";
import { resolveBuildingHeight, resolveTreeHeight } from "./heightResolve.js";

/**
 * Load KML-corridor OSM datasets (new + legacy filenames).
 * All features projected into the shared local frame.
 */
export async function loadOsmContext(frame, corridor, urls = {}) {
  const roadsUrl = urls.roads || "/data/roads.geojson";
  const roadsLegacy = "/data/osm_roads.geojson";
  const buildingsUrl = urls.buildings || "/data/buildings.geojson";
  const buildingsLegacy = "/data/osm_buildings.geojson";
  const vegUrl = urls.vegetation || "/data/vegetation.geojson";
  const greenLegacy = "/data/osm_green.geojson";
  const treesUrl = urls.trees || "/data/trees.geojson";
  const treeRowsUrl = urls.treeRows || "/data/tree_rows.geojson";
  const waterUrl = urls.water || "/data/water_features.geojson";
  const metaUrl = urls.metadata || "/data/feature_metadata.json";
  const kmlValUrl = urls.kmlValidation || "/data/kml_validation.json";

  const [
    roadsFc,
    buildingsFc,
    vegFc,
    treesFc,
    treeRowsFc,
    waterFc,
    metadata,
    kmlValidation,
  ] = await Promise.all([
    fetchFirst([roadsUrl, roadsLegacy]),
    fetchFirst([buildingsUrl, buildingsLegacy]),
    fetchFirst([vegUrl, greenLegacy]),
    fetchOptional(treesUrl),
    fetchOptional(treeRowsUrl),
    fetchOptional(waterUrl),
    fetchOptional(metaUrl),
    fetchOptional(kmlValUrl),
  ]);

  const maxDist = 2200;
  const buildingMaxDist = 4200;
  const roads = projectLines(roadsFc, frame, corridor, maxDist);
  // Keep corridor buildings along full river + inland blocks (roads beyond bank)
  const buildingsAll = projectBuildings(buildingsFc, frame, corridor, buildingMaxDist);
  const buildings = stratifyAlongCorridor(buildingsAll, corridor, 28000);
  const green = projectPolygons(vegFc, frame, corridor, maxDist + 400);
  const trees = projectTrees(treesFc, frame, corridor, maxDist + 200);
  const treeRows = projectLines(treeRowsFc, frame, corridor, maxDist + 200);
  const waterFeatures = projectMixed(waterFc, frame, corridor, maxDist + 400);

  const alignment = validateOsmAlignment(corridor, roads, buildings);

  return {
    roads,
    buildings,
    green,
    vegetation: green,
    trees,
    treeRows,
    waterFeatures,
    metadata,
    kmlValidation,
    alignment,
    source: "OpenStreetMap © contributors",
    loaded: !!(roadsFc || buildingsFc || vegFc || treesFc),
  };
}

async function fetchFirst(urls) {
  for (const url of urls) {
    const fc = await fetchOptional(url);
    if (fc?.features?.length) return fc;
  }
  return null;
}

async function fetchOptional(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function distToCorridor(x, z, stations) {
  let best = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 180));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

function toLocal(lon, lat, frame) {
  const u = lonLatToUtm(lon, lat);
  const p = frame.toLocal(u.easting, u.northing);
  return { lon, lat, easting: u.easting, northing: u.northing, x: p.x, z: p.z };
}

function projectLines(fc, frame, corridor, maxDist) {
  if (!fc?.features) return [];
  const out = [];
  for (const feat of fc.features) {
    const coords = feat.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const verts = coords.map(([lon, lat]) => toLocal(lon, lat, frame));
    const mx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
    const mz = verts.reduce((s, v) => s + v.z, 0) / verts.length;
    if (distToCorridor(mx, mz, corridor.stations) > maxDist) continue;
    let lengthM = 0;
    for (let i = 1; i < verts.length; i++) {
      lengthM += Math.hypot(verts[i].x - verts[i - 1].x, verts[i].z - verts[i - 1].z);
    }
    out.push({
      id: feat.properties?.osmId ?? feat.properties?.id,
      highway: feat.properties?.highway,
      name: feat.properties?.name,
      widthM: feat.properties?.widthM || 5,
      bridge: feat.properties?.bridge,
      tags: feat.properties?.tags,
      vertices: verts,
      lengthM,
      midX: mx,
      midZ: mz,
      source: feat.properties?.source || "OPENSTREETMAP",
    });
  }
  return out;
}

function projectPolygons(fc, frame, corridor, maxDist) {
  if (!fc?.features) return [];
  const out = [];
  for (const feat of fc.features) {
    const ring = feat.geometry?.coordinates?.[0];
    if (!ring || ring.length < 4) continue;
    const verts = ring.map(([lon, lat]) => toLocal(lon, lat, frame));
    const mx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
    const mz = verts.reduce((s, v) => s + v.z, 0) / verts.length;
    if (distToCorridor(mx, mz, corridor.stations) > maxDist) continue;
    out.push({
      id: feat.properties?.osmId ?? feat.properties?.id,
      name: feat.properties?.name,
      leisure: feat.properties?.leisure,
      landuse: feat.properties?.landuse,
      natural: feat.properties?.natural,
      vertices: verts,
      midX: mx,
      midZ: mz,
      source: feat.properties?.source || "OPENSTREETMAP",
      tags: feat.properties?.tags,
    });
  }
  return out;
}

function projectBuildings(fc, frame, corridor, maxDist) {
  if (!fc?.features) return [];
  const out = [];
  for (const feat of fc.features) {
    const ring = feat.geometry?.coordinates?.[0];
    if (!ring || ring.length < 4) continue;
    const verts = ring.map(([lon, lat]) => toLocal(lon, lat, frame));
    const mx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
    const mz = verts.reduce((s, v) => s + v.z, 0) / verts.length;
    if (distToCorridor(mx, mz, corridor.stations) > maxDist) continue;
    const resolved = resolveBuildingHeight(feat.properties || {});
    out.push({
      id: feat.properties?.osmId ?? feat.properties?.id,
      name: feat.properties?.name,
      heightM: resolved.height,
      height_source: resolved.height_source,
      levels: feat.properties?.levels ?? feat.properties?.["building:levels"],
      building: feat.properties?.building,
      material: feat.properties?.material,
      addr_street: feat.properties?.addr_street,
      addr_housenumber: feat.properties?.addr_housenumber,
      amenity: feat.properties?.amenity,
      leisure: feat.properties?.leisure,
      landuse: feat.properties?.landuse,
      natural: feat.properties?.natural,
      vertices: verts,
      original_coordinates: ring,
      midX: mx,
      midZ: mz,
      source: feat.properties?.source || "OPENSTREETMAP",
      tags: feat.properties?.tags,
    });
  }
  return out;
}

function projectTrees(fc, frame, corridor, maxDist) {
  if (!fc?.features) return [];
  const out = [];
  for (const feat of fc.features) {
    const c = feat.geometry?.coordinates;
    if (!c || c.length < 2) continue;
    const [lon, lat] = c;
    const loc = toLocal(lon, lat, frame);
    if (distToCorridor(loc.x, loc.z, corridor.stations) > maxDist) continue;
    const seed = Number(feat.properties?.osmId) || out.length;
    const resolved = resolveTreeHeight(feat.properties || {}, seed);
    out.push({
      id: feat.properties?.osmId ?? feat.properties?.id,
      ...loc,
      tree_height: resolved.height,
      height_source: resolved.height_source,
      genus: feat.properties?.genus,
      species: feat.properties?.species,
      circumference: feat.properties?.circumference,
      diameter_crown: feat.properties?.diameter_crown,
      from_tree_row: !!feat.properties?.from_tree_row,
      source: feat.properties?.source || "OPENSTREETMAP",
      tags: feat.properties?.tags,
    });
  }
  return out;
}

function projectMixed(fc, frame, corridor, maxDist) {
  if (!fc?.features) return [];
  const out = [];
  for (const feat of fc.features) {
    const g = feat.geometry;
    if (!g) continue;
    if (g.type === "LineString") {
      const verts = g.coordinates.map(([lon, lat]) => toLocal(lon, lat, frame));
      const mx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
      const mz = verts.reduce((s, v) => s + v.z, 0) / verts.length;
      if (distToCorridor(mx, mz, corridor.stations) > maxDist) continue;
      out.push({ type: "line", id: feat.properties?.osmId, props: feat.properties, vertices: verts });
    } else if (g.type === "Polygon") {
      const ring = g.coordinates?.[0];
      if (!ring) continue;
      const verts = ring.map(([lon, lat]) => toLocal(lon, lat, frame));
      const mx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
      const mz = verts.reduce((s, v) => s + v.z, 0) / verts.length;
      if (distToCorridor(mx, mz, corridor.stations) > maxDist) continue;
      out.push({ type: "poly", id: feat.properties?.osmId, props: feat.properties, vertices: verts });
    }
  }
  return out;
}

/**
 * Alignment check: median distance of OSM building centroids to corridor.
 * Large offset → report; do not silently shift.
 */
function validateOsmAlignment(corridor, roads, buildings) {
  const stations = corridor.stations || [];
  if (!stations.length) {
    return { ok: false, issues: ["No corridor stations for alignment check"] };
  }
  const sample = buildings.slice(0, 80);
  if (!sample.length && !roads.length) {
    return { ok: true, issues: ["No OSM features loaded — alignment skipped"], medianDistM: null };
  }
  const dists = sample.map((b) => distToCorridor(b.midX, b.midZ, stations)).sort((a, b) => a - b);
  const median = dists.length ? dists[Math.floor(dists.length / 2)] : null;
  const issues = [];
  let ok = true;
  if (median != null && median > 1800) {
    ok = false;
    issues.push(
      `OSM–KML alignment WARNING: median building distance to river corridor is ${median.toFixed(0)} m. Possible projection/origin mismatch. Features were NOT shifted.`,
    );
  }
  return { ok, issues, medianDistM: median, sampleCount: dists.length };
}

/**
 * Keep buildings evenly along the river so east corridor is not dropped
 * when west/central density is high.
 */
function stratifyAlongCorridor(buildings, corridor, maxKeep) {
  if (!buildings?.length) return [];
  if (buildings.length <= maxKeep) return buildings;
  const stations = corridor?.stations || [];
  if (stations.length < 2) return buildings.slice(0, maxKeep);

  const bins = 40;
  const buckets = Array.from({ length: bins }, () => []);
  for (const b of buildings) {
    let bestI = 0;
    let bestD = Infinity;
    const step = Math.max(1, Math.floor(stations.length / 250));
    for (let i = 0; i < stations.length; i += step) {
      const s = stations[i];
      const d2 = (s.x - b.midX) ** 2 + (s.z - b.midZ) ** 2;
      if (d2 < bestD) {
        bestD = d2;
        bestI = i;
      }
    }
    const u = bestI / (stations.length - 1);
    const bi = Math.min(bins - 1, Math.floor(u * bins));
    buckets[bi].push({ b, d: Math.sqrt(bestD) });
  }
  for (const bucket of buckets) bucket.sort((a, c) => a.d - c.d);

  const per = Math.max(1, Math.floor(maxKeep / bins));
  const out = [];
  for (const bucket of buckets) {
    // Mix near-bank + mid-distance so inland blocks are not emptied
    const near = bucket.filter((x) => x.d < 900);
    const mid = bucket.filter((x) => x.d >= 900 && x.d < 2200);
    const far = bucket.filter((x) => x.d >= 2200);
    const take = [];
    const quotas = [
      Math.ceil(per * 0.45),
      Math.ceil(per * 0.35),
      Math.ceil(per * 0.2),
    ];
    for (const [pool, q] of [
      [near, quotas[0]],
      [mid, quotas[1]],
      [far, quotas[2]],
    ]) {
      for (let i = 0; i < pool.length && take.length < per && i < q; i++) {
        take.push(pool[i].b);
      }
    }
    // Fill remainder from leftover nearest
    if (take.length < per) {
      const taken = new Set(take);
      for (const item of bucket) {
        if (take.length >= per) break;
        if (!taken.has(item.b)) take.push(item.b);
      }
    }
    out.push(...take);
  }
  // Fill remainder with nearest leftover buildings
  if (out.length < maxKeep) {
    const taken = new Set(out);
    const rest = [];
    for (const bucket of buckets) {
      for (const item of bucket) {
        if (!taken.has(item.b)) rest.push(item);
      }
    }
    rest.sort((a, c) => a.d - c.d);
    for (const item of rest) {
      if (out.length >= maxKeep) break;
      out.push(item.b);
    }
  }
  return out.slice(0, maxKeep);
}
