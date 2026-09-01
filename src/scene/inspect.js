import * as THREE from "three";
import { state } from "../state.js";
import { nearestChainage } from "./chainageMarkers.js";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { bedYAt, sampleDepthAt } from "../features/fishing/FishingZoneSystem.js";

export function attachInspect(canvas, camera, riverMeshes, terrainMesh, dataset, tooltip) {
  const targets = Array.isArray(riverMeshes) ? [...riverMeshes] : [riverMeshes];
  if (terrainMesh) targets.push(terrainMesh);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const SNAP2 = 4 * 4;
  const index = buildIndex(dataset.points, 60);
  let raf = 0;
  let lastE = null;

  function ndc(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function nearest(x, z) {
    const near = neighbors(index, x, z);
    let best = null;
    let d = Infinity;
    for (const p of near) {
      const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d2 < d) {
        d = d2;
        best = p;
      }
    }
    return { best, d };
  }

  function sampleDepth(hit) {
    const attr = hit.object.geometry.attributes.aDepth;
    if (attr && hit.face) {
      const { a, b, c } = hit.face;
      const uv = hit.uv;
      if (uv) {
        const wA = 1 - uv.x - uv.y;
        return attr.getX(a) * wA + attr.getX(b) * uv.x + attr.getX(c) * uv.y;
      }
      return (attr.getX(a) + attr.getX(b) + attr.getX(c)) / 3;
    }
    return null;
  }

  function inspect(e) {
    ndc(e);
    raycaster.setFromCamera(pointer, camera);

    // Selected chainage hover owns the tooltip — don't replace with water depth
    if (state.chainageTipActive) return;

    if (state.inspectMode) {
      const osmHit = pickOsmFeature(dataset, pointer, camera, canvas, e);
      if (osmHit) {
        tooltip.show(e.clientX, e.clientY, osmHit);
        return;
      }
    }

    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) {
      tooltip.hide();
      state.hover = null;
      return;
    }
    const { x, z } = hit.point;
    const isRiver = hit.object.name !== "terrain";
    if (!state.inspectMode && !isRiver) {
      tooltip.hide();
      state.hover = null;
      return;
    }
    const geo = dataset.frame.toLonLat(x, z);
    const utm = dataset.frame.toUtm(x, z);
    const ch = nearestChainage(x, z, dataset.chainage);
    const landY = hit.object.name === "terrain" ? hit.point.y : terrainHeightAt(x, z, dataset.corridor.stations);
    const flowDir = flowDirectionAt(x, z, dataset.corridor.stations);
    const flowSpeed = (state.flowSpeed ?? 0.85) * 1.4;
    let depth = isRiver ? sampleDepth(hit) : sampleDepthAt(x, z, dataset);
    let kind = "Estimated bathymetry";
    const { best, d } = nearest(x, z);
    if (best && d <= SNAP2) {
      depth = best.depth;
      kind = "Surveyed bathymetry";
    } else if (depth == null && best) {
      depth = best.depth;
      kind = "Nearest sample";
    }
    if (depth == null) depth = sampleDepthAt(x, z, dataset);

    const riverbedY = bedYAt(x, z, dataset);
    const waterSurface = SURFACE_Y;
    const t = (depth - dataset.minDepth) / Math.max(0.001, dataset.maxDepth - dataset.minDepth);
    const color = depthColorHex(t);
    const depthLabel = kind;

    let nearestFishing = "—";
    let bestFd = Infinity;
    for (const zf of dataset.fishingZones || []) {
      const d2 = (zf.x - x) ** 2 + (zf.z - z) ** 2;
      if (d2 < bestFd) {
        bestFd = d2;
        nearestFishing = zf.name || zf.id;
      }
    }
    if (bestFd > 120 * 120) nearestFishing = "—";

    let nearestBridge = "—";
    let bestBd = Infinity;
    for (const br of dataset.bridges || []) {
      const mx = br.midX ?? br.x;
      const mz = br.midZ ?? br.z;
      if (mx == null) continue;
      const d2 = (mx - x) ** 2 + (mz - z) ** 2;
      if (d2 < bestBd) {
        bestBd = d2;
        nearestBridge = br.name || br.road || "Unnamed bridge";
      }
    }
    if (bestBd > 200 * 200) nearestBridge = "—";

    state.hover = {
      lon: geo.lon,
      lat: geo.lat,
      x,
      z,
      depth,
      kind,
      chainage: ch?.label,
    };

    if (!state.inspectMode && isRiver) {
      tooltip.show(e.clientX, e.clientY, {
        compact: true,
        lon: geo.lon,
        lat: geo.lat,
        localX: x,
        localZ: z,
        depth,
        landElevation: landY,
        waterSurface,
        riverbedElevation: riverbedY,
        flowDirection: flowDir,
        flowSpeed,
        chainage: ch?.meters != null ? `${(ch.meters / 1000).toFixed(2)} km` : ch?.label,
        chainageM: ch?.meters,
      });
      return;
    }

    tooltip.show(e.clientX, e.clientY, {
      lon: geo.lon,
      lat: geo.lat,
      depth,
      kind,
      depthLabel,
      easting: utm.easting,
      northing: utm.northing,
      localX: x,
      localZ: z,
      flowSpeed,
      minDepth: dataset.minDepth,
      maxDepth: dataset.maxDepth,
      color,
      chainage: ch?.label ?? "—",
      chainageM: ch?.meters,
      chainageKm: ch?.meters != null ? ch.meters / 1000 : null,
      landElevation: landY,
      riverbedElevation: riverbedY,
      waterSurface,
      flowDirection: flowDir,
      isTerrain: !isRiver,
      nearestFishing,
      nearestBridge,
    });
  }

  function onMove(e) {
    lastE = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (lastE) inspect(lastE);
    });
  }

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("click", inspect);
  canvas.addEventListener("pointerleave", () => {
    tooltip.hide();
    state.hover = null;
  });
}

