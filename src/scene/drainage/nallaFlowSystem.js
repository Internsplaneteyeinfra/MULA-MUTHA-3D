import * as THREE from "three";
import { state } from "../../state.js";
import { resolveNallaFlow } from "./flowDirectionResolver.js";
import { createNallaWaterMaterial } from "./nallaWaterMaterial.js";

const LIFT = 2.55;

/**
 * Continuous nalla water surfaces (shader ribbons).
 * No particles, rings, or debug markers in the default experience.
 */
export function createNallaFlowSystem(dataset, drainageGroup) {
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

    // Skip only if totally unusable
    if (path.pts.length < 2) continue;

    const ordered = rec.flowTowardEnd ? path.pts : path.pts.slice().reverse();
    const curvePts = ordered.map((p) => new THREE.Vector3(p.x, p.y + LIFT, p.z));
    if (curvePts.length < 2) continue;

    const curve = new THREE.CatmullRomCurve3(curvePts, false, "catmullrom", 0.12);
    const length = Math.max(1, curve.getLength());
    rec.curve = curve;
    rec.curveLength = length;
    rec.orderedPts = ordered;

    if (rec.connectsToRiver) connected++;
    if (rec.flowDirectionConfidence === "unknown") {
      unknownDir++;
      // Still show neutral water (no fake claimed direction) — log only
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
    mesh.renderOrder = 32;
    mesh.frustumCulled = false;
    mesh.userData.record = rec;
    group.add(mesh);
    meshes.push(mesh);
    records.push(rec);
  }

  let revealT = 0;
  let active = false;

  group.userData.records = records;
  group.userData.material = material;
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

  group.userData.setSelected = () => {};

  console.info("Nalla water surfaces", group.userData.stats);

  function update(dt) {
    // Single control: Small channels (Nullahs) layer checkbox → state.showDrainage
    const want = !!state.showDrainage;
    if (want !== active) {
      if (want) group.userData.playReveal();
      else group.userData.setActive(false);
    }
    if (!want) {
      group.visible = false;
      return;
    }
    group.visible = true;
    // Continuous looping flow — never freeze after reveal; time always advances
    const t = state.elapsed != null ? state.elapsed : material.uniforms.uTime.value + dt;
    material.uniforms.uTime.value = t;
    material.uniforms.uFlowSpeed.value = state.nallaFlowSpeed ?? 0.65;
    material.uniforms.uActive.value = 1;

    // One-time fill reveal (opacity along path); surface motion continues via uTime forever
    if (revealT < 1) {
      revealT = Math.min(1, revealT + dt * 1.4);
      material.uniforms.uReveal.value = revealT;
    } else {
      material.uniforms.uReveal.value = 1;
    }
  }

  group.userData.update = update;
  return group;
}

function channelRadius(rec) {
  const ww = String(rec.meta?.waterway || "").toLowerCase();
  const L = rec.curveLength || rec.lengthM || 100;
  let r = 2.8;
  if (ww === "canal" || ww === "drain") r = 4.2;
  else if (ww === "stream") r = 3.2;
  else if (ww === "ditch") r = 2.2;
  // Longer channels read slightly wider (major collectors)
  if (L > 800) r *= 1.35;
  else if (L > 400) r *= 1.15;
  if (rec.connectsToRiver) r *= 1.08;
  return r;
}
