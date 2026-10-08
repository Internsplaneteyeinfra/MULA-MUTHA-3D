import * as THREE from "three";
import { terrainHeightAt } from "../scene/terrain.js";
import { OSM_ROADS_RENDER_ORDER } from "../scene/drapeDepth.js";
import { SURFACE_Y } from "../scene/river.js";

/**
 * Roads are flat on the DTM, below draped KML overlays. Drawing them in the
 * transparent pass after the overlays keeps them visible on top of the
 * overlay while terrain / buildings still occlude them via depth.
 */
const OSM_ROAD_DRAW = { transparent: true, opacity: 1, depthWrite: true };

/** OSM highway → carriageway width (m). */
const WIDTH_BY_CLASS = {
  motorway: 14,
  trunk: 12,
  primary: 10,
  secondary: 8.5,
  tertiary: 7,
  residential: 5.5,
  unclassified: 5,
  living_street: 5,
  service: 3.5,
  track: 3,
  footway: 2,
  path: 1.6,
  cycleway: 2.2,
  pedestrian: 3,
};

/** Google Maps–style dark asphalt (black carriageway). */
const ASPHALT = {
  motorway: "#1a1a1c",
  trunk: "#1c1c1e",
  primary: "#202022",
  secondary: "#242426",
  tertiary: "#262628",
  residential: "#2a2a2c",
  unclassified: "#2c2c2e",
  living_street: "#2e2e30",
  service: "#323234",
  track: "#3a342c",
  footway: "#3c3a36",
  path: "#3a3834",
  cycleway: "#32363a",
  pedestrian: "#3e3c38",
};

const MAJOR = /^(motorway|trunk|primary|secondary)$/;
const MEDIUM = /^(tertiary|residential|unclassified|living_street)$/;
const PATH = /^(footway|path|cycleway|pedestrian|track)$/;

/**
 * Terrain-following OSM roads as continuous mitered ribbons (no box gaps at bends).
 * OSM ways share node coordinates at junctions, so ribbons meet without snapping.
 */
export function createRoadSystem(dataset) {
  const group = new THREE.Group();
  group.name = "roads";
  const stations = dataset.corridor.stations;
  const bridges = dataset.bridgeSpans || dataset.bridges || [];
  const rawRoads = dataset.osm?.roads || [];
  if (!rawRoads.length) return group;

  // OSM ways already share node coordinates at junctions; draw them as-is.
  const roads = rawRoads.map((r) => ({
    ...r,
    vertices: (r.vertices || []).map((v) => ({ ...v })),
  }));

  /** @type {Array<{pts: Array<{x:number,z:number,y:number}>, halfW:number, color:string, major:boolean, medium:boolean, pathLike:boolean, hw:string}>} */
  const ribbons = [];
  let skippedWater = 0;

  for (const road of roads) {
    const hw = road.highway || "residential";
    if (hw === "steps" || hw === "bridleway") continue;
    const w = Math.max(1.6, road.widthM || WIDTH_BY_CLASS[hw] || 5.5);
    const verts = road.vertices || [];
    if (verts.length < 2) continue;

    const pathLike = PATH.test(hw);
    const major = MAJOR.test(hw);
    const medium = MEDIUM.test(hw);
    const color = ASPHALT[hw] || "#2a2a2c";
    const visW = pathLike ? Math.max(1.8, w) : Math.max(5.4, w * 1.12);
    const halfW = visW * 0.5;
    const keepAcross = isOsmBridgeTag(road.bridge) || wayCrossesWater(verts, stations);

    let run = [];
    const flushRun = () => {
      if (run.length >= 2) {
        const dense = densifyRun(run, 10, stations, bridges);
        const parts = keepAcross ? [dense] : splitOnWater(dense, stations, bridges);
        for (const pts of parts) {
          if (pts.length < 2) continue;
          ribbons.push({
            pts,
            halfW,
            color,
            major,
            medium,
            pathLike,
            hw,
          });
        }
      }
      run = [];
    };

    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      if (!keepAcross && roadBlocked(v.x, v.z, stations, bridges)) {
        skippedWater++;
        flushRun();
        continue;
      }
      const pt = {
        x: v.x,
        z: v.z,
        y: keepAcross
          ? crossingHeightAt(v.x, v.z, stations, bridges)
          : roadHeightAt(v.x, v.z, stations, bridges),
      };
      if (!keepAcross && run.length && segmentOverWater(run[run.length - 1], pt, stations, bridges)) {
        skippedWater++;
        flushRun();
      }
      run.push(pt);
    }
    flushRun();
  }

  if (!ribbons.length) return group;

  const asphaltGeo = buildMergedRibbons(ribbons, (r) => r.halfW, 0);
  if (asphaltGeo) {
    const asphaltMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const asphalt = new THREE.Mesh(asphaltGeo, asphaltMat);
    asphalt.name = "roadAsphalt";
    asphalt.receiveShadow = true;
    asphalt.frustumCulled = false;
    asphalt.renderOrder = OSM_ROADS_RENDER_ORDER + 1;
    group.add(asphalt);
  }

  const dashRibbons = collectCenterDashes(ribbons);
  const dashGeo = dashRibbons.length ? buildMergedRibbons(dashRibbons, (r) => r.halfW, 0.07) : null;
  if (dashGeo) {
    const dashMat = new THREE.MeshBasicMaterial({
      color: "#f5f5f5",
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const dashes = new THREE.Mesh(dashGeo, dashMat);
    dashes.name = "roadCenterDashes";
    dashes.frustumCulled = false;
    dashes.renderOrder = OSM_ROADS_RENDER_ORDER + 2;
    group.add(dashes);
  }

  console.info("Roads", { ribbons: ribbons.length, skippedWater, osm: roads.length, dashes: dashRibbons.length });
  return group;
}

/** Insert points along long spans so terrain height follows smoothly. */
function densifyRun(pts, maxStepM, stations, bridges) {
  if (pts.length < 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / maxStepM));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      out.push({
        x,
        z,
        y: roadHeightAt(x, z, stations, bridges),
      });
    }
  }
  if (stations) {
    out[0].y = roadHeightAt(out[0].x, out[0].z, stations, bridges);
  }
  return out;
}

