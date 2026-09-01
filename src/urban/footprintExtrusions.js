import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  getBuildingMaterial,
  getMidLodMaterial,
  neighborhoodPaletteColor,
  styleClassFromClassification,
} from "./buildingMaterials.js";
import { sampleFootprintElevation } from "./footprintPlacement.js";

/**
 * Extrude actual OSM footprints — shared by hero / near / mid tiers.
 */
export function buildFootprintTier(records, stations, opts = {}) {
  const {
    name = "footprintTier",
    maxCount = 4000,
    individualHero = false,
    roofSlab = true,
    useMidMaterial = false,
  } = opts;

  const group = new THREE.Group();
  group.name = name;

  const sorted = [...records].sort((a, b) => a.dist - b.dist).slice(0, maxCount);
  if (individualHero) {
    for (const rec of sorted) {
      const mesh = buildSingleFootprint(rec, stations, { roofSlab, useMidMaterial, hero: true });
      if (mesh) group.add(mesh);
    }
    return group;
  }

  const byStyle = new Map();
  const roofGeos = [];
  const tmp = new THREE.Color();

  for (const rec of sorted) {
    const { building, metrics, classification } = rec;
    const verts = building.vertices;
    if (!verts || verts.length < 4) continue;

    const style = styleClassFromClassification(classification);
    const y = sampleFootprintElevation(metrics, stations);
    const h = classification.heightM;
    const shape = makeShape(verts, metrics);
    if (!shape) continue;

    let bodyGeo;
    try {
      bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
    } catch {
      continue;
    }
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.translate(metrics.centroidX, y, metrics.centroidZ);

    const palette = neighborhoodPaletteColor(
      classification.paletteSeed ?? building.id ?? 0,
      metrics.centroidX,
      metrics.centroidZ,
    );
    paintWallRoofGeo(bodyGeo, palette);

    if (!byStyle.has(style)) byStyle.set(style, { geos: [], colors: true });
    byStyle.get(style).geos.push(bodyGeo);

    if (roofSlab) {
      try {
        const roofH = classification.class === "house" ? 0.32 : 0.26;
        const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: roofH, bevelEnabled: false, steps: 1 });
        roofGeo.rotateX(-Math.PI / 2);
        roofGeo.translate(metrics.centroidX, y + h, metrics.centroidZ);
        tmp.copy(palette);
        tmp.multiplyScalar(0.68);
        paintGeo(roofGeo, tmp);
        roofGeos.push(roofGeo);
      } catch {
        /* ignore */
      }
    }
  }

  for (const [style, bucket] of byStyle) {
    if (!bucket.geos.length) continue;
    const merged = mergeGeometries(bucket.geos, false);
    for (const g of bucket.geos) g.dispose();
    if (!merged) continue;
    merged.computeVertexNormals();
    const mat = bucket.colors ? getMidLodMaterial() : getMidLodMaterial();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = `${name}:${style}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (roofGeos.length) {
    const mergedRoof = mergeGeometries(roofGeos, false);
    for (const g of roofGeos) g.dispose();
    if (mergedRoof) {
      mergedRoof.computeVertexNormals();
      group.add(
        new THREE.Mesh(
          mergedRoof,
          new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0.04 }),
        ),
      );
      group.children[group.children.length - 1].castShadow = true;
      group.children[group.children.length - 1].receiveShadow = true;
    }
  }

  return group;
}

function buildSingleFootprint(rec, stations, { roofSlab, useMidMaterial, hero }) {
  const { building, metrics, classification } = rec;
  const verts = building.vertices;
  if (!verts || verts.length < 4) return null;

  const style = styleClassFromClassification(classification);
  const y = sampleFootprintElevation(metrics, stations);
  const h = classification.heightM;
  const shape = makeShape(verts, metrics);
  if (!shape) return null;

  const sub = new THREE.Group();
  sub.name = `hero:${building.id ?? ""}`;

  try {
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.translate(metrics.centroidX, y, metrics.centroidZ);
    const mat = getBuildingMaterial(style).clone();
    const col = neighborhoodPaletteColor(classification.paletteSeed ?? building.id ?? 0, metrics.centroidX, metrics.centroidZ);
    mat.color.copy(col);
    const body = new THREE.Mesh(bodyGeo, mat);
    body.castShadow = true;
    body.receiveShadow = true;
    sub.add(body);

    if (roofSlab) {
      const roofH = 0.3;
      const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: roofH, bevelEnabled: false, steps: 1 });
      roofGeo.rotateX(-Math.PI / 2);
      roofGeo.translate(metrics.centroidX, y + h, metrics.centroidZ);
      const roofCol = col.clone().multiplyScalar(0.72);
      sub.add(
        new THREE.Mesh(
          roofGeo,
          new THREE.MeshStandardMaterial({ color: roofCol, roughness: 0.82, metalness: 0.05 }),
        ),
      );
    }
  } catch {
    return null;
  }

  sub.userData.metrics = metrics;
  return sub;
}

function makeShape(verts, metrics) {
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

/** Wall vs roof vertex colors — makes extrusions read as 3D from oblique views. */
export function paintWallRoofGeo(geo, baseColor) {
  geo.computeVertexNormals();
  const norm = geo.attributes.normal;
  const n = norm.count;
  const col = new Float32Array(n * 3);
  const wall = baseColor.clone();
  const roof = baseColor.clone().multiplyScalar(0.78);
  wall.offsetHSL(0, 0, -0.06);
  for (let i = 0; i < n; i++) {
    const ny = Math.abs(norm.getY(i));
    const c = ny > 0.62 ? roof : wall;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}
