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

  if (opts.isMap2D) {
    const height = Math.max(opts.cameraY || 500, (opts.mapLookY ?? 9.4) + 400);
    return {
      toP: { x, y: height, z },
      toL: { x, y: opts.mapLookY ?? 9.4, z },
      durMs: 900,
    };
  }

  // River flow unit vector (pointing downstream):
  const flen = Math.hypot(record.flowDirection?.x ?? 1, record.flowDirection?.z ?? 0) || 1;
  const fx = (record.flowDirection?.x ?? 1) / flen;
  const fz = (record.flowDirection?.z ?? 0) / flen;

  // Across-channel unit vector perpendicular to flow:
  const px = -fz;
  const pz = fx;

  // Close water-corridor perspective looking downstream along the river:
  // - alongOffset -38m (upstream so camera looks downstream toward pollution)
  // - sideOffset 18m (gentle lateral offset: water fills lower frame, pollution fills center)
  // - height 12m above water surface (very intimate, water-level-like angle)
  // - lookLift 2.5m (look slightly above site base so pollution pile is centered in frame)
  // - fov 55° (wider FOV captures surrounding water context while keeping pollution prominent)
  const alongOffset = -38;
  const sideOffset = 18;
  const height = 12;
  const lookLift = 2.5;

  return {
    toP: {
      x: x + fx * alongOffset + px * sideOffset,
      y: y + height,
      z: z + fz * alongOffset + pz * sideOffset,
    },
    toL: { x, y: y + lookLift, z },
    durMs: 1400,
    fov: 55,
  };
}

