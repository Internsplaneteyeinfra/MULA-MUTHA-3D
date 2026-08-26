import * as THREE from "three";
import { FISH_SPECIES, speciesPlanForZone } from "./FishSpeciesRegistry.js";
import { createFishGeometry, createFishMaterial, attachSwimAttributes } from "./FishMesh.js";
import {
  bedYAt,
  pointInRing,
  nearestStation,
  lateralDistToCenterline,
  waterSurfaceYAt,
} from "./FishingZoneSystem.js";
import { state } from "../../state.js";

/**
 * Spawn fish at existing fishing zones only — multi-depth layers + denser schools.
 */
export function spawnFishForZones(zones, dataset) {
  const group = new THREE.Group();
  group.name = "fishMeshes";
  const agents = [];
  const materials = [];
  const meshesBySpecies = new Map();
  const geoCache = new Map();
  const layerCounts = { surface: 0, mid: 0, bottom: 0 };

  for (let zi = 0; zi < zones.length; zi++) {
    const zone = zones[zi];
    const seed = hashStr(zone.id) + zi * 17;
    const plan = speciesPlanForZone(zone, seed);
    const dominant = [];

    for (let pi = 0; pi < plan.length; pi++) {
      const entry = plan[pi];
      const species = FISH_SPECIES[entry.speciesId];
      if (!species) continue;

      if (!meshesBySpecies.has(species.id)) {
        const geoKey = `${species.elongated ? "long" : "std"}_lod0`;
        if (!geoCache.has(geoKey)) geoCache.set(geoKey, createFishGeometry(!!species.elongated, 0));
        const mat = createFishMaterial(species);
        materials.push(mat);
        meshesBySpecies.set(species.id, {
          species,
          geo: geoCache.get(geoKey),
          mat,
          agents: [],
        });
      }

      const bucket = meshesBySpecies.get(species.id);
      // Unique seed per fish — avoid aligned / grid patterns
      const agentSeed = seed * 10007 + pi * 7919 + hashStr(species.id) * 13 + zi * 997;
      const agent = makeAgent(zone, species, entry.layer, agentSeed, dataset, pi);
      bucket.agents.push(agent);
      agents.push(agent);
      layerCounts[entry.layer] = (layerCounts[entry.layer] || 0) + 1;

      if (species.role === "large" || species.role === "medium") {
        if (!dominant.includes(species.label)) dominant.push(species.label);
      }
      if (species.role === "school" && !dominant.includes(species.label)) {
        dominant.push(species.label);
      }
    }
    zone.dominant = dominant.slice(0, 4);
  }

  for (const [, bucket] of meshesBySpecies) {
    const n = bucket.agents.length;
    if (!n) continue;
    const mesh = new THREE.InstancedMesh(bucket.geo, bucket.mat, n);
    mesh.frustumCulled = false;
    mesh.name = `fish_${bucket.species.id}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 6;
    attachSwimAttributes(mesh, bucket.agents);
    bucket.mesh = mesh;
    for (let i = 0; i < n; i++) {
      bucket.agents[i].instanceIndex = i;
      bucket.agents[i].mesh = mesh;
    }
    group.add(mesh);
  }

  const total = agents.length || 1;
  console.info("Fish spawned", {
    zones: zones.length,
    agents: agents.length,
    layers: {
      surface: layerCounts.surface,
      mid: layerCounts.mid,
      bottom: layerCounts.bottom,
      pct: {
        surface: Math.round((layerCounts.surface / total) * 100),
        mid: Math.round((layerCounts.mid / total) * 100),
        bottom: Math.round((layerCounts.bottom / total) * 100),
      },
    },
    species: [...meshesBySpecies.keys()],
  });

  return { group, agents, materials, meshesBySpecies };
}

/**
 * Independent randomized placement — no shared offsets, no grids / rings / columns.
 */
function makeAgent(zone, species, layer, seed, dataset, idx) {
  const rng = mulberry(seed | 0);

  // Scattered disk with strong jitter (breaks circular alignment)
  const ang = rng() * Math.PI * 2;
  const rad = Math.sqrt(rng()) * zone.radius * (0.55 + rng() * 0.4);
  let x = zone.x + Math.cos(ang) * rad + (rng() - 0.5) * zone.radius * 0.55;
  let z = zone.z + Math.sin(ang) * rad + (rng() - 0.5) * zone.radius * 0.55;
  // Extra independent offsets so neighbors never share the same delta
  x += (rng() - 0.5) * 14;
  z += (rng() - 0.5) * 14;

  const st = nearestStation(x, z, dataset.corridor.stations);
  const lat = lateralDistToCenterline(x, z, st);
  if (lat > st.halfWidth * 0.78) {
    const side = rng() > 0.5 ? 1 : -1;
    const across = (0.15 + rng() * 0.55) * st.halfWidth * side;
    x = st.x + -st.flowZ * across + (rng() - 0.5) * 6;
    z = st.z + st.flowX * across + (rng() - 0.5) * 6;
  }
  if (!pointInRing(x, z, dataset.ringLocal)) {
    x = zone.x + (rng() - 0.5) * zone.radius * 0.35;
    z = zone.z + (rng() - 0.5) * zone.radius * 0.35;
    if (!pointInRing(x, z, dataset.ringLocal)) {
      x = zone.x;
      z = zone.z;
    }
  }

  const bed = bedYAt(x, z, dataset);
  const surfaceY = waterSurfaceYAt(x, z, state.elapsed || 0);
  const waterCol = Math.max(0.55, surfaceY - bed);

  const depthLayer = layer || "mid";
  let depthM = 0.5;
  let bedOffset = 0.5;
  let depthMin = 0.2;
  let depthMax = 0.6;

  if (depthLayer === "surface") {
    depthMin = 0.15;
    depthMax = Math.min(0.6, waterCol * 0.45);
    depthM = depthMin + rng() * Math.max(0.05, depthMax - depthMin);
  } else if (depthLayer === "mid") {
    depthMin = Math.min(0.8, waterCol * 0.35);
    depthMax = Math.min(2.0, Math.max(depthMin + 0.2, waterCol - 0.45));
    depthM = depthMin + rng() * Math.max(0.1, depthMax - depthMin);
  } else {
    // Bottom: sit above riverbed
    bedOffset = 0.3 + rng() * 0.7;
    bedOffset = Math.min(bedOffset, Math.max(0.3, waterCol * 0.35));
    depthM = Math.max(0.4, surfaceY - (bed + bedOffset));
    depthMin = Math.max(0.4, depthM - 0.4);
    depthMax = Math.min(waterCol - 0.25, depthM + 0.5);
  }

  // Keep fish underwater and above bed
  const yRaw =
    depthLayer === "bottom"
      ? bed + bedOffset
      : surfaceY - depthM;
  const y = THREE.MathUtils.clamp(yRaw, bed + 0.28, surfaceY - 0.12);

  const flowYaw = Math.atan2(zone.flowX, zone.flowZ);
  const yaw = flowYaw + ((rng() - 0.5) * 140 * Math.PI) / 180;

  return {
    zoneId: zone.id,
    zone,
    species,
    x,
    y,
    z,
    vx: Math.sin(yaw) * species.speed * 0.3,
    vz: Math.cos(yaw) * species.speed * 0.3,
    yaw,
    pitch: 0,
    speed: species.speed * (0.65 + rng() * 0.7),
    turnRate: 0.6 + rng() * 1.4,
    wanderT: rng() * 40,
    wanderPhase: rng() * Math.PI * 2,
    swimPhase: rng() * Math.PI * 2,
    swimFreq: 0.65 + rng() * 1.25,
    depthLayer,
    depthM,
    depthMin,
    depthMax,
    bedOffset,
    targetDepthM: depthM,
    vertSpeed: 0.12 + rng() * 0.28,
    depthChangeT: 2 + rng() * 8,
    depthFrac: depthM / Math.max(0.5, waterCol),
    school: species.role === "school",
    jumpPhase: "swim",
    jumpT: 0,
    jumpHeight: 0.7 + rng() * 1.1,
    jumpDuration: 0.5 + rng() * 0.3,
    jumpCooldown: 8 + rng() * 22,
    // Unique home so fish don't stack toward one point
    homeX: zone.x + (rng() - 0.5) * zone.radius * 0.7,
    homeZ: zone.z + (rng() - 0.5) * zone.radius * 0.7,
    instanceIndex: idx,
    mesh: null,
    visible: true,
  };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function mulberry(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
