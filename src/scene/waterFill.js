import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { isObservedWater } from "../geo/osmWater.js";

const TOP_Y = SURFACE_Y - 0.02;
const BED_LIFT = 0.04;

/**
 * Water column from the DTM bed up to WSE, on cells that are real water.
 * Bottom sits on the DTM the same way 3D silt does; top meets the water surface.
 */
export function createWaterFill(terrainMesh, river, dataset, lulc, osmWater) {
  const tGeo = terrainMesh?.geometry;
  const params = tGeo?.parameters;
  if (!params?.widthSegments) return null;

  const cols = params.widthSegments + 1;
  const rows = params.heightSegments + 1;
  const tp = tGeo.attributes.position.array;
  const n = cols * rows;

  const wet = new Uint8Array(n);
  const botY = new Float32Array(n);
  let fillCount = 0;
  for (let i = 0; i < n; i++) {
    const x = tp[i * 3];
    const dtmY = tp[i * 3 + 1];
    const z = tp[i * 3 + 2];
    if (dtmY >= TOP_Y) continue;
    if (!isObservedWater(lulc, osmWater, x, z)) continue;
    wet[i] = 1;
    botY[i] = dtmY + BED_LIFT;
    fillCount++;
  }
  if (!fillCount) {
    console.info("[water-fill] no DTM water cells below WSE");
    return null;
  }

  const isQuad = (c, r) => {
    if (c < 1 || r < 1 || c >= cols - 2 || r >= rows - 2) return false;
    const a = r * cols + c;
    if (!wet[a] || !wet[a + 1] || !wet[a + cols] || !wet[a + cols + 1]) return false;
    return (
      wet[a - 1] &&
      wet[a + 2] &&
      wet[a - cols] &&
      wet[a + cols * 2]
    );
  };

  const pos = [];
  const indices = [];
  const vertMap = new Int32Array(n).fill(-1);

  const vert = (i) => {
    if (vertMap[i] >= 0) return vertMap[i];
    const id = pos.length / 3;
    vertMap[i] = id;
    pos.push(tp[i * 3], botY[i], tp[i * 3 + 2]);
    return id;
  };

  let quads = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (!isQuad(c, r)) continue;
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      const ba = vert(a), bb = vert(b), bd = vert(d), be = vert(e);
      indices.push(ba, bb, bd, bb, be, bd);
      quads++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    color: 0x2a7d92,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "riverWaterColumn";
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  console.info("[water-fill] water column DTM → WSE", { cells: fillCount, quads });
  return mesh;
}
