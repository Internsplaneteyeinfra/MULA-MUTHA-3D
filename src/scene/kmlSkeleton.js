import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";

const LIFT_M = 1.35;
const STAKE_HEIGHT = 3.2;
const STAKE_EVERY = 8;

/**
 * Google Earth–style KML skeleton draped on terrain.
 * Fat lines + contrast halo so AOI / centerline stay readable in Overview.
 */
export function createKmlSkeleton(dataset) {
  const group = new THREE.Group();
  group.name = "kmlSkeleton";
  const stations = dataset.corridor?.stations || [];
  const resolution = new THREE.Vector2(
    Math.max(1, window.innerWidth),
    Math.max(1, window.innerHeight),
  );

  const ring = dataset.ringLocal || [];
  if (ring.length >= 3) {
    const boundaryPts = [];
    for (const c of ring) {
      boundaryPts.push(new THREE.Vector3(c.x, skeletonY(c.x, c.z, stations), c.z));
    }
    boundaryPts.push(boundaryPts[0].clone());

    group.add(
      makeFatLine(boundaryPts, {
        color: 0x1a1408,
        linewidth: 5.5,
        opacity: 0.75,
        resolution,
        renderOrder: 18,
      }),
    );
    group.add(
      makeFatLine(boundaryPts, {
        color: 0xffe566,
        linewidth: 2.8,
        opacity: 1,
        resolution,
        renderOrder: 19,
      }),
    );

    // Sparse white stakes — every Nth vertex (not every ring point)
    const stakeMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    for (let i = 0; i < ring.length; i += STAKE_EVERY) {
      const c = ring[i];
      const y0 = skeletonY(c.x, c.z, stations);
      const stakeGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(c.x, y0, c.z),
        new THREE.Vector3(c.x, y0 + STAKE_HEIGHT, c.z),
      ]);
      const stake = new THREE.Line(stakeGeo, stakeMat);
      stake.renderOrder = 20;
      stake.frustumCulled = false;
      group.add(stake);
    }
  }

  const centerline = dataset.centerlineLocal;
  if (centerline?.length >= 2) {
    const clPts = centerline.map(
      (c) => new THREE.Vector3(c.x, skeletonY(c.x, c.z, stations) + 0.35, c.z),
    );
    group.add(
      makeFatLine(clPts, {
        color: 0x062838,
        linewidth: 4.5,
        opacity: 0.7,
        resolution,
        renderOrder: 20,
      }),
    );
    group.add(
      makeFatLine(clPts, {
        color: 0x4de8ff,
        linewidth: 2.2,
        opacity: 1,
        resolution,
        renderOrder: 21,
      }),
    );
  }

  group.userData.resolution = resolution;
  group.userData.setResolution = (w, h) => {
    resolution.set(w, h);
    group.traverse((obj) => {
      if (obj.material?.resolution) obj.material.resolution.set(w, h);
    });
  };

  group.visible = false;
  return group;
}

function makeFatLine(pts, { color, linewidth, opacity, resolution, renderOrder }) {
  const positions = [];
  for (const p of pts) positions.push(p.x, p.y, p.z);
  const geo = new LineGeometry();
  geo.setPositions(positions);
  const mat = new LineMaterial({
    color,
    linewidth,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
    resolution,
  });
  const line = new Line2(geo, mat);
  line.computeLineDistances();
  line.renderOrder = renderOrder;
  line.frustumCulled = false;
  return line;
}

/** Terrain height + lift; never below water edge so outline stays visible on river. */
function skeletonY(x, z, stations) {
  const ground = terrainHeightAt(x, z, stations);
  return Math.max(ground, SURFACE_Y + 0.35) + LIFT_M;
}
