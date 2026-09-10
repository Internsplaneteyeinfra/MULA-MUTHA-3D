/**
 * Reconstruct a continuous river corridor from a KML boundary polygon.
 * Banks are the two paths between farthest tips of the polygon.
 * Path orientation follows geometry only (tip A → tip B by chainage).
 * No place-name assumptions.
 */

export function buildCorridorFromKml(ringLocal, depthPoints, opts = {}) {
  const nStations = opts.nStations ?? 720;
  const across = opts.across ?? 40;
  const centerlineLocal = opts.centerlineLocal || null;

  const closed = closeRing(ringLocal);
  const { left, right, tipA, tipB } = splitBanks(closed);
  const L = resample(left, nStations);
  const R = resample(right, nStations);

  let stations = [];
  for (let i = 0; i < nStations; i++) {
    const lx = L[i].x;
    const lz = L[i].z;
    const rx = R[i].x;
    const rz = R[i].z;
    const x = (lx + rx) * 0.5;
    const z = (lz + rz) * 0.5;
    const half = Math.hypot(rx - lx, rz - lz) * 0.5;
    stations.push({
      x,
      z,
      leftX: lx,
      leftZ: lz,
      rightX: rx,
      rightZ: rz,
      // Exact bank-to-bank half-width from KML (no artificial shrink)
      halfWidth: Math.max(8, half),
      width: Math.max(16, half * 2),
    });
  }

  // Orient path so chainage increases downstream (geographic east for Mutha).
  // Use tip easting (CRS metres), not local X sign.
  let shouldReverse = false;
  if (Number.isFinite(tipA?.easting) && Number.isFinite(tipB?.easting)) {
    // stations[0] sits at tipA; reverse if that tip is already farther east
    shouldReverse = tipA.easting > tipB.easting;
  } else {
    const dx = stations[stations.length - 1].x - stations[0].x;
    const dz = stations[stations.length - 1].z - stations[0].z;
    shouldReverse = Math.abs(dx) >= Math.abs(dz) ? dx < 0 : dz < 0;
  }
  if (shouldReverse) {
    stations.reverse();
    for (const s of stations) {
      const tx = s.leftX;
      const tz = s.leftZ;
      s.leftX = s.rightX;
      s.leftZ = s.rightZ;
      s.rightX = tx;
      s.rightZ = tz;
    }
  }

  // Minimal smooth — preserve KML bank-to-bank width (heavy smooth shrinks water)
  smoothBanks(stations, 1);

  // Snap midpoints to KML centerline; keep measured bank half-widths
  if (centerlineLocal?.length >= 2) {
    snapStationsToCenterline(stations, centerlineLocal);
  }

  // Keep banks tight to KML (was 1.02 — spilled water onto OSM buildings/roads)
  expandBanks(stations, 1.005);

  assignTangents(stations);

  const chainage = [0];
  for (let i = 1; i < stations.length; i++) {
    chainage.push(
      chainage[i - 1] + Math.hypot(stations[i].x - stations[i - 1].x, stations[i].z - stations[i - 1].z),
    );
  }
  const length = chainage[chainage.length - 1] || 1;

  for (let i = 0; i < stations.length; i++) {
    stations[i].along = chainage[i];
    stations[i].t = chainage[i] / length;
    stations[i].narrow = Math.max(0, 1 - stations[i].width / medianWidth(stations));
  }

  // Mid-path index for local inspection — geometric midpoint, not a named place.
  const midPathIdx = Math.floor(stations.length * 0.5);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of stations) {
    minX = Math.min(minX, s.leftX, s.rightX);
    maxX = Math.max(maxX, s.leftX, s.rightX);
    minZ = Math.min(minZ, s.leftZ, s.rightZ);
    maxZ = Math.max(maxZ, s.leftZ, s.rightZ);
  }

  const mesh = rasterize(stations, across, depthPoints || []);
  const boundary = bankBoundary(stations.length, across);

  return {
    stations,
    across,
    length,
    midPathIdx,
    sangamIdx: midPathIdx, // legacy alias for camera code
    tipA,
    tipB,
    ...mesh,
    boundary,
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

function bankBoundary(rows, across) {
  const cols = across + 1;
  const edges = [];
  for (let s = 0; s < rows - 1; s++) {
    edges.push([s * cols, (s + 1) * cols]);
    edges.push([s * cols + cols - 1, (s + 1) * cols + cols - 1]);
  }
  return edges;
}

function closeRing(ring) {
  const pts = ring.map((p) => ({ ...p, x: p.x, z: p.z }));
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 0.5) pts.pop();
  }
  return pts;
}

