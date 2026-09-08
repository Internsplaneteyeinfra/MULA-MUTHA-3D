import * as THREE from "three";
import { terrainHeightAt } from "./terrain.js";

/**
 * Continuous dark-blue nullah channels (stitched KML) + culvert/bridge markers
 * where channels pass under roads or near buildings.
 */
const CHANNEL = {
  bank: 0x1a3a58,
  water: 0x0d2f5c,
  highlight: 0x3a7ab8,
  flow: 0x6eb4e0,
  // Wider supporting tubes so nullahs read clearly at overview
  bankRadius: 4.2,
  waterRadius: 2.8,
  highlightRadius: 1.5,
};

const BRIDGE = {
  deck: 0xd2cdc4,
  rail: 0x9a9590,
  under: 0xe8c84a,
};

const MAIN_RIVER_NAME = /^(mula|mutha|mula[\s-]?mutha)$/i;
const JOIN_DIST_M = 45;
const DENSIFY_M = 10;

export function isNullahFeature(f) {
  const ww = String(f.waterway || "").toLowerCase();
  const name = String(f.name || "").trim();
  if (ww === "river") return false;
  if (MAIN_RIVER_NAME.test(name)) return false;
  return true;
}

export function createDrainageLayer(dataset) {
  const group = new THREE.Group();
  group.name = "drainageNetwork";

  const all = dataset.drainage || [];
  const features = all.filter(isNullahFeature);
  const stations = dataset.corridor?.stations || [];
  const roads = dataset.osm?.roads || [];
  const buildings = dataset.osm?.buildings || [];

  if (!features.length) {
    console.warn("Drainage layer EMPTY", { loaded: all.length });
    group.userData.stats = { features: 0, chains: 0, bridges: 0, underpasses: 0 };
    return group;
  }

  // 1) Stitch broken OSM ways into continuous channels (keep metadata for hover)
  const rawPaths = features
    .map((f) => ({
      name: String(f.name || "").trim().toLowerCase(),
      displayName: String(f.name || "").trim(),
      waterway: f.waterway,
      meta: {
        name: String(f.name || "").trim() || "Unnamed nullah",
        waterway: f.waterway || "stream",
        osmId: f.osmId || "",
        osmType: f.osmType || "",
        nameEn: f.nameEn || "",
        nameMr: f.nameMr || "",
        nameHi: f.nameHi || "",
        nameGu: f.nameGu || "",
        width: f.width || "",
        intermittent: f.intermittent || "",
        tunnel: f.tunnel || "",
        bridge: f.bridge || "",
        boat: f.boat || "",
        city: f.city || "",
        intName: f.intName || "",
        wikidata: f.wikidata || "",
        layer: f.layer || "",
      },
      pts: (f.vertices || [])
        .filter((v) => Number.isFinite(v?.x) && Number.isFinite(v?.z))
        .map((v) => ({ x: v.x, z: v.z, lon: v.lon, lat: v.lat })),
    }))
    .filter((p) => p.pts.length >= 2);

  const named = new Map();
  const unnamed = [];
  for (const p of rawPaths) {
    if (p.name) {
      if (!named.has(p.name)) named.set(p.name, []);
      named.get(p.name).push(p);
    } else unnamed.push(p);
  }

  /** @type {{ pts: {x:number,z:number,lon?:number,lat?:number}[], meta: object }[]} */
  const chains2d = [];
  for (const list of named.values()) {
    const merged = mergePaths(list.map((p) => p.pts), JOIN_DIST_M);
    const meta = list[0].meta;
    for (const pts of merged) chains2d.push({ pts, meta });
  }
  for (const p of unnamed) {
    const merged = mergePaths([p.pts], JOIN_DIST_M);
    for (const pts of merged) chains2d.push({ pts, meta: p.meta });
  }

  // 2) Densify → clip at river banks (no mid-channel stubs) → drape
  const chains3d = [];
  /** @type {{ pts: {x:number,z:number,y:number,lon?:number,lat?:number}[], meta: object, lengthM: number }[]} */
  const pickables = [];
  let clippedToBank = 0;

  for (const chain of chains2d) {
    const dense = densifyPath(chain.pts, DENSIFY_M);
    if (dense.length < 2) continue;
    // OSM nullahs often continue into mid-river — keep water only to the bank edge
    const bankRuns = clipPathToRiverBanks(dense, stations);
    if (!bankRuns.length) continue;
    if (bankRuns.length > 1 || bankRuns[0].length < dense.length) clippedToBank++;

    for (const run of bankRuns) {
      if (run.length < 2) continue;
      const draped = run.map((p) => {
        const under = underBuildingAmount(p.x, p.z, buildings);
        return {
          x: p.x,
          z: p.z,
          lon: p.lon,
          lat: p.lat,
          under,
          y: channelY(p.x, p.z, stations, buildings),
        };
      });
      smoothChannelHeights(draped);
      chains3d.push(draped);
      let lengthM = 0;
      for (let i = 1; i < draped.length; i++) {
        lengthM += Math.hypot(draped[i].x - draped[i - 1].x, draped[i].z - draped[i - 1].z);
      }
      pickables.push({ pts: draped, meta: chain.meta, lengthM });
    }
  }

  if (!chains3d.length) {
    group.userData.stats = { features: features.length, chains: 0, bridges: 0, underpasses: 0 };
    return group;
  }

  // 3) Smooth continuous tubes (no box corner breaks)
  const bankMeshes = [];
  const waterMeshes = [];
  const highlightMeshes = [];
  const flowPositions = [];

  for (const chain of chains3d) {
    // Open-ground points already sit on surface; tiny lift only for tube radius
    const curvePts = chain.map((p) => {
      const lift = (p.under || 0) > 0.35 ? 0.08 : 0.35;
      return new THREE.Vector3(p.x, p.y + lift, p.z);
    });
    if (curvePts.length < 2) continue;

    const curve = new THREE.CatmullRomCurve3(curvePts, false, "catmullrom", 0.15);
    const tubular = Math.max(8, Math.min(400, Math.floor(curve.getLength() / 4)));

    bankMeshes.push(makeTube(curve, tubular, CHANNEL.bankRadius, CHANNEL.bank, 0.38, 2));
    waterMeshes.push(makeTube(curve, tubular, CHANNEL.waterRadius, CHANNEL.water, 0.55, 3));
    highlightMeshes.push(
      makeTube(
        new THREE.CatmullRomCurve3(
          chain.map((p) => {
            const lift = (p.under || 0) > 0.35 ? 0.35 : 0.85;
            return new THREE.Vector3(p.x, p.y + lift, p.z);
          }),
          false,
          "catmullrom",
          0.15,
        ),
        tubular,
        CHANNEL.highlightRadius,
        CHANNEL.highlight,
        0.4,
        4,
      ),
    );

    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      const ay = a.y + ((a.under || 0) > 0.35 ? 0.5 : 1.1);
      const by = b.y + ((b.under || 0) > 0.35 ? 0.5 : 1.1);
      flowPositions.push(a.x, ay, a.z, b.x, by, b.z);
    }
  }

  // Thin banks + fill grouped so animated water can become primary without rebuild
  const staticBanks = new THREE.Group();
  staticBanks.name = "nullahStaticBanks";
  for (const m of bankMeshes) if (m) staticBanks.add(m);
  const staticFill = new THREE.Group();
  staticFill.name = "nullahStaticFill";
  for (const m of [...waterMeshes, ...highlightMeshes]) if (m) staticFill.add(m);
  group.add(staticBanks);
  group.add(staticFill);
  // Static dark fill is kept cached but hidden — animated nalla water is the primary surface
  staticFill.visible = false;
  group.userData.staticBanks = staticBanks;
  group.userData.staticFill = staticFill;

  if (flowPositions.length >= 6) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(flowPositions, 3));
    const line = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        color: CHANNEL.flow,
        transparent: true,
        opacity: 0.75,
        depthTest: true,
        depthWrite: false,
      }),
    );
    line.name = "nullahFlowPath";
    line.renderOrder = 4;
    line.frustumCulled = false;
    line.visible = false;
    group.add(line);
  }

  // 4) Culvert / bridge markers where nullah crosses a road
  const crossings = findRoadCrossings(chains3d, roads, 220);
  const bridges = createBridgeMarkers(crossings);
  if (bridges) group.add(bridges);

  // 5) Under-building markers (channel goes beneath city blocks)
  const underpasses = findBuildingUnderpasses(chains3d, buildings, 100);
  const underGroup = createUnderpassMarkers(underpasses);
  if (underGroup) group.add(underGroup);

  group.userData.stats = {
    features: features.length,
    chains: chains3d.length,
    segments: flowPositions.length / 6,
    bridges: crossings.length,
    underpasses: underpasses.length,
    skippedMainRiver: all.length - features.length,
    clippedToBank,
  };
  group.userData.pickables = pickables;

  group.visible = false;
  console.info("Nullah continuous channels READY", group.userData.stats);
  return group;
}

