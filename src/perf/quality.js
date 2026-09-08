/**
 * Adaptive render quality — shared/remote sessions struggle with full GPU settings.
 *
 * Force modes via URL:
 *   ?quality=low   — shared-port / weak GPU profile
 *   ?quality=high  — full local quality
 *   (default auto) — low when hostname isn't localhost, else high + FPS fallback
 */

function isLikelySharedOrRemote() {
  const h = location.hostname || "";
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return false;
  // Cursor / tunnel / LAN share URLs
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
  let tier = forced || (isLikelySharedOrRemote() || isLowMemoryDevice() ? "low" : "high");

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
      if (!dt || dt <= 0 || dt > 0.2) return;
      const fps = 1 / dt;
      fpsSamples.push(fps);
      if (fpsSamples.length > 45) fpsSamples.shift();
      const now = performance.now();
      if (now - lastAdapt < 2500 || fpsSamples.length < 30) return;
      lastAdapt = now;
      const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
      if (avg < 28 && tier === "high") {
        tier = "medium";
        console.info("[perf] Auto quality → medium (avg FPS", avg.toFixed(0), ")");
      } else if (avg < 22 && tier === "medium") {
        tier = "low";
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
      labelHz: 8,
      lodHz: 6,
      chainageHz: 10,
      coordLabelHz: 4,
      softShadow: false,
    };
  }
  if (tier === "medium") {
    return {
      tier,
      pixelRatioMax: 1.25,
      antialias: true,
      shadows: true,
      shadowMapSize: 1024,
      preserveDrawingBuffer: false,
      targetFps: 45,
      labelHz: 12,
      lodHz: 8,
      chainageHz: 15,
      coordLabelHz: 8,
      softShadow: false,
    };
  }
  return {
    tier: "high",
    pixelRatioMax: 1.5,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    preserveDrawingBuffer: false,
    targetFps: 60,
    labelHz: 20,
    lodHz: 12,
    chainageHz: 30,
    coordLabelHz: 15,
    softShadow: true,
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
