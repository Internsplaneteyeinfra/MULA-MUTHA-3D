import * as THREE from "three";
import { createRiverFish, orientFishAlong } from "./FishMesh.js";
import { state } from "../../state.js";
import { SURFACE_Y } from "../../scene/river.js";

const COLORS = [
  0xc98b42, 0x9f6b32, 0xd09a4c, 0xb88848, 0xc4a060,
  0xa87840, 0x8a6a48, 0xbfb090, 0xad8a58, 0xd4a868,
  0xb09060, 0x9a7848, 0xc8a050, 0x887050, 0xbb9850,
];

/** Camera-relative slots for 19–22s fish scene (FG / mid / BG). */
const UNDERWATER_SLOTS = [
  { along: 2.4, lat: -1.5, yOff: -0.15, dir: 0.85, large: true },
  { along: 2.9, lat: 0.35, yOff: 0.05, dir: 1.0, large: true },
  { along: 3.3, lat: 1.25, yOff: -0.1, dir: 0.75, large: true },
  { along: 3.8, lat: -0.45, yOff: 0.0, dir: 1.1, large: true },
  { along: 5.2, lat: -0.9, yOff: -0.25, dir: 0.6 },
  { along: 5.8, lat: 0.75, yOff: 0.1, dir: -0.35 },
  { along: 6.1, lat: -1.35, yOff: 0.05, dir: 0.45 },
  { along: 6.5, lat: 1.05, yOff: -0.15, dir: 0.9 },
  { along: 7.0, lat: 0.0, yOff: 0.2, dir: -0.55 },
  { along: 7.8, lat: -1.1, yOff: -0.2, dir: 0.5 },
  { along: 8.5, lat: 0.55, yOff: 0.05, dir: 0.7 },
  { along: 9.2, lat: -0.35, yOff: -0.1, dir: -0.25 },
  { along: 10.0, lat: 1.2, yOff: 0.15, dir: 0.4 },
  { along: 10.8, lat: -0.75, yOff: -0.05, dir: 0.95 },
  { along: 11.5, lat: 0.2, yOff: 0.08, dir: -0.65 },
];

/**
 * 15 large, visible fish following the KML centerline.
 * During cinematic fish scene (19–22s) they spread across the camera frustum.
 */
