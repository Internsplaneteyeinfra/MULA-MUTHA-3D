/**
 * Convert reference tree/plant models from ../src/trees → public/assets/trees/*.glb
 * Run: node scripts/convertTreeAssets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Blob } from "node:buffer";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { TDSLoader } from "three/examples/jsm/loaders/TDSLoader.js";
import { standTreeUpright } from "../src/scene/treeOrient.js";

globalThis.Blob = Blob;
globalThis.FileReader = class FileReader {
  constructor() {
    this.result = null;
    this.onloadend = null;
    this.onerror = null;
  }
  readAsArrayBuffer(blob) {
    Promise.resolve(blob.arrayBuffer())
      .then((buf) => {
        this.result = buf;
        this.onloadend?.({ target: this });
      })
      .catch((err) => this.onerror?.(err));
  }
  readAsDataURL() {
    throw new Error("readAsDataURL not needed");
  }
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_TREES = path.resolve(ROOT, "..", "src", "trees");
const OUT = path.join(ROOT, "public", "assets", "trees");

const SOURCES = [
  {
    id: "palm",
    file: "10446_Palm_Tree_v1_L3.123c0a37e64c-4659-4136-a23d-059cbcde3ecd/10446_Palm_Tree_v1_L3.123c0a37e64c-4659-4136-a23d-059cbcde3ecd/10446_Palm_Tree_v1_max2010_iteration-2.obj",
    type: "obj",
    targetH: 10,
    trunk: "#6a5038",
    leaf: "#3d6a32",
  },
  {
    id: "broadleaf",
    file: "hkr3q0bu23-ALanTree/ALan Tree/AlanTree.fbx",
    type: "fbx",
    targetH: 9.5,
    trunk: "#5c4638",
    leaf: "#4a7a42",
  },
  {
    id: "conifer",
    file: "z30y2sxaxb-treeplan/treeplan1.fbx",
    type: "fbx",
    targetH: 11,
    trunk: "#4a3c30",
    leaf: "#2f5a34",
  },
  {
    id: "grass",
    file: "grass-block/grass-block.3DS",
    type: "3ds",
    targetH: 1.4,
    trunk: "#4a6a38",
    leaf: "#5a8a48",
  },
];

function mat(color, roughness = 0.9) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function applyTreeMaterials(root, trunkColor, leafColor) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const name = `${obj.name} ${obj.material?.name || ""}`.toLowerCase();
    const isTrunk = /trunk|bark|stem|branch|wood/.test(name);
    obj.material = mat(isTrunk ? trunkColor : leafColor);
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

function normalizeToGround(root, targetH) {
  standTreeUpright(root);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = targetH / Math.max(0.001, size.y);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  root.position.set(-(box2.min.x + box2.max.x) * 0.5, -box2.min.y, -(box2.min.z + box2.max.z) * 0.5);
  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(root);
  box3.getSize(size);
  return { nativeW: size.x, nativeD: size.z, nativeH: size.y };
}

async function loadSource(src) {
  const full = path.join(SRC_TREES, src.file);
  if (!fs.existsSync(full)) throw new Error(`Missing: ${full}`);
  if (src.type === "obj") {
    const loader = new OBJLoader();
    return loader.parse(fs.readFileSync(full, "utf8"));
  }
  if (src.type === "fbx") {
    const loader = new FBXLoader();
    const buf = fs.readFileSync(full);
    return loader.parse(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (src.type === "3ds") {
    const loader = new TDSLoader();
    const buf = fs.readFileSync(full);
    return loader.parse(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  throw new Error(`Unknown type ${src.type}`);
}

function makeGrassProcedural() {
  const g = new THREE.Group();
  const clump = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 6, 5),
    mat("#5a8a48", 0.95),
  );
  clump.scale.set(1.3, 0.55, 1.3);
  clump.position.y = 0.35;
  g.add(clump);
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.9, 4),
      mat("#6a9a52", 0.92),
    );
    const a = (i / 5) * Math.PI * 2;
    blade.position.set(Math.cos(a) * 0.25, 0.45, Math.sin(a) * 0.25);
    blade.rotation.y = a;
    g.add(blade);
  }
  return g;
}

function makeBirchProcedural() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.28, 4.2, 6),
    mat("#d8d0c8", 0.92),
  );
  trunk.position.y = 2.1;
  g.add(trunk);
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 8, 7),
    mat("#6a9a48", 0.88),
  );
  canopy.position.y = 5.4;
  canopy.scale.set(1, 1.15, 1);
  g.add(canopy);
  return g;
}

async function exportGlb(object, outFile) {
  const exporter = new GLTFExporter();
  const arrayBuffer = await exporter.parseAsync(object, { binary: true });
  fs.writeFileSync(outFile, Buffer.from(arrayBuffer));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = [];

  for (const src of SOURCES) {
    try {
      let root;
      if (src.id === "grass") {
        root = makeGrassProcedural();
      } else {
        root = await loadSource(src);
        applyTreeMaterials(root, src.trunk, src.leaf);
      }
      const dims = normalizeToGround(root, src.targetH);
      const outFile = path.join(OUT, `${src.id}.glb`);
      await exportGlb(root, outFile);
      manifest.push({
        id: src.id,
        url: `/assets/trees/${src.id}.glb`,
        nativeW: dims.nativeW,
        nativeD: dims.nativeD,
        nativeH: dims.nativeH,
        source: path.basename(src.file),
      });
      console.log(`✓ ${src.id}.glb`);
    } catch (err) {
      console.warn(`✗ ${src.id}:`, err.message);
    }
  }

  // Birch — procedural (reference .blend not usable in browser pipeline)
  try {
    const birch = makeBirchProcedural();
    const dims = normalizeToGround(birch, 8.5);
    const outFile = path.join(OUT, "birch.glb");
    await exportGlb(birch, outFile);
    manifest.push({
      id: "birch",
      url: "/assets/trees/birch.glb",
      nativeW: dims.nativeW,
      nativeD: dims.nativeD,
      nativeH: dims.nativeH,
      source: "procedural_from_birch_tree.blend",
    });
    console.log("✓ birch.glb (procedural)");
  } catch (err) {
    console.warn("✗ birch:", err.message);
  }

  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ trees: manifest }, null, 2));
  console.log(`Wrote ${manifest.length} tree GLBs → public/assets/trees/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
