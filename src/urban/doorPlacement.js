import * as THREE from "three";
import { terrainHeightAt } from "../scene/terrain.js";
import { sampleFootprintElevation } from "./footprintPlacement.js";

const DOOR_PANEL = ["#6b4a32", "#3a3530", "#7a5040", "#4a5868", "#8b6048", "#5c4030"];
const DOOR_FRAME = "#c8c0b4";

/**
 * Large visible entrance assemblies — panel + frame + recess + step.
 * Must be readable in Local 3D / building close-up views.
 */
export function createDoorInstances(placements, dataset, { maxDoors = 1800, corridorM = 900 } = {}) {
  const group = new THREE.Group();
  group.name = "buildingDoors";

  const roads = dataset.osm?.roads || [];
  const stations = dataset.corridor?.stations || [];
  if (!placements.length || !roads.length) return group;

  const candidates = placements
    .filter((p) => p.dist <= corridorM)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxDoors);

  if (!candidates.length) return group;

  const panelGeo = new THREE.BoxGeometry(1.35, 2.35, 0.1);
  const frameGeo = new THREE.BoxGeometry(1.55, 2.55, 0.06);
  const recessGeo = new THREE.BoxGeometry(1.65, 2.65, 0.22);
  const stepGeo = new THREE.BoxGeometry(1.9, 0.16, 0.65);

  const panelMat = new THREE.MeshStandardMaterial({ color: "#6b4a32", roughness: 0.78, vertexColors: true });
  const frameMat = new THREE.MeshStandardMaterial({ color: DOOR_FRAME, roughness: 0.86 });
  const recessMat = new THREE.MeshStandardMaterial({ color: "#2a2824", roughness: 0.95 });
  const stepMat = new THREE.MeshStandardMaterial({ color: "#8a8078", roughness: 0.9 });

  const panels = new THREE.InstancedMesh(panelGeo, panelMat, candidates.length);
  const frames = new THREE.InstancedMesh(frameGeo, frameMat, candidates.length);
  const recesses = new THREE.InstancedMesh(recessGeo, recessMat, candidates.length);
  const steps = new THREE.InstancedMesh(stepGeo, stepMat, candidates.length);

  panels.name = "doorInstances";
  panels.renderOrder = 22;
  frames.renderOrder = 21;
  recesses.renderOrder = 20;
  steps.renderOrder = 19;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  for (let i = 0; i < candidates.length; i++) {
    const { metrics, classification, building } = candidates[i];
    const seed = classification.paletteSeed ?? building.id ?? i;
    const facing = pickRoadFacing(metrics, roads);
    const y = sampleFootprintElevation(metrics, stations);
    const groundY = terrainHeightAt(metrics.centroidX, metrics.centroidZ, stations);
    const baseY = Math.max(y, groundY);
    const halfW = metrics.widthM * 0.5;
    const halfL = metrics.lengthM * 0.5;
    const inset = 0.12;
    const px = metrics.centroidX + facing.nx * (facing.axis === "width" ? halfW + inset : halfL * 0.02);
    const pz = metrics.centroidZ + facing.nz * (facing.axis === "length" ? halfL + inset : halfW * 0.02);
    const yaw = facing.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);

    // Recess (set back into wall)
    dummy.position.set(px - fx * 0.08, baseY + 1.35, pz - fz * 0.08);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    recesses.setMatrixAt(i, dummy.matrix);

    // Door panel
    dummy.position.set(px + fx * 0.04, baseY + 1.22, pz + fz * 0.04);
    dummy.updateMatrix();
    panels.setMatrixAt(i, dummy.matrix);
    color.set(DOOR_PANEL[Math.abs(seed) % DOOR_PANEL.length]);
    panels.setColorAt(i, color);

    // Frame
    dummy.position.set(px + fx * 0.02, baseY + 1.32, pz + fz * 0.02);
    dummy.updateMatrix();
    frames.setMatrixAt(i, dummy.matrix);

    // Step
    dummy.position.set(px + fx * 0.38, baseY + 0.08, pz + fz * 0.38);
    dummy.updateMatrix();
    steps.setMatrixAt(i, dummy.matrix);
  }

  for (const m of [panels, frames, recesses, steps]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = true;
    m.castShadow = true;
    group.add(m);
  }

  console.info("Building doors (visible assemblies)", { count: candidates.length, corridorM });
  return group;
}

function pickRoadFacing(metrics, roads) {
  const cx = metrics.centroidX;
  const cz = metrics.centroidZ;
  const yaw = metrics.yaw;
  const facades = [
    { nx: Math.sin(yaw), nz: Math.cos(yaw), axis: "width", yaw },
    { nx: -Math.sin(yaw), nz: -Math.cos(yaw), axis: "width", yaw: yaw + Math.PI },
    { nx: Math.cos(yaw), nz: -Math.sin(yaw), axis: "length", yaw: yaw + Math.PI * 0.5 },
    { nx: -Math.cos(yaw), nz: Math.sin(yaw), axis: "length", yaw: yaw - Math.PI * 0.5 },
  ];
  let best = facades[0];
  let bestDist = Infinity;
  for (const f of facades) {
    const wx = cx + f.nx * (f.axis === "width" ? metrics.widthM * 0.5 : metrics.lengthM * 0.5);
    const wz = cz + f.nz * (f.axis === "width" ? metrics.widthM * 0.5 : metrics.lengthM * 0.5);
    const d = distToNearestRoad(wx, wz, roads);
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return best;
}

function distToNearestRoad(x, z, roads) {
  let best = Infinity;
  for (const road of roads) {
    const verts = road.vertices || [];
    for (let i = 1; i < verts.length; i++) {
      const d = distToSegment(x, z, verts[i - 1].x, verts[i - 1].z, verts[i].x, verts[i].z);
      if (d < best) best = d;
    }
  }
  return best;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
