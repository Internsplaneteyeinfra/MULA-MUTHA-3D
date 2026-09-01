import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { terrainHeightAt } from "../scene/terrain.js";
import {
  getBuildingMaterial,
  paletteColor,
  styleClassFromClassification,
} from "./buildingMaterials.js";
import { sampleFootprintElevation } from "./footprintPlacement.js";

/** Near corridor — OSM footprint extrusions with façade shader (visible windows/colors). */
const NEAR_M = 750;
const MAX_NEAR = 2400;

/**
 * Footprint-accurate near buildings — NOT generic GLB boxes.
 * Each building uses its actual OSM polygon + per-style façade material.
 */
export function buildNearFootprintBuildings(list, stations) {
  const group = new THREE.Group();
  group.name = "buildingsNearFootprint";

  const byStyle = new Map();
  const roofGeos = [];
  const tmp = new THREE.Color();

  const near = list
    .filter((r) => r.dist <= NEAR_M)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, MAX_NEAR);

  for (const rec of near) {
    const { building, metrics, classification } = rec;
    const verts = building.vertices;
    if (!verts || verts.length < 4) continue;

    const style = styleClassFromClassification(classification);
    const y = sampleFootprintElevation(metrics, stations);
    const h = classification.heightM;

    const shape = new THREE.Shape();
    shape.moveTo(verts[0].x - metrics.centroidX, -(verts[0].z - metrics.centroidZ));
    for (let k = 1; k < verts.length; k++) {
      shape.lineTo(verts[k].x - metrics.centroidX, -(verts[k].z - metrics.centroidZ));
    }

    let bodyGeo;
    try {
      bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
    } catch {
      continue;
    }
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.translate(metrics.centroidX, y, metrics.centroidZ);

    if (!byStyle.has(style)) byStyle.set(style, []);
    byStyle.get(style).push(bodyGeo);

    // Roof slab — visible from overview
    try {
      const roofH = classification.class === "house" ? 0.35 : 0.28;
      const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: roofH, bevelEnabled: false, steps: 1 });
      roofGeo.rotateX(-Math.PI / 2);
      roofGeo.translate(metrics.centroidX, y + h, metrics.centroidZ);
      tmp.copy(paletteColor(classification.paletteSeed ?? building.id ?? 0));
      tmp.multiplyScalar(0.72);
      paintGeo(roofGeo, tmp);
      roofGeos.push(roofGeo);
    } catch {
      /* ignore */
    }
  }

  for (const [style, geos] of byStyle) {
    if (!geos.length) continue;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, getBuildingMaterial(style));
    mesh.name = `nearFootprint:${style}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (roofGeos.length) {
    const mergedRoof = mergeGeometries(roofGeos, false);
    for (const g of roofGeos) g.dispose();
    if (mergedRoof) {
      mergedRoof.computeVertexNormals();
      const roofMesh = new THREE.Mesh(
        mergedRoof,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 }),
      );
      roofMesh.name = "nearFootprintRoofs";
      roofMesh.castShadow = true;
      group.add(roofMesh);
    }
  }

  console.info("Near footprint buildings", { count: near.length, styles: [...byStyle.keys()] });
  return group;
}

function paintGeo(geo, color) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}
