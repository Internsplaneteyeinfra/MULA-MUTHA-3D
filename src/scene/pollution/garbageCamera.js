/**
 * Oblique aerial camera focus on a garbage record — reuses drainage-flight style.
 * Does NOT use main-river chainage fly.
 */

/**
 * @param {object} record
 * @param {{ isMap2D?: boolean, mapLookY?: number }} [opts]
 * @returns {{ toP: {x:number,y:number,z:number}, toL: {x:number,y:number,z:number}, durMs: number, fov?: number }}
 */
export function computeGarbageCameraPose(record, opts = {}) {
  const x = record.x ?? record.homeX;
  const z = record.z ?? record.homeZ;
  const y = record.y ?? record.baseY ?? 9.5;

  const fx = record.flowDirection?.x ?? 1;
  const fz = record.flowDirection?.z ?? 0;
  // Side offset (perpendicular to flow) for GIS oblique view
  const px = -fz;
  const pz = fx;
  const plen = Math.hypot(px, pz) || 1;
  const nx = px / plen;
  const nz = pz / plen;

  if (opts.isMap2D) {
    const height = Math.max(opts.cameraY || 500, (opts.mapLookY ?? 9.4) + 400);
    return {
      toP: { x, y: height, z },
      toL: { x, y: opts.mapLookY ?? 9.4, z },
      durMs: 900,
    };
  }

  const dist = 48;
  const height = 26;
  const lookLift = 3;
  return {
    toP: {
      x: x + nx * dist - fx * 12,
      y: y + height,
      z: z + nz * dist - fz * 12,
    },
    toL: { x, y: y + lookLift, z },
    durMs: 850,
    fov: 50,
  };
}
