import * as THREE from "three";
import { terrainHeightAt } from "../scene/terrain.js";
import { OSM_ROADS_RENDER_ORDER } from "../scene/drapeDepth.js";
import { SURFACE_Y } from "../scene/river.js";
import { getBridgeDeckSurfaceY } from "../scene/bridges.js";

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
const BRIDGE_APPROACH_M = 36;

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

  // Precompute bridge bounding boxes for O(1) proximity rejection
  const bridgeBoxes = bridges.map((br) => {
    const sx = br.start?.x ?? br.midX ?? 0;
    const sz = br.start?.z ?? br.midZ ?? 0;
    const ex = br.end?.x ?? br.midX ?? 0;
    const ez = br.end?.z ?? br.midZ ?? 0;
    // Include the widest rendered road plus the bridge clearance corridor.
    const pad = Math.max(32, (br.widthM || 14) * 1.2 + 12);
    return {
      br,
      deckY: br.deckY,
      sx, sz, ex, ez,
      minX: Math.min(sx, ex) - pad,
      maxX: Math.max(sx, ex) + pad,
      minZ: Math.min(sz, ez) - pad,
      maxZ: Math.max(sz, ez) + pad,
      pad: Math.max(12, (br.widthM || 14) * 0.8),
    };
  });

  const bridgeOsmIds = new Set(bridges.map((b) => String(b.id || b.osmId)));
  const isBridgeWay = (road) => {
    const osmId = String(road.osmId || road.id || "");
    if (bridgeOsmIds.has(osmId)) return true;
    if (road.bridge === "yes" || road.bridge === true || road.bridge === "viaduct") return true;
    const name = String(road.name || "");
    if (/\b(bridge|setu|viaduct)\b/i.test(name)) return true;
    return false;
  };

  /** @type {Array<{pts: Array<{x:number,z:number,y:number}>, halfW:number, color:string, major:boolean, medium:boolean, pathLike:boolean, hw:string}>} */
  const ribbons = [];
  let skippedWater = 0;

  for (const road of rawRoads) {
    if (isBridgeWay(road)) {
      // Bridges only look like bridges: elevated 3D deck carries the river crossing,
      // never draw duplicate flat ground road ribbon across the river channel!
      continue;
    }
    const hw = road.highway || "residential";
    if (hw === "steps" || hw === "bridleway") continue;
    const w = Math.max(1.6, road.widthM || WIDTH_BY_CLASS[hw] || 5.5);
    const rawVerts = road.vertices || [];
    if (rawVerts.length < 2) continue;

    // Shallow copy vertices so snapping does not mutate raw context
    const verts = rawVerts.map((v) => ({ x: v.x, z: v.z }));

    // Seamlessly snap road endpoints within 35m of any bridge abutment
    const snap0 = findNearBridgeAbutment(verts[0].x, verts[0].z, bridgeBoxes, 35);
    if (snap0) {
      verts[0].x = snap0.x;
      verts[0].z = snap0.z;
    }
    const lastIdx = verts.length - 1;
    const snapN = findNearBridgeAbutment(verts[lastIdx].x, verts[lastIdx].z, bridgeBoxes, 35);
    if (snapN) {
      verts[lastIdx].x = snapN.x;
      verts[lastIdx].z = snapN.z;
    }

    const pathLike = PATH.test(hw);
    const major = MAJOR.test(hw);
    const medium = MEDIUM.test(hw);
    const color = ASPHALT[hw] || "#2a2a2c";
    const visW = pathLike ? Math.max(1.8, w) : Math.max(5.4, w * 1.12);
    const halfW = visW * 0.5;
    const maxStep = major ? 12 : 18;
    // OSM ways can have vertices far apart. Sample each segment before bridge
    // checks so a long road cannot jump across an under-bridge exclusion zone.
    const sampledVerts = sampleRoadVertices(verts, Math.min(6, Math.max(2, halfW)));

    let run = [];
    const flushRun = () => {
      if (run.length >= 2) {
        const dense = densifyRun(run, maxStep, stations, bridgeBoxes);
        if (dense.length >= 2) {
          ribbons.push({
            pts: dense,
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

    for (let i = 0; i < sampledVerts.length; i++) {
      const v = sampledVerts[i];
      const underSpan = isUnderBridgeSpan(v.x, v.z, bridgeBoxes, halfW + 1.5);

      // Bridges only look like bridges: do not draw road ribbon across the water under the bridge!
      if (underSpan) {
        // Road heading into the bridge: snap to the abutment, flush the approach run, then pause across water
        if (run.length >= 1) {
          const abutPt = underSpan.hit.t < 0.5
            ? { x: underSpan.bridge.sx, z: underSpan.bridge.sz }
            : { x: underSpan.bridge.ex, z: underSpan.bridge.ez };
          run.push(abutPt);
          flushRun();
        }
        continue;
      }

      // Approach road checking: keep roads on the land side of abutments, but skip if in the river!
      const nearAbut = findNearBridgeAbutment(v.x, v.z, bridgeBoxes, 45);
      const overWater = pointOverWater(v.x, v.z, stations);
      const landSide = nearAbut && isLandSideOfAbutment(v.x, v.z, nearAbut);

      if (overWater && !landSide) {
        skippedWater++;
        flushRun();
        continue;
      }

      // If exiting a bridge span onto land: resume run starting cleanly at the exit abutment!
      if (run.length === 0 && i > 0) {
        const prevUnder = isUnderBridgeSpan(sampledVerts[i - 1].x, sampledVerts[i - 1].z, bridgeBoxes, halfW + 1.5);
        if (prevUnder) {
          const exitPt = prevUnder.hit.t >= 0.5
            ? { x: prevUnder.bridge.ex, z: prevUnder.bridge.ez }
            : { x: prevUnder.bridge.sx, z: prevUnder.bridge.sz };
          run.push(exitPt);
        }
      }

      run.push(v);
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

  console.info("Roads", { ribbons: ribbons.length, skippedWater, osm: rawRoads.length, dashes: dashRibbons.length });
  return group;
}

function sampleRoadVertices(vertices, maxStepM) {
  if (vertices.length < 2) return vertices;
  const sampled = [vertices[0]];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(length / maxStepM));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      sampled.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return sampled;
}

/** Insert points along long spans so terrain height follows smoothly. */
function densifyRun(pts, maxStepM, stations, bridgeBoxes) {
  if (pts.length < 2) return pts;
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / maxStepM));
    const startK = i === 1 ? 0 : 1;
    for (let k = startK; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      out.push({
        x,
        z,
        y: roadHeightAt(x, z, stations, bridgeBoxes),
      });
    }
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

function findNearBridgeAbutment(x, z, bridgeBoxes, radius = 55) {
  if (!bridgeBoxes?.length) return null;
  let nearest = null;
  for (let i = 0; i < bridgeBoxes.length; i++) {
    const b = bridgeBoxes[i];
    const dStart = Math.hypot(x - b.sx, z - b.sz);
    if (dStart <= radius && (!nearest || dStart < nearest.dist)) {
      nearest = { bridge: b, abutment: "start", x: b.sx, z: b.sz, deckY: b.deckY, dist: dStart };
    }
    const dEnd = Math.hypot(x - b.ex, z - b.ez);
    if (dEnd <= radius && (!nearest || dEnd < nearest.dist)) {
      nearest = { bridge: b, abutment: "end", x: b.ex, z: b.ez, deckY: b.deckY, dist: dEnd };
    }
  }
  return nearest;
}

function isUnderBridgeSpan(x, z, bridgeBoxes, roadHalfWidth = 0) {
  if (!bridgeBoxes?.length) return null;
  let nearest = null;
  for (let i = 0; i < bridgeBoxes.length; i++) {
    const b = bridgeBoxes[i];
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    const hit = closestOnSeg(x, z, b.sx, b.sz, b.ex, b.ez);
    // Across the river span: between 5% and 95% of the bridge span, within road width
    if (hit.d < b.pad + roadHalfWidth && hit.t > 0.04 && hit.t < 0.96) {
      if (!nearest || hit.d < nearest.hit.d) nearest = { bridge: b, hit };
    }
  }
  return nearest;
}

function roadHeightAt(x, z, stations, bridgeBoxes) {
  const ground = terrainHeightAt(x, z, stations) + 0.28;
  if (!bridgeBoxes?.length) return ground;

  const nearAbut = findNearBridgeAbutment(x, z, bridgeBoxes, BRIDGE_APPROACH_M);
  if (nearAbut && Number.isFinite(nearAbut.deckY)) {
    const targetY = getBridgeDeckSurfaceY(nearAbut.bridge.br?.name, nearAbut.deckY);
    // Smooth ramp from targetY down to ground level over BRIDGE_APPROACH_M
    const t = Math.max(0, Math.min(1, nearAbut.dist / BRIDGE_APPROACH_M));
    const smoothT = t * t * (3 - 2 * t);
    return THREE.MathUtils.lerp(targetY, ground, smoothT);
  }

  return ground;
}

function isLandSideOfAbutment(x, z, nearAbut) {
  if (!nearAbut?.bridge) return false;
  const b = nearAbut.bridge;
  const dx = b.ex - b.sx;
  const dz = b.ez - b.sz;
  const len = Math.hypot(dx, dz);
  if (len < 1) return false;
  const ux = dx / len;
  const uz = dz / len;

  if (nearAbut.abutment === "start") {
    // start abutment: vector points towards river (+dir), so land is behind start (dot <= 1.5)
    const dot = (x - b.sx) * ux + (z - b.sz) * uz;
    return dot <= 1.5;
  } else {
    // end abutment: vector points from river (+dir), so land is ahead of end (dot >= -1.5)
    const dot = (x - b.ex) * ux + (z - b.ez) * uz;
    return dot >= -1.5;
  }
}

function crossingHeightAt(x, z, stations, bridgeBoxes) {
  return roadHeightAt(x, z, stations, bridgeBoxes);
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
