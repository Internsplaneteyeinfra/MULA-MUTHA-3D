import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createRiverFish } from "./FishMesh.js";

/**
 * Five fish categories — realistic Indian-river lengths (metres).
 * large ≈ 1.0×, medium ≈ 0.7×, small ≈ 0.45× of ~1.0 m reference.
 */
export const FISH_CATEGORIES = [
  {
    id: "crucian",
    label: "Crucian carp",
    source: "gltf",
    url: "/models/fish/crucian/scene.gltf",
    lengthM: 3.2,
    sizeClass: "large",
    layerBias: "mid",
    color: 0xffd24a,
  },
  {
    id: "shark",
    label: "River shark",
    source: "gltf+texture",
    url: "/models/fish/crucian/scene.gltf",
    textureUrl: "/models/fish/textures/species_b_shark.jpg",
    lengthM: 3.6,
    sizeClass: "large",
    layerBias: "mid",
    color: 0x5ad4ff,
  },
  {
    id: "betta",
    label: "Betta",
    source: "procedural+texture",
    textureUrl: "/models/fish/textures/species_c_betta.jpg",
    lengthM: 2.6,
    sizeClass: "small",
    layerBias: "surface",
    color: 0xff2f6a,
  },
  {
    id: "lowpoly",
    label: "River carp",
    source: "gltf+texture",
    url: "/models/fish/crucian/scene.gltf",
    textureUrl: "/models/fish/textures/species_d_lowpoly1.jpg",
    lengthM: 3.0,
    sizeClass: "medium",
    layerBias: "mid",
    color: 0xff8a1a,
  },
  {
    id: "eel",
    label: "American eel",
    source: "procedural+texture",
    textureUrl: "/models/fish/textures/species_e_eel.png",
    lengthM: 3.1,
    sizeClass: "medium",
    layerBias: "bottom",
    color: 0x2affb0,
    elongated: true,
  },
];

const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

export async function loadFishAssetLibrary() {
  const textures = {};
  const gltfCache = {};

  async function loadTex(url) {
    if (!url) return null;
    if (textures[url]) return textures[url];
    try {
      const t = await texLoader.loadAsync(url);
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;
      textures[url] = t;
      return t;
    } catch (err) {
      console.warn("Fish texture failed:", url, err.message);
      return null;
    }
  }

  async function loadGltf(url) {
    if (gltfCache[url]) return gltfCache[url];
    const gltf = await gltfLoader.loadAsync(url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const nativeLen = Math.max(size.x, size.y, size.z) || 1;
    root.scale.setScalar(1 / nativeLen);
    root.updateMatrixWorld(true);
    gltfCache[url] = { root, nativeLen, headingAxis: pickHeadingAxis(size) };
    return gltfCache[url];
  }

  const templates = {};
  for (const cat of FISH_CATEGORIES) {
    const tex = await loadTex(cat.textureUrl);
    let base = null;
    let headingAxis = new THREE.Vector3(1, 0, 0);

    if (cat.source === "gltf" || cat.source === "gltf+texture") {
      try {
        const packed = await loadGltf(cat.url);
        base = packed.root;
        headingAxis = packed.headingAxis.clone();
      } catch (err) {
        console.warn(`Fish GLTF failed (${cat.id}), using procedural:`, err.message);
      }
    }

    templates[cat.id] = { category: cat, texture: tex, base, headingAxis };
  }

  console.info("Fish asset library ready", {
    categories: FISH_CATEGORIES.map((c) => c.id),
    gltfLoaded: Object.keys(gltfCache).length,
  });

  return {
    categories: FISH_CATEGORIES,
    createInstance(categoryId, opts = {}) {
      const tpl = templates[categoryId] || templates.crucian;
      const cat = tpl.category;
      const jitter = 0.92 + Math.random() * 0.16;
      // Fixed world length from category (already large/medium/small). Never camera-enlarged.
      const worldLen = (opts.lengthM ?? cat.lengthM) * jitter;

      let mesh;
      if (tpl.base) {
        mesh = tpl.base.clone(true);
        sanitizeFishMaterials(mesh, cat, tpl.texture);
        mesh.scale.setScalar(worldLen);
      } else {
        mesh = createRiverFish({
          scale: worldLen / 2.4,
          color: cat.color,
          swimSpeed: opts.swimSpeed ?? 0.4,
        });
        sanitizeFishMaterials(mesh, cat, tpl.texture);
        if (cat.elongated) mesh.scale.x *= 1.25;
      }

      mesh.name = `fish_${cat.id}`;
      mesh.userData.speciesId = cat.id;
      mesh.userData.lengthM = worldLen;
      mesh.userData.sizeClass = cat.sizeClass;
      mesh.userData.headingAxis = tpl.headingAxis.clone();
      mesh.userData.tailGroup = mesh.userData.tailGroup || null;
      mesh.userData.swimPhase = Math.random() * Math.PI * 2;
      mesh.renderOrder = 8;
      mesh.frustumCulled = false;
      return mesh;
    },
  };
}

/**
 * Fix black / broken materials.
 * Keep valid albedo maps; avoid alien UV remaps that paint black body sections;
 * DoubleSide for thin fins; clear darkening PBR maps.
 */
function sanitizeFishMaterials(root, cat, texture) {
  const issues = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = false;

    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map((m) => (m ? m.clone() : m));
    } else if (obj.material) {
      obj.material = obj.material.clone();
    }

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (let i = 0; i < mats.length; i++) {
      let m = mats[i];
      if (!m || !m.isMaterial) {
        m = new THREE.MeshStandardMaterial({ color: cat.color, side: THREE.DoubleSide });
        mats[i] = m;
        issues.push("null material replaced");
      }

      const mapOk = m.map && m.map.image && m.map.image.width > 0;
      if (m.map && !mapOk) {
        m.map = null;
        issues.push("invalid map cleared");
      }

      // Prefer original GLTF albedo (correct UVs). Species pack textures often
      // don't share UVs and paint black body/fin patches — tint instead.
      if (texture && !mapOk) {
        m.map = texture;
        if (m.color) m.color.set(0xffffff);
      } else if (texture && mapOk) {
        if (m.color) m.color.setHex(cat.color);
      } else if (m.color) {
        const c = m.color;
        if (c.r + c.g + c.b < 0.2) {
          c.setHex(cat.color);
          issues.push("black albedo fixed");
        }
      }
      if (!m.map && m.color) m.color.setHex(cat.color);

      // Clear maps that commonly produce black underwater silhouettes
      if (m.aoMap) {
        m.aoMap = null;
        issues.push("aoMap cleared");
      }
      if (m.metalnessMap) m.metalnessMap = null;
      if (m.roughnessMap) m.roughnessMap = null;
      if (m.normalMap && (!m.normalMap.image || m.normalMap.image.width === 0)) {
        m.normalMap = null;
        issues.push("broken normal cleared");
      }

      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
      m.side = THREE.DoubleSide;
      m.roughness = 0.48;
      m.metalness = 0.04;
      // Strong tinted emissive so species stay readable against green water
      if (m.emissive) {
        m.emissive.setHex(cat.color);
        m.emissiveIntensity = 0.68;
      }
      if ("envMapIntensity" in m) m.envMapIntensity = 1.15;
      m.needsUpdate = true;
    }
    if (Array.isArray(obj.material)) obj.material = mats;
    else obj.material = mats[0];
  });
  if (issues.length) {
    console.warn(`Fish material fix [${cat.id}]:`, [...new Set(issues)].join(", "));
  }
}

function pickHeadingAxis(size) {
  if (size.x >= size.z) return new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3(0, 0, 1);
}
