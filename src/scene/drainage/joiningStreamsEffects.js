import * as THREE from "three";
import { state } from "../../state.js";
import { SURFACE_Y } from "../river.js";
import { resolveDrainageSourceName, hasDrainageSourceName } from "./joiningStreamsController.js";
import { isRiverConnectedDrainage } from "./flowDirectionResolver.js";

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

const FLOW_SPEED_MPS = 2.0;
/** Dense ❯❯❯❯ chevrons inside connected drainage pipes */
const ARROW_SPACING_M = 20;
const MAX_ARROWS_PER = 16;
const MAX_ARROWS_SELECTED = 28;
const MAX_TOTAL_ARROWS = 160;
const ARROW_SAMPLE_COUNT = 32;
const LABEL_HZ = 10;

/** Flat chevron (❯). Tip along local −Z so Object3D.lookAt aligns tip with flow tangent. */
function makeChevronGeometry() {
  const shape = new THREE.Shape();
  // Tip toward +X in shape space
  shape.moveTo(-0.55, -0.85);
  shape.lineTo(0.55, 0);
  shape.lineTo(-0.55, 0.85);
  shape.lineTo(-0.2, 0.85);
  shape.lineTo(0.55, 0);
  shape.lineTo(-0.2, -0.85);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  // Flat on XZ; tip along −Z (Three.js lookAt faces −Z toward target)
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeBoundingBox();
  return geo;
}

