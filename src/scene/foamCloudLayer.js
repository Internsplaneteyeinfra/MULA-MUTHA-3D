/**
 * River foam from river_foam.kml.
 * White overlay pixels are foam; each one becomes a cluster of soft white clouds
 * sitting on the water. Blue live-water pixels are left clear.
 */
import * as THREE from "three";
import { lonLatToLocal } from "../geo/geoReference.js";
import { SURFACE_Y } from "./river.js";

const OVERLAY_URL = "/data/hydrology/pollution/foam/overlay.png";
/** LatLonBox of the GroundOverlay in river_foam.kml (north-up image). */
const BOUNDS = {
  north: 18.54727939,
  south: 18.5207626,
  east: 73.99343968,
  west: 73.85496516,
};

/** Offsets in metres around each foam pixel. Varied heights so the bank reads as volume. */
const PUFF_LAYOUT = [
  { ox: 0, oz: 0, y: 3.4, sx: 12.5, sy: 6.8, sz: 11.2, alpha: 0.86 },
  { ox: 6.2, oz: 2.1, y: 5.2, sx: 9.2, sy: 6.4, sz: 8.4, alpha: 0.78 },
  { ox: -5.6, oz: 3.4, y: 6.6, sx: 9.6, sy: 7.0, sz: 8.8, alpha: 0.76 },
  { ox: 2.2, oz: -6.4, y: 4.6, sx: 10.4, sy: 5.8, sz: 9.2, alpha: 0.8 },
  { ox: -3.4, oz: -4.2, y: 8.4, sx: 7.4, sy: 6.2, sz: 7.0, alpha: 0.7 },
  { ox: 5.4, oz: 6.0, y: 10.2, sx: 6.2, sy: 5.4, sz: 5.8, alpha: 0.62 },
  { ox: -7.2, oz: -1.2, y: 4.2, sx: 8.2, sy: 4.6, sz: 7.4, alpha: 0.68 },
  { ox: 1.0, oz: 1.6, y: 12.4, sx: 14.5, sy: 8.2, sz: 13.2, alpha: 0.34 },
  { ox: -4.0, oz: 4.8, y: 9.0, sx: 13.0, sy: 7.4, sz: 12.0, alpha: 0.3 },
  { ox: 4.6, oz: -3.2, y: 7.2, sx: 12.2, sy: 6.6, sz: 11.4, alpha: 0.32 },
];

const vertexShader = /* glsl */ `
#include <common>
attribute float aPhase;
attribute float aAlpha;
uniform float uTime;
varying vec3 vNormalView;
varying vec3 vViewDir;
varying float vAlpha;
void main() {
  float breathe = 1.0 + 0.06 * sin(uTime * 0.8 + aPhase);
  vec3 p = position * breathe;
  vec4 local = vec4(p, 1.0);
  vec3 nObj = normal;
#ifdef USE_INSTANCING
  mat3 im = mat3(instanceMatrix);
  nObj = normalize(transpose(inverse(im)) * normal);
  local = instanceMatrix * local;
#endif
  local.y += sin(uTime * 0.55 + aPhase * 1.35) * 0.45;
  vec4 mvPosition = modelViewMatrix * local;
  vNormalView = normalize(normalMatrix * nObj);
  vViewDir = normalize(-mvPosition.xyz);
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vNormalView;
varying vec3 vViewDir;
varying float vAlpha;
void main() {
  float facing = clamp(dot(normalize(vNormalView), normalize(vViewDir)), 0.0, 1.0);
  float puff = smoothstep(0.0, 0.55, facing);
  vec3 shade = mix(vec3(0.80, 0.88, 0.95), vec3(1.0, 1.0, 1.0), smoothstep(0.18, 0.88, facing));
  float alpha = puff * vAlpha;
  if (alpha < 0.03) discard;
  gl_FragColor = vec4(shade, alpha);
}
`;

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function isFoamPixel(r, g, b, a) {
  if (a < 20) return false;
  if (r < 200 || g < 200 || b < 200) return false;
  return Math.abs(r - b) < 40 && Math.abs(r - g) < 40;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Foam overlay image failed to load"));
    img.src = url;
  });
}

/**
 * @param {object} [_dataset]
 */
