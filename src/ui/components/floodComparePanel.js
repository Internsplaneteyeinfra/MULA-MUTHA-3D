import { state } from "../../state.js";

const STYLE_ID = "flood-compare-style";
const STYLE = `
/* Left zone ends where the centred navigation block begins (≈158px each side of centre, +gap). */
#ui-root.gis-ui .flood-result-panel,#ui-root.gis-ui.api-flood-mode .flood-result-panel{box-sizing:border-box;min-width:0;width:min(300px,max(216px,calc(50vw - 182px)))}
.flood-compare{position:fixed;left:12px;bottom:112px;z-index:26;width:min(256px,calc(100vw - 24px));
  max-height:min(62vh,520px);box-sizing:border-box;display:flex;flex-direction:column;border-radius:12px;color:#e2e8f0;
  background:rgba(12,18,28,.88);border:1px solid rgba(148,163,184,.22);backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);font:inherit;font-size:11px;line-height:1.35;overflow:hidden}
.flood-compare[hidden],.flood-legend[hidden],.flood-compare[data-crowded="true"]{display:none!important}
.flood-compare__head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;
  background:transparent;border:0;color:inherit;font:inherit;font-size:10px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;cursor:pointer;text-align:left;width:100%}
.flood-compare__chev{transition:transform .2s}
.flood-compare[data-open="true"] .flood-compare__chev{transform:rotate(180deg)}
.flood-compare__body{display:none;overflow-y:auto;padding:0 12px 10px;min-height:0}
.flood-compare[data-open="true"] .flood-compare__body{display:block}
.flood-compare details{border-top:1px solid rgba(148,163,184,.16);padding:6px 0}
.flood-compare summary{cursor:pointer;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;
  color:rgba(226,232,240,.9);list-style:none;display:flex;justify-content:space-between;align-items:center}
.flood-compare summary::-webkit-details-marker{display:none}
.flood-compare__canvas{display:block;width:100%;height:auto;margin-top:6px;border-radius:6px;background:rgba(197,208,188,.12)}
.flood-compare__grid{display:grid;grid-template-columns:1fr;gap:6px;margin-top:6px}
.flood-compare__cell{position:relative}
.flood-compare__cell span{position:absolute;left:5px;top:3px;font-size:9px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000}
.flood-compare__hint{margin:6px 0 0;color:rgba(226,232,240,.65)}
.flood-compare__act{margin-top:6px;width:100%;padding:6px 8px;border-radius:8px;cursor:pointer;font:inherit;font-size:10px;
  font-weight:600;color:#e2e8f0;background:rgba(79,200,235,.16);border:1px solid rgba(79,200,235,.4)}
.flood-compare__act:hover{background:rgba(79,200,235,.26)}
.flood-legend{position:fixed;right:84px;bottom:112px;z-index:18;box-sizing:border-box;max-width:min(200px,45vw);white-space:nowrap;padding:7px 10px;
  border-radius:8px;background:rgba(8,22,31,.42);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(8px);
  color:rgba(235,245,250,.92);font-size:10px;line-height:1.5;text-shadow:0 1px 3px rgba(0,0,0,.85)}
.flood-legend strong{display:block;font-size:9px;letter-spacing:.12em;margin-bottom:3px}
.flood-legend i{display:inline-block;width:12px;height:8px;border-radius:2px;margin-right:6px;vertical-align:middle}
@media (max-width:1100px){.flood-legend .fl-val{display:none}}
`;

function bboxOf(xs, zs) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (zs[i] < minZ) minZ = zs[i];
    if (zs[i] > maxZ) maxZ = zs[i];
  }
  return { minX, maxX, minZ, maxZ };
}

/** World → canvas, north-up (scene +Z = north). */
function makeProjector(box, w, h, padM) {
  const spanX = Math.max(40, box.maxX - box.minX + padM * 2);
  const spanZ = Math.max(40, box.maxZ - box.minZ + padM * 2);
  const k = Math.min(w / spanX, h / spanZ);
  const ox = (w - (box.maxX - box.minX) * k) / 2 - box.minX * k;
  const oz = (h - (box.maxZ - box.minZ) * k) / 2;
  return { k, x: (x) => x * k + ox, y: (z) => h - ((z - box.minZ) * k + oz), pad: padM };
}

/** Fit canvas height to the flood extent's aspect so long, thin floods fill the strip. */
function fitCanvas(c, box, padM) {
  const spanX = Math.max(40, box.maxX - box.minX + padM * 2);
  const spanZ = Math.max(40, box.maxZ - box.minZ + padM * 2);
  c.height = Math.round(Math.min(220, Math.max(64, (c.width * spanZ) / spanX)));
}

