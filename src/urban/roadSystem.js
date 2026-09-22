import * as THREE from "three";
import { terrainHeightAt } from "../scene/terrain.js";

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

/** Asphalt / surface colors by class — dark grey, not pure black. */
const ASPHALT = {
  motorway: "#4a5058",
  trunk: "#4c525a",
  primary: "#505660",
  secondary: "#545a62",
  tertiary: "#585e66",
  residential: "#5c6268",
  unclassified: "#5e646a",
  living_street: "#60666c",
  service: "#646a70",
  track: "#726858",
  footway: "#8a8478",
  path: "#7e786c",
  cycleway: "#5a6870",
  pedestrian: "#8e8880",
};

const MAJOR = /^(motorway|trunk|primary|secondary)$/;
const MEDIUM = /^(tertiary|residential|unclassified|living_street)$/;
const PATH = /^(footway|path|cycleway|pedestrian|track)$/;

/**
 * Terrain-following OSM roads as continuous mitered ribbons (no box gaps at bends).
 * Junction discs + bridge approach links keep intersections sealed.
 */
export function createRoadSystem(dataset) {
  const group = new THREE.Group();
  group.name = "roads";
  const stations = dataset.corridor.stations;
  const rawRoads = dataset.osm?.roads || [];
  if (!rawRoads.length) return group;

  const bridges = dataset.bridges || [];
  const roads = rawRoads.map((r) => ({
    ...r,
    vertices: (r.vertices || []).map((v) => ({ ...v })),
  }));
  snapRoadNetwork(roads, 12);

  /** @type {Array<{pts: Array<{x:number,z:number,y:number}>, halfW:number, color:string, major:boolean, medium:boolean, pathLike:boolean, hw:string}>} */
  const ribbons = [];
  const edgeSegs = [];
  const dashSegs = [];
  const junctionNodes = [];
  const roadTips = [];
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
    const widthScale = pathLike ? 0.85 : major ? 1.0 : medium ? 0.88 : 0.78;
    const deckW = w * widthScale;
    const color = ASPHALT[hw] || "#5a6068";
    const segW = pathLike ? Math.min(deckW, 2.8) : deckW;
    const halfW = segW * 0.5;

    // Build contiguous land runs (break over water / under bridge decks)
    let run = [];
    const flushRun = () => {
      if (run.length >= 2) {
        const densified = densifyRun(run, 14);
        ribbons.push({
          pts: densified,
          halfW,
          color,
          major,
          medium,
          pathLike,
          hw,
        });
        addMarkingsAlong(densified, halfW, major, medium, edgeSegs, dashSegs);
      }
      run = [];
    };

    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      const bank = nearestHalf(v.x, v.z, stations);
      const overWater = bank.lat < bank.half * 0.72;
      const underBridge = isUnderBridgeDeck(v.x, v.z, bridges, stations);
      if (overWater || underBridge) {
        if (overWater || underBridge) skippedWater++;
        flushRun();
        continue;
      }
      const y = terrainHeightAt(v.x, v.z, stations) + 0.14;
      run.push({ x: v.x, z: v.z, y });
    }
    flushRun();

    // Tips + junctions from land vertices
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      const bank = nearestHalf(v.x, v.z, stations);
      if (bank.lat < bank.half * 0.72) continue;
      if (isUnderBridgeDeck(v.x, v.z, bridges, stations)) continue;
      const y = terrainHeightAt(v.x, v.z, stations) + 0.13;
      pushJunction(junctionNodes, { x: v.x, z: v.z, y, w: segW, color });
      if (i === 0 || i === verts.length - 1) {
        roadTips.push({ x: v.x, z: v.z, y, w: segW, color, major, medium });
      }
    }
  }

  // Bridge approach ribbons (2-point strips)
  const approachLinks = linkRoadsToBridges(roadTips, bridges, stations, ribbons, junctionNodes);
  mergeNearbyJunctions(junctionNodes, 18);

  if (!ribbons.length) return group;

  // —— Continuous asphalt ribbons (merged, vertex-colored) ——
  const asphaltGeo = buildMergedRibbons(ribbons, (r) => r.halfW, 0);
  if (asphaltGeo) {
    const asphaltMat = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.96,
      metalness: 0.02,
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const asphalt = new THREE.Mesh(asphaltGeo, asphaltMat);
    asphalt.name = "roadAsphalt";
    asphalt.receiveShadow = true;
    asphalt.castShadow = false;
    asphalt.frustumCulled = false;
    group.add(asphalt);
  }

  // —— Soft shoulders (slightly wider, lower) ——
  const shoulderRibbons = ribbons
    .filter((r) => r.major || r.medium)
    .map((r) => ({
      ...r,
      halfW: r.halfW + (r.major ? 0.55 : 0.35),
      color: "#a8a098",
    }));
  const shoulderGeo = buildMergedRibbons(shoulderRibbons, (r) => r.halfW, -0.04);
  if (shoulderGeo) {
    const shoulderMat = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.92,
      metalness: 0.02,
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const shoulders = new THREE.Mesh(shoulderGeo, shoulderMat);
    shoulders.name = "roadShoulders";
    shoulders.receiveShadow = true;
    shoulders.frustumCulled = false;
    shoulders.renderOrder = -1;
    group.add(shoulders);
  }

  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, 0.5, 0);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // —— Junction discs (seal intersections between different OSM ways) ——
  if (junctionNodes.length) {
    const discGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
    discGeo.translate(0, 0.5, 0);
    const discMat = new THREE.MeshStandardMaterial({
      color: "#5c6268",
      roughness: 0.96,
      metalness: 0.02,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const discs = new THREE.InstancedMesh(discGeo, discMat, junctionNodes.length);
    discs.name = "roadJunctions";
    discs.receiveShadow = true;
    discs.frustumCulled = false;
    for (let i = 0; i < junctionNodes.length; i++) {
      const n = junctionNodes[i];
      dummy.position.set(n.x, n.y + 0.01, n.z);
      dummy.rotation.set(0, 0, 0);
      // Slightly oversized so corner miters never flash green
      const d = Math.max(3.2, n.w * 1.35);
      dummy.scale.set(d, 0.16, d);
      dummy.updateMatrix();
      discs.setMatrixAt(i, dummy.matrix);
      color.set(n.color || "#5c6268");
      discs.setColorAt(i, color);
    }
    discs.instanceMatrix.needsUpdate = true;
    if (discs.instanceColor) discs.instanceColor.needsUpdate = true;
    group.add(discs);
  }

  // —— White edge lines ——
  if (edgeSegs.length) {
    const edgeMat = new THREE.MeshStandardMaterial({
      color: "#e8ecef",
      roughness: 0.72,
      metalness: 0.05,
      emissive: "#2a2e32",
      emissiveIntensity: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const edges = new THREE.InstancedMesh(unit, edgeMat, edgeSegs.length);
    edges.name = "roadEdges";
    edges.frustumCulled = false;
    for (let i = 0; i < edgeSegs.length; i++) {
      const s = edgeSegs[i];
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.scale.set(s.w, 0.05, s.len);
      dummy.updateMatrix();
      edges.setMatrixAt(i, dummy.matrix);
    }
    edges.instanceMatrix.needsUpdate = true;
    group.add(edges);
  }

  // —— Dashed center markings ——
  if (dashSegs.length) {
    const dashMat = new THREE.MeshStandardMaterial({
      color: "#f0e6b0",
      roughness: 0.65,
      metalness: 0.04,
      emissive: "#3a3418",
      emissiveIntensity: 0.15,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const dashes = new THREE.InstancedMesh(unit, dashMat, dashSegs.length);
    dashes.name = "roadDashes";
    dashes.frustumCulled = false;
    for (let i = 0; i < dashSegs.length; i++) {
      const s = dashSegs[i];
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.scale.set(s.w, 0.05, s.len);
      dummy.updateMatrix();
      dashes.setMatrixAt(i, dummy.matrix);
    }
    dashes.instanceMatrix.needsUpdate = true;
    group.add(dashes);
  }

  console.info("Roads", {
    ribbons: ribbons.length,
    junctions: junctionNodes.length,
    bridgeLinks: approachLinks,
    edges: edgeSegs.length,
    dashes: dashSegs.length,
    skippedWater,
  });
  return group;
}

/** Insert points along long spans so terrain height follows smoothly. */
function densifyRun(pts, maxStepM) {
  if (pts.length < 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / maxStepM));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        y: a.y + (b.y - a.y) * t,
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
          const miterClamp = Math.min(Math.abs(miter), 2.4) * Math.sign(miter || 1);
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

function addMarkingsAlong(pts, halfW, major, medium, edgeSegs, dashSegs) {
  if (!major && !medium) return;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1.2) continue;
    const mx = (a.x + b.x) * 0.5;
    const mz = (a.z + b.z) * 0.5;
    const y = Math.max(a.y, b.y) + 0.06;
    const rot = Math.atan2(dx, dz);
    const ux = dx / len;
    const uz = dz / len;

    if (major) {
      for (const side of [-1, 1]) {
        const ox = Math.cos(rot) * side * (halfW * 0.84);
        const oz = -Math.sin(rot) * side * (halfW * 0.84);
        edgeSegs.push({
          x: mx + ox,
          z: mz + oz,
          y: y + 0.02,
          len: len * 0.98,
          w: 0.16,
          rot,
        });
      }
    }

    if ((major && len > 4) || (medium && len > 8)) {
      const dashLen = major ? 2.8 : 2.2;
      const gap = major ? 2.0 : 3.2;
      const n = Math.max(1, Math.floor(len / (dashLen + gap)));
      for (let d = 0; d < n; d++) {
        const t = d * (dashLen + gap) + dashLen * 0.5;
        if (t > len - 0.8) break;
        dashSegs.push({
          x: a.x + ux * t,
          z: a.z + uz * t,
          y: y + 0.03,
          len: Math.min(dashLen, len - t),
          w: major ? 0.2 : 0.14,
          rot,
        });
      }
    }
  }
}

/** Snap nearby OSM endpoints / T-junctions so segments share the same XZ. */
function snapRoadNetwork(roads, snapM) {
  const ends = [];
  for (const road of roads) {
    const v = road.vertices;
    if (!v || v.length < 2) continue;
    ends.push(v[0], v[v.length - 1]);
  }
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i];
      const b = ends[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d <= 0 || d > snapM) continue;
      const x = (a.x + b.x) * 0.5;
      const z = (a.z + b.z) * 0.5;
      a.x = b.x = x;
      a.z = b.z = z;
    }
  }
  for (const end of ends) {
    let best = null;
    let bestD = snapM;
    for (const road of roads) {
      const v = road.vertices;
      if (!v || v.length < 3) continue;
      for (let i = 1; i < v.length - 1; i++) {
        const p = v[i];
        if (p === end) continue;
        const d = Math.hypot(end.x - p.x, end.z - p.z);
        if (d > 0 && d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    if (best) {
      end.x = best.x;
      end.z = best.z;
    }
  }
}

function isUnderBridgeDeck(x, z, bridges, stations) {
  if (!bridges?.length) return false;
  const bank = nearestHalf(x, z, stations);
  if (bank.lat > bank.half * 0.95) return false;
  for (const br of bridges) {
    const sx = br.start?.x;
    const sz = br.start?.z;
    const ex = br.end?.x;
    const ez = br.end?.z;
    if (![sx, sz, ex, ez].every(Number.isFinite)) {
      if (Math.hypot((br.midX ?? 0) - x, (br.midZ ?? 0) - z) < 28) return true;
      continue;
    }
    const hit = closestOnSeg(x, z, sx, sz, ex, ez);
    if (hit.d < Math.max(18, (br.widthM || 12) * 0.7) && hit.t > 0.12 && hit.t < 0.88) {
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

/**
 * Short ribbons from road tips to bridge abutments / ramp toes.
 */
function linkRoadsToBridges(tips, bridges, stations, ribbons, junctionNodes) {
  if (!bridges?.length || !tips?.length) return 0;
  let links = 0;
  for (const br of bridges) {
    const ends = [
      { p: br.start, other: br.end },
      { p: br.end, other: br.start },
    ].filter((e) => e.p && Number.isFinite(e.p.x) && Number.isFinite(e.p.z));

    for (const end of ends) {
      const ax = end.p.x;
      const az = end.p.z;
      let dx = 0;
      let dz = 1;
      if (end.other && Number.isFinite(end.other.x)) {
        dx = ax - end.other.x;
        dz = az - end.other.z;
        const L = Math.hypot(dx, dz) || 1;
        dx /= L;
        dz /= L;
      }
      const toeX = ax + dx * 30;
      const toeZ = az + dz * 30;
      const targets = [
        { x: toeX, z: toeZ },
        { x: ax, z: az },
      ];

      for (const tgt of targets) {
        let best = null;
        let bestD = 42;
        for (const tip of tips) {
          const d = Math.hypot(tip.x - tgt.x, tip.z - tgt.z);
          if (d < bestD && d > 1.5) {
            bestD = d;
            best = tip;
          }
        }
        if (!best) continue;
        const y0 = best.y;
        const y1 = terrainHeightAt(tgt.x, tgt.z, stations) + 0.14;
        const w = Math.max(best.w, Math.min(12, br.widthM || 8));
        ribbons.push({
          pts: densifyRun(
            [
              { x: best.x, z: best.z, y: y0 },
              { x: tgt.x, z: tgt.z, y: y1 },
            ],
            10,
          ),
          halfW: w * 0.5,
          color: best.color || "#505660",
          major: true,
          medium: false,
          pathLike: false,
          hw: "primary",
        });
        pushJunction(junctionNodes, {
          x: tgt.x,
          z: tgt.z,
          y: y1,
          w,
          color: best.color || "#505660",
        });
        pushJunction(junctionNodes, {
          x: best.x,
          z: best.z,
          y: best.y,
          w,
          color: best.color || "#505660",
        });
        links++;
      }
    }
  }
  return links;
}

function pushJunction(list, node) {
  for (const n of list) {
    if (Math.hypot(n.x - node.x, n.z - node.z) < 8) {
      n.x = (n.x * n._wSum + node.x * node.w) / (n._wSum + node.w);
      n.z = (n.z * n._wSum + node.z * node.w) / (n._wSum + node.w);
      n.y = Math.max(n.y, node.y);
      n.w = Math.max(n.w, node.w);
      n._wSum += node.w;
      n._count = (n._count || 1) + 1;
      return;
    }
  }
  list.push({ ...node, _wSum: node.w, _count: 1 });
}

function mergeNearbyJunctions(list, distM) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a || a._dead) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b || b._dead) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) > distM) continue;
      const wa = a._wSum || a.w;
      const wb = b._wSum || b.w;
      a.x = (a.x * wa + b.x * wb) / (wa + wb);
      a.z = (a.z * wa + b.z * wb) / (wa + wb);
      a.y = Math.max(a.y, b.y);
      a.w = Math.max(a.w, b.w);
      a._wSum = wa + wb;
      a._count = (a._count || 1) + (b._count || 1);
      b._dead = true;
    }
  }
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i]._dead) continue;
    list[w++] = list[i];
  }
  list.length = w;
}

function nearestHalf(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 180));
  for (let i = 0; i < stations.length; i += step) {
    const st = stations[i];
    const d2 = (st.x - x) ** 2 + (st.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = st;
    }
  }
  const lat = Math.abs((x - best.x) * -best.flowZ + (z - best.z) * best.flowX);
  return { lat, half: best.halfWidth };
}
