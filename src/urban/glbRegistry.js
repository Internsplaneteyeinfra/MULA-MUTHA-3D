import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createProceduralPrototype } from "./buildingPrototypes.js";
import { getBuildingMaterial, styleClassFromClassification } from "./buildingMaterials.js";
import { mergeMeshesForInstancing } from "./geometryMerge.js";

const cache = new Map();
const gltfLoader = new GLTFLoader();

export const BUILDING_MANIFEST = [
  { id: "residential/house_01", url: "/assets/buildings/residential/house_01.glb", nativeW: 10, nativeD: 8, nativeH: 7, style: "house" },
  { id: "residential/house_02", url: "/assets/buildings/residential/house_02.glb", nativeW: 9, nativeD: 9, nativeH: 6.5, style: "house" },
  { id: "residential/house_03", url: "/assets/buildings/residential/house_03.glb", nativeW: 12, nativeD: 7, nativeH: 8, style: "house" },
  { id: "residential/row_house_01", url: "/assets/buildings/residential/row_house_01.glb", nativeW: 18, nativeD: 8, nativeH: 9, style: "row" },
  { id: "apartments/apartment_lowrise", url: "/assets/buildings/apartments/apartment_lowrise.glb", nativeW: 18, nativeD: 12, nativeH: 14, style: "apartment_low" },
  { id: "apartments/apartment_midrise", url: "/assets/buildings/apartments/apartment_midrise.glb", nativeW: 22, nativeD: 14, nativeH: 24, style: "apartment_mid" },
  { id: "apartments/apartment_highrise", url: "/assets/buildings/apartments/apartment_highrise.glb", nativeW: 20, nativeD: 16, nativeH: 42, style: "apartment_high" },
  { id: "commercial/commercial_01", url: "/assets/buildings/commercial/commercial_01.glb", nativeW: 24, nativeD: 16, nativeH: 12, style: "commercial" },
  { id: "commercial/shop_block_01", url: "/assets/buildings/commercial/shop_block_01.glb", nativeW: 20, nativeD: 10, nativeH: 8, style: "commercial" },
  { id: "industrial/warehouse_01", url: "/assets/buildings/industrial/warehouse_01.glb", nativeW: 30, nativeD: 18, nativeH: 10, style: "warehouse" },
];

/**
 * Load a building prototype once (cached).
 * Prefer real GLB mesh; fall back to procedural Pune kit if GLB fails.
 * Shared Pune PBR facade materials are always applied for instanceColor tinting.
 */
export async function loadBuildingPrototype(id, styleClass) {
  const cacheKey = `${id}|${styleClass || ""}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const entry = BUILDING_MANIFEST.find((a) => a.id === id);
  if (!entry) throw new Error(`Unknown building asset: ${id}`);
  const style = styleClass || entry.style || "house";

  const promise = (async () => {
    const material = getBuildingMaterial(style);
    try {
      const gltf = await gltfLoader.loadAsync(entry.url);
      const merged = mergeMeshesForInstancing(gltf.scene);
      return {
        id,
        url: entry.url,
        geometry: merged.geometry,
        material,
        style,
        nativeW: merged.nativeW || entry.nativeW,
        nativeD: merged.nativeD || entry.nativeD,
        nativeH: merged.nativeH || entry.nativeH,
        source: "glb",
      };
    } catch (err) {
      console.warn("GLB load failed, using procedural kit", id, err?.message || err);
      const proc = createProceduralPrototype(id, entry);
      return {
        id,
        url: entry.url,
        geometry: proc.geometry,
        material,
        style,
        nativeW: proc.nativeW,
        nativeD: proc.nativeD,
        nativeH: proc.nativeH,
        source: "procedural_kit",
      };
    }
  })();

  cache.set(cacheKey, promise);
  return promise;
}

export async function preloadBuildingAssets(records) {
  const out = new Map();
  const jobs = [];
  const seen = new Set();
  for (const rec of records) {
    const id = rec.classification.assetId;
    const style = styleClassFromClassification(rec.classification);
    const key = `${id}|${style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push(
      loadBuildingPrototype(id, style)
        .then((proto) => {
          if (proto?.geometry) out.set(key, proto);
        })
        .catch((err) => console.warn("Asset load failed", key, err)),
    );
  }
  await Promise.all(jobs);
  return out;
}

export function prototypeKey(assetId, styleClass) {
  return `${assetId}|${styleClass || "house"}`;
}
