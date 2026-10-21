import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { FLOOD_RED } from "./waterShader.js";
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

  // Same vivid flood red as the API flood + legend (#FF3030). Lit standard material, no
  // transmission (transmission over dark ground darkened it to maroon).
  const material = new THREE.MeshStandardMaterial({
    // Slightly deeper base than the legend so lit + tone-mapped it lands on the same vivid red.
    color: new THREE.Color("#E01616"),
    emissive: new THREE.Color(FLOOD_RED),
    // Low glow: scene light already brightens it; more glow lifted G/B and read as salmon.
    emissiveIntensity: 0.12,
    transparent: true,
    opacity: 0.9,
    roughness: 0.25,
    metalness: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "floodInundation";
  mesh.renderOrder = 16;
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

    // Opacity scales with stage — reads as water filling low ground / flood lines
    const t = THREE.MathUtils.clamp(rise / 8, 0, 1);
    opacityAbove = THREE.MathUtils.lerp(0.86, 0.94, t);
    if (!underwaterView) material.opacity = opacityAbove;
    mesh.visible = true;
  }

  /**
   * Seen from under the water (camera below the stage), the flood sheet is the water surface
   * overhead: draw it as water blue, not the red hazard colour shown from above.
   */
  const RED = new THREE.Color("#E01616");
  const WATER_CEILING = new THREE.Color("#2f8fb0");
  let underwaterView = false;
  let opacityAbove = material.opacity;
  function setUnderwater(on) {
    if (on === underwaterView) return;
    underwaterView = on;
    if (on) opacityAbove = material.opacity;
    material.color.copy(on ? WATER_CEILING : RED);
    material.emissive.copy(on ? WATER_CEILING : RED);
    material.emissiveIntensity = on ? 0.25 : 0.12;
    material.opacity = on ? 0.55 : opacityAbove;
  }

  mesh.userData.setFloodRise = setFloodRise;
  mesh.userData.setUnderwater = setUnderwater;
  mesh.userData.groundY = groundY;
  mesh.setFloodRise = setFloodRise;
  return mesh;
}