function drawRiverRing(ctx, ring, proj, box) {
  if (!ring?.length) return;
  const m = proj.pad * 2;
  ctx.strokeStyle = "#3f9bff";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  let prev = null;
  for (const c of [...ring, ring[0]]) {
    const near =
      c.x > box.minX - m && c.x < box.maxX + m && c.z > box.minZ - m && c.z < box.maxZ + m;
    const jump = prev && Math.hypot(c.x - prev.x, c.z - prev.z) > 250;
    if (near && prev && !jump) ctx.lineTo(proj.x(c.x), proj.y(c.z));
    else ctx.moveTo(proj.x(c.x), proj.y(c.z));
    prev = c;
  }
  ctx.stroke();
}

function drawPerimeter(ctx, data, proj, alpha = 1) {
  if (!data.segs) return;
  ctx.strokeStyle = `rgba(255,48,48,${alpha})`;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  const s = data.segs;
  for (let i = 0; i < s.length; i += 4) {
    ctx.moveTo(proj.x(s[i]), proj.y(s[i + 1]));
    ctx.lineTo(proj.x(s[i + 2]), proj.y(s[i + 3]));
  }
  ctx.stroke();
}

function drawFlood(ctx, data, proj, p) {
  const front = data.frontAt(p);
  const cell = Math.max(2.2, 8 * proj.k);
  ctx.fillStyle = "rgba(255,48,48,.8)";
  for (let i = 0; i < data.xs.length; i++) {
    if (data.ds[i] > front) continue;
    ctx.fillRect(proj.x(data.xs[i]) - cell / 2, proj.y(data.zs[i]) - cell / 2, cell, cell);
  }
}