/**
 * Nearest nullah under cursor (XZ distance). Used for hover tooltips.
 * @returns {null | { distM: number, hit: {x:number,z:number,y:number,lon?:number,lat?:number}, meta: object, lengthM: number }}
 */
export function pickNullahAt(drainageGroup, x, z, maxDistM = 28) {
  const list = drainageGroup?.userData?.pickables;
  if (!list?.length) return null;
  let best = null;
  let bestD = maxDistM;
  for (const path of list) {
    const pts = path.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const hit = closestPointOnSegXZ(x, z, a, b);
      if (hit.d < bestD) {
        bestD = hit.d;
        best = {
          distM: hit.d,
          hit: {
            x: hit.x,
            z: hit.z,
            y: a.y + (b.y - a.y) * hit.t,
            lon: a.lon != null && b.lon != null ? a.lon + (b.lon - a.lon) * hit.t : undefined,
            lat: a.lat != null && b.lat != null ? a.lat + (b.lat - a.lat) * hit.t : undefined,
          },
          meta: path.meta,
          lengthM: path.lengthM,
        };
      }
    }
  }
  return best;
}

function closestPointOnSegXZ(px, pz, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  let t = ((px - a.x) * abx + (pz - a.z) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + abx * t;
  const z = a.z + abz * t;
  return { x, z, t, d: Math.hypot(px - x, pz - z) };
}

function makeTube(curve, tubular, radius, color, opacity, renderOrder) {
  try {
    const geo = new THREE.TubeGeometry(curve, tubular, radius, 8, false);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
      // Prefer building occlusion when depths are close
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    return mesh;
  } catch {
    return null;
  }
}

/** Greedy endpoint stitching → continuous polylines. */
function mergePaths(paths, joinDist) {
  if (!paths.length) return [];
  const remaining = paths.map((p) => p.slice());
  const chains = [];

  while (remaining.length) {
    let pts = remaining.shift();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < remaining.length; i++) {
        const other = remaining[i];
        const head = pts[0];
        const tail = pts[pts.length - 1];
        const oHead = other[0];
        const oTail = other[other.length - 1];
        let next = null;
        if (dist2(tail, oHead) <= joinDist) next = pts.concat(other.slice(1));
        else if (dist2(tail, oTail) <= joinDist) next = pts.concat(other.slice().reverse().slice(1));
        else if (dist2(head, oTail) <= joinDist) next = other.slice(0, -1).concat(pts);
        else if (dist2(head, oHead) <= joinDist) next = other.slice().reverse().slice(0, -1).concat(pts);
        if (next) {
          pts = next;
          remaining.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    if (pts.length >= 2) chains.push(pts);
  }
  return chains;
}

function densifyPath(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = dist2(a, b);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const p = {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
      };
      if (Number.isFinite(a.lon) && Number.isFinite(b.lon)) {
        p.lon = a.lon + (b.lon - a.lon) * t;
        p.lat = a.lat + (b.lat - a.lat) * t;
      }
      out.push(p);
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

function dist2(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Drop mid-channel stubs: keep nullah geometry only outside / on the river bank.
 * When a segment crosses the bank, snap an endpoint onto the edge.
 * Paths that cross the river are split into separate land-side runs.
 */
function clipPathToRiverBanks(pts, stations) {
  if (!stations?.length || pts.length < 2) return pts.length >= 2 ? [pts] : [];

  const samples = pts.map((p) => {
    const r = riverLatHalf(p.x, p.z, stations);
    // Slightly inside half so tube mouths sit on the visible bank, not mid-channel
    const bank = Math.max(8, (r.half || 40) * 0.98);
    return { p, lat: r.lat, half: bank, inside: r.lat < bank };
  });

  const runs = [];
  let run = [];

  const pushRun = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };

  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i];
    const prev = i > 0 ? samples[i - 1] : null;

    if (!cur.inside) {
      if (prev?.inside) {
        // Leaving the channel → start a new land-side run at the bank
        pushRun();
        run.push(bankEdgePoint(prev, cur));
      }
      run.push(cur.p);
    } else if (prev && !prev.inside) {
      // Entering the channel → stop at bank edge (do not keep mid-river points)
      run.push(bankEdgePoint(prev, cur));
      pushRun();
    }
    // skip pure mid-channel vertices
  }
  pushRun();
  return runs;
}

/** Lateral distance from corridor center vs bank half-width. */
function riverLatHalf(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 220));
  for (let i = 0; i < stations.length; i += step) {
    const st = stations[i];
    const d2 = (st.x - x) ** 2 + (st.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = st;
    }
  }
  // Refine locally
  const i0 = stations.indexOf(best);
  const lo = Math.max(0, i0 - 24);
  const hi = Math.min(stations.length - 1, i0 + 24);
  for (let i = lo; i <= hi; i++) {
    const st = stations[i];
    const d2 = (st.x - x) ** 2 + (st.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = st;
    }
  }
  const fx = best.flowX ?? 0;
  const fz = best.flowZ ?? 1;
  const lat = Math.abs((x - best.x) * -fz + (z - best.z) * fx);
  return { lat, half: best.halfWidth || 40, st: best };
}

