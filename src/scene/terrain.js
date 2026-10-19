import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { computeSceneBounds } from "../geo/sceneBounds.js";
import { loadLulcClassGrid } from "../geo/lulcRaster.js";
import { loadOsmWater, isObservedWater } from "../geo/osmWater.js";
import { localToLonLat } from "../geo/geoReference.js";
import { spatialIndex, neighbors } from "../geo/corridor.js";
import { wseSpatialService } from "../services/hydrology/wseSpatialService.js";

let activeDtm = null;
let activeDataset = null;
let activeLulc = null;
let activeOsmWater = null;
let activePointsIndex = null;

/**
 * FABDEM DTM terrain when available; procedural fallback otherwise.
 * Covers full KML + OSM union with geographic padding.
 */
export async function createTerrain(dataset) {
  activeDtm = dataset.dtm || null;
  activeDataset = dataset;
  activePointsIndex = spatialIndex(dataset.points || []);
  activeLulc = await loadLulcClassGrid();
  try {
    activeOsmWater = await loadOsmWater();
  } catch (e) {
    console.warn("[terrain] OSM water unavailable", e);
    activeOsmWater = null;
  }
  const b = computeSceneBounds(dataset);
  const width = b.spanX;
  const depth = b.spanZ;
  const lite = dataset.lite === true;
  const segsX = activeDtm ? (lite ? 200 : 260) : (lite ? 140 : 200);
  const segsZ = activeDtm ? (lite ? 100 : 130) : (lite ? 70 : 100);
  const geo = new THREE.PlaneGeometry(width, depth, segsX, segsZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(b.cx, 0, b.cz);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const stations = dataset.corridor.stations;
  const heights = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z, stations, activeDtm);
    pos.setY(i, y);
    heights[i] = y;
  }

  const nx = segsX + 1;
  const nz = segsZ + 1;
  antialiasShoreline(pos, heights, nx, nz);
  for (let pass = 0; pass < 2; pass++) {
    const next = heights.slice();
    for (let iz = 1; iz < nz - 1; iz++) {
      for (let ix = 1; ix < nx - 1; ix++) {
        const i = iz * nx + ix;
        const y = heights[i];
        const n0 = heights[i - 1];
        const n1 = heights[i + 1];
        const n2 = heights[i - nx];
        const n3 = heights[i + nx];
        if (y > SURFACE_Y + 0.4 && n0 > SURFACE_Y && n1 > SURFACE_Y && n2 > SURFACE_Y && n3 > SURFACE_Y) continue;
        const avg = (y + n0 + n1 + n2 + n3) * 0.2;
        next[i] = y * 0.32 + avg * 0.68;
      }
    }
    heights.set(next);
  }
  for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i]);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    minY = Math.min(minY, heights[i]);
    maxY = Math.max(maxY, heights[i]);
  }
  if (activeDtm) {
    minY = Math.min(minY, activeDtm.minSceneY ?? minY);
    maxY = Math.max(maxY, activeDtm.maxSceneY ?? maxY);
  }
  const ySpan = Math.max(8, maxY - minY);

  const cLow = new THREE.Color("#4a6e48");
  const cGrass = new THREE.Color("#6a8664");
  const cOlive = new THREE.Color("#8a9a62");
  const cEarth = new THREE.Color("#9a7a52");
  const cStone = new THREE.Color("#b8a888");
  const cBank = new THREE.Color("#847252");
  const cWet = new THREE.Color("#5f7a66");
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const y = heights[i];
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const near = nearest(x, z, stations);
    const lat = near.lat;
    const half = near.st.halfWidth;

    if (y < SURFACE_Y - 0.05) {
      const wet = THREE.MathUtils.clamp((SURFACE_Y - y) / 4, 0, 1);
      tmp.copy(cGrass).lerp(cBank, 0.28 + wet * 0.2);
      tmp.lerp(cWet, wet * 0.22);
    } else if (activeDtm) {
      const hn = THREE.MathUtils.clamp((y - minY) / ySpan, 0, 1);
      tmp.copy(cLow).lerp(cGrass, smooth(hn, 0.05, 0.32));
      tmp.lerp(cOlive, smooth(hn, 0.28, 0.58));
      tmp.lerp(cEarth, smooth(hn, 0.5, 0.78));
      tmp.lerp(cStone, smooth(hn, 0.72, 1));
      if (lat < half * 1.8) tmp.lerp(cBank, (1 - lat / (half * 1.8)) * 0.28);
      if (lat < half * 0.9) tmp.lerp(cWet, 0.18 * (1 - lat / (half * 0.9)));
    } else {
      const hn = THREE.MathUtils.clamp((y - (SURFACE_Y - 2)) / 28, 0, 1);
      const slopeHint = fbm(x * 0.0025, z * 0.0025);
      tmp.copy(cWet).lerp(cGrass, smooth(hn, 0.04, 0.28));
      tmp.lerp(cOlive, smooth(hn, 0.26, 0.55));
      tmp.lerp(cEarth, smooth(hn, 0.48, 0.78));
      tmp.lerp(cStone, smooth(hn, 0.7, 1) * (0.25 + slopeHint * 0.3));
      if (lat < half * 2.2) tmp.lerp(cBank, (1 - lat / (half * 2.2)) * 0.38);
    }

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: activeDtm ? 0.88 : 0.92,
      metalness: 0.02,
      flatShading: false,
    }),
  );
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "terrain";

  // Wide surround so overview doesn’t show a cut-out strip on empty sky
  const surround = createGroundSurround(b, heights, minY);

  const outline = kmlOutline(dataset.ringLocal);
  outline.visible = false;
  return { mesh, outline, surround, bounds: b };
}

