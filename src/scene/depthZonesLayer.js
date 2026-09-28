import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { lonLatToLocal } from "../geo/geoReference.js";
import { state } from "../state.js";

/** Configurable lift above sampled terrain / water surface (meters). */
export const GLASSY_WATER_LIFT_M = 0.55;

/**
 * Bathymetry GroundOverlay from src/data/mula_mutha_depth_blueshade_smoothed.kmz
 * (extracted to public/data/bathymetry/). LatLonBox copied from its doc.kml.
 */
export const BATHYMETRY_OVERLAY = {
  url: "/data/bathymetry/mula_mutha_depth_overlay.png",
  legendUrl: "/data/bathymetry/depth_legend.png",
  north: 18.54735962,
  south: 18.52083962,
  east: 73.99281512,
  west: 73.85517512,
  minDepth: 1.53,
  maxDepth: 2.0,
};

/** Legend ramp sampled from the KMZ depth_legend.png, shallow → deep. */
export const BATHYMETRY_RAMP = [
  "#abd5f8", "#95bbe3", "#7d9fcc", "#6582b6", "#4e669f", "#364a89", "#1e2d72", "#06115b",
];

const PICK_MIN_ALPHA = 40;
const GRID_SEG_X = 420;
const GRID_SEG_Z = 84;

/**
 * Raster bathymetry layer — KMZ image draped just above the river surface.
 * Exposes the same userData API the old depth-zone polygon layer did.
 */
