/**
 * Garbage visuals — proposed style:
 * far = compact amber dots · near/selected = glowing stem + orb + dark site label
 * + readable waste pile (bottles / bags / foam / crates).
 */
import * as THREE from "three";
import { LOD, markerScaleForCamera } from "./garbageLOD.js";

const AMBER = "#E89A1C";
const AMBER_LIGHT = "#FFE08A";
const AMBER_HOT = "#FFB347";
const DEBRIS = "#8B7355";
const PLASTIC = "#C4D4E0";
const FOAM = "#F2EDE4";
const STEM_H = 11;

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

  // Compact ground glow (far / overview dots)
  const discGeo = new THREE.CircleGeometry(2.4, 24);
  discGeo.rotateX(-Math.PI / 2);
  const rimGeo = new THREE.RingGeometry(2.2, 3.1, 24);
  rimGeo.rotateX(-Math.PI / 2);
  const coreGeo = new THREE.CircleGeometry(0.85, 14);
  coreGeo.rotateX(-Math.PI / 2);

  // Proposed beacon: thin stem + glowing orb (replaces flag)
  const stemGeo = new THREE.CylinderGeometry(0.09, 0.14, STEM_H, 10);
  const orbGeo = new THREE.SphereGeometry(0.95, 20, 16);
  const orbHaloGeo = new THREE.SphereGeometry(1.55, 16, 12);
  const glowDiscGeo = new THREE.CircleGeometry(2.8, 28);
  glowDiscGeo.rotateX(-Math.PI / 2);

  const fillMat = new THREE.MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.62,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const rimMat = new THREE.MeshBasicMaterial({
    color: AMBER_LIGHT,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const coreMat = new THREE.MeshBasicMaterial({
    color: "#fff6d8",
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const selectMat = new THREE.MeshBasicMaterial({
    color: "#FF6B2C",
    transparent: true,
    opacity: 0.78,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const boxGeo = new THREE.BoxGeometry(1.4, 0.85, 1.05);
  const bagGeo = new THREE.SphereGeometry(0.95, 12, 10);
  bagGeo.scale(1.45, 0.72, 1.2);
  const bottleGeo = new THREE.CylinderGeometry(0.22, 0.28, 1.35, 10);
  const bottleCapGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.18, 8);
  const foamGeo = new THREE.BoxGeometry(1.1, 0.55, 0.85);
  const crateGeo = new THREE.BoxGeometry(1.9, 1.05, 1.4);

  const debrisMat = new THREE.MeshStandardMaterial({
    color: DEBRIS,
    roughness: 0.92,
    metalness: 0.04,
    flatShading: true,
  });
  const plasticMat = new THREE.MeshStandardMaterial({
    color: PLASTIC,
    roughness: 0.42,
    metalness: 0.12,
    flatShading: true,
  });
  const bagMat = new THREE.MeshStandardMaterial({
    color: "#4f6a48",
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true,
  });
  const foamMat = new THREE.MeshStandardMaterial({
    color: FOAM,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: AMBER,
    roughness: 0.5,
    metalness: 0.1,
    flatShading: true,
    emissive: AMBER,
    emissiveIntensity: 0.22,
  });

  const stemMat = new THREE.MeshBasicMaterial({
    color: AMBER_HOT,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  });
  const orbMat = new THREE.MeshBasicMaterial({
    color: AMBER_LIGHT,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
    depthWrite: false,
  });
  const orbHaloMat = new THREE.MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.28,
    depthTest: false,
    depthWrite: false,
  });
  const glowDiscMat = new THREE.MeshBasicMaterial({
    color: AMBER,
    transparent: true,
    opacity: 0.35,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
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

      const title = siteDisplayName(r);
      const ch = siteChainageLabel(r);
      const label = makeSiteLabel(title, ch);
      label.position.set(0, STEM_H + 3.2, 0);
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

  /** Waste pile — bottles, bags, foam, crates (proposed close-view look). */
  function buildDebrisCluster(r) {
    const g = new THREE.Group();
    g.name = `garbageDebris_${r.id}`;
    g.userData.recordId = r.id;
    const phase = r.phase || 0;
    const n = 9 + (r.sourceIndex % 5);

    const mound = new THREE.Mesh(bagGeo, bagMat);
    mound.position.set(0, 0.5, 0);
    mound.scale.set(2.6, 1.55, 2.35);
    g.add(mound);

    for (let k = 0; k < n; k++) {
      const kind = k % 5;
      let mesh;
      if (kind === 0) {
        mesh = new THREE.Mesh(crateGeo, debrisMat);
      } else if (kind === 1) {
        mesh = new THREE.Mesh(bagGeo, bagMat);
      } else if (kind === 2) {
        const bottle = new THREE.Group();
        const body = new THREE.Mesh(bottleGeo, plasticMat);
        const cap = new THREE.Mesh(bottleCapGeo, accentMat);
        cap.position.y = 0.75;
        bottle.add(body, cap);
        mesh = bottle;
      } else if (kind === 3) {
        mesh = new THREE.Mesh(foamGeo, foamMat);
      } else {
        mesh = new THREE.Mesh(boxGeo, accentMat);
      }

      const a = (k / n) * Math.PI * 2 + phase;
      const rad = 0.9 + (k % 5) * 0.48;
      mesh.position.set(
        Math.cos(a) * rad,
        0.4 + (k % 4) * 0.42,
        Math.sin(a) * rad,
      );
      mesh.rotation.set(phase * 0.2 + k * 0.18, a * 0.9, phase * 0.12 + k * 0.08);
      mesh.scale.setScalar(0.95 + (k % 3) * 0.22);
      mesh.traverse?.((c) => {
        if (c.isMesh) c.castShadow = false;
      });
      if (mesh.isMesh) mesh.castShadow = false;
      g.add(mesh);
    }

    g.scale.setScalar(2.35);
    return g;
  }

  /** Glowing stem + orb (proposed marker, not triangular flag). */
  function buildBeacon() {
    const g = new THREE.Group();
    g.name = "garbageBeacon";

    const glow = new THREE.Mesh(glowDiscGeo, glowDiscMat);
    glow.position.y = 0.06;
    glow.renderOrder = 48;

    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = STEM_H * 0.5;
    stem.renderOrder = 50;

    const halo = new THREE.Mesh(orbHaloGeo, orbHaloMat);
    halo.position.y = STEM_H;
    halo.renderOrder = 51;

    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.y = STEM_H;
    orb.renderOrder = 52;

    g.add(glow, stem, halo, orb);
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
        cell.level === "HIGH" ? "#C0392B" : cell.level === "MEDIUM" ? "#E67E22" : "#27AE60";
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16 + Math.min(0.28, cell.count * 0.04),
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
      if (e.label) {
        const title = siteDisplayName(e.record);
        const ch = siteChainageLabel(e.record);
        paintSiteLabel(e.label, title, ch);
      }
    }
  }

  function applyLOD(lod, camera, selected = selectedId) {
    const boost = markerScaleForCamera(camera);
    const camY = camera?.position?.y ?? 800;
    const far = lod === LOD.FAR;
    const medium = lod === LOD.MEDIUM;

    for (const e of entries) {
      if (e.marker.userData.filteredOut) {
        e.marker.visible = false;
        if (e.debris) e.debris.visible = false;
        if (e.beacon) e.beacon.visible = false;
        if (e.label) e.label.visible = false;
        continue;
      }

      const isSel = e.record.id === selected;
      e.marker.visible = true;
      // Far overview: compact dots; selected slightly larger
      const ringScale = boost * (isSel ? 0.7 : far ? 0.55 : 0.75);
      e.marker.scale.set(ringScale, ringScale, ringScale);

      if (e.debris) {
        const showPile = isSel || (!far && (medium || lod === LOD.NEAR || lod === LOD.VERY_NEAR));
        e.debris.visible = showPile;
        e.debris.scale.setScalar(isSel ? 3.1 : medium ? 1.7 : 2.3);
      }

      if (e.beacon) {
        e.beacon.visible = isSel;
        e.beacon.scale.setScalar(isSel ? 1.05 : 1);
      }

      if (e.label) {
        // Selected always shows proposed dark label; optional labelsEnabled for all
        e.label.visible = isSel || (labelsEnabled && !far);
        const ls = THREE.MathUtils.clamp(camY * 0.012, 6, 16);
        e.label.scale.set(ls * 1.55, ls * 0.42, 1);
        e.label.position.y = STEM_H + 2.8 + Math.min(6, camY * 0.006);
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
      stemGeo,
      orbGeo,
      orbHaloGeo,
      glowDiscGeo,
      boxGeo,
      bagGeo,
      bottleGeo,
      bottleCapGeo,
      foamGeo,
      crateGeo,
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
      foamMat,
      accentMat,
      stemMat,
      orbMat,
      orbHaloMat,
      glowDiscMat,
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
  const m = Number(r?.riverChainageMeters ?? r?.nearestChainageMeters);
  if (!Number.isFinite(m)) return "";
  const km = Math.floor(m / 1000);
  const rem = Math.round(m % 1000);
  return `CH ${km}+${String(rem).padStart(3, "0")}`;
}

function makeSiteLabel(title, subtitle) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 140;
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
  spr.scale.set(36, 8, 1);
  return spr;
}

function paintSiteLabel(spr, title, subtitle) {
  const canvas = spr.userData.canvas || spr.material.map?.image;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const line = subtitle ? `${title}, ${subtitle}` : String(title || "Site");
  ctx.font = "800 44px Inter, system-ui, sans-serif";
  const tw = Math.min(w - 48, ctx.measureText(line).width + 48);
  const bx = (w - tw) / 2;
  const by = h * 0.22;
  const bh = h * 0.56;

  roundRect(ctx, bx, by, tw, bh, 18);
  ctx.fillStyle = "rgba(6, 10, 16, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(232, 154, 28, 0.55)";
  ctx.lineWidth = 3;
  roundRect(ctx, bx, by, tw, bh, 18);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 4;
  ctx.fillStyle = "#fff8ec";
  ctx.fillText(line.slice(0, 36), w / 2, by + bh * 0.52);
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
