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
  // Small pad — keep Overview tight to the KML corridor (1st-image framing)
  const pad = Math.max(120, Math.max(b.spanX, b.spanZ) * 0.03);
  return finalizeBounds(b.minX - pad, b.maxX + pad, b.minZ - pad, b.maxZ + pad);
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

  return b || dataset.corridor?.bounds || { minX: 0, maxX: 0, minZ: 0, maxZ: 0, spanX: 0, spanZ: 0, cx: 0, cz: 0 };
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
