/**
 * Subtle water ripple / waste indicators — one shared update path.
 */
import * as THREE from "three";
import { LOD } from "./garbageLOD.js";

export function createGarbageEffects() {
  const root = new THREE.Group();
  root.name = "garbageEffects";
  root.frustumCulled = false;

  const rippleGeo = new THREE.RingGeometry(1.2, 3.8, 24);
  rippleGeo.rotateX(-Math.PI / 2);
  const particleGeo = new THREE.SphereGeometry(0.12, 6, 4);

  /** @type {{ record:object, ripple:THREE.Mesh, particles:THREE.Group, baseY:number }[]} */
  let items = [];
  let enabled = true;

  function build(records) {
    clear();
    for (const r of records) {
      if (!r.onWater && r.associationStatus !== "Near River") continue;

      const rippleMat = new THREE.MeshBasicMaterial({
        color: "#7ec8e8",
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ripple = new THREE.Mesh(rippleGeo, rippleMat);
      ripple.position.set(r.homeX, r.baseY + 0.02, r.homeZ);
      ripple.visible = false;
      ripple.renderOrder = 30;
      root.add(ripple);

      const particles = new THREE.Group();
      particles.visible = false;
      const pMat = new THREE.MeshBasicMaterial({
        color: "#c9b896",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      for (let i = 0; i < 4; i++) {
        const p = new THREE.Mesh(particleGeo, pMat);
        const a = r.phase + i * 1.4;
        p.position.set(Math.cos(a) * 1.5, 0.4, Math.sin(a) * 1.5);
        p.userData.a = a;
        particles.add(p);
      }
      particles.position.set(r.homeX, r.baseY, r.homeZ);
      root.add(particles);

      items.push({ record: r, ripple, particles, baseY: r.baseY });
    }
  }

  /**
   * @param {number} time
   * @param {string} lod
   * @param {string|null} selectedId
   * @param {Map<string, {x:number,y:number,z:number}>} positions
   */
  function update(time, lod, selectedId, positions) {
    if (!enabled) {
      for (const it of items) {
        it.ripple.visible = false;
        it.particles.visible = false;
      }
      return;
    }
    const showRipple = lod === LOD.NEAR || lod === LOD.VERY_NEAR;
    const showParticles = lod === LOD.VERY_NEAR;

    for (const it of items) {
      const pos = positions?.get(it.record.id);
      const x = pos?.x ?? it.record.homeX;
      const y = pos?.y ?? it.baseY;
      const z = pos?.z ?? it.record.homeZ;
      const isSel = it.record.id === selectedId;

      it.ripple.visible = showRipple || isSel;
      it.particles.visible = showParticles || isSel;

      if (it.ripple.visible) {
        it.ripple.position.set(x, y + 0.03, z);
        const k = 0.5 + 0.5 * Math.sin(time * 1.1 + it.record.phase);
        it.ripple.scale.setScalar(0.9 + k * 0.35 + (isSel ? 0.3 : 0));
        it.ripple.material.opacity = 0.12 + k * 0.16 + (isSel ? 0.12 : 0);
      }
      if (it.particles.visible) {
        it.particles.position.set(x, y, z);
        for (const p of it.particles.children) {
          const a = p.userData.a + time * 0.35;
          p.position.x = Math.cos(a) * 1.6;
          p.position.z = Math.sin(a) * 1.6;
          p.position.y = 0.35 + Math.sin(time * 1.4 + a) * 0.12;
        }
      }
    }
  }

  function clear() {
    while (root.children.length) {
      const c = root.children.pop();
      c.material?.dispose?.();
      if (c.isGroup) {
        c.traverse((o) => {
          o.material?.dispose?.();
        });
      }
    }
    items = [];
  }

  function dispose() {
    clear();
    rippleGeo.dispose();
    particleGeo.dispose();
  }

  return {
    root,
    build,
    update,
    setEnabled: (v) => {
      enabled = !!v;
    },
    dispose,
  };
}
