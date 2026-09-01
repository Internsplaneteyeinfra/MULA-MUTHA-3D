import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { computeSceneBounds } from "../geo/sceneBounds.js";

let activeDtm = null;

/**
 * FABDEM DTM terrain when available; procedural fallback otherwise.
 * Covers full KML + OSM union with geographic padding.
 */
export function createTerrain(dataset) {
  activeDtm = dataset.dtm || null;
  const b = computeSceneBounds(dataset);
  const pad = Math.max(b.spanX, b.spanZ) * 0.18;
  const width = b.spanX + pad * 2;
  const depth = b.spanZ + pad * 2;
  const segsX = activeDtm ? 360 : 280;
  const segsZ = activeDtm ? 180 : 140;
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
  const cBank = new THREE.Color("#6e5c40");
  const cWet = new THREE.Color("#4a6450");
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const y = heights[i];
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const near = nearest(x, z, stations);
    const lat = near.lat;
    const half = near.st.halfWidth;

    if (activeDtm) {
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

  const outline = kmlOutline(dataset.ringLocal);
  outline.visible = false;
  return { mesh, outline, bounds: b };
}

function heightAt(x, z, stations, dtm = activeDtm) {
  const near = nearest(x, z, stations);
  const lat = near.lat;
  const half = Math.max(12, near.st.halfWidth);
  const dtmY = dtm?.sampleSceneXY?.(x, z) ?? null;

  const hills =
    fbm(x * 0.00045, z * 0.00045) * 18 +
    fbm(x * 0.0012 + 4, z * 0.0012) * 8 +
    fbm(x * 0.003 + 9, z * 0.003) * 3;
  const bankFalloff = THREE.MathUtils.smoothstep(lat / (half * 3.5), 0.35, 1);
  const proceduralBase = SURFACE_Y + 2 + hills * bankFalloff;
  const landY = dtmY ?? proceduralBase;

  // Only carve the wet channel — keep banks and surrounding hills at full DTM height
  if (lat < half * 0.72) {
    const u = lat / (half * 0.72);
    const channelY = THREE.MathUtils.lerp(
      SURFACE_Y - 0.8,
      SURFACE_Y - 16,
      THREE.MathUtils.smoothstep(0, 1, 1 - u),
    );
    if (dtmY != null) return Math.min(dtmY, channelY);
    return channelY;
  }

  if (dtmY != null) {
    // Narrow shelf: ensure banks sit above water without flattening DTM relief
    if (lat < half * 1.05) {
      return Math.max(dtmY, SURFACE_Y + 0.35);
    }
    return dtmY;
  }

  if (lat < half * 1.35) {
    const t = (lat - half * 0.72) / (half * 0.63);
    return THREE.MathUtils.lerp(SURFACE_Y - 0.8, proceduralBase, THREE.MathUtils.smoothstep(0, 1, t));
  }
  return proceduralBase;
}

export function terrainHeightAt(x, z, stations) {
  const near = nearest(x, z, stations);
  const lat = near.lat;
  const half = Math.max(12, near.st.halfWidth);
  const dtmY = activeDtm?.sampleSceneXY?.(x, z) ?? null;

  // Buildings/roads/trees: use real DTM on land, only sink under water center
  if (dtmY != null) {
    if (lat < half * 0.72) return Math.min(dtmY, SURFACE_Y - 1);
    if (lat < half * 1.05) return Math.max(dtmY, SURFACE_Y + 0.35);
    return dtmY;
  }
  return heightAt(x, z, stations, activeDtm);
}

function nearest(x, z, stations) {
  let bestI = 0;
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 400));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  // Refine locally for accurate lateral distance
  for (let i = Math.max(0, bestI - 12); i <= Math.min(stations.length - 1, bestI + 12); i++) {
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
