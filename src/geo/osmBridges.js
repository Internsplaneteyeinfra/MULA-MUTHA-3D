import { lonLatToUtm } from "./projection.js";

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
  "207164105": "Bund Garden Bridge",
  "127048454": "Aga Khan Bridge",
  "116839303": "Mundhwa Bridge",
};

/** OSM ids that are bank stubs of the same crossing — keep one merged deck. */
const MERGE_GROUPS = [
  { ids: ["117219023", "117218165", "207164105"], name: "Fitzgerald Bridge", widthM: 12 },
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
      const u = lonLatToUtm(lon, lat);
      const p = frame.toLocal(u.easting, u.northing);
      return { lon, lat, easting: u.easting, northing: u.northing, x: p.x, z: p.z };
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
    const mx = members.reduce((s, m) => s + m.mid.x, 0) / members.length;
    const mz = members.reduce((s, m) => s + m.mid.z, 0) / members.length;
    merged.push(
      makeSpan({
        id: group.ids[0],
        name: group.name,
        highway: members[0].highway,
        widthM: Math.max(group.widthM, ...members.map((m) => m.widthM)),
        midX: mx,
        midZ: mz,
        stations,
      }),
    );
  }

  for (const r of raw) {
    if (consumed.has(r.osmId)) continue;
    // Skip tiny pedestrian stubs that aren't in a merge group and don't clearly cross
    const osmLen = Math.hypot(
      r.local[r.local.length - 1].x - r.local[0].x,
      r.local[r.local.length - 1].z - r.local[0].z,
    );
    const st = nearestStation(r.mid.x, r.mid.z, stations);
    const lat = Math.abs((r.mid.x - st.x) * -st.flowZ + (r.mid.z - st.z) * st.flowX);
    // If stub is short and sits far off centerline on one bank, still snap to center (makeSpan)
    if (osmLen < 40 && r.highway === "pedestrian" && lat > st.halfWidth * 0.35) {
      // still include but snapped — better one deck than a broken stub
    }
    merged.push(
      makeSpan({
        id: r.osmId,
        name: r.name,
        highway: r.highway,
        widthM: r.widthM,
        midX: r.mid.x,
        midZ: r.mid.z,
        stations,
      }),
    );
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

/**
 * Snap mid to corridor centerline and span bank→bank along flow-perpendicular.
 */
function makeSpan({ id, name, highway, widthM, midX, midZ, stations }) {
  const st = nearestStation(midX, midZ, stations);
  // Always from channel center — never from a bank-side OSM stub mid
  const cx = st.x;
  const cz = st.z;
  let ax = -st.flowZ;
  let az = st.flowX;
  const al = Math.hypot(ax, az) || 1;
  ax /= al;
  az /= al;

  const half = Math.max(50, st.halfWidth || 40);
  const bankPad = 48;
  const halfSpan = half + bankPad;
  const span = halfSpan * 2;

  const start = { x: cx - ax * halfSpan, z: cz - az * halfSpan, lon: 0, lat: 0 };
  const end = { x: cx + ax * halfSpan, z: cz + az * halfSpan, lon: 0, lat: 0 };

  return {
    id: String(id),
    name,
    osmName: name,
    highway,
    widthM: Math.max(14, widthM || 12),
    source: "OpenStreetMap",
    start,
    end,
    vertices: [start, end],
    lengthM: span,
    midX: cx,
    midZ: cz,
    axisX: ax,
    axisZ: az,
    channelHalf: half,
  };
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
