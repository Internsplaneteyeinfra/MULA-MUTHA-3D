/**
 * Channel banks: a fine ground grid over the band around the wet ribbon.
 *
 * The rendered terrain grid (~77 m × 31 m cells) cannot represent a 30–250 m wide channel: its
 * triangles straddled the shore, poking up to 13 m through the water or showing as long brown
 * slopes under it. carveTerrainUnderRiver() sinks that grid out of the way near the water, and
 * this patch draws the channel sides and banks instead, on an 8 m grid, from the signed distance
 * d to the ribbon outline (d < 0 in the water):
 *
 *   d < 0   channel side under the water, sloping from the waterline down below the river bed
 *   d = 0   the waterline — so the shoreline is exactly the water ribbon's edge
 *   d > 0   real ground (FABDEM DTM), rising from the waterline no steeper than MAX_BANK_SLOPE,
 *           then blending into the rendered terrain grid at the outer edge (seamless join).
 *
 * A regular grid cannot fold at tight bends (an offset strip did), and the distance field closes
 * the channel at both ends of the river.
 */
import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import {
  ribbonEdgeDistance,
  makeStationLocator,
  terrainCellDiag,
  terrainHeightAt,
  rawDtmElevationAt,
} from "./terrain.js";

const GRID_M = 8;
const SHORE_FLOOR_M = 6; // banks stay at/above the waterline within this distance
const MAX_BANK_LIFT_M = 0.6; // banks follow a rising water level only this far (floods overtop)
/**
 * Steepest bank rise from the waterline (m per m). FABDEM's 30 m pixels mix water and steep
 * embankments, giving up to ~48 m of rise within 1.5 m of the shore; the bank ramps up to the
 * real ground at this slope instead of forming a cliff at the water's edge.
 */
const MAX_BANK_SLOPE = 0.95;
const UNDER_SLOPE = 0.8; // channel side under the water

/**
 * Height of the bank the camera actually sees. Trees must use this same value
 * so trunks sit on the surface. d < 0 is under the water sheet.
 */
export function channelBankY(d, realY, coarseY, waterY, blendStart = Infinity, outerD = Infinity) {
  const shore = Math.min(waterY ?? SURFACE_Y, SURFACE_Y + MAX_BANK_LIFT_M);
  const deep = SURFACE_Y - 30;
  if (d < 0) return Math.max(deep, shore - 0.02 + d * UNDER_SLOPE);
  const real = Number.isFinite(realY) ? realY : shore + 0.2;
  // Short ramp off the waterline, then the real ground — so a bank like Naik Bet
  // keeps its elevation instead of staying a flat shelf.
  let y = Math.min(real, shore + 0.1 + d * MAX_BANK_SLOPE);
  if (d < SHORE_FLOOR_M) y = Math.max(y, shore + 0.08);
  const coarseOk = Number.isFinite(coarseY) && coarseY > SURFACE_Y - 4;
  if (coarseOk && outerD > blendStart) {
    const t = THREE.MathUtils.smoothstep(d, blendStart, outerD);
    y = THREE.MathUtils.lerp(y, coarseY, t);
    y = Math.max(y, coarseY + 0.05);
  }
  return y;
}

/** Exact height / colour of the rendered PlaneGeometry terrain (its own triangulation). */
function makeGridSampler(mesh) {
  const geo = mesh.geometry;
  const p = geo.parameters;
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  const nx = p.widthSegments + 1;
  const nz = p.heightSegments + 1;
  const x0 = pos.getX(0);
  const z0 = pos.getZ(0);
  const dx = (pos.getX(nx - 1) - x0) / (nx - 1);
  const dz = (pos.getZ(nx * (nz - 1)) - z0) / (nz - 1);
  const locate = (x, z) => {
    const fx = (x - x0) / dx;
    const fz = (z - z0) / dz;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= nx - 1 || iz >= nz - 1) return null;
    const u = fx - ix;
    const v = fz - iz;
    const a = iz * nx + ix; // (ix, iz)
    const b = a + nx; // (ix, iz+1)
    const c = b + 1; // (ix+1, iz+1)
    const d = a + 1; // (ix+1, iz)
    // PlaneGeometry faces: (a, b, d) and (b, c, d)
    return u + v <= 1
      ? [[a, 1 - u - v], [d, u], [b, v]]
      : [[c, u + v - 1], [b, 1 - u], [d, 1 - v]];
  };
  return {
    y(x, z) {
      const w = locate(x, z);
      if (!w) return null;
      return w.reduce((s, [i, k]) => s + pos.getY(i) * k, 0);
    },
    color(x, z, out) {
      const w = locate(x, z);
      if (!w || !col) return null;
      out.setRGB(0, 0, 0);
      for (const [i, k] of w) {
        out.r += col.getX(i) * k;
        out.g += col.getY(i) * k;
        out.b += col.getZ(i) * k;
      }
      return out;
    },
  };
}

