/**
 * Garbage visuals — readable 3D waste piles + ground ring + focus beacon.
 * Selected / tour sites always show a clear pile (not just a flat disc).
 */
import * as THREE from "three";
import { LOD, markerScaleForCamera } from "./garbageLOD.js";

const AMBER = "#E89A1C";
const AMBER_LIGHT = "#FFE08A";
const DEBRIS = "#8B7355";
const PLASTIC = "#C4D4E0";

export function createGarbageRenderer() {
  const root = new THREE.Group();
  root.name = "garbageRenderer";
  root.frustumCulled = false;

  const markers = new THREE.Group();
  markers.name = "garbageMarkers";
  const debris = new THREE.Group();
  debris.name = "garbageDebris";
  const densityGroup = new THREE.Group();
  densityGroup.name = "garbageDensity";
  densityGroup.visible = false;
  root.add(markers, debris, densityGroup);

  // Compact ground ring — secondary cue; pile is primary
  const discGeo = new THREE.CircleGeometry(4.2, 28);
  discGeo.rotateX(-Math.PI / 2);
  const rimGeo = new THREE.RingGeometry(4.0, 5.4, 28);
  rimGeo.rotateX(-Math.PI / 2);
  const coreGeo = new THREE.CircleGeometry(1.4, 16);
  coreGeo.rotateX(-Math.PI / 2);

  const fillMat = new THREE.MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const rimMat = new THREE.MeshBasicMaterial({
    color: AMBER_LIGHT,
    transparent: true,
    opacity: 0.75,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const coreMat = new THREE.MeshBasicMaterial({
    color: "#fff6d8",
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const selectMat = new THREE.MeshBasicMaterial({
    color: "#FF6B2C",
    transparent: true,
    opacity: 0.7,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const boxGeo = new THREE.BoxGeometry(1.6, 1.0, 1.2);
  const bagGeo = new THREE.SphereGeometry(1.0, 10, 8);
  bagGeo.scale(1.4, 0.75, 1.15);
  const bottleGeo = new THREE.CylinderGeometry(0.25, 0.32, 1.3, 8);
  const crateGeo = new THREE.BoxGeometry(2.1, 1.25, 1.6);
  const poleGeo = new THREE.CylinderGeometry(0.2, 0.26, 12, 8);
  const flagGeo = new THREE.BoxGeometry(3.6, 1.8, 0.14);

  const debrisMat = new THREE.MeshStandardMaterial({
    color: DEBRIS,
    roughness: 0.92,
    metalness: 0.05,
    flatShading: true,
  });
  const plasticMat = new THREE.MeshStandardMaterial({
    color: PLASTIC,
    roughness: 0.55,
    metalness: 0.08,
    flatShading: true,
  });
  const bagMat = new THREE.MeshStandardMaterial({
    color: "#5a6b4a",
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: "#E89A1C",
    roughness: 0.45,
    metalness: 0.12,
    flatShading: true,
    emissive: "#E89A1C",
    emissiveIntensity: 0.18,
  });
  const poleMat = new THREE.MeshBasicMaterial({
    color: "#FFB347",
    depthTest: false,
    depthWrite: false,
  });
  const flagMat = new THREE.MeshBasicMaterial({
    color: "#FF6B2C",
    depthTest: false,
    depthWrite: false,
  });

  /** @type {{ record:object, marker:THREE.Group, debris:THREE.Group|null, beacon:THREE.Group|null, baseY:number, fill?:THREE.Mesh, label?:THREE.Sprite }[]} */
  let entries = [];
  let selectedId = null;
  let showDensity = false;
  let labelsEnabled = false;
  /** @type {null | 'LOW' | 'MEDIUM' | 'HIGH' | 'ALL'} */
  let classFilter = null;
  /** @type {string|null} */
  let sideFilter = null;

  function sitePassesFilter(e) {
    if (sideFilter && String(e.record.sideId || "") !== sideFilter) return false;
    if (!classFilter || classFilter === "ALL") return true;
    return String(e.record.densityLevel || "").toUpperCase() === classFilter;
  }

  function syncVisibility() {
    for (const e of entries) {
      const pass = sitePassesFilter(e);
      e.marker.userData.filteredOut = !pass;
      if (!pass) {
        e.marker.visible = false;
        if (e.debris) e.debris.visible = false;
        if (e.beacon) e.beacon.visible = false;
        if (e.label) e.label.visible = false;
      }
    }
    for (const child of densityGroup.children) {
      const level = String(child.userData?.level || "").toUpperCase();
      child.visible = !classFilter || classFilter === "ALL" || level === classFilter;
    }
  }

  function setLabelsEnabled(v) {
    labelsEnabled = !!v;
  }

  function setClassFilter(level) {
    const raw = String(level || "").toUpperCase();
    if (!raw || raw === "ALL" || raw.includes("GARBAGE")) classFilter = "ALL";
    else if (raw.includes("HIGH")) classFilter = "HIGH";
    else if (raw.includes("MED")) classFilter = "MEDIUM";
    else if (raw.includes("LOW")) classFilter = "LOW";
    else classFilter = "ALL";
    syncVisibility();
  }

  function setSideFilter(sideId) {
    sideFilter = sideId ? String(sideId) : null;
    syncVisibility();
  }

  function build(records) {
    clear();
    entries = [];

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const marker = new THREE.Group();
      marker.name = `garbageMarker_${r.id}`;
      marker.userData.recordId = r.id;
      marker.frustumCulled = false;
      marker.renderOrder = 42;

      const fill = new THREE.Mesh(discGeo, fillMat);
      fill.position.y = 0.05;
      fill.renderOrder = 43;
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.y = 0.04;
      rim.renderOrder = 42;
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.y = 0.08;
      core.renderOrder = 44;
      marker.add(rim, fill, core);

      const label = makeSiteLabel(siteDisplayName(r), siteChainageLabel(r));
      label.position.set(0, 14, 0);
      label.visible = false;
      marker.add(label);

      marker.position.set(r.homeX, r.baseY, r.homeZ);
      markers.add(marker);

      const debrisG = buildDebrisCluster(r);
      debrisG.visible = true;
      debrisG.position.set(r.homeX, r.baseY, r.homeZ);
      debris.add(debrisG);

      const beacon = buildBeacon();
      beacon.visible = false;
      beacon.position.set(r.homeX, r.baseY, r.homeZ);
      markers.add(beacon);

      entries.push({
        record: r,
        marker,
        debris: debrisG,
        beacon,
        baseY: r.baseY,
        fill,
        label,
      });
    }
  }

  /** Readable low-poly waste pile — visible from tour camera distance. */
  function buildDebrisCluster(r) {
    const g = new THREE.Group();
    g.name = `garbageDebris_${r.id}`;
    g.userData.recordId = r.id;
    const phase = r.phase || 0;
    const n = 7 + (r.sourceIndex % 4);

    // Base heap mound
    const mound = new THREE.Mesh(bagGeo, bagMat);
    mound.position.set(0, 0.55, 0);
    mound.scale.set(2.4, 1.5, 2.2);
    g.add(mound);

    for (let k = 0; k < n; k++) {
      const kind = k % 4;
      let mesh;
      if (kind === 0) mesh = new THREE.Mesh(crateGeo, debrisMat);
      else if (kind === 1) mesh = new THREE.Mesh(bagGeo, bagMat);
      else if (kind === 2) mesh = new THREE.Mesh(boxGeo, accentMat);
      else mesh = new THREE.Mesh(bottleGeo, plasticMat);

      const a = (k / n) * Math.PI * 2 + phase;
      const rad = 1.2 + (k % 4) * 0.55;
      mesh.position.set(
        Math.cos(a) * rad,
        0.45 + (k % 3) * 0.55,
        Math.sin(a) * rad,
      );
      mesh.rotation.set(phase * 0.25 + k * 0.2, a, phase * 0.15);
      mesh.scale.setScalar(1.15 + (k % 3) * 0.25);
      mesh.castShadow = false;
      g.add(mesh);
    }

    // Overall pile scale so it reads from ~40–80 m
    g.scale.setScalar(2.6);
    return g;
  }

  function buildBeacon() {
    const g = new THREE.Group();
    g.name = "garbageBeacon";
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 6;
    pole.renderOrder = 50;
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(1.9, 11.2, 0);
    flag.renderOrder = 51;
    g.add(pole, flag);
    return g;
  }

  function setDensityCells(cells) {
    while (densityGroup.children.length) {
      const c = densityGroup.children.pop();
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    if (!cells?.length) return;
    const geo = new THREE.CircleGeometry(28, 20);
    geo.rotateX(-Math.PI / 2);
    for (const cell of cells) {
      const color =
        cell.level === "HIGH" ? "#C0392B" : cell.level === "MEDIUM" ? "#E67E22" : "#F1C40F";
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18 + Math.min(0.28, cell.count * 0.04),
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(cell.x, SURFACE_APPROX, cell.z);
      m.renderOrder = 12;
      m.userData.level = cell.level;
      densityGroup.add(m);
    }
    syncVisibility();
  }

  const SURFACE_APPROX = 9.55;

  function setShowDensity(v) {
    showDensity = !!v;
    densityGroup.visible = showDensity;
  }

  function setSelected(id) {
    selectedId = id;
    for (const e of entries) {
      const on = e.record.id === id;
      if (e.fill) e.fill.material = on ? selectMat : fillMat;
      if (e.beacon) e.beacon.visible = on && !e.marker.userData.filteredOut;
    }
  }

  function applyLOD(lod, camera, selected = selectedId) {
    const boost = markerScaleForCamera(camera);
    const camY = camera?.position?.y ?? 800;
    const showDebrisFar = lod === LOD.FAR || lod === LOD.MEDIUM;

    for (const e of entries) {
      if (e.marker.userData.filteredOut) {
        e.marker.visible = false;
        if (e.debris) e.debris.visible = false;
        if (e.beacon) e.beacon.visible = false;
        if (e.label) e.label.visible = false;
        continue;
      }

      const isSel = e.record.id === selected;
      // Always keep a ring for context; shrink when focused on pile
      e.marker.visible = true;
      const ringScale = boost * (isSel ? 0.85 : 1.0);
      e.marker.scale.set(ringScale, ringScale, ringScale);

      // Waste pile: always on for selected; otherwise at near/medium
      if (e.debris) {
        const showPile = isSel || !showDebrisFar || lod === LOD.NEAR || lod === LOD.VERY_NEAR;
        e.debris.visible = showPile;
        const pileScale = isSel ? 3.4 : showDebrisFar ? 1.8 : 2.4;
        e.debris.scale.setScalar(pileScale);
      }

      if (e.beacon) {
        e.beacon.visible = isSel;
        e.beacon.scale.setScalar(isSel ? 1.15 : 1);
      }

      if (e.label) {
        e.label.visible = labelsEnabled && isSel;
        const ls = THREE.MathUtils.clamp(camY * 0.016, 7, 22);
        e.label.scale.set(ls * 1.35, ls * 0.4, 1);
        e.label.position.y = 16 + Math.min(10, camY * 0.01);
      }
    }
  }

  function getEntry(id) {
    return entries.find((e) => e.record.id === id) || null;
  }

  function getEntries() {
    return entries;
  }

  function clear() {
    for (const e of entries) {
      disposeLabel(e.label);
    }
    while (markers.children.length) markers.remove(markers.children[0]);
    while (debris.children.length) debris.remove(debris.children[0]);
    entries = [];
  }

  function dispose() {
    clear();
    while (densityGroup.children.length) {
      const c = densityGroup.children.pop();
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    for (const g of [
      discGeo,
      rimGeo,
      coreGeo,
      boxGeo,
      bagGeo,
      bottleGeo,
      crateGeo,
      poleGeo,
      flagGeo,
    ]) {
      g.dispose();
    }
    for (const m of [
      fillMat,
      rimMat,
      coreMat,
      selectMat,
      debrisMat,
      plasticMat,
      bagMat,
      accentMat,
      poleMat,
      flagMat,
    ]) {
      m.dispose();
    }
  }

  return {
    root,
    build,
    setDensityCells,
    setShowDensity,
    getShowDensity: () => showDensity,
    setLabelsEnabled,
    getLabelsEnabled: () => labelsEnabled,
    setClassFilter,
    getClassFilter: () => classFilter,
    setSideFilter,
    getSideFilter: () => sideFilter,
    setSelected,
    applyLOD,
    getEntry,
    getEntries,
    dispose,
  };
}

function siteDisplayName(r) {
  const raw = String(r?.name || "").trim();
  if (raw && !/^\d+$/.test(raw)) return raw;
  const n = raw || String(r?.sourceIndex != null ? r.sourceIndex + 1 : r?.id || "?");
  return `Site ${n}`;
}

function siteChainageLabel(r) {
  const m = Number(r?.riverChainageMeters);
  if (!Number.isFinite(m)) return "";
  const km = Math.floor(m / 1000);
  const rem = Math.round(m % 1000);
  return `CH ${km}+${String(rem).padStart(3, "0")}`;
}

function makeSiteLabel(title, subtitle) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const sprMat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const spr = new THREE.Sprite(sprMat);
  spr.userData.canvas = canvas;
  spr.renderOrder = 55;
  spr.frustumCulled = false;
  spr.center.set(0.5, 0);
  paintSiteLabel(spr, title, subtitle);
  spr.scale.set(42, 13, 1);
  return spr;
}

function paintSiteLabel(spr, title, subtitle) {
  const canvas = spr.userData.canvas || spr.material.map?.image;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const pad = 18;
  roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, 22);
  ctx.fillStyle = "rgba(8, 16, 24, 0.88)";
  ctx.fill();
  ctx.strokeStyle = "rgba(232, 154, 28, 0.95)";
  ctx.lineWidth = 6;
  roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, 22);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#fff6e0";
  ctx.font = "800 52px Inter, system-ui, sans-serif";
  ctx.fillText(String(title || "Site").slice(0, 28), w / 2, subtitle ? h * 0.42 : h * 0.52);
  if (subtitle) {
    ctx.fillStyle = "rgba(255, 214, 150, 0.95)";
    ctx.font = "700 34px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.fillText(String(subtitle).slice(0, 18), w / 2, h * 0.7);
  }
  ctx.shadowBlur = 0;
  spr.material.map.needsUpdate = true;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function disposeLabel(label) {
  if (!label) return;
  label.material?.map?.dispose?.();
  label.material?.dispose?.();
}
