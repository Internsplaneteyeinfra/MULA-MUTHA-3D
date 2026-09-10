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

const FLOW_SPEED_MPS = 4.2;
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

  const arrowGeo = new THREE.ConeGeometry(0.55, 1.8, 5);
  arrowGeo.rotateX(Math.PI / 2);
  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xb8ecff,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    toneMapped: false,
  });
  const arrowMesh = new THREE.InstancedMesh(arrowGeo, arrowMat, MAX_TOTAL_ARROWS);
  arrowMesh.name = "joiningStreamArrows";
  arrowMesh.frustumCulled = false;
  arrowMesh.renderOrder = 8;
  arrowMesh.count = 0;
  group.add(arrowMesh);

  const mist = buildConfluenceMist(records);
  if (mist.root) group.add(mist.root);

  const pipeEdges = buildPipeEdges(records);
  if (pipeEdges.root) group.add(pipeEdges.root);

  const labels = buildNameLabels(records, uiRoot);

  /** @type {null | object} */
  let selected = null;
  const dummy = new THREE.Object3D();
  const _up = new THREE.Vector3(0, 1, 0);
  const arrowSlots = buildArrowSlots(records);

  function setActive(on) {
    group.visible = !!on;
    labels.setVisible(!!on);
    if (!on) {
      selected = null;
      arrowMesh.count = 0;
      mist.setSelected(null);
      pipeEdges.setSelected(null);
      labels.setSelected(null);
    }
  }

  function setSelected(rec) {
    selected = rec || null;
    mist.setSelected(selected?.id ?? null);
    pipeEdges.setSelected(selected?.id ?? null);
    labels.setSelected(selected?.id ?? null);
    // Brighten selected nalla water mesh if present
    const meshes = nallaFlowGroup?.children || [];
    for (const m of meshes) {
      const r = m.userData?.record;
      if (!r || !m.isMesh) continue;
      const isSel = selected && (r.id === selected.id || r.meta === selected.meta);
      m.material = m.material; // shared mat — use opacity via userData scale
      m.scale.setScalar(isSel ? 1.12 : selected ? 0.92 : 1);
      m.renderOrder = isSel ? 5 : 3;
    }
  }

  function update(dt, camera) {
    if (!group.visible || !state.joiningStreamsMode) {
      labels.setVisible(false);
      return;
    }
    labels.setVisible(true);
    const cam = camera || getCamera?.();
    const t = state.elapsed ?? 0;

    let written = 0;
    for (const slot of arrowSlots) {
      const L = slot.length;
      if (L < 8) continue;
      const n = Math.min(MAX_ARROWS_PER, Math.max(2, Math.floor(L / ARROW_SPACING_M)));
      const isSel = selected && slot.rec.id === selected.id;
      const dim = selected && !isSel;
      for (let i = 0; i < n && written < MAX_TOTAL_ARROWS; i++) {
        const phase = (i / n + (t * FLOW_SPEED_MPS) / L) % 1;
        const u = phase;
        const p = slot.curve.getPointAt(u);
        const tan = slot.curve.getTangentAt(u).normalize();
        dummy.position.copy(p);
        dummy.position.y += isSel ? 0.55 : 0.35;
        dummy.up.copy(_up);
        dummy.lookAt(p.x + tan.x, p.y + tan.y, p.z + tan.z);
        const s = dim ? 0.72 : isSel ? 1.15 : 1;
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        arrowMesh.setMatrixAt(written, dummy.matrix);
        written++;
      }
    }
    arrowMesh.count = written;
    arrowMesh.instanceMatrix.needsUpdate = true;
    arrowMat.opacity = selected ? 0.78 : 0.88;

    mist.update(dt, t, selected?.id ?? null, cam);
    pipeEdges.update(selected?.id ?? null);
    if (cam) labels.update(cam);
  }

  group.userData = {
    setActive,
    setSelected,
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
    opacity: 0.42,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: false,
  });
  const cyanMat = new THREE.MeshBasicMaterial({
    color: 0x4ec8ff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: false,
  });
  const selMat = new THREE.MeshBasicMaterial({
    color: 0x1a6a9a,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: false,
  });
  const selCyan = new THREE.MeshBasicMaterial({
    color: 0x9ae8ff,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: false,
  });

  const entries = [];
  for (const rec of records) {
    if (!rec.curve) continue;
    const r = Math.max(2.4, (rec.curveLength || 100) * 0.004 + 3.2);
    const tubular = Math.max(8, Math.min(220, Math.floor((rec.curveLength || 40) / 6)));
    let outer;
    let rim;
    try {
      outer = new THREE.Mesh(new THREE.TubeGeometry(rec.curve, tubular, r * 1.35, 8, false), defaultMat);
      rim = new THREE.Mesh(new THREE.TubeGeometry(rec.curve, tubular, r * 1.48, 8, false), cyanMat);
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
    for (const e of entries) {
      const on = id && e.rec.id === id;
      const dim = id && !on;
      e.outer.material = on ? selMat : defaultMat;
      e.rim.material = on ? selCyan : cyanMat;
      e.outer.material.opacity = dim ? 0.22 : on ? 0.55 : 0.42;
      e.rim.material.opacity = dim ? 0.1 : on ? 0.38 : 0.22;
    }
  }

  return {
    root,
    setSelected,
    update: setSelected,
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

  // Outlet = drainage end closest to river, placed on river surface at confluence
  const outlets = [];
  for (const rec of records) {
    if (!rec.connectsToRiver || !rec.connection) continue;
    const ordered = rec.orderedPts?.length ? rec.orderedPts : rec.pts;
    if (!ordered?.length) continue;
    const end = ordered[ordered.length - 1];
    const river = rec.connection.riverPoint || end;
    const nalla = rec.connection.nallaPoint || end;
    // Blend toward the river corridor so mist sits on the main stem, not mid-bank
    const x = river.x * 0.55 + nalla.x * 0.25 + end.x * 0.2;
    const z = river.z * 0.55 + nalla.z * 0.25 + end.z * 0.2;
    const y = SURFACE_Y + 1.35;
    outlets.push({ rec, x, y, z, end, river });
  }

  if (!outlets.length) {
    return { root: null, setSelected() {}, update() {}, dispose() {} };
  }

  const spriteTex = makeMistSpriteTexture();

  /** @type {{ group: THREE.Group, rec: object, particles: object[], rings: THREE.Mesh[], haze: THREE.Mesh, baseScale: number }[]} */
  const sites = [];

  for (const o of outlets) {
    const site = new THREE.Group();
    site.name = `confluence_${o.rec.id}`;
    site.position.set(o.x, o.y, o.z);
    site.userData.recId = o.rec.id;

    // Soft horizontal haze disc on river surface
    const haze = new THREE.Mesh(
      new THREE.CircleGeometry(9, 28),
      new THREE.MeshBasicMaterial({
        color: 0xb8e8ff,
        map: spriteTex,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    haze.rotation.x = -Math.PI / 2;
    haze.position.y = -0.35;
    haze.renderOrder = 10;
    site.add(haze);

    // Expanding ripple rings
    const rings = [];
    for (let r = 0; r < 3; r++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.35, 36),
        new THREE.MeshBasicMaterial({
          color: 0xd2f2ff,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.2;
      ring.renderOrder = 11;
      ring.userData.phase = r / 3;
      site.add(ring);
      rings.push(ring);
    }

    // Vertical mist sprites (water vapor entering river)
    const particles = [];
    const COUNT = 22;
    for (let i = 0; i < COUNT; i++) {
      const mat = new THREE.SpriteMaterial({
        map: spriteTex,
        color: 0xd8f4ff,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const spr = new THREE.Sprite(mat);
      const ang = Math.random() * Math.PI * 2;
      const rad = 1.2 + Math.random() * 5.5;
      spr.position.set(Math.cos(ang) * rad * 0.4, Math.random() * 1.2, Math.sin(ang) * rad * 0.4);
      const s = 3.2 + Math.random() * 4.5;
      spr.scale.set(s, s, 1);
      spr.renderOrder = 12;
      site.add(spr);
      particles.push({
        spr,
        phase: Math.random(),
        lift: 1.8 + Math.random() * 3.5,
        rad,
        ang,
        baseScale: s,
      });
    }

    // Tiny foam dots
    const foamGeo = new THREE.BufferGeometry();
    const foamPos = new Float32Array(18 * 3);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * 6;
      foamPos[i * 3] = Math.cos(a) * rr;
      foamPos[i * 3 + 1] = 0.15 + Math.random() * 0.8;
      foamPos[i * 3 + 2] = Math.sin(a) * rr;
    }
    foamGeo.setAttribute("position", new THREE.BufferAttribute(foamPos, 3));
    const foam = new THREE.Points(
      foamGeo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 2.2,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    foam.renderOrder = 13;
    foam.frustumCulled = false;
    site.add(foam);

    root.add(site);
    sites.push({
      group: site,
      rec: o.rec,
      particles,
      rings,
      haze,
      foam,
      foamPos,
      baseScale: 1,
    });
  }

  let selectedId = null;
  const _world = new THREE.Vector3();

  function setSelected(id) {
    selectedId = id;
  }

  function update(_dt, t, selId, camera) {
    selectedId = selId ?? selectedId;
    for (const site of sites) {
      const on = selectedId && site.rec.id === selectedId;
      const dim = selectedId && !on;

      // Distance-based scale so mist stays readable from overview
      let distScale = 1;
      if (camera) {
        site.group.getWorldPosition(_world);
        const d = camera.position.distanceTo(_world);
        distScale = THREE.MathUtils.clamp(d / 420, 0.85, 2.6);
      }
      const focus = on ? 1.35 : dim ? 0.55 : 1;
      site.group.scale.setScalar(distScale * focus);

      site.haze.material.opacity = dim ? 0.12 : on ? 0.5 : 0.38;
      const pulse = 1 + Math.sin(t * 1.15) * 0.08;
      site.haze.scale.setScalar(pulse);

      for (const ring of site.rings) {
        const u = (t * 0.22 + ring.userData.phase) % 1;
        const s = 1.2 + u * 7.5;
        ring.scale.setScalar(s);
        ring.material.opacity = (dim ? 0.08 : on ? 0.42 : 0.3) * (1 - u);
        ring.visible = !dim || on;
      }

      for (const p of site.particles) {
        const u = (t * 0.2 + p.phase) % 1;
        const ang = p.ang + u * 0.8;
        const spread = p.rad * (0.35 + u * 0.9);
        p.spr.position.set(Math.cos(ang) * spread * 0.55, u * p.lift, Math.sin(ang) * spread * 0.55);
        const fade = u < 0.15 ? u / 0.15 : u > 0.7 ? (1 - u) / 0.3 : 1;
        p.spr.material.opacity = (dim ? 0.12 : on ? 0.48 : 0.36) * fade;
        const sc = p.baseScale * (0.75 + u * 0.9) * (on ? 1.15 : 1);
        p.spr.scale.set(sc, sc, 1);
      }

      // Subtle foam drift
      if (site.foamPos) {
        const arr = site.foam.geometry.attributes.position.array;
        for (let i = 0; i < arr.length / 3; i++) {
          const ph = (t * 0.35 + i * 0.17) % 1;
          arr[i * 3 + 1] = 0.2 + Math.sin(ph * Math.PI * 2) * 0.55 + ph * 0.9;
        }
        site.foam.geometry.attributes.position.needsUpdate = true;
        site.foam.material.opacity = dim ? 0.12 : on ? 0.5 : 0.38;
        site.foam.material.size = (on ? 2.8 : 2.2) * Math.min(distScale, 1.8);
      }
    }
  }

  return {
    root,
    setSelected,
    update,
    dispose() {
      spriteTex.dispose();
      root.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
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
    const name = String(rec.meta?.name || rec.name).trim();
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