/**
 * Build one BufferGeometry from many ribbons with mitered left/right edges.
 * @param {typeof ribbons} ribbons
 * @param {(r: object) => number} halfFn
 * @param {number} yBias
 */
function buildMergedRibbons(ribbons, halfFn, yBias = 0) {
  const positions = [];
  const colors = [];
  const indices = [];
  const c = new THREE.Color();

  for (const r of ribbons) {
    const pts = r.pts;
    if (!pts || pts.length < 2) continue;
    const halfW = halfFn(r);
    c.set(r.color || "#5c6268");
    const base = positions.length / 3;

    const left = [];
    const right = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let tx;
      let tz;
      if (i === 0) {
        tx = pts[1].x - p.x;
        tz = pts[1].z - p.z;
      } else if (i === pts.length - 1) {
        tx = p.x - pts[i - 1].x;
        tz = p.z - pts[i - 1].z;
      } else {
        const ax = p.x - pts[i - 1].x;
        const az = p.z - pts[i - 1].z;
        const bx = pts[i + 1].x - p.x;
        const bz = pts[i + 1].z - p.z;
        const al = Math.hypot(ax, az) || 1;
        const bl = Math.hypot(bx, bz) || 1;
        tx = ax / al + bx / bl;
        tz = az / al + bz / bl;
      }
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      // Left normal in XZ (perpendicular to tangent)
      let nx = -tz;
      let nz = tx;

      // Miter at interior vertices so bends stay sealed
      if (i > 0 && i < pts.length - 1) {
        const ax = p.x - pts[i - 1].x;
        const az = p.z - pts[i - 1].z;
        const bx = pts[i + 1].x - p.x;
        const bz = pts[i + 1].z - p.z;
        const al = Math.hypot(ax, az) || 1;
        const bl = Math.hypot(bx, bz) || 1;
        const n1x = -az / al;
        const n1z = ax / al;
        const n2x = -bz / bl;
        const n2z = bx / bl;
        let mx = n1x + n2x;
        let mz = n1z + n2z;
        const ml = Math.hypot(mx, mz);
        if (ml > 1e-5) {
          mx /= ml;
          mz /= ml;
          const dot = mx * n1x + mz * n1z;
          const miter = Math.abs(dot) > 0.2 ? 1 / dot : 1;
          const miterClamp = Math.min(Math.abs(miter), 1.45) * Math.sign(miter || 1);
          nx = mx;
          nz = mz;
          left.push({
            x: p.x + nx * halfW * miterClamp,
            z: p.z + nz * halfW * miterClamp,
            y: p.y + yBias,
          });
          right.push({
            x: p.x - nx * halfW * miterClamp,
            z: p.z - nz * halfW * miterClamp,
            y: p.y + yBias,
          });
          continue;
        }
      }

      left.push({ x: p.x + nx * halfW, z: p.z + nz * halfW, y: p.y + yBias });
      right.push({ x: p.x - nx * halfW, z: p.z - nz * halfW, y: p.y + yBias });
    }

    for (let i = 0; i < pts.length; i++) {
      const L = left[i];
      const R = right[i];
      positions.push(L.x, L.y, L.z, R.x, R.y, R.z);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  if (!indices.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** White dashed lane line down the middle of carriageways (Google Maps / pavement). */
function collectCenterDashes(ribbons) {
  const out = [];
  for (const r of ribbons) {
    if (r.pathLike) continue;
    if (!r.major && !r.medium) continue;
    const dashM = r.major ? 4.2 : 3.4;
    const gapM = r.major ? 3.8 : 3.2;
    const halfW = r.major ? 0.16 : 0.12;
    for (const pts of dashRunsAlong(r.pts, dashM, gapM)) {
      if (pts.length >= 2) out.push({ pts, halfW, color: "#f5f5f5" });
    }
  }
  return out;
}

function dashRunsAlong(pts, dashM, gapM) {
  const runs = [];
  if (!pts || pts.length < 2) return runs;
  const period = dashM + gapM;
  let cur = [];
  let dist = 0;
  let ax = pts[0].x;
  let ay = pts[0].y;
  let az = pts[0].z;

  const flush = () => {
    if (cur.length >= 2) runs.push(cur);
    cur = [];
  };

  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    const bx = b.x;
    const by = b.y;
    const bz = b.z;
    let seglen = Math.hypot(bx - ax, bz - az);
    while (seglen > 0.04) {
      const pos = dist % period;
      const inDash = pos < dashM;
      const toBoundary = (inDash ? dashM : period) - pos;
      let take = Math.min(seglen, toBoundary);
      if (take <= 1e-4) {
        take = Math.min(seglen, Math.max(take, 1e-4));
      }
      const t = take / seglen;
      const nx = ax + (bx - ax) * t;
      const ny = ay + (by - ay) * t;
      const nz = az + (bz - az) * t;
      if (inDash) {
        if (!cur.length) cur.push({ x: ax, z: az, y: ay + 0.05 });
        cur.push({ x: nx, z: nz, y: ny + 0.05 });
      } else {
        flush();
      }
      dist += take;
      ax = nx;
      ay = ny;
      az = nz;
      seglen -= take;
    }
    ax = b.x;
    ay = b.y;
    az = b.z;
  }
  flush();
  return runs;
}

function isOsmBridgeTag(bridge) {
  if (bridge == null || bridge === false) return false;
  const s = String(bridge).toLowerCase();
  return s !== "" && s !== "no" && s !== "false" && s !== "0";
}

function wayCrossesWater(verts, stations) {
  let wet = false;
  let dry = false;
  for (const v of verts || []) {
    if (pointOverWater(v.x, v.z, stations)) wet = true;
    else dry = true;
    if (wet && dry) return true;
  }
  return false;
}

function crossingHeightAt(x, z, stations, bridges) {
  const ground = terrainHeightAt(x, z, stations) + 0.28;
  let deck = SURFACE_Y + 1.9;
  for (const br of bridges || []) {
    if (!Number.isFinite(br.deckY)) continue;
    const sx = br.start?.x;
    const sz = br.start?.z;
    const ex = br.end?.x;
    const ez = br.end?.z;
    if (![sx, sz, ex, ez].every(Number.isFinite)) {
      if (Math.hypot((br.midX ?? 0) - x, (br.midZ ?? 0) - z) < 50) {
        deck = Math.max(deck, br.deckY);
      }
      continue;
    }
    const hit = closestOnSeg(x, z, sx, sz, ex, ez);
    if (hit.d < Math.max(18, (br.widthM || 14) * 1.1)) {
      deck = Math.max(deck, br.deckY);
    }
  }
  if (pointOverWater(x, z, stations)) return Math.max(ground, deck);
  return Math.max(ground, deck - 0.02);
}

function roadHeightAt(x, z, stations, bridges) {
  const ground = terrainHeightAt(x, z, stations) + 0.28;
  if (!bridges?.length) return ground;
  for (const br of bridges) {
    const deck = br.deckY;
    if (!Number.isFinite(deck)) continue;
    const sx = br.start?.x;
    const sz = br.start?.z;
    const ex = br.end?.x;
    const ez = br.end?.z;
    if (![sx, sz, ex, ez].every(Number.isFinite)) continue;
    const hit = closestOnSeg(x, z, sx, sz, ex, ez);
    const pad = Math.max(12, (br.widthM || 14) * 0.8);
    if (hit.d < pad) {
      // Smoothly transition at the very ends
      if (hit.t < 0.05) return ground + (deck - ground) * (hit.t / 0.05);
      if (hit.t > 0.95) return ground + (deck - ground) * ((1 - hit.t) / 0.05);
      return deck;
    }
  }
  return ground;
}

function roadBlocked(x, z, stations, bridges) {
  return false;
}

function pointOverWater(x, z, stations) {
  const y = terrainHeightAt(x, z, stations);
  if (y < SURFACE_Y + 0.55) return true;
  const bank = nearestHalf(x, z, stations);
  const half = Math.max(8, bank.half || 0);
  return bank.lat < half * 0.88;
}

function segmentOverWater(a, b, stations, bridges) {
  const steps = 10;
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (roadBlocked(x, z, stations, bridges || [])) return true;
  }
  return false;
}

function splitOnWater(pts, stations, bridges) {
  const runs = [];
  let cur = [];
  for (const p of pts) {
    if (roadBlocked(p.x, p.z, stations, bridges)) {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
      continue;
    }
    if (cur.length && segmentOverWater(cur[cur.length - 1], p, stations, bridges)) {
      if (cur.length >= 2) runs.push(cur);
      cur = [p];
      continue;
    }
    cur.push(p);
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

function isUnderBridgeDeck(x, z, bridges, stations) {
  if (!bridges?.length) return false;
  for (const br of bridges) {
    const sx = br.start?.x;
    const sz = br.start?.z;
    const ex = br.end?.x;
    const ez = br.end?.z;
    if (![sx, sz, ex, ez].every(Number.isFinite)) {
      if (Math.hypot((br.midX ?? 0) - x, (br.midZ ?? 0) - z) < 36) {
        const bank = nearestHalf(x, z, stations);
        if (bank.lat < Math.max(14, (bank.half || 0) + 10)) return true;
      }
      continue;
    }
    const hit = closestOnSeg(x, z, sx, sz, ex, ez);
    const pad = Math.max(16, (br.widthM || 14) * 0.95);
    // Only hide the mid-span (over water). Keep bank roads so they meet the abutments.
    if (hit.d < pad && hit.t > 0.22 && hit.t < 0.78 && pointOverWater(x, z, stations)) {
      return true;
    }
  }
  return false;
}

function closestOnSeg(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz || 1;
  let t = ((px - ax) * abx + (pz - az) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = ax + abx * t;
  const z = az + abz * t;
  return { x, z, t, d: Math.hypot(px - x, pz - z) };
}

function nearestHalf(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  let bestI = 0;
  const step = Math.max(1, Math.floor(stations.length / 180));
  for (let i = 0; i < stations.length; i += step) {
    const st = stations[i];
    const d2 = (st.x - x) ** 2 + (st.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = st;
      bestI = i;
    }
  }
  const lo = Math.max(0, bestI - step * 2);
  const hi = Math.min(stations.length, bestI + step * 2);
  for (let i = lo; i < hi; i++) {
    const st = stations[i];
    const d2 = (st.x - x) ** 2 + (st.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = st;
    }
  }
  const signed = (x - best.x) * -best.flowZ + (z - best.z) * best.flowX;
  const half =
    signed < 0
      ? (best.wetHalfLeft ?? best.halfWidth)
      : (best.wetHalfRight ?? best.halfWidth);
  return { lat: Math.abs(signed), half, st: best };
}