/** Large soft ground disc matching terrain greens — fills the white void around the AOI.
 *  Critical: must NOT cover the AOI / river (otherwise water + banks disappear).
 */
function createGroundSurround(b, heights, minY) {
  const avgY =
    heights?.length > 0
      ? heights.reduce((s, v) => s + v, 0) / heights.length
      : Number.isFinite(minY)
        ? minY
        : SURFACE_Y;
  const span = Math.max(b.spanX, b.spanZ);
  const size = Math.max(18000, span * 4.5);
  const geo = new THREE.PlaneGeometry(size, size, 64, 64);
  geo.rotateX(-Math.PI / 2);
  geo.translate(b.cx, 0, b.cz);

  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const cDeep = new THREE.Color("#4a6e48");
  const cMid = new THREE.Color("#6a8664");
  const cLite = new THREE.Color("#7a8a58");
  const cEarth = new THREE.Color("#8a7a52");
  const tmp = new THREE.Color();
  // Keep a clear hole over the detailed terrain + river corridor
  const holeX = Math.max(80, b.spanX * 0.52);
  const holeZ = Math.max(80, b.spanZ * 0.52);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const dx = x - b.cx;
    const dz = z - b.cz;
    const nx = Math.abs(dx) / holeX;
    const nz = Math.abs(dz) / holeZ;
    // Chebyshev-ish distance from AOI rectangle (0 inside → 1+ outside)
    const inside = Math.max(nx, nz);
    const r = Math.hypot(dx / (b.spanX * 0.5 || 1), dz / (b.spanZ * 0.5 || 1));
    const hills = fbm(x * 0.00035, z * 0.00035) * 14 + fbm(x * 0.0011 + 3, z * 0.0011) * 6;

    if (inside < 1.02) {
      // Bury under river/terrain so water surface + banks stay visible
      pos.setY(i, Math.min(avgY, SURFACE_Y) - 120);
    } else {
      const edge = THREE.MathUtils.smoothstep(inside, 1.02, 1.35);
      const y = avgY - 2.5 + hills * edge * 0.9;
      pos.setY(i, y);
    }

    const hn = THREE.MathUtils.clamp(0.35 + hills * 0.02 + Math.max(0, inside - 1) * 0.2, 0, 1);
    tmp.copy(cDeep).lerp(cMid, smooth(hn, 0.1, 0.45));
    tmp.lerp(cLite, smooth(hn, 0.35, 0.7));
    tmp.lerp(cEarth, smooth(hn, 0.6, 1) * 0.35);
    tmp.lerp(new THREE.Color("#6a7e5c"), THREE.MathUtils.smoothstep(r, 1.6, 2.8) * 0.55);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.01,
      flatShading: false,
    }),
  );
  mesh.name = "groundSurround";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = -5;
  return mesh;
}