export function createJoiningStreamsEffects(nallaFlowGroup, opts = {}) {
  const group = new THREE.Group();
  group.name = "joiningStreamsEffects";
  group.visible = false;

  const allRecords = nallaFlowGroup?.userData?.records || [];
  // Effects only for Mula–Mutha-connected drainages
  const records = allRecords.filter((r) => isRiverConnectedDrainage(r));
  const uiRoot = opts.uiRoot || document.getElementById("ui-root");
  const getCamera = opts.getCamera;

  const arrowGeo = makeChevronGeometry();
  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    // Always readable inside dark pipes (pipe is transparent DoubleSide)
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const arrowMesh = new THREE.InstancedMesh(arrowGeo, arrowMat, MAX_TOTAL_ARROWS);
  arrowMesh.name = "joiningStreamArrows";
  arrowMesh.frustumCulled = true;
  arrowMesh.renderOrder = 30;
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
  let effectsActive = false;
  let labelAcc = 0;
  const dummy = new THREE.Object3D();
  const _up = new THREE.Vector3(0, 1, 0);
  const arrowSlots = buildArrowSlots(records);
  const _camPos = new THREE.Vector3();

  function recordsMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.id != null && b.id != null && String(a.id) === String(b.id)) return true;
    if (a.meta && b.meta && a.meta === b.meta) return true;
    if (a.meta?.osmId && b.meta?.osmId && String(a.meta.osmId) === String(b.meta.osmId)) return true;
    if (a.drainageId && b.drainageId && a.drainageId === b.drainageId) return true;
    if (a.navIndex != null && b.navIndex != null && a.navIndex === b.navIndex) return true;
    return false;
  }

  function setActive(on) {
    const next = !!on;
    if (effectsActive === next && group.visible === next) return;
    effectsActive = next;
    group.visible = next;
    labels.setVisible(next);
    if (!next) {
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
    mist.setSelected(selected);
    pipeEdges.setSelected(selected);
    labels.setSelected(selected);
    const meshes = nallaFlowGroup?.children || [];
    for (const m of meshes) {
      const r = m.userData?.record;
      if (!r || !m.isMesh) continue;
      const isSel = recordsMatch(selected, r);
      const isHov = recordsMatch(hovered, r);
      m.scale.set(1, 1, 1);
      m.renderOrder = isSel ? 10 : isHov ? 5 : 3;
    }
  }

  function setHovered(rec) {
    if (recordsMatch(hovered, rec) || (!hovered && !rec)) {
      hovered = rec || null;
      return;
    }
    hovered = rec || null;
    pipeEdges.setHovered?.(hovered);
    // Refresh highlight without rebuilding mist/labels selection
    pipeEdges.setSelected(selected);
  }

  function sampleArrow(slot, u, outP, outT) {
    const samples = slot.samples;
    if (!samples?.length) {
      outP.copy(slot.curve.getPointAt(u));
      outT.copy(slot.curve.getTangentAt(u)).normalize();
      return;
    }
    const n = samples.length - 1;
    const f = THREE.MathUtils.clamp(u, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const t = f - i;
    const a = samples[i];
    const b = samples[i + 1];
    outP.lerpVectors(a.p, b.p, t);
    outT.lerpVectors(a.t, b.t, t);
    if (outT.lengthSq() > 1e-8) outT.normalize();
    else outT.set(1, 0, 0);
  }

  const _p = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _toOutlet = new THREE.Vector3();

  function update(dt, camera) {
    if (!state.joiningStreamsMode) {
      if (effectsActive) setActive(false);
      return;
    }
    if (!effectsActive) setActive(true);

    const cam = camera || getCamera?.();
    const t = state.elapsed ?? 0;
    if (cam?.position) _camPos.copy(cam.position);

    // White ❯❯❯❯ chevrons animated inside every connected drainage pipe
    let written = 0;
    for (const slot of arrowSlots) {
      const L = slot.length;
      if (L < 6) continue;
      const isSel = recordsMatch(selected, slot.rec);
      const isHov = recordsMatch(hovered, slot.rec);
      if (!isSel && !isHov && selected) {
        const mid = slot.samples?.[Math.floor(slot.samples.length * 0.5)]?.p;
        if (mid && _camPos.distanceToSquared(mid) > 520 * 520) continue;
      }
      const pipeR = Math.max(1.1, slot.rec.channelRadius || 2);
      // Tighter spacing on selected so ❯❯❯❯ reads clearly inside the tube
      const spacing = isSel ? 12 : isHov ? 15 : ARROW_SPACING_M;
      const cap = isSel ? MAX_ARROWS_SELECTED : MAX_ARROWS_PER;
      const n = Math.min(cap, Math.max(isSel ? 8 : 4, Math.floor(L / spacing)));
      const dim = selected && !isSel && !isHov;
      // Keep chevrons inside the pipe: slightly above centerline, scaled to radius
      const lift = pipeR * 0.22;
      const baseScale = THREE.MathUtils.clamp(pipeR * 0.55, 0.9, 2.2);
      for (let i = 0; i < n && written < MAX_TOTAL_ARROWS; i++) {
        // Animate toward river (increasing u = toward outlet / confluence)
        const phase = (i / n + (t * FLOW_SPEED_MPS) / Math.max(L, 1)) % 1;
        const u = THREE.MathUtils.clamp(phase, 0.03, 0.97);
        sampleArrow(slot, u, _p, _t);
        // Force tangent toward outlet (u→1)
        const outlet = slot.samples?.[slot.samples.length - 1]?.p;
        if (outlet) {
          _toOutlet.subVectors(outlet, _p);
          if (_t.dot(_toOutlet) < 0) _t.negate();
        }
        dummy.position.copy(_p);
        dummy.position.y += lift;
        dummy.up.copy(_up);
        // Tip is −Z; lookAt aims −Z at target → tip points toward river
        dummy.lookAt(_p.x + _t.x, _p.y + _t.y, _p.z + _t.z);
        const s = baseScale * (dim ? 0.55 : isSel ? 1.15 : isHov ? 1.0 : 0.85);
        dummy.scale.set(s, s * 0.85, s * 1.15);
        dummy.updateMatrix();
        arrowMesh.setMatrixAt(written, dummy.matrix);
        written++;
      }
    }
    arrowMesh.count = written;
    arrowMesh.instanceMatrix.needsUpdate = written > 0;
    arrowMat.opacity = selected ? 0.98 : 0.88;
    arrowMat.color.setHex(0xffffff);

    mist.update(dt, t, selected, cam);
    // pipeEdges only refresh on setSelected/setHovered — not every frame

    labelAcc += dt;
    if (cam && labelAcc >= 1 / LABEL_HZ) {
      labelAcc = 0;
      labels.update(cam, selected);
    }
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
    if (!isRiverConnectedDrainage(rec)) continue;
    if (!rec.curve || !(rec.curveLength > 0)) continue;
    const samples = [];
    const n = ARROW_SAMPLE_COUNT;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      try {
        samples.push({
          p: rec.curve.getPointAt(u),
          t: rec.curve.getTangentAt(u).normalize(),
        });
      } catch {
        break;
      }
    }
    if (samples.length < 2) continue;
    out.push({
      rec,
      curve: rec.curve,
      length: rec.curveLength,
      samples,
    });
  }
  return out;
}

