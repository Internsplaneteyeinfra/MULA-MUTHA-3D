import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { interpolateChainage } from "../geo/chainage.js";
import { pointAlongRiver, smoothTangent, stationAt } from "./riverCamera.js";

/**
 * Chainage-to-chainage travel along the river corridor.
 *
 * The camera anchor walks the chainage centerline (never a straight chord across land);
 * the pose at every instant is the same eye-level inspection pose as
 * `chainageGisAerialPose` (16 m up, 55 m back, 180 m ahead), mirrored when the camera
 * faces upstream. Water flow is untouched — only the camera moves.
 */
export const CameraMode = Object.freeze({
  IDLE: "idle",
  FORWARD_TRAVEL: "forward-travel",
  BACKWARD_TRAVEL: "backward-travel",
  INSPECT: "inspect",
  FLYOVER: "flyover",
  FULL_RIVER_JOURNEY: "full-river-journey",
});

const MIN_DUR_S = 1.8;
const MAX_DUR_S = 16;
/** Full "Explore River" cruise speed along the centerline. */
const EXPLORE_M_PER_S = 220;
/** Backward trips shorter than this reverse while facing downstream (no double 180° turn). */
const REORIENT_MIN_M = 2000;
/** Extra time given to trips that turn to face upstream and back, so each turn takes ~0.8 s+. */
const REORIENT_EXTRA_S = 1.8;
/** Share of the trip spent blending from wherever the user left the camera. */
const START_BLEND = 0.24;
/** Time constant of the travel-heading low-pass (tight bends at cruise speed). */
const HEADING_TAU_S = 0.22;
/** Minimum eye distance inside the bank line. */
const CHANNEL_MARGIN_M = 6;

const BASE_POSE = { height: 16, back: 55, ahead: 180, lookAbove: 12, fov: 58 };

export function transitionDuration(distanceM) {
  const d = Math.max(0, distanceM);
  return THREE.MathUtils.clamp(1.6 + d / 140, MIN_DUR_S, MAX_DUR_S);
}

/** Trapezoidal speed profile: ease-in, cruise, ease-out. `accel` 0 starts at cruise speed. */
export function travelProgress(t, accel = 0.28, decel = 0.32) {
  const vmax = 1 / (1 - accel / 2 - decel / 2);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (accel > 0 && t < accel) return (0.5 * vmax * t * t) / accel;
  if (t <= 1 - decel) return vmax * (accel / 2 + (t - accel));
  return 1 - (0.5 * vmax * (1 - t) ** 2) / decel;
}

const smooth01 = (e0, e1, x) => {
  const k = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return k * k * (3 - 2 * k);
};

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * @param {{ dataset: object, getBridges?: () => {x:number,z:number,deckY:number}[] }} ctx
 */
