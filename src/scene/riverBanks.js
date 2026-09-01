import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";

/**
 * Always-visible KML river reference — centerline + left/right banks.
 * Makes the river recognizable in overview without enabling debug mode.
 */
export function createRiverBankOverlay(dataset) {
  const group = new THREE.Group();
  group.name = "riverBankOverlay";
  const stations = dataset.corridor?.stations || [];

  const bankMat = new THREE.LineBasicMaterial({
    color: 0x3a9ec8,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const centerMat = new THREE.LineBasicMaterial({
    color: 0x5ad4ff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  // Left / right banks from corridor stations
  const leftPts = [];
  const rightPts = [];
  for (const s of stations) {
    const px = -s.flowZ;
    const pz = s.flowX;
    const yL = terrainHeightAt(s.x - px * s.halfWidth, s.z - pz * s.halfWidth, stations) + 0.5;
    const yR = terrainHeightAt(s.x + px * s.halfWidth, s.z + pz * s.halfWidth, stations) + 0.5;
    leftPts.push(new THREE.Vector3(s.x - px * s.halfWidth, yL, s.z - pz * s.halfWidth));
    rightPts.push(new THREE.Vector3(s.x + px * s.halfWidth, yR, s.z + pz * s.halfWidth));
  }

  if (leftPts.length >= 2) {
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), bankMat));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), bankMat));
  }

  const centerline = dataset.centerlineLocal;
  if (centerline?.length >= 2) {
    const clPts = centerline.map((c) => {
      const y = Math.max(terrainHeightAt(c.x, c.z, stations), SURFACE_Y + 0.15) + 0.35;
      return new THREE.Vector3(c.x, y, c.z);
    });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(clPts), centerMat));
  } else if (stations.length >= 2) {
    const clPts = stations.map((s) => {
      const y = Math.max(terrainHeightAt(s.x, s.z, stations), SURFACE_Y + 0.15) + 0.35;
      return new THREE.Vector3(s.x, y, s.z);
    });
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(clPts), centerMat));
  }

  // KML polygon boundary (ground level)
  const ring = dataset.ringLocal || [];
  if (ring.length >= 3) {
    const kmlPts = ring.map((c) => {
      const y = terrainHeightAt(c.x, c.z, stations) + 0.45;
      return new THREE.Vector3(c.x, y, c.z);
    });
    kmlPts.push(kmlPts[0].clone());
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(kmlPts),
        new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.55, depthWrite: false }),
      ),
    );
  }

  group.renderOrder = 6;
  return group;
}
