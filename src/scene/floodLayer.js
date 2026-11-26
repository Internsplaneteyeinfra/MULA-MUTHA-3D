import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { applyDrapeDepth } from "./drapeDepth.js";
import { createWaterMaterial } from "./waterShader.js";

/**
 * One level-pool flood sheet clipped to the terrain shoreline.
 * Dry cells are omitted. Wet cells share the river's water elevation.
 * The DTM, banks, roads and buildings are never moved.
 * MODELLED — not an engineering-verified flood extent.
 *
 * Marching squares on a fixed grid. Rebuilt only when the water elevation changes.
 */

const CASES = [
  [],
  [["0", "01", "30"]],
  [["1", "12", "01"]],
  [["0", "1", "12"], ["0", "12", "30"]],
  [["2", "23", "12"]],
  [["0", "01", "30"], ["2", "23", "12"]],
  [["01", "1", "2"], ["01", "2", "23"]],
  [["0", "1", "2"], ["0", "2", "23"], ["0", "23", "30"]],
  [["3", "30", "23"]],
  [["0", "01", "23"], ["0", "23", "3"]],
  [["1", "12", "01"], ["3", "30", "23"]],
  [["0", "1", "12"], ["0", "12", "23"], ["0", "23", "3"]],
  [["12", "2", "3"], ["12", "3", "30"]],
  [["0", "01", "12"], ["0", "12", "2"], ["0", "2", "3"]],
  [["01", "1", "2"], ["01", "2", "3"], ["01", "3", "30"]],
  [["0", "1", "2"], ["0", "2", "3"]],
];

