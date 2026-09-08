import * as THREE from "three";

/**
 * Low-poly irregular rock prototypes for InstancedMesh (GIS / aerial realism).
 * 6 variants — slight asymmetry, no spheres.
 */
export function createRockGeometries() {
  const geos = [];
  const seeds = [11, 29, 47, 73, 101, 131];
  for (let s = 0; s < seeds.length; s++) {
    const geo = new THREE.IcosahedronGeometry(1, s < 3 ? 1 : 2);
    const pos = geo.attributes.position;
    const rnd = mulberry32(seeds[s]);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const n = 0.72 + rnd() * 0.45;
      const squash = 0.55 + rnd() * 0.35;
      pos.setXYZ(
        i,
        x * n * (0.85 + rnd() * 0.35),
        y * n * squash,
        z * n * (0.8 + rnd() * 0.4),
      );
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    // Slight flatten so rocks sit stably
    geo.scale(1, 0.72, 1);
    geo.computeBoundingSphere();
    geos.push(geo);
  }
  return geos;
}

export function createRockMaterial() {
  return new THREE.MeshStandardMaterial({
    color: "#8a8680",
    roughness: 0.92,
    metalness: 0.04,
    flatShading: false,
  });
}

/** Warm / cool grey rock tint palette (unsaturated). */
export const ROCK_TINTS = [
  new THREE.Color("#9a9590"),
  new THREE.Color("#8a847c"),
  new THREE.Color("#7a756e"),
  new THREE.Color("#6e6a64"),
  new THREE.Color("#8a8074"),
  new THREE.Color("#7a7068"),
  new THREE.Color("#949088"),
  new THREE.Color("#6a6660"),
];

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
