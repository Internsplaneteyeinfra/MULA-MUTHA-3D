import { loadGltf, prefetchGlbUrls } from "../utils/gltfLoader.js";
import * as THREE from "three";
import { mergeMeshesForInstancing } from "../urban/geometryMerge.js";
import { standTreeUpright } from "./treeOrient.js";

/** Bust prototype cache after visual / perf upgrades. */
const CACHE_VERSION = 7;
const cache = new Map();

/**
 * Light designed silhouettes only — meshopt GLBs are 40k–200k verts each and
 * destroy frame time when instanced thousands of times.
 */
const USE_GLB_MESHES = false;

function treeAssetUrl(file) {
  const base = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
  const root = String(base).endsWith("/") ? base : `${base}/`;
  return `${root}assets/trees/${file}`;
}

export const TREE_MANIFEST = [
  { id: "palm", url: treeAssetUrl("palm.glb"), nativeW: 6, nativeD: 6, nativeH: 10, tags: ["palm"] },
  { id: "broadleaf", url: treeAssetUrl("broadleaf.glb"), nativeW: 8, nativeD: 8, nativeH: 9.5, tags: ["broadleaf"] },
  { id: "conifer", url: treeAssetUrl("conifer.glb"), nativeW: 10, nativeD: 10, nativeH: 11, tags: ["conifer"] },
  { id: "birch", url: treeAssetUrl("birch.glb"), nativeW: 4.5, nativeD: 4.5, nativeH: 8.5, tags: ["birch"] },
  { id: "grass", url: treeAssetUrl("grass.glb"), nativeW: 2, nativeD: 2, nativeH: 1.6, tags: ["grass"] },
  { id: "neem", url: treeAssetUrl("broadleaf.glb"), nativeW: 8, nativeD: 8, nativeH: 11, tags: ["neem", "margosa"] },
  { id: "banyan", url: treeAssetUrl("broadleaf.glb"), nativeW: 14, nativeD: 14, nativeH: 14, tags: ["banyan", "peepal", "ficus"] },
  { id: "gulmohar", url: treeAssetUrl("broadleaf.glb"), nativeW: 10, nativeD: 10, nativeH: 10, tags: ["gulmohar", "delonix"] },
  { id: "acacia", url: treeAssetUrl("broadleaf.glb"), nativeW: 8, nativeD: 8, nativeH: 8.5, tags: ["acacia", "babul"] },
  { id: "bamboo", url: treeAssetUrl("grass.glb"), nativeW: 4, nativeD: 4, nativeH: 7.5, tags: ["bamboo"] },
  { id: "shrub", url: treeAssetUrl("grass.glb"), nativeW: 3, nativeD: 3, nativeH: 2.8, tags: ["shrub", "bush"] },
  { id: "reeds", url: treeAssetUrl("grass.glb"), nativeW: 2, nativeD: 2, nativeH: 2.2, tags: ["reeds", "wetland"] },
];

/** Natural authentic canopy greens & blooms (not neon). */
const FOLIAGE_HEX = {
  grass: "#6a9a4e",
  conifer: "#3d6b3a",
  palm: "#4f8a42",
  birch: "#6faa55",
  broadleaf: "#4d8540",
  neem: "#4e9a3b",
  banyan: "#2c6e30",
  gulmohar: "#559235",
  acacia: "#5c8738",
  bamboo: "#62a832",
  shrub: "#558d3c",
  reeds: "#5a8c42",
};

const FOLIAGE_DARK = {
  grass: "#4e7a38",
  conifer: "#2a4f28",
  palm: "#3a6a32",
  birch: "#558a40",
  broadleaf: "#356832",
  neem: "#2e6424",
  banyan: "#1b461b",
  gulmohar: "#396525",
  acacia: "#3e5c24",
  bamboo: "#407220",
  shrub: "#365c24",
  reeds: "#3a5c28",
};

const TRUNK_HEX = {
  palm: "#7a5a3c",
  broadleaf: "#4a3426",
  conifer: "#3d2e22",
  birch: "#d4ccc0",
  grass: "#4a5a32",
  neem: "#44382e",
  banyan: "#594c3d",
  gulmohar: "#685d53",
  acacia: "#4a3526",
  bamboo: "#8f964a",
  shrub: "#524234",
  reeds: "#583b25",
};

export function foliageHex(id) {
  return FOLIAGE_HEX[id] || FOLIAGE_HEX.broadleaf;
}

export function prefetchTreeAssets() {
  prefetchGlbUrls(TREE_MANIFEST.map((t) => t.url));
}

