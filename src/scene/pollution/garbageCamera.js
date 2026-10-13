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

  // Across-channel unit vector pointing toward opposite bank:
  // With forward = (fz, -fx), the river flow (fx, fz) is oriented to the camera's right.
  // Camera stands on the near bank (-across: -fz, +fx) looking across (+fz, -fx),
  // framing upstream landmarks on the LEFT and downstream landmarks on the RIGHT.
  const acrossX = fz;
  const acrossZ = -fx;

  // Elevated oblique perspective matching user reference screenshot:
  // - acrossOffset ~190m back on the south/near bank (reveals 3 arches of Ambedkar Bridge + Bund Garden on left)
  // - alongOffset ~15m (centers the river channel between Ambedkar and Fitzgerald bridges)
  // - height ~85m elevation above water/ground (gives optimal ~24° oblique depression angle)
  const acrossOffset = 190;
  const alongOffset = 15;
  const height = 85;
  const lookLift = 2.0;

  return {
    toP: {
      x: x + fx * alongOffset - acrossX * acrossOffset,
      y: y + height,
      z: z + fz * alongOffset - acrossZ * acrossOffset,
    },
    toL: { x, y: y + lookLift, z },
    durMs: 1400,
    fov: 48,
  };
}

