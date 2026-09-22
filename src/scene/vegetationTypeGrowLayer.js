import * as THREE from "three";
import { lonLatToLocal } from "../geo/geoReference.js";
import { terrainHeightAt } from "./terrain.js";
import { preloadTreeAssets, foliageHex } from "./treeRegistry.js";
import { treeTargetHeight } from "./treeOrient.js";

const MAX_INSTANCES = 9000;
const DEFAULT_STEP_M = 55;
const BUILDING_CLEAR_M = 8;
const RIVER_CLEAR_EXTRA_M = 2;
const GROW_DURATION_S = 1.0;

/** Project vegetation_type.kml → draped overlay (public asset). */
export const VEGETATION_TYPE_LAYER = {
  overlay: "/data/hydrology/vegetation/vegetation_type_overlay.png",
  bounds: {
    north: 18.56563988,
    south: 18.50179885,
    east: 74.01249107,
    west: 73.83580284,
  },
  classes: [
    { id: "non_vegetation", label: "Non-Vegetation", color: "#A9A9A9" },
    { id: "trees", label: "Trees", color: "#228B22" },
    { id: "shrub", label: "Shrub / Scrub", color: "#9ACD32" },
    { id: "grass", label: "Grass / Herbaceous", color: "#90EE90" },
    { id: "mixed", label: "Mixed / Diverse", color: "#8A2BE2" },
  ],
};

/**
 * Permanent trees/grass from project Vegetation Type overlay.
 * Always visible — not tied to the Vegetation Type HUD toggle.
 *
 * @param {object} dataset
 * @param {{ animate?: boolean, maxInstances?: number, stepM?: number, castShadow?: boolean }} [opts]
 */
export async function createPermanentVegetationTypeTrees(dataset, opts = {}) {
  const sampler = await createVegetationTypeOverlaySampler();
  return createVegetationTypeGrowLayer(dataset, {
    sampleLonLat: (lon, lat) => sampler.sampleLonLat(lon, lat),
    bounds: VEGETATION_TYPE_LAYER.bounds,
    animate: opts.animate === true,
    maxInstances: opts.maxInstances,
    stepM: opts.stepM,
    castShadow: !!opts.castShadow,
    permanent: true,
  });
}

/**
 * Load vegetation_type_overlay.png and sample class by lon/lat.
 */
export async function createVegetationTypeOverlaySampler() {
  const box = VEGETATION_TYPE_LAYER.bounds;
  const west = Number(box.west);
  const east = Number(box.east);
  const north = Number(box.north);
  const south = Number(box.south);
  const classes = VEGETATION_TYPE_LAYER.classes.map((c) => {
    const rgb = hexToRgb(c.color);
    return { ...c, ...rgb };
  });

  const url = new URL(VEGETATION_TYPE_LAYER.overlay, window.location.origin).href;
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`vegetation_type overlay unavailable (${res.status})`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  // Downsample large overlays for fast CPU sampling
  const maxW = 1024;
  const scale = Math.min(1, maxW / Math.max(1, bitmap.width));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, width, height);

  function sampleLonLat(lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < west || lon > east || lat < south || lat > north) return null;
    const texU = (lon - west) / (east - west);
    // flipV: north = image top
    const texV = (north - lat) / (north - south);
    const px = Math.min(width - 1, Math.max(0, Math.round(texU * (width - 1))));
    const py = Math.min(height - 1, Math.max(0, Math.round(texV * (height - 1))));
    const i = (py * width + px) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 28 || r + g + b < 40) return null;

    let best = null;
    let bestD = Infinity;
    for (const c of classes) {
      const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best || bestD > 95 * 95) return null;
    return {
      id: best.id,
      label: best.label,
      class_label: best.label,
      color: best.color,
    };
  }

  return { sampleLonLat, width, height, west, east, north, south };
}

/**
 * Sample Vegetation Type classes and place InstancedMesh trees/grass.
 *
 * @param {object} dataset
 * @param {{
 *   sampleLandUseAt?: (x:number,z:number)=>object|null,
 *   sampleLonLat?: (lon:number,lat:number)=>object|null,
 *   bounds?: { north:number,south:number,east:number,west:number },
 *   animate?: boolean,
 *   maxInstances?: number,
 *   stepM?: number,
 *   castShadow?: boolean,
 *   permanent?: boolean,
 * }} opts
 */