function buildPipeEdges(records) {
  const root = new THREE.Group();
  root.name = "joiningPipeEdges";
  const defaultMat = new THREE.MeshBasicMaterial({
    color: 0x0a2a4a,
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
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x1a5a8a,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const selMat = new THREE.MeshBasicMaterial({
    color: 0x0e3a68,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const selGlow = new THREE.MeshBasicMaterial({
    color: 0x2a7aaa,
    transparent: true,
    opacity: 0.22,
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
    // Single shell (was outer+rim ×2 tubes) — same navy edge look, half the GPU memory
    const tubular = Math.max(64, Math.min(160, Math.floor((rec.curveLength || 40) / 4)));
    let outer;
    try {
      outer = new THREE.Mesh(new THREE.TubeGeometry(rec.curve, tubular, r * 1.14, 12, false), defaultMat);
    } catch {
      continue;
    }
    outer.name = `pipeOuter_${rec.id}`;
    outer.renderOrder = 2;
    outer.frustumCulled = true;
    outer.userData.recId = rec.id;
    // Soft glow via second draw would cost another TubeGeometry — use material only
    root.add(outer);
    entries.push({ rec, outer, rim: null });
  }

  function matchRec(sel, rec) {
    if (!sel || !rec) return false;
    if (sel === rec) return true;
    if (sel.id != null && rec.id != null && String(sel.id) === String(rec.id)) return true;
    if (sel.drainageId && rec.drainageId && sel.drainageId === rec.drainageId) return true;
    if (sel.navIndex != null && rec.navIndex != null && sel.navIndex === rec.navIndex) return true;
    if (sel.meta?.osmId && rec.meta?.osmId && String(sel.meta.osmId) === String(rec.meta.osmId)) return true;
    return false;
  }

  let selectedRec = null;
  let hoveredRec = null;

  function setSelected(rec) {
    if (recordsMatchSafe(selectedRec, rec) && !hoveredRec) {
      selectedRec = rec || null;
      return;
    }
    selectedRec = rec || null;
    applyPipeState(selectedRec, hoveredRec);
  }

  function setHovered(rec) {
    if (recordsMatchSafe(hoveredRec, rec)) {
      hoveredRec = rec || null;
      return;
    }
    hoveredRec = rec || null;
    applyPipeState(selectedRec, hoveredRec);
  }

  function recordsMatchSafe(a, b) {
    if (!a && !b) return true;
    return matchRec(a, b);
  }

  function applyPipeState(sel, hov) {
    selectedRec = sel;
    hoveredRec = hov;
    for (const e of entries) {
      const on = matchRec(sel, e.rec);
      const hovOn = matchRec(hov, e.rec) && !on;
      e.outer.material = on ? selMat : hovOn ? glowMat : defaultMat;
      e.outer.visible = true;
      e.outer.scale.setScalar(on ? 1.05 : hovOn ? 1.02 : 1);
    }
  }

  return {
    root,
    setSelected,
    setHovered,
    update() {
      /* selection-driven only — no per-frame work */
    },
    dispose() {
      for (const e of entries) {
        e.outer.geometry.dispose();
      }
      defaultMat.dispose();
      glowMat.dispose();
      selMat.dispose();
      selGlow.dispose();
    },
  };
}

function buildConfluenceMist(records) {
  const root = new THREE.Group();
  root.name = "joiningConfluenceMist";

  function matchRec(sel, rec) {
    if (!sel || !rec) return false;
    if (sel === rec) return true;
    if (sel.id != null && rec.id != null && String(sel.id) === String(rec.id)) return true;
    if (sel.navIndex != null && rec.navIndex != null && sel.navIndex === rec.navIndex) return true;
    if (sel.meta?.osmId && rec.meta?.osmId && String(sel.meta.osmId) === String(rec.meta.osmId)) return true;
    return false;
  }

  // Outlet mist only at bank/confluence — keep compact so it doesn't float as "clouds"
  const outlets = [];
  for (const rec of records) {
    if (!rec.connection) continue;
    const ordered = rec.orderedPts?.length ? rec.orderedPts : rec.pts;
    if (!ordered?.length) continue;
    const end = ordered[ordered.length - 1];
    const bank = rec.connection.bankPoint;
    const river = rec.connection.riverPoint;
    const curveEnd = rec.outletPoint || rec.curve?.getPointAt?.(1);
    const x = bank?.x ?? river?.x ?? curveEnd?.x ?? end.x;
    const z = bank?.z ?? river?.z ?? curveEnd?.z ?? end.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    // Anchor mist once at confluence world position — never follows camera/river roam
    const y = Number.isFinite(curveEnd?.y)
      ? curveEnd.y + 0.35
      : Number.isFinite(bank?.y)
        ? bank.y + 0.35
        : SURFACE_Y + 0.5;
    outlets.push({ rec, x, y, z });
  }

  if (!outlets.length) {
    return { root: null, setSelected() {}, update() {}, dispose() {} };
  }

  const spriteTex = makeMistSpriteTexture();
  const sharedHazeMat = new THREE.MeshBasicMaterial({
    color: 0xb8e8ff,
    map: spriteTex,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const sharedRingMat = new THREE.MeshBasicMaterial({
    color: 0xd2f2ff,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const sharedSpriteMat = new THREE.SpriteMaterial({
    map: spriteTex,
    color: 0xe0f4ff,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  // Compact confluence mist — marks the outlet without hiding the drainage pipe
  const hazeGeo = new THREE.CircleGeometry(5.5, 32);
  const ringGeo = new THREE.RingGeometry(0.45, 1.15, 32);

  const site = new THREE.Group();
  site.name = "confluenceMistPool";
  site.visible = false;

  const haze = new THREE.Mesh(hazeGeo, sharedHazeMat);
  haze.rotation.x = -Math.PI / 2;
  haze.position.y = 0.06;
  haze.renderOrder = 10;
  site.add(haze);

  const rings = [];
  for (let r = 0; r < 2; r++) {
    const ring = new THREE.Mesh(ringGeo, sharedRingMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.1 + r * 0.04;
    ring.renderOrder = 11;
    ring.userData.phase = r / 2;
    site.add(ring);
    rings.push(ring);
  }

  const particles = [];
  const COUNT = 8;
  for (let i = 0; i < COUNT; i++) {
    const spr = new THREE.Sprite(sharedSpriteMat);
    const ang = Math.random() * Math.PI * 2;
    const rad = 0.35 + Math.random() * 2.4;
    spr.position.set(Math.cos(ang) * rad * 0.4, 0.15 + Math.random() * 0.7, Math.sin(ang) * rad * 0.4);
    const s = 1.4 + Math.random() * 1.8;
    spr.scale.set(s, s, 1);
    spr.renderOrder = 12;
    site.add(spr);
    particles.push({
      spr,
      phase: Math.random(),
      lift: 0.7 + Math.random() * 1.4,
      baseScale: s,
    });
  }
  root.add(site);

  let selectedRec = null;

  function placeAt(rec) {
    if (!rec) {
      site.visible = false;
      return;
    }
    const o = outlets.find((x) => matchRec(rec, x.rec));
    if (!o) {
      site.visible = false;
      return;
    }
    site.position.set(o.x, o.y, o.z);
    site.visible = true;
  }

  function setSelected(rec) {
    selectedRec = rec || null;
    placeAt(selectedRec);
  }

  function update(_dt, t, sel) {
    selectedRec = sel ?? selectedRec;
    placeAt(selectedRec);
    if (!site.visible) return;

    site.scale.setScalar(1);
    const pulse = 1 + Math.sin(t * 1.1) * 0.05;
    haze.scale.setScalar(pulse);

    for (const ring of rings) {
      const u = (t * 0.32 + ring.userData.phase) % 1;
      ring.scale.setScalar(1.1 + u * 2.4);
    }

    for (const p of particles) {
      const u = (t * 0.2 + p.phase) % 1;
      p.spr.position.y = 0.1 + u * p.lift * 0.75;
      const fade = u < 0.15 ? u / 0.15 : u > 0.7 ? (1 - u) / 0.3 : 1;
      const sc = p.baseScale * (0.85 + u * 0.25) * (0.75 + fade * 0.3);
      p.spr.scale.set(sc, sc, 1);
    }
  }

  return {
    root,
    setSelected,
    update,
    dispose() {
      spriteTex.dispose();
      sharedHazeMat.dispose();
      sharedRingMat.dispose();
      sharedSpriteMat.dispose();
      hazeGeo.dispose();
      ringGeo.dispose();
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
  const wrap = document.createElement("div");
  wrap.className = "joining-stream-labels";
  wrap.setAttribute("aria-hidden", "true");
  if (uiRoot) uiRoot.appendChild(wrap);

  function labelText(rec) {
    // Named drainages only — never invent "Unnamed …" or show D-IDs
    return resolveDrainageSourceName(rec) || String(rec.displayName || "").trim();
  }

  function anchorPoint(rec) {
    // Prefer ~60% along actual curve (upper/mid drainage)
    try {
      if (rec.curve?.getPointAt) {
        const p = rec.curve.getPointAt(0.6);
        return new THREE.Vector3(p.x, p.y + 4.5, p.z);
      }
    } catch {
      /* fall through */
    }
    const ordered = rec.orderedPts?.length ? rec.orderedPts : rec.pts;
    const mid = ordered?.[Math.floor((ordered?.length || 1) * 0.6)] || ordered?.[0];
    return new THREE.Vector3(mid?.x || 0, (mid?.y || SURFACE_Y) + 4.5, mid?.z || 0);
  }

  function confluenceAnchor(rec) {
    const bank = rec.connection?.bankPoint;
    const river = rec.connection?.riverPoint;
    const out = rec.outletPoint;
    const x = bank?.x ?? river?.x ?? out?.x;
    const z = bank?.z ?? river?.z ?? out?.z;
    const y = Number.isFinite(out?.y) ? out.y + 2.2 : SURFACE_Y + 2.2;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return new THREE.Vector3(x, y, z);
  }

  // World-anchored labels ONLY for drainages with a real source name
  const items = records
    .filter((rec) => hasDrainageSourceName(rec))
    .map((rec) => {
      const text = labelText(rec);
      if (!text) return null;
      const el = document.createElement("div");
      el.className = "joining-stream-label";
      el.dataset.recId = String(rec.id ?? "");
      el.innerHTML = `
      <span class="joining-stream-label__text">${escapeHtml(text)}</span>
      <span class="joining-stream-label__leader" aria-hidden="true"></span>
    `;
      wrap.appendChild(el);
      return {
        rec,
        el,
        world: anchorPoint(rec),
        ndc: new THREE.Vector3(),
        kind: "name",
      };
    })
    .filter(Boolean);

  const confluenceEl = document.createElement("div");
  confluenceEl.className = "joining-stream-label joining-stream-label--confluence";
  confluenceEl.hidden = true;
  confluenceEl.innerHTML = `
    <span class="joining-stream-label__text">Confluence</span>
    <span class="joining-stream-label__leader" aria-hidden="true"></span>
  `;
  wrap.appendChild(confluenceEl);
  const confluenceItem = {
    el: confluenceEl,
    world: new THREE.Vector3(),
    ndc: new THREE.Vector3(),
    kind: "confluence",
    rec: null,
  };

  function matchRec(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.id != null && b.id != null && String(a.id) === String(b.id)) return true;
    if (a.navIndex != null && b.navIndex != null && a.navIndex === b.navIndex) return true;
    return false;
  }

  function setVisible(on) {
    wrap.style.display = on ? "block" : "none";
  }

  function setSelected(rec) {
    for (const it of items) {
      const on = matchRec(rec, it.rec);
      it.el.classList.toggle("is-selected", on);
      it.el.classList.toggle("is-dim", !!rec && !on);
      // When a drainage is selected, only keep its label + confluence (fewer DOM writes)
      it.el.style.display = !rec || on ? "" : "none";
      if (on) {
        it.world.copy(anchorPoint(it.rec));
        const text = it.el.querySelector(".joining-stream-label__text");
        if (text) text.textContent = labelText(it.rec);
      }
    }

    const cAnchor = rec ? confluenceAnchor(rec) : null;
    if (cAnchor) {
      confluenceItem.rec = rec;
      confluenceItem.world.copy(cAnchor);
      confluenceEl.hidden = false;
      confluenceEl.classList.add("is-selected");
    } else {
      confluenceItem.rec = null;
      confluenceEl.hidden = true;
    }
  }

  let cachedRect = null;
  let cachedRectAt = 0;

  function projectItem(it, camera, rect) {
    it.ndc.copy(it.world).project(camera);
    if (it.ndc.z > 1 || it.el.hidden || it.el.style.display === "none") {
      it.el.style.visibility = "hidden";
      return;
    }
    // Cull off-screen NDC early
    if (it.ndc.x < -1.2 || it.ndc.x > 1.2 || it.ndc.y < -1.2 || it.ndc.y > 1.2) {
      it.el.style.visibility = "hidden";
      return;
    }
    const sx = rect.left + (it.ndc.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-it.ndc.y * 0.5 + 0.5) * rect.height;
    it.el.style.visibility = "visible";
    it.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, calc(-100% - 10px))`;
  }

  function update(camera) {
    if (wrap.style.display === "none") return;
    const now = performance.now();
    if (!cachedRect || now - cachedRectAt > 400) {
      const canvas = camera?.domElement || document.querySelector("canvas");
      cachedRect = canvas?.getBoundingClientRect?.() || {
        left: 0,
        top: 0,
        width: innerWidth,
        height: innerHeight,
      };
      cachedRectAt = now;
    }
    const rect = cachedRect;
    for (const it of items) {
      if (it.el.style.display === "none") continue;
      projectItem(it, camera, rect);
    }
    if (!confluenceEl.hidden) projectItem(confluenceItem, camera, rect);
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
