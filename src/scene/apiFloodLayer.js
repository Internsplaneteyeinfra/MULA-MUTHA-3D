import * as THREE from "three";
import { lonLatToLocal, localToLonLat } from "../geo/geoReference.js";
import { terrainHeightAt } from "./terrain.js";
import { SURFACE_Y } from "./river.js";
import { createWaterMaterial, syncWaterMaterial } from "./waterShader.js";
import { verticalDatumPipeline } from "../services/hydrology/verticalDatumPipeline.js";
import { hydrologyStore } from "../services/hydrology/hydrologyStore.js";
import { state } from "../state.js";

const FLOOD_LIFT_M = 0.55;
const ANIM_DURATION_S = 4.8;
/** Colour-ramp span for extent-only floods (visual shading, not a measured depth). */
const EXTENT_SHADE_DEPTH_M = 1.5;
const FRONT_MARGIN_M = 12;
const EASE_POWER = 1.85;

const easeProgress = (k) => 1 - (1 - k) ** EASE_POWER;
const unEaseProgress = (p) => 1 - (1 - p) ** (1 / EASE_POWER);

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
  let boundary = null;
  /** @type {Float32Array | null} */
  let revealSorted = null;
  let floodAttr = null;
  let distAttr = null;
  let baseY = null;
  let terrainYAttr = null;
  let spillElevationsAttr = null;
  /** Sampling-grid coordinates per cell index (floodAttr/distAttr index space, not the compacted mesh). */
  let gridX = null;
  let gridZ = null;
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
    group.userData.hasFlood = false;
    group.hasFlood = false;
    if (mesh) {
      group.remove(mesh);
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    }
    if (boundary) {
      group.remove(boundary);
      boundary.geometry?.dispose?.();
      boundary.material?.dispose?.();
    }
    boundary = null;
    revealSorted = null;
    mesh = null;
    material = null;
    floodAttr = null;
    distAttr = null;
    baseY = null;
    terrainYAttr = null;
    spillElevationsAttr = null;
    gridX = null;
    gridZ = null;
  }

  /** Distance to the centreline polyline (segments, not samples, so the front grows as a band, not beads). */
  function nearestRiverDist(x, z) {
    if (riverPts.length < 4) {
      return riverPts.length ? Math.hypot(riverPts[0] - x, riverPts[1] - z) : 0;
    }
    let best = Infinity;
    for (let i = 0; i + 3 < riverPts.length; i += 2) {
      const ax = riverPts[i];
      const az = riverPts[i + 1];
      const vx = riverPts[i + 2] - ax;
      const vz = riverPts[i + 3] - az;
      const len2 = vx * vx + vz * vz;
      const t = len2 > 0 ? THREE.MathUtils.clamp(((x - ax) * vx + (z - az) * vz) / len2, 0, 1) : 0;
      const dx = ax + vx * t - x;
      const dz = az + vz * t - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  /**
   * Reveal distance for a progress value, paced by the sorted reveal values so the
   * wet area grows steadily instead of jumping on a few distant cells. The margin
   * keeps p = 0 fully dry and p = 1 fully wet (every reveal is ≤ anim.maxDist).
   */
  function floodFrontDistance(p) {
    const n = revealSorted?.length || 0;
    if (!n) return p * (anim.maxDist + FRONT_MARGIN_M);
    const f = p * (n - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(n - 1, i0 + 1);
    const q = revealSorted[i0] + (revealSorted[i1] - revealSorted[i0]) * (f - i0);
    return q + (2 * p - 1) * FRONT_MARGIN_M;
  }

  /** progress 0 = at river · 1 = full API inundation extent */
  function setProgress(progress) {
    const p = THREE.MathUtils.clamp(Number(progress) || 0, 0, 1);
    anim.progress = p;
    // Single clock: playback time is always derived from progress (slider, reset, play).
    anim.t = unEaseProgress(p) * anim.duration;
    if (!mesh || !floodAttr || !terrainYAttr || !spillElevationsAttr || !lastInfo) return;

    const initialWaterLevelY = lastInfo._scene_initial_water_y;
    const globalFinalWaterLevelY = lastInfo._scene_final_water_y;
    const hasGlobalWaterLevel = Number.isFinite(globalFinalWaterLevelY);
    
    let currentFloodedAreaHa = 0;
    
    const count = floodAttr.length;
    const cellAreaHa = mesh.userData.cellAreaHa || 0.0144; // Default ~12m x 12m

    const currentFloodFrontDistance = floodFrontDistance(p);

    let visibleCells = 0;
    let totalCells = 0;

    for (let i = 0; i < count; i++) {
      const isInsideFinalKML = floodAttr[i] > 0.5;

      // Only count cells that are actually underwater at the final state
      if (isInsideFinalKML) {
          if (!hasGlobalWaterLevel || globalFinalWaterLevelY > terrainYAttr[i]) {
              totalCells++;
              if (Math.min(distAttr[i], anim.maxDist) <= currentFloodFrontDistance) {
                  visibleCells++;
              }
          }
      }
    }
    
    const fraction = totalCells > 0 ? (visibleCells / totalCells) : 0;
    const targetArea = lastInfo.flood_area_ha || (totalCells * cellAreaHa);
    currentFloodedAreaHa = fraction * targetArea;
    lastInfo._current_flooded_area_ha = currentFloodedAreaHa;
    if (hasGlobalWaterLevel) {
      // Full-channel rise from normal river sheet (SURFACE_Y) → target WSE.
      const riseTarget =
        Number.isFinite(lastInfo._target_water_rise_m) && lastInfo._target_water_rise_m >= 0
          ? lastInfo._target_water_rise_m
          : Math.max(0, globalFinalWaterLevelY - (Number.isFinite(initialWaterLevelY) ? initialWaterLevelY : SURFACE_Y));
      const physicalRiseM = riseTarget * p;
      state.floodRiseM = physicalRiseM;
      const currentWaterY = SURFACE_Y + physicalRiseM;

      // Lift red flood sheet with the same rising WSE so blue + red stay flush.
      const groundY = mesh.userData?.groundY;
      const posAttr = mesh.geometry?.attributes?.position;
      if (groundY && posAttr && groundY.length === posAttr.count) {
        for (let i = 0; i < posAttr.count; i++) {
          posAttr.setY(i, Math.max(currentWaterY, groundY[i] + 0.02));
        }
        posAttr.needsUpdate = true;
        mesh.geometry.computeBoundingSphere?.();
      }

      // Update UI metrics for physical data
      lastInfo.current_water_level = verticalDatumPipeline.sceneYToWseMsl(currentWaterY);
      lastInfo.water_rise_mm = physicalRiseM * 1000;
      lastInfo.water_rise_m = riseTarget;
    } else {
      // If no valid water-level, ensure river doesn't artificially rise and UI reflects missing data
      state.floodRiseM = 0;
      lastInfo.current_water_level = null;
      lastInfo.water_rise_mm = null;
      lastInfo.final_water_level = null; // Explicitly ensure it's unavaiable
    }
    
    if (material && material.uniforms) {
      // Solid filled flood water (not a hollow outline)
      material.uniforms.uOpacity.value = THREE.MathUtils.lerp(0.78, 0.92, Math.min(1, p * 1.15));
      material.uniforms.uReveal.value = 10000.0;
      material.uniforms.uAnimEnabled.value = 1.0;
      material.uniforms.uOverallSpeed.value = 1.05;
      material.uniforms.uFlowSpeed.value = 0.95;
      material.uniforms.uFlowStrength.value = 1.1;
      if (material.uniforms.uFloodProgressDist) {
        material.uniforms.uFloodProgressDist.value = currentFloodFrontDistance;
      }
      // No hard red rim — water fills the flood polygon
      if (material.uniforms.uFrontLine) material.uniforms.uFrontLine.value = 0;
    }
    if (boundary) boundary.visible = false;
    
    
    // Explicit Validation Request
    const debugState = {
      initialWaterSurfaceElevation: lastInfo.initial_water_level,
      finalWaterSurfaceElevation: lastInfo.final_water_level,
      currentWaterSurfaceElevation: lastInfo.current_water_level,
      currentWaterSurfaceSceneY: hasGlobalWaterLevel ? initialWaterLevelY + (globalFinalWaterLevelY - initialWaterLevelY) * p : initialWaterLevelY,
      waterRise: lastInfo.water_rise_m,
      wetCellCount: currentFloodedAreaHa
    };
    
    // Level fields only exist when the API supplied a water level.
    if (hasGlobalWaterLevel) {
      for (const [key, val] of Object.entries(debugState)) {
        if (key === "wetCellCount") continue;
        if (val === undefined || Number.isNaN(val) || val === Infinity || val === -Infinity) {
          console.error(`[Flood Validation Error] ${key} is invalid:`, val, debugState);
          mesh.visible = false;
          if (boundary) boundary.visible = false;
          return;
        }
      }
    }
    
    // Add requested milestone debug logging
    const pPercent = p * 100;
    if (p === 0 || anim.lastLoggedProgress === undefined) anim.lastLoggedProgress = -1;
    
    const milestones = [0, 25, 50, 75, 100];
    for (const ms of milestones) {
      if (anim.lastLoggedProgress < ms && pPercent >= ms) {
        console.log(`[Flood Progress ${ms}%]`, {
          simulationProgress: p,
          visibleFloodVertices: visibleCells,
          totalFloodVertices: totalCells,
          currentFrontDistance: currentFloodFrontDistance,
          floodMeshVisibility: mesh.visible,
          actualApiFloodAreaHa: lastInfo.flood_area_ha || lastInfo.flood_area_ha_fallback,
          currentFloodedAreaHa
        });
      }
    }
    anim.lastLoggedProgress = pPercent;
  }

  function clear() {
    const hadFlood = !!mesh;
    disposeMesh();
    if (hadFlood) document.dispatchEvent(new CustomEvent("flood-geometry-cleared"));
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
    if (!overlay) {
      throw new Error("Missing flood overlay for visualization.");
    }

    const { mask, floodMask, width, height, fromPolygons } = raster || {};
    
    let crop = null;
    if (mask && mask.length > 0) {
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
      if (maskOn && px1 >= px0) {
        const pad = 8;
        crop = {
          px0: Math.max(0, px0 - pad),
          py0: Math.max(0, py0 - pad),
          px1: Math.min(width - 1, px1 + pad),
          py1: Math.min(height - 1, py1 + pad),
        };
      }
    }
    
    if (!crop && !fromPolygons) throw new Error("Flood mesh had no flooded pixels or polygons.");

    let west, east, north, south;
    if (crop) {
      const lonSpan = overlay.east - overlay.west;
      const latSpan = overlay.north - overlay.south;
      west = overlay.west + (crop.px0 / width) * lonSpan;
      east = overlay.west + ((crop.px1 + 1) / width) * lonSpan;
      north = overlay.north - (crop.py0 / height) * latSpan;
      south = overlay.north - ((crop.py1 + 1) / height) * latSpan;
    } else {
      west = overlay.west;
      east = overlay.east;
      north = overlay.north;
      south = overlay.south;
    }
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
    // Higher density mesh grid (~5.5m spacing) for smooth, non-blocky organic contours
    const segsX = THREE.MathUtils.clamp(Math.round(spanX / 5.5), 150, 360);
    const segsZ = THREE.MathUtils.clamp(Math.round(spanZ / 5.5), 100, 260);

    let geo = new THREE.PlaneGeometry(spanX, spanZ, segsX, segsZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate(cx, 0, cz);

    const pos = geo.attributes.position;
    floodAttr = new Float32Array(pos.count);
    distAttr = new Float32Array(pos.count);
    baseY = new Float32Array(pos.count);
    terrainYAttr = new Float32Array(pos.count);
    spillElevationsAttr = new Float32Array(pos.count).fill(Infinity);
    gridX = new Float32Array(pos.count);
    gridZ = new Float32Array(pos.count);
    const colors = new Float32Array(pos.count * 3);
    const debugColors = new Float32Array(pos.count * 3);

    const lonSpan = overlay.east - overlay.west;
    const latSpan = overlay.north - overlay.south;
    
    function pointInRing(lon, lat, ring) {
      if (!ring || ring.length < 3) return false;
      let inside = false;
      let j = ring.length - 1;
      for (let i = 0; i < ring.length; i++) {
        if ((ring[i].lat > lat) !== (ring[j].lat > lat) &&
            (lon < (ring[j].lon - ring[i].lon) * (lat - ring[i].lat) / (ring[j].lat - ring[i].lat) + ring[i].lon)) {
          inside = !inside;
        }
        j = i;
      }
      return inside;
    }

    function pointInFloodPolygons(lon, lat, polys) {
      if (!polys || !polys.length) return false;
      for (const p of polys) {
        if (!p) continue;
        const outer = p.outer || (Array.isArray(p) ? p : null);
        if (!outer) continue;
        if (pointInRing(lon, lat, outer)) {
          // If point falls inside any inner hole ring, it is unflooded dry land
          if (p.holes && p.holes.length) {
            let inHole = false;
            for (const h of p.holes) {
              if (pointInRing(lon, lat, h)) {
                inHole = true;
                break;
              }
            }
            if (inHole) continue;
          }
          return true;
        }
      }
      return false;
    }

    /** Continuous bilinear interpolation of flood mask for smooth non-blocky gradients. */
    function maskAtLonLat(lon, lat) {
      if (fromPolygons && overlay.polygons) {
        return pointInFloodPolygons(lon, lat, overlay.polygons) ? 1.0 : 0.0;
      }
      
      if (!(lonSpan > 0) || !(latSpan > 0) || !mask) return 0.0;
      const iu = (lon - overlay.west) / lonSpan;
      const iv = (overlay.north - lat) / latSpan;
      if (iu < 0.0 || iu > 1.0 || iv < 0.0 || iv > 1.0) return 0.0;
      const fx = iu * (width - 1);
      const fy = iv * (height - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const v00 = mask[y0 * width + x0] || 0;
      const v10 = mask[y0 * width + x1] || 0;
      const v01 = mask[y1 * width + x0] || 0;
      const v11 = mask[y1 * width + x1] || 0;
      return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    }

    /** Continuous bilinear interpolation of red flood mask (1.0 = flood, 0.0 = river water or dry). */
    function floodAtLonLat(lon, lat) {
      if (fromPolygons) return 1.0;
      if (!(lonSpan > 0) || !(latSpan > 0) || !floodMask) return 0.0;
      const iu = (lon - overlay.west) / lonSpan;
      const iv = (overlay.north - lat) / latSpan;
      if (iu < 0.0 || iu > 1.0 || iv < 0.0 || iv > 1.0) return 0.0;
      const fx = iu * (width - 1);
      const fy = iv * (height - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const v00 = floodMask[y0 * width + x0] || 0;
      const v10 = floodMask[y0 * width + x1] || 0;
      const v01 = floodMask[y1 * width + x0] || 0;
      const v11 = floodMask[y1 * width + x1] || 0;
      return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    }

    const isFloodGrid = new Float32Array(pos.count);
    let maxDist = 1;
    let floodCount = 0;
    let sumFloodX = 0;
    let sumFloodZ = 0;
    let bMinX = Infinity;
    let bMaxX = -Infinity;
    let bMinZ = Infinity;
    let bMaxZ = -Infinity;
    let maxTerrainY = -Infinity;
    let floodOnlyCount = 0;
    let sumFloodOnlyX = 0;
    let sumFloodOnlyZ = 0;
    let bMinFloodX = Infinity;
    let bMaxFloodX = -Infinity;
    let bMinFloodZ = Infinity;
    let bMaxFloodZ = -Infinity;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      gridX[i] = x;
      gridZ[i] = z;
      let flooded = 0;
      let isFloodVal = 0;
      try {
        const ll = localToLonLat(x, z);
        flooded = maskAtLonLat(ll.lon, ll.lat);
        isFloodVal = floodAtLonLat(ll.lon, ll.lat);
      } catch {
        flooded = 0;
        isFloodVal = 0;
      }
      floodAttr[i] = flooded;
      isFloodGrid[i] = isFloodVal;
      const gy = terrainHeightAt(x, z, stations);
      terrainYAttr[i] = gy;
      
      if (flooded) {
        if (gy > maxTerrainY) maxTerrainY = gy;
        floodCount += 1;
        sumFloodX += x;
        sumFloodZ += z;
        bMinX = Math.min(bMinX, x);
        bMaxX = Math.max(bMaxX, x);
        bMinZ = Math.min(bMinZ, z);
        bMaxZ = Math.max(bMaxZ, z);

        if (isFloodVal > 0.25) {
          floodOnlyCount += 1;
          sumFloodOnlyX += x;
          sumFloodOnlyZ += z;
          bMinFloodX = Math.min(bMinFloodX, x);
          bMaxFloodX = Math.max(bMaxFloodX, x);
          bMinFloodZ = Math.min(bMinFloodZ, z);
          bMaxFloodZ = Math.max(bMaxFloodZ, z);
        }
      }
      
      const d = nearestRiverDist(x, z);
      distAttr[i] = d;
      if (flooded && d > maxDist) maxDist = d;
      
      // Mark initial river sources anywhere on the mesh (cells inside river channel or very close)
      if (d < 35 || gy <= SURFACE_Y + 0.25) {
        spillElevationsAttr[i] = gy;
      }
    }
    
    // Connected flood fill (Dijkstra/Bellman-Ford relaxation on grid)
    // Ensures flood only spreads to connected cells within KML
    const vertsX = segsX + 1;
    const vertsZ = segsZ + 1;
    let changed = true;
    let passes = 0;
    while (changed && passes < 250) {
      changed = false;
      passes++;
      for (let iz = 0; iz < vertsZ; iz++) {
        for (let ix = 0; ix < vertsX; ix++) {
          const i = iz * vertsX + ix;
          
          let e = spillElevationsAttr[i];
          const ty = terrainYAttr[i];
          
          const neighbors = [];
          if (ix > 0) neighbors.push(i - 1);
          if (ix < vertsX - 1) neighbors.push(i + 1);
          if (iz > 0) {
            neighbors.push(i - vertsX);
            if (ix > 0) neighbors.push(i - vertsX - 1);
            if (ix < vertsX - 1) neighbors.push(i - vertsX + 1);
          }
          if (iz < vertsZ - 1) {
            neighbors.push(i + vertsX);
            if (ix > 0) neighbors.push(i + vertsX - 1);
            if (ix < vertsX - 1) neighbors.push(i + vertsX + 1);
          }
          
          for (const n of neighbors) {
            const nSpill = spillElevationsAttr[n];
            if (nSpill < Infinity) {
              const pathElev = Math.max(nSpill, ty);
              if (pathElev < e) {
                e = pathElev;
              }
            }
          }
          if (e < spillElevationsAttr[i]) {
            spillElevationsAttr[i] = e;
            changed = true;
          }
        }
      }
    }

    // Compute terrain-based flood priority combining horizontal distance and vertical climb.
    // 1m of elevation rise acts equivalent to 50m of horizontal distance.
    maxDist = 1;
    for (let i = 0; i < pos.count; i++) {
        if (!floodAttr[i]) continue;
        const d = distAttr[i];
        const spillY = spillElevationsAttr[i];
        
        let effectiveDist = 1e6; // Default to extremely high if unreachable
        if (spillY < Infinity) {
            const elevDiff = Math.max(0, spillY - SURFACE_Y);
            effectiveDist = d + (elevDiff * 50.0);
        }
        
        distAttr[i] = effectiveDist;
        if (effectiveDist > maxDist && effectiveDist < 1e5) {
            maxDist = effectiveDist;
        }
    }

    let providedRise = scene.water_rise;
    let providedWaterLevel = scene.final_water_level;
    
    // FETCH LIVE DIGITAL TWIN WATER LEVEL
    let liveMeanWse = null;
    try {
      const hydroProfile = hydrologyStore.getProfile();
      if (hydroProfile && hydroProfile.records && hydroProfile.records.length > 0) {
        const wseValues = hydroProfile.records.map(r => r.wse_m?.value).filter(Number.isFinite);
        if (wseValues.length > 0) {
          liveMeanWse = wseValues.reduce((a, b) => a + b, 0) / wseValues.length;
        }
      }
    } catch(err) {
      console.warn("Could not fetch live Digital Twin water level:", err);
    }
    
    // Calculate authoritative MSL water levels and the derived scene Y coordinates
    let initialWaterMsl = liveMeanWse != null ? liveMeanWse : verticalDatumPipeline.sceneYToWseMsl(SURFACE_Y);
    let finalWaterMsl = providedWaterLevel;
    let waterRiseM = providedRise;

    const sceneInitialWaterLevelY = verticalDatumPipeline.wseMslToSceneY(initialWaterMsl);
    let sceneFinalWaterLevelY = NaN;
    
    let levelSource = null;
    if (providedRise != null) {
      waterRiseM = providedRise;
      finalWaterMsl = initialWaterMsl + waterRiseM;
      sceneFinalWaterLevelY = verticalDatumPipeline.wseMslToSceneY(finalWaterMsl);
      levelSource = "api";
    } else if (providedWaterLevel != null) {
      waterRiseM = providedWaterLevel - initialWaterMsl;
      finalWaterMsl = providedWaterLevel;
      sceneFinalWaterLevelY = verticalDatumPipeline.wseMslToSceneY(finalWaterMsl);
      levelSource = "api";
    } else {
      // Extent-only JalNetra product: estimate WSE rise from inundated bank terrain
      // so the full blue river rises with the red flood sheet (not patches only).
      const bankYs = [];
      for (let i = 0; i < pos.count; i++) {
        if (!(floodAttr[i] > 0.5)) continue;
        const gy = terrainYAttr[i];
        if (Number.isFinite(gy) && gy > SURFACE_Y - 0.2) bankYs.push(gy);
      }
      if (bankYs.length >= 6) {
        bankYs.sort((a, b) => a - b);
        // Prefer bank crest above normal river (SURFACE_Y) so rise is visually obvious.
        const p80 = bankYs[Math.min(bankYs.length - 1, Math.floor(bankYs.length * 0.8))];
        const fromBanks = Math.max(0, p80 - SURFACE_Y);
        waterRiseM = THREE.MathUtils.clamp(Math.max(fromBanks, p80 - sceneInitialWaterLevelY), 0.8, 4.0);
        finalWaterMsl = initialWaterMsl + waterRiseM;
        // Keep scene rise relative to the rendered river sheet (SURFACE_Y), not MSL mapping.
        sceneFinalWaterLevelY = SURFACE_Y + waterRiseM;
        levelSource = "estimated_from_extent";
      } else {
        // Fallback: still raise the full river so flood playback is never a flat sheet.
        waterRiseM = 1.2;
        finalWaterMsl = initialWaterMsl + waterRiseM;
        sceneFinalWaterLevelY = SURFACE_Y + waterRiseM;
        levelSource = "estimated_default";
      }
    }
    // Anchor animated river/flood sheet rise to the visible channel (SURFACE_Y + rise_m).
    // MSL labels stay on lastInfo; scene mesh Y must match the blue river ribbon.
    if (Number.isFinite(waterRiseM) && waterRiseM >= 0) {
      sceneFinalWaterLevelY = SURFACE_Y + waterRiseM;
    }
    const hasWaterLevel = Number.isFinite(sceneFinalWaterLevelY);
    depthNote = hasWaterLevel
      ? levelSource === "api"
        ? "Water level supplied by API; depth = level − DTM."
        : "Water rise estimated from inundated bank DTM so the full river stage rises with the flood extent."
      : "JalNetra returned flood extent only — water level, rise and depth are not provided. Extent draped over DTM.";

    let maxActualDepthM = 0;

    for (let i = 0; i < pos.count; i++) {
      if (floodAttr[i]) {
        const gy = terrainYAttr[i];
        
        // Calculate max depth only on valid flooded cells (spillElevations <= final scene water level)
        if (hasWaterLevel && sceneFinalWaterLevelY >= spillElevationsAttr[i] && sceneFinalWaterLevelY > gy) {
          const depthM = finalWaterMsl - verticalDatumPipeline.sceneYToWseMsl(gy);
          if (depthM > maxActualDepthM) maxActualDepthM = depthM;
        }
        
        const y = hasWaterLevel ? Math.max(sceneFinalWaterLevelY, gy + 0.05) : gy + 0.12;
        baseY[i] = y;
        pos.setY(i, y);
      } else {
        const gy = terrainYAttr[i];
        baseY[i] = gy;
        pos.setY(i, gy); // Do NOT pull down by 50m to avoid vertical walls
        distAttr[i] = 1e6;
      }
    }

    if (!floodCount) {
      geo.dispose();
      throw new Error("Flood mask did not project onto the terrain. Try Clear, then Run again.");
    }
    
    // Distance-to-shoreline transform (two-pass chamfer, in metres).
    // Gives the shader a continuous shoreline distance so the flood edge fades
    // over ~25 m of terrain instead of a hard half-cell polygon cut.
    const cellM = Math.max(spanX / segsX, spanZ / segsZ);
    const edgeDistGrid = new Float32Array(pos.count);
    const BIGD = 1e6;
    for (let i = 0; i < pos.count; i++) edgeDistGrid[i] = floodAttr[i] > 0.5 ? BIGD : 0;
    for (let iz = 0; iz < vertsZ; iz++) {
      for (let ix = 0; ix < vertsX; ix++) {
        const i = iz * vertsX + ix;
        let e = edgeDistGrid[i];
        if (ix > 0) e = Math.min(e, edgeDistGrid[i - 1] + 1);
        if (iz > 0) {
          e = Math.min(e, edgeDistGrid[i - vertsX] + 1);
          if (ix > 0) e = Math.min(e, edgeDistGrid[i - vertsX - 1] + 1.4142);
          if (ix < vertsX - 1) e = Math.min(e, edgeDistGrid[i - vertsX + 1] + 1.4142);
        }
        edgeDistGrid[i] = e;
      }
    }
    for (let iz = vertsZ - 1; iz >= 0; iz--) {
      for (let ix = vertsX - 1; ix >= 0; ix--) {
        const i = iz * vertsX + ix;
        let e = edgeDistGrid[i];
        if (ix < vertsX - 1) e = Math.min(e, edgeDistGrid[i + 1] + 1);
        if (iz < vertsZ - 1) {
          e = Math.min(e, edgeDistGrid[i + vertsX] + 1);
          if (ix < vertsX - 1) e = Math.min(e, edgeDistGrid[i + vertsX + 1] + 1.4142);
          if (ix > 0) e = Math.min(e, edgeDistGrid[i + vertsX - 1] + 1.4142);
        }
        edgeDistGrid[i] = e;
      }
    }
    for (let i = 0; i < pos.count; i++) {
      if (edgeDistGrid[i] >= BIGD) edgeDistGrid[i] = 8; // deep interior cap (cells)
      edgeDistGrid[i] = Math.min(edgeDistGrid[i], 8) * cellM;
    }

    // Rebuild the mesh using Marching Squares to completely eliminate the grid/raster appearance.
    // This extracts a smooth, continuous triangulated surface from the binary mask while
    // maintaining internal subdivision for DTM contouring.
    const msVertices = [];
    const msIndices = [];
    const vMap = new Map();
    const distVertsX = segsX + 1;
    const distVertsZ = segsZ + 1;

    const getPointData = (ix, iz) => {
        const i = iz * distVertsX + ix;
        const d = distAttr[i] || 0;
        return {
          x: pos.getX(i),
          z: pos.getZ(i),
          f: floodAttr[i] || 0,
          isFlood: isFloodGrid[i] || 0,
          d,
          dl: d,
          e: edgeDistGrid[i] || 0
        };
    };
    
    // Smooth linear interpolation along cell edges based on continuous mask values
    const interp = (p1, p2) => {
        const denom = p2.f - p1.f;
        const t = Math.abs(denom) > 1e-4 ? THREE.MathUtils.clamp((0.5 - p1.f) / denom, 0.05, 0.95) : 0.5;
        return {
            x: p1.x + (p2.x - p1.x) * t,
            z: p1.z + (p2.z - p1.z) * t,
            e: 0,
            isFlood: p1.isFlood + (p2.isFlood - p1.isFlood) * t,
            d: p1.d + (p2.d - p1.d) * t,
            // Shoreline points are reached when the flooded side of the edge is.
            dl: p1.f >= 0.5 ? p1.d : p2.d,
        };
    };
    
    const getVertexIdx = (pt) => {
        const key = Math.round(pt.x * 100) + ',' + Math.round(pt.z * 100);
        if (vMap.has(key)) return vMap.get(key);
        const idx = msVertices.length;
        msVertices.push(pt);
        vMap.set(key, idx);
        return idx;
    };

    const addTri = (pA, pB, pC) => {
        // Swap pB and pC to generate CCW front faces instead of CW back faces
        msIndices.push(getVertexIdx(pA), getVertexIdx(pC), getVertexIdx(pB));
    };

    for (let iz = 0; iz < segsZ; iz++) {
        for (let ix = 0; ix < segsX; ix++) {
            const tl = getPointData(ix, iz);
            const tr = getPointData(ix + 1, iz);
            const bl = getPointData(ix, iz + 1);
            const br = getPointData(ix + 1, iz + 1);
            const caseId = ((tl.f >= 0.5)?8:0) | ((tr.f >= 0.5)?4:0) | ((br.f >= 0.5)?2:0) | ((bl.f >= 0.5)?1:0);
            if (caseId === 0) continue;
            
            const top = interp(tl, tr);
            const right = interp(tr, br);
            const bottom = interp(bl, br);
            const left = interp(tl, bl);
            
            switch(caseId) {
                case 1: addTri(left, bl, bottom); break;
                case 2: addTri(bottom, br, right); break;
                case 3: addTri(left, bl, right); addTri(bl, br, right); break;
                case 4: addTri(top, right, tr); break;
                case 5: addTri(left, bl, bottom); addTri(top, right, tr); break;
                case 6: addTri(top, bottom, br); addTri(top, br, tr); break;
                case 7: addTri(left, bl, top); addTri(bl, br, top); addTri(br, right, top); break;
                case 8: addTri(tl, top, left); break;
                case 9: addTri(tl, top, bottom); addTri(tl, bottom, bl); break;
                case 10: addTri(tl, top, left); addTri(bottom, br, right); break;
                case 11: addTri(tl, top, right); addTri(tl, right, br); addTri(tl, br, bl); break;
                case 12: addTri(tl, tr, right); addTri(tl, right, left); break;
                case 13: addTri(tr, right, bottom); addTri(tr, bottom, bl); addTri(tr, bl, tl); break;
                case 14: addTri(tl, tr, br); addTri(tl, br, bottom); addTri(tl, bottom, left); break;
                case 15: addTri(tl, tr, br); addTri(tl, br, bl); break;
            }
        }
    }

    geo.dispose();
    geo = new THREE.BufferGeometry();
    const msCount = msVertices.length;
    const finalPos = new Float32Array(msCount * 3);
    const finalDepth = new Float32Array(msCount);
    const finalAlong = new Float32Array(msCount);
    const finalAcross = new Float32Array(msCount).fill(0.5);
    const finalFlow = new Float32Array(msCount * 2).fill(1);
    const finalNarrow = new Float32Array(msCount).fill(0);
    const finalEdgeDist = new Float32Array(msCount);
    const finalRiverDist = new Float32Array(msCount);
    const finalIsFlood = new Float32Array(msCount);
    // One reveal field for the water sheet and its red perimeter. Shoreline points take
    // the flooded side's distance (not a blend with dry cells); spill-unreachable cells
    // are still API extent, so they fill in at 100%.
    const frontMax = Math.max(120, maxDist);
    
    const finalGroundY = new Float32Array(msCount);
    for(let i = 0; i < msCount; i++) {
        const pt = msVertices[i];
        const gy = terrainHeightAt(pt.x, pt.z, stations);
        finalGroundY[i] = gy;
        let y;
        let depth;
        if (hasWaterLevel) {
          // Start at normal river sheet; setProgress lifts with progress × rise_m.
          const waterSurface = SURFACE_Y;
          y = Math.max(waterSurface, gy + 0.03);
          depth = Math.max(0.0, (SURFACE_Y + Math.max(0, waterRiseM || 0)) - gy);
        } else {
          // Precise elevation alignment:
          // Over river bed (gy <= SURFACE_Y), meet river surface (SURFACE_Y) cleanly (+0.015m).
          // Over floodplain terrain (gy > SURFACE_Y), drape 0.03m above DTM to prevent z-fighting without floating.
          y = gy <= SURFACE_Y ? (SURFACE_Y + 0.015) : (gy + 0.03);
          depth = Math.min(1, pt.e / (cellM * 8)) * EXTENT_SHADE_DEPTH_M;
        }
        // Flow direction from nearest corridor station so flood water visibly streams with the river.
        let fx = 1;
        let fz = 0;
        let bestD = Infinity;
        for (let si = 0; si < stations.length; si += Math.max(1, Math.floor(stations.length / 80))) {
          const st = stations[si];
          const ddx = pt.x - st.x;
          const ddz = pt.z - st.z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 < bestD) {
            bestD = d2;
            fx = st.flowX || 1;
            fz = st.flowZ || 0;
          }
        }
        const fl = Math.hypot(fx, fz) || 1;
        finalPos[i * 3] = pt.x;
        finalPos[i * 3 + 1] = y;
        finalPos[i * 3 + 2] = pt.z;
        finalDepth[i] = depth;
        finalAlong[i] = (pt.x * 0.015 + pt.z * 0.008);
        finalAcross[i] = 0.5 + Math.sin(pt.z * 0.02) * 0.25;
        finalFlow[i * 2] = fx / fl;
        finalFlow[i * 2 + 1] = fz / fl;
        finalEdgeDist[i] = pt.e;
        finalRiverDist[i] = Number.isFinite(pt.dl) && pt.dl < 1e5 ? Math.min(pt.dl, frontMax) : frontMax;
        finalIsFlood[i] = pt.isFlood ?? 0.0;
    }
    
    geo.setIndex(msIndices);
    geo.setAttribute('position', new THREE.BufferAttribute(finalPos, 3));
    geo.setAttribute('aDepth', new THREE.BufferAttribute(finalDepth, 1));
    geo.setAttribute('aAlong', new THREE.BufferAttribute(finalAlong, 1));
    geo.setAttribute('aAcross', new THREE.BufferAttribute(finalAcross, 1));
    geo.setAttribute('aFlow', new THREE.BufferAttribute(finalFlow, 2));
    geo.setAttribute('aNarrow', new THREE.BufferAttribute(finalNarrow, 1));
    geo.setAttribute('aEdgeDist', new THREE.BufferAttribute(finalEdgeDist, 1));
    geo.setAttribute('aRiverDist', new THREE.BufferAttribute(finalRiverDist, 1));
    geo.setAttribute('aIsFlood', new THREE.BufferAttribute(finalIsFlood, 1));

    // Generate smooth normals to remove faceted/stepped appearance
    geo.computeVertexNormals();

    material = createWaterMaterial({ ...dataset, isFlood: true });
    material.side = THREE.DoubleSide;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1.5;
    material.polygonOffsetUnits = -1.5;
    if (material.uniforms) {
      material.uniforms.uOpacity.value = 0.86; // Filled flood water body
      material.uniforms.uAnimEnabled.value = 1.0;
      material.uniforms.uOverallSpeed.value = 1.05; // Visible flowing motion
      material.uniforms.uFlowSpeed.value = 0.95;
      material.uniforms.uFlowStrength.value = 1.1;
      material.uniforms.uPrimaryWaveAmplitude.value = 0.14;
      material.uniforms.uSecondaryWaveAmplitude.value = 0.09;
      material.uniforms.uRippleAmplitude.value = 0.045;
      material.uniforms.uWaveHighlight.value = 0.95;
      material.uniforms.uReflectionStrength.value = 0.72;
      material.uniforms.uIsFlood.value = 1.0;

      if (material.uniforms.uFrontColor) {
        material.uniforms.uFrontColor.value.set("#C62828");
      }
      if (material.uniforms.uFrontLine) material.uniforms.uFrontLine.value = 0;

      // Use actual depth range for continuous color scale, clamp to avoid division by zero
      material.uniforms.uMaxDepth.value = hasWaterLevel
        ? Math.max(0.5, maxActualDepthM || waterRiseM || EXTENT_SHADE_DEPTH_M)
        : EXTENT_SHADE_DEPTH_M;
    }

    mesh = new THREE.Mesh(geo, material);
    mesh.name = "apiFloodMesh";
    mesh.userData.cellAreaHa = (spanX / segsX) * (spanZ / segsZ) / 10000;
    mesh.userData.groundY = finalGroundY;
    mesh.renderOrder = 18;
    mesh.frustumCulled = false;
    group.add(mesh);
    group.userData.hasFlood = true;
    group.hasFlood = true;

    // No red perimeter line — flood water blends with rising blue river (no hard rim).
    if (boundary) {
      group.remove(boundary);
      boundary.geometry?.dispose?.();
      boundary.material?.dispose?.();
      boundary = null;
    }
    revealSorted = Float32Array.from(finalRiverDist).sort();
    queueMicrotask(() => document.dispatchEvent(new CustomEvent("flood-geometry-ready")));
    
    const DEBUG_FLOOD_GEOMETRY = false;
    
    // Debug outline for the API geometry polygons
    if (DEBUG_FLOOD_GEOMETRY && overlay.polygons && overlay.polygons.length) {
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.8 });
      overlay.polygons.forEach(poly => {
        if (!poly || !poly.length) return;
        const pts = [];
        poly.forEach(pt => {
          const loc = lonLatToLocal(pt.lon, pt.lat);
          const gy = terrainHeightAt(loc.x, loc.z, stations);
          pts.push(new THREE.Vector3(loc.x, gy + 1.0, loc.z));
        });
        const loc0 = lonLatToLocal(poly[0].lon, poly[0].lat);
        const gy0 = terrainHeightAt(loc0.x, loc0.z, stations);
        pts.push(new THREE.Vector3(loc0.x, gy0 + 1.0, loc0.z));
        
        const lg = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(lg, lineMat);
        line.renderOrder = 999;
        group.add(line);
      });
    }

    const centroidX = floodOnlyCount > 0 ? (sumFloodOnlyX / floodOnlyCount) : (floodCount > 0 ? (sumFloodX / floodCount) : (bMinX + bMaxX) * 0.5);
    const centroidZ = floodOnlyCount > 0 ? (sumFloodOnlyZ / floodOnlyCount) : (floodCount > 0 ? (sumFloodZ / floodCount) : (bMinZ + bMaxZ) * 0.5);
    const useFloodBounds = floodOnlyCount > 0;
    bounds = {
      minX: useFloodBounds ? bMinFloodX : bMinX,
      maxX: useFloodBounds ? bMaxFloodX : bMaxX,
      minZ: useFloodBounds ? bMinFloodZ : bMinZ,
      maxZ: useFloodBounds ? bMaxFloodZ : bMaxZ,
      cx: centroidX,
      cz: centroidZ,
      spanX: Math.max(60, (useFloodBounds ? bMaxFloodX - bMinFloodX : bMaxX - bMinX)),
      spanZ: Math.max(60, (useFloodBounds ? bMaxFloodZ - bMinFloodZ : bMaxZ - bMinZ)),
    };

    const initialWaterMslRounded = initialWaterMsl != null ? Math.round(initialWaterMsl * 100) / 100 : null;
    const finalWaterMslRounded = finalWaterMsl != null ? Math.round(finalWaterMsl * 100) / 100 : null;


    lastInfo = {
      ...(resultInfo || {}),
      scene_date: scene.date || scene.post_date || resultInfo?.scene_date || null,
      flood_area_ha: scene.flood_area_ha ?? resultInfo?.flood_area_ha ?? null,
      water_area_ha: scene.water_area_ha ?? resultInfo?.water_area_ha ?? null,
      mapped_flood_area_ha: raster?.mappedFloodHa ?? null,
      pre_date: scene.pre_date ?? null,
      post_date: scene.post_date ?? null,
      kml_id: scene.kml_id,
      current_scene: sceneIndex + 1,
      total_scenes: scenes.length || 1,
      depth_note: depthNote,
      water_rise_m: waterRiseM,
      water_rise_mm: waterRiseM != null ? waterRiseM * 1000 : null,
      initial_water_level: hasWaterLevel ? initialWaterMslRounded : null,
      current_water_level: hasWaterLevel ? initialWaterMslRounded : null,
      final_water_level: hasWaterLevel ? finalWaterMslRounded : null,
      max_depth_m: hasWaterLevel ? Math.max(0, Math.min(8, maxActualDepthM || waterRiseM || 0)) : null,
      avg_depth_m: null,
      level_source: hasWaterLevel ? levelSource : null,
      // Stable target — never overwritten by live progress (water_rise_mm is live).
      _target_water_rise_m: waterRiseM,
      // Pass the Scene Y coordinates explicitly for the simulation loop
      _scene_initial_water_y: hasWaterLevel ? SURFACE_Y : sceneInitialWaterLevelY,
      _scene_final_water_y: hasWaterLevel ? SURFACE_Y + Math.max(0, waterRiseM || 0) : null,
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
    anim.duration = THREE.MathUtils.clamp(3.0 + (anim.maxDist * 0.005), 3.0, 15.0);

    console.info(`[apiFloodLayer] Scene ${sceneIndex + 1}/${scenes.length} successfully mapped to 3D.`, {
      geoBoundsLatLon: { north: overlay.north, south: overlay.south, east: overlay.east, west: overlay.west },
      localBoundsMeters: { minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ },
      dtmBoundsMeters: { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 },
      floodAreaHa: scene.flood_area_ha,
      kmlType: overlay.polygons && overlay.polygons.length ? 'Polygon/MultiPolygon' : 'GroundOverlay raster',
      polygons: overlay.polygons ? overlay.polygons.length : 0,
      overlapsDtm: (bMinX < 10000 && bMaxX > -10000 && bMinZ < 10000 && bMaxZ > -10000),
      fixedDepthDiscard: true
    });
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
        mapped_flood_area_ha: scene.raster?.mappedFloodHa ?? null,
        current_scene: i + 1,
        total_scenes: scenes.length,
      };
      group.userData.info = lastInfo;
      group.userData.sceneIndex = i;
      group.userData.onSceneChange?.(i, scene);
      if (animate) replay();
      return;
    }
    buildMeshFromScene(scene, lastInfo);
    group.userData.onSceneChange?.(i, scene);
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
    anim.t = unEaseProgress(anim.progress) * anim.duration;
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
      const k = Math.min(1, anim.t / anim.duration + dt / anim.duration);
      const eased = easeProgress(k);
      setProgress(eased);
      
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("flood-sim-progress", { 
          detail: { progress: eased, info: lastInfo } 
        }));
      }

      if (k >= 1) {
        anim.active = false;
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("flood-sim-complete"));
        }
      }
    }

    if (material) {
      syncWaterMaterial(material);
      // Surface ripples run on scene time so they keep moving while progression is paused.
      material.uniforms.uTime.value = (state.elapsed != null && Number.isFinite(state.elapsed)) ? state.elapsed : performance.now() * 0.001;
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
  /** Real flooded grid cells + perimeter segments (scene metres) for the compare thumbnails. */
  group.userData.getThumbnailData = () => {
    if (!mesh || !floodAttr || !distAttr || !gridX) return null;
    const finalY = lastInfo?._scene_final_water_y;
    const hasLevel = Number.isFinite(finalY);
    const xs = [];
    const zs = [];
    const ds = [];
    for (let i = 0; i < floodAttr.length; i++) {
      if (floodAttr[i] <= 0.5) continue;
      if (hasLevel && !(finalY > terrainYAttr[i])) continue;
      xs.push(gridX[i]);
      zs.push(gridZ[i]);
      ds.push(Math.min(distAttr[i], anim.maxDist));
    }
    return {
      xs,
      zs,
      ds,
      frontAt: floodFrontDistance,
      segs: boundary?.userData?.segmentsXZ || null,
    };
  };

  Object.defineProperty(group.userData, "hasFlood", {
    get() { return !!mesh && group.children.includes(mesh); },
    set(v) {},
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(group, "hasFlood", {
    get() { return !!mesh && group.children.includes(mesh); },
    set(v) {},
    enumerable: true,
    configurable: true,
  });

  return group;
}

/** @deprecated Prefer createApiFloodLayer */
export const createFloodSimulationLayer = createApiFloodLayer;
