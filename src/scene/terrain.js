import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { computeSceneBounds } from "../geo/sceneBounds.js";

/**
 * Smooth corridor terrain — covers full KML + OSM union with geographic padding.
 */
export function createTerrain(dataset) {
  const b = computeSceneBounds(dataset);
  // 18% padding — fills camera frustum without blank edges
  const pad = Math.max(b.spanX, b.spanZ) * 0.18;
  const width = b.spanX + pad * 2;
  const depth = b.spanZ + pad * 2;
  const geo = new THREE.PlaneGeometry(width, depth, 280, 140);
  geo.rotateX(-Math.PI / 2);
  geo.translate(b.cx, 0, b.cz);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const stations = dataset.corridor.stations;
  const cGrass = new THREE.Color("#6a8664");
  const cOlive = new THREE.Color("#7e9a68");
  const cEarth = new THREE.Color("#8f7a58");
  const cStone = new THREE.Color("#a89878");
  const cBank = new THREE.Color("#6e5c40");
  const cWet = new THREE.Color("#5a7454");
  const cSand = new THREE.Color("#a89068");
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z, stations);
    pos.setY(i, y);

    const near = nearest(x, z, stations);
    const lat = near.lat;
    const half = near.st.halfWidth;
    const hn = THREE.MathUtils.clamp((y - (SURFACE_Y - 2)) / 28, 0, 1);
    const slopeHint = fbm(x * 0.0025, z * 0.0025);
    tmp.copy(cWet).lerp(cGrass, smooth(hn, 0.04, 0.28));
    tmp.lerp(cOlive, smooth(hn, 0.26, 0.55));
    tmp.lerp(cEarth, smooth(hn, 0.48, 0.78));
    tmp.lerp(cStone, smooth(hn, 0.7, 1) * (0.25 + slopeHint * 0.3));
    if (lat < half * 2.2) tmp.lerp(cBank, (1 - lat / (half * 2.2)) * 0.38);
    if (lat < half * 1.3) tmp.lerp(cSand, 0.24 * (1 - lat / (half * 1.3)));
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
      roughness: 0.92,
      metalness: 0.02,
    }),
  );
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "terrain";

  const outline = kmlOutline(dataset.ringLocal);
  outline.visible = false;
  return { mesh, outline, bounds: b };
}

function boundsFromRing(ringLocal) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of ringLocal || []) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z);
    maxZ = Math.max(maxZ, c.z);
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    spanX: maxX - minX,
    spanZ: maxZ - minZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
  };
}

function mergeBounds(a, b) {
  const minX = Math.min(a.minX, b.minX);
  const maxX = Math.max(a.maxX, b.maxX);
  const minZ = Math.min(a.minZ, b.minZ);
  const maxZ = Math.max(a.maxZ, b.maxZ);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    spanX: maxX - minX,
    spanZ: maxZ - minZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
  };
}

function heightAt(x, z, stations) {
  const near = nearest(x, z, stations);
  const lat = near.lat;
  const half = Math.max(12, near.st.halfWidth);

  const hills =
    fbm(x * 0.00045, z * 0.00045) * 18 +
    fbm(x * 0.0012 + 4, z * 0.0012) * 8 +
    fbm(x * 0.003 + 9, z * 0.003) * 3;
  const bankFalloff = THREE.MathUtils.smoothstep(lat / (half * 3.5), 0.35, 1);
  const base = SURFACE_Y + 2 + hills * bankFalloff;

  // Carve river channel deep below water so terrain never shows as "patches" through surface
  if (lat < half * 0.98) {
    const u = lat / (half * 0.98);
    // Edge shallow shelf → deep center (always well below SURFACE_Y)
    const channelY = THREE.MathUtils.lerp(SURFACE_Y - 1.2, SURFACE_Y - 14, THREE.MathUtils.smoothstep(0, 1, 1 - u));
    return channelY;
  }
  // Soft bank blend just outside water edge
  if (lat < half * 1.35) {
    const t = (lat - half * 0.98) / (half * 0.37);
    return THREE.MathUtils.lerp(SURFACE_Y - 1.2, base, THREE.MathUtils.smoothstep(0, 1, t));
  }
  return base;
}

export function terrainHeightAt(x, z, stations) {
  return heightAt(x, z, stations);
}

function nearest(x, z, stations) {
  let bestI = 0;
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 300));
  for (let i = 0; i < stations.length; i += step) {
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
