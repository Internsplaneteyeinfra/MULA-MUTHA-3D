/**
 * FLOODS (1, 2, 3…) — detected flood areas of the loaded flood date, below FLOOD COMPARE.
 *
 * Entries come from apiFloodLayer.getFloodPatches(): the connected areas of the rendered flood
 * extent, each with its area, a point inside it, that point's lat/lon and the nearest river
 * chainage. Clicking an entry moves the chainage bar / camera via the app's chainage-select event,
 * shows "FLOOD n | CH … | LAT … | LONG …" under the chainage bar and a marker in the 3D scene,
 * both for exactly 4 s.
 */
import * as THREE from "three";
import { SURFACE_Y } from "../../scene/river.js";

const STYLE_ID = "flood-list-style";
const HIGHLIGHT_MS = 4000;
const STYLE = `
.flood-list{position:relative;width:100%;box-sizing:border-box;display:flex;flex-direction:column;border-radius:12px;
  color:#e2e8f0;background:rgba(8,18,30,.78);border:1px solid rgba(80,190,220,.22);backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);font:inherit;font-size:11px;line-height:1.35;overflow:hidden;
  box-shadow:0 8px 24px rgba(0,0,0,.28)}
.flood-list[hidden]{display:none!important}
.flood-list__top{display:flex;align-items:center;gap:8px;padding:8px 10px}
.flood-list__head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0;background:transparent;
  border:0;color:inherit;font:inherit;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  cursor:pointer;text-align:left;flex:1;min-width:0}
.flood-list__count{font-weight:600;letter-spacing:.02em;text-transform:none;color:rgba(148,163,184,.95);margin-left:auto;margin-right:8px}
.flood-list__chev{transition:transform .2s;color:#22d3ee}
.flood-list[data-open="true"] .flood-list__chev{transform:rotate(180deg)}
.flood-list__body{display:none;max-height:min(26vh,200px);overflow-y:auto;padding:0 6px 8px}
.flood-list[data-open="true"] .flood-list__body{display:block}
.flood-list__item{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;width:100%;padding:5px 6px;
  border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:11px;text-align:left;cursor:pointer}
.flood-list__item:hover{background:rgba(255,48,48,.12)}
.flood-list__item.is-selected{background:rgba(255,48,48,.2)}
.flood-list__dot{width:8px;height:8px;border-radius:2px;background:#ff3030}
.flood-list__name{font-weight:600;color:#f1f5f9}
.flood-list__meta{color:rgba(148,163,184,.95);font-variant-numeric:tabular-nums}
.flood-locator{position:fixed;left:50%;bottom:max(2px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:40;
  pointer-events:none;white-space:nowrap;
  color:#fff;background:none;font:600 11px/1.15 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.06em;
  font-variant-numeric:tabular-nums;text-shadow:0 1px 3px rgba(0,0,0,.85),0 0 1px rgba(0,0,0,.9);
  opacity:0;transition:opacity .25s ease}
.flood-locator.is-visible{opacity:1}
.flood-locator[hidden]{display:none!important}
.flood-locator .sep{opacity:.6;margin:0 .7em}
`;

/** Marker ring radius: the patch's equivalent-circle radius, bounded so it stays readable. */
function markerRadius(f) {
  return Math.min(140, Math.max(18, Math.sqrt((f.areaHa * 10000) / Math.PI) * 1.2));
}

