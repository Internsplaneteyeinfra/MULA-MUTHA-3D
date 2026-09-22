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

export function isLowMemoryDevice() {
  const memoryGb = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  const narrowTouchDevice = navigator.maxTouchPoints > 0 && window.innerWidth < 900;
  return (memoryGb > 0 && memoryGb <= 4) || (cores > 0 && cores <= 4) || narrowTouchDevice;
}

function readForcedTier() {
  const q = new URLSearchParams(location.search);
  const v = (q.get("quality") || q.get("perf") || "").toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return null;
}

export function createQualityProfile() {
  const forced = readForcedTier();
  // Default medium for smooth UX; low on weak/remote; high only when forced
  let tier =
    forced ||
    (isLowMemoryDevice() || isLikelySharedOrRemote() ? "low" : "medium");

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
    /** Call once per rendered frame with dt seconds. Auto-downgrades if FPS tanks. */
    noteFrame(dt) {
      if (forced || tier === "low") return;
      if (!dt || dt <= 0 || dt > 0.25) return;
      const fps = 1 / dt;
      fpsSamples.push(fps);
      if (fpsSamples.length > 40) fpsSamples.shift();
      const now = performance.now();
      if (now - lastAdapt < 2000 || fpsSamples.length < 25) return;
      lastAdapt = now;
      const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
      if (avg < 32 && tier === "high") {
        tier = "medium";
        fpsSamples = [];
        console.info("[perf] Auto quality → medium (avg FPS", avg.toFixed(0), ")");
      } else if (avg < 26 && tier === "medium") {
        tier = "low";
        fpsSamples = [];
        console.info("[perf] Auto quality → low (avg FPS", avg.toFixed(0), ")");
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
      labelHz: 6,
      lodHz: 4,
      chainageHz: 8,
      coordLabelHz: 3,
      softShadow: false,
      maxTrees: 1200,
      maxVegTypeTrees: 1800,
      treeShadows: false,
      enableVegApi: false,
      enableFishing: false,
      vegTypeStepM: 72,
      lightTreesOnly: true,
    };
  }
  if (tier === "medium") {
    return {
      tier,
      pixelRatioMax: 1.15,
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
      maxTrees: 2800,
      maxVegTypeTrees: 3500,
      treeShadows: false,
      enableVegApi: false,
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
