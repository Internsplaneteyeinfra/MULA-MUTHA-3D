import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { terrainHeightAt } from "../scene/terrain.js";
import { neighborhoodPaletteColor } from "./buildingMaterials.js";
import { getFarLodMaterial } from "./buildingMaterials.js";

const CELL = 140;

/**
 * HLOD skyline clusters — merged building mass per grid cell (2000 m+ corridor).
 * ArcGIS-style distant city density without thousands of draw calls.
 */
export function buildCityHlod(records, stations) {
  const group = new THREE.Group();
  group.name = "cityHlod";

  const cells = new Map();
  for (const rec of records) {
    const { metrics, classification, building } = rec;
    if (!metrics || !building?.vertices?.length) continue;
    const cx = Math.floor(metrics.centroidX / CELL);
    const cz = Math.floor(metrics.centroidZ / CELL);
    const key = `${cx},${cz}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ metrics, classification, building });
  }

  const geos = [];
  const tmp = new THREE.Color();

  for (const [, list] of cells) {
    let massX = 0;
    let massZ = 0;
    let massH = 0;
    let count = 0;
    const cellGeos = [];

    for (const { metrics, classification, building } of list) {
      const verts = building.vertices;
      if (verts.length < 4) continue;
      const shape = footprintShape(verts, metrics);
      if (!shape) continue;
      const h = classification.heightM;
      let geo;
      try {
        geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
      } catch {
        continue;
      }
      geo.rotateX(-Math.PI / 2);
      const y = terrainHeightAt(metrics.centroidX, metrics.centroidZ, stations);
      geo.translate(metrics.centroidX, y, metrics.centroidZ);
      cellGeos.push(geo);
      massX += metrics.centroidX;
      massZ += metrics.centroidZ;
      massH += h;
      count++;
    }

    if (!count || !cellGeos.length) continue;
    massX /= count;
    massZ /= count;
    massH /= count;

    tmp.copy(neighborhoodPaletteColor(classificationSeed(list), massX, massZ));
    const merged = mergeGeometries(cellGeos, false);
    for (const g of cellGeos) g.dispose();
    if (!merged) continue;

    paintGeo(merged, tmp, 0.92);
    geos.push(merged);

    if (geos.length >= 80) {
      group.add(flushHlod(geos));
      geos.length = 0;
    }
  }

  if (geos.length) group.add(flushHlod(geos));

  console.info("City HLOD clusters", { cells: cells.size, meshes: group.children.length });
  return group;
}

function classificationSeed(list) {
  return list[0]?.classification?.paletteSeed ?? list[0]?.building?.id ?? 0;
}

function footprintShape(verts, metrics) {
  try {
    const shape = new THREE.Shape();
    shape.moveTo(verts[0].x - metrics.centroidX, -(verts[0].z - metrics.centroidZ));
    for (let k = 1; k < verts.length; k++) {
      shape.lineTo(verts[k].x - metrics.centroidX, -(verts[k].z - metrics.centroidZ));
    }
    return shape;
  } catch {
    return null;
  }
}

function paintGeo(geo, color, mult = 1) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r * mult;
    col[i * 3 + 1] = color.g * mult;
    col[i * 3 + 2] = color.b * mult;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

function flushHlod(geos) {
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, getFarLodMaterial());
  mesh.name = "hlodCluster";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}