function nearestStation(stations, x, z) {
  if (!stations?.length) return null;
  let best = stations[0];
  let bd = Infinity;
  for (const s of stations) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

export function mountFloodListPanel(root) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  const panel = document.createElement("aside");
  panel.className = "flood-list";
  panel.dataset.open = "true";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Detected floods");
  panel.innerHTML = `
    <div class="flood-list__top">
      <button type="button" class="flood-list__head" aria-expanded="true">
        <span>Floods (1, 2, 3…)</span><span class="flood-list__count"></span><span class="flood-list__chev" aria-hidden="true">▾</span>
      </button>
    </div>
    <div class="flood-list__body" role="list"></div>`;
  // Directly below FLOOD COMPARE.
  const compare = root.querySelector(".flood-compare");
  if (compare?.nextSibling) root.insertBefore(panel, compare.nextSibling);
  else root.appendChild(panel);

  const head = panel.querySelector(".flood-list__head");
  const body = panel.querySelector(".flood-list__body");
  const countEl = panel.querySelector(".flood-list__count");

  const uiRoot = document.getElementById("ui-root") || document.body;
  const locator = document.createElement("div");
  locator.className = "flood-locator";
  locator.hidden = true;
  locator.setAttribute("aria-live", "polite");
  uiRoot.appendChild(locator);

  let floods = [];
  let selectedId = null;
  let hideTimer = 0;
  let fadeTimer = 0;
  let marker = null;
  let markerRaf = 0;

  head.addEventListener("click", () => {
    const open = panel.dataset.open !== "true";
    panel.dataset.open = String(open);
    head.setAttribute("aria-expanded", String(open));
  });

  const fmtCoord = (v) => (Number.isFinite(v) ? `${v.toFixed(6)}°` : "—");

  function refresh() {
    const layer = window.__MM_SCENE__?.apiFloodLayer;
    floods = layer?.userData?.getFloodPatches?.() || [];
    clearHighlight();
    selectedId = null;
    panel.hidden = floods.length === 0;
    countEl.textContent = floods.length ? `${floods.length} detected` : "";
    body.innerHTML = floods
      .map(
        (f) => `<button type="button" class="flood-list__item" role="listitem" data-flood="${f.id}">
          <span class="flood-list__dot" aria-hidden="true"></span>
          <span class="flood-list__name">Flood ${f.id}</span>
          <span class="flood-list__meta">CH ${f.chainageLabel ?? "—"} · ${f.areaHa.toFixed(2)} ha</span>
        </button>`,
      )
      .join("");
  }

  body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-flood]");
    if (!btn) return;
    const f = floods.find((x) => x.id === Number(btn.dataset.flood));
    if (f) select(f);
  });

  function select(f) {
    selectedId = f.id;
    body.querySelectorAll("[data-flood]").forEach((b) => b.classList.toggle("is-selected", Number(b.dataset.flood) === f.id));
    // Chainage bar + readout follow the canonical selection event; focus:false so the camera does
    // not start the slow along-the-river journey (it would still be travelling when the 4 s ends).
    if (Number.isFinite(f.chainageM)) {
      document.dispatchEvent(
        new CustomEvent("chainage-select", { detail: { meters: f.chainageM, focus: false, source: "flood-list" } }),
      );
    }
    // Camera: one direct flight (~1.6 s) that frames the detected flood point and its marker
    // ring, looking downstream from upstream of it (2D: pans to it).
    const sc = window.__MM_SCENE__;
    const st = nearestStation(sc?.dataset?.corridor?.stations, f.x, f.z);
    const back = markerRadius(f) * 2.2 + 140;
    const fx = st?.flowX ?? 1;
    const fz = st?.flowZ ?? 0;
    sc?.cameraSystem?.focusPose?.({
      toP: { x: f.x - fx * back, y: SURFACE_Y + back * 0.7, z: f.z - fz * back },
      toL: { x: f.x, y: SURFACE_Y, z: f.z },
      dur: 1.6,
    });
    showHighlight(f);
  }

  /** Under the chainage bar: in the gap between the ruler's labels and the bottom edge. */
  function placeLocator() {
    const ruler = document.getElementById("chainage-ruler")?.getBoundingClientRect();
    const vh = window.innerHeight;
    const gap = ruler && ruler.height ? vh - ruler.bottom : 0;
    locator.style.bottom = gap > 18 ? `${Math.round(gap - 16)}px` : "";
  }

  function showHighlight(f) {
    clearHighlight();
    locator.innerHTML = [
      `FLOOD ${f.id}`,
      `CH ${f.chainageLabel ?? "—"}`,
      `LAT ${fmtCoord(f.lat)}`,
      `LONG ${fmtCoord(f.lon)}`,
    ].join('<span class="sep">|</span>');
    placeLocator();
    locator.hidden = false;
    requestAnimationFrame(() => locator.classList.add("is-visible"));
    addMarker(f);
    fadeTimer = window.setTimeout(() => locator.classList.remove("is-visible"), HIGHLIGHT_MS - 250);
    hideTimer = window.setTimeout(clearHighlight, HIGHLIGHT_MS);
  }

  function clearHighlight() {
    window.clearTimeout(hideTimer);
    window.clearTimeout(fadeTimer);
    hideTimer = fadeTimer = 0;
    locator.classList.remove("is-visible");
    locator.hidden = true;
    removeMarker();
  }

  /** Temporary marker: pulsing red ring around the flood area + a vertical beam above its point. */
  function addMarker(f) {
    const scene = window.__MM_SCENE__?.scene;
    if (!scene) return;
    const radius = markerRadius(f);
    const group = new THREE.Group();
    group.name = "floodLocatorMarker";
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.92, radius, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = SURFACE_Y + 1.2;
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.6, depthTest: false, side: THREE.DoubleSide });
    const pulse = new THREE.Mesh(new THREE.RingGeometry(radius * 0.9, radius, 64), pulseMat);
    pulse.rotation.x = -Math.PI / 2;
    pulse.position.y = SURFACE_Y + 1.1;
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 60, 12), beamMat);
    beam.position.y = SURFACE_Y + 31;
    const capMat = new THREE.MeshBasicMaterial({ color: 0xff3030, depthTest: false });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), capMat);
    cap.position.y = SURFACE_Y + 62;
    for (const m of [ring, pulse, beam, cap]) {
      m.renderOrder = 60;
      m.frustumCulled = false;
      group.add(m);
    }
    group.position.set(f.x, 0, f.z);
    scene.add(group);
    marker = group;
    const t0 = performance.now();
    const tick = (now) => {
      if (marker !== group) return;
      const k = ((now - t0) / 1200) % 1;
      pulse.scale.setScalar(1 + k * 0.8);
      pulseMat.opacity = 0.6 * (1 - k);
      markerRaf = requestAnimationFrame(tick);
    };
    markerRaf = requestAnimationFrame(tick);
  }

  function removeMarker() {
    if (markerRaf) cancelAnimationFrame(markerRaf);
    markerRaf = 0;
    if (!marker) return;
    marker.parent?.remove(marker);
    marker.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    marker = null;
  }

  const onReady = () => refresh();
  const onCleared = () => {
    floods = [];
    clearHighlight();
    panel.hidden = true;
    body.innerHTML = "";
  };
  document.addEventListener("flood-geometry-ready", onReady);
  document.addEventListener("flood-geometry-cleared", onCleared);
  window.addEventListener("resize", () => !locator.hidden && placeLocator());

  return {
    el: panel,
    refresh,
    getSelected: () => floods.find((f) => f.id === selectedId) || null,
    dispose() {
      clearHighlight();
      document.removeEventListener("flood-geometry-ready", onReady);
      document.removeEventListener("flood-geometry-cleared", onCleared);
      locator.remove();
      panel.remove();
    },
  };
}