export function createFoamCloudLayer(_dataset) {
  const group = new THREE.Group();
  group.name = "riverFoam";
  group.visible = false;
  group.renderOrder = 16;

  /** @type {THREE.InstancedMesh|null} */
  let mesh = null;
  /** @type {Promise<object>|null} */
  let loading = null;
  /** @type {{ x:number, z:number, lon:number, lat:number }[]} */
  let cells = [];
  let stats = { cells: 0, puffs: 0 };

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });

  function setVisible(v) {
    group.visible = !!v;
  }

  async function load(url = OVERLAY_URL) {
    if (mesh) {
      group.visible = true;
      return stats;
    }
    if (loading) return loading;
    loading = build(url).finally(() => {
      loading = null;
    });
    return loading;
  }

  async function build(url) {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Foam overlay canvas unavailable");
    ctx.drawImage(img, 0, 0);
    const image = ctx.getImageData(0, 0, img.width, img.height);
    const { data, width, height } = image;
    const spanLon = BOUNDS.east - BOUNDS.west;
    const spanLat = BOUNDS.north - BOUNDS.south;
    const found = [];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (!isFoamPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
        const lon = BOUNDS.west + ((x + 0.5) / width) * spanLon;
        const lat = BOUNDS.north - ((y + 0.5) / height) * spanLat;
        let local;
        try {
          local = lonLatToLocal(lon, lat);
        } catch {
          continue;
        }
        found.push({ x: local.x, z: local.z, lon, lat, seed: y * width + x });
      }
    }
    if (!found.length) throw new Error("No white foam pixels in river_foam.kml");

    const count = found.length * PUFF_LAYOUT.length;
    const geo = new THREE.SphereGeometry(1, 14, 10);
    const phases = new Float32Array(count);
    const alphas = new Float32Array(count);
    const cloud = new THREE.InstancedMesh(geo, material, count);
    cloud.name = "foamClouds";
    cloud.frustumCulled = false;
    cloud.renderOrder = 16;
    cloud.count = count;

    const dummy = new THREE.Object3D();
    const m = new THREE.Matrix4();
    let n = 0;
    for (const cell of found) {
      const jx = (hash01(cell.seed) - 0.5) * 3.2;
      const jz = (hash01(cell.seed + 19) - 0.5) * 3.2;
      const grow = 0.82 + hash01(cell.seed + 41) * 0.42;
      for (let p = 0; p < PUFF_LAYOUT.length; p += 1) {
        const puff = PUFF_LAYOUT[p];
        const spin = hash01(cell.seed + p * 7);
        dummy.position.set(
          cell.x + jx + puff.ox + (spin - 0.5) * 1.6,
          SURFACE_Y + puff.y,
          cell.z + jz + puff.oz + (hash01(cell.seed + p * 13) - 0.5) * 1.6,
        );
        dummy.rotation.set(0, spin * Math.PI * 2, 0);
        dummy.scale.set(puff.sx * grow, puff.sy * grow, puff.sz * grow);
        dummy.updateMatrix();
        m.copy(dummy.matrix);
        cloud.setMatrixAt(n, m);
        phases[n] = hash01(cell.seed + p * 3) * Math.PI * 2;
        alphas[n] = puff.alpha;
        n += 1;
      }
    }
    cloud.instanceMatrix.needsUpdate = true;
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    geo.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(alphas, 1));
    group.add(cloud);
    mesh = cloud;
    cells = found;
    stats = { cells: found.length, puffs: n, source: "src/jalnetra kml/river_foam.kml" };
    group.visible = true;
    return stats;
  }

  function pickAt(x, z) {
    if (!group.visible || !cells.length) return null;
    let best = null;
    let bestD = 18 * 18;
    for (const cell of cells) {
      const d = (cell.x - x) ** 2 + (cell.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = cell;
      }
    }
    if (!best) return null;
    return {
      x: best.x,
      z: best.z,
      lon: best.lon,
      lat: best.lat,
      class_label: "Foaming",
      class: "Foaming",
      color: "#F7FBFF",
      name: "Foaming",
    };
  }

  let time = 0;
  function update(dt) {
    if (!group.visible || !mesh) return;
    time += Number(dt) || 0;
    material.uniforms.uTime.value = time;
  }

  function dispose() {
    if (mesh) {
      group.remove(mesh);
      mesh.geometry?.dispose?.();
      mesh = null;
    }
    material.dispose();
    cells = [];
  }

  group.userData = {
    load,
    setVisible,
    pickAt,
    update,
    dispose,
    getStats: () => stats,
  };
  return group;
}
