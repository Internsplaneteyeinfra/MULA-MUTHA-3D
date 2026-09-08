/**
 * Flood geometry helpers — CRS alignment, bounds, river proximity.
 * Does not invent flood extent; only operates on API-returned masks.
 */

import { lonLatToLocal, localToLonLat } from "../geo/geoReference.js";

/**
 * LatLonBox → local-space AABB corners.
 * @param {{ west:number, east:number, north:number, south:number }} box
 */
export function overlayBoxToLocalBounds(box) {
  const corners = [
    lonLatToLocal(box.west, box.north),
    lonLatToLocal(box.east, box.north),
    lonLatToLocal(box.east, box.south),
    lonLatToLocal(box.west, box.south),
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
    spanX: Math.max(1, maxX - minX),
    spanZ: Math.max(1, maxZ - minZ),
  };
}

/**
 * Sample flood mask at local XZ using overlay georeference.
 * @returns {0|1}
 */
export function sampleMaskAtLocal(x, z, overlay, mask, width, height) {
  try {
    const ll = localToLonLat(x, z);
    const lonSpan = overlay.east - overlay.west;
    const latSpan = overlay.north - overlay.south;
    if (!lonSpan || !latSpan) return 0;
    const iu = (ll.lon - overlay.west) / lonSpan;
    const iv = (overlay.north - ll.lat) / latSpan;
    if (iu < 0 || iu > 1 || iv < 0 || iv > 1) return 0;
    const px = Math.min(width - 1, Math.max(0, Math.floor(iu * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(iv * height)));
    return mask[py * width + px] > 0.5 ? 1 : 0;
  } catch {
    return 0;
  }
}

/** Nearest distance to river centerline samples [x,z,x,z,...]. */
export function nearestRiverDistance(x, z, riverPts) {
  let best = Infinity;
  for (let i = 0; i < riverPts.length; i += 2) {
    const dx = riverPts[i] - x;
    const dz = riverPts[i + 1] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/**
 * Crop mask pixel bounds to flooded cells (+ pad).
 * @returns {{ px0:number, px1:number, py0:number, py1:number, count:number } | null}
 */
export function floodMaskBounds(mask, width, height, pad = 3) {
  let px0 = width;
  let px1 = 0;
  let py0 = height;
  let py1 = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] < 0.5) continue;
      count += 1;
      if (x < px0) px0 = x;
      if (x > px1) px1 = x;
      if (y < py0) py0 = y;
      if (y > py1) py1 = y;
    }
  }
  if (!count || px1 < px0) return null;
  return {
    px0: Math.max(0, px0 - pad),
    py0: Math.max(0, py0 - pad),
    px1: Math.min(width - 1, px1 + pad),
    py1: Math.min(height - 1, py1 + pad),
    count,
  };
}

/**
 * Map cropped pixel box → geographic LatLonBox.
 */
export function cropOverlayBox(overlay, crop, width, height) {
  const lonSpan = overlay.east - overlay.west;
  const latSpan = overlay.north - overlay.south;
  return {
    west: overlay.west + (crop.px0 / width) * lonSpan,
    east: overlay.west + ((crop.px1 + 1) / width) * lonSpan,
    north: overlay.north - (crop.py0 / height) * latSpan,
    south: overlay.north - ((crop.py1 + 1) / height) * latSpan,
  };
}
