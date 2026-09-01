/**
 * Unified geographic bounds — union of KML, corridor, OSM layers.
 * Single source for terrain extent; no per-layer normalization.
 */

export function boundsFromPoints(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points || []) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  if (!Number.isFinite(minX)) return null;
  return finalizeBounds(minX, maxX, minZ, maxZ);
}

function finalizeBounds(minX, maxX, minZ, maxZ) {
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    spanX: maxX - minX,
    spanZ: maxZ - minZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
  };
}

function mergeBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  return finalizeBounds(
    Math.min(a.minX, b.minX),
    Math.max(a.maxX, b.maxX),
    Math.min(a.minZ, b.minZ),
    Math.max(a.maxZ, b.maxZ),
  );
}

/** KML river polygon (+ corridor) — authoritative framing for Overview camera. */
export function computeKmlOverviewBounds(dataset) {
  let b = boundsFromPoints(dataset.ringLocal);
  b = mergeBounds(b, boundsFromPoints(dataset.corridor?.stations));
  if (!b) {
    return (
      dataset.corridor?.bounds || {
        minX: 0,
        maxX: 0,
        minZ: 0,
        maxZ: 0,
        spanX: 0,
        spanZ: 0,
        cx: 0,
        cz: 0,
      }
    );
  }
  return paddedSceneBounds(b, 0.12);
}

/** Apply 15–20% geographic padding to prevent empty sides / cropping. */
export function paddedSceneBounds(bounds, padRatio = 0.18) {
  if (!bounds) return bounds;
  const padX = Math.max(120, bounds.spanX * padRatio);
  const padZ = Math.max(120, bounds.spanZ * padRatio);
  return finalizeBounds(
    bounds.minX - padX,
    bounds.maxX + padX,
    bounds.minZ - padZ,
    bounds.maxZ + padZ,
  );
}

/** Union: KML ring + corridor stations + OSM buildings/roads/trees. */
export function computeSceneBounds(dataset) {
  let b = boundsFromPoints(dataset.ringLocal);
  b = mergeBounds(b, boundsFromPoints(dataset.corridor?.stations));

  const osm = dataset.osm || {};
  for (const feat of osm.buildings || []) {
    b = mergeBounds(b, boundsFromPoints(feat.vertices));
  }
  for (const feat of osm.roads || []) {
    b = mergeBounds(b, boundsFromPoints(feat.vertices));
  }
  for (const feat of osm.trees || []) {
    b = mergeBounds(b, boundsFromPoints([{ x: feat.x, z: feat.z }]));
  }
  for (const feat of osm.green || []) {
    b = mergeBounds(b, boundsFromPoints(feat.vertices));
  }
  for (const br of dataset.bridges || []) {
    b = mergeBounds(b, boundsFromPoints(br.vertices));
  }

  const raw = b || dataset.corridor?.bounds || { minX: 0, maxX: 0, minZ: 0, maxZ: 0, spanX: 0, spanZ: 0, cx: 0, cz: 0 };
  return paddedSceneBounds(raw);
}

/**
 * Meaningful content bounds for overview framing — NOT full terrain extent.
 * River + banks + nearby urban context (buildings, roads, bridges, fishing).
 */
export function computeActiveSceneBounds(dataset, padRatio = 0.15) {
  const stations = dataset.corridor?.stations || [];
  // Core urban river reach — exclude far upstream/downstream empty terrain
  const lo = Math.floor(stations.length * 0.12);
  const hi = Math.ceil(stations.length * 0.88);
  const core = stations.slice(lo, hi);

  let b = boundsFromPoints(core.length ? core : stations);
  b = mergeBounds(b, boundsFromPoints(dataset.ringLocal));

  const osm = dataset.osm || {};
  const maxUrbanDist = 650;
  for (const feat of osm.buildings || []) {
    if (nearCorridor(feat.midX, feat.midZ, core.length ? core : stations, maxUrbanDist)) {
      b = mergeBounds(b, boundsFromPoints(feat.vertices));
    }
  }
  for (const feat of osm.roads || []) {
    if (nearCorridor(feat.midX, feat.midZ, core.length ? core : stations, maxUrbanDist)) {
      b = mergeBounds(b, boundsFromPoints(feat.vertices));
    }
  }
  for (const br of dataset.bridges || []) {
    b = mergeBounds(b, boundsFromPoints(br.vertices));
  }
  for (const z of dataset.fishingZones || []) {
    b = mergeBounds(b, boundsFromPoints([{ x: z.x, z: z.z }]));
  }

  const raw = b || computeKmlOverviewBounds(dataset);
  return paddedSceneBounds(raw, padRatio);
}

function nearCorridor(x, z, stations, maxDist) {
  if (!stations.length) return true;
  let best = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 200));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    best = Math.min(best, Math.hypot(s.x - x, s.z - z));
  }
  return best <= maxDist;
}

/** Debug validation: verify layer bboxes overlap KML extent. */
export function validateLayerAlignment(dataset) {
  const kml = boundsFromPoints(dataset.ringLocal);
  const terrain = computeSceneBounds(dataset);
  const river = boundsFromPoints(dataset.corridor?.stations);
  const issues = [];

  function overlap(a, b, label) {
    if (!a || !b) {
      issues.push(`${label}: missing bounds`);
      return false;
    }
    const ok =
      a.maxX >= b.minX - 200 &&
      a.minX <= b.maxX + 200 &&
      a.maxZ >= b.minZ - 200 &&
      a.minZ <= b.maxZ + 200;
    if (!ok) issues.push(`${label} bbox does not overlap KML (check CRS)`);
    return ok;
  }

  const osmPts = [];
  for (const b of dataset.osm?.buildings || []) osmPts.push(...(b.vertices || []));
  for (const r of dataset.osm?.roads || []) osmPts.push(...(r.vertices || []));
  const osmBox = boundsFromPoints(osmPts);

  overlap(terrain, kml, "terrain");
  overlap(river, kml, "river");
  if (osmBox) overlap(osmBox, kml, "OSM");

  const report = {
    kml: kml,
    terrain: terrain,
    river: river,
    osm: osmBox,
    issues,
    ok: issues.length === 0,
  };
  console.info("=== LAYER BBOX ALIGNMENT ===", report);
  return report;
}