export function createRiverCenterlineFish(dataset) {
  const group = new THREE.Group();
  group.name = "riverCenterlineFish";

  const stations = dataset.corridor?.stations || [];
  if (stations.length < 4) {
    return { group, update() {}, dispose() {} };
  }

  const curve = buildRiverCurve(stations);
  const actors = [];

  const specs = [
    // upper water layer (4)
    { layer: "upper", depth: 0.75, scale: 1.55, speed: 0.008 },
    { layer: "upper", depth: 0.95, scale: 1.65, speed: 0.0075 },
    { layer: "upper", depth: 1.1, scale: 1.45, speed: 0.0085 },
    { layer: "upper", depth: 0.85, scale: 1.7, speed: 0.007 },
    // mid layer (6)
    { layer: "mid", depth: 1.8, scale: 1.4, speed: 0.009 },
    { layer: "mid", depth: 2.1, scale: 1.35, speed: 0.008 },
    { layer: "mid", depth: 2.4, scale: 1.5, speed: 0.0075 },
    { layer: "mid", depth: 1.95, scale: 1.3, speed: 0.0085 },
    { layer: "mid", depth: 2.25, scale: 1.42, speed: 0.0072 },
    { layer: "mid", depth: 2.55, scale: 1.38, speed: 0.0068 },
    // deep layer (5)
    { layer: "deep", depth: 3.0, scale: 1.25, speed: 0.0065 },
    { layer: "deep", depth: 3.25, scale: 1.2, speed: 0.006 },
    { layer: "deep", depth: 2.85, scale: 1.32, speed: 0.0068 },
    { layer: "deep", depth: 3.4, scale: 1.18, speed: 0.0058 },
    { layer: "deep", depth: 3.1, scale: 1.28, speed: 0.0062 },
  ];

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    actors.push(
      makeActor(curve, {
        index: i,
        layer: s.layer,
        scale: s.scale,
        color: COLORS[i % COLORS.length],
        swimSpeed: 0.32 + (i % 5) * 0.06,
        depthBelow: s.depth,
        progress: 0.05 + (i / specs.length) * 0.82,
        speed: s.speed,
        slot: UNDERWATER_SLOTS[i],
      }),
    );
  }

  for (const a of actors) group.add(a.fish);

  const _tan = new THREE.Vector3();
  const _pt = new THREE.Vector3();

  function update(dt) {
    if (!state.showFish) {
      group.visible = false;
      return;
    }
    group.visible = true;
    const time = state.elapsed || 0;
    const cam = state._cinematicCam;

    for (const a of actors) {
      a.progress = (a.progress + a.speed * dt * (a.fish.userData.swimSpeed || 0.4) * 12) % 1;

      if (state.cinematicFishScene && cam) {
        layoutFishInFrustum(a, cam, time);
        continue;
      }

      curve.getPointAt(a.progress, _pt);
      curve.getTangentAt(a.progress, _tan).normalize();

      const px = -_tan.z;
      const pz = _tan.x;
      const cluster = Math.sin(a.clusterPhase + time * 0.4) * a.clusterRadius;
      const x = _pt.x + px * (a.latOffset + cluster);
      const z = _pt.z + pz * (a.latOffset + cluster);

      let y = SURFACE_Y - a.depthBelow + Math.sin(time * (1.2 + a.phaseOffset) + a.fish.userData.swimPhase) * 0.12;
      let jumpPitch = 0;

      if (state.cinematicJumpCue && a.canJump && a.jumpCooldown <= 0) {
        a.jumping = true;
        a.jumpT = 0;
        a.jumpCooldown = 18;
      }
      if (a.jumpCooldown > 0) a.jumpCooldown -= dt;

      if (a.jumping) {
        a.jumpT += dt;
        const u = Math.min(1, a.jumpT / 0.85);
        const arc = 4 * u * (1 - u);
        y = SURFACE_Y + a.jumpHeight * arc;
        jumpPitch = THREE.MathUtils.lerp(0.4, -0.55, u);
        if (u >= 1) a.jumping = false;
      }

      a.fish.position.set(x, y, z);
      a.fish.userData.baseY = y;
      orientFishAlong(a.fish, _tan.x, _tan.z, time);
      if (jumpPitch) a.fish.rotateX(jumpPitch);
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

  return { group, update, dispose, actors, curve };
}

function makeActor(curve, opts) {
  const fish = createRiverFish({
    scale: opts.scale,
    color: opts.color,
    swimSpeed: opts.swimSpeed,
    y: SURFACE_Y - opts.depthBelow,
  });
  return {
    fish,
    index: opts.index,
    layer: opts.layer,
    depthBelow: opts.depthBelow,
    progress: opts.progress,
    speed: opts.speed,
    latOffset: (Math.random() - 0.5) * 10,
    clusterPhase: Math.random() * Math.PI * 2,
    clusterRadius: 1.2 + Math.random() * 2.5,
    phaseOffset: Math.random() * 2,
    canJump: opts.layer === "upper",
    jumping: false,
    jumpT: 0,
    jumpHeight: 1.0 + Math.random() * 0.7,
    jumpCooldown: 3 + Math.random() * 5,
    slot: opts.slot,
  };
}

function buildRiverCurve(stations) {
  const step = Math.max(1, Math.floor(stations.length / 80));
  const pts = [];
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    pts.push(new THREE.Vector3(s.x, SURFACE_Y, s.z));
  }
  const last = stations[stations.length - 1];
  pts.push(new THREE.Vector3(last.x, SURFACE_Y, last.z));
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.15);
}

function layoutFishInFrustum(actor, cam, time) {
  const slot = actor.slot || UNDERWATER_SLOTS[actor.index % UNDERWATER_SLOTS.length];
  const fx = cam.fx || 0;
  const fz = cam.fz || 1;
  const fl = Math.hypot(fx, fz) || 1;
  const nx = fx / fl;
  const nz = fz / fl;
  const px = -nz;
  const pz = nx;

  const swayLat = Math.sin(time * (0.9 + actor.phaseOffset) + actor.fish.userData.swimPhase) * 0.35;
  const swayAlong = Math.sin(time * 0.55 + actor.phaseOffset * 2) * 0.25;
  const lat = slot.lat + swayLat;
  const along = slot.along + swayAlong;

  const x = cam.x + nx * along + px * lat;
  const z = cam.z + nz * along + pz * lat;
  const y = THREE.MathUtils.clamp(
    (cam.y || SURFACE_Y - 2) + slot.yOff + Math.sin(time * 1.4 + actor.phaseOffset) * 0.08,
    SURFACE_Y - 3.8,
    SURFACE_Y - 0.35,
  );

  // Mixed headings: some toward camera, some lateral, some away
  const dirW = slot.dir + Math.sin(time * 0.7 + actor.phaseOffset) * 0.2;
  const dirX = nx * dirW + px * Math.sin(time * 0.5 + actor.index);
  const dirZ = nz * dirW + pz * Math.sin(time * 0.5 + actor.index);

  actor.fish.position.set(x, y, z);
  orientFishAlong(actor.fish, dirX, dirZ, time);
}
