import * as THREE from "three";
import { terrainHeightAt } from "./terrain.js";
import { SURFACE_Y } from "./river.js";

/**
 * Continuous dark-blue nullah channels (stitched KML) + culvert/bridge markers
 * where channels pass under roads or near buildings.
 */
const CHANNEL = {
  bank: 0x1a3a58,
  water: 0x0d2f5c,
  highlight: 0x3a7ab8,
  flow: 0x6eb4e0,
  // Thin supporting edge — animated water is the visual primary
  bankRadius: 3.4,
  waterRadius: 2.1,
  highlightRadius: 1.15,
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

  // 2) Densify + drape → continuous 3D paths (+ pick index for hover)
  const chains3d = [];
  /** @type {{ pts: {x:number,z:number,y:number,lon?:number,lat?:number}[], meta: object, lengthM: number }[]} */
  const pickables = [];

  for (const chain of chains2d) {
    const dense = densifyPath(chain.pts, DENSIFY_M);
    if (dense.length < 2) continue;
    const draped = dense.map((p) => ({
      x: p.x,
      z: p.z,
      lon: p.lon,
      lat: p.lat,
      y: channelY(p.x, p.z, stations),
    }));
    chains3d.push(draped);
    let lengthM = 0;
    for (let i = 1; i < draped.length; i++) {
      lengthM += Math.hypot(draped[i].x - draped[i - 1].x, draped[i].z - draped[i - 1].z);
    }
    pickables.push({ pts: draped, meta: chain.meta, lengthM });
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
    const curvePts = chain.map((p) => new THREE.Vector3(p.x, p.y + 0.4, p.z));
    if (curvePts.length < 2) continue;

    const curve = new THREE.CatmullRomCurve3(curvePts, false, "catmullrom", 0.15);
    const tubular = Math.max(8, Math.min(400, Math.floor(curve.getLength() / 4)));

    bankMeshes.push(makeTube(curve, tubular, CHANNEL.bankRadius, CHANNEL.bank, 0.32, 28));
    waterMeshes.push(makeTube(curve, tubular, CHANNEL.waterRadius, CHANNEL.water, 0.55, 29));
    highlightMeshes.push(
      makeTube(
        new THREE.CatmullRomCurve3(
          chain.map((p) => new THREE.Vector3(p.x, p.y + 1.6, p.z)),
          false,
          "catmullrom",
          0.15,
        ),
        tubular,
        CHANNEL.highlightRadius,
        CHANNEL.highlight,
        0.4,
        30,
      ),
    );

    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      flowPositions.push(a.x, a.y + 2.6, a.z, b.x, b.y + 2.6, b.z);
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
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    );
    line.name = "nullahFlowPath";
    line.renderOrder = 31;
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
      depthTest: false,
      depthWrite: false,
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

function channelY(x, z, stations) {
  const ground = terrainHeightAt(x, z, stations);
  return Math.max(ground, SURFACE_Y - 0.5) + 3.2;
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
        hits.push({ x: best.x, z: best.z, y: best.y + 3.5 });
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
    depthTest: false,
    depthWrite: false,
  });
  const railMat = new THREE.MeshBasicMaterial({
    color: BRIDGE.rail,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
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
    opacity: 0.88,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(ringGeo, mat, hits.length);
  mesh.frustumCulled = false;
  mesh.renderOrder = 36;
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
