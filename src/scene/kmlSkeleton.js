import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";

const LIFT_M = 0.4;
const STAKE_HEIGHT = 2.2;

/**
 * Google Earth–style KML skeleton draped on FABDEM ground.
 * Toggle via Layers → "KML ground skeleton" (default off).
 */
export function createKmlSkeleton(dataset) {
  const group = new THREE.Group();
  group.name = "kmlSkeleton";
  const stations = dataset.corridor?.stations || [];

  const ring = dataset.ringLocal || [];
  if (ring.length >= 3) {
    const boundaryPts = [];
    for (const c of ring) {
      boundaryPts.push(
        new THREE.Vector3(c.x, skeletonY(c.x, c.z, stations), c.z),
      );
    }
    boundaryPts.push(boundaryPts[0].clone());

    const boundaryGeo = new THREE.BufferGeometry().setFromPoints(boundaryPts);
    const boundary = new THREE.Line(
      boundaryGeo,
      new THREE.LineBasicMaterial({
        color: 0xffe566,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: false,
      }),
    );
    boundary.name = "kmlBoundary";
    boundary.renderOrder = 4;
    group.add(boundary);

    const stakeMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    for (const c of ring) {
      const y0 = skeletonY(c.x, c.z, stations);
      const stakeGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(c.x, y0, c.z),
        new THREE.Vector3(c.x, y0 + STAKE_HEIGHT, c.z),
      ]);
      const stake = new THREE.Line(stakeGeo, stakeMat);
      stake.renderOrder = 4;
      group.add(stake);
    }
  }

  const centerline = dataset.centerlineLocal;
  if (centerline?.length >= 2) {
    const clPts = centerline.map(
      (c) => new THREE.Vector3(c.x, skeletonY(c.x, c.z, stations), c.z),
    );
    const clGeo = new THREE.BufferGeometry().setFromPoints(clPts);
    const clLine = new THREE.Line(
      clGeo,
      new THREE.LineBasicMaterial({
        color: 0x40d8ff,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      }),
    );
    clLine.name = "kmlCenterline";
    clLine.renderOrder = 5;
    group.add(clLine);
  }

  group.visible = false;
  return group;
}

/** Terrain height + lift; never below water edge so outline stays visible on river. */
function skeletonY(x, z, stations) {
  const ground = terrainHeightAt(x, z, stations);
  return Math.max(ground, SURFACE_Y + 0.2) + LIFT_M;
}
