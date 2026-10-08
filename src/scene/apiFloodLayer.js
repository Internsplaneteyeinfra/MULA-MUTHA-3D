import * as THREE from "three";
import { lonLatToLocal, localToLonLat } from "../geo/geoReference.js";
import { terrainHeightAt } from "./terrain.js";
import { SURFACE_Y } from "./river.js";
import { createWaterMaterial, syncWaterMaterial } from "./waterShader.js";
import { verticalDatumPipeline } from "../services/hydrology/verticalDatumPipeline.js";

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
  let terrainYAttr = null;
  let spillElevationsAttr = null;
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
    terrainYAttr = null;
    spillElevationsAttr = null;
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
    if (!mesh || !floodAttr || !terrainYAttr || !spillElevationsAttr || !lastInfo) return;

    const pos = mesh.geometry.attributes.position;
    const initialWaterLevelY = lastInfo._scene_initial_water_y;
    const globalFinalWaterLevelY = lastInfo._scene_final_water_y;

    const aDepthAttr = mesh.geometry.attributes.aDepth;
    
    // Accumulate actual wet flooded area at current progress frame
    let currentFloodedAreaHa = 0;
    let maxCurrentWaterLevelY = initialWaterLevelY;
    
    // Grid dimensions from geometry
    const vertsX = mesh.geometry.parameters.widthSegments + 1;
    const vertsZ = mesh.geometry.parameters.heightSegments + 1;
    const spanX = mesh.geometry.parameters.width;
    const spanZ = mesh.geometry.parameters.height;
    // Calculate approximate area per grid vertex (meters^2) to hectares
    const cellAreaHa = (spanX / (vertsX - 1)) * (spanZ / (vertsZ - 1)) / 10000;

    const hasGlobalWaterLevel = globalFinalWaterLevelY != null && !Number.isNaN(globalFinalWaterLevelY);

    for (let i = 0; i < pos.count; i++) {
      const gy = terrainYAttr[i];
      const isInsideFinalKML = floodAttr[i] > 0.5;
      
      let currentWaterLevelY = initialWaterLevelY;
      let floodedNow = false;

      if (hasGlobalWaterLevel) {
        // Physical flat water surface logic
        const cellFinalWaterLevelY = globalFinalWaterLevelY;
        if (cellFinalWaterLevelY !== Infinity) {
            currentWaterLevelY += (cellFinalWaterLevelY - initialWaterLevelY) * p;
            if (currentWaterLevelY > maxCurrentWaterLevelY) {
                maxCurrentWaterLevelY = currentWaterLevelY;
            }
        }
        
        if (isInsideFinalKML) {
          if (currentWaterLevelY >= spillElevationsAttr[i] && currentWaterLevelY > gy) {
            const currentFloodFrontDistance = anim.maxDist * p;
            if (distAttr[i] <= currentFloodFrontDistance) {
              floodedNow = true;
            }
          }
        }
      } else {
        // API provided only 2D extent; drape on terrain and animate by distance
        if (isInsideFinalKML) {
          const currentFloodFrontDistance = anim.maxDist * p;
          if (distAttr[i] <= currentFloodFrontDistance) {
            floodedNow = true;
            currentWaterLevelY = gy + 0.05; // Just above terrain
          }
        }
      }

      if (!floodedNow) {
        // Outside flood or above current water level: place exactly at terrain
        pos.setY(i, gy);
        aDepthAttr.setX(i, -1.0);
      } else {
        // Valid wet flood cell
        pos.setY(i, currentWaterLevelY);
        aDepthAttr.setX(i, hasGlobalWaterLevel ? (currentWaterLevelY - gy) : 0.1);
        currentFloodedAreaHa += cellAreaHa;
      }
    }
    
    // Publish current progress metrics back to the scene state for the UI
    lastInfo._current_flooded_area_ha = currentFloodedAreaHa;
    if (globalFinalWaterLevelY != null) {
      lastInfo.current_water_level = verticalDatumPipeline.sceneYToWseMsl(maxCurrentWaterLevelY);
      lastInfo.water_rise_mm = (maxCurrentWaterLevelY - initialWaterLevelY) * 1000;
    } else {
      lastInfo.current_water_level = null;
      lastInfo.water_rise_mm = null;
    }
    
    pos.needsUpdate = true;
    aDepthAttr.needsUpdate = true;
    if (mesh && mesh.geometry) {
      mesh.geometry.computeVertexNormals();
    }
    
    if (material && material.uniforms) {
      material.uniforms.uOpacity.value = THREE.MathUtils.lerp(0.35, 0.82, Math.min(1, p * 1.15));
      material.uniforms.uReveal.value = 10000.0; // Disable arbitrary shader clipping so the distance mask works
    }
    mesh.geometry.computeBoundingSphere();
    
    // Explicit Validation Request
    const debugState = {
      initialWaterSurfaceElevation: lastInfo.initial_water_level,
      finalWaterSurfaceElevation: lastInfo.final_water_level,
      currentWaterSurfaceElevation: lastInfo.current_water_level,
      currentWaterSurfaceSceneY: maxCurrentWaterLevelY,
      waterRise: lastInfo.water_rise_m,
      wetCellCount: currentFloodedAreaHa
    };
    
    // Validate all fields except wetCellCount are finite
    for (const [key, val] of Object.entries(debugState)) {
      if (key !== 'wetCellCount') {
        if (val === undefined || Number.isNaN(val) || val === Infinity || val === -Infinity) {
          if (globalFinalWaterLevelY != null) {
            console.error(`[Flood Validation Error] ${key} is invalid:`, val, debugState);
            mesh.visible = false;
            return;
          }
        }
      }
    }
    
    if (p === 1.0 || p === 0.0 || p === 0.5) {
      console.log("[Flood Diagnostic] Valid State:", debugState);
    }
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
    if (!overlay) {
      throw new Error("Missing flood overlay for visualization.");
    }

    const { mask, width, height, fromPolygons } = raster || {};
    
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
    const segsX = THREE.MathUtils.clamp(Math.round(spanX / 12), 90, 240);
    const segsZ = THREE.MathUtils.clamp(Math.round(spanZ / 12), 60, 180);

    const geo = new THREE.PlaneGeometry(spanX, spanZ, segsX, segsZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate(cx, 0, cz);

    const pos = geo.attributes.position;
    floodAttr = new Float32Array(pos.count);
    distAttr = new Float32Array(pos.count);
    baseY = new Float32Array(pos.count);
    terrainYAttr = new Float32Array(pos.count);
    spillElevationsAttr = new Float32Array(pos.count).fill(Infinity);
    const colors = new Float32Array(pos.count * 3);
    const debugColors = new Float32Array(pos.count * 3);

    const lonSpan = overlay.east - overlay.west;
    const latSpan = overlay.north - overlay.south;
    
    /** Sample flood mask with 3×3 max so thin ribbons aren't missed by the grid. */
    function maskAtLonLat(lon, lat) {
      if (fromPolygons && overlay.polygons) {
        let inside = false;
        for (const poly of overlay.polygons) {
          if (!poly || !poly.length) continue;
          let j = poly.length - 1;
          for (let i = 0; i < poly.length; i++) {
            if ((poly[i].lat > lat) !== (poly[j].lat > lat) &&
                (lon < (poly[j].lon - poly[i].lon) * (lat - poly[i].lat) / (poly[j].lat - poly[i].lat) + poly[i].lon)) {
              inside = !inside;
            }
            j = i;
          }
          if (inside) return 1;
        }
        return 0;
      }
      
      if (!(lonSpan > 0) || !(latSpan > 0) || !mask) return 0;
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
    let maxTerrainY = -Infinity;

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
      terrainYAttr[i] = gy;
      
      if (flooded) {
        if (gy > maxTerrainY) maxTerrainY = gy;
        floodCount += 1;
        bMinX = Math.min(bMinX, x);
        bMaxX = Math.max(bMaxX, x);
        bMinZ = Math.min(bMinZ, z);
        bMaxZ = Math.max(bMaxZ, z);
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

    let providedRise = scene.water_rise;
    let providedWaterLevel = scene.final_water_level;
    
    // Calculate authoritative MSL water levels and the derived scene Y coordinates
    let initialWaterMsl = verticalDatumPipeline.sceneYToWseMsl(SURFACE_Y);
    let finalWaterMsl = providedWaterLevel;
    let waterRiseM = providedRise;

    if (providedRise != null) {
      waterRiseM = providedRise;
      finalWaterMsl = initialWaterMsl + waterRiseM;
    } else if (providedWaterLevel != null) {
      waterRiseM = providedWaterLevel - initialWaterMsl;
      finalWaterMsl = providedWaterLevel;
    } else {
      // The API payload (JalNetra) did not provide a hydraulic surface elevation.
      // We will render the 2D spatial flood extent draped directly onto the DTM.
      finalWaterMsl = null;
      waterRiseM = null;
    }

    // Convert canonical MSL back to Scene Y for 3D geometry manipulation
    const sceneFinalWaterLevelY = finalWaterMsl != null ? verticalDatumPipeline.wseMslToSceneY(finalWaterMsl) : NaN;
    const sceneInitialWaterLevelY = SURFACE_Y;
    
    if (scene.water_rise === undefined && scene.final_water_level === undefined) {
      depthNote = "Depth unavailable: No water elevation provided by API. Extent draped over DTM.";
    }

    let maxActualDepthM = 0;

    for (let i = 0; i < pos.count; i++) {
      if (floodAttr[i]) {
        const gy = terrainYAttr[i];
        
        // Calculate max depth only on valid flooded cells (spillElevations <= final scene water level)
        if (sceneFinalWaterLevelY >= spillElevationsAttr[i] && sceneFinalWaterLevelY > gy) {
          const depthM = finalWaterMsl - verticalDatumPipeline.sceneYToWseMsl(gy);
          if (depthM > maxActualDepthM) maxActualDepthM = depthM;
        }
        
        const y = Math.max(sceneFinalWaterLevelY, gy + 0.05);
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
    
    // Rebuild index to exclude triangles that are completely dry, satisfying "no giant bounding box geometry"
    const oldIndex = geo.getIndex();
    const newIndices = [];
    for (let i = 0; i < oldIndex.count; i += 3) {
      const a = oldIndex.getX(i);
      const b = oldIndex.getX(i + 1);
      const c = oldIndex.getX(i + 2);
      if (floodAttr[a] > 0 || floodAttr[b] > 0 || floodAttr[c] > 0) {
        newIndices.push(a, b, c);
      }
    }
    geo.setIndex(newIndices);

    const count = pos.count;
    geo.setAttribute('aDepth', new THREE.BufferAttribute(new Float32Array(count).fill(0.5), 1));
    geo.setAttribute('aAlong', new THREE.BufferAttribute(new Float32Array(count).fill(0), 1));
    geo.setAttribute('aAcross', new THREE.BufferAttribute(new Float32Array(count).fill(0.5), 1));
    geo.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(count * 2).fill(1), 2));
    geo.setAttribute('aNarrow', new THREE.BufferAttribute(new Float32Array(count).fill(0), 1));

    // Calculate actual depth for the aDepth attribute so the water shader can color it properly
    const aDepth = geo.getAttribute('aDepth');
    for (let i = 0; i < count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const gy = terrainHeightAt(x, z, stations);
        let depth = Math.max(0, baseY[i] - gy);
        if (depth === 0) depth = -1.0;
        aDepth.setX(i, depth);
        // Populate aAlong from world coordinates to give fake progression for waves
        // Do NOT populate aAcross with world coordinates because the shader uses it for bank fading!
        geo.getAttribute('aAlong').setX(i, x / 100);
    }

    material = createWaterMaterial(dataset);
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    if (material.uniforms) {
      material.uniforms.uOpacity.value = 0.78;
      // Use actual depth range for continuous color scale, clamp to avoid division by zero
      material.uniforms.uMaxDepth.value = Math.max(0.5, maxActualDepthM);
    }

    mesh = new THREE.Mesh(geo, material);
    mesh.name = "apiFloodMesh";
    mesh.renderOrder = 12;
    mesh.frustumCulled = false;
    group.add(mesh);
    
    // Debug outline for the API geometry polygons as requested by user
    if (overlay.polygons && overlay.polygons.length) {
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

    const initialWaterMslRounded = initialWaterMsl != null ? Math.round(initialWaterMsl * 100) / 100 : null;
    const finalWaterMslRounded = finalWaterMsl != null ? Math.round(finalWaterMsl * 100) / 100 : null;


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
      water_rise_m: waterRiseM,
      water_rise_mm: waterRiseM != null ? waterRiseM * 1000 : null,
      initial_water_level: initialWaterMslRounded,
      current_water_level: initialWaterMslRounded,
      final_water_level: finalWaterMslRounded,
      max_depth_m: finalWaterMsl != null ? Math.max(0, maxActualDepthM) : null,
      avg_depth_m: null,
      // Pass the Scene Y coordinates explicitly for the simulation loop
      _scene_initial_water_y: sceneInitialWaterLevelY,
      _scene_final_water_y: sceneFinalWaterLevelY,
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
    if (material) {
      syncWaterMaterial(material);
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