export function classifyTreeAsset(props = {}, kind = "osm", rng = () => 0.5) {
  const text = [
    props.genus,
    props.species,
    props.natural,
    props.landuse,
    props.leaf_type,
    props.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/reed|cattail|typha|rush|marsh|wetland/.test(text)) return "reeds";
  if (/bamboo|bambusa|dendrocalamus/.test(text)) return "bamboo";
  if (/grass|lawn|herb/.test(text)) return "grass";
  if (/shrub|bush|hedge|scrub|lantana|bougainvillea/.test(text) || kind === "shrub") return "shrub";
  if (/palm|areca|cocos|date|royal/.test(text)) return "palm";
  if (/neem|azadirachta|margosa/.test(text)) return "neem";
  if (/banyan|peepal|ficus|bodhi/.test(text)) return "banyan";
  if (/gulmohar|delonix|flamboyant|flame/.test(text)) return "gulmohar";
  if (/acacia|babul|thorn|mimosa/.test(text)) return "acacia";
  if (/pinus|cedrus|conifer|spruce|fir|juniper/.test(text)) return "conifer";
  if (/betula|birch/.test(text)) return "birch";

  if (kind === "riparian") {
    const r = rng();
    if (r < 0.24) return "bamboo";
    if (r < 0.44) return "neem";
    if (r < 0.60) return "palm";
    if (r < 0.74) return "acacia";
    if (r < 0.86) return "broadleaf";
    if (r < 0.94) return "shrub";
    return "reeds";
  }
  if (kind === "forest") {
    const r = rng();
    if (r < 0.28) return "neem";
    if (r < 0.50) return "banyan";
    if (r < 0.72) return "broadleaf";
    if (r < 0.86) return "gulmohar";
    if (r < 0.94) return "acacia";
    return "conifer";
  }
  if (kind === "park") {
    const r = rng();
    if (r < 0.24) return "gulmohar";
    if (r < 0.46) return "neem";
    if (r < 0.62) return "palm";
    if (r < 0.76) return "banyan";
    if (r < 0.88) return "shrub";
    return "broadleaf";
  }

  const roll = rng();
  if (roll < 0.20) return "neem";
  if (roll < 0.36) return "broadleaf";
  if (roll < 0.50) return "gulmohar";
  if (roll < 0.62) return "banyan";
  if (roll < 0.74) return "palm";
  if (roll < 0.84) return "acacia";
  if (roll < 0.92) return "bamboo";
  if (roll < 0.97) return "shrub";
  return "grass";
}

/**
 * Trunk / canopy color with soft foliage variation (radial + vertical).
 */
function paintFoliageColors(geometry, id) {
  const pos = geometry.getAttribute("position");
  if (!pos) return;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const minY = box.min.y;
  const spanY = Math.max(0.001, box.max.y - minY);
  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  const maxR = Math.max(0.001, Math.hypot(box.max.x - cx, box.max.z - cz));

  const trunkRatio =
    id === "grass" || id === "reeds" ? 0.08 :
    id === "shrub" ? 0.16 :
    id === "palm" ? 0.48 :
    id === "bamboo" ? 0.38 :
    id === "conifer" ? 0.18 :
    id === "banyan" ? 0.30 :
    id === "acacia" ? 0.36 :
    0.30;

  const trunk = new THREE.Color(TRUNK_HEX[id] || TRUNK_HEX.broadleaf);
  const leafA = new THREE.Color(FOLIAGE_HEX[id] || FOLIAGE_HEX.broadleaf);
  const leafB = new THREE.Color(FOLIAGE_DARK[id] || FOLIAGE_DARK.broadleaf);
  const c = new THREE.Color();
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = (y - minY) / spanY;
    const r = Math.hypot(x - cx, z - cz) / maxR;
    const trunkMix = THREE.MathUtils.smoothstep(t, trunkRatio, trunkRatio + 0.14);
    // Hash-like variation from position
    const n = Math.abs(Math.sin(x * 12.9898 + z * 78.233 + y * 37.719) * 43758.5453) % 1;
    c.copy(leafA).lerp(leafB, 0.25 + r * 0.45 + n * 0.2);
    c.lerp(trunk, 1 - trunkMix);

    // Warm highlights on upper canopy
    if (t > 0.68) c.offsetHSL(0.02, 0.04, 0.04 * (t - 0.68));

    // Scarlet blossom petals highlight on Gulmohar crown tips
    if (id === "gulmohar" && t > 0.65 && n > 0.38) {
      c.lerp(new THREE.Color("#cc3220"), 0.55 + (t - 0.65) * 1.1);
    }
    // Subtle cattail velvet brown on upper reed heads
    if (id === "reeds" && t > 0.62 && r < 0.25) {
      c.lerp(new THREE.Color("#5c3d25"), 0.85);
    }

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
}

