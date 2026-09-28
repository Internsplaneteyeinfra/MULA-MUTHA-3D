import * as THREE from "three";
import { state } from "../state.js";
import { metersToStation, nearestChainage } from "./chainageMarkers.js";
import { SURFACE_Y } from "./river.js";
import { CHAINAGE_DESTINATIONS, interpolateChainage } from "../geo/chainage.js";

const GENERIC_NAME = /^(road\s+)?bridge$/i;
const LANDMARK_DEDUPE_M = 300;
const LIFT_PX = 42;
const GAP_PX = 8;
const EDGE_PX = 8;
const MAX_DIST_M = 20000;
/** Low, grazing cameras only label nearby landmarks so the horizon doesn't clutter. */
const MIN_RANGE_M = 3000;
const RANGE_PER_HEIGHT = 12;
/** Bridge labels appear within SHOW and disappear beyond HIDE (hysteresis band between). */
export const BRIDGE_LABEL_SHOW_RADIUS = 350;
export const BRIDGE_LABEL_HIDE_RADIUS = 450;
/** Labels shrink from full size at this distance to MIN_SCALE at the hide radius. */
const SCALE_FULL_M = 150;
const MIN_SCALE = 0.88;
const OBSTACLE_REFRESH_MS = 300;
/** Candidate label slots relative to the anchor: [x shift in label widths, stack level]. */
const SLOTS = [
  [0, 0], [0, 1], [-0.6, 0], [0.6, 0], [-0.6, 1], [0.6, 1],
  [0, 2], [-1.15, 0], [1.15, 0], [-1.15, 1], [1.15, 1], [0, 3],
  [0, -1], [-0.6, -1], [0.6, -1], [0, -2], [-0.6, -2], [0.6, -2],
];
const SVG_NS = "http://www.w3.org/2000/svg";
const BRIDGE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 16h20"/><path d="M6 16V7M18 16V7"/><path d="M2 11c2 0 4-4 4-4s3 6 6 6 6-6 6-6 2 4 4 4"/><path d="M9 16v-3M12 16v-3M15 16v-3"/></svg>`;
const PIN_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>`;

/**
 * Screen-space bridge name + chainage labels with greedy collision avoidance.
 * A bridge is labelled only while the camera is near it (show/hide radius hysteresis).
 * Anchors come from the bridge decks built in bridges.js; chainage is the
 * nearest authoritative KML chainage point to each deck centre.
 */
export function createBridgeLabels(bridgesGroup, dataset) {
  const layer = document.createElement("div");
  layer.className = "bridge-label-layer";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("bridge-label-links");
  layer.appendChild(svg);
  document.body.appendChild(layer);

  const chainage = [...(dataset.chainage || [])].sort((a, b) => (a.meters ?? 0) - (b.meters ?? 0));
  const items = [];

  function addItem(kind, name, meters, world) {
    const el = document.createElement("div");
    el.className = `bridge-label bridge-label--${kind}`;
    el.innerHTML = `<span class="bridge-label__icon">${kind === "bridge" ? BRIDGE_ICON : PIN_ICON}</span>
      <span class="bridge-label__text"><b></b>${meters != null ? "<small></small>" : ""}</span>`;
    el.querySelector("b").textContent = name;
    if (meters != null) el.querySelector("small").textContent = metersToStation(meters);
    layer.appendChild(el);

    const link = document.createElementNS(SVG_NS, "line");
    link.classList.add("bridge-label-link");
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.classList.add("bridge-label-dot");
    dot.setAttribute("r", kind === "bridge" ? "4" : "3.2");
    svg.append(link, dot);

    items.push({ kind, name, meters, world, el, link, dot, w: 0, h: 0, slot: 0, shown: false, near: false, dist: Infinity });
  }

  const seen = new Set();
  for (const src of bridgesGroup.userData.labels || []) {
    const name = String(src.fullName || "").trim();
    if (!name || GENERIC_NAME.test(name) || seen.has(name)) continue;
    seen.add(name);
    const near = nearestChainage(src.x, src.z, chainage);
    addItem("bridge", name, near?.meters ?? null, new THREE.Vector3(src.x, src.deckY + 2, src.z));
  }
  const bridges = items.slice();
  for (const dest of CHAINAGE_DESTINATIONS) {
    const repeatsBridge = bridges.some((b) =>
      b.meters != null && Math.abs(b.meters - dest.chainage_m) < LANDMARK_DEDUPE_M &&
      b.name.toLowerCase().startsWith(dest.name.toLowerCase()));
    const p = repeatsBridge ? null : interpolateChainage(chainage, dest.chainage_m);
    if (p) addItem("landmark", dest.name, dest.chainage_m, new THREE.Vector3(p.x, SURFACE_Y + 1, p.z));
  }

  let obstacles = [];
  let obstacleAt = -Infinity;
  let sizeDirty = true;
  window.addEventListener("resize", () => { sizeDirty = true; obstacleAt = -Infinity; });

  const v = new THREE.Vector3();

  function collectObstacles(vw, vh) {
    const out = [];
    const root = document.getElementById("ui-root");
    const push = (node) => {
      if (!node || node.hidden) return;
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.width * r.height > vw * vh * 0.5) return;
      out.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    };
    for (const node of root?.children || []) push(node);
    for (const node of document.querySelectorAll(".chainage-destination-marker:not([hidden]) .chainage-destination-banner")) push(node);
    return out;
  }

  function hide(it) {
    if (!it.shown) return;
    it.shown = false;
    it.el.classList.remove("is-visible");
    it.link.classList.remove("is-visible");
    it.dot.classList.remove("is-visible");
  }

  /** Real-world distance to a bridge: camera → deck in scene metres, else canonical chainage gap. */
  function bridgeDistance(it, camera) {
    const p = camera?.position;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
      return p.distanceTo(it.world);
    }
    const sel = state.selectedChainageMeters;
    if (sel != null && it.meters != null) return Math.abs(sel - it.meters);
    return Infinity;
  }

  function updateProximity(it, camera) {
    it.dist = bridgeDistance(it, camera);
    if (it.dist <= BRIDGE_LABEL_SHOW_RADIUS) it.near = true;
    else if (it.dist >= BRIDGE_LABEL_HIDE_RADIUS) it.near = false;
    return it.near;
  }

  function update(camera) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const enabled = !!camera && bridgesGroup.visible && !state.cinematicActive &&
      state.showBridges !== false && state.showBridgeNames !== false;
    layer.hidden = !enabled;
    if (!enabled) {
      for (const it of items) {
        hide(it);
        it.near = false;
      }
      return;
    }

    if (sizeDirty) {
      for (const it of items) {
        it.w = it.el.offsetWidth;
        it.h = it.el.offsetHeight;
      }
      sizeDirty = items.some((it) => !it.w);
    }
    const now = performance.now();
    if (now - obstacleAt > OBSTACLE_REFRESH_MS) {
      obstacles = collectObstacles(vw, vh);
      obstacleAt = now;
    }
    svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);

    const overview = state.cameraMode === "overview";
    const maxDist = Math.min(MAX_DIST_M, Math.max(MIN_RANGE_M, camera.position.y * RANGE_PER_HEIGHT));
    const cands = [];
    for (const it of items) {
      if (it.kind === "landmark" ? !overview : !updateProximity(it, camera)) {
        hide(it);
        continue;
      }
      const dist = camera.position.distanceTo(it.world);
      v.copy(it.world).project(camera);
      const ax = (v.x * 0.5 + 0.5) * vw;
      const ay = (1 - (v.y * 0.5 + 0.5)) * vh;
      if ((it.kind === "landmark" && dist > maxDist) || v.z > 1 || v.z < -1 || ax < 0 || ax > vw || ay < 0 || ay > vh) {
        hide(it);
        continue;
      }
      cands.push({ it, ax, ay, dist });
    }
    cands.sort((a, b) => (a.it.kind === b.it.kind ? a.dist - b.dist : a.it.kind === "bridge" ? -1 : 1));

    const maxLandmarks = vw < 640 ? 4 : vw < 1024 ? 6 : Infinity;
    let landmarksShown = 0;
    const placed = [];
    const links = [];
    for (const c of cands) {
      const { it, ax, ay } = c;
      const isBridge = it.kind === "bridge";
      if (!it.w || insideAny(ax, ay, obstacles) || (!isBridge && landmarksShown >= maxLandmarks)) {
        hide(it);
        continue;
      }
      // Nearby bridges are never dropped for label crowding: relax the connector-crossing rule if needed.
      const passes = isBridge ? [0, 1] : [0];
      let rect = null;
      let link = null;
      for (const pass of passes) {
        for (const s of [it.slot, ...SLOTS.keys()]) {
          const [fx, level] = SLOTS[s];
          const x0 = ax - it.w / 2 + fx * it.w;
          const y0 = level >= 0
            ? ay - LIFT_PX - level * (it.h + GAP_PX) - it.h
            : ay + LIFT_PX * 0.6 + (-1 - level) * (it.h + GAP_PX);
          const r = { x0, y0, x1: x0 + it.w, y1: y0 + it.h };
          if (r.x0 < EDGE_PX || r.x1 > vw - EDGE_PX || r.y0 < EDGE_PX || r.y1 > vh - EDGE_PX) continue;
          if (overlapsAny(r, placed, GAP_PX / 2) || overlapsAny(r, obstacles, 4)) continue;
          const l = {
            x0: ax, y0: ay,
            x1: Math.min(Math.max(ax, r.x0 + 12), r.x1 - 12),
            y1: level >= 0 ? r.y1 : r.y0,
          };
          if (pass < 1 && (links.some((o) => segmentHitsRect(o, r)) || placed.some((o) => segmentHitsRect(l, o)))) continue;
          rect = r;
          link = l;
          it.slot = s;
          break;
        }
        if (rect) break;
      }
      if (!rect) {
        hide(it);
        continue;
      }
      placed.push(rect);
      links.push(link);
      if (!isBridge) landmarksShown++;
      const scale = isBridge ? proximityScale(c.dist) : 1;
      const above = SLOTS[it.slot][1] >= 0;
      const inset = (it.w * (1 - scale)) / 2 + 12;
      link.x1 = Math.min(Math.max(ax, rect.x0 + inset), rect.x1 - inset);
      it.shown = true;
      it.el.classList.add("is-visible");
      it.el.style.transformOrigin = above ? "50% 100%" : "50% 0";
      it.el.style.transform = `translate(${Math.round(rect.x0)}px, ${Math.round(rect.y0)}px)${scale < 1 ? ` scale(${scale.toFixed(3)})` : ""}`;
      it.link.classList.add("is-visible");
      it.link.setAttribute("x1", link.x0.toFixed(1));
      it.link.setAttribute("y1", link.y0.toFixed(1));
      it.link.setAttribute("x2", link.x1.toFixed(1));
      it.link.setAttribute("y2", link.y1.toFixed(1));
      it.dot.classList.add("is-visible");
      it.dot.setAttribute("cx", ax.toFixed(1));
      it.dot.setAttribute("cy", ay.toFixed(1));
    }
  }

  return {
    update,
    items: () => items.map(({ kind, name, meters, shown, near, dist }) => ({ kind, name, meters, shown, near, dist })),
  };
}

function proximityScale(dist) {
  const t = (dist - SCALE_FULL_M) / (BRIDGE_LABEL_HIDE_RADIUS - SCALE_FULL_M);
  return 1 - (1 - MIN_SCALE) * Math.min(1, Math.max(0, t));
}

function overlapsAny(r, list, pad) {
  for (const o of list) {
    if (r.x0 < o.x1 + pad && r.x1 > o.x0 - pad && r.y0 < o.y1 + pad && r.y1 > o.y0 - pad) return true;
  }
  return false;
}

/** Sampled test: does segment (x0,y0)→(x1,y1) pass through rect r (excluding its endpoints' edge)? */
function segmentHitsRect(s, r) {
  for (let i = 1; i < 12; i++) {
    const t = i / 12;
    const x = s.x0 + (s.x1 - s.x0) * t;
    const y = s.y0 + (s.y1 - s.y0) * t;
    if (x > r.x0 + 1 && x < r.x1 - 1 && y > r.y0 + 1 && y < r.y1 - 1) return true;
  }
  return false;
}

function insideAny(x, y, list) {
  for (const o of list) {
    if (x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1) return true;
  }
  return false;
}
