import * as THREE from "three";
import { getGeoReference } from "../geo/geoReference.js";
import { terrainHeightAt } from "./terrain.js";

/**
 * Visible lat/lon grid with geographic labels — toggle via Layers panel.
 */
export function createCoordinateGrid(dataset) {
  const group = new THREE.Group();
  group.name = "coordinateGrid";

  let frame;
  try {
    frame = getGeoReference().frame;
  } catch {
    frame = dataset.frame;
  }
  if (!frame) return group;

  const bbox = dataset.validation?.kmlValidation?.bbox;
  if (!bbox) return group;

  const stations = dataset.corridor?.stations || [];
  const minLon = bbox.minLon;
  const maxLon = bbox.maxLon;
  const minLat = bbox.minLat;
  const maxLat = bbox.maxLat;
  const spanLon = maxLon - minLon;
  const spanLat = maxLat - minLat;
  const stepLon = pickStep(spanLon);
  const stepLat = pickStep(spanLat);

  const lineMat = new THREE.LineBasicMaterial({
    color: 0xe8eef2,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });

  const labelData = [];

  const startLon = Math.ceil(minLon / stepLon) * stepLon;
  for (let lon = startLon; lon <= maxLon; lon += stepLon) {
    const pts = [];
    const n = 28;
    for (let i = 0; i <= n; i++) {
      const lat = minLat + (spanLat * i) / n;
      const p = frame.projectLonLat(lon, lat);
      const y = terrainHeightAt(p.x, p.z, stations) + 0.6;
      pts.push(new THREE.Vector3(p.x, y, p.z));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    const mid = frame.projectLonLat(lon, (minLat + maxLat) * 0.5);
    labelData.push({ x: mid.x, z: mid.z, text: `${lon.toFixed(3)}°E` });
  }

  const startLat = Math.ceil(minLat / stepLat) * stepLat;
  for (let lat = startLat; lat <= maxLat; lat += stepLat) {
    const pts = [];
    const n = 28;
    for (let i = 0; i <= n; i++) {
      const lon = minLon + (spanLon * i) / n;
      const p = frame.projectLonLat(lon, lat);
      const y = terrainHeightAt(p.x, p.z, stations) + 0.6;
      pts.push(new THREE.Vector3(p.x, y, p.z));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    const mid = frame.projectLonLat((minLon + maxLon) * 0.5, lat);
    labelData.push({ x: mid.x, z: mid.z, text: `${lat.toFixed(3)}°N` });
  }

  group.userData.labels = labelData;
  return group;
}

export function mountCoordinateLabels(root, gridGroup, camera, canvas) {
  const layer = document.createElement("div");
  layer.className = "coord-label-layer";
  layer.id = "coord-labels";
  root.appendChild(layer);

  return {
    update() {
      if (!gridGroup.visible) {
        layer.innerHTML = "";
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const labels = gridGroup.userData.labels || [];
      const v = new THREE.Vector3();
      let html = "";
      for (const lb of labels) {
        v.set(lb.x, 12, lb.z).project(camera);
        if (v.z > 1) continue;
        const sx = (v.x * 0.5 + 0.5) * rect.width;
        const sy = (-v.y * 0.5 + 0.5) * rect.height;
        if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) continue;
        html += `<span class="coord-lbl" style="left:${sx}px;top:${sy}px">${lb.text}</span>`;
      }
      layer.innerHTML = html;
    },
    setVisible(v) {
      layer.style.display = v ? "block" : "none";
    },
  };
}

function pickStep(spanDeg) {
  if (spanDeg > 0.08) return 0.01;
  if (spanDeg > 0.04) return 0.005;
  if (spanDeg > 0.015) return 0.002;
  return 0.001;
}