export function makeGlbTreeMaterial(id) {
  return new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.88,
    metalness: 0,
    vertexColors: true,
    emissive: new THREE.Color(FOLIAGE_DARK[id] || "#2a4a28"),
    emissiveIntensity: 0.04,
    flatShading: false,
    side: THREE.FrontSide,
  });
}

/**
 * High-quality stylized trees (birch/grass + GLB fallback).
 * Organic canopy clusters, tapered trunks — not lollipops / star fans.
 */
function buildDesignedTree(id) {
  const root = new THREE.Group();
  const trunkCol = TRUNK_HEX[id] || TRUNK_HEX.broadleaf;
  const leafCol = FOLIAGE_HEX[id] || FOLIAGE_HEX.broadleaf;
  const leafDark = FOLIAGE_DARK[id] || FOLIAGE_DARK.broadleaf;

  const trunkMat = new THREE.MeshStandardMaterial({
    color: trunkCol,
    roughness: 0.95,
    metalness: 0,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    color: leafCol,
    roughness: 0.86,
    metalness: 0,
    flatShading: id === "conifer",
  });
  const leafMat2 = new THREE.MeshStandardMaterial({
    color: leafDark,
    roughness: 0.9,
    metalness: 0,
  });

  if (id === "palm") {
    // Soft tapered trunk (lathe) + arched frond clusters
    const trunkProfile = [
      new THREE.Vector2(0.28, 0),
      new THREE.Vector2(0.24, 1.5),
      new THREE.Vector2(0.2, 3.5),
      new THREE.Vector2(0.16, 5.5),
      new THREE.Vector2(0.18, 6.8),
    ];
    const trunk = new THREE.Mesh(new THREE.LatheGeometry(trunkProfile, 10), trunkMat);
    root.add(trunk);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), trunkMat);
    crown.position.y = 6.9;
    root.add(crown);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const frond = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), i % 2 ? leafMat : leafMat2);
      frond.position.set(Math.cos(a) * 1.6, 6.2 + Math.sin(i) * 0.25, Math.sin(a) * 1.6);
      frond.scale.set(1.6, 0.28, 0.55);
      frond.lookAt(0, 5.2, 0);
      root.add(frond);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.7, 7, 5), leafMat);
      tip.position.set(Math.cos(a) * 0.6, 7.15, Math.sin(a) * 0.6);
      tip.scale.set(1.1, 0.55, 1.0);
      root.add(tip);
    }
  } else if (id === "conifer") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.45, 2.8, 8), trunkMat);
    trunk.position.y = 1.4;
    root.add(trunk);
    const layers = [2.6, 2.15, 1.75, 1.35, 0.95, 0.55];
    let y = 2.6;
    for (let i = 0; i < layers.length; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(layers[i], 1.65 - i * 0.08, 9),
        i % 2 ? leafMat : leafMat2,
      );
      cone.position.y = y;
      cone.rotation.y = i * 0.35;
      root.add(cone);
      y += 1.05;
    }
  } else if (id === "birch") {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 5.2, 8), trunkMat);
    trunk.position.y = 2.6;
    root.add(trunk);
    for (const side of [-1, 1]) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 1.6, 5), trunkMat);
      br.position.set(side * 0.5, 4.4, 0.1 * side);
      br.rotation.z = side * 0.7;
      root.add(br);
    }
    addCanopyCluster(root, leafMat, leafMat2, [
      [0, 6.0, 0, 1.55, 1.35, 1.45],
      [0.85, 5.7, 0.45, 1.05, 0.9, 1.0],
      [-0.8, 5.85, -0.4, 1.0, 0.88, 0.95],
      [0.35, 6.7, -0.35, 0.9, 0.75, 0.85],
      [-0.4, 5.35, 0.55, 0.85, 0.7, 0.8],
      [0.15, 6.35, 0.5, 0.8, 0.7, 0.75],
    ]);
  } else if (id === "grass") {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.15 + (i % 3) * 0.2, 4), leafMat);
      blade.position.set(Math.cos(a) * 0.32, 0.55, Math.sin(a) * 0.32);
      blade.rotation.z = Math.cos(a) * 0.4;
      blade.rotation.x = Math.sin(a) * 0.4;
      root.add(blade);
    }
    addCanopyCluster(root, leafMat, leafMat2, [
      [0.35, 0.65, 0.2, 0.55, 0.4, 0.5],
      [-0.3, 0.7, -0.25, 0.5, 0.38, 0.48],
      [0.1, 0.55, -0.35, 0.48, 0.35, 0.45],
      [-0.15, 0.8, 0.3, 0.45, 0.35, 0.42],
    ]);
  } else if (id === "neem") {
    // Neem (Azadirachta indica) — rounded dense crown, multiple leafy clusters
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.46, 3.8, 8), trunkMat);
    trunk.position.y = 1.9;
    root.add(trunk);
    for (const [bx, bz, rotZ, rotX] of [[0.4, 0.2, 0.5, 0.2], [-0.35, -0.3, -0.55, -0.25], [0.1, 0.4, 0.2, 0.5]]) {
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.8, 5), trunkMat);
      branch.position.set(bx, 3.6, bz);
      branch.rotation.set(rotX, 0, rotZ);
      root.add(branch);
    }
    addCanopyCluster(root, leafMat, leafMat2, [
      [0, 5.4, 0, 1.8, 1.5, 1.8],
      [1.1, 5.0, 0.6, 1.25, 1.1, 1.2],
      [-1.0, 5.1, -0.6, 1.2, 1.05, 1.2],
      [0.4, 6.2, -0.3, 1.3, 1.15, 1.3],
      [-0.5, 6.1, 0.5, 1.25, 1.1, 1.2],
      [0.7, 5.3, -0.9, 1.1, 1.0, 1.1],
      [-0.8, 5.2, 0.9, 1.1, 0.95, 1.1],
      [0, 6.7, 0, 1.1, 0.95, 1.05],
    ]);
  } else if (id === "banyan") {
    // Banyan / Peepal (Ficus) — massive sprawling limbs, buttresses & wide shade umbrella
    const mainTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 3.2, 9), trunkMat);
    mainTrunk.position.y = 1.6;
    root.add(mainTrunk);
    // Vertical aerial root columns
    for (const [rx, rz] of [[1.2, 0.4], [-1.0, 0.7], [0.3, -1.1]]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 2.7, 5), trunkMat);
      col.position.set(rx, 1.35, rz);
      root.add(col);
    }
    // Heavy horizontal spreading boughs
    for (const [bx, bz, l, rz] of [[1.4, 0.4, 2.4, 0.7], [-1.3, -0.3, 2.3, -0.65], [0.3, 1.4, 2.2, 0.2]]) {
      const bough = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, l, 6), trunkMat);
      bough.position.set(bx * 0.6, 3.2, bz * 0.6);
      bough.rotation.z = rz;
      root.add(bough);
    }
    addCanopyCluster(root, leafMat, leafMat2, [
      [0, 4.6, 0, 2.5, 1.2, 2.4],
      [1.8, 4.4, 0.8, 1.7, 1.0, 1.6],
      [-1.7, 4.5, -0.7, 1.6, 0.95, 1.6],
      [0.6, 4.5, -1.9, 1.6, 0.95, 1.5],
      [-0.7, 4.4, 1.8, 1.55, 0.9, 1.5],
      [1.2, 5.3, -0.6, 1.4, 0.9, 1.35],
      [-1.1, 5.4, 0.5, 1.4, 0.9, 1.35],
      [0, 5.7, 0, 1.8, 1.05, 1.7],
      [2.2, 4.0, -0.4, 1.2, 0.7, 1.1],
      [-2.1, 4.1, 0.4, 1.2, 0.7, 1.1],
    ]);
  } else if (id === "gulmohar") {
    // Gulmohar (Delonix regia / Flame Tree) — broad umbrella crown & blossom clusters
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, 3.2, 8), trunkMat);
    trunk.position.y = 1.6;
    root.add(trunk);
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + 0.3;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 2.2, 5), trunkMat);
      b.position.set(Math.cos(ang) * 0.7, 3.2, Math.sin(ang) * 0.7);
      b.rotation.x = Math.sin(ang) * 0.55;
      b.rotation.z = -Math.cos(ang) * 0.55;
      root.add(b);
    }
    addCanopyCluster(root, leafMat, leafMat2, [
      [0, 4.8, 0, 2.3, 0.75, 2.2],
      [1.4, 4.6, 0.8, 1.5, 0.65, 1.4],
      [-1.3, 4.7, -0.7, 1.45, 0.65, 1.4],
      [0.6, 4.7, -1.5, 1.4, 0.65, 1.35],
      [-0.6, 4.6, 1.4, 1.4, 0.65, 1.35],
      [0, 5.5, 0, 1.6, 0.7, 1.5],
      [0.8, 5.3, 0.5, 1.1, 0.55, 1.0],
      [-0.7, 5.3, -0.5, 1.1, 0.55, 1.0],
    ]);
  } else if (id === "acacia") {
    // Acacia / Babul — characteristic flat-topped umbrella pads, thorny riverbank silhouette
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 2.8, 7), trunkMat);
    trunk.position.set(0.1, 1.4, 0);
    trunk.rotation.z = -0.12;
    root.add(trunk);
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 2.0, 5), trunkMat);
    limb.position.set(-0.35, 2.7, 0.1);
    limb.rotation.z = 0.55;
    root.add(limb);
    addCanopyCluster(root, leafMat, leafMat2, [
      [0.3, 3.4, 0.2, 1.4, 0.42, 1.35],
      [-0.8, 3.8, -0.4, 1.3, 0.4, 1.25],
      [0.9, 4.3, -0.3, 1.5, 0.42, 1.4],
      [-0.4, 4.6, 0.6, 1.35, 0.38, 1.3],
      [0.2, 5.2, 0.1, 1.6, 0.45, 1.5],
      [0.8, 5.1, 0.6, 1.0, 0.35, 0.95],
      [-0.6, 5.0, -0.6, 0.95, 0.32, 0.9],
    ]);
  } else if (id === "bamboo") {
    // Clustered vertical culms with arched feathery plumes
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const r = 0.25 + (i % 2) * 0.18;
      const culm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 4.2, 5), trunkMat);
      culm.position.set(Math.cos(a) * r, 2.1, Math.sin(a) * r);
      culm.rotation.z = Math.cos(a) * 0.09;
      culm.rotation.x = Math.sin(a) * 0.09;
      root.add(culm);
    }
    addCanopyCluster(root, leafMat, leafMat2, [
      [0.2, 4.2, 0.2, 0.55, 1.1, 0.55],
      [-0.3, 4.4, -0.2, 0.5, 1.15, 0.5],
      [0.5, 4.6, -0.3, 0.48, 1.0, 0.48],
      [-0.4, 4.8, 0.4, 0.45, 1.05, 0.45],
      [0.1, 5.2, 0.1, 0.6, 1.2, 0.6],
      [-0.2, 5.4, -0.1, 0.5, 1.0, 0.5],
    ]);
  } else if (id === "shrub") {
    // Riverbank shrub / flowering thicket
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 0.8, 6), trunkMat);
    stem.position.y = 0.4;
    root.add(stem);
    addCanopyCluster(root, leafMat, leafMat2, [
      [0, 1.2, 0, 1.3, 0.85, 1.25],
      [0.65, 1.0, 0.35, 0.95, 0.75, 0.9],
      [-0.6, 1.05, -0.3, 0.9, 0.7, 0.85],
      [0.25, 1.1, -0.65, 0.88, 0.7, 0.85],
      [-0.3, 1.0, 0.6, 0.85, 0.68, 0.8],
      [0.1, 1.7, 0.1, 0.9, 0.75, 0.88],
    ]);
  } else if (id === "reeds") {
    // River wetland marsh reeds with cattail spikes
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const reed = new THREE.Mesh(new THREE.ConeGeometry(0.06, 1.6, 4), leafMat);
      reed.position.set(Math.cos(a) * 0.35, 0.8, Math.sin(a) * 0.35);
      reed.rotation.z = Math.cos(a) * 0.18;
      root.add(reed);
    }
    for (const [cx, cz] of [[0.1, 0.15], [-0.15, -0.1], [0.05, -0.2]]) {
      const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.38, 6), trunkMat);
      spike.position.set(cx, 1.25, cz);
      root.add(spike);
    }
    addCanopyCluster(root, leafMat, leafMat2, [
      [0, 0.6, 0, 0.65, 0.4, 0.6],
      [0.2, 0.8, -0.1, 0.45, 0.35, 0.45],
    ]);
  } else {
    // broadleaf — dense irregular crown
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.55, 3.8, 9), trunkMat);
    trunk.position.y = 1.9;
    root.add(trunk);
    addCanopyCluster(root, leafMat, leafMat2, [
      [0, 5.2, 0, 2.0, 1.7, 1.9],
      [1.35, 4.9, 0.7, 1.35, 1.15, 1.25],
      [-1.25, 5.0, -0.55, 1.3, 1.1, 1.2],
      [0.55, 5.05, -1.3, 1.25, 1.05, 1.2],
      [-0.7, 4.85, 1.2, 1.2, 1.0, 1.15],
      [0.2, 6.35, 0.15, 1.35, 1.15, 1.25],
      [0.95, 5.9, -0.75, 1.05, 0.9, 1.0],
      [-0.9, 6.0, 0.6, 1.1, 0.95, 1.05],
    ]);
  }

  return root;
}

