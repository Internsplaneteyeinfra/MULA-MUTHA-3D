import * as THREE from "three";
import { state } from "../state.js";
import { SURFACE_Y } from "../scene/river.js";
import {
  alongRiverPose,
  fullRiverOverviewPose,
  heightForWidth,
  smoothTangent,
  terrainCameraOpts,
} from "../scene/riverCamera.js";

export const CINEMATIC_DURATION = 30;

/**
 * Master 30s continuous cinematic — KML corridor path, mostly forward drone motion.
 * Storyboard: start flow → fish jumps → buildings → bridge → underwater →
 * banks/trees → surface journey → final overview.
 */
export function createCinematicController({
  camera,
  controls,
  dataset,
  getRiverMaterial,
  waterEffects,
  flowParticles,
  onComplete,
}) {
  const stations = dataset.corridor.stations;
  const b =
    dataset.activeSceneBounds ||
    dataset.kmlOverviewBounds ||
    dataset.sceneBounds ||
    sceneBounds(dataset);
  const dtmCam = terrainCameraOpts(dataset.dtm);
  const fishingZones = [];
  const diag = Math.hypot(b.spanX, b.spanZ);

  const s0 = stations[0];
  const s1 = stations[stations.length - 1];
  let axisX = s1.x - s0.x;
  let axisZ = s1.z - s0.z;
  const axisLen = Math.hypot(axisX, axisZ) || 1;
  axisX /= axisLen;
  axisZ /= axisLen;

  let active = false;
  let paused = false;
  let elapsed = 0;
  let locked = false;

  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const up = new THREE.Vector3(axisX, 0, axisZ);
  const smoothUp = new THREE.Vector3(axisX, 0, axisZ);
  const forward = new THREE.Vector3();
  const _fromP = new THREE.Vector3();
  const _fromL = new THREE.Vector3();
  const _toP = new THREE.Vector3();
  const _toL = new THREE.Vector3();
  const _qCur = new THREE.Quaternion();
  const _qTgt = new THREE.Quaternion();
  const _m = new THREE.Matrix4();

  const landmarks = resolveLandmarks(dataset, stations);

  function setFishingZones(zones) {
    fishingZones.length = 0;
    if (zones?.length) fishingZones.push(...zones);
  }

  function stationAt(u) {
    const t = THREE.MathUtils.clamp(u, 0, 0.995);
    const f = t * (stations.length - 1);
    const i = Math.floor(f);
    const k = f - i;
    const a = stations[i];
    const c = stations[Math.min(stations.length - 1, i + 1)];
    let fx = a.flowX + (c.flowX - a.flowX) * k;
    let fz = a.flowZ + (c.flowZ - a.flowZ) * k;
    const len = Math.hypot(fx, fz) || 1;
    return {
      x: a.x + (c.x - a.x) * k,
      z: a.z + (c.z - a.z) * k,
      flowX: fx / len,
      flowZ: fz / len,
      half: a.halfWidth + (c.halfWidth - a.halfWidth) * k,
      t,
    };
  }

  function setFlowUp(fx, fz) {
    const len = Math.hypot(fx, fz) || 1;
    up.set(fx / len, 0, fz / len);
  }

  function easeInOutCubic(t) {
    const k = THREE.MathUtils.clamp(t, 0, 1);
    return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
  }

  function easeInOutSine(t) {
    const k = THREE.MathUtils.clamp(t, 0, 1);
    return -(Math.cos(Math.PI * k) - 1) / 2;
  }

  /**
   * Stabilized drone pose: river-centered, bottom→top heading, almost no side offset.
   * lateralBiasM only for short bank glances (meters).
   */
  function aerialPose({
    u,
    height,
    pitchDeg = 52,
    lookAhead = 0.04,
    lookY = SURFACE_Y + 0.6,
    lateralBiasM = 0,
    outP,
    outL,
  }) {
    const st = stationAt(u);
    const h = height ?? heightForWidth(st.half, "medium");
    alongRiverPose(stations, {
      u,
      height: h,
      pitchDeg,
      lookAhead,
      lookY,
      lateralBiasM,
      outP,
      outL,
      outUp: up,
    });
  }

  function lerpPose(aP, aL, bP, bL, k, outP, outL) {
    outP.lerpVectors(aP, bP, k);
    outL.lerpVectors(aL, bL, k);
  }

  /**
   * Storyboard camera path — continuous 30s, no shake.
   * 0–4 water · 4–8 surface · 8–12 buildings · 12–16 bridge ·
   * 16–19 dive · 19–22 fish · 22–24 jump · 24–27 bank · 27–30 overview.
   */
  function cameraPose(p, outP, outL) {
    const t = p * CINEMATIC_DURATION;
    const bu = landmarks.buildingU;
    const bridgeU = landmarks.bridgeU;
    const treeSide = landmarks.treeSide;
    const buildSide = landmarks.buildSide;

    // —— 0–4s: water starts at upstream ——
    if (t < 4) {
      const k = easeInOutSine(t / 4);
      const u = THREE.MathUtils.lerp(0.01, 0.08, k);
      aerialPose({
        u,
        height: THREE.MathUtils.lerp(72, 88, k),
        pitchDeg: 50,
        lookAhead: 0.05,
        outP,
        outL,
      });
      return;
    }

    // —— 4–8s: fishing-point flyover — close enough for screen-visible fish ——
    if (t < 8) {
      const k = easeInOutCubic((t - 4) / 4);
      const picks = pickFishingBeats(fishingZones, stations, 0.06, 0.45, 2);
      if (picks.length) {
        // Hold each point ~2s so jumps can complete on screen
        const hold = k < 0.5 ? 0 : 1;
        const focus = picks[Math.min(hold, picks.length - 1)];
        const localK = hold === 0 ? k / 0.5 : (k - 0.5) / 0.5;
        const nx = focus.flowX;
        const nz = focus.flowZ;
        const fl = Math.hypot(nx, nz) || 1;
        const fx = nx / fl;
        const fz = nz / fl;
        // ~10–12 m altitude, ~11–14 m back — FG fish at 6–12 m read as 40–100 px
        const height = THREE.MathUtils.lerp(11.5, 9.5, Math.sin(localK * Math.PI));
        const back = THREE.MathUtils.lerp(13, 11, localK);
        outP.set(focus.x - fx * back, SURFACE_Y + height, focus.z - fz * back);
        outL.set(focus.x + fx * 6, SURFACE_Y - 0.2, focus.z + fz * 6);
        setFlowUp(fx, fz);
        state.cinematicFishingPointFocus = { id: focus.id, x: focus.x, z: focus.z };
        return;
      }
      const u = THREE.MathUtils.lerp(0.08, 0.22, k);
      aerialPose({
        u,
        height: THREE.MathUtils.lerp(40, 28, k),
        pitchDeg: 48,
        lookAhead: 0.035,
        lookY: SURFACE_Y + 0.2,
        outP,
        outL,
      });
      state.cinematicFishingPointFocus = null;
      return;
    }

    // —— 8–12s: buildings + landscape ——
    if (t < 12) {
      const k = easeInOutCubic((t - 8) / 4);
      const u = THREE.MathUtils.lerp(0.22, Math.min(bu, 0.38), k);
      const bias = THREE.MathUtils.lerp(0, 18, easeInOutSine(k));
      aerialPose({
        u,
        height: THREE.MathUtils.lerp(58, 185, k),
        pitchDeg: 54,
        lookAhead: 0.04,
        lookY: SURFACE_Y + THREE.MathUtils.lerp(0.5, 6, k),
        lateralBiasM: bias * buildSide,
        outP,
        outL,
      });
      return;
    }

    // —— 12–16s: bridge / river landscape ——
    if (t < 16) {
      const k = easeInOutSine((t - 12) / 4);
      const u = THREE.MathUtils.lerp(Math.min(bu, 0.38), bridgeU, k);
      aerialPose({
        u,
        height: THREE.MathUtils.lerp(185, 110, k),
        pitchDeg: 50,
        lookAhead: 0.032,
        lookY: SURFACE_Y + 3,
        lateralBiasM: THREE.MathUtils.lerp(10, 0, k) * buildSide,
        outP,
        outL,
      });
      return;
    }

    // —— 16–19s: gradual descent toward water ——
    if (t < 19) {
      const k = easeInOutCubic((t - 16) / 3);
      const u = THREE.MathUtils.lerp(bridgeU, Math.min(0.995, bridgeU + 0.05), k * 0.65);
      if (k < 0.55) {
        const kk = easeInOutSine(k / 0.55);
        aerialPose({
          u,
          height: THREE.MathUtils.lerp(110, 24, kk),
          pitchDeg: 46,
          lookAhead: 0.028,
          outP: _fromP,
          outL: _fromL,
        });
        underwaterPose(u, 0.55, _toP, _toL, 1.05);
        lerpPose(_fromP, _fromL, _toP, _toL, kk, outP, outL);
      } else {
        const kk = easeInOutSine((k - 0.55) / 0.45);
        underwaterPose(u, THREE.MathUtils.lerp(0.55, 1.85, kk), outP, outL, THREE.MathUtils.lerp(1.05, 1.3, kk));
      }
      return;
    }

    // —— 19–22s: underwater fish school — slow travel through spaced school ——
    if (t < 22) {
      const k = (t - 19) / 3;
      const u = THREE.MathUtils.lerp(Math.min(0.995, bridgeU + 0.04), Math.min(0.995, bridgeU + 0.1), easeInOutSine(k));
      // Mid-depth look through midground (~12–14 m) — FG stays 5–8 m, never on lens
      underwaterPose(u, THREE.MathUtils.lerp(1.5, 1.7, easeInOutSine(k)), outP, outL, 1.25);
      return;
    }

    // —— 22–24s: rise toward surface + fish jumps ——
    if (t < 24) {
      const k = easeInOutCubic((t - 22) / 2);
      const u = THREE.MathUtils.lerp(Math.min(0.995, bridgeU + 0.08), Math.min(0.995, bridgeU + 0.12), k);
      underwaterPose(u, THREE.MathUtils.lerp(1.7, 0.25, k), _fromP, _fromL, 1.25);
      aerialPose({
        u,
        height: THREE.MathUtils.lerp(14, 95, k),
        pitchDeg: 50,
        lookAhead: 0.036,
        lookY: SURFACE_Y + 1.5,
        outP: _toP,
        outL: _toL,
      });
      lerpPose(_fromP, _fromL, _toP, _toL, easeInOutSine(k), outP, outL);
      return;
    }

    // —— 24–27s: riverbank / trees ——
    if (t < 27) {
      const k = easeInOutCubic((t - 24) / 3);
      const u = THREE.MathUtils.lerp(Math.min(0.995, bridgeU + 0.12), Math.min(0.995, bridgeU + 0.22), k);
      const bank = THREE.MathUtils.lerp(0, 32, easeInOutSine(k));
      aerialPose({
        u,
        height: THREE.MathUtils.lerp(95, 130, k),
        pitchDeg: 52,
        lookAhead: 0.04,
        lookY: SURFACE_Y + 2.5,
        lateralBiasM: bank * treeSide,
        outP,
        outL,
      });
      return;
    }

    // —— 27–30s: full KML overview (north-up) ——
    {
      const k = easeInOutCubic((t - 27) / 3);
      fullCorridorOverview(k, outP, outL);
      up.set(0, 1, 0);
    }
  }

  /** Pull back until the entire KML corridor fits in frame. */
  function fullCorridorOverview(k, outP, outL) {
    const fullBounds = dataset.kmlOverviewBounds || b;
    fullRiverOverviewPose(stations, fullBounds, k, outP, outL, up, {
      fovDeg: camera.fov,
      aspect: Math.max(0.5, camera.aspect || 16 / 9),
      fullExtent: true,
      ...dtmCam,
    });
  }

  /** Underwater: mid-column, look into staggered school (~8–18 m ahead) — never into FG faces. */
  function underwaterPose(u, depthBelow, outP, outL, lookDist = 1.3) {
    const st = stationAt(u);
    setFlowUp(st.flowX, st.flowZ);
    const y = SURFACE_Y - THREE.MathUtils.clamp(depthBelow, 0.7, 2.8);
    outP.set(st.x - st.flowX * 2.5, y, st.z - st.flowZ * 2.5);
    // lookDist ~1.2 → ~12 m look target (midground), not giant close-ups
    const ahead = 10 * lookDist;
    outL.set(
      st.x + st.flowX * ahead,
      SURFACE_Y - THREE.MathUtils.clamp(depthBelow * 0.7, 0.5, 2.0),
      st.z + st.flowZ * ahead,
    );
  }

  function revealAt(p) {
    const t = p * CINEMATIC_DURATION;
    if (t < 4) return THREE.MathUtils.lerp(0.0, 0.18, easeInOutCubic(t / 4));
    if (t < 8) return THREE.MathUtils.lerp(0.18, 0.32, easeInOutCubic((t - 4) / 4));
    if (t < 12) return THREE.MathUtils.lerp(0.32, 0.5, easeInOutCubic((t - 8) / 4));
    if (t < 16) return THREE.MathUtils.lerp(0.5, 0.62, easeInOutCubic((t - 12) / 4));
    if (t < 19) return THREE.MathUtils.lerp(0.62, 0.74, easeInOutCubic((t - 16) / 3));
    if (t < 22) return THREE.MathUtils.lerp(0.74, 0.84, easeInOutCubic((t - 19) / 3));
    if (t < 24) return THREE.MathUtils.lerp(0.84, 0.92, easeInOutCubic((t - 22) / 2));
    if (t < 27) return THREE.MathUtils.lerp(0.92, 1.0, easeInOutCubic((t - 24) / 3));
    return THREE.MathUtils.lerp(1.0, 1.08, easeInOutCubic((t - 27) / 3));
  }

  function phaseName(p) {
    if (!active) return "idle";
    const t = p * CINEMATIC_DURATION;
    if (t < 4) return "water_start";
    if (t < 8) return "fishing_points";
    if (t < 12) return "buildings";
    if (t < 16) return "bridge";
    if (t < 19) return "depth_transition";
    if (t < 22) return "fish_scene";
    if (t < 24) return "fish_jump";
    if (t < 27) return "riverbank";
    if (t < 30) return "final_overview";
    return "complete";
  }

  function syncFx(reveal) {
    waterEffects?.setReveal?.(reveal);
    flowParticles?.setReveal?.(reveal);
  }

  function applyIdleWater() {
    const mat = getRiverMaterial?.();
    if (!mat?.uniforms) return;
    mat.uniforms.uReveal.value = 1.2;
    if (mat.uniforms.uRevealSoft) mat.uniforms.uRevealSoft.value = 0.045;
    // Keep flow readable before cinematic — was nearly frozen at 0.08
    if (mat.uniforms.uFlowSpeed) mat.uniforms.uFlowSpeed.value = Math.max(0.55, state.flowSpeed);
    if (mat.uniforms.uOpacity) mat.uniforms.uOpacity.value = Math.max(0.62, state.waterOpacity * 0.85);
    if (mat.uniforms.uShowFlowVis) mat.uniforms.uShowFlowVis.value = state.flowVisibility;
    syncFx(1.2);
    waterEffects?.setActive?.(false);
  }

  function start() {
    if (active) return false;
    active = true;
    paused = false;
    locked = true;
    elapsed = 0;
    state.cinematicActive = true;
    state.cinematicPaused = false;
    state.cinematicProgress = 0;
    state.cinematicPhase = "prepare";
    state.cinematicFishBoost = false;
    state.cinematicJumpCue = false;
    state.cinematicUnderwater = false;
    state.cinematicFishScene = false;
    state.cinematicJumpSequence = false;
    controls.enabled = false;
    state.cameraMode = "cinematic";
    state.playing = false;

    aerialPose({
      u: 0.02,
      height: 78,
      pitchDeg: 52,
      lookAhead: 0.048,
      outP: pos,
      outL: look,
    });
    camera.position.copy(pos);
    controls.target.copy(look);
    camera.up.copy(up);
    camera.lookAt(look);
    smoothUp.copy(up);

    const mat = getRiverMaterial?.();
    if (mat?.uniforms) {
      mat.uniforms.uReveal.value = 0.0;
      mat.uniforms.uRevealSoft.value = 0.055;
      mat.uniforms.uFlowSpeed.value = 0.22;
      mat.uniforms.uOpacity.value = 0.28;
    }
    syncFx(0);
    waterEffects?.setActive?.(true);
    state.cinematicJumpBudget = 3;
    return true;
  }

  function pause() {
    if (!active || paused) return false;
    paused = true;
    state.cinematicPaused = true;
    return true;
  }

  function resume() {
    if (!active || !paused) return false;
    paused = false;
    state.cinematicPaused = false;
    return true;
  }

  function togglePause() {
    return paused ? resume() : pause();
  }

  function finish() {
    active = false;
    paused = false;
    locked = false;
    state.cinematicActive = false;
    state.cinematicPaused = false;
    state.cinematicProgress = 1;
    state.cinematicPhase = "complete";
    state.cinematicFishBoost = false;
    state.cinematicJumpCue = false;
    state.cinematicUnderwater = false;
    state.cinematicFishScene = false;
    state.cinematicJumpSequence = false;
    state.cinematicJumpBudget = 0;
    state.cinematicFishingPointFocus = null;
    state.cinematicBridgeFocus = null;
    state.cinematicInfo = null;
    state._cinematicCam = null;
    controls.enabled = true;
    camera.near = 1.2;
    camera.updateProjectionMatrix();
    const mat = getRiverMaterial?.();
    if (mat?.uniforms) {
      mat.uniforms.uReveal.value = 1.2;
      mat.uniforms.uFlowSpeed.value = state.flowSpeed;
      mat.uniforms.uOpacity.value = state.waterOpacity;
      // Keep false so bridge decks stay visible through translucent water
      mat.depthWrite = false;
    }
    syncFx(1.2);
    waterEffects?.setActive?.(false);
    // Always return to the same KML Overview framing as refresh / Overview button
    if (typeof onComplete === "function") {
      onComplete();
    } else {
      state.cameraMode = "overview";
      fullCorridorOverview(1, pos, look);
      up.set(0, 1, 0);
      camera.position.copy(pos);
      controls.target.copy(look);
      camera.up.copy(up);
      camera.lookAt(look);
      controls.update();
    }
  }

  function update(dt) {
    if (!active) return;
    if (paused) return;

    elapsed += dt;
    if (elapsed >= CINEMATIC_DURATION) {
      elapsed = CINEMATIC_DURATION;
    }
    const p = Math.min(1, elapsed / CINEMATIC_DURATION);
    const t = p * CINEMATIC_DURATION;
    state.cinematicProgress = p;
    state.cinematicPhase = phaseName(p);

    state.cinematicJumpCue = false;
    state.cinematicUnderwater = t >= 16 && t < 24;
    state.cinematicFishScene = t >= 19 && t < 22;
    state.cinematicJumpSequence = t >= 22 && t < 24;
    if (t < 4 || t >= 8) state.cinematicFishingPointFocus = null;
    if (t >= 12 && t < 16.5) {
      const br = pickBridgeFocus(dataset, stations, landmarks.bridgeU);
      state.cinematicBridgeFocus = br;
    } else {
      state.cinematicBridgeFocus = null;
    }

    // Cinematic coordinate overlay
    const stCam = stationAt(p);
    const ll = dataset.frame.toLonLat(stCam.x, stCam.z);
    const riverMat = getRiverMaterial?.();
    const flowSpd = riverMat?.uniforms?.uFlowSpeed?.value ?? state.flowSpeed;
    state.cinematicInfo = {
      lat: ll.lat,
      lon: ll.lon,
      depth: sampleDepthAlong(stCam.x, stCam.z, dataset),
      flowSpeed: flowSpd * 1.2,
    };

    state.cinematicFishBoost =
      (t >= 4 && t < 8) ||
      (t >= 19 && t < 24) ||
      (t >= 24 && t < 27);

    const reveal = revealAt(p);
    const mat = riverMat;
    if (mat?.uniforms) {
      mat.uniforms.uReveal.value = reveal;
      mat.uniforms.uRevealSoft.value = state.cinematicUnderwater ? 0.08 : 0.05;
      mat.uniforms.uTime.value = state.elapsed;
      mat.uniforms.uFlowSpeed.value = THREE.MathUtils.lerp(
        0.3,
        Math.max(1.05, state.flowSpeed * 1.45),
        Math.min(1, reveal / 0.9),
      );
      const base = state.waterOpacity;
      if (t < 4) {
        mat.uniforms.uOpacity.value = THREE.MathUtils.lerp(0.24, Math.max(base, 0.75), t / 4);
      } else if (t >= 4 && t < 8) {
        // Fishing-point shot: clear water so submerged fish + jumps read on screen
        mat.uniforms.uOpacity.value = 0.24;
      } else if (state.cinematicFishScene) {
        mat.uniforms.uOpacity.value = 0.16;
      } else if (state.cinematicUnderwater) {
        mat.uniforms.uOpacity.value = 0.2;
      } else if (t >= 22 && t < 25) {
        mat.uniforms.uOpacity.value = 0.28;
      } else {
        mat.uniforms.uOpacity.value = Math.max(base, 0.65);
      }
      // Never depth-write translucent water — it was clipping bridge decks mid-span
      mat.depthWrite = false;
    }
    syncFx(reveal);

    cameraPose(p, pos, look);
    // Underwater: tighter near plane so riverbed reads, but fish stay ≥4 m (exclusion)
    camera.near = state.cinematicUnderwater || (t >= 4 && t < 8) ? 0.4 : 1.2;
    camera.updateProjectionMatrix();
    const posRate = state.cinematicFishScene
      ? 1.6
      : t >= 4 && t < 8
        ? 2.8
        : state.cinematicUnderwater
          ? 2.2
          : 1.85;
    const rotRate = state.cinematicFishScene
      ? 1.8
      : t >= 4 && t < 8
        ? 3.0
        : state.cinematicUnderwater
          ? 2.5
          : 2.1;
    const posBlend = 1 - Math.exp(-dt * posRate);
    const rotBlend = 1 - Math.exp(-dt * rotRate);
    camera.position.lerp(pos, posBlend);
    controls.target.lerp(look, posBlend);
    smoothUp.lerp(up, rotBlend).normalize();
    camera.up.copy(smoothUp);
    _m.lookAt(camera.position, controls.target, smoothUp);
    _qTgt.setFromRotationMatrix(_m);
    _qCur.copy(camera.quaternion);
    _qCur.slerp(_qTgt, rotBlend);
    camera.quaternion.copy(_qCur);

    // Hint for fish / showcase (use actual camera facing)
    camera.getWorldDirection(forward);
    state._cinematicCam = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      fx: forward.x,
      fy: forward.y,
      fz: forward.z,
      lookX: controls.target.x,
      lookY: controls.target.y,
      lookZ: controls.target.z,
    };

    if (p >= 1) finish();
  }

  function isActive() {
    return active;
  }

  function isPaused() {
    return active && paused;
  }

  applyIdleWater();

  return {
    start,
    pause,
    resume,
    togglePause,
    update,
    isActive,
    isPaused,
    finish,
    setFishingZones,
    applyIdleWater,
    duration: CINEMATIC_DURATION,
    landmarks,
  };
}

