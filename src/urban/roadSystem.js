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
 * Terrain-following OSM roads: asphalt deck, shoulders, edge lines, dashed center.
 * Endpoint snapping + junction discs + bridge approach links for continuous alignment.
 */
export function createRoadSystem(dataset) {
  const group = new THREE.Group();
  group.name = "roads";
  const stations = dataset.corridor.stations;
  const rawRoads = dataset.osm?.roads || [];
  if (!rawRoads.length) return group;

  const bridges = dataset.bridges || [];
  // Mutate local copies so we can snap endpoints without touching the dataset permanently
  const roads = rawRoads.map((r) => ({
    ...r,
    vertices: (r.vertices || []).map((v) => ({ ...v })),
  }));
  snapRoadNetwork(roads, 12);

  const asphaltSegs = [];
  const shoulderSegs = [];
  const edgeSegs = [];
  const dashSegs = [];
  const junctionNodes = [];
  /** Road tips used to stitch into bridges. */
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

    const vertUsed = new Array(verts.length).fill(false);

    for (let i = 1; i < verts.length; i++) {
      const a = verts[i - 1];
      const b = verts[i];
      const mx = (a.x + b.x) * 0.5;
      const mz = (a.z + b.z) * 0.5;
      const bank = nearestHalf(mx, mz, stations);
      // Only skip true mid-channel segments — keep bank approaches for bridge joins
      const overWater = bank.lat < bank.half * 0.72;
      if (overWater) {
        skippedWater++;
        continue;
      }
      // Skip only the span under an existing bridge deck (not the land approaches)
      if (isUnderBridgeDeck(mx, mz, bridges, stations)) {
        skippedWater++;
        continue;
      }

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1.0) continue;

      const y0 = terrainHeightAt(a.x, a.z, stations);
      const y1 = terrainHeightAt(b.x, b.z, stations);
      const y = Math.max(y0, y1) + 0.12;
      const rot = Math.atan2(dx, dz);

      // Stronger overlap so corners never show green wedges
      const joinPad = Math.min(segW * 1.15, Math.max(1.8, len * 0.45));
      const drawLen = len + joinPad;

      asphaltSegs.push({
        x: mx,
        z: mz,
        y,
        len: drawLen,
        w: segW,
        rot,
        highway: hw,
        major,
        medium,
        pathLike,
        color,
      });
      vertUsed[i - 1] = true;
      vertUsed[i] = true;

      if (major || medium) {
        const shoulderW = major ? 0.55 : 0.35;
        for (const side of [-1, 1]) {
          const ox = Math.cos(rot) * side * (w * 0.5 + shoulderW * 0.45);
          const oz = -Math.sin(rot) * side * (w * 0.5 + shoulderW * 0.45);
          shoulderSegs.push({
            x: mx + ox,
            z: mz + oz,
            y: y + 0.02,
            len: drawLen * 0.96,
            w: shoulderW,
            rot,
          });
        }
      }

      if (major) {
        for (const side of [-1, 1]) {
          const ox = Math.cos(rot) * side * (w * 0.42);
          const oz = -Math.sin(rot) * side * (w * 0.42);
          edgeSegs.push({
            x: mx + ox,
            z: mz + oz,
            y: y + 0.08,
            len: len * 0.9,
            w: 0.18,
            rot,
          });
        }
        if (len > 6) {
          const dashLen = 2.8;
          const gap = 2.2;
          const n = Math.max(1, Math.floor(len / (dashLen + gap)));
          const ux = dx / len;
          const uz = dz / len;
          const startX = a.x + ux * (gap * 0.5);
          const startZ = a.z + uz * (gap * 0.5);
          for (let d = 0; d < n; d++) {
            const t = d * (dashLen + gap) + dashLen * 0.5;
            if (t > len - 1) break;
            dashSegs.push({
              x: startX + ux * t,
              z: startZ + uz * t,
              y: y + 0.09,
              len: Math.min(dashLen, len - t),
              w: 0.22,
              rot,
            });
          }
        }
      } else if (medium && len > 10) {
        const dashLen = 2.2;
        const gap = 3.5;
        const n = Math.max(1, Math.floor(len / (dashLen + gap)));
        const ux = dx / len;
        const uz = dz / len;
        for (let d = 0; d < n; d++) {
          const t = d * (dashLen + gap) + dashLen * 0.5;
          if (t > len - 1) break;
          dashSegs.push({
            x: a.x + ux * t,
            z: a.z + uz * t,
            y: y + 0.08,
            len: Math.min(dashLen, len - t),
            w: 0.14,
            rot,
          });
        }
      }
    }

    for (let i = 0; i < verts.length; i++) {
      if (!vertUsed[i]) continue;
      const v = verts[i];
      const bank = nearestHalf(v.x, v.z, stations);
      if (bank.lat < bank.half * 0.72) continue;
      const y = terrainHeightAt(v.x, v.z, stations) + 0.11;
      pushJunction(junctionNodes, { x: v.x, z: v.z, y, w: segW, color });
      if (i === 0 || i === verts.length - 1) {
        roadTips.push({ x: v.x, z: v.z, y, w: segW, color, major, medium });
      }
    }
  }

  // Stitch roads into bridge approaches so land asphalt meets the deck ramps
  const approachLinks = linkRoadsToBridges(roadTips, bridges, stations, asphaltSegs, junctionNodes);
  mergeNearbyJunctions(junctionNodes, 18);

  if (!asphaltSegs.length) return group;

  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, 0.5, 0);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // —— Asphalt deck ——
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: "#5c6268",
    roughness: 0.96,
    metalness: 0.02,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const asphalt = new THREE.InstancedMesh(unit, asphaltMat, asphaltSegs.length);
  asphalt.name = "roadAsphalt";
  asphalt.receiveShadow = true;
  asphalt.castShadow = false;
  asphalt.frustumCulled = false;
  for (let i = 0; i < asphaltSegs.length; i++) {
    const s = asphaltSegs[i];
    dummy.position.set(s.x, s.y, s.z);
    dummy.rotation.set(0, s.rot, 0);
    const h = s.major ? 0.22 : s.pathLike ? 0.08 : s.medium ? 0.14 : 0.11;
    dummy.scale.set(s.w, h, s.len);
    dummy.updateMatrix();
    asphalt.setMatrixAt(i, dummy.matrix);
    color.set(s.color);
    asphalt.setColorAt(i, color);
  }
  asphalt.instanceMatrix.needsUpdate = true;
  if (asphalt.instanceColor) asphalt.instanceColor.needsUpdate = true;
  group.add(asphalt);

  // —— Junction discs (fill corner / intersection gaps) ——
  if (junctionNodes.length) {
    const discGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
    discGeo.translate(0, 0.5, 0);
    const discMat = new THREE.MeshStandardMaterial({
      color: "#5c6268",
      roughness: 0.96,
      metalness: 0.02,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const discs = new THREE.InstancedMesh(discGeo, discMat, junctionNodes.length);
    discs.name = "roadJunctions";
    discs.receiveShadow = true;
    discs.frustumCulled = false;
    for (let i = 0; i < junctionNodes.length; i++) {
      const n = junctionNodes[i];
      dummy.position.set(n.x, n.y, n.z);
      dummy.rotation.set(0, 0, 0);
      const d = Math.max(2.6, n.w * 1.25);
      dummy.scale.set(d, 0.14, d);
      dummy.updateMatrix();
      discs.setMatrixAt(i, dummy.matrix);
      color.set(n.color || "#5c6268");
      discs.setColorAt(i, color);
    }
    discs.instanceMatrix.needsUpdate = true;
    if (discs.instanceColor) discs.instanceColor.needsUpdate = true;
    group.add(discs);
  }

  // —— Shoulders ——
  if (shoulderSegs.length) {
    const shoulderMat = new THREE.MeshStandardMaterial({
      color: "#a8a098",
      roughness: 0.9,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const shoulders = new THREE.InstancedMesh(unit, shoulderMat, shoulderSegs.length);
    shoulders.name = "roadShoulders";
    shoulders.receiveShadow = true;
    shoulders.frustumCulled = false;
    for (let i = 0; i < shoulderSegs.length; i++) {
      const s = shoulderSegs[i];
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.scale.set(s.w, 0.14, s.len);
      dummy.updateMatrix();
      shoulders.setMatrixAt(i, dummy.matrix);
    }
    shoulders.instanceMatrix.needsUpdate = true;
    group.add(shoulders);
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
    asphalt: asphaltSegs.length,
    junctions: junctionNodes.length,
    bridgeLinks: approachLinks,
    shoulders: shoulderSegs.length,
    edges: edgeSegs.length,
    dashes: dashSegs.length,
    skippedWater,
  });
  return group;
}

/** Snap nearby OSM endpoints / T-junctions so segments share the same XZ. */
function snapRoadNetwork(roads, snapM) {
  const ends = [];
  for (const road of roads) {
    const v = road.vertices;
    if (!v || v.length < 2) continue;
    ends.push(v[0], v[v.length - 1]);
  }
  // Endpoint ↔ endpoint
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
  // Endpoint ↔ interior vertex (T-junctions)
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

/** True only for the elevated bridge span over water — not land approaches. */
function isUnderBridgeDeck(x, z, bridges, stations) {
  if (!bridges?.length) return false;
  const bank = nearestHalf(x, z, stations);
  if (bank.lat > bank.half * 0.95) return false; // on land → keep road
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
 * Add short asphalt links from nearest road tips to each bridge abutment / ramp toe.
 */
function linkRoadsToBridges(tips, bridges, stations, asphaltSegs, junctionNodes) {
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
      // Ramp toe sits ~28 m landward from abutment along bridge axis
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
        const mx = (best.x + tgt.x) * 0.5;
        const mz = (best.z + tgt.z) * 0.5;
        const len = Math.hypot(best.x - tgt.x, best.z - tgt.z);
        const y =
          Math.max(best.y, terrainHeightAt(tgt.x, tgt.z, stations) + 0.12) + 0.02;
        const w = Math.max(best.w, Math.min(12, br.widthM || 8));
        asphaltSegs.push({
          x: mx,
          z: mz,
          y,
          len: len + w * 0.6,
          w,
          rot: Math.atan2(tgt.x - best.x, tgt.z - best.z),
          highway: "primary",
          major: true,
          medium: false,
          pathLike: false,
          color: best.color || "#505660",
        });
        pushJunction(junctionNodes, {
          x: tgt.x,
          z: tgt.z,
          y,
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

/** Add or merge a junction into the list (within 8 m). */
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

/** Second pass: pull nearby nodes from different OSM ways into one intersection. */
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
