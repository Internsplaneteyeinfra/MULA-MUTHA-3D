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

export function isMobileOrLaptopGpu() {
  const r = gpuRendererName().toLowerCase();
  if (!r) return false;
  return /laptop|mobile|max-q|gtx 16|rtx 3050|rtx 2050|rtx 4050|iris|uhd|intel/.test(r);
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
  if (hasDiscreteGpu() && !isMobileOrLaptopGpu()) return false;
  const memoryGb = Number(navigator.deviceMemory || 0);
  return (memoryGb > 0 && memoryGb <= 8) || isIntegratedGpu() || isMobileOrLaptopGpu();
}

/** Lite DTM/OSM only on constrained machines, production hosts, or mobile/integrated GPUs. */
export function shouldUseLiteAssets() {
  try {
    if (new URLSearchParams(location.search).has("fullTerrain")) return false;
    if (new URLSearchParams(location.search).has("lite")) return true;
  } catch {
    /* ignore */
  }
  return (
    isProductionHost() ||
    isMobileOrLaptopGpu() ||
    isIntegratedGpu() ||
    isModestRamDevice() ||
    isLowMemoryDevice()
  );
}

function readForcedTier() {
  const q = new URLSearchParams(location.search);
  const v = (q.get("quality") || q.get("perf") || "").toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return null;
}

export function createQualityProfile() {
  const forced = readForcedTier();
  // On production or laptop/mobile GPUs, default to smooth 60fps "medium" profile
  // All features (trees, models, water shaders, fish, labels) stay visible; heavy tree shadow maps are omitted.
  let defaultTier = "medium";
  if (hasDiscreteGpu() && !isMobileOrLaptopGpu() && !isProductionHost()) {
    defaultTier = "high";
  }

  let tier = forced || defaultTier;

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
      if (fpsSamples.length > 30) fpsSamples.shift();
      const now = performance.now();
      if (now - lastAdapt < 1500 || fpsSamples.length < 18) return;
      lastAdapt = now;
      const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
      if (avg < 45 && tier === "high") {
        tier = "medium";
        fpsSamples = [];
        console.info("[perf] Switched to smooth profile (shadows disabled, full visual features retained)");
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
      maxTrees: 2000,
      maxVegTypeTrees: 2800,
      treeShadows: false,
      enableVegApi: true,
      enableFishing: true,
      vegTypeStepM: 48,
      lightTreesOnly: true,
    };
  }
  if (tier === "medium") {
    return {
      tier,
      pixelRatioMax: 1.0,
      antialias: true,
      shadows: false,
      shadowMapSize: 1024,
      preserveDrawingBuffer: false,
      targetFps: 60,
      labelHz: 12,
      lodHz: 6,
      chainageHz: 14,
      coordLabelHz: 6,
      softShadow: false,
      maxTrees: 3800,
      maxVegTypeTrees: 5200,
      treeShadows: false,
      enableVegApi: true,
      enableFishing: true,
      vegTypeStepM: 38,
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
    maxTrees: 11000,
    maxVegTypeTrees: 15000,
    treeShadows: true,
    enableVegApi: true,
    enableFishing: true,
    vegTypeStepM: 28,
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