function splitBanks(ring) {
  let iMin = 0;
  let iMax = 0;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i].x < ring[iMin].x) iMin = i;
    if (ring[i].x > ring[iMax].x) iMax = i;
  }
  const left = walk(ring, iMin, iMax);
  const right = walk(ring, iMin, iMax, true);
  return { left, right, tipA: ring[iMin], tipB: ring[iMax] };
}

function walk(ring, from, to, reverse = false) {
  const n = ring.length;
  const out = [];
  let i = from;
  const step = reverse ? -1 : 1;
  for (let k = 0; k <= n; k++) {
    out.push(ring[i]);
    if (i === to && k > 0) break;
    i = (i + step + n) % n;
  }
  return out;
}

function resample(pts, n) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const total = acc[acc.length - 1] || 1;
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = (total * i) / (n - 1);
    while (j < acc.length - 2 && acc[j + 1] < d) j++;
    const span = Math.max(1e-6, acc[j + 1] - acc[j]);
    const u = (d - acc[j]) / span;
    out.push({
      x: pts[j].x + (pts[j + 1].x - pts[j].x) * u,
      z: pts[j].z + (pts[j + 1].z - pts[j].z) * u,
    });
  }
  return out;
}

function smoothBanks(stations, passes) {
  for (let p = 0; p < passes; p++) {
    const lx = stations.map((s) => s.leftX);
    const lz = stations.map((s) => s.leftZ);
    const rx = stations.map((s) => s.rightX);
    const rz = stations.map((s) => s.rightZ);
    for (let i = 1; i < stations.length - 1; i++) {
      stations[i].leftX = (lx[i - 1] + lx[i] * 3 + lx[i + 1]) / 5;
      stations[i].leftZ = (lz[i - 1] + lz[i] * 3 + lz[i + 1]) / 5;
      stations[i].rightX = (rx[i - 1] + rx[i] * 3 + rx[i + 1]) / 5;
      stations[i].rightZ = (rz[i - 1] + rz[i] * 3 + rz[i + 1]) / 5;
      stations[i].x = (stations[i].leftX + stations[i].rightX) * 0.5;
      stations[i].z = (stations[i].leftZ + stations[i].rightZ) * 0.5;
      stations[i].halfWidth =
        Math.hypot(stations[i].rightX - stations[i].leftX, stations[i].rightZ - stations[i].leftZ) * 0.5;
      stations[i].width = stations[i].halfWidth * 2;
    }
  }
}

/** Move station centers onto the KML centerline; preserve exact bank half-widths. */
function snapStationsToCenterline(stations, centerline) {
  const cl = resample(centerline, stations.length);
  const dStart = Math.hypot(cl[0].x - stations[0].x, cl[0].z - stations[0].z);
  const dEnd = Math.hypot(
    cl[cl.length - 1].x - stations[0].x,
    cl[cl.length - 1].z - stations[0].z,
  );
  if (dEnd < dStart) cl.reverse();

  for (let i = 0; i < stations.length; i++) {
    const c = cl[i];
    // Keep measured bank span — never clamp down to a narrow strip
    const half = Math.max(
      8,
      Math.hypot(stations[i].rightX - stations[i].leftX, stations[i].rightZ - stations[i].leftZ) * 0.5,
    );
    let px = stations[i].rightX - stations[i].leftX;
    let pz = stations[i].rightZ - stations[i].leftZ;
    const plen = Math.hypot(px, pz) || 1;
    px /= plen;
    pz /= plen;
    stations[i].x = c.x;
    stations[i].z = c.z;
    stations[i].leftX = c.x - px * half;
    stations[i].leftZ = c.z - pz * half;
    stations[i].rightX = c.x + px * half;
    stations[i].rightZ = c.z + pz * half;
    stations[i].halfWidth = half;
    stations[i].width = half * 2;
  }
}

