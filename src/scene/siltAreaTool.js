/**
 * 2D map tool: 4 clicked points → polygon → silt area analysis (siltAreaAnalysis.js).
 * Scene side only: numbered markers, polygon outline, clipped real silt raster, hotspot markers.
 * Analysis runs once after P4; nothing is computed on pointer move.
 */
import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { state } from "../state.js";
import { analyzeSiltPolygon } from "./siltAreaAnalysis.js";

/** Low, Moderate, High, Very High: fraction of the local water column (bed → WSE) filled by sediment. */
const SILT_SEVERITY_FACTOR = [0.1, 0.35, 0.7, 0.95];
const SILT_CLASS_COLORS = [0x2ecc40, 0xffd400, 0xff8c1a, 0xe02424];
const SURFACE_CLEARANCE_M = 0.03;

function sedimentTopY(bedY, factor) {
  const column = Math.max(0, SURFACE_Y - bedY);
  return Math.max(bedY, Math.min(bedY + column * factor, SURFACE_Y - SURFACE_CLEARANCE_M));
}

const MAX_POINTS = 4;
const POLY_COLOR = 0x00d8ff;
const LINE_Y = SURFACE_Y + 0.1;
const OVERLAY_Y = SURFACE_Y + 0.1;
/** On-screen sizes in CSS pixels (converted to world units per frame). */
const OUTLINE_PX = 1.5;
const MARKER_PX = 6;
const BADGE_PX = 20;
const tmpV = new THREE.Vector3();
const tmpUp = new THREE.Vector3();

function worldPerPixel(camera, at) {
  const h = window.innerHeight || 900;
  if (camera.isOrthographicCamera) return (camera.top - camera.bottom) / (camera.zoom || 1) / h;
  const d = camera.position.distanceTo(at);
  return (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov || 50) / 2)) / h;
}

/** Flat XZ ribbon along the ring (one quad per edge + square joints). */
function setRibbon(geo, ring, closed, width) {
  const pos = [];
  const idx = [];
  const hw = width / 2;
  const quad = (a, b, c, d) => {
    const i = pos.length / 3;
    pos.push(a.x, LINE_Y, a.z, b.x, LINE_Y, b.z, c.x, LINE_Y, c.z, d.x, LINE_Y, d.z);
    idx.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
  };
  const n = closed ? ring.length : ring.length - 1;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const ox = (-(q.z - p.z) / len) * hw;
    const oz = ((q.x - p.x) / len) * hw;
    quad({ x: p.x + ox, z: p.z + oz }, { x: p.x - ox, z: p.z - oz }, { x: q.x + ox, z: q.z + oz }, { x: q.x - ox, z: q.z - oz });
  }
  for (const p of ring) {
    quad({ x: p.x - hw, z: p.z - hw }, { x: p.x + hw, z: p.z - hw }, { x: p.x - hw, z: p.z + hw }, { x: p.x + hw, z: p.z + hw });
  }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
}

function getChainageM(x, z) {
  const chainage = window.__MM_SCENE__?.dataset?.chainage;
  if (!chainage || !chainage.length) return 0;
  let best = chainage[0];
  let minD = Infinity;
  for (const pt of chainage) {
    const d = Math.hypot(pt.x - x, pt.z - z);
    if (d < minD) { minD = d; best = pt; }
  }
  return best.meters;
}
function formatStation(meters) {
  const value = Math.max(0, Math.round(Number(meters) || 0));
  return Math.floor(value / 1000) + '+' + String(value % 1000).padStart(3, '0');
}