/** Interpolate where a land→water (or water→land) segment meets the bank. */
function bankEdgePoint(a, b) {
  const oa = a.half - a.lat; // ≤ 0 outside, > 0 inside
  const ob = b.half - b.lat;
  const den = ob - oa;
  let t = Math.abs(den) < 1e-6 ? 0.5 : (0 - oa) / den;
  t = Math.max(0.02, Math.min(0.98, t));
  const p = {
    x: a.p.x + (b.p.x - a.p.x) * t,
    z: a.p.z + (b.p.z - a.p.z) * t,
  };
  if (Number.isFinite(a.p.lon) && Number.isFinite(b.p.lon)) {
    p.lon = a.p.lon + (b.p.lon - a.p.lon) * t;
    p.lat = a.p.lat + (b.p.lat - a.p.lat) * t;
  }
  return p;
}

function channelY(x, z, stations, buildings = []) {
  const ground = terrainHeightAt(x, z, stations);
  const under = underBuildingAmount(x, z, buildings);
  // Under buildings → deep culvert (hidden by building mass)
  if (under > 0.55) return ground - 5.8;
  if (under > 0.2) return ground - THREE.MathUtils.lerp(0.35, 3.6, under);
  // Open ground (no buildings): sit ON the surface as a clear open channel
  // Slight lift avoids z-fighting with terrain while looking grounded
  return ground + 0.65;
}