/** Pick fishing zones along corridor u-range for cinematic flyover. */
function pickFishingBeats(zones, stations, uMin, uMax, count) {
  if (!zones?.length || !stations?.length) return [];
  const scored = [];
  for (const z of zones) {
    let bestI = 0;
    let bestD = Infinity;
    const step = Math.max(1, Math.floor(stations.length / 300));
    for (let i = 0; i < stations.length; i += step) {
      const s = stations[i];
      const d2 = (s.x - z.x) ** 2 + (s.z - z.z) ** 2;
      if (d2 < bestD) {
        bestD = d2;
        bestI = i;
      }
    }
    const u = bestI / Math.max(1, stations.length - 1);
    if (u < uMin || u > uMax) continue;
    const st = stations[bestI];
    scored.push({
      id: z.id,
      x: z.x,
      z: z.z,
      u,
      flowX: st.flowX,
      flowZ: st.flowZ,
      d: Math.sqrt(bestD),
    });
  }
  scored.sort((a, b) => a.u - b.u);
  if (!scored.length) {
    // Fallback: nearest zones to early corridor regardless of u filter
    const early = stations[Math.floor(stations.length * 0.12)] || stations[0];
    return [...zones]
      .map((z) => ({
        id: z.id,
        x: z.x,
        z: z.z,
        u: 0.12,
        flowX: early.flowX,
        flowZ: early.flowZ,
        d: Math.hypot(z.x - early.x, z.z - early.z),
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, count);
  }
  if (scored.length <= count) return scored;
  // Spread picks across the list
  const out = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / Math.max(1, count - 1)) * (scored.length - 1));
    out.push(scored[idx]);
  }
  return out;
}

