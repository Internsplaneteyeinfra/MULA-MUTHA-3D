import * as THREE from "three";
import { createRiverFish, orientFishAlong } from "./FishMesh.js";
import { state } from "../../state.js";
import { SURFACE_Y } from "../../scene/river.js";

/**
 * Extra large foreground fish during underwater cinematic beat.
 * Uses createRiverFish; positioned near camera (does not move KML geometry).
 */
export function createCinematicFishShowcase() {
  const group = new THREE.Group();
  group.name = "cinematicFishShowcase";
  group.visible = false;

  const specs = [
    { scale: 2.1, color: 0xc98b42, along: 1.2, lat: -0.5, depth: 0.5 },
    { scale: 1.85, color: 0x9f6b32, along: 1.7, lat: 0.55, depth: 0.9 },
    { scale: 1.45, color: 0xd09a4c, along: 4.5, lat: -0.2, depth: 1.6 },
  ];

  const actors = specs.map((s, i) => {
    const fish = createRiverFish({
      scale: s.scale,
      color: s.color,
      swimSpeed: 0.4 + i * 0.05,
    });
    fish.visible = false;
    group.add(fish);
    return {
      fish,
      along: s.along,
      lat: s.lat,
      depth: s.depth,
      phase: Math.random() * Math.PI * 2,
    };
  });

  let fade = 0;

  function update(dt) {
    const uw = state.cinematicUnderwater;
    const cam = state._cinematicCam;
    const target = uw && cam ? 1 : 0;
    fade = THREE.MathUtils.lerp(fade, target, 1 - Math.exp(-dt * (uw ? 3.5 : 5)));
    group.visible = fade > 0.02;
    if (!group.visible || !cam) {
      for (const a of actors) a.fish.visible = false;
      return;
    }

    const fx = cam.fx || 0;
    const fz = cam.fz || 1;
    const fl = Math.hypot(fx, fz) || 1;
    const nx = fx / fl;
    const nz = fz / fl;
    const px = -nz;
    const pz = nx;
    const t = state.elapsed || 0;

    for (const a of actors) {
      a.fish.visible = true;
      const sway = Math.sin(t * 1.2 + a.phase) * 0.15;
      const x = cam.x + nx * a.along + px * (a.lat + sway);
      const z = cam.z + nz * a.along + pz * (a.lat + sway);
      const y = THREE.MathUtils.clamp(
        cam.y + Math.sin(t * 1.5 + a.phase) * 0.1 - a.depth * 0.15,
        SURFACE_Y - 3.6,
        SURFACE_Y - 0.35,
      );
      a.fish.position.set(x, y, z);
      orientFishAlong(a.fish, nx, nz, t);
      a.fish.traverse((obj) => {
        if (obj.material && obj.material.opacity != null) {
          obj.material.transparent = fade < 0.98;
          obj.material.opacity = fade;
        }
      });
    }
  }

  function dispose() {
    for (const a of actors) {
      a.fish.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    }
  }

  return { group, update, dispose };
}