/** 0 = open ground, 1 = inside building footprint (with soft edge). */
function underBuildingAmount(x, z, buildings) {
  if (!buildings?.length) return 0;
  let best = 0;
  for (const b of buildings) {
    const verts = b.vertices;
    if (!verts || verts.length < 3) {
      if (!Number.isFinite(b.midX) || !Number.isFinite(b.midZ)) continue;
      const d = Math.hypot(x - b.midX, z - b.midZ);
      // Tight — only real footprints should bury the channel
      if (d < 10) best = Math.max(best, 1 - d / 10);
      continue;
    }
    if (Number.isFinite(b.midX)) {
      const d2 = (x - b.midX) ** 2 + (z - b.midZ) ** 2;
      if (d2 > 70 * 70) continue;
    }
    if (pointInRingXZ(x, z, verts)) {
      best = 1;
      break;
    }
    const edgeD = distToRingXZ(x, z, verts);
    if (edgeD < 3) best = Math.max(best, 1 - edgeD / 3);
  }
  return best;
}

function pointInRingXZ(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToRingXZ(x, z, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}

/** Soften abrupt culvert dips so tubes don't kink. */
function smoothChannelHeights(pts) {
  if (pts.length < 3) return;
  const ys = pts.map((p) => p.y);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      pts[i].y = ys[i] * 0.45 + ys[i - 1] * 0.275 + ys[i + 1] * 0.275;
    }
    for (let i = 0; i < pts.length; i++) ys[i] = pts[i].y;
  }
}

/** 2D segment intersection (XZ plane). */
function segIntersectXZ(a, b, c, d) {
  const x1 = a.x;
  const y1 = a.z;
  const x2 = b.x;
  const y2 = b.z;
  const x3 = c.x;
  const y3 = c.z;
  const x4 = d.x;
  const y4 = d.z;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-8) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / den;
  if (t < 0.02 || t > 0.98 || u < 0.02 || u > 0.98) return null;
  return { x: x1 + t * (x2 - x1), z: y1 + t * (y2 - y1), t };
}

function findRoadCrossings(chains3d, roads, maxN) {
  const roadSegs = [];
  for (const road of roads) {
    const v = road.vertices || [];
    if (v.length < 2) continue;
    const hw = String(road.highway || "");
    // Prefer real streets (skip tiny paths for clarity)
    if (/footway|path|steps|cycleway/.test(hw)) continue;
    const w = Math.max(4, Number(road.widthM) || 6);
    for (let i = 0; i < v.length - 1; i++) {
      const len = Math.hypot(v[i + 1].x - v[i].x, v[i + 1].z - v[i].z);
      if (len < 2) continue;
      roadSegs.push({ a: v[i], b: v[i + 1], w });
    }
  }

  const hits = [];
  outer: for (const chain of chains3d) {
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      for (const rs of roadSegs) {
        const hit = segIntersectXZ(a, b, rs.a, rs.b);
        if (!hit) continue;
        hits.push({
          x: hit.x,
          z: hit.z,
          y: Math.max(a.y, b.y) + 2.2,
          rot: Math.atan2(dx, dz),
          roadW: rs.w,
        });
        if (hits.length >= maxN * 3) break outer;
      }
    }
  }
  return dedupeHits(hits, 14).slice(0, maxN);
}

