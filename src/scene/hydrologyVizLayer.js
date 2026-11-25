/**
 * Hydrology visualization ribbon on the EXISTING river centerline.
 * Does not replace water mesh/shader. Nearest 10 m cell join only.
 */
import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { interpolateChainage } from "../geo/chainage.js";

const PENDING = "#3a4a56";
const STEP_DEFAULT = 100;
const Y_OFF = 0.62;

export function createHydrologyVizLayer(dataset) {
  const group = new THREE.Group();
  group.name = "hydrologyVizLayer";
  group.visible = false;
  group.renderOrder = 28;

  const ribbonGroup = new THREE.Group();
  group.add(ribbonGroup);
  const markerGroup = new THREE.Group();
  group.add(markerGroup);

  const chainage = Array.isArray(dataset?.chainage) ? dataset.chainage : [];
  const stations = dataset?.corridor?.stations || [];
  const corridorLenM =
    Number(dataset?.corridor?.length) ||
    Number(chainage[chainage.length - 1]?.meters) ||
    Number(stations[stations.length - 1]?.along) ||
    17000;

  let segments = [];
  let focusMeters = null;
  let range = { min: 0, max: 1, span: 1 };
  let pulseT = 0;
  let palette = "discharge";
  let dimmed = false;
  const tmpColor = new THREE.Color();
  let selectMesh = null;
  let stageStem = null;

  function ensureMarker() {
    if (selectMesh) return;
    const geo = new THREE.SphereGeometry(4.2, 16, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4bb3d3,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    selectMesh = new THREE.Mesh(geo, mat);
    selectMesh.renderOrder = 40;
    selectMesh.visible = false;
    markerGroup.add(selectMesh);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6, 9, 32),
      new THREE.MeshBasicMaterial({
        color: 0x4bb3d3,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.2;
    selectMesh.add(ring);
  }

  function clear() {
    for (const s of segments) {
      s.mesh.geometry?.dispose?.();
      s.mat?.dispose?.();
      ribbonGroup.remove(s.mesh);
    }
    segments = [];
  }

  function pointAtMeters(meters) {
    if (chainage.length >= 2) {
      const p = interpolateChainage(chainage, meters);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
        return { x: p.x, z: p.z, lat: p.lat, lon: p.lon, meters };
      }
    }
    if (!stations.length) return null;
    let best = stations[0];
    let bestD = Infinity;
    for (const s of stations) {
      const a = Number.isFinite(s.along) ? s.along : 0;
      const d = Math.abs(a - meters);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return { x: best.x, z: best.z, lat: best.lat, lon: best.lon, meters };
  }

  function sampleCenterline(m0, m1) {
    const span = Math.max(1, m1 - m0);
    const step = Math.min(40, Math.max(12, span / 20));
    const out = [];
    let lastX = NaN;
    let lastZ = NaN;
    for (let m = m0; m <= m1 + 0.01; m += step) {
      const p = pointAtMeters(Math.min(m1, m));
      if (!p) continue;
      if (Number.isFinite(lastX) && Math.hypot(p.x - lastX, p.z - lastZ) < 2) continue;
      out.push(new THREE.Vector3(p.x, SURFACE_Y + Y_OFF, p.z));
      lastX = p.x;
      lastZ = p.z;
    }
    return out;
  }

  function prepare(opts = {}) {
    clear();
    if (chainage.length < 2 && stations.length < 2) return { n: 0, stepM: STEP_DEFAULT };
    const stepM = Math.max(60, Number(opts.stepM) || STEP_DEFAULT);
    for (let m0 = 0; m0 < corridorLenM - 1; m0 += stepM) {
      const m1 = Math.min(corridorLenM, m0 + stepM);
      if (m1 - m0 < 25) continue;
      const pts = sampleCenterline(m0, m1);
      if (pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(pts);
      curve.curveType = "catmullrom";
      curve.tension = 0.12;
      const geo = new THREE.TubeGeometry(curve, Math.max(16, pts.length * 2), 4.8, 6, false);
      const mat = new THREE.MeshBasicMaterial({
        color: PENDING,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        depthTest: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 29;
      ribbonGroup.add(mesh);
      segments.push({ mesh, mat, m0, m1, midM: (m0 + m1) * 0.5, value: null });
    }
    ensureMarker();
    refreshColors();
    return { n: segments.length, stepM };
  }

  function setSeries(series, meta = {}) {
    if (!segments.length) return;
    const stepM = Number(meta.stepM) || 10;
    const offsetM = Number(meta.offsetM) || 0;
    const lookup = (meters) => {
      if (Array.isArray(series) && series.length && typeof series[0] === "object") {
        let best = null;
        let bestD = Infinity;
        for (const row of series) {
          const m = Number(row.meters);
          const v = Number(row.value);
          if (!Number.isFinite(m)) continue;
          const d = Math.abs(m - meters);
          if (d < bestD) {
            bestD = d;
            best = Number.isFinite(v) ? v : null;
          }
        }
        return bestD <= stepM * 1.5 ? best : null;
      }
      if (series instanceof Float32Array || (Array.isArray(series) && typeof series[0] === "number")) {
        const idx = Math.round((meters - offsetM) / stepM);
        if (idx < 0 || idx >= series.length) return null;
        const v = Number(series[idx]);
        return Number.isFinite(v) ? v : null;
      }
      return null;
    };
    for (const seg of segments) seg.value = lookup(seg.midM);
    recomputeRange();
    refreshColors();
  }

  function recomputeRange() {
    const vals = segments.map((s) => s.value).filter((v) => Number.isFinite(v));
    if (!vals.length) {
      range = { min: 0, max: 1, span: 1 };
      return range;
    }
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (max - min < 1e-3) {
      min -= 0.5;
      max += 0.5;
    } else {
      const pad = (max - min) * 0.08;
      min -= pad;
      max += pad;
    }
    range = { min, max, span: Math.max(1e-6, max - min) };
    return range;
  }

  function colorFor(value) {
    if (!Number.isFinite(value)) return PENDING;
    const t = Math.max(0, Math.min(1, (value - range.min) / range.span));
    const c = new THREE.Color();
    if (palette === "depth") {
      // Shallow sand → deep navy (natural, not neon)
      if (t < 0.5) c.set("#7a9e8e").lerp(new THREE.Color("#3d6b8a"), t / 0.5);
      else c.set("#3d6b8a").lerp(new THREE.Color("#1a3350"), (t - 0.5) / 0.5);
    } else if (palette === "stage") {
      // Relative WSE: cool low → warm high (still subdued)
      if (t < 0.5) c.set("#5b7c8a").lerp(new THREE.Color("#6b8f9e"), t / 0.5);
      else c.set("#6b8f9e").lerp(new THREE.Color("#c4a35a"), (t - 0.5) / 0.5);
    } else if (palette === "forecast") {
      if (t < 0.5) c.set("#6b7a9e").lerp(new THREE.Color("#7a6b9e"), t / 0.5);
      else c.set("#7a6b9e").lerp(new THREE.Color("#9e6b7a"), (t - 0.5) / 0.5);
    } else if (palette === "historical") {
      c.set("#6a7a82").lerp(new THREE.Color("#8a9aa2"), t);
    } else {
      if (t < 0.33) c.set("#3d8fb0").lerp(new THREE.Color("#2f6f9a"), t / 0.33);
      else if (t < 0.66) c.set("#2f6f9a").lerp(new THREE.Color("#b0893d"), (t - 0.33) / 0.33);
      else c.set("#b0893d").lerp(new THREE.Color("#a04a3a"), (t - 0.66) / 0.34);
    }
    return c;
  }

  function setPalette(id) {
    palette = id || "discharge";
    refreshColors();
  }

  function setDimmed(v) {
    dimmed = !!v;
    refreshColors();
  }

  function refreshColors() {
    const baseOp = dimmed ? 0.32 : 0.58;
    const focusOp = dimmed ? 0.5 : 0.82;
    for (const seg of segments) {
      if (Number.isFinite(seg.value)) {
        tmpColor.copy(colorFor(seg.value));
        seg.mat.color.copy(tmpColor);
        const focused =
          focusMeters != null && focusMeters >= seg.m0 - 1 && focusMeters <= seg.m1 + 1;
        seg.mat.opacity = focused ? focusOp : baseOp;
      } else {
        seg.mat.color.set(PENDING);
        seg.mat.opacity = 0.18;
      }
    }
  }

  /**
   * Relative stage stem at selection — visual only, does not move water mesh.
   * @param {{ bedDepthM?: number|null, stageRelM?: number|null, depthM?: number|null }} info
   */
  function setStageStem(info = {}) {
    if (stageStem) {
      stageStem.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      markerGroup.remove(stageStem);
      stageStem = null;
    }
    if (focusMeters == null || !group.visible) return;
    const p = pointAtMeters(focusMeters);
    if (!p) return;
    const bed = Number(info.bedDepthM);
    const depth = Number(info.depthM);
    const h = Number.isFinite(depth) ? Math.min(8, Math.max(1.2, depth * 2.2)) : 3.5;
    const geo = new THREE.CylinderGeometry(0.55, 0.7, h, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x5b7c8a,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    stageStem = new THREE.Mesh(geo, mat);
    stageStem.position.set(p.x, SURFACE_Y + Y_OFF + h * 0.5, p.z);
    stageStem.renderOrder = 39;
    markerGroup.add(stageStem);
    // Top disc = relative water surface marker (labelled in HUD, not MSL)
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 20),
      new THREE.MeshBasicMaterial({
        color: 0x8eb4c4,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = h * 0.5 + 0.15;
    stageStem.add(disc);
    if (Number.isFinite(bed)) stageStem.userData.bedDepthM = bed;
  }

  function setFocusMeters(meters) {
    focusMeters = Number.isFinite(Number(meters)) ? Number(meters) : null;
    refreshColors();
    updateMarker();
  }

  function updateMarker() {
    ensureMarker();
    if (!selectMesh) return;
    if (focusMeters == null) {
      selectMesh.visible = false;
      return;
    }
    const p = pointAtMeters(focusMeters);
    if (!p) {
      selectMesh.visible = false;
      return;
    }
    selectMesh.visible = group.visible;
    selectMesh.position.set(p.x, SURFACE_Y + Y_OFF + 2.2, p.z);
  }

  function setVisible(v) {
    group.visible = !!v;
    if (!v && selectMesh) selectMesh.visible = false;
    else updateMarker();
  }

  function update(dt) {
    if (!group.visible || !selectMesh?.visible) return;
    pulseT += dt;
    selectMesh.scale.setScalar(1 + 0.08 * Math.sin(pulseT * 3.2));
  }

  function dispose() {
    clear();
    setStageStem({});
    if (selectMesh) {
      selectMesh.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      markerGroup.clear();
      selectMesh = null;
    }
  }

  group.userData = {
    prepare,
    setSeries,
    setPalette,
    setDimmed,
    setStageStem,
    setFocusMeters,
    setVisible,
    clear,
    update,
    dispose,
    getRange: () => ({ ...range }),
    getCorridorLenM: () => corridorLenM,
    getFocusMeters: () => focusMeters,
    pointAtMeters,
  };

  return group;
}
