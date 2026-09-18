import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/**
 * Shared GLTF loader with Meshopt support (compressed tree/building GLBs).
 * One loader instance → better HTTP connection reuse + decode path.
 */
let loader = null;
let meshoptReady = null;

function ensureMeshopt() {
  if (!meshoptReady) {
    meshoptReady = Promise.resolve(MeshoptDecoder.ready).then(
      () => true,
      (err) => {
        console.warn("[gltf] MeshoptDecoder ready failed — compressed tree GLBs may fall back", err?.message || err);
        return false;
      },
    );
  }
  return meshoptReady;
}

export function getGltfLoader() {
  if (loader) return loader;
  loader = new GLTFLoader();
  try {
    loader.setMeshoptDecoder(MeshoptDecoder);
    ensureMeshopt();
  } catch (err) {
    console.warn("[gltf] MeshoptDecoder unavailable", err?.message || err);
  }
  return loader;
}

/** loadAsync that waits for Meshopt WASM before parsing EXT_meshopt_compression GLBs. */
export async function loadGltf(url) {
  await ensureMeshopt();
  return getGltfLoader().loadAsync(url);
}

/** Prefetch GLB URLs early (browser cache) without blocking the main thread. */
export function prefetchGlbUrls(urls = []) {
  if (typeof document === "undefined") return;
  const seen = new Set();
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "fetch";
    link.href = url;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
}
