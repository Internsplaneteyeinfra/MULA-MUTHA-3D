/**
 * BOD/COD class ribbon along the authoritative chainage centerline.
 * Thin tubes that stick to the river — never mesh.scale (that drifts off-channel).
 */
import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { interpolateChainage } from "../geo/chainage.js";

const DEFAULT_COLORS = {
  A: "#2E7DD1",
  B: "#3AA76D",
  C: "#E3C51E",
  D: "#E08A2E",
  E: "#D14B3A",
  NA: "#6B7A7F",
};

/**
 * @param {{ corridor?: { stations?: object[], length?: number }, chainage?: object[] }} dataset
 */
export function createBodCodLayer(dataset) {
  const group = new THREE.Group();
  group.name = "bodCodLayer";
  group.visible = false;
  group.renderOrder = 28;

  const chainage = Array.isArray(dataset?.chainage) ? dataset.chainage : [];
  const stations = dataset?.corridor?.stations || [];
  const corridorLenM =
    Number(dataset?.corridor?.length) ||
    Number(chainage[chainage.length - 1]?.meters) ||
    Number(stations[stations.length - 1]?.along) ||
    17000;

  /** @type {{ mesh:THREE.Mesh, reach:object, mat:THREE.MeshBasicMaterial, radius:number }[]} */
  let segments = [];
  let selectedId = null;
  let data = null;
  let pulseT = 0;
  /** JalNetra km → corridor meters scale (usually ~1). */
  let kmToM = 1000;

  function clear() {
    for (const s of segments) {
      s.mesh.geometry?.dispose?.();
      s.mat?.dispose?.();
      group.remove(s.mesh);
    }
    segments = [];
  }

  function setData(payload) {
    clear();
    data = payload;
    if (!payload?.reaches?.length) return;
    if (chainage.length < 2 && stations.length < 2) return;

    const colors = { ...DEFAULT_COLORS, ...(payload.class_colors || {}) };
    const dataMaxKm = Math.max(
      ...payload.reaches.map((r) => Number(r.km?.[1]) || 0),
      0.001,
    );
    // Map twin km onto this corridor so the ribbon ends with the river, not past it.
    kmToM = corridorLenM / dataMaxKm;

    for (const reach of payload.reaches) {
      const [km0, km1] = Array.isArray(reach.km) ? reach.km : [0, 2];
      const m0 = Math.max(0, Number(km0) * kmToM);
      const m1 = Math.min(corridorLenM, Number(km1) * kmToM);
      if (!(m1 > m0 + 1)) continue;

      const pts = sampleCenterline(m0, m1);
      if (pts.length < 2) continue;

      const curve = new THREE.CatmullRomCurve3(pts);
      curve.curveType = "catmullrom";
      curve.tension = 0.15;

      // Stay inside the water surface — never a fat sausage beside the banks.
      const radius = 3.2;
      const tubular = Math.max(48, pts.length * 2);
      const geo = new THREE.TubeGeometry(curve, tubular, radius, 8, false);

      const cls = String(reach.today?.cls || "NA").toUpperCase();
      const color = colors[cls] || colors.NA;
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        depthTest: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `bodCod_${reach.id}`;
      mesh.renderOrder = 30;
      mesh.userData.reachId = reach.id;
      mesh.userData.cls = cls;
      mesh.userData.m0 = m0;
      mesh.userData.m1 = m1;
      // CRITICAL: never mesh.scale — that multiplies from world origin and drifts off-river.
      group.add(mesh);
      segments.push({
        mesh,
        reach,
        mat,
        radius,
        m0,
        m1,
        midM: (m0 + m1) * 0.5,
      });
    }
  }

  function sampleCenterline(m0, m1) {
    const span = Math.max(1, m1 - m0);
    const step = Math.min(35, Math.max(18, span / 40));
    const out = [];
    let lastX = NaN;
    let lastZ = NaN;
    for (let m = m0; m <= m1 + 0.01; m += step) {
      const p = pointAtMeters(Math.min(m1, m));
      if (!p) continue;
      // Drop near-duplicates so TubeGeometry stays stable on tight bends.
      if (
        Number.isFinite(lastX) &&
        Math.hypot(p.x - lastX, p.z - lastZ) < 2.5
      ) {
        continue;
      }
      out.push(new THREE.Vector3(p.x, SURFACE_Y + 0.55, p.z));
      lastX = p.x;
      lastZ = p.z;
    }
    const end = pointAtMeters(m1);
    if (end) {
      if (
        !Number.isFinite(lastX) ||
        Math.hypot(end.x - lastX, end.z - lastZ) >= 2.5
      ) {
        out.push(new THREE.Vector3(end.x, SURFACE_Y + 0.55, end.z));
      }
    }
    return out;
  }

  function pointAtMeters(meters) {
    if (chainage.length >= 2) {
      const p = interpolateChainage(chainage, meters);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
        return { x: p.x, z: p.z, meters };
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
    return { x: best.x, z: best.z, meters };
  }

  function setVisible(v) {
    group.visible = !!v;
    if (!v) selectedId = null;
  }

  function setSelected(reachId) {
    selectedId = reachId || null;
    for (const s of segments) {
      const on = s.reach.id === selectedId;
      s.mat.opacity = on ? 0.95 : 0.4;
    }
  }

  /**
   * Recolor tubes from a live timeline snapshot.
   * @param {Array<{ id:string, sample:{ cls:string } }>} snaps
   */
  function applySnapshot(snaps) {
    if (!segments.length || !Array.isArray(snaps)) return;
    const colors = { ...DEFAULT_COLORS, ...(data?.class_colors || {}) };
    const byId = new Map(snaps.map((s) => [s.id, s]));
    for (const seg of segments) {
      const snap = byId.get(seg.reach.id);
      const cls = String(snap?.sample?.cls || seg.mesh.userData.cls || "NA").toUpperCase();
      const color = colors[cls] || colors.NA;
      seg.mat.color.set(color);
      seg.mesh.userData.cls = cls;
      if (snap?.sample) seg.liveSample = snap.sample;
    }
    setSelected(selectedId);
  }

  function update(dt) {
    if (!group.visible || !selectedId) return;
    pulseT += dt;
    const pulse = 0.78 + Math.sin(pulseT * 2.4) * 0.14;
    for (const s of segments) {
      if (s.reach.id === selectedId) s.mat.opacity = pulse;
    }
  }

  function dispose() {
    clear();
  }

  function reachMeters(reach) {
    const [km0, km1] = Array.isArray(reach?.km) ? reach.km : [0, 2];
    const m0 = Math.max(0, Number(km0) * kmToM);
    const m1 = Math.min(corridorLenM, Number(km1) * kmToM);
    return { m0, m1, midM: (m0 + m1) * 0.5 };
  }

  function findReachIndexAtMeters(meters) {
    if (!segments.length) return -1;
    const m = Number(meters);
    if (!Number.isFinite(m)) return -1;
    for (let i = 0; i < segments.length; i++) {
      if (m >= segments[i].m0 && m <= segments[i].m1 + 0.5) return i;
    }
    // Nearest mid
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < segments.length; i++) {
      const d = Math.abs(segments[i].midM - m);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  group.userData = {
    setData,
    setVisible,
    setSelected,
    applySnapshot,
    getSelected: () => selectedId,
    getData: () => data,
    getKmToM: () => kmToM,
    getCorridorLenM: () => corridorLenM,
    findReachIndexAtMeters,
    reachMeters,
    update,
    dispose,
    /**
     * @param {string} reachId
     * @param {{ preferMeters?: number }} [opts]
     */
    focusReach(reachId, opts = {}) {
      const s = segments.find((x) => x.reach.id === reachId);
      if (!s) return null;
      setSelected(reachId);
      const prefer = Number(opts.preferMeters);
      let meters = s.midM;
      if (Number.isFinite(prefer) && prefer >= s.m0 && prefer <= s.m1) {
        meters = prefer;
      }
      const pt = pointAtMeters(meters);
      return {
        reach: s.reach,
        meters,
        m0: s.m0,
        m1: s.m1,
        x: pt?.x,
        z: pt?.z,
      };
    },
  };

  return group;
}

export { DEFAULT_COLORS };
