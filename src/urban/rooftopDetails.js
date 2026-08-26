import * as THREE from "three";

/**
 * Instanced rooftop props (water tanks, HVAC, solar) — attached to existing building roofs.
 * Density is deterministic and sparse so roofs stay readable.
 */
export function createRooftopDetails(placements, stations) {
  const group = new THREE.Group();
  group.name = "rooftopDetails";
  if (!placements.length) return group;

  const tankGeo = new THREE.CylinderGeometry(0.55, 0.6, 1.15, 10);
  tankGeo.translate(0, 0.575, 0);
  const tankBlack = new THREE.MeshStandardMaterial({
    color: "#2a2e32",
    roughness: 0.7,
    metalness: 0.25,
  });
  const tankWhite = new THREE.MeshStandardMaterial({
    color: "#d8dce0",
    roughness: 0.55,
    metalness: 0.15,
  });
  const hvacGeo = new THREE.BoxGeometry(1.4, 0.7, 1.0);
  hvacGeo.translate(0, 0.35, 0);
  const hvacMat = new THREE.MeshStandardMaterial({
    color: "#8a9096",
    roughness: 0.65,
    metalness: 0.35,
  });
  const solarGeo = new THREE.BoxGeometry(2.2, 0.08, 1.2);
  solarGeo.translate(0, 0.04, 0);
  const solarMat = new THREE.MeshStandardMaterial({
    color: "#1a3048",
    roughness: 0.35,
    metalness: 0.55,
  });

  const tanksB = [];
  const tanksW = [];
  const hvacs = [];
  const solars = [];

  for (const rec of placements) {
    const { metrics, classification, building } = rec;
    const seed = stableSeed(building.id, metrics.centroidX, metrics.centroidZ);
    const h = classification.heightM;
    const area = metrics.areaM2;
    const cls = classification.class;
    const y = rec.roofY;

    // Sparse density rules
    const wantTank = area > 80 && (seed % 5 !== 0) && cls !== "warehouse";
    const wantHvac = (cls.startsWith("apartment") || cls === "commercial") && seed % 3 === 0;
    const wantSolar = (cls === "house" || cls === "apartment_low") && seed % 7 === 0 && area > 100;

    const ox = ((seed % 17) / 17 - 0.5) * metrics.lengthM * 0.35;
    const oz = (((seed * 3) % 13) / 13 - 0.5) * metrics.widthM * 0.35;
    const cos = Math.cos(metrics.yaw);
    const sin = Math.sin(metrics.yaw);
    const wx = metrics.centroidX + ox * cos - oz * sin;
    const wz = metrics.centroidZ + ox * sin + oz * cos;

    if (wantTank) {
      const entry = {
        x: wx,
        y: y + 0.05,
        z: wz,
        s: 0.85 + (seed % 5) * 0.08,
        yaw: metrics.yaw,
      };
      if (seed % 2 === 0) tanksB.push(entry);
      else tanksW.push(entry);
    }
    if (wantHvac) {
      hvacs.push({
        x: metrics.centroidX - ox * 0.6,
        y: y + 0.02,
        z: metrics.centroidZ - oz * 0.6,
        s: 1,
        yaw: metrics.yaw,
      });
    }
    if (wantSolar) {
      solars.push({
        x: metrics.centroidX + oz * 0.4,
        y: y + 0.02,
        z: metrics.centroidZ - ox * 0.4,
        s: 1,
        yaw: metrics.yaw + 0.15,
      });
    }
    void stations;
    void h;
  }

  if (tanksB.length) group.add(makeInstances(tankGeo, tankBlack, tanksB, "tanksBlack"));
  if (tanksW.length) group.add(makeInstances(tankGeo, tankWhite, tanksW, "tanksWhite"));
  if (hvacs.length) group.add(makeInstances(hvacGeo, hvacMat, hvacs, "hvac"));
  if (solars.length) group.add(makeInstances(solarGeo, solarMat, solars, "solar"));

  return group;
}

function makeInstances(geo, mat, list, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.frustumCulled = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.yaw || 0, 0);
    dummy.scale.setScalar(p.s || 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function stableSeed(id, x, z) {
  const n = Number(id);
  if (Number.isFinite(n)) return Math.abs(Math.floor(n));
  return Math.abs(Math.floor(x * 12.9898 + z * 78.233)) % 100000;
}