export function createDepthZonesLayer(dataset) {
  const group = new THREE.Group();
  group.name = "depthZones";
  group.visible = false;

  const stations = dataset.corridor?.stations || [];
  const box = BATHYMETRY_OVERLAY;

  const geometry = buildDrapedGrid(box, stations);
  const texture = new THREE.TextureLoader().load(`${box.url}?v=blueshade`, (tex) => {
    pixels = readPixels(tex.image);
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uOpacity: { value: 1 },
      uReveal: { value: 1 },
      uHighlight: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uOpacity;
      uniform float uReveal;
      uniform float uHighlight;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(uMap, vUv);
        // KMZ alpha peaks ~0.7 — lift it so the depth ramp reads over the water.
        float a = clamp(c.a * 1.45, 0.0, 1.0);
        if (a < 0.02) discard;
        float edge = uReveal * 1.08;
        float mask = 1.0 - smoothstep(edge - 0.08, edge, vUv.x);
        vec3 col = c.rgb * (1.0 + uHighlight * 0.25);
        gl_FragColor = vec4(col, a * uOpacity * mask);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "bathymetryOverlay";
  mesh.renderOrder = 8;
  mesh.frustumCulled = false;
  group.add(mesh);

  const selectRing = new THREE.Mesh(
    new THREE.RingGeometry(4, 6.5, 40),
    new THREE.MeshBasicMaterial({
      color: 0xb8f0ff,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  selectRing.rotation.x = -Math.PI / 2;
  selectRing.visible = false;
  selectRing.renderOrder = 10;
  group.add(selectRing);

  /** @type {{ data: Uint8ClampedArray, width: number, height: number } | null} */
  let pixels = null;
  let revealT = 1;

  group.userData.stats = {
    source: "mula_mutha_depth_blueshade_smoothed.kmz",
    raster: true,
    polygons: 0,
    built: 1,
    classes: BATHYMETRY_RAMP.length,
    depthRange: [box.minDepth, box.maxDepth],
  };
  group.userData.material = material;
  group.userData.meshes = [mesh];

  group.userData.setVisible = (on) => {
    group.visible = !!on;
  };

  group.userData.setSelected = (feat) => {
    material.uniforms.uHighlight.value = feat ? 1 : 0;
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

  /** Depth (m) at a local XZ point, read from the KMZ raster colour. */
  group.userData.sampleAt = (x, z) => {
    if (!pixels || !dataset.frame?.toLonLat) return null;
    const { lon, lat } = dataset.frame.toLonLat(x, z);
    const u = (lon - box.west) / (box.east - box.west);
    const v = (box.north - lat) / (box.north - box.south);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const px = Math.min(pixels.width - 1, Math.floor(u * pixels.width));
    const py = Math.min(pixels.height - 1, Math.floor(v * pixels.height));
    const i = (py * pixels.width + px) * 4;
    const d = pixels.data;
    if (d[i + 3] < PICK_MIN_ALPHA) return null;
    const depth = colorToDepth(d[i], d[i + 1], d[i + 2], box.minDepth, box.maxDepth);
    return { depth, lon, lat };
  };

  group.userData.update = (dt) => {
    if (!group.visible) return;
    material.uniforms.uOpacity.value = Math.max(0.55, state.glassyWaterOpacity ?? 0.9);
    if (state.glassyRevealActive || revealT < 1) {
      revealT = Math.min(1, revealT + dt * 0.45);
      material.uniforms.uReveal.value = revealT;
      if (revealT >= 1) state.glassyRevealActive = false;
    }
  };

  console.info("Bathymetry raster layer (KMZ)", group.userData.stats);
  return group;
}

/** Pick the bathymetry depth under a local XZ point. */
export function pickDepthZoneAt(group, x, z) {
  const hit = group?.userData?.sampleAt?.(x, z);
  if (!hit) return null;
  const { minDepth, maxDepth } = BATHYMETRY_OVERLAY;
  const n = BATHYMETRY_RAMP.length - 1;
  const step = (maxDepth - minDepth) / n;
  const k = Math.min(n - 1, Math.max(0, Math.floor((hit.depth - minDepth) / step)));
  const lo = minDepth + k * step;
  const hi = lo + step;
  return {
    id: `bathy-${Math.round(x)}-${Math.round(z)}`,
    name: "Bathymetry (KMZ raster)",
    depthClass: `${lo.toFixed(2)}–${hi.toFixed(2)}`,
    depthMin: lo,
    depthMax: hi,
    depthMid: hit.depth,
    x,
    z,
    lon: hit.lon,
    lat: hit.lat,
  };
}

function buildDrapedGrid(box, stations) {
  const nx = GRID_SEG_X;
  const nz = GRID_SEG_Z;
  const count = (nx + 1) * (nz + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let p = 0;
  let q = 0;
  for (let j = 0; j <= nz; j++) {
    const v = j / nz;
    const lat = box.south + v * (box.north - box.south);
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const lon = box.west + u * (box.east - box.west);
      const loc = lonLatToLocal(lon, lat);
      pos[p++] = loc.x;
      pos[p++] = waterYAt(loc.x, loc.z, stations);
      pos[p++] = loc.z;
      uv[q++] = u;
      uv[q++] = v;
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function readPixels(image) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    return { data, width: image.width, height: image.height };
  } catch (err) {
    console.warn("[bathymetry] pixel read failed", err?.message || err);
    return null;
  }
}

const RAMP_RGB = BATHYMETRY_RAMP.map((h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]);

/** Project an RGB colour onto the legend ramp → depth in metres. */
function colorToDepth(r, g, b, minDepth, maxDepth) {
  let best = 0;
  let bestD = Infinity;
  const steps = 64;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const f = t * (RAMP_RGB.length - 1);
    const k = Math.min(RAMP_RGB.length - 2, Math.floor(f));
    const w = f - k;
    const c0 = RAMP_RGB[k];
    const c1 = RAMP_RGB[k + 1];
    const dr = c0[0] + (c1[0] - c0[0]) * w - r;
    const dg = c0[1] + (c1[1] - c0[1]) * w - g;
    const db = c0[2] + (c1[2] - c0[2]) * w - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return minDepth + best * (maxDepth - minDepth);
}

function waterYAt(x, z, stations) {
  if (stations?.length) {
    const ty = terrainHeightAt(x, z, stations);
    return Math.max(ty, SURFACE_Y) + GLASSY_WATER_LIFT_M;
  }
  return SURFACE_Y + GLASSY_WATER_LIFT_M;
}