export function mountFloodComparePanel(root, { dataset }) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  const panel = document.createElement("aside");
  panel.className = "flood-compare";
  panel.dataset.open = "false";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Flood comparison");
  panel.innerHTML = `
    <button type="button" class="flood-compare__head" aria-expanded="false">
      <span>Flood compare</span><span class="flood-compare__chev" aria-hidden="true">▾</span>
    </button>
    <div class="flood-compare__body">
      <details open>
        <summary>Exact KML geometry · 2D</summary>
        <canvas class="flood-compare__canvas" id="fc-geom" width="440" height="120"></canvas>
        <p class="flood-compare__hint" id="fc-geom-hint"></p>
      </details>
      <details open>
        <summary>Flood progression</summary>
        <div class="flood-compare__grid" id="fc-prog"></div>
      </details>
      <details>
        <summary>Close-up animated river</summary>
        <p class="flood-compare__hint">Flies to ground level at the selected chainage; the flow shader keeps animating.</p>
        <button type="button" class="flood-compare__act" id="fc-closeup">Fly to close-up</button>
      </details>
      <details>
        <summary>Ground-level navigation</summary>
        <p class="flood-compare__hint">Follows the river centreline at a valid height above terrain.</p>
        <button type="button" class="flood-compare__act" id="fc-journey">Follow the river</button>
      </details>
    </div>`;
  root.appendChild(panel);

  const legend = document.createElement("aside");
  legend.className = "flood-legend";
  legend.hidden = true;
  legend.setAttribute("aria-label", "Flood area legend");
  root.appendChild(legend);

  const head = panel.querySelector(".flood-compare__head");
  const geomCanvas = panel.querySelector("#fc-geom");
  const geomHint = panel.querySelector("#fc-geom-hint");
  const progHost = panel.querySelector("#fc-prog");
  const STEPS = [0, 0.25, 0.5, 1];
  const progCanvases = STEPS.map((p) => {
    const cell = document.createElement("div");
    cell.className = "flood-compare__cell";
    cell.innerHTML = `<canvas class="flood-compare__canvas" width="440" height="120"></canvas><span>${Math.round(p * 100)}%</span>`;
    progHost.appendChild(cell);
    return cell.querySelector("canvas");
  });


  /**
   * Layout zones are measured, not hard-coded: the legend sits directly above the Water Depth
   * legend, and the compare panel fits between the Flood Result panel (top) and the ruler (bottom).
   */
  const GAP = 10;
  const visibleRect = (el) => {
    if (!el || el.hidden || el.closest("[hidden]")) return null;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };
  let layoutRaf = 0;
  function layout() {
    layoutRaf = 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ruler = visibleRect(document.getElementById("chainage-ruler"));
    const clearBottom = ruler ? vh - ruler.top + GAP : 112;

    // Compare panel: between Flood Result (top) and ruler (bottom).
    const result = visibleRect(document.getElementById("flood-result-panel"));
    const topLimit = result ? result.bottom + GAP : 72;
    panel.style.bottom = `${Math.round(clearBottom)}px`;
    panel.style.maxHeight = `${Math.max(44, Math.round(vh - clearBottom - topLimit))}px`;
    // Not enough room beside the centred playback panel → drop this secondary panel entirely.
    const pb = visibleRect(document.getElementById("flood-playback"));
    const pr = panel.getBoundingClientRect();
    panel.dataset.crowded = pb && !panel.hidden && pb.left < 12 + pr.width + GAP ? "true" : "false";

    // Flood legend: same right edge as the depth legend, stacked directly above it.
    const dl = visibleRect(document.getElementById("depth-legend"));
    if (dl) {
      legend.style.right = `${Math.max(0, Math.round(vw - dl.right))}px`;
      legend.style.bottom = `${Math.round(vh - dl.top + GAP)}px`;
    } else {
      legend.style.right = "12px";
      legend.style.bottom = `${Math.round(clearBottom)}px`;
    }
  }
  const scheduleLayout = () => {
    if (!layoutRaf) layoutRaf = requestAnimationFrame(layout);
  };
  window.addEventListener("resize", scheduleLayout);
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(scheduleLayout);
    for (const id of ["chainage-ruler", "flood-result-panel", "flood-playback", "depth-legend"]) {
      const el = document.getElementById(id);
      if (el) ro.observe(el);
    }
    // Panels mounted later (depth legend, playback) are picked up when the UI settles.
    setTimeout(() => {
      for (const id of ["chainage-ruler", "flood-result-panel", "flood-playback", "depth-legend"]) {
        const el = document.getElementById(id);
        if (el) ro.observe(el);
      }
      scheduleLayout();
    }, 1500);
  }

  let dirty = true;
  const layer = () => window.__MM_SCENE__?.apiFloodLayer;

  function setOpen(open) {
    panel.dataset.open = open ? "true" : "false";
    head.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) render();
    scheduleLayout();
  }
  head.addEventListener("click", () => setOpen(panel.dataset.open !== "true"));

  function clearCanvas(c, msg) {
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    if (msg) {
      ctx.fillStyle = "rgba(226,232,240,.6)";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(msg, c.width / 2, c.height / 2);
    }
  }

  function render() {
    if (panel.dataset.open !== "true" || !dirty) return;
    const data = layer()?.userData?.getThumbnailData?.();
    if (!data || !data.xs.length) {
      clearCanvas(geomCanvas, "Select an available date");
      progCanvases.forEach((c) => clearCanvas(c, "—"));
      geomHint.textContent = "";
      return;
    }
    dirty = false;
    const box = bboxOf(data.xs, data.zs);
    const ring = dataset.ringLocal || [];

    fitCanvas(geomCanvas, box, 140);
    let ctx = geomCanvas.getContext("2d");
    ctx.clearRect(0, 0, geomCanvas.width, geomCanvas.height);
    let proj = makeProjector(box, geomCanvas.width, geomCanvas.height, 140);
    drawRiverRing(ctx, ring, proj, box);
    drawPerimeter(ctx, data, proj);
    geomHint.textContent = "Blue: KML river polygon · Red: flood perimeter (same geometry as the 3D scene).";

    progCanvases.forEach((c, i) => {
      fitCanvas(c, box, 90);
      ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      proj = makeProjector(box, c.width, c.height, 90);
      drawFlood(ctx, data, proj, STEPS[i]);
      drawRiverRing(ctx, ring, proj, box);
      drawPerimeter(ctx, data, proj, STEPS[i] >= 1 ? 1 : 0.35);
    });
  }

  function syncLegend() {
    const L = layer();
    const has = !!L?.userData?.hasFlood;
    legend.hidden = !has;
    if (!has) return;
    scheduleLayout();
    const info = L.userData.getInfo?.() || {};
    const fl = Number(info.flood_area_ha);
    const wa = Number(info.water_area_ha);
    legend.innerHTML = `<strong>FLOOD AREA</strong>
      <div><i style="background:rgba(255,48,48,.65);border:1px solid #ff3030"></i>Flood extent<span class="fl-val">${Number.isFinite(fl) && fl > 0 ? ` · ${fl.toFixed(2)} ha (API)` : ""}</span></div>
      <div><i style="background:rgba(63,155,255,.55);border:1px solid #3f9bff"></i>River water<span class="fl-val">${Number.isFinite(wa) && wa > 0 ? ` · ${wa.toFixed(2)} ha` : ""}</span></div>`;
  }

  document.addEventListener("flood-geometry-ready", () => {
    dirty = true;
    syncLegend();
    render();
    scheduleLayout();
  });
  document.addEventListener("flood-geometry-cleared", () => {
    dirty = true;
    legend.hidden = true;
    render();
  });

  const sync = () => {
    const show = root.classList.contains("flood-sim-open");
    panel.hidden = !show;
    if (show) {
      syncLegend();
      render();
    }
    scheduleLayout();
  };
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["class"] });
  sync();

  panel.querySelector("#fc-closeup").addEventListener("click", () => {
    const ch = dataset.chainage || [];
    const mid = ch.length ? ch[0].meters + (ch[ch.length - 1].meters - ch[0].meters) / 2 : 8000;
    window.__MM_SCENE__?.goToChainageView?.(state.selectedChainageMeters ?? mid);
  });
  panel.querySelector("#fc-journey").addEventListener("click", () => {
    window.__MM_SCENE__?.exploreRiver?.();
  });

  return { el: panel, legend, refresh: () => { dirty = true; render(); } };
}
