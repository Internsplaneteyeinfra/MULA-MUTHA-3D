import { lonLatToLocal, localToLonLat } from "./geoReference.js";

/** User-facing labels (disambiguates duplicate OSM segments). */
const BRIDGE_DISPLAY_NAMES = {
  "208004768": "Sangamwadi Bridge (Old)",
  "1151682763": "Sangamwadi Bridge (New)",
  "23028035": "Sangam Bridge",
  "22841323": "Shivaji Bridge",
  "216506270": "Dengle Bridge",
  "207164102": "Babasaheb Ambedkar Bridge",
  // Two short OSM stubs → one continuous deck (merged in load)
  "117219023": "Fitzgerald Bridge",
  "117218165": "Fitzgerald Bridge",
  "207164105": "Fitzgerald Bridge",
  "127048454": "Aga Khan Bridge",
  "116839303": "Mundhwa Bridge",
};

/** OSM ids that are bank stubs of the same crossing — keep one merged deck. */
const MERGE_GROUPS = [
  { ids: ["117219023", "117218165", "207164105"], name: "Fitzgerald Bridge", widthM: 14 },
];

/**
 * Load OSM bridges and force each deck to span bank→bank on the corridor centerline.
 * Short OSM ways near one bank caused the "broken mid-river" look.
 */
export async function loadOsmBridges(url, frame, corridor) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load bridges GeoJSON (${res.status})`);
  const fc = await res.json();
  const stations = corridor.stations;
  const raw = [];

  for (const feat of fc.features || []) {
    const coords = feat.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const local = coords.map(([lon, lat]) => {
      const p = lonLatToLocal(lon, lat);
      return { lon, lat, easting: p.easting, northing: p.northing, x: p.x, z: p.z };
    });
    const mid = {
      x: (local[0].x + local[local.length - 1].x) * 0.5,
      z: (local[0].z + local[local.length - 1].z) * 0.5,
      lon: (local[0].lon + local[local.length - 1].lon) * 0.5,
      lat: (local[0].lat + local[local.length - 1].lat) * 0.5,
    };
    if (distToCorridor(mid.x, mid.z, stations) > 1600) continue;

    const osmId = String(feat.properties.osmId);
    raw.push({
      osmId,
      name: BRIDGE_DISPLAY_NAMES[osmId] || feat.properties.name || "Bridge",
      highway: feat.properties.highway,
      widthM: Math.max(12, feat.properties.widthM || 12),
      mid,
      local,
    });
  }

  // Merge known stub groups (Fitzgerald / Bund Garden cluster)
  const consumed = new Set();
  const merged = [];
  for (const group of MERGE_GROUPS) {
    const members = raw.filter((r) => group.ids.includes(r.osmId));
    if (!members.length) continue;
    members.forEach((m) => consumed.add(m.osmId));
    
    // Combine vertices
    let allVerts = [];
    members.forEach(m => allVerts.push(...m.local));
    
    // Find extremes
    let minX = allVerts[0], maxX = allVerts[0];
    for (const v of allVerts) {
      if (v.x < minX.x) minX = v;
      if (v.x > maxX.x) maxX = v;
    }
    
    merged.push({
      id: group.ids[0],
      name: group.name,
      highway: members[0].highway,
      widthM: Math.max(group.widthM, ...members.map((m) => m.widthM)),
      midX: members.reduce((s, m) => s + m.mid.x, 0) / members.length,
      midZ: members.reduce((s, m) => s + m.mid.z, 0) / members.length,
      start: minX,
      end: maxX,
      source: "OpenStreetMap",
      vertices: allVerts
    });
  }

  for (const r of raw) {
    if (consumed.has(r.osmId)) continue;
    merged.push({
      id: r.osmId,
      name: r.name,
      highway: r.highway,
      widthM: r.widthM,
      midX: r.mid.x,
      midZ: r.mid.z,
      start: r.local[0],
      end: r.local[r.local.length - 1],
      source: "OpenStreetMap",
      vertices: r.local
    });
  }

  // Drop near-duplicates (same crossing within 70 m along corridor)
  const deduped = [];
  for (const b of merged.sort((a, c) => a.midX - c.midX || a.midZ - c.midZ)) {
    const near = deduped.find((d) => Math.hypot(d.midX - b.midX, d.midZ - b.midZ) < 70);
    if (near) {
      // Keep the wider / named deck
      if ((b.widthM || 0) > (near.widthM || 0)) {
        const i = deduped.indexOf(near);
        deduped[i] = b;
      }
      continue;
    }
    deduped.push(b);
  }

  deduped.sort((a, b) => a.start.lon - b.start.lon);
  return deduped;
}

function localToLonLatSafe(x, z) {
  try {
    return localToLonLat(x, z);
  } catch {
    return null;
  }
}

function nearestStation(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 400));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = s;
    }
  }
  const idx = stations.indexOf(best);
  for (let i = Math.max(0, idx - step * 2); i <= Math.min(stations.length - 1, idx + step * 2); i++) {
    const s = stations[i];
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = s;
    }
  }
  return best;
}

function distToCorridor(x, z, stations) {
  let best = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 200));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}