export async function createVegetationTypeGrowLayer(dataset, opts = {}) {
  const group = new THREE.Group();
  group.name = opts.permanent ? "vegetationTypePermanent" : "vegetationTypeGrow";
  group.visible = true;

  const box = opts.bounds || VEGETATION_TYPE_LAYER.bounds;
  const animate = opts.animate === true;
  const maxN = Math.max(200, Number(opts.maxInstances) || MAX_INSTANCES);
  const stepM = Math.max(28, Number(opts.stepM) || DEFAULT_STEP_M);
  const castShadow = !!opts.castShadow;

  const sampleHit = (lon, lat, x, z) => {
    if (typeof opts.sampleLonLat === "function") return opts.sampleLonLat(lon, lat);
    if (typeof opts.sampleLandUseAt === "function") return opts.sampleLandUseAt(x, z);
    return null;
  };

  if (!box || (typeof opts.sampleLonLat !== "function" && typeof opts.sampleLandUseAt !== "function")) {
    group.userData.empty = true;
    group.userData.update = () => {};
    group.userData.dispose = () => {};
    return group;
  }

  const stations = dataset.corridor?.stations || [];
  const buildings = dataset.osm?.buildings || [];
  const roads = dataset.osm?.roads || [];
  const riverRing = dataset.ringLocal || null;
  const rng = mulberry(0x7e9714e ^ Math.floor(box.west * 1e6));

  const west = Number(box.west);
  const east = Number(box.east);
  const north = Number(box.north);
  const south = Number(box.south);
  const midLat = (north + south) * 0.5;
  const lonStep = stepM / (111320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  const latStep = stepM / 110540;

  const placements = [];
  const typeCounts = { trees: 0, shrub: 0, grass: 0, mixed: 0 };

  for (let lat = south + latStep * 0.5; lat < north; lat += latStep) {
    for (let lon = west + lonStep * 0.5; lon < east; lon += lonStep) {
      if (placements.length >= maxN) break;

      let local;
      try {
        local = lonLatToLocal(lon, lat);
      } catch {
        continue;
      }

      const hit = sampleHit(lon, lat, local.x, local.z);
      if (!hit) continue;

      const kind = classToKind(hit.id || hit.class_label || hit.label);
      if (!kind) continue;

      const accept =
        kind === "trees"
          ? rng() < 0.78
          : kind === "shrub"
            ? rng() < 0.65
            : kind === "grass"
              ? rng() < 0.5
              : rng() < 0.62;
      if (!accept) continue;

      const cluster = densifyCount(kind, rng);
      for (let c = 0; c < cluster; c++) {
        if (placements.length >= maxN) break;
        const jitter = c === 0 ? 0 : 1.8 + rng() * 7;
        const ang = rng() * Math.PI * 2;
        const x = local.x + Math.cos(ang) * jitter;
        const z = local.z + Math.sin(ang) * jitter;

        if (riverRing && pointInRing(x, z, riverRing)) continue;
        if (blocked(x, z, buildings, roads, stations)) continue;

        const y = terrainHeightAt(x, z, stations);
        if (!Number.isFinite(y)) continue;

        const assetId = assetForKind(kind, rng);
        const scale = scaleForKind(kind, rng);
        placements.push({
          x,
          z,
          y: y + 0.15,
          rotY: rng() * Math.PI * 2,
          scale,
          assetId,
          kind,
        });
        typeCounts[kind] = (typeCounts[kind] || 0) + 1;
      }
    }
    if (placements.length >= maxN) break;
  }

  const prototypes = await preloadTreeAssets(placements.map((p) => p.assetId));
  const byAsset = new Map();
  for (const p of placements) {
    if (!prototypes.has(p.assetId)) continue;
    if (!byAsset.has(p.assetId)) byAsset.set(p.assetId, []);
    byAsset.get(p.assetId).push(p);
  }

  /** @type {{ mesh: THREE.InstancedMesh, list: object[] }[]} */
  const batches = [];
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const startScale = animate ? 0.35 : 1;

  for (const [assetId, list] of byAsset) {
    const proto = prototypes.get(assetId);
    const mat = proto.material.clone();
    if (!proto.geometry?.getAttribute?.("color")) {
      mat.vertexColors = false;
      mat.color?.set?.(foliageHex(assetId));
    } else {
      mat.vertexColors = true;
      mat.color?.set?.("#ffffff");
    }
    const mesh = new THREE.InstancedMesh(proto.geometry, mat, list.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    mesh.name = `vegType:${assetId}`;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const targetH = treeTargetHeight(assetId, p.scale);
      p.uniform = targetH / Math.max(0.5, proto.nativeH);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rotY, 0);
      dummy.scale.setScalar(p.uniform * startScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (mat.vertexColors) {
        color.setRGB(0.9 + rng() * 0.1, 0.95 + rng() * 0.05, 0.88 + rng() * 0.1);
      } else {
        color.set(foliageHex(assetId)).offsetHSL((rng() - 0.5) * 0.05, 0.04, (rng() - 0.5) * 0.04);
      }
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    batches.push({ mesh, list });
  }

  let growT = startScale;
  let finished = !animate;

  function applyGrow(k) {
    const s = Math.max(0.2, k);
    for (const { mesh, list } of batches) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rotY, 0);
        dummy.scale.setScalar(p.uniform * s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function update(dt) {
    if (finished || !batches.length) return;
    growT = Math.min(1, growT + dt / GROW_DURATION_S);
    const t = growT;
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const k = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    applyGrow(Math.max(0, Math.min(1.06, k)));
    if (growT >= 1) {
      applyGrow(1);
      finished = true;
    }
  }

  function dispose() {
    for (const { mesh } of batches) {
      mesh.material?.dispose?.();
      mesh.dispose?.();
    }
    batches.length = 0;
    group.clear();
  }

  group.userData = {
    instanceCount: placements.length,
    typeCounts,
    empty: placements.length === 0,
    update,
    dispose,
    permanent: !!opts.permanent,
    source: opts.permanent ? "vegetation-type-permanent" : "vegetation-type-overlay-grow",
  };

  if (import.meta.env?.DEV) {
    console.info("[vegetation-type] trees placed", {
      permanent: !!opts.permanent,
      placed: placements.length,
      typeCounts,
    });
  }

  return group;
}

function densifyCount(kind, rng) {
  if (kind === "trees") return 1 + (rng() < 0.4 ? 1 : 0);
  if (kind === "mixed") return 1 + (rng() < 0.45 ? 1 : 0);
  if (kind === "shrub") return 1 + (rng() < 0.35 ? 1 : 0);
  return 1;
}

function classToKind(raw = "") {
  const n = String(raw).toLowerCase().replace(/[_/]+/g, " ");
  if (/non.?veg|barren|bare|urban|built|water/.test(n)) return null;
  if (/tree|forest|high/.test(n) || n === "trees") return "trees";
  if (/shrub|scrub|bush/.test(n) || n === "shrub") return "shrub";
  if (/grass|herb/.test(n) || n === "grass") return "grass";
  if (/mixed|diverse/.test(n) || n === "mixed") return "mixed";
  return null;
}

function assetForKind(kind, rng) {
  if (kind === "grass") return "grass";
  if (kind === "shrub") return rng() < 0.7 ? "grass" : "birch";
  if (kind === "trees") {
    const roll = rng();
    if (roll < 0.32) return "palm";
    if (roll < 0.66) return "broadleaf";
    return "conifer";
  }
  const roll = rng();
  if (roll < 0.28) return "grass";
  if (roll < 0.5) return "birch";
  if (roll < 0.72) return "broadleaf";
  if (roll < 0.88) return "palm";
  return "conifer";
}

function scaleForKind(kind, rng) {
  if (kind === "grass") return 0.65 + rng() * 0.75;
  if (kind === "shrub") return 0.8 + rng() * 0.75;
  if (kind === "mixed") return 0.95 + rng() * 1.15;
  return 1.1 + rng() * 1.45;
}

function blocked(x, z, buildings, roads, stations) {
  if (stations?.length) {
    const near = nearest(x, z, stations);
    if (near.lat < near.half + RIVER_CLEAR_EXTRA_M) return true;
  }
  for (const b of buildings) {
    if (Math.hypot(b.midX - x, b.midZ - z) < BUILDING_CLEAR_M) return true;
  }
  for (const r of roads) {
    if (Math.hypot(r.midX - x, r.midZ - z) < (r.widthM || 5) * 0.9) return true;
  }
  return false;
}

function nearest(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 160));
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

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  if (!Number.isFinite(n)) return { r: 128, g: 128, b: 128 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mulberry(a) {
  let seed = a >>> 0;
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
