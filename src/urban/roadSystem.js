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
 */
export function createRoadSystem(dataset) {
  const group = new THREE.Group();
  group.name = "roads";
  const stations = dataset.corridor.stations;
  const roads = dataset.osm?.roads || [];
  if (!roads.length) return group;

  const bridges = dataset.bridges || [];
  const asphaltSegs = [];
  const shoulderSegs = [];
  const edgeSegs = [];
  const dashSegs = [];
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

    for (let i = 1; i < verts.length; i++) {
      const a = verts[i - 1];
      const b = verts[i];
      const mx = (a.x + b.x) * 0.5;
      const mz = (a.z + b.z) * 0.5;
      const bank = nearestHalf(mx, mz, stations);
      // Skip only segments inside the navigable channel — not the full KML floodplain polygon
      const overWater = bank.lat < bank.half * 0.82;
      if (overWater) {
        skippedWater++;
        continue;
      }
      // Also skip stubs that sit on an existing bridge mid
      if (bridges.some((br) => Math.hypot((br.midX ?? 0) - mx, (br.midZ ?? 0) - mz) < 55)) {
        skippedWater++;
        continue;
      }

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1.5) continue;

      const y0 = terrainHeightAt(a.x, a.z, stations);
      const y1 = terrainHeightAt(b.x, b.z, stations);
      const y = Math.max(y0, y1) + 0.12;
      const rot = Math.atan2(dx, dz);

      asphaltSegs.push({
        x: mx,
        z: mz,
        y,
        len,
        w: pathLike ? Math.min(deckW, 2.8) : deckW,
        rot,
        highway: hw,
        major,
        medium,
        pathLike,
        color: ASPHALT[hw] || "#5a6068",
      });

      if (major || medium) {
        // Concrete shoulders / curb strips
        const shoulderW = major ? 0.55 : 0.35;
        for (const side of [-1, 1]) {
          const ox = Math.cos(rot) * side * (w * 0.5 + shoulderW * 0.45);
          const oz = -Math.sin(rot) * side * (w * 0.5 + shoulderW * 0.45);
          shoulderSegs.push({
            x: mx + ox,
            z: mz + oz,
            y: y + 0.02,
            len: len * 0.98,
            w: shoulderW,
            rot,
          });
        }
      }

      if (major) {
        // White edge lines
        for (const side of [-1, 1]) {
          const ox = Math.cos(rot) * side * (w * 0.42);
          const oz = -Math.sin(rot) * side * (w * 0.42);
          edgeSegs.push({
            x: mx + ox,
            z: mz + oz,
            y: y + 0.08,
            len: len * 0.94,
            w: 0.18,
            rot,
          });
        }
        // Dashed center line (skip short stubs)
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
        // Faint dashed center on residential collectors
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
  }

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
    // Slightly thicker major roads so they read from overview
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
    shoulders: shoulderSegs.length,
    edges: edgeSegs.length,
    dashes: dashSegs.length,
    skippedWater,
  });
  return group;
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
