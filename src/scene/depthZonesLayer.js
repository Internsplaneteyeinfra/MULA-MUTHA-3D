import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { createGlassyWaterMaterial, setGlassyMode } from "./glassyWaterMaterial.js";
import { state } from "../state.js";

/** Configurable lift above sampled terrain / water surface (meters). */
export const GLASSY_WATER_LIFT_M = 0.28;

/**
 * Cinematic glassy depth-zone layer from Jul 2026 KML polygons.
 * Real lon/lat → local frame unchanged; one shared shader; animate uTime only.
 */
export function createDepthZonesLayer(dataset) {
  const group = new THREE.Group();
  group.name = "depthZones";
  group.visible = false;

  const zones = dataset.depthZones || [];
  const stations = dataset.corridor?.stations || [];
  if (!zones.length) {
    group.userData.stats = { polygons: 0, classes: 0 };
    group.userData.update = () => {};
    group.userData.setSelected = () => {};
    return group;
  }

  const minD = Math.min(...zones.map((z) => z.depthMin ?? 1.5));
  const maxD = Math.max(...zones.map((z) => z.depthMax ?? 2.0));

  const material = createGlassyWaterMaterial({
    minDepth: minD,
    maxDepth: maxD,
    opacity: state.glassyWaterOpacity ?? 0.72,
    flowSpeed: state.glassyFlowSpeed ?? 0.45,
  });

  /** @type {Map<string, { geos: THREE.BufferGeometry[], meta: object[] }>} */
  const buckets = new Map();
  const classCounts = new Map();
  const featureIndex = [];

  for (let zi = 0; zi < zones.length; zi++) {
    const z = zones[zi];
    const verts = z.vertices;
    if (!verts || verts.length < 4) continue;
    const geo = polygonToTerrainGeometry(verts, stations, z.depthMid ?? 1.7, z.fillOpacity ?? 0.55);
    if (!geo) continue;

    const cls = z.depthClass || "1.5-1.6";
    if (!buckets.has(cls)) buckets.set(cls, { geos: [], meta: [] });
    buckets.get(cls).geos.push(geo);
    buckets.get(cls).meta.push(z);
    classCounts.set(cls, (classCounts.get(cls) || 0) + 1);

    let cx = 0;
    let cz = 0;
    for (const v of verts) {
      cx += v.x;
      cz += v.z;
    }
    cx /= verts.length;
    cz /= verts.length;
    featureIndex.push({
      id: zi,
      depthClass: cls,
      depthMin: z.depthMin,
      depthMax: z.depthMax,
      depthMid: z.depthMid,
      areaM2: z.areaM2,
      fillOpacity: z.fillOpacity,
      name: z.name,
      description: z.description,
      lon: verts[0]?.lon,
      lat: verts[0]?.lat,
      x: cx,
      z: cz,
      vertices: verts,
    });
  }

  const meshes = [];
  for (const [cls, bucket] of buckets) {
    if (!bucket.geos.length) continue;
    let merged;
    try {
      merged = mergeGeometries(bucket.geos, false);
    } catch {
      merged = null;
    }
    for (const g of bucket.geos) g.dispose();
    if (!merged) continue;

    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `glassyDepth_${cls}`;
    mesh.renderOrder = 4;
    mesh.userData.depthClass = cls;
    mesh.userData.pickable = true;
    group.add(mesh);
    meshes.push(mesh);
  }

  const particles = createGlassParticles(featureIndex, stations);
  group.add(particles.points);

  // Soft outline for data-analysis mode
  const outlineGroup = new THREE.Group();
  outlineGroup.name = "depthZoneOutlines";
  outlineGroup.visible = false;
  for (const f of featureIndex) {
    if (!f.vertices?.length) continue;
    const pts = f.vertices.map(
      (v) => new THREE.Vector3(v.x, waterYAt(v.x, v.z, stations) + 0.04, v.z),
    );
    if (pts.length > 1) pts.push(pts[0].clone());
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: 0xa8e8ff,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    line.renderOrder = 5;
    outlineGroup.add(line);
  }
  group.add(outlineGroup);

  let revealT = 0;
  let selectedId = null;
  const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(4, 6.5, 40),
    new THREE.MeshBasicMaterial({
      color: 0xb8f0ff,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  selectRing.rotation.x = -Math.PI / 2;
  selectRing.visible = false;
  selectRing.renderOrder = 6;
  group.add(selectRing);

  group.userData.stats = {
    polygons: zones.length,
    classes: classCounts.size,
    byClass: Object.fromEntries(classCounts),
    glassy: true,
  };
  group.userData.featureIndex = featureIndex;
  group.userData.material = material;
  group.userData.meshes = meshes;

  group.userData.setSelected = (feat) => {
    selectedId = feat?.id ?? null;
    material.uniforms.uHighlight.value = feat ? 0.55 : 0;
    if (feat) {
      selectRing.visible = true;
      selectRing.position.set(feat.x, waterYAt(feat.x, feat.z, stations) + 0.5, feat.z);
    } else {
      selectRing.visible = false;
    }
  };

  group.userData.playReveal = () => {
    revealT = 0;
    material.uniforms.uReveal.value = 0;
  };

  group.userData.update = (dt) => {
    if (!group.visible) return;
    const t = state.elapsed || 0;
    material.uniforms.uTime.value = t;
    material.uniforms.uFlowSpeed.value = state.glassyFlowSpeed ?? 0.45;
    material.uniforms.uOpacity.value = state.glassyWaterOpacity ?? 0.72;
    setGlassyMode(material, state.glassyVizMode === "data" ? "data" : "cinematic");
    outlineGroup.visible = state.glassyVizMode === "data";
    particles.points.visible = !!(state.glassyAnimatedFlow && state.glassyVizMode !== "data");

    // Reveal phase when layer turns on
    if (state.glassyRevealActive) {
      revealT = Math.min(1, revealT + dt * 0.35);
      material.uniforms.uReveal.value = revealT;
      if (revealT >= 1) state.glassyRevealActive = false;
    } else if (material.uniforms.uReveal.value < 1) {
      material.uniforms.uReveal.value = 1;
    }

    if (particles.points.visible) particles.update(dt, t);
  };

  console.info("Glassy depth zones layer", group.userData.stats);
  return group;
}

/** Point-in-polygon pick for depth features (XZ). */
export function pickDepthZoneAt(group, x, z) {
  const feats = group?.userData?.featureIndex;
  if (!feats?.length) return null;
  let best = null;
  let bestD = Infinity;
  for (const f of feats) {
    if (!pointInPolyXZ(x, z, f.vertices)) continue;
    const d = (f.x - x) ** 2 + (f.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

function polygonToTerrainGeometry(verts, stations, depthMid, fillOpacity) {
  try {
    const shape = new THREE.Shape();
    shape.moveTo(verts[0].x, -verts[0].z);
    for (let i = 1; i < verts.length; i++) {
      shape.lineTo(verts[i].x, -verts[i].z);
    }
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const n = pos.count;
    const depths = new Float32Array(n);
    const opacities = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = waterYAt(x, z, stations);
      pos.setY(i, y);
      depths[i] = depthMid;
      opacities[i] = fillOpacity;
    }
    pos.needsUpdate = true;
    geo.setAttribute("aDepth", new THREE.BufferAttribute(depths, 1));
    geo.setAttribute("aOpacity", new THREE.BufferAttribute(opacities, 1));
    geo.computeVertexNormals();
    return geo;
  } catch {
    return null;
  }
}

function waterYAt(x, z, stations) {
  if (stations?.length) {
    const ty = terrainHeightAt(x, z, stations);
    // Stay just above terrain / channel without fighting the river surface
    return Math.max(ty, SURFACE_Y - 0.6) + GLASSY_WATER_LIFT_M;
  }
  return SURFACE_Y + GLASSY_WATER_LIFT_M;
}

function pointInPolyXZ(x, z, verts) {
  if (!verts || verts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x;
    const zi = verts[i].z;
    const xj = verts[j].x;
    const zj = verts[j].z;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function createGlassParticles(features, stations) {
  const maxN = Math.min(220, Math.max(40, features.length * 2));
  const positions = new Float32Array(maxN * 3);
  const seeds = new Float32Array(maxN);
  const anchors = [];

  for (let i = 0; i < maxN; i++) {
    const f = features[i % features.length];
    const ang = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 8;
    const x = f.x + Math.cos(ang) * r;
    const z = f.z + Math.sin(ang) * r;
    const y = waterYAt(x, z, stations) + 0.15;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    seeds[i] = Math.random();
    anchors.push({ x: f.x, z: f.z, seed: seeds[i] });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xb8f4ff,
    size: 1.8,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.name = "glassyParticles";
  points.renderOrder = 5;
  points.frustumCulled = false;

  function update(dt, time) {
    const pos = geo.attributes.position;
    const speed = (state.glassyFlowSpeed ?? 0.45) * 4.5;
    for (let i = 0; i < maxN; i++) {
      const a = anchors[i];
      const phase = time * speed * (0.4 + a.seed) + a.seed * 20;
      const ox = Math.sin(phase) * 6 + Math.cos(phase * 0.37) * 2;
      const oz = Math.cos(phase * 0.85) * 5;
      const x = a.x + ox;
      const z = a.z + oz;
      pos.setXYZ(i, x, waterYAt(x, z, stations) + 0.12 + Math.sin(phase) * 0.08, z);
      // Fade cycle via material opacity already global; drift seed for variety
    }
    pos.needsUpdate = true;
    mat.opacity = 0.22 + 0.12 * Math.sin(time * 0.7);
  }

  return { points, update };
}