export function createRiverJourney({ dataset, getBridges }) {
  const stations = dataset.corridor?.stations || [];
  const chain = dataset.chainage || [];
  const firstM = chain[0]?.meters ?? 0;
  const lastM = chain[chain.length - 1]?.meters ?? 0;
  const riverLen = Math.max(1, stations[stations.length - 1]?.along ?? lastM);

  /** @type {null | ReturnType<typeof makeTransition>} */
  let transition = null;
  let lastIdx = 0;

  const tmpF = { p: new THREE.Vector3(), l: new THREE.Vector3() };
  const tmpB = { p: new THREE.Vector3(), l: new THREE.Vector3() };
  const outP = new THREE.Vector3();
  const outL = new THREE.Vector3();

  const clampM = (m) => THREE.MathUtils.clamp(m, firstM, lastM);

  /** Fractional station parameter nearest (x,z), refined on segments near the previous hit. */
  function stationU(x, z) {
    const n = stations.length;
    if (n < 2) return 0;
    let best = lastIdx;
    let bestD = Infinity;
    const scan = (i0, i1, step) => {
      for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i += step) {
        const d = (stations[i].x - x) ** 2 + (stations[i].z - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    };
    scan(lastIdx - 40, lastIdx + 40, 1);
    if (bestD > 150 * 150) scan(0, n - 1, Math.max(1, Math.floor(n / 600)));
    scan(best - 8, best + 8, 1);
    lastIdx = best;
    let bestU = best;
    let bestSeg = Infinity;
    for (const j of [best - 1, best]) {
      if (j < 0 || j >= n - 1) continue;
      const a = stations[j];
      const b = stations[j + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1e-9;
      const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      const d = (a.x + dx * t - x) ** 2 + (a.z + dz * t - z) ** 2;
      if (d < bestSeg) { bestSeg = d; bestU = j + t; }
    }
    return bestU / (n - 1);
  }

  /**
   * Inspection pose at anchor (x,z) facing downstream (dir 1) or upstream (dir −1).
   * dir 1 reproduces `chainageGisAerialPose` exactly.
   */
  function facingPose(u, x, z, dir, pose, out) {
    const st = stationAt(stations, u);
    const along = Number.isFinite(st.along) ? st.along : u * riverLen;
    const h = pose.height;
    let back = THREE.MathUtils.clamp(pose.back, 35, 100);
    if (back < h * 2.5) back = h * 3;
    const room = dir > 0 ? along : riverLen - along;
    if (room < back + 20) back = Math.max(12, room * 0.55);
    const ahead = THREE.MathUtils.clamp(pose.ahead, 100, 280);
    const cp = pointAlongRiver(stations, u, -dir * back);
    const lp = pointAlongRiver(stations, u, dir * ahead);
    out.p.set(cp.x, SURFACE_Y + h, cp.z);
    out.l.set(lp.x, SURFACE_Y + pose.lookAbove, lp.z);
    return st;
  }

  /** Keep the eye over water: pull it back inside the channel half-width at its nearest station. */
  function clampToChannel(p) {
    const n = stations.length;
    if (n < 2) return;
    const keepIdx = lastIdx;
    const f = stationU(p.x, p.z) * (n - 1);
    lastIdx = keepIdx;
    const i = Math.min(n - 2, Math.floor(f));
    const k = f - i;
    const a = stations[i];
    const b = stations[i + 1];
    const cx = a.x + (b.x - a.x) * k;
    const cz = a.z + (b.z - a.z) * k;
    const half = (a.halfWidth ?? 40) + ((b.halfWidth ?? 40) - (a.halfWidth ?? 40)) * k;
    const limit = Math.max(4, half - CHANNEL_MARGIN_M);
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d = Math.hypot(dx, dz);
    if (d > limit) {
      p.x = cx + (dx / d) * limit;
      p.z = cz + (dz / d) * limit;
    }
  }

  /** Bridge clearance: required eye height (scene Y) and a small side-step near a deck. */
  function bridgeClearance(x, z) {
    let needY = -Infinity;
    let side = 0;
    for (const b of getBridges?.() || []) {
      if (!Number.isFinite(b.deckY)) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d > 140) continue;
      const k = 1 - smooth01(60, 140, d);
      needY = Math.max(needY, THREE.MathUtils.lerp(SURFACE_Y + BASE_POSE.height, b.deckY + 7, k));
      side = Math.max(side, k);
    }
    return { needY, side };
  }

  /**
   * Blend the downstream- and upstream-facing poses by rotating both the eye and the
   * look target about the anchor with one shared turn direction (no instant 180°).
   */
  function orientedPose(anchor, u, w, pose, out, tr) {
    facingPose(u, anchor.x, anchor.z, 1, pose, tmpF);
    if (w <= 1e-4) {
      out.p.copy(tmpF.p);
      out.l.copy(tmpF.l);
      return;
    }
    facingPose(u, anchor.x, anchor.z, -1, pose, tmpB);
    if (w >= 1 - 1e-4) {
      out.p.copy(tmpB.p);
      out.l.copy(tmpB.l);
      return;
    }
    const half = stationAt(stations, u).half || 40;
    const lookF = Math.atan2(tmpF.l.z - anchor.z, tmpF.l.x - anchor.x);
    const lookB = Math.atan2(tmpB.l.z - anchor.z, tmpB.l.x - anchor.x);
    // The two headings are ~180° apart, so the "shorter" side flips on bends; the turn
    // side is fixed once per transition to avoid a mid-turn reversal.
    if (!tr.turn) tr.turn = wrapAngle(lookB - lookF) >= 0 ? 1 : -1;
    const turn = tr.turn;
    const spin = (a0, a1) => {
      let d = wrapAngle(a1 - a0);
      if (Math.sign(d) !== turn && Math.abs(d) > Math.PI / 2) d += turn * Math.PI * 2;
      return a0 + d * w;
    };
    const eyeF = Math.atan2(tmpF.p.z - anchor.z, tmpF.p.x - anchor.x);
    const eyeB = Math.atan2(tmpB.p.z - anchor.z, tmpB.p.x - anchor.x);
    const rF = Math.hypot(tmpF.p.x - anchor.x, tmpF.p.z - anchor.z);
    const rB = Math.hypot(tmpB.p.x - anchor.x, tmpB.p.z - anchor.z);
    // Tighten the swing mid-turn so the eye stays over water, not the bank.
    const rMid = Math.min(THREE.MathUtils.lerp(rF, rB, w), Math.max(12, half * 0.6));
    const r = THREE.MathUtils.lerp(THREE.MathUtils.lerp(rF, rB, w), rMid, Math.sin(Math.PI * w));
    const ae = spin(eyeF, eyeB);
    out.p.set(anchor.x + Math.cos(ae) * r, THREE.MathUtils.lerp(tmpF.p.y, tmpB.p.y, w), anchor.z + Math.sin(ae) * r);
    const lr = THREE.MathUtils.lerp(
      Math.hypot(tmpF.l.x - anchor.x, tmpF.l.z - anchor.z),
      Math.hypot(tmpB.l.x - anchor.x, tmpB.l.z - anchor.z),
      w,
    );
    const al = spin(lookF, lookB);
    out.l.set(anchor.x + Math.cos(al) * lr, tmpF.l.y, anchor.z + Math.sin(al) * lr);
  }

  function makeTransition(fromM, toM, startPose, opts) {
    const a = interpolateChainage(chain, fromM);
    const b = interpolateChainage(chain, toM);
    // Direction = first step of the river path · local flow tangent. A start→target chord
    // can point the wrong way on a meander, so the path step is used instead of the chord.
    const flow = stationAt(stations, stationU(a.x, a.z));
    const chainageDir = Math.sign(toM - fromM) || 1;
    const step = interpolateChainage(chain, clampM(fromM + chainageDir * 20));
    const dot = (step.x - a.x) * flow.flowX + (step.z - a.z) * flow.flowZ;
    const direction = Math.abs(dot) > 1e-3 ? Math.sign(dot) : chainageDir;
    const chordDot = (b.x - a.x) * flow.flowX + (b.z - a.z) * flow.flowZ;
    const distance = Math.abs(toM - fromM);
    const explore = opts.mode === CameraMode.FULL_RIVER_JOURNEY;
    const reorient = !explore && direction < 0 && distance >= REORIENT_MIN_M;
    let startBlend = START_BLEND;
    if (startPose?.p && a) {
      const away = Math.hypot(startPose.p.x - a.x, startPose.p.z - a.z);
      if (away > 160) startBlend = THREE.MathUtils.clamp(0.24 + (away - 160) / 3500, 0.24, 0.42);
    }
    const duration = explore
      ? Math.max(8, distance / EXPLORE_M_PER_S)
      : (opts.duration ?? transitionDuration(distance)) + (reorient ? REORIENT_EXTRA_S : 0);
    const mode = explore
      ? CameraMode.FULL_RIVER_JOURNEY
      : direction > 0 ? CameraMode.FORWARD_TRAVEL : CameraMode.BACKWARD_TRAVEL;
    return {
      startChainage: fromM,
      targetChainage: toM,
      currentChainage: fromM,
      direction,
      chordDirection: Math.sign(chordDot) || 0,
      distance,
      duration,
      mode,
      t: 0,
      accel: opts.continuing ? 0.12 : explore ? 0.12 : 0.36,
      decel: explore ? 0.14 : 0.4,
      startBlend,
      reorient,
      lift: explore ? 6 : Math.min(5, distance * 0.0018),
      targetPose: { ...BASE_POSE, ...(opts.targetPose || {}) },
      startPose: startPose && { p: startPose.p.clone(), l: startPose.l.clone() },
      path: { fromM, toM, along: "chainage centerline", samples: Math.ceil(distance / 10) + 1 },
    };
  }

  return {
    CameraMode,
    get active() {
      return transition;
    },
    /**
     * @param {number} fromM
     * @param {number} toM
     * @param {{ p:THREE.Vector3, l:THREE.Vector3 }|null} startPose current camera pose
     * @param {{ mode?:string, targetPose?:object, duration?:number }} [opts]
     */
    start(fromM, toM, startPose, opts = {}) {
      const from = clampM(transition ? transition.currentChainage : fromM);
      const to = clampM(toM);
      const continuing =
        !!transition && Math.sign(to - from) === Math.sign(transition.targetChainage - transition.startChainage);
      transition = makeTransition(from, to, startPose, { ...opts, continuing });
      return transition;
    },
    cancel() {
      const t = transition;
      transition = null;
      return t;
    },
    /** Advance and return the camera pose for this frame (null when idle). */
    step(dt) {
      const tr = transition;
      if (!tr) return null;
      const stepDt = Math.min(Math.max(0, dt), 1 / 24);
      tr.t = Math.min(1, tr.t + stepDt / tr.duration);
      const s = travelProgress(tr.t, tr.accel, tr.decel);
      const m = tr.startChainage + (tr.targetChainage - tr.startChainage) * s;
      tr.currentChainage = m;
      const anchor = interpolateChainage(chain, m);
      const u = stationU(anchor.x, anchor.z);

      // Face the travel direction on long backward trips; settle back to the
      // downstream inspection pose while decelerating into the destination.
      const w = tr.reorient ? smooth01(0, 0.3, tr.t) * (1 - smooth01(0.7, 1, tr.t)) : 0;
      const arrive = smooth01(0.6, 1, tr.t);
      const pose = {
        height: THREE.MathUtils.lerp(BASE_POSE.height, tr.targetPose.height, arrive),
        back: THREE.MathUtils.lerp(BASE_POSE.back, tr.targetPose.back, arrive),
        ahead: BASE_POSE.ahead,
        lookAbove: BASE_POSE.lookAbove,
      };
      orientedPose(anchor, u, w, pose, { p: outP, l: outL }, tr);

      outP.y += Math.sin(Math.PI * s) * tr.lift;
      const clear = bridgeClearance(outP.x, outP.z);
      if (clear.needY > outP.y) outP.y = clear.needY;
      if (clear.side > 0) {
        const tan = smoothTangent(stations, u, 0.01);
        const half = stationAt(stations, u).half || 40;
        const off = Math.min(10, half * 0.3) * clear.side;
        outP.x += -tan.z * off;
        outP.z += tan.x * off;
      }
      clampToChannel(outP);

      const blend = tr.startBlend || START_BLEND;
      if (tr.startPose && tr.t < blend) {
        const k = smooth01(0, blend, tr.t);
        outP.lerpVectors(tr.startPose.p, outP, k);
        outL.lerpVectors(tr.startPose.l, outL, k);
      }

      // Heading low-pass (direction only, so the view never trails the eye); exact on arrival.
      const rx = outL.x - outP.x;
      const rz = outL.z - outP.z;
      const yaw = Math.atan2(rz, rx);
      if (tr.yaw == null) tr.yaw = yaw;
      tr.yaw += wrapAngle(yaw - tr.yaw) * (1 - Math.exp(-stepDt / HEADING_TAU_S));
      const heading = tr.yaw + wrapAngle(yaw - tr.yaw) * smooth01(0.86, 1, tr.t);
      const len = Math.hypot(rx, rz);
      outL.x = outP.x + Math.cos(heading) * len;
      outL.z = outP.z + Math.sin(heading) * len;

      const done = tr.t >= 1;
      if (done) transition = null;
      return { p: outP, l: outL, fov: BASE_POSE.fov, meters: m, done, transition: tr, weight: w };
    },
  };
}

/**
 * Chainage-dependent UI calls this from its `chainage-select` handler: runs `fn` now,
 * or — when that selection started a river journey — when the camera arrives.
 */
const settledQueue = new Map();
/** Journey target plus the requested value it was clamped from (e.g. 16+960 → 16+498). */
let journeyTargets = [];

export function setJourneyTarget(meters, ...aliases) {
  journeyTargets = [meters, ...aliases].filter(Number.isFinite);
}

export function whenChainageSettled(key, meters, fn) {
  queueMicrotask(() => {
    if (Number.isFinite(meters) && journeyTargets.some((t) => Math.abs(t - meters) < 0.5)) {
      settledQueue.set(key, fn);
      return;
    }
    settledQueue.delete(key);
    fn();
  });
}

export function flushSettled() {
  journeyTargets = [];
  const fns = [...settledQueue.values()];
  settledQueue.clear();
  for (const fn of fns) fn();
}