function heightAt(x, z, stations, dtm = activeDtm) {
  const dtmY = dtm?.sampleSceneXY?.(x, z) ?? null;
  const observed = isObservedWater(activeLulc, activeOsmWater, x, z);

  // Fast-path: 90%+ of vertices are dry land covered directly by FABDEM DTM
  if (dtmY != null && !observed) {
    const cls = activeLulc?.classAtLocal?.(x, z);
    const isIslandLand = (cls === "forest" || cls === "barren" || cls === "crop");
    return isIslandLand ? Math.max(dtmY, SURFACE_Y + 0.8) : dtmY;
  }

  const nearStation = nearest(x, z, stations);
  const lat = nearStation.lat;
  const ch = nearStation.st.chainage_m;
  const half = Math.max(12, nearStation.st.halfWidth);

  let bedY = null;
  let targetWaterY = SURFACE_Y - 0.5;

  if (observed) {
    const depthInfo = wseSpatialService.getDepthAt(ch, lat);
    if (depthInfo.wetted && depthInfo.depthM > 0) {
      bedY = SURFACE_Y - depthInfo.depthM;
    } else if (dtmY != null) {
      bedY = Math.min(dtmY, SURFACE_Y - 0.45);
    } else {
      bedY = SURFACE_Y - 0.8;
    }
    return bedY != null ? bedY : targetWaterY;
  }

  // Procedural fallback only if DTM has void/null at this coordinate
  const hills =
    fbm(x * 0.00045, z * 0.00045) * 18 +
    fbm(x * 0.0012 + 4, z * 0.0012) * 8 +
    fbm(x * 0.003 + 9, z * 0.003) * 3;
  const bankFalloff = THREE.MathUtils.smoothstep(lat / (half * 3.5), 0.35, 1);
  const proceduralBase = SURFACE_Y + 2 + hills * bankFalloff;

  const cls = activeLulc?.classAtLocal?.(x, z);
  const isIslandLand = (cls === "forest" || cls === "barren" || cls === "crop");
  return isIslandLand ? Math.max(proceduralBase, SURFACE_Y + 1.2) : proceduralBase;
}

/**
 * Water share of a disc of radius r around (x, z): a blurred land-cover water mask (0..1).
 * r ≈ one terrain cell (~27 m), so the 50 % line moves smoothly inside cells.
 */
function waterFraction(x, z, r = 30, S = 9) {
  let hits = 0;
  let total = 0;
  for (let a = 0; a < S; a++) {
    for (let b = 0; b < S; b++) {
      const u = (a + 0.5) / S * 2 - 1;
      const v = (b + 0.5) / S * 2 - 1;
      if (u * u + v * v > 1) continue;
      total++;
      if (isObservedWater(activeLulc, activeOsmWater, x + u * r, z + v * r)) hits++;
    }
  }
  return total ? hits / total : 0;
}

/**
 * Smooth shoreline: water/land is a per-vertex yes/no from the land-cover raster, whose cells
 * (~30 m) make the waterline a staircase. Near water/land boundaries, set the ground height from
 * a blurred water fraction of the mask instead (±1 m about the water plane, crossing at 50 %):
 * the waterline follows a rounded version of the raster outline. Interior water / land unchanged.
 */
