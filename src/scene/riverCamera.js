import * as THREE from "three";
import { SURFACE_Y } from "./river.js";

/**
 * River-aligned camera framing from KML centerline tangents.
 * Does not rotate or shift geographic data.
 *
 * Cinematic beats: river flows bottom→top (camera.up = flow axis).
 * Overview / aerial: north-up map orientation (camera.up = world Y).
 */

export function riverAxis(stations) {
  const s0 = stations[0];
  const s1 = stations[stations.length - 1];
  let fx = s1.x - s0.x;
  let fz = s1.z - s0.z;
  const len = Math.hypot(fx, fz) || 1;
  return { x: fx / len, z: fz / len, length: len };
}

export function stationAt(stations, u) {
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

/** Nearest station parameter u for a world X/Z (inspect / Local 3D). */
export function nearestStationU(stations, x, z) {
  let bestI = 0;
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 400));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestI / Math.max(1, stations.length - 1);
}

/** Smooth tangent over nearby stations to avoid heading jitter. */
export function smoothTangent(stations, u, window = 0.04) {
  const a = stationAt(stations, Math.max(0, u - window));
  const b = stationAt(stations, Math.min(0.995, u + window));
  let fx = b.x - a.x;
  let fz = b.z - a.z;
  const len = Math.hypot(fx, fz) || 1;
  return { x: fx / len, z: fz / len };
}

/** Height so the local river width fills ~45–60% of the frame. */
export function heightForWidth(halfWidth, mode = "medium") {
  const w = Math.max(18, halfWidth * 2);
  if (mode === "close") return THREE.MathUtils.clamp(w * 1.15, 28, 70);
  if (mode === "detail") return THREE.MathUtils.lerp(w * 1.6, w * 2.2, 0.5);
  if (mode === "wide") return THREE.MathUtils.clamp(w * 4.2, 140, 280);
  return THREE.MathUtils.clamp(w * 2.4, 55, 140);
}

/**
 * Centered look-down along the river.
 * pitchDeg 35–65: higher = more overhead; lower = more forward.
 * lateralBiasM: tiny bank glance only (meters), default 0.
 */
export function alongRiverPose(stations, {
  u,
  height,
  pitchDeg = 52,
  lookAhead = 0.045,
  lookY = SURFACE_Y + 1,
  lateralBiasM = 0,
  outP,
  outL,
  outUp,
}) {
  const st = stationAt(stations, u);
  const tan = smoothTangent(stations, u);
  const ahead = stationAt(stations, Math.min(0.995, u + lookAhead));
  const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pitchDeg, 32, 72));
  const back = height / Math.tan(pitch);
  const px = -tan.z;
  const pz = tan.x;
  outP.set(
    st.x - tan.x * back + px * lateralBiasM,
    SURFACE_Y + height,
    st.z - tan.z * back + pz * lateralBiasM,
  );
  outL.set(ahead.x + px * lateralBiasM * 0.25, lookY, ahead.z + pz * lateralBiasM * 0.25);
  if (outUp) outUp.set(tan.x, 0, tan.z);
  return tan;
}

/** Full-corridor overview: oblique 35–50° so building walls read as 3D (not nadir GIS map). */
export function fullRiverOverviewPose(stations, bounds, k, outP, outL, outUp, opts = {}) {
  const spanX = Math.max(80, bounds.spanX || 0);
  const spanZ = Math.max(80, bounds.spanZ || 0);
  const fovDeg = opts.fovDeg ?? 48;
  const aspect = Math.max(0.5, opts.aspect ?? 16 / 9);
  const margin = THREE.MathUtils.lerp(0.58, 0.68, THREE.MathUtils.clamp(k, 0, 1));
  const pitchDeg = THREE.MathUtils.clamp(opts.pitchDeg ?? 42, 35, 50);
  const vHalf = Math.tan(THREE.MathUtils.degToRad(fovDeg) * 0.5);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);

  const fitSpanX = opts.fullExtent ? spanX : Math.min(spanX, 4800);
  const fitSpan = Math.max(fitSpanX, spanZ) * margin;
  const needX = (fitSpanX * 0.5 * margin) / (vHalf * aspect);
  const needZ = (spanZ * 0.5 * margin) / vHalf;
  const horizontalDist = Math.max(needX, needZ, fitSpan * 0.48);

  const lookY = opts.terrainLookY ?? SURFACE_Y + 2;
  const heightBoost = opts.terrainHeightBoost ?? 0;
  const camHeight = horizontalDist * Math.tan(pitch) + heightBoost;
  const minHeight = opts.fullExtent ? 650 : 420;

  // South-west oblique — west left, east right; walls + roofs visible
  const southBias = horizontalDist * 0.92;
  const westBias = fitSpanX * 0.08;
  outP.set(
    bounds.cx - westBias,
    lookY + Math.max(camHeight, minHeight),
    bounds.cz - southBias,
  );
  outL.set(bounds.cx, lookY, bounds.cz);
  if (outUp) outUp.set(0, 1, 0);
}

/** True aerial — nadir with north up (Z = north in scene). */
export function mapAerialPose(bounds, outP, outL, outUp) {
  const diag = Math.hypot(bounds.spanX, bounds.spanZ);
  const height = Math.max(diag * 0.85, 1200);
  outP.set(bounds.cx, SURFACE_Y + height, bounds.cz);
  outL.set(bounds.cx, SURFACE_Y, bounds.cz);
  if (outUp) outUp.set(0, 1, 0);
}

export function applyLook(camera, pos, target, up) {
  camera.position.copy(pos);
  camera.up.copy(up).normalize();
  camera.lookAt(target);
}

/** Camera framing hints when FABDEM terrain is loaded. */
export function terrainCameraOpts(dtm) {
  if (!dtm) return {};
  const mid = (dtm.minSceneY + dtm.maxSceneY) * 0.5;
  return {
    terrainLookY: mid * 0.5 + SURFACE_Y * 0.5,
    terrainHeightBoost: Math.max(0, (dtm.maxSceneY - SURFACE_Y) * 0.15),
  };
}
