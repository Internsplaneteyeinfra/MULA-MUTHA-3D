/**
 * Generate lightweight procedural building GLBs for the urban pipeline.
 * Run: node scripts/generateBuildingAssets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Blob } from "node:buffer";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

// Node polyfills required by three/GLTFExporter
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
const OUT = path.join(ROOT, "public", "assets", "buildings");

const ASSETS = [
  { key: "residential/house_01", kind: "house", w: 10, d: 8, h: 7, roof: "gable", wall: "#c9b8a0", roofC: "#6a4a3a" },
  { key: "residential/house_02", kind: "house", w: 9, d: 9, h: 6.5, roof: "hip", wall: "#d2c4b0", roofC: "#4a5560" },
  { key: "residential/house_03", kind: "house", w: 12, d: 7, h: 8, roof: "gable", wall: "#b8aea0", roofC: "#7a5a48" },
  { key: "residential/row_house_01", kind: "row", w: 18, d: 8, h: 9, roof: "gable", wall: "#c4b6a6", roofC: "#5a5048" },
  { key: "apartments/apartment_lowrise", kind: "apt", w: 18, d: 12, h: 14, roof: "flat", wall: "#b4aea8", roofC: "#4a5056" },
  { key: "apartments/apartment_midrise", kind: "apt", w: 22, d: 14, h: 24, roof: "flat", wall: "#a8a29c", roofC: "#3e464e" },
  { key: "apartments/apartment_highrise", kind: "apt", w: 20, d: 16, h: 42, roof: "flat", wall: "#9c9892", roofC: "#343c44" },
  { key: "commercial/commercial_01", kind: "commercial", w: 24, d: 16, h: 12, roof: "flat", wall: "#aeb4b8", roofC: "#3a4248" },
  { key: "commercial/shop_block_01", kind: "shop", w: 20, d: 10, h: 8, roof: "flat", wall: "#c8b8a4", roofC: "#5a5048" },
  { key: "industrial/warehouse_01", kind: "warehouse", w: 30, d: 18, h: 10, roof: "gable", wall: "#9aa0a4", roofC: "#4a5054" },
];

function mat(color, roughness = 0.88, metalness = 0.04) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness,
  });
}

function addBox(group, sx, sy, sz, y, material, name, x = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.position.set(x, y, z);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function addGableRoof(group, w, d, h, roofMat) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -d / 2);
  const mesh = new THREE.Mesh(geo, roofMat);
  mesh.name = "roof";
  mesh.castShadow = true;
  group.add(mesh);
}

function addHipRoof(group, w, d, h, roofMat) {
  const geo = new THREE.ConeGeometry(Math.max(w, d) * 0.72, h, 4);
  geo.rotateY(Math.PI / 4);
  const mesh = new THREE.Mesh(geo, roofMat);
  mesh.position.y = h * 0.5;
  mesh.name = "roof";
  mesh.castShadow = true;
  group.add(mesh);
}

function addWindows(group, w, d, bodyH, floors) {
  const winMat = mat("#7ec8d8", 0.25, 0.35);
  const frameMat = mat("#3a4044", 0.7, 0.1);
  const cols = Math.max(2, Math.floor(w / 3.2));
  for (let f = 0; f < floors; f++) {
    const y = 1.4 + f * (bodyH / Math.max(1, floors));
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + (c + 0.5) * (w / cols);
      addBox(group, 1.1, 1.35, 0.08, y, winMat, "win", x, d / 2 + 0.04);
      addBox(group, 1.1, 1.35, 0.08, y, winMat, "win", x, -d / 2 - 0.04);
    }
  }
  addBox(group, 1.2, 2.2, 0.1, 1.1, frameMat, "door", 0, d / 2 + 0.06);
}

function buildAsset(def) {
  const root = new THREE.Group();
  root.name = def.key;
  const wallMat = mat(def.wall);
  const roofMat = mat(def.roofC, 0.82, 0.06);
  const bodyH = def.h * (def.roof === "flat" ? 0.92 : 0.72);
  addBox(root, def.w, bodyH, def.d, bodyH / 2, wallMat, "body");

  if (def.roof === "flat") {
    addBox(root, def.w * 1.02, 0.45, def.d * 1.02, bodyH + 0.22, roofMat, "roof");
    if (def.kind === "apt" || def.kind === "commercial") {
      addBox(root, def.w * 0.35, 1.2, def.d * 0.35, bodyH + 1.0, roofMat, "mech");
    }
  } else if (def.roof === "hip") {
    const roof = new THREE.Group();
    roof.position.y = bodyH;
    addHipRoof(roof, def.w * 1.05, def.d * 1.05, def.h - bodyH, roofMat);
    root.add(roof);
  } else {
    const roof = new THREE.Group();
    roof.position.y = bodyH;
    addGableRoof(roof, def.w * 1.04, def.d * 1.04, def.h - bodyH, roofMat);
    root.add(roof);
  }

  const floors = Math.max(1, Math.round(bodyH / 3.1));
  addWindows(root, def.w, def.d, bodyH, Math.min(floors, 8));

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  return root;
}

function exportGlb(object) {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      object,
      (result) => resolve(Buffer.from(result)),
      (err) => reject(err),
      { binary: true },
    );
  });
}

async function main() {
  for (const def of ASSETS) {
    const file = path.join(OUT, `${def.key}.glb`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const obj = buildAsset(def);
    const buf = await exportGlb(obj);
    fs.writeFileSync(file, buf);
    console.log("wrote", path.relative(ROOT, file), buf.length, "bytes");
  }
  const manifest = {
    generated: new Date().toISOString(),
    note: "Procedural low-poly building kit. Geographic positions come from OSM footprints only.",
    assets: ASSETS.map((a) => ({
      id: a.key,
      url: `/assets/buildings/${a.key}.glb`,
      kind: a.kind,
      nativeW: a.w,
      nativeD: a.d,
      nativeH: a.h,
    })),
  };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("manifest ok", ASSETS.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
