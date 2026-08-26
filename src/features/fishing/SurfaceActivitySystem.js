import * as THREE from "three";

/**
 * Pooled surface ripple rings at water surface elevation.
 */
export function createSurfaceActivitySystem() {
  const group = new THREE.Group();
  group.name = "fishRipples";
  const MAX = 48;
  const geo = new THREE.RingGeometry(0.2, 0.55, 28);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: "#d8f0f8",
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  mesh.count = 0;
  group.add(mesh);

  const pool = Array.from({ length: MAX }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    age: 0,
    life: 1.4,
    scale: 1,
  }));

  const dummy = new THREE.Object3D();

  function spawn(x, y, z, sizeHint = 0.4) {
    const slot = pool.find((p) => !p.active) || pool[Math.floor(Math.random() * MAX)];
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.age = 0;
    slot.life = 0.9 + Math.random() * 0.7;
    slot.scale = 0.9 + sizeHint * 2.8;
  }

  function update(dt) {
    let count = 0;
    for (const p of pool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      const t = p.age / p.life;
      const s = p.scale * (0.35 + t * 4.2);
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.set(s, 1, s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mat.opacity = 0.55 * (1 - count / (MAX + 1) * 0.15);
  }

  return { group, spawn, update };
}
