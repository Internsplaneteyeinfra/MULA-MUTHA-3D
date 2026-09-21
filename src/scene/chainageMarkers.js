import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { SURFACE_Y } from "./river.js";
import { state } from "../state.js";
import { CHAINAGE_DESTINATIONS, getDestinations, interpolateChainage } from "../geo/chainage.js";

/** Flat markers sit just above water surface. */
const MARKER_Y = SURFACE_Y + 0.55;
const LINE_Y = SURFACE_Y + 1.15;
/** Destination name banners float above the river; lower + larger when arrived. */
const DEST_LABEL_Y = SURFACE_Y + 55;
const DEST_LABEL_Y_ARRIVED = SURFACE_Y + 28;
/** Within this distance the name banner grows toward “arrived” size. */
const DEST_NEAR_M = 350;
const DEST_ARRIVED_M = 40;

/**
 * Chainage styled after the GIS reference:
 * white dashed centerline · yellow majors (white rim) · white minors · white labels.
 */
export function createChainageLayer(dataset) {
  const group = new THREE.Group();
  group.name = "chainageMarkers";
  const points = [...(dataset.chainage || [])].sort(
    (a, b) => (a.meters ?? 0) - (b.meters ?? 0),
  );
  if (!points.length) return { group, update() {}, pick() {}, points: [] };

  const majors = points.filter((p) => p.major || (Number(p.meters) % 1000 === 0));
  const minors = points.filter((p) => !majors.includes(p));

  const rimGeo = makeDiscGeometry(3.6);
  const majorGeo = makeDiscGeometry(2.85);
  const minorGeo = makeDiscGeometry(0.95);
  const rimMat = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const majorMat = new THREE.MeshBasicMaterial({
    color: "#f5c518",
    depthTest: false,
    transparent: true,
    opacity: 1,
  });
  const minorMat = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const selectFillMat = new THREE.MeshBasicMaterial({
    color: "#ffd54a",
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const selectRingMat = new THREE.MeshBasicMaterial({
    color: "#ff8a00",
    depthTest: false,
    transparent: true,
    opacity: 0.72,
  });

  const rimMesh = new THREE.InstancedMesh(rimGeo, rimMat, Math.max(1, majors.length));
  const majorMesh = new THREE.InstancedMesh(majorGeo, majorMat, Math.max(1, majors.length));
  const minorMesh = new THREE.InstancedMesh(minorGeo, minorMat, Math.max(1, minors.length));
  rimMesh.name = "chainageMajorRim";
  majorMesh.name = "chainageMajor";
  minorMesh.name = "chainageMinor";
  for (const m of [rimMesh, majorMesh, minorMesh]) {
    m.frustumCulled = false;
    m.renderOrder = m === minorMesh ? 25 : 26;
  }
  majorMesh.userData.pickable = true;
  minorMesh.userData.pickable = true;
  rimMesh.renderOrder = 25;

  const dummy = new THREE.Object3D();
  const majorIndex = [];
  for (let i = 0; i < majors.length; i++) {
    const p = majors[i];
    majorIndex[i] = p;
    dummy.position.set(p.x, MARKER_Y, p.z);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    rimMesh.setMatrixAt(i, dummy.matrix);
    majorMesh.setMatrixAt(i, dummy.matrix);
  }
  rimMesh.count = majors.length;
  majorMesh.count = majors.length;
  rimMesh.instanceMatrix.needsUpdate = true;
  majorMesh.instanceMatrix.needsUpdate = true;

  const minorIndex = [];
  for (let i = 0; i < minors.length; i++) {
    const p = minors[i];
    minorIndex[i] = p;
    dummy.position.set(p.x, MARKER_Y + 0.02, p.z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    minorMesh.setMatrixAt(i, dummy.matrix);
  }
  minorMesh.count = minors.length;
  minorMesh.instanceMatrix.needsUpdate = true;

  group.add(rimMesh);
  group.add(majorMesh);
  group.add(minorMesh);

  // White dashed centerline (reference style)
  const resolution = new THREE.Vector2(
    Math.max(1, window.innerWidth),
    Math.max(1, window.innerHeight),
  );
  const positions = [];
  for (const p of points) positions.push(p.x, LINE_Y, p.z);

  const lineGeo = new LineGeometry();
  lineGeo.setPositions(positions);
  const lineMat = new LineMaterial({
    color: 0xffffff,
    linewidth: 1.85,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
    dashed: true,
    dashSize: 10,
    gapSize: 6,
    resolution,
  });
  const chainLine = new Line2(lineGeo, lineMat);
  chainLine.computeLineDistances();
  chainLine.name = "chainageConnector";
  chainLine.renderOrder = 24;
  chainLine.frustumCulled = false;
  group.add(chainLine);

  // Orange highlight for the selected chainage segment
  const selLineGeo = new LineGeometry();
  selLineGeo.setPositions([0, 0, 0, 0, 0, 0]);
  const selLineMat = new LineMaterial({
    color: 0xff8a00,
    linewidth: 2.4,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
    resolution,
  });
  const selLine = new Line2(selLineGeo, selLineMat);
  selLine.name = "chainageSelectedSegment";
  selLine.renderOrder = 25;
  selLine.visible = false;
  selLine.frustumCulled = false;
  group.add(selLine);

  group.userData.setResolution = (w, h) => {
    resolution.set(w, h);
    lineMat.resolution.set(w, h);
    selLineMat.resolution.set(w, h);
  };

  // DOM Overlays for Destination Markers
  const domContainer = document.createElement("div");
  domContainer.className = "chainage-dom-overlay";
  domContainer.style.position = "absolute";
  domContainer.style.top = "0";
  domContainer.style.left = "0";
  domContainer.style.width = "100%";
  domContainer.style.height = "100%";
  domContainer.style.pointerEvents = "none";
  domContainer.style.zIndex = "40";
  document.body.appendChild(domContainer);

  const destinationEls = [];
  for (const dest of CHAINAGE_DESTINATIONS) {
    const el = document.createElement("div");
    el.className = "chainage-destination-marker";
    el.hidden = true;
    el.innerHTML = `
      <div class="chainage-destination-banner">
        <div class="chainage-destination-name">${dest.name.toUpperCase()}</div>
        <div class="chainage-destination-dist"></div>
      </div>
    `;
    domContainer.appendChild(el);
    destinationEls.push({ dest, el });
  }

  const currentMarkerEl = document.createElement("div");
  currentMarkerEl.className = "chainage-current-marker";
  currentMarkerEl.hidden = true;
  currentMarkerEl.innerHTML = `
    <div class="chainage-current-pin"></div>
    <div style="font-size: 16px; margin-top: 2px; color: #ffc832; text-shadow: 0 0 4px #000;">◎</div>
  `;
  domContainer.appendChild(currentMarkerEl);

  function syncSelection() {
    const sel = state.selectedChainageMeters;
    if (sel == null) {
      selLine.visible = false;
      return;
    }
    const idx = points.findIndex((c) => Math.abs((c.meters ?? 0) - sel) < 0.5);
    if (idx < 0) {
      selLine.visible = false;
      return;
    }
    const p = points[idx];
    const a = points[Math.max(0, idx - 1)];
    const b = points[Math.min(points.length - 1, idx + 1)];
    if (a !== b) {
      selLineGeo.setPositions([a.x, LINE_Y + 0.05, a.z, p.x, LINE_Y + 0.05, p.z, b.x, LINE_Y + 0.05, b.z]);
      selLine.computeLineDistances();
      selLine.visible = true;
    } else {
      selLine.visible = false;
    }
  }

  function formatRelativeDistance(diff) {
    const sign = diff > 0 ? "+" : "";
    const absDiff = Math.abs(diff);
    if (absDiff >= 1000) {
      return `${sign}${(diff / 1000).toFixed(2)} km`;
    }
    return `${sign}${Math.round(diff)} m`;
  }

  const _v = new THREE.Vector3();
  const formatStation = metersToStation;
  function updateDomBanner(el, x, y, z, camera, distText, opts = {}) {
    if (!el || !camera) return;
    _v.set(x, y, z);
    _v.project(camera);
    // Behind camera or out of frustum depth
    if (_v.z > 1 || _v.z < -1) {
      el.hidden = true;
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sx = (_v.x * 0.5 + 0.5) * w;
    const sy = (1 - (_v.y * 0.5 + 0.5)) * h;
    const scale = Number.isFinite(opts.scale) ? opts.scale : 1;
    el.hidden = false;
    el.classList.toggle("is-arrived", !!opts.arrived);
    el.classList.toggle("is-near", !!opts.near && !opts.arrived);
    el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%) scale(${scale})`;

    if (distText !== undefined) {
      const distEl = el.querySelector('.chainage-destination-dist');
      if (distEl) distEl.textContent = distText;
    }
  }

  function update(camera) {
    const show = state.showChainage !== false;
    group.visible = show;
    if (!show || !camera) return;
    const camY = camera.position.y;
    const inspecting = state.selectedChainageMeters != null;
    const showMinors = camY < 2200 || inspecting;
    minorMesh.visible = showMinors;
    rimMesh.visible = true;
    majorMesh.visible = true;
    chainLine.visible = true;
    lineMat.linewidth = camY < 500 ? 2.4 : camY > 900 ? 2.2 : 1.95;
    syncSelection();

    // DOM UI for locations
    const isOverview = state.cameraMode === "overview";
    domContainer.hidden = !show || (!inspecting && !isOverview);

    if (show && (inspecting || isOverview)) {
      const sel = state.selectedChainageMeters;
      
      // Determine what to show (prev / next / arrived current)
      let prev = null;
      let next = null;
      let current = null;
      if (!isOverview && sel != null) {
        const dests = getDestinations(sel);
        prev = dests.prev;
        next = dests.next;
        current = dests.current;
      }

      // Update the 8 destination markers
      for (const item of destinationEls) {
        let shouldShow = false;
        let distText = "";
        let absDist = Infinity;

        if (isOverview) {
          shouldShow = true;
          distText = formatStation(item.dest.chainage_m);
        } else if (sel != null) {
          absDist = Math.abs(item.dest.chainage_m - sel);
          if (current && current.id === item.dest.id) {
            shouldShow = true;
            distText = formatStation(item.dest.chainage_m);
          } else if (prev && prev.id === item.dest.id) {
            shouldShow = true;
            distText = formatRelativeDistance(item.dest.chainage_m - sel);
          } else if (next && next.id === item.dest.id) {
            shouldShow = true;
            distText = formatRelativeDistance(item.dest.chainage_m - sel);
          }
        }

        if (shouldShow) {
          const destPoint = interpolateChainage(points, item.dest.chainage_m);
          if (destPoint) {
            // Grow a little as you approach; at the exact point go bigger (not only higher).
            let scale = 1;
            let arrived = false;
            let near = false;
            let labelY = DEST_LABEL_Y;
            if (!isOverview && Number.isFinite(absDist)) {
              if (absDist <= DEST_ARRIVED_M) {
                arrived = true;
                scale = 1.42;
                labelY = DEST_LABEL_Y_ARRIVED;
              } else if (absDist <= DEST_NEAR_M) {
                near = true;
                const t = 1 - (absDist - DEST_ARRIVED_M) / (DEST_NEAR_M - DEST_ARRIVED_M);
                scale = 1 + 0.42 * Math.max(0, Math.min(1, t));
                labelY = DEST_LABEL_Y + (DEST_LABEL_Y_ARRIVED - DEST_LABEL_Y) * Math.max(0, Math.min(1, t));
              }
            }
            updateDomBanner(item.el, destPoint.x, labelY, destPoint.z, camera, distText, {
              scale,
              arrived,
              near,
            });
          } else {
            item.el.hidden = true;
          }
        } else {
          item.el.hidden = true;
          item.el.classList.remove("is-arrived", "is-near");
        }
      }

      // Update the current selection marker
      if (sel != null && !isOverview) {
        const cur = interpolateChainage(points, sel);
        if (cur) {
          updateDomBanner(currentMarkerEl, cur.x, MARKER_Y + 0.05, cur.z, camera);
        } else {
          currentMarkerEl.hidden = true;
        }
      } else {
        currentMarkerEl.hidden = true;
      }
    }
  }

  function pick(raycaster, camera, maxDistM = 90) {
    if (!group.visible) return null;
    const hits = raycaster.intersectObjects([majorMesh, minorMesh], false);
    if (hits.length) {
      const h = hits[0];
      const list = h.object === majorMesh ? majorIndex : minorIndex;
      const p = list[h.instanceId];
      if (p) {
        state.selectedChainageMeters = p.meters;
        syncSelection();
        return p;
      }
    }
    if (camera) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURFACE_Y);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, hit)) {
        const near = nearestChainage(hit.x, hit.z, points);
        if (near && near.dist <= maxDistM) {
          state.selectedChainageMeters = near.meters;
          syncSelection();
          return near;
        }
      }
    }
    return null;
  }

  // No auto-select on load — panel / tip only after the user clicks a chainage
  syncSelection();

  console.info("Chainage markers", {
    total: points.length,
    major: majors.length,
    minor: minors.length,
    style: "white dashed · yellow majors · white minors",
  });
  return { group, update, pick, points };
}

function makeDiscGeometry(radius) {
  const geo = new THREE.CircleGeometry(radius, 28);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function formatChainageText(p, mode) {
  const m = Number(p.meters);
  const metersTxt = Number.isFinite(m) ? `${Math.round(m)} m` : "—";
  const station = p.label || metersToStation(p.meters);
  if (mode === "meters") return metersTxt;
  if (mode === "both") return `${station}  ·  ${metersTxt}`;
  return station;
}

export function metersToStation(meters) {
  const m = Math.max(0, Math.round(Number(meters) || 0));
  const km = Math.floor(m / 1000);
  const rem = m % 1000;
  return `${km}+${String(rem).padStart(3, "0")}`;
}

/** Nearest chainage label to a local XZ point. */
export function nearestChainage(x, z, chainage) {
  if (!chainage?.length) return null;
  let best = chainage[0];
  let bestD = Infinity;
  for (const c of chainage) {
    const d2 = (c.x - x) ** 2 + (c.z - z) ** 2;
    if (d2 < bestD) {
      bestD = d2;
      best = c;
    }
  }
  return { ...best, dist: Math.sqrt(bestD) };
}
