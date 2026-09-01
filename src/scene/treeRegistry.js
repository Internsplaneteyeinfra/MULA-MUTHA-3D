import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { mergeMeshesForInstancing } from "../urban/geometryMerge.js";
import { standTreeUpright } from "./treeOrient.js";

const gltfLoader = new GLTFLoader();
const cache = new Map();

export const TREE_MANIFEST = [
  { id: "palm", url: "/assets/trees/palm.glb", nativeW: 6, nativeD: 6, nativeH: 10, tags: ["palm", "areca", "cocos"] },
  { id: "broadleaf", url: "/assets/trees/broadleaf.glb", nativeW: 7, nativeD: 7, nativeH: 9.5, tags: ["broadleaf", "deciduous", "alan"] },
  { id: "conifer", url: "/assets/trees/conifer.glb", nativeW: 6, nativeD: 6, nativeH: 11, tags: ["conifer", "pine", "cedar"] },
  { id: "birch", url: "/assets/trees/birch.glb", nativeW: 5, nativeD: 5, nativeH: 8.5, tags: ["birch", "betula"] },
  { id: "grass", url: "/assets/trees/grass.glb", nativeW: 1.2, nativeD: 1.2, nativeH: 1.4, tags: ["grass", "shrub", "plant"] },
];

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

  if (/grass|shrub|bush|hedge|scrub/.test(text) || kind === "shrub") return "grass";
  if (/palm|areca|cocos|royal/.test(text)) return "palm";
  if (/pinus|cedrus|conifer|spruce|fir|juniper/.test(text)) return "conifer";
  if (/betula|birch/.test(text)) return "birch";

  if (kind === "riparian" && rng() < 0.38) return "palm";
  if (kind === "forest" && rng() < 0.45) return "conifer";
  if (kind === "park" && rng() < 0.22) return "grass";

  const roll = rng();
  if (roll < 0.26) return "palm";
  if (roll < 0.52) return "broadleaf";
  if (roll < 0.76) return "conifer";
  if (roll < 0.9) return "birch";
  return "grass";
}

export async function loadTreePrototype(id) {
  if (cache.has(id)) return cache.get(id);
  const entry = TREE_MANIFEST.find((t) => t.id === id);
  if (!entry) throw new Error(`Unknown tree asset: ${id}`);

  const promise = (async () => {
    try {
      const gltf = await gltfLoader.loadAsync(entry.url);
      standTreeUpright(gltf.scene);
      const merged = mergeMeshesForInstancing(gltf.scene);
      const material = merged.material?.clone?.() || new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 });
      material.color.set("#ffffff");
      if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
      return {
        id,
        geometry: merged.geometry,
        material,
        nativeW: merged.nativeW || entry.nativeW,
        nativeD: merged.nativeD || entry.nativeD,
        nativeH: merged.nativeH || entry.nativeH,
        source: "glb",
      };
    } catch (err) {
      console.warn("Tree GLB load failed", id, err?.message || err);
      return null;
    }
  })();

  cache.set(id, promise);
  return promise;
}

export async function preloadTreeAssets(ids) {
  const out = new Map();
  const unique = [...new Set(ids)];
  await Promise.all(
    unique.map(async (id) => {
      const proto = await loadTreePrototype(id);
      if (proto) out.set(id, proto);
    }),
  );
  return out;
}