function addCanopyCluster(root, matA, matB, specs) {
  for (let i = 0; i < specs.length; i++) {
    const [x, y, z, sx, sy, sz] = specs[i];
    // Low-poly spheres (cheaper than icosahedron when instanced × thousands)
    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(1, 7, 5),
      i % 2 ? matA : matB,
    );
    blob.position.set(x, y, z);
    blob.scale.set(sx, sy, sz);
    root.add(blob);
  }
}

function createProceduralPrototype(id) {
  const root = buildDesignedTree(id);
  standTreeUpright(root);
  const merged = mergeMeshesForInstancing(root);
  paintFoliageColors(merged.geometry, id);
  return {
    id,
    geometry: merged.geometry,
    material: makeGlbTreeMaterial(id),
    nativeW: merged.nativeW,
    nativeD: merged.nativeD,
    nativeH: merged.nativeH,
    source: "designed",
  };
}

function looksCollapsed(bw, bh, bd) {
  return Math.abs(bw - 2) < 0.25 && Math.abs(bh - 2) < 0.25 && Math.abs(bd - 2) < 0.25;
}

function prototypeFromGlb(id, merged, entry) {
  paintFoliageColors(merged.geometry, id);
  return {
    id,
    geometry: merged.geometry,
    material: makeGlbTreeMaterial(id),
    nativeW: merged.nativeW || entry.nativeW,
    nativeD: merged.nativeD || entry.nativeD,
    nativeH: merged.nativeH || entry.nativeH,
    source: "glb",
  };
}