export function createFloodLayer(dataset) {
  const stations = dataset.corridor?.stations || [];
  const banks = buildBanks(stations);
  const locate = makeLocator(banks);
  const grid = buildGrid(banks, stations, locate);
  const maxVerts = Math.max(4096, grid.count * 4);
  const maxIdx = Math.max(4096, grid.segsX * grid.segsZ * 15);

  const posArr = new Float32Array(maxVerts * 3);
  const depthArr = new Float32Array(maxVerts);
  const alongArr = new Float32Array(maxVerts);
  const acrossArr = new Float32Array(maxVerts);
  const flowArr = new Float32Array(maxVerts * 2);
  const narrowArr = new Float32Array(maxVerts);
  const edgeArr = new Float32Array(maxVerts);
  const riverArr = new Float32Array(maxVerts);
  const idxArr = new Uint32Array(maxIdx);
  const vid = new Int32Array(grid.count);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute("aDepth", new THREE.BufferAttribute(depthArr, 1));
  geo.setAttribute("aAlong", new THREE.BufferAttribute(alongArr, 1));
  geo.setAttribute("aAcross", new THREE.BufferAttribute(acrossArr, 1));
  geo.setAttribute("aFlow", new THREE.BufferAttribute(flowArr, 2));
  geo.setAttribute("aNarrow", new THREE.BufferAttribute(narrowArr, 1));
  geo.setAttribute("aEdgeDist", new THREE.BufferAttribute(edgeArr, 1));
  geo.setAttribute("aRiverDist", new THREE.BufferAttribute(riverArr, 1));
  geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
  geo.setDrawRange(0, 0);

  const material = createWaterMaterial(dataset);
  material.uniforms.uIsFlood.value = 0;
  material.uniforms.uReveal.value = 1.2;
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 1;
  applyDrapeDepth(material, 2.8);

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "floodInundation";
  mesh.renderOrder = 64;
  mesh.visible = false;
  mesh.frustumCulled = false;

  let lastRise = -1;
  let nvert = 0;
  let nidx = 0;

  function emit(x, z, depth, across, flowX, flowZ, along, edge, riverDist) {
    if (nvert >= maxVerts - 1 || nidx >= maxIdx - 3) return -1;
    const i = nvert++;
    const o = i * 3;
    posArr[o] = x;
    posArr[o + 1] = 0;
    posArr[o + 2] = z;
    depthArr[i] = depth;
    alongArr[i] = along;
    acrossArr[i] = across;
    flowArr[i * 2] = flowX;
    flowArr[i * 2 + 1] = flowZ;
    narrowArr[i] = 0;
    edgeArr[i] = edge;
    riverArr[i] = riverDist;
    return i;
  }

  function corner(i, floodY) {
    if (vid[i] >= 0) return vid[i];
    const depth = Math.max(0.04, floodY - grid.groundY[i]);
    const shore = grid.support[i] < 4;
    vid[i] = emit(
      grid.gx[i],
      grid.gz[i],
      depth,
      shore ? 0.9 : 0.5,
      grid.fx[i],
      grid.fz[i],
      grid.along[i],
      shore ? 0.2 : depth,
      Math.max(0, grid.spread[i]),
    );
    return vid[i];
  }

  function shorePoint(ia, ib, floodY) {
    const ga = grid.groundY[ia];
    const gb = grid.groundY[ib];
    let t = (floodY - ga) / (gb - ga);
    if (!(t >= 0 && t <= 1)) t = 0.5;
    const flowX = grid.fx[ia] + (grid.fx[ib] - grid.fx[ia]) * t;
    const flowZ = grid.fz[ia] + (grid.fz[ib] - grid.fz[ia]) * t;
    const along = grid.along[ia] + (grid.along[ib] - grid.along[ia]) * t;
    return emit(
      grid.gx[ia] + (grid.gx[ib] - grid.gx[ia]) * t,
      grid.gz[ia] + (grid.gz[ib] - grid.gz[ia]) * t,
      0.05,
      0.98,
      flowX,
      flowZ,
      along,
      0.04,
      0,
    );
  }

  function setFloodRise(riseM) {
    const rise = Math.max(0, Number(riseM) || 0);
    if (Math.abs(rise - lastRise) < 0.012) return;
    lastRise = rise;
    nvert = 0;
    nidx = 0;
    vid.fill(-1);

    const floodY = SURFACE_Y + rise;
    mesh.position.y = floodY;
    const wet = grid.wet;
    wet.fill(0);

    if (rise >= 0.02 && banks.length) {
      const q = grid.queue;
      let qt = 0;
      const nx = grid.nx;
      const nz = grid.nz;
      for (let i = 0; i < grid.count; i++) {
        if (grid.groundY[i] >= floodY - 0.015) continue;
        if (grid.spread[i] > 28) continue;
        wet[i] = 1;
        q[qt++] = i;
      }
      let qh = 0;
      while (qh < qt) {
        const i = q[qh++];
        const ix = i % nx;
        const iz = (i / nx) | 0;
        if (ix > 0) grow(i - 1);
        if (ix + 1 < nx) grow(i + 1);
        if (iz > 0) grow(i - nx);
        if (iz + 1 < nz) grow(i + nx);
      }
      function grow(j) {
        if (wet[j] || grid.groundY[j] >= floodY - 0.015) return;
        wet[j] = 1;
        q[qt++] = j;
      }

      const support = grid.support;
      support.fill(0);
      for (let i = 0; i < grid.count; i++) {
        if (!wet[i]) continue;
        const ix = i % nx;
        const iz = (i / nx) | 0;
        if (ix > 0 && wet[i - 1]) support[i]++;
        if (ix + 1 < nx && wet[i + 1]) support[i]++;
        if (iz > 0 && wet[i - nx]) support[i]++;
        if (iz + 1 < nz && wet[i + nx]) support[i]++;
      }

      const cache = [0, 0, 0, 0, 0, 0, 0, 0];
      const idOf = (key, ids) => {
        if (key === "0") return ids[0];
        if (key === "1") return ids[1];
        if (key === "2") return ids[2];
        if (key === "3") return ids[3];
        if (key === "01") return cache[0];
        if (key === "12") return cache[1];
        if (key === "23") return cache[2];
        return cache[3];
      };

      for (let iz = 0; iz < grid.segsZ; iz++) {
        for (let ix = 0; ix < grid.segsX; ix++) {
          const i0 = iz * nx + ix;
          const i1 = i0 + 1;
          const i2 = i0 + nx + 1;
          const i3 = i0 + nx;
          const w0 = wet[i0];
          const w1 = wet[i1];
          const w2 = wet[i2];
          const w3 = wet[i3];
          const mask = w0 | (w1 << 1) | (w2 << 2) | (w3 << 3);
          if (!mask) continue;
          const corners = [i0, i1, i2, i3];
          const flags = [w0, w1, w2, w3];
          let anyOuter = false;
          let allInner = true;
          for (let k = 0; k < 4; k++) {
            if (!flags[k]) {
              allInner = false;
              continue;
            }
            if (grid.spread[corners[k]] > -16) anyOuter = true;
            if (grid.spread[corners[k]] > -16) allInner = false;
          }
          if (allInner || !anyOuter) continue;
          const tris = CASES[mask];
          const ids = [
            w0 ? corner(i0, floodY) : -1,
            w1 ? corner(i1, floodY) : -1,
            w2 ? corner(i2, floodY) : -1,
            w3 ? corner(i3, floodY) : -1,
          ];
          cache[0] = trisNeed(tris, "01") ? shorePoint(i0, i1, floodY) : -1;
          cache[1] = trisNeed(tris, "12") ? shorePoint(i1, i2, floodY) : -1;
          cache[2] = trisNeed(tris, "23") ? shorePoint(i2, i3, floodY) : -1;
          cache[3] = trisNeed(tris, "30") ? shorePoint(i3, i0, floodY) : -1;
          for (let t = 0; t < tris.length; t++) {
            const a = idOf(tris[t][0], ids);
            const b = idOf(tris[t][1], ids);
            const c = idOf(tris[t][2], ids);
            if (a < 0 || b < 0 || c < 0) continue;
            idxArr[nidx++] = a;
            idxArr[nidx++] = b;
            idxArr[nidx++] = c;
          }
        }
      }
    }

    geo.setDrawRange(0, nidx);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aDepth.needsUpdate = true;
    geo.attributes.aAlong.needsUpdate = true;
    geo.attributes.aAcross.needsUpdate = true;
    geo.attributes.aFlow.needsUpdate = true;
    geo.attributes.aEdgeDist.needsUpdate = true;
    geo.attributes.aRiverDist.needsUpdate = true;
    geo.getIndex().needsUpdate = true;
    mesh.visible = nidx > 0;

    let leftM = 0;
    let rightM = 0;
    let maxM = 0;
    let area = 0;
    let volume = 0;
    let chMin = Infinity;
    let chMax = -Infinity;
    const cellA = grid.cellX * grid.cellZ;
    for (let i = 0; i < grid.count; i++) {
      if (!wet[i] || grid.spread[i] <= 0.5) continue;
      const sp = grid.spread[i];
      area += cellA;
      volume += Math.max(0, floodY - grid.groundY[i]) * cellA;
      if (grid.side[i] < 0) leftM = Math.max(leftM, sp);
      else rightM = Math.max(rightM, sp);
      maxM = Math.max(maxM, sp);
      const ch = grid.chain[i];
      if (Number.isFinite(ch)) {
        chMin = Math.min(chMin, ch);
        chMax = Math.max(chMax, ch);
      }
    }

    mesh.userData.floodStats = nidx
      ? {
          classLabel: "MODELLED",
          areaM2: area,
          areaKm2: area / 1e6,
          volumeM3: volume,
          leftM,
          rightM,
          maxM,
          affectedKm: Number.isFinite(chMin) && chMax > chMin ? (chMax - chMin) / 1000 : null,
          riseM: rise,
          note: "Continuous level-pool sheet. Spread is horizontal distance beyond the mapped water edge. Not engineering-verified.",
        }
      : null;
  }

  function setUnderwater() {}

  function clearFlood() {
    lastRise = -1;
    setFloodRise(0);
  }

  mesh.userData.setFloodRise = setFloodRise;
  mesh.userData.setUnderwater = setUnderwater;
  mesh.userData.clearFlood = clearFlood;
  mesh.userData.groundY = grid.groundY;
  mesh.setFloodRise = setFloodRise;
  return mesh;
}

