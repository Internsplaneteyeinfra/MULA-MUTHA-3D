import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { computeSceneBounds } from "../geo/sceneBounds.js";

/**
 * Bathtub / still-water inundation overlay.
 * Wet where groundY < SURFACE_Y + floodRiseM; dry verts buried below terrain.
 * Illustrative elevation fill — not a hydraulic routing model.
 */
export function createFloodLayer(dataset) {
  const stations = dataset.corridor?.stations || [];
  const b = computeSceneBounds(dataset);
  const width = Math.max(40, b.spanX);
  const depth = Math.max(40, b.spanZ);
  // Coarser than full terrain — stage updates must stay interactive
  const segsX = dataset.dtm ? 220 : 160;
  const segsZ = dataset.dtm ? 110 : 80;

  const geo = new THREE.PlaneGeometry(width, depth, segsX, segsZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(b.cx, 0, b.cz);

  const pos = geo.attributes.position;
  const groundY = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const gy = terrainHeightAt(x, z, stations);
    groundY[i] = gy;
    // Start buried (no flood)
    pos.setY(i, gy - 40);
  }
  geo.computeVertexNormals();

  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#2a6fa8"),
    transparent: true,
    opacity: 0.38,
    roughness: 0.18,
    metalness: 0.05,
    transmission: 0.22,
    thickness: 1.2,
    ior: 1.33,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "floodInundation";
  mesh.renderOrder = 3;
  mesh.visible = false;
  mesh.frustumCulled = false;

  let lastRise = -1;

  function setFloodRise(riseM) {
    const rise = Math.max(0, Number(riseM) || 0);
    if (Math.abs(rise - lastRise) < 1e-4) return;
    lastRise = rise;

    if (rise < 0.02) {
      mesh.visible = false;
      return;
    }

    const floodY = SURFACE_Y + rise;
    const attr = mesh.geometry.attributes.position;
    for (let i = 0; i < attr.count; i++) {
      const gy = groundY[i];
      if (gy < floodY) {
        // Slight lift above flood plane to reduce z-fight with terrain / river
        attr.setY(i, floodY + 0.06);
      } else {
        attr.setY(i, gy - 40);
      }
    }
    attr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();

    // Opacity scales gently with stage (still readable at high rise)
    const t = THREE.MathUtils.clamp(rise / 12, 0, 1);
    material.opacity = THREE.MathUtils.lerp(0.28, 0.62, t);
    mesh.visible = true;
  }

  mesh.userData.setFloodRise = setFloodRise;
  mesh.userData.groundY = groundY;
  mesh.setFloodRise = setFloodRise;
  return mesh;
}
