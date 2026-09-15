import * as THREE from "three";
import { state } from "../../state.js";
import { SURFACE_Y } from "../river.js";

/**
 * Joining Streams presentation layer on top of existing nullah geometry:
 * - dark navy pipe edge highlight
 * - animated flow arrows along each curve (source → river)
 * - soft confluence mist at river outlets
 * - named glass labels (existing names only)
 * - selection highlight
 *
 * Does not invent drainage coordinates or attributes.
 */

const FLOW_SPEED_MPS = 2.4;
const ARROW_SPACING_M = 42;
const MAX_ARROWS_PER = 28;
const MAX_TOTAL_ARROWS = 420;

export function createJoiningStreamsEffects(nallaFlowGroup, opts = {}) {
  const group = new THREE.Group();
  group.name = "joiningStreamsEffects";
  group.visible = false;

  const records = nallaFlowGroup?.userData?.records || [];
  const uiRoot = opts.uiRoot || document.getElementById("ui-root");
  const getCamera = opts.getCamera;

  const arrowGeo = new THREE.ConeGeometry(0.62, 2.0, 6);
  arrowGeo.rotateX(Math.PI / 2);
  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xb8ecff,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const arrowMesh = new THREE.InstancedMesh(arrowGeo, arrowMat, MAX_TOTAL_ARROWS);
  arrowMesh.name = "joiningStreamArrows";
  arrowMesh.frustumCulled = false;
  arrowMesh.renderOrder = 28;
  arrowMesh.count = 0;
  group.add(arrowMesh);

  const mist = buildConfluenceMist(records);
  if (mist.root) group.add(mist.root);

  const pipeEdges = buildPipeEdges(records);
  if (pipeEdges.root) group.add(pipeEdges.root);

  const labels = buildNameLabels(records, uiRoot);

  /** @type {null | object} */
  let selected = null;
  /** @type {null | object} */
  let hovered = null;
  const dummy = new THREE.Object3D();
  const _up = new THREE.Vector3(0, 1, 0);
  const arrowSlots = buildArrowSlots(records);

  function recordsMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.id != null && b.id != null && String(a.id) === String(b.id)) return true;
    if (a.meta && b.meta && a.meta === b.meta) return true;
    if (a.meta?.osmId && b.meta?.osmId && String(a.meta.osmId) === String(b.meta.osmId)) return true;
    if (a.navIndex != null && b.navIndex != null && a.navIndex === b.navIndex) return true;
    return false;
  }

  function setActive(on) {
    group.visible = !!on;
    labels.setVisible(!!on);
    if (!on) {
      selected = null;
      hovered = null;
      arrowMesh.count = 0;
      mist.setSelected(null);
      pipeEdges.setSelected(null);
      labels.setSelected(null);
      pipeEdges.setHovered?.(null);
    }
  }

  function setSelected(rec) {
    selected = rec || null;
    mist.setSelected(selected?.id ?? null);
    pipeEdges.setSelected(selected?.id ?? null);
    labels.setSelected(selected?.id ?? null);
    const meshes = nallaFlowGroup?.children || [];
    for (const m of meshes) {
      const r = m.userData?.record;
      if (!r || !m.isMesh) continue;
      const isSel = recordsMatch(selected, r);
      const isHov = recordsMatch(hovered, r);
      // NEVER scale meshes — TubeGeometry is in world metres; scale shifts XZ off-map
      m.scale.set(1, 1, 1);
      m.renderOrder = isSel ? 6 : isHov ? 5 : 3;
    }
  }

  function setHovered(rec) {
    hovered = rec || null;
    pipeEdges.setHovered?.(hovered?.id ?? null);
    setSelected(selected);
  }

  function update(dt, camera) {
    if (!group.visible || !state.joiningStreamsMode) {
      labels.setVisible(false);
      arrowMesh.count = 0;
      return;
    }
    labels.setVisible(true);
    const cam = camera || getCamera?.();
    const t = state.elapsed ?? 0;

    let written = 0;
    for (const slot of arrowSlots) {
      const L = slot.length;
      if (L < 6) continue;
      const isSel = recordsMatch(selected, slot.rec);
      const isHov = recordsMatch(hovered, slot.rec);
      // Always draw arrows; emphasize selected channel
      const spacing = isSel ? 28 : isHov ? 36 : ARROW_SPACING_M;
      const n = Math.min(MAX_ARROWS_PER, Math.max(isSel ? 5 : 2, Math.floor(L / spacing)));
      const dim = selected && !isSel && !isHov;
      for (let i = 0; i < n && written < MAX_TOTAL_ARROWS; i++) {
        const phase = (i / n + (t * FLOW_SPEED_MPS) / Math.max(L, 1)) % 1;
        const u = THREE.MathUtils.clamp(phase, 0.02, 0.98);
        const p = slot.curve.getPointAt(u);
        const tan = slot.curve.getTangentAt(u).normalize();
        dummy.position.copy(p);
        const pipeR = slot.rec.channelRadius || 2;
        dummy.position.y += pipeR + (isSel ? 1.6 : 1.25);
        dummy.up.copy(_up);
        dummy.lookAt(p.x + tan.x, p.y + tan.y, p.z + tan.z);
        const s = dim ? 0.55 : isSel ? 1.35 : isHov ? 1.1 : 0.9;
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        arrowMesh.setMatrixAt(written, dummy.matrix);
        written++;
      }
    }
    arrowMesh.count = written;
    arrowMesh.instanceMatrix.needsUpdate = true;
    arrowMat.opacity = selected ? 0.98 : 0.88;
    arrowMat.color.setHex(selected ? 0xd7f7ff : 0xb8ecff);

    mist.update(dt, t, selected?.id ?? null, cam);
    pipeEdges.update(selected?.id ?? null, hovered?.id ?? null);
    if (cam) labels.update(cam);
  }

  group.userData = {
    setActive,
    setSelected,
    setHovered,
    update,
    getSelected: () => selected,
    dispose() {
      labels.dispose();
      arrowGeo.dispose();
      arrowMat.dispose();
      mist.dispose?.();
      pipeEdges.dispose?.();
    },
  };

  return group;
}

