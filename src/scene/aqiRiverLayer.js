/**
 * AQI / pollutant heat along the river — animated glow discs + ribbon.
 * Uses relative stretch across samples so small live differences still read.
 */
import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { interpolateChainage } from "../geo/chainage.js";
import { localToLonLat } from "../geo/geoReference.js";
import { AQI_CATEGORIES, aqiCategory } from "../services/aqiService.js";

const PENDING_COLOR = "#4a5c68";
const STEP_DEFAULT = 280;
const HEAT_MAX = 180;

let heatSprite = null;
function getHeatSprite() {
  if (heatSprite) return heatSprite;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.85)");
  g.addColorStop(0.7, "rgba(255,255,255,0.25)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  heatSprite = new THREE.CanvasTexture(canvas);
  heatSprite.colorSpace = THREE.SRGBColorSpace;
  heatSprite.needsUpdate = true;
  return heatSprite;
}

/**
 * @param {{ corridor?: { stations?: object[], length?: number }, chainage?: object[] }} dataset
 */
export function createAqiRiverLayer(dataset) {
  const group = new THREE.Group();
  group.name = "aqiRiverLayer";
  group.visible = false;
  group.renderOrder = 29;

  const ribbonGroup = new THREE.Group();
  ribbonGroup.name = "aqiRibbon";
  group.add(ribbonGroup);

  const heatGroup = new THREE.Group();
  heatGroup.name = "aqiHeat";
  group.add(heatGroup);

  const chainage = Array.isArray(dataset?.chainage) ? dataset.chainage : [];
  const stations = dataset?.corridor?.stations || [];
  const corridorLenM =
    Number(dataset?.corridor?.length) ||
    Number(chainage[chainage.length - 1]?.meters) ||
    Number(stations[stations.length - 1]?.along) ||
    17000;

  /** @type {{ mesh:THREE.Mesh, mat:THREE.MeshBasicMaterial, m0:number, m1:number, midM:number, reading:object|null, phase:number }[]} */
  let segments = [];
  /** @type {THREE.InstancedMesh | null} */
  let heatMesh = null;
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  let metric = "aqi";
  let focusMeters = null;
  let pulseT = 0;
  let range = { min: 0, max: 50, span: 50 };

  function clearHeat() {
    if (!heatMesh) return;
    heatGroup.remove(heatMesh);
    heatMesh.geometry?.dispose?.();
    if (heatMesh.material) {
      heatMesh.material.map = null;
      heatMesh.material.dispose();
    }
    heatMesh = null;
  }

  function clear() {
    for (const s of segments) {
      s.mesh.geometry?.dispose?.();
      s.mat?.dispose?.();
      ribbonGroup.remove(s.mesh);
    }
    segments = [];
    clearHeat();
  }

  /**
   * @param {{ stepM?: number, metric?: string }} [opts]
   */
  function prepare(opts = {}) {
    clear();
    metric = opts.metric || metric || "aqi";
    if (chainage.length < 2 && stations.length < 2) return { n: 0, stepM: STEP_DEFAULT };

    const stepM = Math.max(180, Number(opts.stepM) || STEP_DEFAULT);
    const slots = [];
    for (let m0 = 0; m0 < corridorLenM - 1; m0 += stepM) {
      const m1 = Math.min(corridorLenM, m0 + stepM);
      if (m1 - m0 < 35) continue;
      slots.push({ m0, m1, midM: (m0 + m1) * 0.5 });
    }

    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const pts = sampleCenterline(slot.m0, slot.m1);
      if (pts.length < 2) continue;

      const curve = new THREE.CatmullRomCurve3(pts);
      curve.curveType = "catmullrom";
      curve.tension = 0.12;
      const radius = 5.5;
      const tubular = Math.max(20, pts.length * 2);
      const geo = new THREE.TubeGeometry(curve, tubular, radius, 7, false);
      const mat = new THREE.MeshBasicMaterial({
        color: PENDING_COLOR,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `aqiRiver_${Math.round(slot.midM)}`;
      mesh.renderOrder = 30;
      ribbonGroup.add(mesh);
      segments.push({
        mesh,
        mat,
        m0: slot.m0,
        m1: slot.m1,
        midM: slot.midM,
        reading: null,
        phase: (i / Math.max(1, slots.length)) * Math.PI * 2,
      });
    }

    buildHeatInstances();
    recomputeRange();
    refreshAllColors();
    return { n: segments.length, stepM };
  }

  function buildHeatInstances() {
    clearHeat();
    const n = Math.min(HEAT_MAX, segments.length);
    if (!n) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: getHeatSprite(),
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    heatMesh = new THREE.InstancedMesh(geo, mat, n);
    heatMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    heatMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    heatMesh.renderOrder = 32;
    heatMesh.frustumCulled = false;

    for (let i = 0; i < n; i += 1) {
      const p = pointAtMeters(segments[i].midM);
      if (!p) continue;
      dummy.position.set(p.x, SURFACE_Y + 0.85, p.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(38, 38, 1);
      dummy.updateMatrix();
      heatMesh.setMatrixAt(i, dummy.matrix);
      tmpColor.set(PENDING_COLOR);
      heatMesh.setColorAt(i, tmpColor);
    }
    heatMesh.instanceMatrix.needsUpdate = true;
    if (heatMesh.instanceColor) heatMesh.instanceColor.needsUpdate = true;
    heatGroup.add(heatMesh);
  }

  function sampleCenterline(m0, m1) {
    const span = Math.max(1, m1 - m0);
    const step = Math.min(36, Math.max(14, span / 24));
    const out = [];
    let lastX = NaN;
    let lastZ = NaN;
    for (let m = m0; m <= m1 + 0.01; m += step) {
      const p = pointAtMeters(Math.min(m1, m));
      if (!p) continue;
      if (Number.isFinite(lastX) && Math.hypot(p.x - lastX, p.z - lastZ) < 2) continue;
      out.push(new THREE.Vector3(p.x, SURFACE_Y + 0.55, p.z));
      lastX = p.x;
      lastZ = p.z;
    }
    const end = pointAtMeters(m1);
    if (
      end &&
      (!Number.isFinite(lastX) || Math.hypot(end.x - lastX, end.z - lastZ) >= 2)
    ) {
      out.push(new THREE.Vector3(end.x, SURFACE_Y + 0.55, end.z));
    }
    return out;
  }

  function pointAtMeters(meters) {
    let x;
    let z;
    let lat;
    let lon;
    if (chainage.length >= 2) {
      const p = interpolateChainage(chainage, meters);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
        x = p.x;
        z = p.z;
        lat = Number(p.lat);
        lon = Number(p.lon);
      }
    }
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
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
      x = best.x;
      z = best.z;
      lat = Number(best.lat);
      lon = Number(best.lon);
    }
    if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && Number.isFinite(x) && Number.isFinite(z)) {
      try {
        const ll = localToLonLat(x, z);
        lat = Number(ll?.lat);
        lon = Number(ll?.lon);
      } catch {
        /* ignore */
      }
    }
    return { x, z, lat, lon, meters };
  }

  function getSamplePoints() {
    return segments.map((s) => {
      const p = pointAtMeters(s.midM);
      return {
        meters: s.midM,
        m0: s.m0,
        m1: s.m1,
        lat: Number(p?.lat),
        lon: Number(p?.lon),
        x: p?.x,
        z: p?.z,
      };
    });
  }

  function metricValue(reading) {
    if (!reading) return null;
    if (metric === "pm2_5") return Number(reading.pm2_5);
    if (metric === "pm10") return Number(reading.pm10);
    return Number(reading.aqi);
  }

  function recomputeRange() {
    const vals = segments
      .map((s) => metricValue(s.reading))
      .filter((n) => Number.isFinite(n));
    if (!vals.length) {
      range = { min: 0, max: 50, span: 50, flat: true };
      return range;
    }
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    const natural = max - min;
    if (natural < 1.5) {
      // Live corridor is nearly flat — use absolute scale so color still means something
      if (metric === "aqi") {
        range = { min: 0, max: 100, span: 100, flat: true };
      } else if (metric === "pm2_5") {
        range = { min: 0, max: 40, span: 40, flat: true };
      } else {
        range = { min: 0, max: 60, span: 60, flat: true };
      }
      return range;
    }
    // Pad a little so ends aren't clipped
    const pad = natural * 0.08;
    min -= pad;
    max += pad;
    range = { min, max, span: Math.max(1e-3, max - min), flat: false };
    return range;
  }

  function colorForValue(value, reading) {
    if (!Number.isFinite(value)) return PENDING_COLOR;
    // Relative stretch across today's corridor samples
    const t = Math.max(0, Math.min(1, (value - range.min) / range.span));
    const c = new THREE.Color();
    if (t < 0.25) {
      c.set("#12a86a").lerp(new THREE.Color("#7ecf3a"), t / 0.25);
    } else if (t < 0.5) {
      c.set("#7ecf3a").lerp(new THREE.Color("#e8c41a"), (t - 0.25) / 0.25);
    } else if (t < 0.75) {
      c.set("#e8c41a").lerp(new THREE.Color("#ef7a1a"), (t - 0.5) / 0.25);
    } else {
      c.set("#ef7a1a").lerp(new THREE.Color("#e03528"), (t - 0.75) / 0.25);
    }
    // Bias toward absolute AQI category when clearly elevated
    if (metric === "aqi" && reading) {
      const cat = reading.category || aqiCategory(reading.aqi);
      if (cat && Number(reading.aqi) >= 50) {
        c.lerp(new THREE.Color(cat.color), 0.45);
      }
    }
    return c;
  }

  function setReadingAt(meters, reading) {
    const m = Number(meters);
    if (!Number.isFinite(m) || !segments.length) return;
    let best = segments[0];
    let bestD = Infinity;
    for (const s of segments) {
      const d = Math.abs(s.midM - m);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    best.reading = reading || null;
    recomputeRange();
    refreshAllColors();
  }

  function setReadings(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const m = Number(item.meters);
      if (!Number.isFinite(m)) continue;
      let best = segments[0];
      let bestD = Infinity;
      for (const s of segments) {
        const d = Math.abs(s.midM - m);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      best.reading = item.reading || null;
    }
    recomputeRange();
    refreshAllColors();
  }

  function setMetric(id) {
    metric = id || "aqi";
    recomputeRange();
    refreshAllColors();
  }

  function setFocusMeters(meters) {
    focusMeters = Number.isFinite(Number(meters)) ? Number(meters) : null;
  }

  function refreshAllColors() {
    const nHeat = heatMesh?.count || 0;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      const val = metricValue(seg.reading);
      if (Number.isFinite(val)) {
        tmpColor.copy(colorForValue(val, seg.reading));
      } else {
        tmpColor.set(PENDING_COLOR);
      }

      seg.mat.color.copy(tmpColor);
      if (!seg.reading) {
        seg.mat.opacity = 0.2;
      } else {
        const focused =
          focusMeters != null && focusMeters >= seg.m0 - 1 && focusMeters <= seg.m1 + 1;
        seg.mat.opacity = focused ? 0.78 : 0.55;
      }

      if (heatMesh && i < nHeat) {
        heatMesh.setColorAt(i, tmpColor);
      }
    }
    if (heatMesh?.instanceColor) heatMesh.instanceColor.needsUpdate = true;
  }

  function setVisible(v) {
    group.visible = !!v;
    if (!v) focusMeters = null;
  }

  function update(dt) {
    if (!group.visible || !segments.length) return;
    pulseT += dt;
    const nHeat = heatMesh?.count || 0;
    // Traveling scanner band along the river (always moving)
    const scanM = ((pulseT * 420) % Math.max(1, corridorLenM + 800)) - 400;

    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      const wave = 0.5 + 0.5 * Math.sin(pulseT * 2.1 + seg.phase);
      const flow = 0.5 + 0.5 * Math.sin(pulseT * 1.05 - seg.midM * 0.005);
      const scanDist = Math.abs(seg.midM - scanM);
      const onScan = scanDist < 220;
      const focused =
        focusMeters != null && focusMeters >= seg.m0 - 1 && focusMeters <= seg.m1 + 1;

      if (!seg.reading) {
        seg.mat.opacity = 0.14 + wave * 0.14;
      } else if (focused) {
        seg.mat.opacity = 0.78 + wave * 0.2;
      } else if (onScan) {
        seg.mat.opacity = 0.62 + (1 - scanDist / 220) * 0.28;
      } else {
        seg.mat.opacity = 0.38 + flow * 0.32;
      }

      if (heatMesh && i < nHeat) {
        const p = pointAtMeters(seg.midM);
        if (!p) continue;
        let base = focused ? 56 : onScan ? 48 : 32;
        const size = base + wave * (focused || onScan ? 24 : 16);
        dummy.position.set(p.x, SURFACE_Y + 0.95 + wave * 0.4, p.z);
        dummy.rotation.set(-Math.PI / 2, 0, pulseT * 0.2 + seg.phase * 0.12);
        dummy.scale.set(size, size, 1);
        dummy.updateMatrix();
        heatMesh.setMatrixAt(i, dummy.matrix);
      }
    }
    if (heatMesh) heatMesh.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    clear();
  }

  group.userData = {
    prepare,
    getSamplePoints,
    setReadingAt,
    setReadings,
    setMetric,
    setFocusMeters,
    setVisible,
    clear,
    update,
    dispose,
    getCorridorLenM: () => corridorLenM,
    getSegments: () => segments,
    getRange: () => ({ ...range }),
  };

  return group;
}

/** Kept for callers; layer prefers relative stretch. */
export function colorForReading(reading, metric = "aqi") {
  if (!reading) return PENDING_COLOR;
  if (metric === "pm2_5" || metric === "pm10") {
    const max = metric === "pm2_5" ? 75 : 150;
    const n = Number(reading[metric]);
    if (!Number.isFinite(n)) return PENDING_COLOR;
    const t = Math.max(0, Math.min(1, n / max));
    const c = new THREE.Color();
    c.set("#12a86a").lerp(new THREE.Color("#e03528"), t);
    return `#${c.getHexString()}`;
  }
  const cat = reading.category || aqiCategory(reading.aqi);
  return cat?.color || AQI_CATEGORIES[0].color;
}