function flowDirectionAt(x, z, stations) {
  let best = stations[0];
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(stations.length / 200));
  for (let i = 0; i < stations.length; i += step) {
    const s = stations[i];
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = s;
    }
  }
  const fx = best.flowX ?? 0;
  const fz = best.flowZ ?? 1;
  const deg = ((Math.atan2(fx, fz) * 180) / Math.PI + 360) % 360;
  if (deg >= 337.5 || deg < 22.5) return "North";
  if (deg < 67.5) return "North-East";
  if (deg < 112.5) return "East";
  if (deg < 157.5) return "South-East";
  if (deg < 202.5) return "South";
  if (deg < 247.5) return "South-West";
  if (deg < 292.5) return "West";
  return "North-West";
}

function depthColorHex(t) {
  const c = Math.max(0, Math.min(1, t));
  // dark cyan → navy (matches bed depth palette)
  const r = Math.round(8 + (4 - 8) * c);
  const g = Math.round(48 + (14 - 48) * c);
  const b = Math.round(72 + (36 - 72) * c);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function buildIndex(points, cell) {
  const map = new Map();
  for (const p of points) {
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }
  return { cell, map };
}

function neighbors(index, x, z) {
  const { cell, map } = index;
  const kx = Math.floor(x / cell);
  const kz = Math.floor(z / cell);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const bin = map.get(`${kx + dx},${kz + dz}`);
      if (bin) out.push(...bin);
    }
  }
  return out;
}

/** Screen-space nearest OSM building centroid or tree (inspect metadata). */
function pickOsmFeature(dataset, pointer, camera, canvas, e) {
  const buildings = dataset.osm?.buildings || [];
  const trees = dataset.osm?.trees || [];
  if (!buildings.length && !trees.length) return null;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const v = new THREE.Vector3();
  let best = null;
  let bestD = 28; // px

  const consider = (wx, wy, wz, payload) => {
    v.set(wx, wy, wz).project(camera);
    const sx = (v.x * 0.5 + 0.5) * rect.width;
    const sy = (-v.y * 0.5 + 0.5) * rect.height;
    const d = Math.hypot(sx - mx, sy - my);
    if (d < bestD) {
      bestD = d;
      best = payload;
    }
  };

  for (const b of buildings) {
    consider(b.midX, 8, b.midZ, {
      featureType: "building",
      osmId: b.id,
      name: b.name,
      lon: b.vertices?.[0]?.lon,
      lat: b.vertices?.[0]?.lat,
      height: b.heightM,
      height_source: b.height_source,
      building: b.building,
    });
  }
  for (const t of trees) {
    consider(t.x, (t.tree_height || 8) * 0.5, t.z, {
      featureType: "tree",
      osmId: t.id,
      name: t.species || t.genus,
      lon: t.lon,
      lat: t.lat,
      height: t.tree_height,
      height_source: t.height_source,
      species: t.species,
      genus: t.genus,
    });
  }
  return best;
}
