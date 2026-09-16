/**
 * Six named pollution corridor sides (west → east).
 * Every garbage KML site is assigned to the nearest side so arrow
 * navigation covers the full set.
 */
export const POLLUTION_KEY_SIDES = [
  { id: "mulshi", index: 1, name: "Mulshi side", lon: 73.8565, lat: 18.5323 },
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
 * Assign each record to a side; return side summaries with sites sorted west→east.
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
    const bucket = byId.get(side.id);
    if (!bucket) continue;
    r.sideId = side.id;
    r.sideName = side.name;
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
    // Geographic order along corridor (lon west→east), then lat — not chainage,
    // because many western sites snap to the same CH 0+000.
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

  return buckets;
}