function buildArrowSlots(records) {
  const out = [];
  for (const rec of records) {
    if (!rec.curve || !(rec.curveLength > 0)) continue;
    out.push({
      rec,
      curve: rec.curve,
      length: rec.curveLength,
    });
  }
  return out;
}

function buildPipeEdges(records) {
  const root = new THREE.Group();
  root.name = "joiningPipeEdges";
  const defaultMat = new THREE.MeshBasicMaterial({
    color: 0x0a2540,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const cyanMat = new THREE.MeshBasicMaterial({
    color: 0x4ec8ff,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const selMat = new THREE.MeshBasicMaterial({
    color: 0x1a6a9a,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const selCyan = new THREE.MeshBasicMaterial({
    color: 0x9ae8ff,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const entries = [];
  for (const rec of records) {
    if (!rec.curve) continue;
    const r = rec.channelRadius || Math.min(2.6, Math.max(1.2, (rec.curveLength || 100) * 0.002 + 1.5));
    const tubular = Math.max(12, Math.min(280, Math.floor((rec.curveLength || 40) / 4)));
    let outer;
    let rim;
    try {
      outer = new THREE.Mesh(new THREE.TubeGeometry(rec.curve, tubular, r * 1.1, 7, false), defaultMat);
      rim = new THREE.Mesh(new THREE.TubeGeometry(rec.curve, tubular, r * 1.18, 7, false), cyanMat);
    } catch {
      continue;
    }
    outer.name = `pipeOuter_${rec.id}`;
    rim.name = `pipeRim_${rec.id}`;
    outer.renderOrder = 2;
    rim.renderOrder = 2;
    outer.userData.recId = rec.id;
    rim.userData.recId = rec.id;
    root.add(outer, rim);
    entries.push({ rec, outer, rim });
  }

  function setSelected(id) {
    applyPipeState(id, hoveredId);
  }

  let hoveredId = null;
  function setHovered(id) {
    hoveredId = id;
    applyPipeState(selectedId, hoveredId);
  }

  let selectedId = null;
  function applyPipeState(selId, hovId) {
    selectedId = selId;
    hoveredId = hovId;
    for (const e of entries) {
      const on = selId && e.rec.id === selId;
      const hov = hovId && e.rec.id === hovId && !on;
      const dim = selId && !on;
      e.outer.material = on ? selMat : defaultMat;
      e.rim.material = on || hov ? selCyan : cyanMat;
      e.outer.material.opacity = dim ? 0.06 : on ? 0.55 : hov ? 0.38 : 0.22;
      e.rim.material.opacity = dim ? 0.03 : on ? 0.42 : hov ? 0.24 : 0.12;
      e.outer.visible = !selId || on || hov;
      e.rim.visible = !selId || on || hov;
      e.outer.scale.setScalar(on ? 1.08 : hov ? 1.03 : 1);
      e.rim.scale.setScalar(on ? 1.08 : hov ? 1.03 : 1);
    }
  }

  return {
    root,
    setSelected,
    setHovered,
    update: (selId, hovId) => applyPipeState(selId, hovId ?? hoveredId),
    dispose() {
      for (const e of entries) {
        e.outer.geometry.dispose();
        e.rim.geometry.dispose();
      }
      defaultMat.dispose();
      cyanMat.dispose();
      selMat.dispose();
      selCyan.dispose();
    },
  };
}

function buildConfluenceMist(records) {
  const root = new THREE.Group();
  root.name = "joiningConfluenceMist";

  // Outlet mist only at bank/confluence — keep compact so it doesn't float as "clouds"
  const outlets = [];
  for (const rec of records) {
    if (!rec.connectsToRiver || !rec.connection) continue;
    const ordered = rec.orderedPts?.length ? rec.orderedPts : rec.pts;
    if (!ordered?.length) continue;
    const end = ordered[ordered.length - 1];
    const bank = rec.connection.bankPoint;
    const curveEnd = rec.curve?.getPointAt?.(1);
    const x = bank?.x ?? curveEnd?.x ?? end.x;
    const z = bank?.z ?? curveEnd?.z ?? end.z;
    const y = (curveEnd?.y != null ? curveEnd.y : SURFACE_Y) + 0.35;
    outlets.push({ rec, x, y, z });
  }

  if (!outlets.length) {
    return { root: null, setSelected() {}, update() {}, dispose() {} };
  }

  const spriteTex = makeMistSpriteTexture();

  /** @type {{ group: THREE.Group, rec: object, particles: object[], rings: THREE.Mesh[], haze: THREE.Mesh }[]} */
  const sites = [];

  for (const o of outlets) {
    const site = new THREE.Group();
    site.name = `confluence_${o.rec.id}`;
    site.position.set(o.x, o.y, o.z);
    site.userData.recId = o.rec.id;
    site.visible = false;

    const haze = new THREE.Mesh(
      new THREE.CircleGeometry(4.5, 24),
      new THREE.MeshBasicMaterial({
        color: 0xb8e8ff,
        map: spriteTex,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    haze.rotation.x = -Math.PI / 2;
    haze.position.y = 0.05;
    haze.renderOrder = 10;
    site.add(haze);

    const rings = [];
    for (let r = 0; r < 2; r++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.9, 28),
        new THREE.MeshBasicMaterial({
          color: 0xd2f2ff,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      ring.renderOrder = 11;
      ring.userData.phase = r / 2;
      site.add(ring);
      rings.push(ring);
    }

    const particles = [];
    const COUNT = 10;
    for (let i = 0; i < COUNT; i++) {
      const mat = new THREE.SpriteMaterial({
        map: spriteTex,
        color: 0xd8f4ff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const spr = new THREE.Sprite(mat);
      const ang = Math.random() * Math.PI * 2;
      const rad = 0.4 + Math.random() * 2.2;
      spr.position.set(Math.cos(ang) * rad * 0.35, 0.15 + Math.random() * 0.6, Math.sin(ang) * rad * 0.35);
      const s = 1.2 + Math.random() * 1.6;
      spr.scale.set(s, s, 1);
      spr.renderOrder = 12;
      site.add(spr);
      particles.push({
        spr,
        phase: Math.random(),
        lift: 0.6 + Math.random() * 1.2,
        rad,
        ang,
        baseScale: s,
      });
    }

    root.add(site);
    sites.push({ group: site, rec: o.rec, particles, rings, haze });
  }

  let selectedId = null;

  function setSelected(id) {
    selectedId = id;
  }

  function update(_dt, t, selId) {
    selectedId = selId ?? selectedId;
    for (const site of sites) {
      const on = selectedId && String(site.rec.id) === String(selectedId);
      site.group.visible = !!on;
      if (!on) continue;

      site.group.scale.setScalar(1);
      site.haze.material.opacity = 0.32;
      const pulse = 1 + Math.sin(t * 1.2) * 0.06;
      site.haze.scale.setScalar(pulse);

      for (const ring of site.rings) {
        const u = (t * 0.35 + ring.userData.phase) % 1;
        const sc = 1.2 + u * 3.5;
        ring.scale.setScalar(sc);
        ring.material.opacity = (1 - u) * 0.28;
      }

      for (const p of site.particles) {
        const u = (t * 0.25 + p.phase) % 1;
        p.spr.position.y = 0.1 + u * p.lift;
        const fade = u < 0.15 ? u / 0.15 : u > 0.7 ? (1 - u) / 0.3 : 1;
        p.spr.material.opacity = 0.2 * fade;
        const sc = p.baseScale * (0.85 + u * 0.35);
        p.spr.scale.set(sc, sc, 1);
      }
    }
  }

  return {
    root,
    setSelected,
    update,
    dispose() {
      spriteTex.dispose();
      for (const site of sites) {
        site.haze.geometry.dispose();
        site.haze.material.dispose();
        for (const ring of site.rings) {
          ring.geometry.dispose();
          ring.material.dispose();
        }
        for (const p of site.particles) {
          p.spr.material.dispose();
        }
      }
    },
  };
}

function makeMistSpriteTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(230, 248, 255, 0.95)");
  g.addColorStop(0.35, "rgba(170, 220, 245, 0.55)");
  g.addColorStop(0.7, "rgba(120, 190, 230, 0.18)");
  g.addColorStop(1, "rgba(80, 160, 210, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function buildNameLabels(records, uiRoot) {
  const named = records.filter((r) => {
    const n = String(r.meta?.name || r.name || "").trim();
    if (!n || /^unnamed/i.test(n)) return false;
    return true;
  });

  const wrap = document.createElement("div");
  wrap.className = "joining-stream-labels";
  wrap.setAttribute("aria-hidden", "true");
  if (uiRoot) uiRoot.appendChild(wrap);

  const items = named.map((rec) => {
    const el = document.createElement("div");
    el.className = "joining-stream-label";
    el.dataset.recId = rec.id;
    const mid = rec.orderedPts?.[Math.floor((rec.orderedPts.length || 1) * 0.35)] || rec.pts?.[0];
    const name = String(rec.meta?.name || rec.meta?.nameEn || rec.meta?.intName || rec.name || "").trim();
    el.innerHTML = `
      <span class="joining-stream-label__text">${escapeHtml(name)}</span>
      <span class="joining-stream-label__leader" aria-hidden="true"></span>
    `;
    wrap.appendChild(el);
    return {
      rec,
      el,
      world: new THREE.Vector3(mid?.x || 0, (mid?.y || SURFACE_Y) + 3.5, mid?.z || 0),
      ndc: new THREE.Vector3(),
    };
  });

  function setVisible(on) {
    wrap.style.display = on ? "block" : "none";
  }

  function setSelected(id) {
    for (const it of items) {
      it.el.classList.toggle("is-selected", !!id && it.rec.id === id);
      it.el.classList.toggle("is-dim", !!id && it.rec.id !== id);
    }
  }

  function update(camera) {
    if (wrap.style.display === "none") return;
    const canvas = camera?.domElement || document.querySelector("canvas");
    const rect = canvas?.getBoundingClientRect?.() || { left: 0, top: 0, width: innerWidth, height: innerHeight };
    for (const it of items) {
      it.ndc.copy(it.world).project(camera);
      if (it.ndc.z > 1) {
        it.el.style.visibility = "hidden";
        continue;
      }
      const sx = rect.left + (it.ndc.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-it.ndc.y * 0.5 + 0.5) * rect.height;
      it.el.style.visibility = "visible";
      it.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, calc(-100% - 10px))`;
    }
  }

  function dispose() {
    wrap.remove();
  }

  setVisible(false);
  return { setVisible, setSelected, update, dispose };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
