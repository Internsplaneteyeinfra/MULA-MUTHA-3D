import * as THREE from "three";
import { state } from "../../state.js";
import { resolveNallaFlow } from "./flowDirectionResolver.js";
import { createNallaWaterMaterial } from "./nallaWaterMaterial.js";
import { createJoiningStreamsEffects } from "./joiningStreamsEffects.js";

/**
 * Continuous nalla water surfaces (shader ribbons).
 * Open ground = surface channel; under buildings = recessed culvert.
 * Joining Streams mode adds pipes / arrows / confluence mist via effects child.
 */
export function createNallaFlowSystem(dataset, drainageGroup, opts = {}) {
  const group = new THREE.Group();
  group.name = "nallaFlowSystem";
  group.visible = false;

  const pickables = drainageGroup?.userData?.pickables || [];
  const stations = dataset.corridor?.stations || [];
  const material = createNallaWaterMaterial();

  if (!pickables.length) {
    group.userData.update = () => {};
    group.userData.records = [];
    group.userData.stats = { nallas: 0, connected: 0, unknownDir: 0 };
    group.userData.playReveal = () => {};
    group.userData.setActive = () => {};
    group.userData.setSelected = () => {};
    group.userData.setJoiningStreamsMode = () => {};
    return group;
  }

  const records = [];
  let unknownDir = 0;
  let connected = 0;
  const meshes = [];

  for (let i = 0; i < pickables.length; i++) {
    const path = pickables[i];
    if (!path.pts || path.pts.length < 2) continue;
    const rec = resolveNallaFlow(path, stations);
    rec.index = i;

    if (path.pts.length < 2) continue;

    const ordered = rec.flowTowardEnd ? path.pts : path.pts.slice().reverse();
    const curvePts = ordered.map((p) => {
      const under = p.under || 0;
      const lift = under > 0.35 ? 0.1 : 0.4;
      return new THREE.Vector3(p.x, p.y + lift, p.z);
    });
    if (curvePts.length < 2) continue;

    const curve = new THREE.CatmullRomCurve3(curvePts, false, "catmullrom", 0.12);
    const length = Math.max(1, curve.getLength());
    rec.curve = curve;
    rec.curveLength = length;
    rec.orderedPts = ordered;
    rec.openGroundShare =
      ordered.reduce((s, p) => s + ((p.under || 0) < 0.2 ? 1 : 0), 0) / ordered.length;

    if (rec.connectsToRiver) connected++;
    if (rec.flowDirectionConfidence === "unknown") {
      unknownDir++;
      console.debug("[nalla-flow] ambiguous direction", rec.name || rec.id, rec.directionReason);
    }

    const radius = channelRadius(rec);
    const tubular = Math.max(10, Math.min(280, Math.floor(length / 5)));
    let geo;
    try {
      geo = new THREE.TubeGeometry(curve, tubular, radius, 6, false);
    } catch {
      continue;
    }

    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `nallaWater_${rec.id}`;
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    mesh.userData.record = rec;
    group.add(mesh);
    meshes.push(mesh);
    records.push(rec);
  }

  let revealT = 0;
  let active = false;
  let joiningMode = false;
  /** @type {null | object} */
  let selectedRec = null;

  group.userData.records = records;
  group.userData.material = material;

  // Effects read records from group.userData — assign records first
  const effects = createJoiningStreamsEffects(group, {
    uiRoot: opts.uiRoot,
    getCamera: opts.getCamera,
  });
  group.add(effects);
  group.userData.effects = effects;
  group.userData.stats = {
    nallas: records.length,
    connected,
    unknownDir,
    style: "continuous-water",
  };

  group.userData.setActive = (on) => {
    active = !!on;
    state.showNallaFlow = active;
    material.uniforms.uActive.value = active ? 1 : 0;
    if (active) {
      revealT = 0;
      material.uniforms.uReveal.value = 0;
      group.visible = true;
    } else {
      group.visible = false;
      material.uniforms.uReveal.value = 0;
      effects.userData.setActive(false);
      selectedRec = null;
    }
  };

  group.userData.playReveal = () => {
    revealT = 0;
    material.uniforms.uReveal.value = 0;
    active = true;
    state.showNallaFlow = true;
    material.uniforms.uActive.value = 1;
    group.visible = true;
  };

  group.userData.getRecordByPickMeta = (meta) => {
    if (!meta) return null;
    return (
      records.find((r) => r.meta === meta) ||
      records.find((r) => r.meta?.osmId && r.meta.osmId === meta.osmId) ||
      records.find((r) => r.name === meta.name)
    );
  };

  group.userData.setSelected = (recOrNull) => {
    selectedRec = recOrNull || null;
    effects.userData.setSelected(selectedRec);
    material.uniforms.uSelectedBoost.value = selectedRec ? 0.35 : 0;
  };

  group.userData.setJoiningStreamsMode = (on) => {
    joiningMode = !!on;
    material.uniforms.uJoiningStyle.value = joiningMode ? 1 : 0;
    material.uniforms.uOpacity.value = joiningMode ? 0.82 : 0.9;
    effects.userData.setActive(joiningMode && active);
    if (!joiningMode) {
      selectedRec = null;
      effects.userData.setSelected(null);
      material.uniforms.uSelectedBoost.value = 0;
    }
  };

  console.info("Nalla water surfaces", group.userData.stats);

  function update(dt, camera) {
    const want = !!state.showDrainage;
    if (want !== active) {
      if (want) group.userData.playReveal();
      else group.userData.setActive(false);
    }
    if (!want) {
      group.visible = false;
      effects.userData.setActive(false);
      return;
    }
    group.visible = true;
    const t = state.elapsed != null ? state.elapsed : material.uniforms.uTime.value + dt;
    material.uniforms.uTime.value = t;
    material.uniforms.uFlowSpeed.value =
      joiningMode || state.joiningStreamsMode
        ? Math.min(0.45, state.nallaFlowSpeed ?? 0.45)
        : state.nallaFlowSpeed ?? 0.65;
    material.uniforms.uActive.value = 1;
    material.uniforms.uJoiningStyle.value = joiningMode || state.joiningStreamsMode ? 1 : 0;

    if (revealT < 1) {
      revealT = Math.min(1, revealT + dt * 1.4);
      material.uniforms.uReveal.value = revealT;
    } else {
      material.uniforms.uReveal.value = 1;
    }

    const fxOn = !!(joiningMode || state.joiningStreamsMode);
    effects.userData.setActive(fxOn);
    if (fxOn) effects.userData.update(dt, camera);
  }

  group.userData.update = update;
  return group;
}

function channelRadius(rec) {
  const ww = String(rec.meta?.waterway || "").toLowerCase();
  const L = rec.curveLength || rec.lengthM || 100;
  const open = rec.openGroundShare ?? 1;
  let r = 3.6;
  if (ww === "canal" || ww === "drain") r = 5.0;
  else if (ww === "stream") r = 4.2;
  else if (ww === "ditch") r = 3.0;
  if (L > 800) r *= 1.3;
  else if (L > 400) r *= 1.15;
  if (rec.connectsToRiver) r *= 1.08;
  r *= 0.92 + open * 0.28;
  return r;
}