function trisNeed(tris, key) {
  for (let t = 0; t < tris.length; t++) {
    const tri = tris[t];
    if (tri[0] === key || tri[1] === key || tri[2] === key) return true;
  }
  return false;
}

function buildGrid(banks, stations, locate) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of banks) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }
  if (!banks.length) {
    minX = -100;
    maxX = 100;
    minZ = -100;
    maxZ = 100;
  }
  const pad = 1500;
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;
  const width = Math.max(40, maxX - minX);
  const depth = Math.max(40, maxZ - minZ);
  let segsX = Math.max(32, Math.round(width / 18));
  let segsZ = Math.max(32, Math.round(depth / 18));
  const cap = 120000;
  if ((segsX + 1) * (segsZ + 1) > cap) {
    const s = Math.sqrt(cap / ((segsX + 1) * (segsZ + 1)));
    segsX = Math.max(32, Math.floor(segsX * s));
    segsZ = Math.max(32, Math.floor(segsZ * s));
  }
  const nx = segsX + 1;
  const nz = segsZ + 1;
  const count = nx * nz;
  const cellX = width / segsX;
  const cellZ = depth / segsZ;
  const gx = new Float32Array(count);
  const gz = new Float32Array(count);
  const groundY = new Float32Array(count);
  const spread = new Float32Array(count);
  const side = new Int8Array(count);
  const chain = new Float32Array(count);
  const fx = new Float32Array(count);
  const fz = new Float32Array(count);
  const along = new Float32Array(count);
  let maxCh = 1;
  for (const s of banks) maxCh = Math.max(maxCh, s.chainage || 0);

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const x = minX + ix * cellX;
      const z = minZ + iz * cellZ;
      gx[i] = x;
      gz[i] = z;
      const gy = terrainHeightAt(x, z, stations);
      groundY[i] = Number.isFinite(gy) ? gy : SURFACE_Y + 80;
      const bank = locate(x, z);
      if (!bank) {
        spread[i] = 1e6;
        fx[i] = 0;
        fz[i] = 1;
        continue;
      }
      const lat = (x - bank.x) * bank.px + (z - bank.z) * bank.pz;
      const half = lat >= 0 ? bank.halfR : bank.halfL;
      spread[i] = Math.abs(lat) - half;
      side[i] = lat >= 0 ? 1 : -1;
      chain[i] = bank.chainage || 0;
      fx[i] = bank.fx;
      fz[i] = bank.fz;
      along[i] = (bank.chainage || 0) / maxCh;
    }
  }

  return {
    segsX,
    segsZ,
    nx,
    nz,
    count,
    cellX,
    cellZ,
    gx,
    gz,
    groundY,
    spread,
    side,
    chain,
    fx,
    fz,
    along,
    wet: new Uint8Array(count),
    support: new Uint8Array(count),
    queue: new Int32Array(count),
  };
}