/** Expand left/right banks outward from center by factor (e.g. 1.02 = +2%). */
function expandBanks(stations, factor = 1.02) {
  for (const s of stations) {
    const half = s.halfWidth * factor;
    let px = s.rightX - s.leftX;
    let pz = s.rightZ - s.leftZ;
    const plen = Math.hypot(px, pz) || 1;
    px /= plen;
    pz /= plen;
    s.leftX = s.x - px * half;
    s.leftZ = s.z - pz * half;
    s.rightX = s.x + px * half;
    s.rightZ = s.z + pz * half;
    s.halfWidth = half;
    s.width = half * 2;
  }
}

function assignTangents(stations) {
  for (let i = 0; i < stations.length; i++) {
    const a = stations[Math.max(0, i - 1)];
    const b = stations[Math.min(stations.length - 1, i + 1)];
    let fx = b.x - a.x;
    let fz = b.z - a.z;
    const len = Math.hypot(fx, fz) || 1;
    stations[i].flowX = fx / len;
    stations[i].flowZ = fz / len;
  }
  for (let i = 0; i < stations.length; i++) {
    const a = stations[Math.max(0, i - 1)];
    const b = stations[Math.min(stations.length - 1, i + 1)];
    const cross = a.flowX * b.flowZ - a.flowZ * b.flowX;
    stations[i].curve = Math.min(1, Math.abs(cross) * 8);
  }
}

function medianWidth(stations) {
  const w = stations.map((s) => s.width).sort((a, b) => a - b);
  return w[Math.floor(w.length / 2)] || 120;
}