/**
 * Exact signed distance to the water ribbon outline (left edge, right edge, two end caps), built
 * from the ribbon's own edge vertices: 0 on the drawn water edge, < 0 inside. Each segment knows
 * which side is water, so the sign never flips at bends.
 */
function makeOutlineDistance(bath, stations, cell = 40) {
  const cols = (bath.across || 40) + 1;
  const rows = Math.floor(bath.positions.length / 3 / cols);
  const P = bath.positions;
  const pt = (r, c) => [P[(r * cols + c) * 3], P[(r * cols + c) * 3 + 2]];
  const segs = []; // [ax, az, bx, bz, inX, inZ]
  const push = (a, b, inX, inZ) => segs.push([a[0], a[1], b[0], b[1], inX, inZ]);
  for (let r = 0; r < rows - 1; r++) {
    const st = stations[Math.min(r, stations.length - 1)];
    const px = -st.flowZ;
    const pz = st.flowX;
    push(pt(r, 0), pt(r + 1, 0), px, pz); // left edge: water toward +perp
    push(pt(r, cols - 1), pt(r + 1, cols - 1), -px, -pz); // right edge: water toward −perp
  }
  const s0 = stations[0];
  const s1 = stations[Math.min(rows - 1, stations.length - 1)];
  push(pt(0, 0), pt(0, cols - 1), s0.flowX, s0.flowZ); // upstream cap
  push(pt(rows - 1, 0), pt(rows - 1, cols - 1), -s1.flowX, -s1.flowZ); // downstream cap
  const bins = new Map();
  segs.forEach((s, i) => {
    const x0 = Math.floor(Math.min(s[0], s[2]) / cell);
    const x1 = Math.floor(Math.max(s[0], s[2]) / cell);
    const z0 = Math.floor(Math.min(s[1], s[3]) / cell);
    const z1 = Math.floor(Math.max(s[1], s[3]) / cell);
    for (let a = x0; a <= x1; a++) {
      for (let b = z0; b <= z1; b++) {
        const k = `${a},${b}`;
        if (!bins.has(k)) bins.set(k, []);
        bins.get(k).push(i);
      }
    }
  });
  const stamp = new Uint32Array(segs.length);
  let stampCounter = 0;
  /** Signed distance, or null if no outline within maxR. */
  return (x, z, maxR) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    const R = Math.ceil(maxR / cell);
    let best = Infinity;
    let sign = 1;
    const stampId = ++stampCounter;
    for (let a = -R; a <= R; a++) {
      for (let b = -R; b <= R; b++) {
        const list = bins.get(`${cx + a},${cz + b}`);
        if (!list) continue;
        for (const i of list) {
          if (stamp[i] === stampId) continue;
          stamp[i] = stampId;
          const [ax, az, bx, bz, inX, inZ] = segs[i];
          const dx = bx - ax;
          const dz = bz - az;
          const L2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
          const qx = ax + dx * t;
          const qz = az + dz * t;
          const d = Math.hypot(x - qx, z - qz);
          if (d < best - 1e-6) {
            best = d;
            sign = (x - qx) * inX + (z - qz) * inZ > 0 ? -1 : 1;
          }
        }
      }
    }
    return Number.isFinite(best) ? best * sign : null;
  };
}

/**
 * Build (or rebuild into `target`) the bank patch for the current ribbon.
 * Call after clipRiverToHydrology + carveTerrainUnderRiver.
 */
