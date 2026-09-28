/**
 * 2D map tool: 4 clicked points → polygon → silt area analysis (siltAreaAnalysis.js).
 * Scene side only: numbered markers, polygon outline, clipped real silt raster, hotspot markers.
 * Analysis runs once after P4; nothing is computed on pointer move.
 */
import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { state } from "../state.js";
import { analyzeSiltPolygon } from "./siltAreaAnalysis.js";

const MAX_POINTS = 4;
const POLY_COLOR = 0xff4fd8;
const LINE_Y = SURFACE_Y + 2.2;
const OVERLAY_Y = SURFACE_Y + 1.4;
/** On-screen sizes in CSS pixels (converted to world units per frame). */
const OUTLINE_PX = 3;
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

  const halo = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: 0x14061a,
      transparent: true,
      opacity: 0.75,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const edge = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: POLY_COLOR,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  for (const l of [halo, edge]) {
    l.visible = false;
    l.frustumCulled = false;
    group.add(l);
  }
  halo.renderOrder = 45;
  edge.renderOrder = 46;
  let outlineRing = [];
  let outlineClosed = false;
  let outlineWpp = 0;
  let lastWpp = 0.5;

  /** @type {THREE.Mesh | null} */
  let overlay = null;
  const hotspotSprites = [];
  let selectedHotspot = null;

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
    setRibbon(halo.geometry, outlineRing, outlineClosed, OUTLINE_PX * 2.2 * wpp);
    setRibbon(edge.geometry, outlineRing, outlineClosed, OUTLINE_PX * wpp);
  }

  function drawOutline(ring, closed) {
    outlineRing = ring.slice();
    outlineClosed = closed;
    if (ring.length < 2) {
      halo.visible = edge.visible = false;
      return;
    }
    rebuildOutline(lastWpp);
    halo.visible = edge.visible = true;
  }

  function clearOverlay() {
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

  function buildOverlay(clip) {
    const canvas = document.createElement("canvas");
    canvas.width = clip.width;
    canvas.height = clip.height;
    canvas.getContext("2d").putImageData(new ImageData(clip.data, clip.width, clip.height), 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const { nw, ne, sw, se } = clip.corners;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [nw.x, OVERLAY_Y, nw.z, ne.x, OVERLAY_Y, ne.z, sw.x, OVERLAY_Y, sw.z, se.x, OVERLAY_Y, se.z],
        3,
      ),
    );
    geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    overlay = new THREE.Mesh(geo, mat);
    overlay.renderOrder = 44;
    overlay.frustumCulled = false;
    group.add(overlay);
  }

  function buildHotspots(list) {
    for (const h of list) {
      const s = makeBadgeSprite(h.id, h.dominant === "Very High" ? "#E74C3C" : "#F39C12");
      s.position.set(h.x, LINE_Y + 2.5, h.z);
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
      });
      if (id !== runId || !active) return;
      result = res;
      drawOutline(res.ring, true);
      if (res.clip) buildOverlay(res.clip);
      if (res.hotspots?.length) buildHotspots(res.hotspots);
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
    markers[i].visible = true;
    labels[i].position.set(x, LINE_Y + 3.4, z);
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
    halo.visible = edge.visible = false;
    outlineRing = [];
    clearOverlay();
    if (!silent) emit();
  }

  function syncState() {
    if (active && !suspended) state.active2DAnalysis = "silt";
    else if (state.active2DAnalysis === "silt") state.active2DAnalysis = null;
    group.visible = active && !suspended;
  }

  function setActive(on) {
    const next = !!on;
    if (next === active) return;
    active = next;
    suspended = false;
    syncState();
    reset({ silent: true });
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

  function selectHotspot(id) {
    selectedHotspot = id || null;
    for (const s of hotspotSprites) {
      s.userData.selected = s.userData.hotspot.id === selectedHotspot;
    }
    const h = result?.hotspots?.find((x) => x.id === selectedHotspot) || null;
    document.dispatchEvent(new CustomEvent("silt-hotspot-select", { detail: h }));
    return h;
  }

  function update(camera) {
    if (!group.visible || !camera) return;
    const ref = outlineRing[0] ? tmpV.set(outlineRing[0].x, LINE_Y, outlineRing[0].z) : camera.position;
    const wpp = worldPerPixel(camera, ref);
    if (!(wpp > 0)) return;
    lastWpp = wpp;
    if (halo.visible && Math.abs(wpp - outlineWpp) > outlineWpp * 0.08) rebuildOutline(wpp);
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
    }
  }

  return {
    group,
    setActive,
    addPoint,
    reset: () => reset(),
    pickHotspot,
    selectHotspot,
    update,
    setSuspended,
    isActive: () => active,
    isAccepting: () => active && !suspended,
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
  ctx.font = "800 32px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 64, 34);
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
