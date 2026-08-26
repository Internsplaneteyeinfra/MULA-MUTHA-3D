import * as THREE from "three";

/**
 * Realistic 3D river fish — larger body, fins, eyes, animated tail.
 * Local space: head toward +X; callers rotate to face river tangent (+Z in scene).
 */
export function createRiverFish(options = {}) {
  const fish = new THREE.Group();
  fish.name = "riverFish";

  const scale = options.scale || 1;
  const bodyColor = options.color ?? 0xc98b42;
  const finColor = options.finColor ?? 0xb87532;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.48,
    metalness: 0.08,
    envMapIntensity: 0.55,
    emissive: new THREE.Color(bodyColor).multiplyScalar(0.06),
  });
  const finMaterial = new THREE.MeshStandardMaterial({
    color: finColor,
    roughness: 0.62,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.2,
    metalness: 0.15,
  });
  const bellyMaterial = new THREE.MeshStandardMaterial({
    color: options.bellyColor ?? 0xe8dcc8,
    roughness: 0.7,
    metalness: 0.02,
  });

  // —— Body (elongated along +X) ——
  const bodyGeometry = new THREE.SphereGeometry(1, 28, 18);
  bodyGeometry.scale(2.4, 1.05, 0.85);
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  fish.add(body);

  // Soft belly highlight
  const bellyGeo = new THREE.SphereGeometry(1, 16, 12);
  bellyGeo.scale(2.05, 0.55, 0.7);
  bellyGeo.translate(0.1, -0.35, 0);
  const belly = new THREE.Mesh(bellyGeo, bellyMaterial);
  fish.add(belly);

  // —— Tail group (swims) ——
  const tailGroup = new THREE.Group();
  tailGroup.position.set(-2.1, 0, 0);
  fish.add(tailGroup);

  const tailShape = new THREE.Shape();
  tailShape.moveTo(0, 0);
  tailShape.lineTo(-1.5, 1.15);
  tailShape.lineTo(-1.15, 0);
  tailShape.lineTo(-1.5, -1.15);
  tailShape.lineTo(0, 0);
  const tail = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), finMaterial);
  tail.rotation.y = Math.PI / 2;
  tailGroup.add(tail);

  // —— Dorsal ——
  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(-0.6, 0);
  dorsalShape.lineTo(0.2, 0);
  dorsalShape.lineTo(-0.2, 0.9);
  dorsalShape.lineTo(-0.8, 0);
  const dorsal = new THREE.Mesh(new THREE.ShapeGeometry(dorsalShape), finMaterial);
  dorsal.rotation.x = -Math.PI / 2;
  dorsal.position.set(-0.2, 1.0, 0);
  fish.add(dorsal);

  // —— Side fins ——
  function createSideFin(side) {
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.9, 0.6);
    finShape.lineTo(0.5, -0.3);
    finShape.lineTo(0, 0);
    const fin = new THREE.Mesh(new THREE.ShapeGeometry(finShape), finMaterial);
    fin.position.set(0.3, -0.1, side * 0.8);
    fin.rotation.x = (side * Math.PI) / 2;
    return fin;
  }
  fish.add(createSideFin(1));
  fish.add(createSideFin(-1));

  // —— Eyes ——
  const eyeGeometry = new THREE.SphereGeometry(0.16, 14, 12);
  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(1.45, 0.35, 0.72);
  fish.add(leftEye);
  const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  rightEye.position.set(1.45, 0.35, -0.72);
  fish.add(rightEye);

  // —— Gills ——
  const gillMaterial = new THREE.MeshBasicMaterial({ color: 0x70401f });
  const gillGeometry = new THREE.TorusGeometry(0.65, 0.025, 8, 24, Math.PI);
  const gillLeft = new THREE.Mesh(gillGeometry, gillMaterial);
  gillLeft.position.set(0.95, 0, 0.72);
  gillLeft.rotation.y = Math.PI / 2;
  fish.add(gillLeft);
  const gillRight = gillLeft.clone();
  gillRight.position.z = -0.72;
  fish.add(gillRight);

  // Head faces +X in local space; callers align +X to river tangent
  fish.userData = {
    tailGroup,
    body,
    swimSpeed: options.swimSpeed || 0.4,
    swimPhase: Math.random() * Math.PI * 2,
    baseY: options.y || 0,
    lengthM: 2.4 * scale,
    headingAxis: new THREE.Vector3(1, 0, 0),
  };

  fish.scale.set(scale, scale, scale);
  fish.renderOrder = 8;
  fish.frustumCulled = false;
  return fish;
}

const _fwd = new THREE.Vector3();
const _quat = new THREE.Quaternion();

/** Align fish head (+X) to a world-space direction, then animate tail / sway. */
export function orientFishAlong(fish, dirX, dirZ, time) {
  _fwd.set(dirX, 0, dirZ);
  if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, 1);
  else _fwd.normalize();
  _quat.setFromUnitVectors(fish.userData.headingAxis || new THREE.Vector3(1, 0, 0), _fwd);
  fish.quaternion.copy(_quat);
  updateFishSwimPose(fish, time);
}

/** Tail + gentle body sway (call after orientation). */
export function updateFishSwimPose(fish, time) {
  const data = fish.userData;
  if (!data?.tailGroup) return;
  data.tailGroup.rotation.y = Math.sin(time * 7 + data.swimPhase) * 0.45;
  // Soft roll without wiping heading quaternion
  fish.rotateZ(Math.sin(time * 2 + data.swimPhase) * 0.04);
}

/** Legacy stubs kept so older spawn paths do not crash if imported. */
export function createFishGeometry() {
  return new THREE.SphereGeometry(0.4, 8, 6);
}

export function createFishMaterial(species = {}) {
  return new THREE.MeshStandardMaterial({
    color: species.body || "#c98b42",
    roughness: 0.55,
    metalness: 0.05,
  });
}

export function tickFishMaterials() {}

export function attachSwimAttributes() {}