function findBuildingUnderpasses(chains3d, buildings, maxN) {
  const hits = [];
  for (const b of buildings) {
    const cx = b.midX;
    const cz = b.midZ;
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
    const r = 22;
    for (const chain of chains3d) {
      let best = null;
      let bestD = r;
      // Sample along chain
      for (let i = 0; i < chain.length; i += 2) {
        const p = chain[i];
        const d = Math.hypot(p.x - cx, p.z - cz);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) {
        hits.push({ x: best.x, z: best.z, y: best.y + 0.4 });
        break;
      }
    }
    if (hits.length >= maxN * 2) break;
  }
  return dedupeHits(hits, 28).slice(0, maxN);
}

function dedupeHits(hits, minDist) {
  const out = [];
  for (const h of hits) {
    if (out.some((o) => Math.hypot(o.x - h.x, o.z - h.z) < minDist)) continue;
    out.push(h);
  }
  return out;
}

function createBridgeMarkers(crossings) {
  if (!crossings.length) return null;
  const group = new THREE.Group();
  group.name = "nullahRoadCulverts";

  const deckGeo = new THREE.BoxGeometry(1, 1, 1);
  const railGeo = new THREE.BoxGeometry(1, 1, 1);
  const deckMat = new THREE.MeshBasicMaterial({
    color: BRIDGE.deck,
    transparent: true,
    opacity: 0.95,
    depthTest: true,
    depthWrite: false,
  });
  const railMat = new THREE.MeshBasicMaterial({
    color: BRIDGE.rail,
    transparent: true,
    opacity: 0.9,
    depthTest: true,
    depthWrite: false,
  });

  const decks = new THREE.InstancedMesh(deckGeo, deckMat, crossings.length);
  const railsL = new THREE.InstancedMesh(railGeo, railMat, crossings.length);
  const railsR = new THREE.InstancedMesh(railGeo, railMat, crossings.length);
  decks.frustumCulled = false;
  railsL.frustumCulled = false;
  railsR.frustumCulled = false;
  decks.renderOrder = 34;
  railsL.renderOrder = 35;
  railsR.renderOrder = 35;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i];
    const span = Math.max(10, c.roadW + 6);
    const along = 8;

    // Deck sits across the road, over the nullah
    dummy.position.set(c.x, c.y, c.z);
    dummy.rotation.set(0, c.rot + Math.PI / 2, 0);
    dummy.scale.set(span, 0.7, along);
    dummy.updateMatrix();
    decks.setMatrixAt(i, dummy.matrix);

    dummy.position.set(c.x, c.y + 0.7, c.z);
    dummy.scale.set(span, 0.55, 0.45);
    // offset rails along nullah direction
    const px = -Math.sin(c.rot);
    const pz = Math.cos(c.rot);
    dummy.position.set(c.x + px * (along * 0.4), c.y + 0.75, c.z + pz * (along * 0.4));
    dummy.scale.set(span * 0.92, 0.55, 0.4);
    dummy.updateMatrix();
    railsL.setMatrixAt(i, dummy.matrix);

    dummy.position.set(c.x - px * (along * 0.4), c.y + 0.75, c.z - pz * (along * 0.4));
    dummy.updateMatrix();
    railsR.setMatrixAt(i, dummy.matrix);
  }
  decks.instanceMatrix.needsUpdate = true;
  railsL.instanceMatrix.needsUpdate = true;
  railsR.instanceMatrix.needsUpdate = true;
  group.add(decks, railsL, railsR);
  return group;
}

function createUnderpassMarkers(hits) {
  if (!hits.length) return null;
  const group = new THREE.Group();
  group.name = "nullahBuildingUnderpasses";

  // Yellow portal rings — “channel goes under the building”
  const ringGeo = new THREE.TorusGeometry(3.2, 0.55, 6, 16);
  ringGeo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: BRIDGE.under,
    transparent: true,
    opacity: 0.55,
    depthTest: true,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(ringGeo, mat, hits.length);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    dummy.position.set(h.x, h.y, h.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return group;
}