function antialiasShoreline(pos, heights, nx, nz) {
  if (!activeLulc && !activeOsmWater) return;
  const n = nx * nz;
  const water = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    water[i] = isObservedWater(activeLulc, activeOsmWater, pos.getX(i), pos.getZ(i)) ? 1 : 0;
  }
  const R = 3; // grid steps checked for a nearby boundary (the blur reaches ~30 m)
  for (let iz = R; iz < nz - R; iz++) {
    for (let ix = R; ix < nx - R; ix++) {
      const i = iz * nx + ix;
      const w = water[i];
      let edge = false;
      for (let dz = -R; dz <= R && !edge; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          if (water[i + dz * nx + dx] !== w) { edge = true; break; }
        }
      }
      if (!edge) continue;
      const f = waterFraction(pos.getX(i), pos.getZ(i));
      const shoreY = SURFACE_Y + (0.5 - f) * 2;
      // Water side: no higher than the shoreline (deeper bed stays). Land side: no lower than the
      // shoreline (real high banks stay).
      heights[i] = f >= 0.5 ? Math.min(heights[i], shoreY) : Math.max(heights[i], shoreY);
    }
  }
}

/**
 * Signed distance (m) from (x, z) to the wet ribbon outline: < 0 inside the water, > 0 on land.
 * Beyond the first / last station the distance runs to the river's end (closed ends).
 */
export function ribbonEdgeDistance(x, z, stations, st = nearest(x, z, stations).st) {
  const side = (x - st.x) * -st.flowZ + (z - st.z) * st.flowX;
  const along = (x - st.x) * st.flowX + (z - st.z) * st.flowZ;
  const half = side >= 0 ? st.wetHalfRight : st.wetHalfLeft;
  const lateral = Math.abs(side) - half;
  const beyond =
    (st === stations[0] && along < 0) || (st === stations[stations.length - 1] && along > 0)
      ? Math.abs(along)
      : 0;
  const d = beyond > 0 ? (lateral > 0 ? Math.hypot(lateral, beyond) : beyond) : lateral;
  return { d, along, st };
}

/** Nearest-station lookup with a spatial hash; null when no station lies within ~6 cells (far from the river). */
export function makeStationLocator(stations, cell = 120) {
  const bins = new Map();
  stations.forEach((s, i) => {
    const k = `${Math.floor(s.x / cell)},${Math.floor(s.z / cell)}`;
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(i);
  });
  return (x, z) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let r = 1; r <= 6; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          const list = bins.get(`${cx + i},${cz + j}`);
          if (!list) continue;
          for (const k of list) {
            const s = stations[k];
            const d = (s.x - x) ** 2 + (s.z - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = k;
            }
          }
        }
      }
      // Accept once the search ring is wider than the nearest distance found.
      if (best >= 0 && Math.sqrt(bestD) <= r * cell) return stations[best];
    }
    // Nothing within ~720 m: far from the river (callers treat null as "not near the water").
    return null;
  };
}

/** Cell diagonal (m) of the rendered terrain grid. */
export function terrainCellDiag(mesh) {
  const p = mesh?.geometry?.parameters;
  if (!p?.widthSegments) return 40;
  return Math.hypot(p.width / p.widthSegments, p.height / p.heightSegments);
}

/**
 * Sink the coarse terrain grid out of the way of the river so the channel banks can be drawn by
 * the dense bank strip (channelBanks.js).
 *
 * The grid cells (~77 m × 31 m) are far coarser than the channel. Lowering only the vertices
 * inside the water left grid triangles straddling the shore: they poked up through the water
 * (up to 13 m) or showed as long brown slopes under it. Here every vertex within one cell
 * diagonal (+ margin) of the water is sunk well below the deepest possible bed, so no grid
 * triangle touches the water; the bank strip covers that band with full-resolution heights.
 *
 * Idempotent: original heights / colours are restored first, so re-fitting the ribbon (JalNetra
 * mask) never leaves stale holes from an earlier, wider ribbon.
 */
