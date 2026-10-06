import * as THREE from "three";
import { SURFACE_Y } from "./river.js";

const FILL_Y = SURFACE_Y - 0.02;
const HASH_CELL_M = 20;

/**
 * Water over terrain cells that sit below the water surface but are not under the
 * bathymetry river mesh: LULC-clipped channel gaps and the DTM channel beyond the
 * surveyed reach. Only cells hydraulically connected (through below-surface terrain)
 * to the river are filled, so isolated pits stay dry. The terrain itself is the bed.
 */
export function createWaterFill(terrainMesh, river, dataset) {
  const tGeo = terrainMesh?.geometry;
  const params = tGeo?.parameters;
  const wGeo = river?.mesh?.geometry;
  if (!params?.widthSegments || !wGeo?.index) return null;

  const cols = params.widthSegments + 1;
  const rows = params.heightSegments + 1;
  const tp = tGeo.attributes.position.array;
  const n = cols * rows;

  const covered = waterCoverage(wGeo, tp, n);

  const below = new Uint8Array(n);
  for (let i = 0; i < n; i++) below[i] = tp[i * 3 + 1] < FILL_Y ? 1 : 0;

  // Flood from river-covered cells through connected below-surface terrain.
  const reached = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (covered[i]) {
      reached[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const c = i % cols;
    const r = (i - c) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= rows) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        if ((dr === 0 && dc === 0) || cc < 0 || cc >= cols) continue;
        const j = rr * cols + cc;
        if (reached[j] || !below[j]) continue;
        reached[j] = 1;
        queue[tail++] = j;
      }
    }
  }

  const fill = new Uint8Array(n);
  let fillCount = 0;
  for (let i = 0; i < n; i++) {
    if (reached[i] && below[i] && !covered[i]) {
      fill[i] = 1;
      fillCount++;
    }
  }
  if (!fillCount) {
    console.info("[water-fill] no uncovered below-surface terrain");
    return null;
  }

  // Shade fill water like typical surveyed river water; DTM relief is not measured depth.
  const shadeDepth = medianDepth(river.bathymetry?.depths);
  const stations = dataset.corridor.stations;
  const totalCh = stations[stations.length - 1]?.chainage_m || 1;
  const vertMap = new Int32Array(n).fill(-1);
  const pos = [];
  const aDepth = [];
  const aAlong = [];
  const aAcross = [];
  const aFlow = [];
  const aNarrow = [];
  const indices = [];

  const vertex = (i) => {
    if (vertMap[i] >= 0) return vertMap[i];
    const x = tp[i * 3];
    const z = tp[i * 3 + 2];
    const st = nearestStation(stations, x, z);
    vertMap[i] = pos.length / 3;
    pos.push(x, FILL_Y, z);
    aDepth.push(shadeDepth);
    aAlong.push(THREE.MathUtils.clamp(st.chainage_m / totalCh, 0, 1));
    aAcross.push(0.5);
    aFlow.push(st.flowX ?? 1, st.flowZ ?? 0);
    aNarrow.push(0);
    return vertMap[i];
  };

  let quads = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (!(fill[a] || fill[b] || fill[d] || fill[e])) continue;
      const va = vertex(a);
      const vb = vertex(b);
      const vd = vertex(d);
      const ve = vertex(e);
      indices.push(va, vd, vb, vb, vd, ve);
      quads++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aDepth", new THREE.Float32BufferAttribute(aDepth, 1));
  geo.setAttribute("aAlong", new THREE.Float32BufferAttribute(aAlong, 1));
  geo.setAttribute("aAcross", new THREE.Float32BufferAttribute(aAcross, 1));
  geo.setAttribute("aFlow", new THREE.Float32BufferAttribute(aFlow, 2));
  geo.setAttribute("aNarrow", new THREE.Float32BufferAttribute(aNarrow, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, river.material);
  mesh.name = "riverWaterFill";
  mesh.renderOrder = river.mesh.renderOrder;
  console.info("[water-fill] filled below-surface DTM channel", { cells: fillCount, quads });
  return mesh;
}

function waterCoverage(wGeo, tp, n) {
  const wp = wGeo.attributes.position.array;
  const wi = wGeo.index.array;
  const grid = new Map();
  for (let t = 0; t < wi.length; t += 3) {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = wi[t + k];
      minx = Math.min(minx, wp[v * 3]);
      maxx = Math.max(maxx, wp[v * 3]);
      minz = Math.min(minz, wp[v * 3 + 2]);
      maxz = Math.max(maxz, wp[v * 3 + 2]);
    }
    for (let gx = Math.floor(minx / HASH_CELL_M); gx <= Math.floor(maxx / HASH_CELL_M); gx++) {
      for (let gz = Math.floor(minz / HASH_CELL_M); gz <= Math.floor(maxz / HASH_CELL_M); gz++) {
        const key = `${gx},${gz}`;
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(t);
      }
    }
  }
  const inTri = (px, pz, t) => {
    const a = wi[t], b = wi[t + 1], c = wi[t + 2];
    const ax = wp[a * 3], az = wp[a * 3 + 2];
    const bx = wp[b * 3], bz = wp[b * 3 + 2];
    const cx = wp[c * 3], cz = wp[c * 3 + 2];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-9) return false;
    const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
    const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
    return l1 >= -0.02 && l2 >= -0.02 && 1 - l1 - l2 >= -0.02;
  };
  const covered = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = tp[i * 3];
    const z = tp[i * 3 + 2];
    const list = grid.get(`${Math.floor(x / HASH_CELL_M)},${Math.floor(z / HASH_CELL_M)}`);
    if (list && list.some((t) => inTri(x, z, t))) covered[i] = 1;
  }
  return covered;
}

function medianDepth(depths) {
  const vals = Array.from(depths || []).filter((d) => Number.isFinite(d) && d > 0);
  if (!vals.length) return 1.5;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

function nearestStation(stations, x, z) {
  let best = stations[0];
  let bestD = Infinity;
  for (const s of stations) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
