import * as THREE from "three";
import { SURFACE_Y } from "../../scene/river.js";
import { state } from "../../state.js";

/**
 * Clear, always-readable markers at Fishing_Locations.kml coordinates.
 */
export function createFishingMarkerLayer(zones) {
  const group = new THREE.Group();
  group.name = "fishingMarkers";

  const markers = [];
  const ringGeo = new THREE.RingGeometry(4.5, 7.2, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const coreGeo = new THREE.CircleGeometry(2.4, 28);
  coreGeo.rotateX(-Math.PI / 2);
  const poleGeo = new THREE.CylinderGeometry(0.35, 0.45, 6.5, 8);
  const beaconGeo = new THREE.SphereGeometry(1.35, 14, 12);

  for (const zone of zones) {
    const ringMat = new THREE.MeshBasicMaterial({
      color: "#3ec8e8",
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const coreMat = new THREE.MeshBasicMaterial({
      color: "#f0fcff",
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const poleMat = new THREE.MeshBasicMaterial({
      color: "#e8f6fa",
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const beaconMat = new THREE.MeshBasicMaterial({
      color: "#ffd060",
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    const ring = new THREE.Mesh(ringGeo, ringMat);
    const core = new THREE.Mesh(coreGeo, coreMat);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);

    const y = SURFACE_Y + 0.25;
    ring.position.set(zone.x, y, zone.z);
    core.position.set(zone.x, y + 0.04, zone.z);
    pole.position.set(zone.x, SURFACE_Y + 3.5, zone.z);
    beacon.position.set(zone.x, SURFACE_Y + 7.2, zone.z);

    for (const obj of [ring, core, pole, beacon]) {
      obj.userData.zone = zone;
      obj.renderOrder = 14;
      obj.frustumCulled = false;
      group.add(obj);
    }
    ring.name = `fishMarker_${zone.id}`;

    const label = makeFishingLabel(zone.name || zone.id);
    label.position.set(zone.x, SURFACE_Y + 10.5, zone.z);
    label.userData.zone = zone;
    group.add(label);

    markers.push({
      zone,
      ring,
      core,
      pole,
      beacon,
      label,
      ringMat,
      coreMat,
      poleMat,
      beaconMat,
    });
  }

  function updateLod(camera) {
    if (!camera) return;
    const hideLabels = !!state.cinematicActive;
    const t = performance.now() * 0.002;
    for (const m of markers) {
      const d = camera.position.distanceTo(m.ring.position);
      const visible = d < 8000;
      m.ring.visible = visible && !hideLabels;
      m.core.visible = visible && !hideLabels;
      m.pole.visible = visible && !hideLabels;
      m.beacon.visible = visible && !hideLabels;
      m.label.visible = visible && !hideLabels && d < 3500;

      // Scale with distance so markers stay readable from overview
      const scale = THREE.MathUtils.clamp(d / 280, 1.1, 9);
      m.ring.scale.setScalar(scale);
      m.core.scale.setScalar(scale);
      m.pole.scale.set(scale * 0.55, scale * 0.45, scale * 0.55);
      m.beacon.scale.setScalar(scale * 0.55);

      const pulse = 0.85 + Math.sin(t + m.zone.x * 0.01) * 0.12;
      m.ringMat.opacity = THREE.MathUtils.clamp(0.95 * pulse, 0.55, 1);
      m.coreMat.opacity = 0.65;
      m.beaconMat.opacity = 0.85 + Math.sin(t * 2.2) * 0.12;

      const ls = THREE.MathUtils.clamp(d * 0.014, 8, 36);
      m.label.scale.set(ls * 2.6, ls, 1);
    }
  }

  function pickables() {
    return markers.flatMap((m) => [m.ring, m.core, m.pole, m.beacon]);
  }

  console.info("Fishing markers", { count: markers.length, ids: markers.map((m) => m.zone.id) });
  return { group, markers, updateLod, pickables };
}

function makeFishingLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 72;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 320, 72);
  ctx.fillStyle = "rgba(8, 28, 36, 0.78)";
  ctx.fillRect(12, 10, 296, 52);
  ctx.strokeStyle = "rgba(62, 200, 232, 0.95)";
  ctx.lineWidth = 3;
  ctx.strokeRect(12, 10, 296, 52);
  ctx.fillStyle = "#e8f8fc";
  ctx.font = "700 26px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(text), 160, 36);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const spr = new THREE.Sprite(mat);
  spr.renderOrder = 16;
  spr.frustumCulled = false;
  return spr;
}