export function carveTerrainUnderRiver(mesh, stations, { deepY = SURFACE_Y - 30, extraBandM = 6 } = {}) {
  if (!mesh?.geometry || !stations?.length || !Number.isFinite(stations[0].wetHalfLeft)) return 0;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  if (!geo.userData.baseY) {
    geo.userData.baseY = Float32Array.from({ length: pos.count }, (_, i) => pos.getY(i));
  }
  const baseY = geo.userData.baseY;
  const band = terrainCellDiag(mesh) + extraBandM;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxW = 0;
  for (const s of stations) {
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    maxW = Math.max(maxW, s.wetHalfLeft, s.wetHalfRight);
  }
  const pad = maxW + band;
  const locate = makeStationLocator(stations);
  const sunk = new Uint8Array(pos.count);
  let changed = 0;
  for (let i = 0; i < pos.count; i++) {
    let y = baseY[i];
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (x >= minX - pad && x <= maxX + pad && z >= minZ - pad && z <= maxZ + pad) {
      const near = locate(x, z);
      const { d } = near ? ribbonEdgeDistance(x, z, stations, near) : { d: Infinity };
      if (d < band) {
        y = deepY;
        sunk[i] = 1;
        changed++;
      }
    }
    pos.setY(i, y);
  }
  geo.userData.sunk = sunk;
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return changed;
}

export function terrainHeightAt(x, z, stations) {
  return heightAt(x, z, stations, activeDtm);
}

/**
 * Height of the rendered terrain mesh (coarse grid from createTerrain) at x/z.
 * Differs from terrainHeightAt near narrow channels, where grid cells span both banks.
 */
export function renderedTerrainHeightAt(mesh, x, z) {
  const geo = mesh?.geometry;
  const p = geo?.parameters;
  const pos = geo?.attributes?.position;
  if (!p?.widthSegments || !pos) return null;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const nx = p.widthSegments;
  const nz = p.heightSegments;
  const fx = ((x - min.x) / Math.max(1e-6, max.x - min.x)) * nx;
  const fz = ((z - min.z) / Math.max(1e-6, max.z - min.z)) * nz;
  if (fx < 0 || fz < 0 || fx > nx || fz > nz) return null;
  const ix = Math.min(nx - 1, Math.floor(fx));
  const iz = Math.min(nz - 1, Math.floor(fz));
  const tx = fx - ix;
  const tz = fz - iz;
  const at = (i, j) => pos.getY(j * (nx + 1) + i);
  const a = at(ix, iz);
  const b = at(ix + 1, iz);
  const c = at(ix, iz + 1);
  const d = at(ix + 1, iz + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** Raw FABDEM scene elevation — no channel carve (for profile / analysis charts). */
export function rawDtmElevationAt(x, z) {
  const y = activeDtm?.sampleSceneXY?.(x, z);
  return Number.isFinite(y) ? y : null;
}

/** FABDEM elevation in metres (EGM2008 ≈ MSL) at a WGS84 point. */
export function dtmElevationAtLonLat(lon, lat) {
  const e = activeDtm?.sampleLonLat?.(lon, lat);
  return Number.isFinite(e) ? e : null;
}

function nearest(x, z, stations) {
  let bestI = 0;
  let bestD = Infinity;
  const len = stations.length;
  const step = Math.max(1, Math.floor(len / 40));
  for (let i = 0; i < len; i += step) {
    const s = stations[i];
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  // Refine locally in a window around best candidate (±step)
  const start = Math.max(0, bestI - step);
  const end = Math.min(len - 1, bestI + step);
  for (let i = start; i <= end; i++) {
    const s = stations[i];
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const st = stations[bestI];
  const dx = x - st.x;
  const dz = z - st.z;
  const lat = Math.abs(dx * -st.flowZ + dz * st.flowX);
  return { st, lat };
}

function kmlOutline(ringLocal) {
  const pts = ringLocal.map((c) => new THREE.Vector3(c.x, SURFACE_Y + 0.15, c.z));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color: 0x4a90c8, transparent: true, opacity: 0.55 }),
  );
  line.name = "kmlOutline";
  return line;
}

function smooth(t, a, b) {
  const k = THREE.MathUtils.clamp((t - a) / Math.max(0.001, b - a), 0, 1);
  return k * k * (3 - 2 * k);
}

function fbm(x, z) {
  let v = 0;
  let a = 0.5;
  let fx = x;
  let fz = z;
  for (let i = 0; i < 4; i++) {
    v += a * noise(fx, fz);
    fx *= 2;
    fz *= 2;
    a *= 0.5;
  }
  return v;
}

function noise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, ux),
    THREE.MathUtils.lerp(c, d, ux),
    uz,
  );
}

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