export function buildChannelBanks(river, terrainMesh, stations, target = null, landCover = null) {
  if (!terrainMesh?.geometry || !stations?.length || !Number.isFinite(stations[0].wetHalfLeft)) return target;
  const grid = makeGridSampler(terrainMesh);
  const cell = terrainCellDiag(terrainMesh);
  const band = cell + 6; // same band carveTerrainUnderRiver sinks
  const blendStart = band + cell; // beyond this every grid triangle is un-sunk
  const outerD = blendStart + cell * 0.35;
  const locate = makeStationLocator(stations);
  const outline = river?.bathymetry?.positions ? makeOutlineDistance(river.bathymetry, stations) : null;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxW = 0;
  for (const s of stations) {
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    maxW = Math.max(maxW, s.wetHalfLeft, s.wetHalfRight);
  }
  const pad = maxW + outerD + GRID_M;
  const gx0 = Math.floor((minX - pad) / GRID_M) * GRID_M;
  const gz0 = Math.floor((minZ - pad) / GRID_M) * GRID_M;
  const nx = Math.ceil((maxX + pad - gx0) / GRID_M) + 1;
  const nz = Math.ceil((maxZ + pad - gz0) / GRID_M) + 1;

  // Pass 1 — signed distance, only at nodes near the river. Candidates are the nodes within each
  // station's wet half-width + band (the bounding box of the whole river is ~700 k nodes; this is ~10 %).
  const dist = new Float32Array(nx * nz).fill(Infinity);
  const cand = new Uint8Array(nx * nz);
  for (const s of stations) {
    const R = Math.max(s.wetHalfLeft, s.wetHalfRight) + outerD + GRID_M;
    const i0 = Math.max(0, Math.floor((s.x - R - gx0) / GRID_M));
    const i1 = Math.min(nx - 1, Math.ceil((s.x + R - gx0) / GRID_M));
    const j0 = Math.max(0, Math.floor((s.z - R - gz0) / GRID_M));
    const j1 = Math.min(nz - 1, Math.ceil((s.z + R - gz0) / GRID_M));
    for (let j = j0; j <= j1; j++) cand.fill(1, j * nx + i0, j * nx + i1 + 1);
  }
  for (let k = 0; k < cand.length; k++) {
    if (!cand[k]) continue;
    const i = k % nx;
    const x = gx0 + i * GRID_M;
    const z = gz0 + ((k - i) / nx) * GRID_M;
    const st = locate(x, z);
    if (!st) continue;
    const exact = outline?.(x, z, outerD + 12);
    dist[k] = exact ?? ribbonEdgeDistance(x, z, stations, st).d;
  }
  // Whole channel included: toward the middle the side slope drops below the bed (hidden),
  // so there is no visible cut-off edge under the water.
  const active = (k) => dist[k] < outerD;

  // Pass 2 — vertices for active nodes (and nodes of cells touching them).
  const vid = new Int32Array(nx * nz).fill(-1);
  const keep = new Uint8Array(nx * nz);
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      if (active(a) || active(a + 1) || active(a + nx) || active(a + nx + 1)) {
        if ([a, a + 1, a + nx, a + nx + 1].every((k) => Number.isFinite(dist[k]))) {
          keep[a] = 1;
        }
      }
    }
  }
  const xs = [], zs = [], ds = [], reals = [], coarse = [], colors = [];
  const bankCol = new THREE.Color("#8a7a5a");
  const wetCol = new THREE.Color("#5d5240");
  const tmp = new THREE.Color();
  const addVert = (k) => {
    if (vid[k] >= 0) return vid[k];
    const i = k % nx;
    const j = (k - i) / nx;
    const x = gx0 + i * GRID_M;
    const z = gz0 + j * GRID_M;
    let d = dist[k];
    const raw = rawDtmElevationAt(x, z);
    let real = Number.isFinite(raw) ? raw : terrainHeightAt(x, z, stations);
    // Naik Bet sits inside the corridor. Where the land-cover map says land,
    // keep the surveyed ground instead of the underwater slope.
    const ch = Number(locate(x, z)?.chainage_m);
    if (landCover && ch >= 980 && ch <= 1980 && d < 90) {
      const cls = landCover.classAtLocal?.(x, z);
      if (cls && cls !== "water") {
        d = Math.max(d, 18);
        real = Math.max(Number.isFinite(real) ? real : SURFACE_Y, SURFACE_Y + 1.4);
      }
    }
    reals.push(real);
    const g = grid.y(x, z);
    coarse.push(g == null ? NaN : g);
    if (!grid.color(x, z, tmp)) tmp.copy(bankCol);
    if (d < 0) tmp.copy(wetCol);
    else if (d < 4) tmp.lerp(bankCol, 0.35);
    colors.push(tmp.r, tmp.g, tmp.b);
    xs.push(x);
    zs.push(z);
    ds.push(d);
    vid[k] = xs.length - 1;
    return vid[k];
  };
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      if (!keep[a]) continue;
      const v00 = addVert(a);
      const v10 = addVert(a + 1);
      const v01 = addVert(a + nx);
      const v11 = addVert(a + nx + 1);
      // +Y-facing winding for a +x / +z grid.
      idx.push(v00, v01, v10, v10, v01, v11);
    }
  }

  const n = xs.length;
  const pos = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    pos[v * 3] = xs[v];
    pos[v * 3 + 2] = zs[v];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  geo.userData = {
    d: Float32Array.from(ds),
    real: Float32Array.from(reals),
    coarse: Float32Array.from(coarse),
    blendStart,
    outerD,
  };

  let mesh = target;
  if (!mesh) {
    const tm = terrainMesh.material;
    mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: tm?.roughness ?? 0.88,
        metalness: tm?.metalness ?? 0.02,
        // Wins over the terrain grid where the two coincide at the outer join.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
    );
    mesh.name = "channelBanks";
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  } else {
    mesh.geometry.dispose();
    mesh.geometry = geo;
  }
  syncChannelBanks(mesh, river, mesh.userData.waterY ?? SURFACE_Y);
  return mesh;
}

/** Heights for the current water level (normal stage, live stage or flood rise). */
export function syncChannelBanks(mesh, _river, waterY) {
  const geo = mesh?.geometry;
  const u = geo?.userData;
  if (!u?.d) return;
  mesh.userData.waterY = waterY;
  const pos = geo.attributes.position;
  for (let v = 0; v < u.d.length; v++) {
    pos.setY(v, channelBankY(u.d[v], u.real[v], u.coarse[v], waterY, u.blendStart, u.outerD));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}
