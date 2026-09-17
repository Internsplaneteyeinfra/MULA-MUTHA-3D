/**
 * Climate impact heatmap — RiverEye flood / surface-water sample points in 3D.
 * Plus WRD survey flood/bank lines (blue / red / green) from GeoJSON.
 */
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { lonLatToLocal } from "../geo/geoReference.js";
import { terrainHeightAt, rawDtmElevationAt } from "./terrain.js";
import { SURFACE_Y } from "./river.js";

const MAX_POINTS_PER_CLASS = 14000;
const FLOOD_COLOR = new THREE.Color("#c2372a");
const WATER_COLOR = new THREE.Color("#2f9bd6");
/** Soft radial disc texture for heatmap instances (world-meter sized). */
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
  g.addColorStop(0.4, "rgba(255,255,255,0.75)");
  g.addColorStop(0.75, "rgba(255,255,255,0.2)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  heatSprite = new THREE.CanvasTexture(canvas);
  heatSprite.needsUpdate = true;
  heatSprite.colorSpace = THREE.SRGBColorSpace;
  return heatSprite;
}

const WRD_COLORS = {
  blue: "#1565c0",
  red: "#c62828",
  green: "#2e7d32",
};

/**
 * @param {object} dataset
 */
export function createClimateImpactLayer(dataset) {
  const group = new THREE.Group();
  group.name = "climateImpact";
  group.visible = false;

  const heatGroup = new THREE.Group();
  heatGroup.name = "climateHeat";
  group.add(heatGroup);

  const wrdGroup = new THREE.Group();
  wrdGroup.name = "climateWrdFloodLines";
  wrdGroup.visible = false;
  wrdGroup.renderOrder = 40;
  group.add(wrdGroup);

  let floodPts = null;
  let waterPts = null;
  let showFlood = true;
  let showWater = true;
  let showWrd = false;
  let wrdLoaded = false;
  let currentPeriodId = null;
  let info = null;

  const resolution = new THREE.Vector2(
    Math.max(1, window.innerWidth),
    Math.max(1, window.innerHeight),
  );

  function onResize() {
    // Line2 linewidth is in CSS pixels — do not multiply by devicePixelRatio
    resolution.set(
      Math.max(1, window.innerWidth),
      Math.max(1, window.innerHeight),
    );
    wrdGroup.traverse((obj) => {
      if (obj.material?.resolution) obj.material.resolution.copy(resolution);
    });
  }
  window.addEventListener("resize", onResize);

  function disposeHeatMesh(mesh) {
    if (!mesh) return;
    heatGroup.remove(mesh);
    mesh.geometry?.dispose?.();
    // Shared heatSprite — do not dispose map texture
    if (mesh.material) {
      mesh.material.map = null;
      mesh.material.dispose();
    }
  }

  function clearHeatMeshes() {
    disposeHeatMesh(floodPts);
    floodPts = null;
    disposeHeatMesh(waterPts);
    waterPts = null;
  }

  function clearWrdMeshes() {
    while (wrdGroup.children.length) {
      const child = wrdGroup.children[0];
      wrdGroup.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    wrdLoaded = false;
  }

  /**
   * @param {{ flood:number[][], water:number[][], period:object, classes?:object }} payload
   */
  function setPeriodData(payload) {
    clearHeatMeshes();
    info = payload?.period || null;
    currentPeriodId = payload?.period?.id ?? null;
    const stations = dataset?.corridor?.stations || [];
    const floodColor = payload?.classes?.flood?.color
      ? new THREE.Color(payload.classes.flood.color)
      : FLOOD_COLOR;
    const waterColor = payload?.classes?.water?.color
      ? new THREE.Color(payload.classes.water.color)
      : WATER_COLOR;

    // World-space soft discs (not KML polygons) — readable from overview like RiverEye heat
    floodPts = buildHeatMesh(payload?.flood || [], floodColor, stations, 32, 0.72);
    waterPts = buildHeatMesh(payload?.water || [], waterColor, stations, 26, 0.55);
    if (floodPts) {
      floodPts.name = "climateFloodHeat";
      floodPts.visible = showFlood;
      floodPts.renderOrder = 32;
      heatGroup.add(floodPts);
    }
    if (waterPts) {
      waterPts.name = "climateWaterHeat";
      waterPts.visible = showWater;
      waterPts.renderOrder = 31;
      heatGroup.add(waterPts);
    }
    syncVisibility();
    const infoOut = getInfo();
    console.info("[climate-impact] heatmap", {
      periodId: currentPeriodId,
      nFlood: infoOut.nFlood,
      nWater: infoOut.nWater,
      showFlood,
      showWater,
    });
    return infoOut;
  }

  /**
   * WRD survey lines — thin continuous polylines like the 2D RiverEye map
   * (not thick dashed “noodles”). Drawn flat just above the water surface.
   * @param {{ features: Array<{ line:string, color:string, coordinates:number[][] }> }} geo
   */
  function setWrdFloodLines(geo) {
    clearWrdMeshes();
    const features = geo?.features || [];
    // Draw bank (green) under flood (blue/red) so flood extents read clearly
    const order = { green: 0, blue: 1, red: 2 };
    const sorted = [...features].sort(
      (a, b) => (order[a.line] ?? 9) - (order[b.line] ?? 9),
    );

    let n = 0;
    for (const f of sorted) {
      const pts = projectSurveyLine(f.coordinates || []);
      if (pts.length < 2) continue;
      const hex = f.color || WRD_COLORS[f.line] || "#888888";
      const color = new THREE.Color(hex).getHex();
      const baseOrder = 40 + (order[f.line] ?? 0) * 2;
      // Subtle dark casing + thin colored stroke (map-style, not fat tubes)
      wrdGroup.add(
        makeFatLine(pts, {
          color: 0x0b1220,
          linewidth: 3.2,
          opacity: 0.55,
          resolution,
          renderOrder: baseOrder,
        }),
      );
      wrdGroup.add(
        makeFatLine(pts, {
          color,
          linewidth: 1.8,
          opacity: 1,
          resolution,
          renderOrder: baseOrder + 1,
        }),
      );
      n += 1;
    }
    wrdLoaded = n > 0;
    wrdGroup.visible = showWrd && wrdLoaded;
    syncVisibility();
    console.info("[climate-impact] WRD flood lines", { segments: n, features: features.length });
    return getInfo();
  }

  /**
   * Instanced soft discs in meters — stays visible at overview (Points vanish when tiny).
   * RiverEye source is lon/lat sample points, not KML polygons.
   */
  function buildHeatMesh(pairs, color, stations, radiusM, opacity) {
    if (!pairs.length) return null;
    const step = Math.max(1, Math.ceil(pairs.length / MAX_POINTS_PER_CLASS));
    const capacity = Math.ceil(pairs.length / step);
    const yFlat = SURFACE_Y + 2.0;
    const positions = [];
    for (let i = 0; i < pairs.length; i += step) {
      const [lon, lat] = pairs[i];
      let x;
      let z;
      try {
        const local = lonLatToLocal(lon, lat);
        x = local.x;
        z = local.z;
      } catch {
        continue;
      }
      const ground = sampleGroundY(x, z, stations, 1.4);
      const y = Math.max(yFlat, ground);
      positions.push(x, y, z);
      if (positions.length / 3 >= capacity) break;
    }
    const count = positions.length / 3;
    if (!count) return null;

    const geo = new THREE.CircleGeometry(radiusM, 16);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      map: getHeatSprite(),
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < count; i += 1) {
      p.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.count = count;
    return mesh;
  }

  function sampleGroundY(x, z, stations, lift) {
    const dtmY = rawDtmElevationAt(x, z);
    const ground =
      Number.isFinite(dtmY)
        ? dtmY
        : stations.length
          ? terrainHeightAt(x, z, stations)
          : SURFACE_Y;
    return Math.max(SURFACE_Y + 0.35, (Number.isFinite(ground) ? ground : SURFACE_Y) + lift);
  }

  /**
   * Project survey lon/lat to a near-flat ribbon above the river (dashboard 2D look).
   * Avoid per-vertex DTM spikes — those made thick strokes look like tangled noodles.
   */
  function projectSurveyLine(coords) {
    const out = [];
    const yFlat = SURFACE_Y + 2.4;
    // Light decimation on very dense digitized polylines
    const step = coords.length > 400 ? 2 : 1;
    for (let i = 0; i < coords.length; i += step) {
      const c = coords[i];
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (lon < 73.7 || lon > 74.2 || lat < 18.4 || lat > 18.7) continue;
      try {
        const local = lonLatToLocal(lon, lat);
        out.push(new THREE.Vector3(local.x, yFlat, local.z));
      } catch {
        /* skip */
      }
    }
    // Always keep last point
    if (coords.length > 1 && step > 1) {
      const last = coords[coords.length - 1];
      const lon = Number(last[0]);
      const lat = Number(last[1]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        try {
          const local = lonLatToLocal(lon, lat);
          const p = new THREE.Vector3(local.x, yFlat, local.z);
          const prev = out[out.length - 1];
          if (!prev || prev.distanceToSquared(p) > 0.01) out.push(p);
        } catch {
          /* skip */
        }
      }
    }
    return out;
  }

  function makeFatLine(points, { color, linewidth, opacity, resolution: res, renderOrder }) {
    const positions = [];
    for (const p of points) positions.push(p.x, p.y, p.z);
    const geo = new LineGeometry();
    geo.setPositions(positions);
    const mat = new LineMaterial({
      color,
      linewidth,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
      worldUnits: false,
      resolution: res,
      toneMapped: false,
    });
    const line = new Line2(geo, mat);
    line.renderOrder = renderOrder;
    line.frustumCulled = false;
    return line;
  }

  function syncVisibility() {
    const heatOn = (showFlood && !!floodPts) || (showWater && !!waterPts);
    const wrdOn = showWrd && wrdLoaded;
    if (floodPts) floodPts.visible = showFlood;
    if (waterPts) waterPts.visible = showWater;
    heatGroup.visible = heatOn;
    // Keep heat readable; only slightly soften when WRD lines are also on
    if (floodPts?.material) {
      floodPts.material.opacity = showWrd && wrdLoaded ? 0.55 : 0.72;
    }
    if (waterPts?.material) {
      waterPts.material.opacity = showWrd && wrdLoaded ? 0.4 : 0.55;
    }
    wrdGroup.visible = wrdOn;
    group.visible = heatOn || wrdOn;
  }

  function setClassVisible({ flood, water, wrd } = {}) {
    if (flood != null) showFlood = !!flood;
    if (water != null) showWater = !!water;
    if (wrd != null) showWrd = !!wrd;
    syncVisibility();
  }

  function setVisible(on) {
    if (!on) {
      group.visible = false;
      return;
    }
    syncVisibility();
  }

  function getInfo() {
    return {
      periodId: currentPeriodId,
      period: info,
      showFlood,
      showWater,
      showWrd,
      wrdLoaded,
      nFlood: floodPts?.count ?? 0,
      nWater: waterPts?.count ?? 0,
      nWrd: Math.floor(wrdGroup.children.length / 2),
      floodAreaHa: info?.flood_area_ha ?? null,
      waterAreaHa: info?.water_area_ha ?? null,
    };
  }

  function clear() {
    clearHeatMeshes();
    clearWrdMeshes();
    info = null;
    currentPeriodId = null;
    showWrd = false;
    group.visible = false;
  }

  group.userData = {
    setPeriodData,
    setWrdFloodLines,
    setClassVisible,
    setVisible,
    getInfo,
    clear,
    dispose() {
      window.removeEventListener("resize", onResize);
      clear();
    },
    get hasData() {
      return !!(floodPts || waterPts || wrdLoaded);
    },
  };

  return group;
}
