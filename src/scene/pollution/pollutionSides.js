/**
 * Six named pollution corridor sides (west → east).
 * Every garbage KML site is assigned to the nearest side so arrow
 * navigation covers the full set.
 */
export const POLLUTION_KEY_SIDES = [
  { id: "sangam", index: 1, name: "Sangam side", lon: 73.8598, lat: 18.5316 },
  { id: "sangamwadi", index: 2, name: "Sangamwadi side", lon: 73.8620, lat: 18.5345 },
  { id: "bund_garden", index: 3, name: "Bund Garden side", lon: 73.8831, lat: 18.5430 },
  { id: "mundhwa", index: 4, name: "Mundhwa side", lon: 73.9398, lat: 18.5366 },
  { id: "kharadi", index: 5, name: "Kharadi side", lon: 73.9493, lat: 18.5455 },
  { id: "manjari", index: 6, name: "Manjari side", lon: 73.9831, lat: 18.5298 },
];

/** Squared lon/lat distance — fine for local Pune AOI ranking. */
export function nearestPollutionSide(lon, lat, sides = POLLUTION_KEY_SIDES) {
  let best = sides[0];
  let bestD = Infinity;
  for (const s of sides) {
    const d = (s.lon - lon) ** 2 + (s.lat - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * Check if a garbage record is in or near the river water.
 */
export function isWaterAssociated(r) {
  if (!r) return false;
  // If explicitly classified as Outside River, definitely not in or near water
  if (r.associationStatus === "Outside River") return false;
  if (r.onWater) return true;
  if (r.associationStatus === "River" || r.associationStatus === "Near River") return true;
  if (r.isRiverAssociated) return true;
  if (r.distanceToRiver != null && Number.isFinite(r.distanceToRiver)) {
    return r.distanceToRiver <= 45;
  }
  return false;
}

/**
 * Assign each water-associated record to a side; return side summaries with sites sorted west→east.
 * Records that are NOT in or near water are excluded from the arrow tour.
 * @param {object[]} records
 */
export function buildPollutionSides(records = []) {
  const buckets = POLLUTION_KEY_SIDES.map((s) => ({
    ...s,
    sites: [],
    count: 0,
    meters: null,
  }));
  const byId = new Map(buckets.map((b) => [b.id, b]));

  for (const r of records) {
    const side = nearestPollutionSide(r.lon, r.lat);
    r.sideId = side.id;
    r.sideName = side.name;

    // Whatever is not in or near water: do NOT show in arrow navigation
    if (!isWaterAssociated(r)) continue;

    const bucket = byId.get(side.id);
    if (!bucket) continue;
    bucket.sites.push({
      id: r.id,
      name: r.displayLabel || r.name || `Site ${r.sourceIndex ?? r.id}`,
      chainageLabel: r.chainageLabel || null,
      meters: Number.isFinite(r.riverChainageMeters) ? r.riverChainageMeters : null,
      densityLevel: r.densityLevel || null,
      lon: r.lon,
      lat: r.lat,
    });
  }

  for (const b of buckets) {
    // Geographic order along corridor (lon west→east), then lat
    b.sites.sort((a, c) => {
      const dLon = (a.lon ?? 0) - (c.lon ?? 0);
      if (Math.abs(dLon) > 1e-7) return dLon;
      return (a.lat ?? 0) - (c.lat ?? 0);
    });
    b.count = b.sites.length;
    if (b.sites.length) {
      const mid = b.sites[Math.floor(b.sites.length / 2)];
      b.meters = mid.meters;
      b.focusSiteId = mid.id;
    }
  }

  // Only return sides that have water-associated sites for arrow navigation
  const activeBuckets = buckets.filter((b) => b.count > 0);
  activeBuckets.forEach((b, idx) => {
    b.index = idx + 1;
  });

  return activeBuckets.length ? activeBuckets : buckets;
}

