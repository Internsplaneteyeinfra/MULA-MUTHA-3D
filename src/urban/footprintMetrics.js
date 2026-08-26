/**
 * Footprint metrics from projected local coordinates (EPSG:32643 local frame).
 * Position always comes from geometry — never random.
 */

export function computeFootprintMetrics(building) {
  const verts = building.vertices || [];
  if (verts.length < 3) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let cx = 0;
  let cz = 0;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minZ = Math.min(minZ, v.z);
    maxZ = Math.max(maxZ, v.z);
    cx += v.x;
    cz += v.z;
  }
  cx /= verts.length;
  cz /= verts.length;

  // Oriented bounding box from longest edge (principal axis)
  let bestLen = 0;
  let yaw = 0;
  for (let i = 1; i < verts.length; i++) {
    const dx = verts[i].x - verts[i - 1].x;
    const dz = verts[i].z - verts[i - 1].z;
    const len = Math.hypot(dx, dz);
    if (len > bestLen) {
      bestLen = len;
      yaw = Math.atan2(dx, dz);
    }
  }

  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);
  let localMinU = Infinity;
  let localMaxU = -Infinity;
  let localMinV = Infinity;
  let localMaxV = -Infinity;
  for (const v of verts) {
    const dx = v.x - cx;
    const dz = v.z - cz;
    const u = dx * cos - dz * sin;
    const vv = dx * sin + dz * cos;
    localMinU = Math.min(localMinU, u);
    localMaxU = Math.max(localMaxU, u);
    localMinV = Math.min(localMinV, vv);
    localMaxV = Math.max(localMaxV, vv);
  }

  const lengthM = Math.max(4, localMaxU - localMinU);
  const widthM = Math.max(4, localMaxV - localMinV);
  const areaM2 = polygonArea(verts);
  const aspect = lengthM / Math.max(1e-3, widthM);

  return {
    centroidX: cx,
    centroidZ: cz,
    lengthM,
    widthM,
    heightM: resolveHeight(building),
    areaM2,
    aspect,
    yaw,
    aabb: { minX, maxX, minZ, maxZ },
  };
}

function resolveHeight(building) {
  if (Number.isFinite(building.heightM) && building.heightM > 1.5) {
    return Math.min(90, building.heightM);
  }
  const levels = Number(building.levels);
  if (Number.isFinite(levels) && levels > 0) {
    return Math.min(90, levels * 3.1);
  }
  return null;
}

function polygonArea(verts) {
  let a = 0;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    a += verts[j].x * verts[i].z - verts[i].x * verts[j].z;
  }
  return Math.abs(a) * 0.5;
}