export async function loadTreePrototype(id) {
  const key = `${CACHE_VERSION}:${id}`;
  if (cache.has(key)) return cache.get(key);
  const entry = TREE_MANIFEST.find((t) => t.id === id);
  if (!entry) throw new Error(`Unknown tree asset: ${id}`);

  const promise = (async () => {
    // Stubs / shrub — always designed
    if (!USE_GLB_MESHES || id === "birch" || id === "grass") {
      return createProceduralPrototype(id);
    }

    try {
      const gltf = await loadGltf(entry.url);
      standTreeUpright(gltf.scene);
      let vertCount = 0;
      gltf.scene.traverse((o) => {
        if (o.isMesh) vertCount += o.geometry?.attributes?.position?.count || 0;
      });
      const merged = mergeMeshesForInstancing(gltf.scene);
      const bb = merged.geometry.boundingBox;
      const bw = bb ? bb.max.x - bb.min.x : merged.nativeW;
      const bh = bb ? bb.max.y - bb.min.y : merged.nativeH;
      const bd = bb ? bb.max.z - bb.min.z : merged.nativeD;

      if (looksCollapsed(bw, bh, bd) || vertCount < 500 || bh < 3) {
        console.warn(`[trees] ${id} GLB rejected — designed fallback`, { bw, bh, bd, vertCount });
        return createProceduralPrototype(id);
      }

      console.info(`[trees] GLB ${id}`, {
        verts: vertCount,
        size: [bw, bh, bd].map((n) => Math.round(n * 10) / 10),
      });
      return prototypeFromGlb(id, merged, entry);
    } catch (err) {
      console.warn("[trees] GLB failed", id, err?.message || err);
      return createProceduralPrototype(id);
    }
  })();

  cache.set(key, promise);
  return promise;
}

export function clearTreePrototypeCache() {
  cache.clear();
}

export async function preloadTreeAssets(ids) {
  const out = new Map();
  const unique = [...new Set(ids.length ? ids : TREE_MANIFEST.map((t) => t.id))];
  await Promise.all(
    unique.map(async (id) => {
      const proto = await loadTreePrototype(id);
      if (proto) out.set(id, proto);
    }),
  );
  return out;
}

if (import.meta.hot) {
  import.meta.hot.accept(() => cache.clear());
  import.meta.hot.dispose(() => cache.clear());
}