function buildBanks(stations) {
  const out = [];
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    if (!Number.isFinite(s?.x) || !Number.isFinite(s?.z)) continue;
    let fx = Number(s.flowX);
    let fz = Number(s.flowZ);
    if (!Number.isFinite(fx) || !Number.isFinite(fz)) {
      const a = stations[Math.max(0, i - 1)];
      const b = stations[Math.min(stations.length - 1, i + 1)];
      fx = (b?.x ?? s.x) - (a?.x ?? s.x);
      fz = (b?.z ?? s.z) - (a?.z ?? s.z);
    }
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    const prev = out[out.length - 1];
    const step = prev ? Math.hypot(s.x - prev.x, s.z - prev.z) : 0;
    const chainage = Number.isFinite(Number(s.chainage_m))
      ? Number(s.chainage_m)
      : prev ? prev.chainage + step : 0;
    const halfL = Number.isFinite(s.wetHalfLeft) ? s.wetHalfLeft : Number(s.halfWidth) || 20;
    const halfR = Number.isFinite(s.wetHalfRight) ? s.wetHalfRight : Number(s.halfWidth) || 20;
    out.push({
      x: s.x,
      z: s.z,
      fx,
      fz,
      px: -fz,
      pz: fx,
      halfL,
      halfR,
      chainage,
    });
  }
  return out;
}

function makeLocator(banks) {
  const cell = 70;
  const bins = new Map();
  banks.forEach((s, i) => {
    const k = `${Math.floor(s.x / cell)},${Math.floor(s.z / cell)}`;
    const list = bins.get(k);
    if (list) list.push(i);
    else bins.set(k, [i]);
  });
  return (x, z) => {
    if (!banks.length) return null;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    let best = 0;
    let bestD = Infinity;
    for (let ring = 0; ring < 18; ring++) {
      for (let a = -ring; a <= ring; a++) {
        for (let b = -ring; b <= ring; b++) {
          if (ring > 0 && Math.max(Math.abs(a), Math.abs(b)) !== ring) continue;
          const list = bins.get(`${cx + a},${cz + b}`);
          if (!list) continue;
          for (const i of list) {
            const s = banks[i];
            const d = (s.x - x) ** 2 + (s.z - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      if (bestD <= ring * ring * cell * cell) break;
    }
    if (bestD > 1600 * 1600) {
      const stride = Math.max(1, Math.floor(banks.length / 80));
      for (let i = 0; i < banks.length; i += stride) {
        const s = banks[i];
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const a = Math.max(0, best - stride);
      const b = Math.min(banks.length - 1, best + stride);
      for (let i = a; i <= b; i++) {
        const s = banks[i];
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return banks[best];
  };
}