export function createSiltAreaTool() {
  const group = new THREE.Group();
  group.name = "siltAreaTool";
  group.visible = false;
  group.renderOrder = 45;

  const markerMat = new THREE.MeshBasicMaterial({
    color: POLY_COLOR,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });
  const markerGeo = new THREE.SphereGeometry(1.6, 14, 10);
  const markers = [];
  const labels = [];
  for (let i = 0; i < MAX_POINTS; i++) {
    const m = new THREE.Mesh(markerGeo, markerMat);
    m.visible = false;
    m.renderOrder = 47;
    m.frustumCulled = false;
    const s = makeBadgeSprite(`P${i + 1}`, "#ff4fd8");
    s.visible = false;
    markers.push(m);
    labels.push(s);
    group.add(m, s);
  }

  const edge = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0x00d8ff,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  for (const l of [edge]) {
    l.visible = false;
    l.frustumCulled = false;
    group.add(l);
  }
  edge.renderOrder = 46;
  let outlineRing = [];
  let outlineClosed = false;
  let outlineWpp = 0;
  let lastWpp = 0.5;

  /** @type {THREE.Mesh | null} */
  let overlay = null;
  /** @type {THREE.Mesh | null} */
  let mounds = null;
  const hotspotSprites = [];
  let selectedHotspot = null;

  const hoverMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false })
  );
  hoverMarker.visible = false;
  hoverMarker.renderOrder = 50;
  group.add(hoverMarker);

  /** @type {{x:number,z:number}[]} */
  let points = [];
  let active = false;
  let suspended = false;
  let result = null;
  let runId = 0;

  function emit(extra = {}) {
    document.dispatchEvent(new CustomEvent("silt-analysis-change", { detail: { ...snapshot(), ...extra } }));
  }

  function snapshot() {
    return {
      active,
      suspended,
      count: points.length,
      phase: !active ? "off" : points.length < MAX_POINTS ? "select" : result ? "done" : "analyzing",
      points: points.map((p, i) => ({ id: `P${i + 1}`, ...p })),
      result,
    };
  }

  function rebuildOutline(wpp) {
    outlineWpp = wpp;
    setRibbon(edge.geometry, outlineRing, outlineClosed, OUTLINE_PX * wpp);
  }

  function drawOutline(ring, closed) {
    outlineRing = ring.slice();
    outlineClosed = closed;
    if (ring.length < 2) {
      edge.visible = false;
      return;
    }
    rebuildOutline(lastWpp);
    edge.visible = true;
  }

  function clearOverlay() {
    try {
      window.__MM_SCENE__?.updateSiltWaterMode?.(false);
    } catch (e) {
      console.warn("Failed to clear water silt mode", e);
    }
    if (overlay) {
      group.remove(overlay);
      overlay.geometry.dispose();
      overlay.material.map?.dispose();
      overlay.material.dispose();
      overlay = null;
    }
    for (const s of hotspotSprites) {
      group.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
    hotspotSprites.length = 0;
    selectedHotspot = null;
  }

  function getDepthAt(x, z) {
    const bathyPts = window.__MM_SCENE__?.dataset?.points ?? [];
    if (!bathyPts.length) return 2.0;
    
    let best = bathyPts[0];
    let bestD2 = Infinity;
    // We must check a sufficient number of points without skipping the local cluster.
    // Since this runs per vertex, we use a simple distance threshold.
    for (let i = 0; i < bathyPts.length; i += 2) {
      const p = bathyPts[i];
      if (Math.abs(p.x - x) > 300 || Math.abs(p.z - z) > 300) continue;
      const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = p; }
    }
    // Fallback if absolutely no points found within 300m
    if (bestD2 === Infinity) return 2.0;
    return best.depth;
  }

  function buildOverlay(clip) {
    try {
      window.__MM_SCENE__?.updateSiltWaterMode?.(true, points);
    } catch (e) {
      console.warn("Failed to update water silt mode", e);
    }
    overlay = new THREE.Group();
    
    const cw = clip.width;
    const ch = clip.height;
    const { nw, ne, sw, se } = clip.corners;
    
    const vPos = [];
    const vColor = [];
    const indices = [];
    
    
    const valid = new Uint8Array(cw * ch);
    const topY = new Float32Array(cw * ch);
    const botY = new Float32Array(cw * ch);
    
    const rawFactor = new Float32Array(cw * ch);
    const rawR = new Float32Array(cw * ch);
    const rawG = new Float32Array(cw * ch);
    const rawB = new Float32Array(cw * ch);
    const ptX = new Float32Array(cw * ch);
    const ptZ = new Float32Array(cw * ch);
    
    const colors = SILT_CLASS_COLORS.map((c) => new THREE.Color(c));
    const defaultColor = new THREE.Color(0x4a4036);
    
    // Pass 1: Extract Data
    for (let iy = 0; iy < ch; iy++) {
      for (let ix = 0; ix < cw; ix++) {
        const k = iy * cw + ix;
        const alpha = clip.data[k * 4 + 3];
        if (alpha > 0) valid[k] = 1;
        
        const u = cw > 1 ? ix / (cw - 1) : 0;
        const v = ch > 1 ? iy / (ch - 1) : 0;
        
        const x = (1 - v) * ((1 - u) * nw.x + u * ne.x) + v * ((1 - u) * sw.x + u * se.x);
        const z = (1 - v) * ((1 - u) * nw.z + u * ne.z) + v * ((1 - u) * sw.z + u * se.z);
        
        const bedY = SURFACE_Y - getDepthAt(x, z);
        let severity = 0.0;
        let col = defaultColor;
        
        if (alpha >= 195) {
          const clsIdx = Math.round((alpha - 200) / 10);
          if (clsIdx >= 0 && clsIdx <= 3) {
            severity = SILT_SEVERITY_FACTOR[clsIdx];
            col = colors[clsIdx];
          }
        }
        
        botY[k] = bedY;
        rawFactor[k] = severity;
        
        rawR[k] = col.r;
        rawG[k] = col.g;
        rawB[k] = col.b;
        
        ptX[k] = x;
        ptZ[k] = z;
      }
    }
    
    // Pass 2: Smooth severity fraction & color
    const blurRadius = 2; // Smooths the stepped pixel boundaries
    for (let iy = 0; iy < ch; iy++) {
      for (let ix = 0; ix < cw; ix++) {
        const k = iy * cw + ix;
        
        let sumFactor = 0, sumR = 0, sumG = 0, sumB = 0, weight = 0;
        for (let dy = -blurRadius; dy <= blurRadius; dy++) {
          for (let dx = -blurRadius; dx <= blurRadius; dx++) {
            const nx = ix + dx;
            const ny = iy + dy;
            if (nx >= 0 && nx < cw && ny >= 0 && ny < ch) {
              const nk = ny * cw + nx;
              if (valid[nk]) {
                const w = 1.0 / (1.0 + dx*dx + dy*dy);
                sumFactor += rawFactor[nk] * w;
                sumR += rawR[nk] * w;
                sumG += rawG[nk] * w;
                sumB += rawB[nk] * w;
                weight += w;
              }
            }
          }
        }
        
        // If entirely outside valid region, weight is 0. Keep original.
        const factor = weight > 0 ? sumFactor / weight : rawFactor[k];
        topY[k] = sedimentTopY(botY[k], factor);
        if (weight > 0) {
          vPos.push(ptX[k], topY[k], ptZ[k]);
          vColor.push(sumR / weight, sumG / weight, sumB / weight);
        } else {
          vPos.push(ptX[k], topY[k], ptZ[k]);
          vColor.push(rawR[k], rawG[k], rawB[k]);
        }
      }
    }
    
    const offset = cw * ch;
    
    for (let iy = 0; iy < ch; iy++) {
      for (let ix = 0; ix < cw; ix++) {
        const k = iy * cw + ix;
        // Bottom Vertex
        vPos.push(ptX[k], botY[k], ptZ[k]);
        // Darken bottom vertices
        vColor.push(rawR[k] * 0.4, rawG[k] * 0.4, rawB[k] * 0.4);
      }
    }
    
    const isQuadDrawn = (qx, qy) => {
      if (qx < 0 || qx >= cw - 1 || qy < 0 || qy >= ch - 1) return false;
      const k00 = qy * cw + qx;
      const k10 = k00 + 1;
      const k01 = (qy + 1) * cw + qx;
      const k11 = k01 + 1;
      return valid[k00] && valid[k10] && valid[k01] && valid[k11];
    };

    for (let iy = 0; iy < ch - 1; iy++) {
      for (let ix = 0; ix < cw - 1; ix++) {
        if (!isQuadDrawn(ix, iy)) continue;
        
        const k00 = iy * cw + ix;
        const k10 = k00 + 1;
        const k01_idx = (iy + 1) * cw + ix;
        const k11_idx = k01_idx + 1;
        
        // TOP FACES
        indices.push(k00, k01_idx, k10);
        indices.push(k10, k01_idx, k11_idx);
        
        // BOTTOM FACES
        indices.push(offset + k00, offset + k10, offset + k01_idx);
        indices.push(offset + k10, offset + k11_idx, offset + k01_idx);
        
        // WALLS
        if (!isQuadDrawn(ix - 1, iy)) {
          indices.push(k00, offset + k00, k01_idx);
          indices.push(k01_idx, offset + k00, offset + k01_idx);
        }
        if (!isQuadDrawn(ix + 1, iy)) {
          indices.push(k11_idx, offset + k11_idx, k10);
          indices.push(k10, offset + k11_idx, offset + k10);
        }
        if (!isQuadDrawn(ix, iy - 1)) {
          indices.push(k10, offset + k10, k00);
          indices.push(k00, offset + k10, offset + k00);
        }
        if (!isQuadDrawn(ix, iy + 1)) {
          indices.push(k01_idx, offset + k01_idx, k11_idx);
          indices.push(k11_idx, offset + k01_idx, offset + k11_idx);
        }
      }
    }
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vPos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(vColor, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: false,
      opacity: 1.0,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      roughness: 0.82,
      metalness: 0.0
    });
    
    mounds = new THREE.Mesh(geo, mat);
    mounds.frustumCulled = false;
    overlay.add(mounds);
    
    group.add(overlay);
  }

  function buildHotspots(list) {
    for (const h of list) {
      const s = makeBadgeSprite(h.id, h.dominant === "Very High" ? "#E74C3C" : "#F39C12");
      const d = getDepthAt(h.x, h.z);
      
      const clsIdx = ["Low", "Moderate", "High", "Very High"].indexOf(h.dominant);
      const topY = sedimentTopY(SURFACE_Y - d, SILT_SEVERITY_FACTOR[Math.max(0, clsIdx)]);
      
      s.position.set(h.x, topY + 0.3, h.z); // 0.3m visual offset
      s.userData.hotspot = h;
      s.renderOrder = 48;
      hotspotSprites.push(s);
      group.add(s);
    }
  }

  async function runAnalysis() {
    const id = ++runId;
    emit();
    const scene = window.__MM_SCENE__;
    try {
      const res = await analyzeSiltPolygon(points, {
        classPeriod: scene?.getSiltClassificationPeriod?.() ?? undefined,
        volumePeriod: scene?.getSiltVolumePeriod?.() ?? undefined,
        dataset: scene?.dataset ?? undefined,
      });
      if (id !== runId || !active) return;
      result = res;
      drawOutline(res.ring, true);
      if (res.clip) buildOverlay(res.clip);
      if (res.hotspots?.length) buildHotspots(res.hotspots);
      
      // Frame the camera
      if (points.length >= 3 && window.__MM_SCENE__?.cameraSystem?.setPose) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of points) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;
        const diag = Math.hypot(maxX - minX, maxZ - minZ);
        
        const dist = Math.max(diag * 1.5, 50); // don't zoom in closer than 50m
        // 45 degree angle means y = dist * sin(45), offset = dist * cos(45)
        const yOff = dist * 0.707;
        const zOff = dist * 0.707;
        window.__MM_SCENE__.cameraSystem.setPose(
          new THREE.Vector3(cx, SURFACE_Y + yOff, cz + zOff),
          new THREE.Vector3(cx, SURFACE_Y, cz)
        );
      }
      
      emit();
    } catch (err) {
      if (id !== runId) return;
      console.warn("[silt-analysis] failed", err);
      result = { available: false, reason: "Silt dataset unavailable", error: String(err?.message || err) };
      emit();
    }
  }

  function addPoint(x, z) {
    if (!active || suspended || points.length >= MAX_POINTS) return snapshot();
    const i = points.length;
    points.push({ x, z });
    markers[i].position.set(x, LINE_Y, z);
    
    const m = getChainageM(x, z);
    const lbl = `P${i + 1}\nCH ${formatStation(m)}`;
    if (labels[i]) {
      group.remove(labels[i]);
      labels[i].material.map?.dispose();
      labels[i].material.dispose();
    }
    const s = makeBadgeSprite(lbl, "#00d8ff");
    s.position.set(x, LINE_Y + 15, z);
    s.renderOrder = 47;
    labels[i] = s;
    group.add(s);
    
    markers[i].visible = true;
    
    labels[i].visible = true;
    drawOutline(points, false);
    if (points.length === MAX_POINTS) void runAnalysis();
    else emit();
    return snapshot();
  }

  function reset({ silent = false } = {}) {
    runId++;
    points = [];
    result = null;
    for (const m of markers) m.visible = false;
    for (const l of labels) l.visible = false;
    edge.visible = false;
    outlineRing = [];
    clearOverlay();
    hoverMarker.visible = false;
    if (!silent) emit();
  }

  function syncState() {
    if (active && !suspended) state.active2DAnalysis = "silt";
    else if (state.active2DAnalysis === "silt") state.active2DAnalysis = null;
    group.visible = active && !suspended;
  }

  function setActive(on) {
    const next = !!on;
    active = next;
    suspended = false;
    syncState();
    if (!next) reset({ silent: true });
    emit();
  }

  /** Leaving 2D keeps points/results but hides them; returning to 2D restores the same analysis. */
  function setSuspended(on) {
    const next = !!on && active;
    if (next === suspended) return;
    suspended = next;
    syncState();
    emit();
  }

  /** @param {THREE.Raycaster} raycaster */
  function pickHotspot(raycaster) {
    if (!hotspotSprites.length) return null;
    const hit = raycaster.intersectObjects(hotspotSprites, false)[0];
    return hit ? hit.object.userData.hotspot : null;
  }

  function pickVolume(raycaster) {
    if (!active || suspended || !mounds || !result?.clip) return null;
    const hit = raycaster.intersectObject(mounds, false)[0];
    if (!hit) return null;
    
    // Convert world X,Z to clip texture coordinates
    const clip = result.clip;
    const { nw, se } = clip.corners;
    const tX = (hit.point.x - nw.x) / (se.x - nw.x);
    const tY = (hit.point.z - nw.z) / (se.z - nw.z);
    if (tX < 0 || tX >= 1 || tY < 0 || tY >= 1) return null;
    
    const px = Math.floor(tX * clip.width);
    const py = Math.floor(tY * clip.height);
    const idx = (py * clip.width + px) * 4;
    
    if (clip.data[idx + 3] === 0) return null;
    
    // Classify using the class definitions from siltAreaAnalysis.js (or approximated)
    const r = clip.data[idx], g = clip.data[idx+1], b = clip.data[idx+2];
    let label = "Unknown", col = "transparent";
    if (r > 200 && g < 100) { label = "Very High"; col = "#ef4444"; }
    else if (r > 200 && g > 100 && g < 200) { label = "High"; col = "#f97316"; }
    else if (r > 200 && g > 200) { label = "Moderate"; col = "#eab308"; }
    else if (g > 150) { label = "Low"; col = "#22c55e"; }
    else return null;

    return {
      wx: hit.point.x,
      wz: hit.point.z,
      label,
      color: col
    };
  }

  function selectHotspot(id) {
    selectedHotspot = id || null;
    for (const s of hotspotSprites) {
      s.userData.selected = s.userData.hotspot.id === selectedHotspot;
    }
    const h = result?.hotspots?.find((x) => x.id === selectedHotspot) || null;
    document.dispatchEvent(new CustomEvent("silt-hotspot-select", { detail: h }));
    return h;
  }

  function setHoverMarker(wx, wz) {
    const d = getDepthAt(wx, wz);
    hoverMarker.position.set(wx, Math.min(SURFACE_Y - d + 2.0, SURFACE_Y - 0.2), wz);
    hoverMarker.visible = true;
  }

  function removeHoverMarker() {
    hoverMarker.visible = false;
  }

  function update(camera) {
    if (!group.visible || !camera) return;
    const ref = outlineRing[0] ? tmpV.set(outlineRing[0].x, LINE_Y, outlineRing[0].z) : camera.position;
    const wpp = worldPerPixel(camera, ref);
    if (!(wpp > 0)) return;
    lastWpp = wpp;
    if (edge.visible && Math.abs(wpp - outlineWpp) > outlineWpp * 0.08) rebuildOutline(wpp);
    const up = tmpUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    up.y = 0;
    if (up.lengthSq() < 1e-6) up.set(0, 0, -1);
    up.normalize().multiplyScalar(BADGE_PX * 1.1 * wpp);
    for (let i = 0; i < MAX_POINTS; i++) {
      if (!markers[i].visible) continue;
      const m = markers[i].position;
      markers[i].scale.setScalar((MARKER_PX * wpp) / 1.6);
      labels[i].scale.set(BADGE_PX * 2 * wpp, BADGE_PX * wpp, 1);
      labels[i].position.set(m.x + up.x, LINE_Y, m.z + up.z);
    }
    for (const s of hotspotSprites) {
      const k = BADGE_PX * wpp * (s.userData.selected ? 1.3 : 1);
      s.scale.set(k * 2, k, 1);
      // Lift hotspots along with the block
      const targetBaseY = Math.min(SURFACE_Y - getDepthAt(s.userData.hotspot.x, s.userData.hotspot.z) + 2.0, SURFACE_Y - 0.2);
      s.position.y = targetBaseY + (overlay ? overlay.userData.popupCurrentY : 0);
    }
    
    // Animate block popup
    if (overlay) {
      const target = overlay.userData.popupTargetY || 0;
      let curr = overlay.userData.popupCurrentY || 0;
      if (Math.abs(target - curr) > 0.01) {
        curr += (target - curr) * 0.1;
        overlay.userData.popupCurrentY = curr;
        overlay.position.y = curr;
      }
    }
  }

  return {
    group,
    setActive,
    addPoint,
    reset: () => reset(),
    pickHotspot, pickVolume,
    selectHotspot,
    setHoverMarker, removeHoverMarker,
    update,
    setSuspended,
    setCutaway: (on) => {
      const riverMat = window.__MM_SCENE__?.river?.mesh?.material;
      if (!riverMat) return;
      if (!on || points.length < 3) {
        riverMat.clippingPlanes = null;
        riverMat.clipIntersection = false;
        if (overlay) {
          overlay.userData.popupTargetY = 0;
        }
        return;
      }
      
      const planes = [];
      for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const normal = new THREE.Vector3(-dz, 0, dx).normalize();
        
        const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
        const cz = points.reduce((s, p) => s + p.z, 0) / points.length;
        const toCenter = new THREE.Vector3(cx - p1.x, 0, cz - p1.z);
        if (normal.dot(toCenter) > 0) normal.negate();
        planes.push(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(p1.x, 0, p1.z)));
      }
      riverMat.clipIntersection = true;
      riverMat.clippingPlanes = planes;
      
      if (overlay) {
        overlay.userData.popupTargetY = 15; // Pop up by 15 meters
      }
    },
    editSiltAnalysis: () => {
      reset({ silent: true });
      hintEl && (hintEl.hidden = false); // this should be handled by event listener
      emit();
    },
    isActive: () => active,
    isAccepting: () => active && !suspended && points.length < MAX_POINTS,
    getSnapshot: snapshot,
  };
}

function makeBadgeSprite(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.roundRect(6, 6, 116, 52, 24);
  ctx.fillStyle = "rgba(10, 14, 24, 0.9)";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = text.split("\n");
  if (lines.length > 1) {
    ctx.font = "800 24px Inter, system-ui, sans-serif";
    ctx.fillText(lines[0], 64, 24);
    ctx.font = "600 16px Inter, system-ui, sans-serif";
    ctx.fillText(lines[1], 64, 46);
  } else {
    ctx.font = "800 32px Inter, system-ui, sans-serif";
    ctx.fillText(text, 64, 34);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }),
  );
  spr.renderOrder = 48;
  spr.frustumCulled = false;
  spr.scale.set(12, 6, 1);
  return spr;
}
