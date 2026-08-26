import * as THREE from "three";
import { state } from "../../state.js";
import {
  bedYAt,
  pointInRing,
  nearestStation,
  lateralDistToCenterline,
  waterSurfaceYAt,
} from "./FishingZoneSystem.js";

const _dummy = new THREE.Object3D();

/** Jump phases: swim → approach → jump → land → swim */
const PHASE = {
  SWIM: "swim",
  APPROACH: "approach",
  JUMP: "jump",
  LAND: "land",
};

/** Geometry unit length along Z (matches FishMesh createFishGeometry). */
const GEO_UNIT = 1.28;

const LAYERS = ["surface", "mid", "bottom"];

/**
 * Continuous swimming across 3 depth layers + occasional surface jumps.
 */
export function updateFishBehavior(agents, dataset, ripples, dt) {
  const exag = state.depthExaggeration;
  const bridges = dataset.bridges || [];
  const stations = dataset.corridor.stations;
  const ring = dataset.ringLocal;
  const time = state.elapsed || 0;

  const cell = 10;
  const bins = new Map();
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a.school) continue;
    const key = `${Math.floor(a.x / cell)},${Math.floor(a.z / cell)}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(a);
  }

  for (const a of agents) {
    const zone = a.zone;
    a.wanderT += dt;
    a.jumpCooldown -= dt;
    a.depthChangeT = (a.depthChangeT ?? 4) - dt;

    const st = nearestStation(a.x, a.z, stations);
    let fx = st.flowX;
    let fz = st.flowZ;
    const flowLen = Math.hypot(fx, fz) || 1;
    fx /= flowLen;
    fz /= flowLen;

    const wander =
      Math.sin(a.wanderT * 0.65 + a.wanderPhase) * 0.45 +
      Math.sin(a.wanderT * 1.25 + a.wanderPhase * 2) * 0.28 +
      Math.sin(a.wanderT * 0.31 + a.swimPhase) * 0.18;
    let dx = fx * Math.cos(wander) - fz * Math.sin(wander);
    let dz = fx * Math.sin(wander) + fz * Math.cos(wander);

    dx += (a.homeX - a.x) * 0.01;
    dz += (a.homeZ - a.z) * 0.01;

    const distHome = Math.hypot(a.x - zone.x, a.z - zone.z);
    if (distHome > zone.radius * 0.95) {
      dx += (zone.x - a.x) * 0.08;
      dz += (zone.z - a.z) * 0.08;
    }

    const lat = lateralDistToCenterline(a.x, a.z, st);
    if (lat > st.halfWidth * 0.7) {
      dx += (st.x - a.x) * 0.12;
      dz += (st.z - a.z) * 0.12;
    }

    for (const b of bridges) {
      const d = Math.hypot(b.midX - a.x, b.midZ - a.z);
      if (d < 16) {
        dx -= ((b.midX - a.x) / (d + 0.1)) * 0.45;
        dz -= ((b.midZ - a.z) / (d + 0.1)) * 0.45;
      }
    }

    // Underwater beat: swim toward / across the camera path
    if (state.cinematicUnderwater && a.jumpPhase !== PHASE.JUMP) {
      const cam = state._cinematicCam;
      if (cam) {
        const pull = a.species.role === "large" ? 0.12 : 0.07;
        dx += (cam.x + (cam.fx || 0) * 14 - a.x) * pull;
        dz += (cam.z + (cam.fz || 0) * 14 - a.z) * pull;
      }
    }

    if (a.school) {
      const key = `${Math.floor(a.x / cell)},${Math.floor(a.z / cell)}`;
      const neighbors = bins.get(key) || [];
      let sepX = 0;
      let sepZ = 0;
      let aliX = 0;
      let aliZ = 0;
      let cohX = 0;
      let cohZ = 0;
      let n = 0;
      for (const o of neighbors) {
        if (o === a || o.zoneId !== a.zoneId) continue;
        // Prefer same depth layer for school cohesion
        if (o.depthLayer && a.depthLayer && o.depthLayer !== a.depthLayer) continue;
        const ddx = a.x - o.x;
        const ddz = a.z - o.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > 64 || d2 < 1e-6) continue;
        n++;
        const d = Math.sqrt(d2);
        if (d < 2.4) {
          sepX += ddx / d;
          sepZ += ddz / d;
        }
        aliX += Math.sin(o.yaw);
        aliZ += Math.cos(o.yaw);
        cohX += o.x;
        cohZ += o.z;
      }
      if (n) {
        dx += sepX * 0.42;
        dz += sepZ * 0.42;
        dx += (aliX / n) * 0.16;
        dz += (aliZ / n) * 0.16;
        dx += (cohX / n - a.x) * 0.045;
        dz += (cohZ / n - a.z) * 0.045;
      }
    }

    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const spdMul = a.jumpPhase === PHASE.JUMP ? 1.25 : 1;
    const turn = a.turnRate ?? 1;
    const spd = a.speed * (0.85 + state.flowSpeed * 0.35) * spdMul;
    a.vx = THREE.MathUtils.lerp(a.vx, dx * spd, 1 - Math.exp(-dt * 1.4 * turn));
    a.vz = THREE.MathUtils.lerp(a.vz, dz * spd, 1 - Math.exp(-dt * 1.4 * turn));
    a.x += a.vx * dt;
    a.z += a.vz * dt;
    a.yaw = Math.atan2(a.vx, a.vz);

    if (!pointInRing(a.x, a.z, ring)) {
      a.x = THREE.MathUtils.lerp(a.x, zone.x, 0.4);
      a.z = THREE.MathUtils.lerp(a.z, zone.z, 0.4);
      a.vx *= -0.35;
      a.vz *= -0.35;
    }

    const surfaceY = waterSurfaceYAt(a.x, a.z, time);
    const bed = bedYAt(a.x, a.z, dataset, exag);
    const waterCol = Math.max(0.55, surfaceY - bed);

    // —— Dynamic depth: slow layer wander + target depth ——
    updateDepthTarget(a, waterCol, dt);

    const swimY = resolveSwimY(a, surfaceY, bed, waterCol);
    a.pitch = a.pitch ?? 0;
    if (!a.jumpPhase) a.jumpPhase = PHASE.SWIM;

    // Surface interaction — mainly surface-layer fish, infrequent
    if (a.jumpPhase === PHASE.SWIM && a.jumpCooldown <= 0) {
      const canJump =
        (a.depthLayer === "surface" || a.depthLayer === "mid") &&
        a.species.role !== "eel" &&
        a.species.role !== "bottom";
      const baseRate = a.species.role === "school" ? 0.003 : 0.0022;
      let rate = state.cinematicFishBoost && !state.cinematicJumpCue ? baseRate * 2.2 : baseRate;

      // Storyboard: only 1–3 jumps total, near camera, readable arc
      if (state.cinematicJumpCue && canJump) {
        if ((state.cinematicJumpBudget ?? 0) <= 0) {
          rate = 0;
        } else {
          const cam = state._cinematicCam;
          const nearCam = cam ? Math.hypot(a.x - cam.x, a.z - cam.z) < 70 : false;
          const preferLarge = a.species.role === "large" || a.species.lengthM > 1.2;
          rate = nearCam && preferLarge ? 0.006 : nearCam ? 0.0025 : 0;
        }
      }

      if (canJump && rate > 0 && Math.random() < rate) {
        if (state.cinematicJumpCue) {
          state.cinematicJumpBudget = Math.max(0, (state.cinematicJumpBudget || 0) - 1);
        }
        a.jumpPhase = PHASE.APPROACH;
        a.jumpT = 0;
        a.jumpHeight =
          (state.cinematicJumpCue ? 1.05 : 0.65) +
          Math.random() * (state.cinematicJumpCue ? 1.1 : 1.0) +
          a.species.lengthM * 0.12;
        a.jumpDuration = 0.52 + Math.random() * 0.28;
        a.jumpCooldown = state.cinematicJumpCue ? 30 : 10 + Math.random() * 20;
        if (state.cinematicJumpCue) a.depthLayer = "surface";
      }
    }

    // During underwater dive, bias depth targets toward viewer-readable bands
    if (state.cinematicUnderwater && a.jumpPhase === PHASE.SWIM) {
      a.targetDepthM = THREE.MathUtils.lerp(
        a.targetDepthM ?? 1.2,
        a.species.role === "bottom" ? Math.min(2.2, waterCol * 0.55) : 0.5 + (a.wanderPhase % 1) * 0.85,
        0.12,
      );
      if (a.species.role !== "bottom" && a.species.role !== "eel") {
        a.depthLayer = (a.wanderPhase % 1) < 0.55 ? "surface" : "mid";
      }
    }

    if (a.jumpPhase === PHASE.APPROACH) {
      a.jumpT += dt;
      const u = Math.min(1, a.jumpT / 0.4);
      a.y = THREE.MathUtils.lerp(a.y, surfaceY - 0.1, 1 - Math.exp(-dt * 7));
      a.pitch = THREE.MathUtils.lerp(a.pitch, -0.3, u);
      if (u >= 1) {
        a.jumpPhase = PHASE.JUMP;
        a.jumpT = 0;
        ripples?.spawn(a.x, surfaceY + 0.05, a.z, a.species.lengthM * 0.35);
      }
    } else if (a.jumpPhase === PHASE.JUMP) {
      a.jumpT += dt;
      const u = Math.min(1, a.jumpT / a.jumpDuration);
      const arc = 4 * u * (1 - u);
      a.y = surfaceY + a.jumpHeight * arc;
      a.pitch = THREE.MathUtils.lerp(0.5, -0.7, u);
      if (u >= 1) {
        a.jumpPhase = PHASE.LAND;
        a.jumpT = 0;
        a.y = surfaceY - 0.08;
        ripples?.spawn(a.x, surfaceY + 0.06, a.z, a.species.lengthM * 0.45);
      }
    } else if (a.jumpPhase === PHASE.LAND) {
      a.jumpT += dt;
      const u = Math.min(1, a.jumpT / 0.55);
      a.y = THREE.MathUtils.lerp(surfaceY - 0.08, swimY, u);
      a.pitch = THREE.MathUtils.lerp(a.pitch, 0, u);
      if (u >= 1) {
        a.jumpPhase = PHASE.SWIM;
        a.pitch = 0;
      }
    } else {
      // Smooth vertical swim toward layer target (no teleport)
      const vert = a.vertSpeed ?? 0.2;
      const bob = Math.sin(a.wanderT * 0.48 + a.wanderPhase) * (a.depthLayer === "surface" ? 0.05 : 0.1);
      a.y = THREE.MathUtils.lerp(a.y, swimY + bob, 1 - Math.exp(-dt * vert * 2.2));
      const climb = THREE.MathUtils.clamp((swimY - a.y) * 0.35, -0.25, 0.25);
      a.pitch = THREE.MathUtils.lerp(a.pitch, climb + Math.sin(a.wanderT * 1.8) * 0.04, 0.12);
    }

    if (a.jumpPhase !== PHASE.JUMP) {
      a.y = THREE.MathUtils.clamp(a.y, bed + 0.28, surfaceY - 0.12);
    }
    a.depthM = surfaceY - a.y;
  }
}

function updateDepthTarget(a, waterCol, dt) {
  // Occasionally pick a new depth within layer, or soft-transition toward adjacent layer
  if (a.depthChangeT <= 0) {
    a.depthChangeT = 3.5 + Math.random() * 9;

    // During aerial cinematic, keep more large/medium fish near the surface
    if (state.cinematicFishBoost && a.species.role !== "bottom" && a.species.role !== "eel") {
      if (Math.random() < 0.35) {
        a.depthLayer = "surface";
        assignLayerRanges(a, waterCol);
      }
    }

    // Rare layer transition (keeps vertical ecosystem lively)
    if (Math.random() < 0.18) {
      const idx = LAYERS.indexOf(a.depthLayer || "mid");
      const dir = Math.random() < 0.5 ? -1 : 1;
      const next = LAYERS[THREE.MathUtils.clamp(idx + dir, 0, LAYERS.length - 1)];
      // Bottom-only species stay near bed; large showcase prefer surface/mid
      if (a.species.role === "bottom" || a.species.role === "eel") {
        a.depthLayer = Math.random() < 0.7 ? "bottom" : "mid";
      } else if (a.species.role === "large" && Math.random() < 0.55) {
        a.depthLayer = Math.random() < 0.65 ? "surface" : "mid";
      } else {
        a.depthLayer = next;
      }
      assignLayerRanges(a, waterCol);
    }

    // New target within current layer range
    if (a.depthLayer === "bottom") {
      a.bedOffset = 0.3 + Math.random() * 0.7;
      a.bedOffset = Math.min(a.bedOffset, Math.max(0.3, waterCol * 0.35));
      a.targetDepthM = Math.max(0.4, waterCol - a.bedOffset);
    } else {
      const lo = a.depthMin ?? 0.2;
      const hi = a.depthMax ?? 0.6;
      a.targetDepthM = lo + Math.random() * Math.max(0.05, hi - lo);
    }
  }

  // Smoothly chase target depth
  const vert = a.vertSpeed ?? 0.2;
  a.depthM = THREE.MathUtils.lerp(a.depthM ?? a.targetDepthM, a.targetDepthM, 1 - Math.exp(-dt * vert));
}

function assignLayerRanges(a, waterCol) {
  if (a.depthLayer === "surface") {
    // Aerial-readable band: 0.3–0.8 m below surface
    a.depthMin = 0.3;
    a.depthMax = Math.min(0.8, waterCol * 0.5);
  } else if (a.depthLayer === "mid") {
    a.depthMin = Math.min(1.0, waterCol * 0.4);
    a.depthMax = Math.min(1.5, Math.max(a.depthMin + 0.15, waterCol - 0.4));
  } else {
    a.depthMin = Math.max(0.5, waterCol * 0.45);
    a.depthMax = Math.max(a.depthMin + 0.1, waterCol - 0.3);
  }
}

function resolveSwimY(a, surfaceY, bed, waterCol) {
  if (a.depthLayer === "bottom") {
    const above = THREE.MathUtils.clamp(a.bedOffset ?? 0.5, 0.3, Math.min(1.0, waterCol * 0.4));
    return THREE.MathUtils.clamp(bed + above, bed + 0.28, surfaceY - 0.2);
  }
  let d = a.depthM ?? a.targetDepthM ?? 0.5;
  if (a.depthLayer === "surface") {
    // Prefer upper layer during cinematic aerial pass
    const lo = state.cinematicFishBoost ? 0.3 : 0.2;
    const hi = state.cinematicFishBoost ? 0.8 : Math.min(0.6, waterCol * 0.5);
    d = THREE.MathUtils.clamp(d, lo, hi);
  } else {
    d = THREE.MathUtils.clamp(d, Math.min(1.0, waterCol * 0.35), Math.min(1.5, waterCol - 0.35));
  }
  return THREE.MathUtils.clamp(surfaceY - d, bed + 0.28, surfaceY - 0.12);
}

/**
 * World-scale fish: lengthM is visual meters; mild distance LOD boost for aerial readability.
 * Surface-layer fish get a slight scale bias so they stay readable from above.
 */
export function writeFishInstances(agents, camera = null) {
  const camY = camera?.position?.y ?? 40;
  const camX = camera?.position?.x ?? 0;
  const camZ = camera?.position?.z ?? 0;
  const heightBoost = THREE.MathUtils.clamp(1 + (camY - 40) / 400, 1, 2.4);

  for (const a of agents) {
    if (!a.mesh) continue;
    if (a.visible === false) {
      _dummy.position.set(a.x, a.y, a.z);
      _dummy.scale.set(0, 0, 0);
      _dummy.updateMatrix();
      a.mesh.setMatrixAt(a.instanceIndex, _dummy.matrix);
      continue;
    }
    const horiz = Math.hypot(a.x - camX, a.z - camZ);
    const distBoost = THREE.MathUtils.clamp(1 + (horiz - 80) / 600, 1, 2.2);
    const layerBias =
      a.depthLayer === "surface"
        ? state.cinematicFishBoost
          ? 1.22
          : 1.08
        : a.depthLayer === "bottom"
          ? 0.92
          : 1;
    const aerialBoost = state.cinematicActive
      ? THREE.MathUtils.clamp(1 + (camY - 200) / 500, 1.15, 2.6)
      : heightBoost;
    const underwaterBoost = state.cinematicUnderwater ? 1.85 : 1;
    const jumpBoost = state.cinematicJumpCue && a.depthLayer === "surface" ? 1.35 : 1;
    // During underwater, enlarge mid/surface zone fish that are near the camera
    let nearUw = 1;
    if (state.cinematicUnderwater && camera) {
      const d = Math.hypot(a.x - camX, a.z - camZ, (a.y - camY) * 0.5);
      if (d < 18 && a.depthLayer !== "bottom") nearUw = THREE.MathUtils.lerp(2.4, 1.15, d / 18);
    }
    const s =
      (a.species.lengthM / GEO_UNIT) *
      Math.max(aerialBoost, distBoost) *
      layerBias *
      underwaterBoost *
      jumpBoost *
      nearUw;
    _dummy.position.set(a.x, a.y, a.z);
    _dummy.rotation.set(a.pitch || 0, a.yaw, 0);
    _dummy.scale.set(s * 1.08, s * 0.78, s);
    _dummy.updateMatrix();
    a.mesh.setMatrixAt(a.instanceIndex, _dummy.matrix);
  }
  const seen = new Set();
  for (const a of agents) {
    if (!a.mesh || seen.has(a.mesh)) continue;
    seen.add(a.mesh);
    a.mesh.instanceMatrix.needsUpdate = true;
  }
}