function sceneBounds(dataset) {
  const b = dataset.corridor.bounds;
  const ring = dataset.ringLocal;
  if (!ring?.length) return b;
  let minX = b.minX;
  let maxX = b.maxX;
  let minZ = b.minZ;
  let maxZ = b.maxZ;
  for (const c of ring) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z);
    maxZ = Math.max(maxZ, c.z);
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    spanX: maxX - minX,
    spanZ: maxZ - minZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
  };
}

/** Map OSM buildings / bridges / green to corridor parameters for the storyboard. */
function resolveLandmarks(dataset, stations) {
  const bridges = dataset.bridges || [];
  const buildings = dataset.osm?.buildings || [];
  const green = dataset.osm?.green || [];

  function nearestU(x, z) {
    let bestI = 0;
    let bestD = Infinity;
    const step = Math.max(1, Math.floor(stations.length / 400));
    for (let i = 0; i < stations.length; i += step) {
      const s = stations[i];
      const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d2 < bestD) {
        bestD = d2;
        bestI = i;
      }
    }
    return bestI / Math.max(1, stations.length - 1);
  }

  function stationAt(u) {
    const t = THREE.MathUtils.clamp(u, 0, 0.995);
    const f = t * (stations.length - 1);
    const i = Math.floor(f);
    const k = f - i;
    const a = stations[i];
    const c = stations[Math.min(stations.length - 1, i + 1)];
    return {
      x: a.x + (c.x - a.x) * k,
      z: a.z + (c.z - a.z) * k,
      flowX: a.flowX,
      flowZ: a.flowZ,
      half: a.halfWidth,
    };
  }

  // Prefer a bridge in the mid-early corridor (after start / buildings beat)
  let bridgeU = 0.48;
  let bestBridgeScore = -Infinity;
  for (const br of bridges) {
    const u = nearestU(br.midX, br.midZ);
    if (u < 0.2 || u > 0.75) continue;
    const score = (br.lengthM || 40) - Math.abs(u - 0.42) * 80;
    if (score > bestBridgeScore) {
      bestBridgeScore = score;
      bridgeU = u;
    }
  }

  // Left-bank building cluster near u 0.2–0.42
  let buildNx = 0;
  let buildNz = 0;
  let buildSide = 1;
  let buildingU = 0.32;
  let bestBuild = -Infinity;
  const sampleU = 0.3;
  const st0 = stationAt(sampleU);
  const leftX = -st0.flowZ;
  const leftZ = st0.flowX;

  for (const b of buildings) {
    const u = nearestU(b.midX, b.midZ);
    if (u < 0.18 || u > 0.45) continue;
    const st = stationAt(u);
    const dx = b.midX - st.x;
    const dz = b.midZ - st.z;
    const lat = dx * -st.flowZ + dz * st.flowX;
    if (lat < st.half * 0.6) continue; // need off-channel buildings
    const leftness = dx * leftX + dz * leftZ;
    if (leftness < 0) continue;
    const score = leftness - Math.abs(u - 0.3) * 40;
    if (score > bestBuild) {
      bestBuild = score;
      buildingU = u;
      const len = Math.hypot(dx, dz) || 1;
      buildNx = dx / len;
      buildNz = dz / len;
      buildSide = 1;
    }
  }

  // Fallback: synthetic left offset if OSM thin
  if (bestBuild === -Infinity) {
    const st = stationAt(0.32);
    buildNx = -st.flowZ;
    buildNz = st.flowX;
    buildingU = 0.32;
    buildSide = 1;
  }

  // Tree / green bank — prefer opposite side of buildings when possible
  let treeNx = -buildNx;
  let treeNz = -buildNz;
  let treeSide = -buildSide;
  let bestGreen = -Infinity;
  for (const g of green) {
    const u = nearestU(g.midX, g.midZ);
    if (u < 0.45 || u > 0.85) continue;
    const st = stationAt(u);
    const dx = g.midX - st.x;
    const dz = g.midZ - st.z;
    const lat = Math.abs(dx * -st.flowZ + dz * st.flowX);
    if (lat < st.half * 0.5) continue;
    const score = lat - Math.abs(u - 0.7) * 30;
    if (score > bestGreen) {
      bestGreen = score;
      const len = Math.hypot(dx, dz) || 1;
      treeNx = dx / len;
      treeNz = dz / len;
      treeSide = Math.sign(dx * -st.flowZ + dz * st.flowX) || -1;
    }
  }

  return {
    buildingU: THREE.MathUtils.clamp(buildingU, 0.22, 0.42),
    bridgeU: THREE.MathUtils.clamp(bridgeU, 0.35, 0.65),
    buildNx,
    buildNz,
    buildSide,
    treeNx,
    treeNz,
    treeSide,
  };
}

