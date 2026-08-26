/**
 * Build a continuous bathymetry TIN from the Excel lat-row depth grid.
 * Rows are regular in latitude (~0.00012°); lon samples follow the water extent.
 * Flow attributes come from the nearest KML corridor station.
 * Triangles are clipped to the KML river polygon (soft buffer).
 */

export function buildBathymetryFromPoints(points, stations, ringLocal = null) {
  const inside = ringLocal?.length ? makeInsideTest(ringLocal, 6) : () => true;

  const byLat = new Map();
  for (const p of points) {
    if (!inside(p.x, p.z)) continue;
    const key = p.lat.toFixed(8);
    if (!byLat.has(key)) byLat.set(key, []);
    byLat.get(key).push(p);
  }

  const lats = [...byLat.keys()].sort((a, b) => Number(a) - Number(b));
  const rows = lats.map((k) => byLat.get(k).slice().sort((a, b) => a.lon - b.lon));

  const vertices = [];
  const depths = [];
  const alongT = [];
  const acrossU = [];
  const flow = [];
  const narrow = [];
  const widthM = [];
  const curve = [];
  const exact = [];
  const indexOf = new Map();

  function vid(p) {
    if (indexOf.has(p.id)) return indexOf.get(p.id);
    const i = vertices.length / 3;
    indexOf.set(p.id, i);
    vertices.push(p.x, 0, p.z);
    depths.push(p.depth);
    exact.push(1);
    const st = nearestStation(p.x, p.z, stations);
    alongT.push(st.t);
    acrossU.push(acrossParam(p.x, p.z, st));
    flow.push(st.flowX, st.flowZ);
    narrow.push(st.narrow);
    widthM.push(st.width);
    curve.push(st.curve || 0);
    return i;
  }

  const indices = [];
  for (let r = 0; r < rows.length - 1; r++) {
    stitchRows(rows[r], rows[r + 1], indices, vid, vertices, 95);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    minX = Math.min(minX, vertices[i]);
    maxX = Math.max(maxX, vertices[i]);
    minZ = Math.min(minZ, vertices[i + 2]);
    maxZ = Math.max(maxZ, vertices[i + 2]);
  }

  const boundary = extractBoundary(indices, vertices.length / 3);

  return {
    positions: vertices,
    depths,
    alongT,
    acrossU,
    flow,
    narrow,
    widthM,
    curve,
    exact,
    indices,
    boundary,
    source: "mula_mutha_water_depth.xlsx",
    count: depths.length,
    bounds: {
      minX,
      maxX,
      minZ,
      maxZ,
      spanX: maxX - minX,
      spanZ: maxZ - minZ,
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
    },
  };
}

function stitchRows(a, b, indices, vid, vertices, maxEdgeM) {
  if (!a.length || !b.length) return;
  let i = 0;
  let j = 0;
  const max2 = maxEdgeM * maxEdgeM;

  function pushTri(i0, i1, i2) {
    if (!triOk(vertices, i0, i1, i2, max2)) return;
    indices.push(i0, i1, i2);
  }

  while (i < a.length - 1 || j < b.length - 1) {
    const ia = vid(a[Math.min(i, a.length - 1)]);
    const ib = vid(b[Math.min(j, b.length - 1)]);
    if (i >= a.length - 1) {
      const jb = vid(b[j + 1]);
      pushTri(ia, ib, jb);
      j++;
      continue;
    }
    if (j >= b.length - 1) {
      const ja = vid(a[i + 1]);
      pushTri(ia, ja, ib);
      i++;
      continue;
    }
    const nextA = a[i + 1].lon;
    const nextB = b[j + 1].lon;
    if (nextA <= nextB) {
      const ja = vid(a[i + 1]);
      pushTri(ia, ja, ib);
      i++;
    } else {
      const jb = vid(b[j + 1]);
      pushTri(ia, ib, jb);
      j++;
    }
  }
}

function triOk(positions, i0, i1, i2, max2) {
  const edges = [
    [i0, i1],
    [i1, i2],
    [i2, i0],
  ];
  for (const [a, b] of edges) {
    const dx = positions[a * 3] - positions[b * 3];
    const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
    if (dx * dx + dz * dz > max2) return false;
  }
  return true;
}

/** Point-in-polygon with a soft buffer (meters) so bank samples are kept. */
function makeInsideTest(ringLocal, bufferM) {
  const ring = ringLocal.map((p) => ({ x: p.x, z: p.z }));
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 0.5) ring.pop();
  }
  return (x, z) => pointInPoly(x, z, ring) || distToRing(x, z, ring) <= bufferM;
}

function pointInPoly(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function distToRing(x, z, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}

function nearestStation(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 240));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = s;
    }
  }
  const idx = stations.indexOf(best);
  for (let i = Math.max(0, idx - 12); i <= Math.min(stations.length - 1, idx + 12); i++) {
    const s = stations[i];
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = s;
    }
  }
  return best;
}

function acrossParam(x, z, st) {
  const dx = st.rightX - st.leftX;
  const dz = st.rightZ - st.leftZ;
  const len2 = dx * dx + dz * dz || 1;
  const t = ((x - st.leftX) * dx + (z - st.leftZ) * dz) / len2;
  return Math.max(0, Math.min(1, t));
}

function extractBoundary(indices, nVerts) {
  const edgeCount = new Map();
  function add(a, b) {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
  }
  for (let i = 0; i < indices.length; i += 3) {
    add(indices[i], indices[i + 1]);
    add(indices[i + 1], indices[i + 2]);
    add(indices[i + 2], indices[i]);
  }
  const edges = [];
  for (const [key, c] of edgeCount) {
    if (c === 1) {
      const [a, b] = key.split(",").map(Number);
      edges.push([a, b]);
    }
  }
  return edges;
}
