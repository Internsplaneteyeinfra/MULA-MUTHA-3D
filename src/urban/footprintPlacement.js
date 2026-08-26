import { terrainHeightAt } from "../scene/terrain.js";

/**
 * Place a classified footprint into world transforms.
 * Geographic X/Z from centroid; Y from terrain sample.
 * Scale preserves footprint W/L and classified height — mild non-uniform only.
 */
export function placementFromFootprint(metrics, classification, proto) {
  const sx = metrics.lengthM / Math.max(0.1, proto.nativeW);
  const sz = metrics.widthM / Math.max(0.1, proto.nativeD);
  // Avoid extreme squash: blend toward uniform plan scale
  const plan = (sx + sz) * 0.5;
  const planSx = THREE_CLAMP(sx, plan * 0.72, plan * 1.35);
  const planSz = THREE_CLAMP(sz, plan * 0.72, plan * 1.35);
  const sy = classification.heightM / Math.max(0.1, proto.nativeH);

  const y = terrainHeightAt(metrics.centroidX, metrics.centroidZ, placementStations);
  return {
    x: metrics.centroidX,
    y,
    z: metrics.centroidZ,
    yaw: metrics.yaw,
    scaleX: planSx,
    scaleY: THREE_CLAMP(sy, 0.55, 2.8),
    scaleZ: planSz,
  };
}

/** Injected corridor stations for terrain sampling (set before placement). */
let placementStations = [];

export function setPlacementStations(stations) {
  placementStations = stations;
}

function THREE_CLAMP(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function sampleFootprintElevation(metrics, stations) {
  const pts = [
    [metrics.centroidX, metrics.centroidZ],
    [metrics.aabb.minX, metrics.aabb.minZ],
    [metrics.aabb.maxX, metrics.aabb.minZ],
    [metrics.aabb.minX, metrics.aabb.maxZ],
    [metrics.aabb.maxX, metrics.aabb.maxZ],
  ];
  let sum = 0;
  for (const [x, z] of pts) sum += terrainHeightAt(x, z, stations);
  return sum / pts.length;
}
