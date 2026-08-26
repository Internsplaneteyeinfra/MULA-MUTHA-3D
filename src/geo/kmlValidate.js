/**
 * KML validation helpers — report issues; never silently move coordinates.
 * KML order is always longitude, latitude [, altitude].
 */

export function validateLonLatPoints(points, { label = "geometry" } = {}) {
  const issues = [];
  const jumps = [];
  if (!points?.length) {
    return { ok: false, issues: [`${label}: no points`], bbox: null, duplicates: 0, jumps };
  }

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const seen = new Set();
  let duplicates = 0;
  let swappedHint = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const lon = p.lon;
    const lat = p.lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      issues.push(`${label}[${i}]: non-finite coordinate`);
      continue;
    }
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);

    // Pune region: lon≈73.x, lat≈18.x — swapped would invert that
    if (lon > 17 && lon < 20 && lat > 72 && lat < 75) swappedHint++;

    const key = `${lon.toFixed(7)},${lat.toFixed(7)}`;
    if (seen.has(key)) duplicates++;
    else seen.add(key);

    if (i > 0) {
      const d = approxMeters(points[i - 1], p);
      if (d > 250) {
        jumps.push({ index: i, distance_m: Math.round(d), from: points[i - 1], to: p });
      }
    }
  }

  if (swappedHint > Math.min(20, points.length * 0.3)) {
    issues.push(
      `${label}: SUSPICIOUS lon/lat swap — many points look like latitude stored as longitude. KML must be lon,lat,alt.`,
    );
  }

  if (minLon < 60 || maxLon > 100 || minLat < 5 || maxLat > 40) {
    issues.push(`${label}: bbox outside expected South-Asia range (not silently corrected)`);
  }

  if (jumps.length) {
    issues.push(`${label}: ${jumps.length} consecutive jump(s) >250 m reported (coordinates not moved)`);
  }

  return {
    ok: !issues.some((s) => s.includes("SUSPICIOUS")),
    issues,
    bbox: { minLon, maxLon, minLat, maxLat },
    duplicates,
    jumps,
    coordinateOrder: "longitude, latitude, altitude",
  };
}

function approxMeters(a, b) {
  const mx = (b.lon - a.lon) * 111320 * Math.cos((((a.lat + b.lat) * 0.5) * Math.PI) / 180);
  const my = (b.lat - a.lat) * 111320;
  return Math.hypot(mx, my);
}

/** Buffer geographic bbox by meters → {south,west,north,east} for Overpass. */
export function bufferBboxMeters(bbox, bufferM = 500) {
  const midLat = (bbox.minLat + bbox.maxLat) * 0.5;
  const dLat = bufferM / 111320;
  const dLon = bufferM / (111320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  return {
    south: bbox.minLat - dLat,
    north: bbox.maxLat + dLat,
    west: bbox.minLon - dLon,
    east: bbox.maxLon + dLon,
    bufferM,
  };
}