function rasterize(stations, across, depthPoints) {
  const positions = [];
  const depths = [];
  const alongT = [];
  const acrossU = [];
  const flow = [];
  const narrow = [];
  const widthM = [];
  const curve = [];
  const exact = [];
  const bedElev = [];

  const index = spatialIndex(depthPoints);

  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    for (let a = 0; a <= across; a++) {
      const u = a / across;
      const x = st.leftX + (st.rightX - st.leftX) * u;
      const z = st.leftZ + (st.rightZ - st.leftZ) * u;
      const sample = sampleDepth(x, z, depthPoints, index, st);
      positions.push(x, 0, z);
      depths.push(sample.depth);
      alongT.push(st.t);
      acrossU.push(u);
      flow.push(st.flowX, st.flowZ);
      narrow.push(st.narrow);
      widthM.push(st.width);
      curve.push(st.curve || 0);
      exact.push(sample.exact ? 1 : 0);
      bedElev.push(-sample.depth);
    }
  }

  const cols = across + 1;
  const indices = [];
  for (let s = 0; s < stations.length - 1; s++) {
    for (let a = 0; a < across; a++) {
      const i0 = s * cols + a;
      indices.push(i0, i0 + cols, i0 + 1);
      indices.push(i0 + 1, i0 + cols, i0 + cols + 1);
    }
  }

  // Ensure triangles face +Y (camera from above). Removing flipX can reverse
  // bank left/right winding so FrontSide water/bed would be fully culled.
  if (indices.length >= 3) {
    const a = indices[0];
    const b = indices[1];
    const c = indices[2];
    const ax = positions[a * 3];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3];
    const bz = positions[b * 3 + 2];
    const cx = positions[c * 3];
    const cz = positions[c * 3 + 2];
    const ny = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (ny < 0) {
      for (let i = 0; i < indices.length; i += 3) {
        const t = indices[i + 1];
        indices[i + 1] = indices[i + 2];
        indices[i + 2] = t;
      }
    }
  }

  // Visual-only smooth — blur ALL verts so Overview depth looks continuous
  // (exact Excel hits used to skip smoothing and left rectangular plateaus)
  const smoothed = depths.slice();
  for (let pass = 0; pass < 5; pass++) {
    for (let s = 1; s < stations.length - 1; s++) {
      for (let a = 1; a < across; a++) {
        const i = s * cols + a;
        smoothed[i] =
          (depths[i] * 2 +
            depths[i - 1] +
            depths[i + 1] +
            depths[i - cols] +
            depths[i + cols]) /
          6;
      }
    }
    // Soften bank edge columns too (a = 0 and a = across)
    for (let s = 1; s < stations.length - 1; s++) {
      const iL = s * cols;
      const iR = s * cols + across;
      smoothed[iL] = (depths[iL] * 2 + depths[iL + 1] + depths[iL - cols] + depths[iL + cols]) / 5;
      smoothed[iR] = (depths[iR] * 2 + depths[iR - 1] + depths[iR - cols] + depths[iR + cols]) / 5;
    }
    for (let i = 0; i < depths.length; i++) depths[i] = smoothed[i];
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  return {
    positions,
    depths,
    alongT,
    acrossU,
    flow,
    narrow,
    widthM,
    curve,
    exact,
    bedElev,
    indices,
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

function spatialIndex(points) {
  const cell = 80;
  const map = new Map();
  for (const p of points) {
    const kx = Math.floor(p.x / cell);
    const kz = Math.floor(p.z / cell);
    const key = `${kx},${kz}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return { cell, map };
}

function neighbors(index, x, z) {
  const { cell, map } = index;
  const kx = Math.floor(x / cell);
  const kz = Math.floor(z / cell);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const bin = map.get(`${kx + dx},${kz + dz}`);
      if (bin) out.push(...bin);
    }
  }
  return out;
}

function sampleDepth(x, z, points, index, station) {
  const near = neighbors(index, x, z);

  // Always inverse-distance blend — never snap to a single Excel point.
  // Nearest-neighbor snaps create Voronoi "blocks" on the Overview water surface.
  let wSum = 0;
  let dSum = 0;
  let n = 0;
  let nearestD = Infinity;
  for (const p of near) {
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 < nearestD) nearestD = d2;
    if (d2 > 120 * 120) continue;
    // Soft IDW: nearby points dominate, but never a hard cell boundary
    const w = 1 / Math.max(2.5, d2 * 0.35);
    wSum += w;
    dSum += w * p.depth;
    n++;
  }
  if (n >= 2 && wSum > 0) {
    return { depth: dSum / wSum, exact: nearestD < 2.5 * 2.5 };
  }

  // Wider fallback across the full point set (capped)
  let w2 = 0;
  let d2s = 0;
  let n2 = 0;
  for (const p of points) {
    if (Math.abs(p.x - x) > 280 || Math.abs(p.z - z) > 280) continue;
    const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
    const w = 1 / Math.max(6, dd * 0.25);
    w2 += w;
    d2s += w * p.depth;
    n2++;
    if (n2 > 60) break;
  }
  if (n2 > 0) return { depth: d2s / w2, exact: false };

  // Channel-shaped fallback from station width (continuous across banks)
  const u = station
    ? Math.min(
        1,
        Math.hypot(x - station.x, z - station.z) / Math.max(8, station.halfWidth || 40),
      )
    : 0.5;
  const midDepth = 1.75;
  return { depth: midDepth * (0.55 + 0.45 * (1 - u * u)), exact: false };
}

export function detectBridgeSites(stations) {
  const widths = stations.map((s) => s.width);
  const med = medianWidth(stations);
  const sites = [];
  for (let i = 8; i < stations.length - 8; i++) {
    const local = widths.slice(i - 6, i + 7);
    const mean = local.reduce((a, b) => a + b, 0) / local.length;
    if (stations[i].width < mean * 0.72 && stations[i].width < med * 0.85) {
      const prev = sites[sites.length - 1];
      if (prev && Math.hypot(stations[i].x - prev.x, stations[i].z - prev.z) < 420) continue;
      sites.push({
        x: stations[i].x,
        z: stations[i].z,
        flowX: stations[i].flowX,
        flowZ: stations[i].flowZ,
        width: stations[i].width,
        halfWidth: stations[i].halfWidth,
        t: stations[i].t,
        index: i,
      });
    }
  }
  // Ensure a few evenly spaced crossings if constriction search is sparse
  if (sites.length < 6) {
    for (const t of [0.12, 0.22, 0.34, 0.48, 0.62, 0.76, 0.88]) {
      const i = Math.floor(t * (stations.length - 1));
      const st = stations[i];
      if (sites.some((s) => Math.abs(s.t - st.t) < 0.06)) continue;
      sites.push({
        x: st.x,
        z: st.z,
        flowX: st.flowX,
        flowZ: st.flowZ,
        width: st.width,
        halfWidth: st.halfWidth,
        t: st.t,
        index: i,
      });
    }
  }
  sites.sort((a, b) => a.t - b.t);
  return sites;
}