function pickBridgeFocus(dataset, stations, bridgeU) {
  const bridges = dataset.bridges || [];
  if (!bridges.length) return null;
  let best = bridges[0];
  let bestScore = Infinity;
  for (const br of bridges) {
    let bestI = 0;
    let bestD = Infinity;
    const step = Math.max(1, Math.floor(stations.length / 300));
    for (let i = 0; i < stations.length; i += step) {
      const s = stations[i];
      const mx = br.midX ?? br.x ?? 0;
      const mz = br.midZ ?? br.z ?? 0;
      const d2 = (s.x - mx) ** 2 + (s.z - mz) ** 2;
      if (d2 < bestD) {
        bestD = d2;
        bestI = i;
      }
    }
    const u = bestI / Math.max(1, stations.length - 1);
    const score = Math.abs(u - bridgeU);
    if (score < bestScore) {
      bestScore = score;
      best = br;
    }
  }
  const mx = best.midX ?? best.x ?? 0;
  const mz = best.midZ ?? best.z ?? 0;
  const ll = dataset.frame.toLonLat(mx, mz);
  return {
    name: best.name || best.road || "Bridge",
    lon: ll.lon,
    lat: ll.lat,
    lengthM: best.lengthM,
    river: "Mula–Mutha",
  };
}

function sampleDepthAlong(x, z, dataset) {
  const pts = dataset.points || [];
  let best = null;
  let d = Infinity;
  for (const p of pts) {
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 < d) {
      d = d2;
      best = p;
    }
  }
  return best?.depth ?? (dataset.minDepth + dataset.maxDepth) * 0.5;
}
