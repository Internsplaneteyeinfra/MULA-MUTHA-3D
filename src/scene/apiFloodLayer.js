import * as THREE from "three";
import { lonLatToLocal, localToLonLat } from "../geo/geoReference.js";
import { terrainHeightAt } from "./terrain.js";
import { SURFACE_Y } from "./river.js";

const FLOOD_LIFT_M = 0.55;
const ANIM_DURATION_S = 4.8;

/**
 * MODE A — JalNetra API flood extent (source of truth).
 * Animation only controls reveal order; geometry never exceeds API mask.
 *
 * API: loadFloodResult | play | pause | replay | clear | setProgress(0..1)
 */
export function createApiFloodLayer(dataset) {
  const group = new THREE.Group();
  group.name = "apiFlood";
  group.visible = false;

  const stations = dataset.corridor?.stations || [];
  const riverPts = [];
  const step = Math.max(1, Math.floor(stations.length / 180));
  for (let i = 0; i < stations.length; i += step) {
    riverPts.push(stations[i].x, stations[i].z);
  }

  let mesh = null;
  let material = null;
  let floodAttr = null;
  let distAttr = null;
  let baseY = null;
  let anim = {
    active: false,
    paused: false,
    t: 0,
    duration: ANIM_DURATION_S,
    maxDist: 1,
    progress: 0,
  };
  let bounds = null;
  let lastInfo = null;
  let lastKmlId = null;
  let depthNote = "Depth not supplied by JalNetra Flood API (extent only).";
  /** @type {any[]} */
  let scenes = [];
  let sceneIndex = 0;
  /** Scene timeline playback (API datewise scenes) */
  let timeline = {
    active: false,
    paused: false,
    t: 0,
    dwell: 2.4,
    waitingReveal: false,
  };

  function disposeMesh() {
    if (mesh) {
      group.remove(mesh);
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    }
    mesh = null;
    material = null;
    floodAttr = null;
    distAttr = null;
    baseY = null;
  }

  function nearestRiverDist(x, z) {
    let best = Infinity;
    for (let i = 0; i < riverPts.length; i += 2) {
      const dx = riverPts[i] - x;
      const dz = riverPts[i + 1] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  /** progress 0 = at river · 1 = full API inundation extent */
  function setProgress(progress) {
    const p = THREE.MathUtils.clamp(Number(progress) || 0, 0, 1);
    anim.progress = p;
    if (!mesh || !floodAttr || !distAttr || !baseY) return;

    const pos = mesh.geometry.attributes.position;
    const col = mesh.geometry.attributes.color;
    // Start tight on the channel, then expand to full mask distance
    const threshold = THREE.MathUtils.lerp(18, anim.maxDist + 120, p);
    const soft = Math.max(70, anim.maxDist * 0.12);

    for (let i = 0; i < pos.count; i++) {
      if (floodAttr[i] < 0.5) {
        pos.setY(i, baseY[i] - 50);
        col.setXYZ(i, 0, 0, 0);
        continue;
      }
      const d = distAttr[i];
      let reveal = 1;
      if (d > threshold) {
        reveal = 1 - THREE.MathUtils.clamp((d - threshold) / soft, 0, 1);
      }
      if (p < 0.001 || reveal < 0.04) {
        pos.setY(i, baseY[i] - 50);
        col.setXYZ(i, 0.05, 0.15, 0.25);
      } else {
        pos.setY(i, baseY[i]);
        const t = THREE.MathUtils.clamp(1 - d / Math.max(anim.maxDist, 1), 0, 1);
        // Near river = brighter cyan; outer plains = deeper blue
        const r = THREE.MathUtils.lerp(0.12, 0.28, 1 - t);
        const g = THREE.MathUtils.lerp(0.55, 0.78, t);
        const b = THREE.MathUtils.lerp(0.72, 0.95, t);
        const aBoost = 0.75 + reveal * 0.25;
        col.setXYZ(i, r * aBoost, g * aBoost, b * aBoost);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (material) {
      material.opacity = THREE.MathUtils.lerp(0.35, 0.82, Math.min(1, p * 1.15));
    }
    mesh.geometry.computeBoundingSphere();
  }

  function clear() {
    disposeMesh();
    group.visible = false;
    anim.active = false;
    anim.paused = false;
    anim.t = 0;
    anim.progress = 0;
    timeline.active = false;
    timeline.paused = false;
    timeline.t = 0;
    timeline.waitingReveal = false;
    bounds = null;
    lastInfo = null;
    lastKmlId = null;
    scenes = [];
    sceneIndex = 0;
    group.userData.hasFlood = false;
    group.userData.info = null;
    group.userData.kmlId = null;
    group.userData.scenes = [];
    group.userData.sceneIndex = 0;
    group.userData.depthNote = depthNote;
  }

  function buildMeshFromScene(scene, resultInfo) {
    disposeMesh();
    const overlay = scene?.overlay;
    const raster = scene?.raster;
    if (!overlay || !raster?.mask || !raster.width || !raster.height) {
      throw new Error("Missing flood raster for visualization.");
    }

    const { mask, width, height } = raster;
    const crop = (() => {
      let px0 = width;
      let px1 = 0;
      let py0 = height;
      let py1 = 0;
      let maskOn = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (mask[y * width + x] < 0.5) continue;
          maskOn += 1;
          if (x < px0) px0 = x;
          if (x > px1) px1 = x;
          if (y < py0) py0 = y;
          if (y > py1) py1 = y;
        }
      }
      if (!maskOn || px1 < px0) return null;
      const pad = 8;
      return {
        px0: Math.max(0, px0 - pad),
        py0: Math.max(0, py0 - pad),
        px1: Math.min(width - 1, px1 + pad),
        py1: Math.min(height - 1, py1 + pad),
      };
    })();
    if (!crop) throw new Error("Flood mesh had no flooded pixels.");

    const lonSpan = overlay.east - overlay.west;
    const latSpan = overlay.north - overlay.south;
    const west = overlay.west + (crop.px0 / width) * lonSpan;
    const east = overlay.west + ((crop.px1 + 1) / width) * lonSpan;
    const north = overlay.north - (crop.py0 / height) * latSpan;
    const south = overlay.north - ((crop.py1 + 1) / height) * latSpan;
    const cropCorners = [
      lonLatToLocal(west, north),
      lonLatToLocal(east, north),
      lonLatToLocal(east, south),
      lonLatToLocal(west, south),
    ];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of cropCorners) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }

    const spanX = Math.max(40, maxX - minX);
    const spanZ = Math.max(40, maxZ - minZ);
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const segsX = THREE.MathUtils.clamp(Math.round(spanX / 12), 90, 240);
    const segsZ = THREE.MathUtils.clamp(Math.round(spanZ / 12), 60, 180);

    const geo = new THREE.PlaneGeometry(spanX, spanZ, segsX, segsZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate(cx, 0, cz);

    const pos = geo.attributes.position;
    floodAttr = new Float32Array(pos.count);
    distAttr = new Float32Array(pos.count);
    baseY = new Float32Array(pos.count);
    const colors = new Float32Array(pos.count * 3);

    /** Sample flood mask with 3×3 max so thin ribbons aren't missed by the grid. */
    function maskAtLonLat(lon, lat) {
      if (!(lonSpan > 0) || !(latSpan > 0)) return 0;
      const iu = (lon - overlay.west) / lonSpan;
      const iv = (overlay.north - lat) / latSpan;
      if (iu < -0.02 || iu > 1.02 || iv < -0.02 || iv > 1.02) return 0;
      const px = Math.round(THREE.MathUtils.clamp(iu, 0, 1) * (width - 1));
      const py = Math.round(THREE.MathUtils.clamp(iv, 0, 1) * (height - 1));
      let best = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = Math.min(width - 1, Math.max(0, px + dx));
          const y = Math.min(height - 1, Math.max(0, py + dy));
          best = Math.max(best, mask[y * width + x] || 0);
        }
      }
      return best > 0.5 ? 1 : 0;
    }

    let maxDist = 1;
    let floodCount = 0;
    let bMinX = Infinity;
    let bMaxX = -Infinity;
    let bMinZ = Infinity;
    let bMaxZ = -Infinity;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let flooded = 0;
      try {
        const ll = localToLonLat(x, z);
        flooded = maskAtLonLat(ll.lon, ll.lat);
      } catch {
        flooded = 0;
      }
      floodAttr[i] = flooded;
      const gy = terrainHeightAt(x, z, stations);
      if (flooded) {
        const y = Math.max(gy, SURFACE_Y) + FLOOD_LIFT_M;
        baseY[i] = y;
        pos.setY(i, y);
        const d = nearestRiverDist(x, z);
        distAttr[i] = d;
        if (d > maxDist) maxDist = d;
        floodCount += 1;
        bMinX = Math.min(bMinX, x);
        bMaxX = Math.max(bMaxX, x);
        bMinZ = Math.min(bMinZ, z);
        bMaxZ = Math.max(bMaxZ, z);
        colors[i * 3] = 0.18;
        colors[i * 3 + 1] = 0.7;
        colors[i * 3 + 2] = 0.88;
      } else {
        baseY[i] = gy;
        pos.setY(i, gy - 50);
        distAttr[i] = 1e6;
      }
    }

    // Fallback: stamp flooded mask pixels onto plane grid vertices (O(1) per pixel)
    if (!floodCount) {
      const stepPx = Math.max(1, Math.floor(Math.min(width, height) / 220));
      const vertsX = segsX + 1;
      const vertsZ = segsZ + 1;
      for (let py = crop.py0; py <= crop.py1; py += stepPx) {
        for (let px = crop.px0; px <= crop.px1; px += stepPx) {
          if ((mask[py * width + px] || 0) < 0.5) continue;
          const lon = overlay.west + ((px + 0.5) / width) * lonSpan;
          const lat = overlay.north - ((py + 0.5) / height) * latSpan;
          let lx;
          let lz;
          try {
            const loc = lonLatToLocal(lon, lat);
            lx = loc.x;
            lz = loc.z;
          } catch {
            continue;
          }
          const u = (lx - minX) / spanX;
          const v = (lz - minZ) / spanZ;
          if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) continue;
          const ix = Math.min(segsX, Math.max(0, Math.round(u * segsX)));
          const iz = Math.min(segsZ, Math.max(0, Math.round(v * segsZ)));
          const bestI = iz * vertsX + ix;
          if (bestI < 0 || bestI >= pos.count || floodAttr[bestI] >= 0.5) continue;
          const x = pos.getX(bestI);
          const z = pos.getZ(bestI);
          const gy = terrainHeightAt(x, z, stations);
          const y = Math.max(gy, SURFACE_Y) + FLOOD_LIFT_M;
          floodAttr[bestI] = 1;
          baseY[bestI] = y;
          pos.setY(bestI, y);
          const d = nearestRiverDist(x, z);
          distAttr[bestI] = d;
          if (d > maxDist) maxDist = d;
          floodCount += 1;
          bMinX = Math.min(bMinX, x);
          bMaxX = Math.max(bMaxX, x);
          bMinZ = Math.min(bMinZ, z);
          bMaxZ = Math.max(bMaxZ, z);
          colors[bestI * 3] = 0.18;
          colors[bestI * 3 + 1] = 0.7;
          colors[bestI * 3 + 2] = 0.88;
        }
      }
    }

    if (!floodCount) {
      geo.dispose();
      throw new Error(
        "Flood mask did not project onto the terrain. Try Clear, then Run again.",
      );
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    mesh = new THREE.Mesh(geo, material);
    mesh.name = "apiFloodMesh";
    mesh.renderOrder = 12;
    mesh.frustumCulled = false;
    group.add(mesh);

    bounds = {
      minX: bMinX,
      maxX: bMaxX,
      minZ: bMinZ,
      maxZ: bMaxZ,
      cx: (bMinX + bMaxX) * 0.5,
      cz: (bMinZ + bMaxZ) * 0.5,
      spanX: Math.max(40, bMaxX - bMinX),
      spanZ: Math.max(40, bMaxZ - bMinZ),
    };

    lastInfo = {
      ...(resultInfo || {}),
      scene_date: scene.date || scene.post_date || resultInfo?.scene_date || null,
      flood_area_ha: scene.flood_area_ha ?? resultInfo?.flood_area_ha ?? null,
      water_area_ha: scene.water_area_ha ?? resultInfo?.water_area_ha ?? null,
      pre_date: scene.pre_date ?? null,
      post_date: scene.post_date ?? null,
      kml_id: scene.kml_id,
      current_scene: sceneIndex + 1,
      total_scenes: scenes.length || 1,
      depth_note: depthNote,
      max_depth_m: null,
      avg_depth_m: null,
    };
    lastKmlId = scene.kml_id;
    group.userData.hasFlood = true;
    group.userData.info = lastInfo;
    group.userData.bounds = bounds;
    group.userData.kmlId = scene.kml_id;
    group.userData.floodVertexCount = floodCount;
    group.userData.depthNote = depthNote;
    group.userData.sceneIndex = sceneIndex;
    group.userData.scenes = scenes;
    group.visible = true;
    anim.maxDist = Math.max(120, maxDist);
  }

  /**
   * Switch to an API datewise scene (0-based). Rebuilds mesh from that scene's mask.
   */
  function setSceneIndex(index, { animate = true } = {}) {
    if (!scenes.length) return;
    const i = Math.max(0, Math.min(scenes.length - 1, index | 0));
    const scene = scenes[i];
    if (!scene?.raster?.mask) {
      throw new Error(`Scene ${i + 1} has no flood geometry yet.`);
    }
    sceneIndex = i;
    if (scene.kml_id === lastKmlId && mesh) {
      lastInfo = {
        ...lastInfo,
        scene_date: scene.date || scene.post_date,
        flood_area_ha: scene.flood_area_ha,
        water_area_ha: scene.water_area_ha,
        current_scene: i + 1,
        total_scenes: scenes.length,
      };
      group.userData.info = lastInfo;
      group.userData.sceneIndex = i;
      if (animate) replay();
      return;
    }
    buildMeshFromScene(scene, lastInfo);
    if (animate) replay();
    else setProgress(1);
  }

  /**
   * @param {{ overlay?: object, raster?: object, info?: object, scene?: object, scenes?: any[], currentScene?: number }} result
   */
  function loadFloodResult(result) {
    scenes = Array.isArray(result?.scenes) && result.scenes.length
      ? result.scenes.filter((s) => s?.raster?.mask)
      : [
          {
            ...(result?.scene || {}),
            overlay: result?.overlay,
            raster: result?.raster,
            kml_id: result?.scene?.kml_id || result?.info?.kml_id,
          },
        ].filter((s) => s?.raster?.mask);

    if (!scenes.length) {
      throw new Error("Missing flood raster for visualization.");
    }

    sceneIndex = Math.max(
      0,
      Math.min(scenes.length - 1, result?.currentScene ?? scenes.length - 1),
    );
    lastInfo = {
      ...(result.info || {}),
      depth_note: depthNote,
      max_depth_m: null,
      avg_depth_m: null,
      total_scenes: scenes.length,
      current_scene: sceneIndex + 1,
      disclaimer:
        result.disclaimer ||
        "Flood extent generated from JalNetra Flood API results.",
    };

    // Try current scene, then other dates if projection fails
    let lastErr = null;
    const order = [sceneIndex];
    for (let i = 0; i < scenes.length; i += 1) {
      if (i !== sceneIndex) order.push(i);
    }
    for (const idx of order) {
      try {
        sceneIndex = idx;
        buildMeshFromScene(scenes[idx], lastInfo);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.warn("[apiFlood] scene build failed", idx + 1, err?.message || err);
      }
    }
    if (lastErr || !mesh) {
      throw lastErr || new Error("Flood mask did not project onto the terrain.");
    }
    replay();
  }

  function play() {
    if (!mesh) return;
    anim.active = true;
    anim.paused = false;
    // If already finished, restart from the river
    if (anim.progress >= 0.98) {
      anim.t = 0;
      anim.progress = 0;
      setProgress(0);
    }
    anim.t = anim.progress * anim.duration;
    timeline.active = false;
    timeline.paused = false;
    group.visible = true;
    if (anim.progress < 0.05) setProgress(0.02);
  }

  /**
   * Multi-scene playback: for each date, animate water from river outward,
   * dwell briefly, then advance to the next scene.
   */
  function playTimeline() {
    if (!scenes.length) return;
    if (scenes.length < 2) {
      replay();
      return;
    }
    timeline.active = true;
    timeline.paused = false;
    timeline.t = 0;
    timeline.waitingReveal = true;
    setSceneIndex(sceneIndex, { animate: true });
  }

  function pause() {
    anim.paused = true;
    anim.active = false;
    timeline.paused = true;
    timeline.active = false;
  }

  function replay() {
    if (!mesh) return;
    timeline.active = false;
    timeline.waitingReveal = false;
    anim.t = 0;
    anim.progress = 0;
    setProgress(0);
    play();
  }

  function setVisible(on) {
    group.visible = !!on && !!mesh;
  }

  function update(dt) {
    // Keep river→outward reveal running even while multi-scene timeline waits
    if (mesh && anim.active && !anim.paused) {
      anim.t += dt;
      const k = Math.min(1, anim.t / anim.duration);
      const eased = 1 - (1 - k) ** 1.85;
      setProgress(eased);
      if (k >= 1) anim.active = false;
    }

    if (timeline.active && !timeline.paused && scenes.length > 1) {
      if (anim.active) {
        timeline.waitingReveal = true;
        timeline.t = 0;
        return;
      }
      // Reveal finished — dwell on full extent, then next date
      timeline.waitingReveal = false;
      timeline.t += dt;
      if (timeline.t >= timeline.dwell) {
        timeline.t = 0;
        const next = sceneIndex + 1;
        if (next >= scenes.length) {
          timeline.active = false;
          return;
        }
        setSceneIndex(next, { animate: true });
        group.userData.onSceneChange?.(sceneIndex, scenes[sceneIndex]);
      }
    }
  }

  // Public API
  group.loadFloodResult = loadFloodResult;
  group.setSceneIndex = setSceneIndex;
  group.play = play;
  group.playTimeline = playTimeline;
  group.pause = pause;
  group.replay = replay;
  group.clear = clear;
  group.setProgress = setProgress;
  group.setVisible = setVisible;
  group.update = update;

  // Compat aliases
  group.setFromApiResult = loadFloodResult;
  group.playReveal = play;
  group.userData.setFromApiResult = loadFloodResult;
  group.userData.clear = clear;
  group.userData.playReveal = play;
  group.userData.setVisible = setVisible;
  group.userData.update = update;
  group.userData.getBounds = () => bounds;
  group.userData.getInfo = () => lastInfo;
  group.userData.getProgress = () => anim.progress;
  group.userData.getSceneIndex = () => sceneIndex;
  group.userData.getScenes = () => scenes;

  return group;
}

/** @deprecated Prefer createApiFloodLayer */
export const createFloodSimulationLayer = createApiFloodLayer;
