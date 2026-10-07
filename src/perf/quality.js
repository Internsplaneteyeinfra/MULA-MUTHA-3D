/**
 * Adaptive render quality — shared/remote sessions struggle with full GPU settings.
 *
 * Force modes via URL:
 *   ?quality=low    — phones / weak GPU
 *   ?quality=medium — default smooth profile (most users)
 *   ?quality=high   — max detail (powerful local GPU)
 */

function isLikelySharedOrRemote() {
  const h = location.hostname || "";
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return false;
  return true;
}

export function isProductionHost() {
  return isLikelySharedOrRemote();
}

export function isLowMemoryDevice() {
  const memoryGb = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  const narrowTouchDevice = navigator.maxTouchPoints > 0 && window.innerWidth < 900;
  return (memoryGb > 0 && memoryGb <= 4) || (cores > 0 && cores <= 4) || narrowTouchDevice;
}

/**
 * Chrome reports deviceMemory max 8 for both 8 GB and 16 GB+.
 * Discrete NVIDIA/AMD/Arc → treat as capable. Intel Iris/UHD + 8 cap → 8 GB laptop.
 */
let _gpuName = null;
function gpuRendererName() {
  if (_gpuName != null) return _gpuName;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl", { failIfMajorPerformanceCaveat: false });
    if (!gl) {
      _gpuName = "";
      return _gpuName;
    }
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    _gpuName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || "") : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return _gpuName;
  } catch {
    _gpuName = "";
    return _gpuName;
  }
}

export function hasDiscreteGpu() {
  const r = gpuRendererName().toLowerCase();
  if (!r) return false;
  return /nvidia|geforce|rtx |gtx |radeon|amd |arc a\d/.test(r);
}

export function isIntegratedGpu() {
  const r = gpuRendererName().toLowerCase();
  if (!r) return false;
  if (hasDiscreteGpu()) return false;
  return /intel|iris|uhd graphics|hd graphics|adreno|mali|apple gpu|apple m[0-9]/.test(r);
}

/** True 8 GB iGPU laptops — not 16 GB workstations (API also reports 8). */
export function isModestRamDevice() {
  if (isLowMemoryDevice()) return true;
  if (hasDiscreteGpu()) return false;
  const memoryGb = Number(navigator.deviceMemory || 0);
  return memoryGb > 0 && memoryGb <= 8 && isIntegratedGpu();
}

/** Lite DTM/OSM only on constrained machines. 16 GB + discrete GPU stays full on production. */
export function shouldUseLiteAssets() {
  try {
    if (new URLSearchParams(location.search).has("fullTerrain")) return false;
    if (new URLSearchParams(location.search).has("lite")) return true;
  } catch {
    /* ignore */
  }
  return isModestRamDevice() || isLowMemoryDevice();
}

function readForcedTier() {
  const q = new URLSearchParams(location.search);
  const v = (q.get("quality") || q.get("perf") || "").toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return null;
}

export function createQualityProfile() {
  const forced = readForcedTier();
  // Full features always (fish, bridge names, vegetation). GPU extras only step down.
  let tier =
    forced ||
    (shouldUseLiteAssets() ? "medium" : "high");

  const settings = () => profileFor(tier);

  let fpsSamples = [];
  let lastAdapt = 0;

  return {
    get tier() {
      return tier;
    },
    get() {
      return settings();
    },
    /** GPU-only adapt. Fish, bridges, vegetation and labels stay on. */
    noteFrame(dt) {
      if (forced || tier === "medium") return;
      if (!dt || dt <= 0 || dt > 0.25) return;
      const fps = 1 / dt;
      fpsSamples.push(fps);
      if (fpsSamples.length > 40) fpsSamples.shift();
      const now = performance.now();
      if (now - lastAdapt < 1800 || fpsSamples.length < 22) return;
      lastAdapt = now;
      const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
      if (avg < 32 && tier === "high") {
        tier = "medium";
        fpsSamples = [];
        console.info("[perf] Shadows off for smoothness — fish and labels stay on");
      }
    },
  };
}

function profileFor(tier) {
  if (tier === "low") {
    return {
      tier,
      pixelRatioMax: 1,
      antialias: false,
      shadows: false,
      shadowMapSize: 512,
      preserveDrawingBuffer: false,
      targetFps: 30,
      labelHz: 16,
      lodHz: 4,
      chainageHz: 8,
      coordLabelHz: 3,
      softShadow: false,
      maxTrees: 1200,
      maxVegTypeTrees: 1800,
      treeShadows: false,
      enableVegApi: true,
      enableFishing: true,
      vegTypeStepM: 72,
      lightTreesOnly: true,
    };
  }
  if (tier === "medium") {
    return {
      tier,
      pixelRatioMax: 1.1,
      antialias: true,
      shadows: false,
      shadowMapSize: 1024,
      preserveDrawingBuffer: false,
      targetFps: 50,
      labelHz: 10,
      lodHz: 6,
      chainageHz: 12,
      coordLabelHz: 5,
      softShadow: false,
      maxTrees: 2200,
      maxVegTypeTrees: 2800,
      treeShadows: false,
      enableVegApi: true,
      enableFishing: true,
      vegTypeStepM: 55,
      lightTreesOnly: true,
    };
  }
  return {
    tier: "high",
    pixelRatioMax: 1.25,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    preserveDrawingBuffer: false,
    targetFps: 60,
    labelHz: 16,
    lodHz: 10,
    chainageHz: 24,
    coordLabelHz: 10,
    softShadow: true,
    maxTrees: 4500,
    maxVegTypeTrees: 5500,
    treeShadows: true,
    enableVegApi: true,
    enableFishing: true,
    vegTypeStepM: 45,
    lightTreesOnly: true,
  };
}

/** Simple rate limiter: returns true when enough time elapsed. */
export function createThrottle(hz) {
  let acc = 0;
  let interval = 1 / Math.max(1, hz);
  return {
    setHz(h) {
      interval = 1 / Math.max(1, h);
    },
    ready(dt) {
      acc += dt;
      if (acc < interval) return false;
      acc = 0;
      return true;
    },
  };
}
