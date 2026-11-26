/** Compact bottom pollution bar. The ranked list stays off the river; prev/next walks the same 12 sites. */
const BUG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.2l1.7 2.9h3.4v3.4L20 10.2 18.8 12 20 13.8l-2.9 1.7v3.4h-3.4L12 21.8l-1.7-2.9H6.9v-3.4L4 13.8 5.2 12 4 10.2l2.9-1.7V5.1h3.4L12 2.2zM12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z"/></svg>`;
const FLASK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 2h6v2h-1v5.1l4.6 7.6A3.2 3.2 0 0 1 15.9 22H8.1a3.2 3.2 0 0 1-2.7-5.3L10 9.1V4H9V2z"/></svg>`;
const LEAF = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 19c8-.8 13-7.2 14-15.2C11 5 6.2 10.2 5 19zm2.4-2.1C8.6 12.4 12.2 8.6 16.8 7 15.2 11.2 12.2 14.6 7.4 16.9z"/></svg>`;
const ATOM = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 10.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM12 3c2.8 3.2 4.2 6.2 4.2 9S14.8 17.8 12 21c-2.8-3.2-4.2-6.2-4.2-9S9.2 6.2 12 3zm0 0c3.2 2.8 6.2 4.2 9 4.2S15.2 9.2 12 12c-3.2-2.8-6.2-4.2-9-4.2S8.8 5.8 12 3z"/></svg>`;
const TUBE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 2h2.2v10.2a4.2 4.2 0 1 0 3.6 0V2H16v10.6a6.2 6.2 0 1 1-8 0V2z"/></svg>`;
const STACK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 7.2 12 3l8 4.2-8 4.2L4 7.2zm0 4.8 8 4.2 8-4.2v2.2L12 18.4 4 14.2V12zm0 4.6 8 4.2 8-4.2v2.2L12 23l-8-4.2v-2.2z"/></svg>`;

export function mountPollutionHotspotPanel(root) {
  const el = document.createElement("aside");
  el.className = "poll-hotspot-panel map-chrome";
  el.id = "pollution-hotspot-panel";
  el.hidden = true;

  const dock = document.createElement("section");
  dock.className = "php-dock map-chrome";
  dock.id = "pollution-hotspot-dock";
  dock.hidden = true;
  dock.setAttribute("aria-label", "Selected pollution hotspot");

  root.appendChild(el);
  root.appendChild(dock);

  let open = false;
  let data = null;
  let selected = null;

  function sourceStatus(h) {
    if (!h) return "N/A";
    if (h.bodCodSource === "live") return "LIVE OBSERVED";
    if (h.bodCodSource === "recent") return "SOURCE OBSERVATION";
    if (Number.isFinite(Number(h.maxBod)) || Number.isFinite(Number(h.maxCod))) return "SOURCE OBSERVATION";
    if (h.eutrophication || h.nitrogen || h.coliform) return "CLASSIFIED";
    return "N/A";
  }

  function phrase(layer, suffix) {
    const label = layer?.classLabel;
    if (!label) return "N/A";
    const text = String(label).trim();
    if (!suffix || new RegExp(suffix, "i").test(text)) return text;
    return `${text} ${suffix}`;
  }

  function tone(kind, text) {
    const s = String(text || "").toLowerCase();
    if (!text || s === "n/a") return "is-na";
    if (kind === "source") {
      if (s.includes("live")) return "is-live";
      if (s.includes("source") || s.includes("recent")) return "is-source";
      if (s.includes("class")) return "is-mid";
      return "is-na";
    }
    if (/hyper|extreme|highly|severe/.test(s)) return "is-hot";
    if (kind === "nitrogen" && /high/.test(s)) return "is-high";
    if (/high/.test(s)) return "is-hot";
    if (/moderate|medium|meso/.test(s)) return "is-mid";
    if (/low|good|oligo/.test(s)) return "is-ok";
    return "is-mid";
  }

  function paintDock(h) {
    const list = data?.hotspots || [];
    if (!h) {
      dock.innerHTML = "";
      return;
    }
    const eutro = phrase(h.eutrophication, "");
    const nitro = phrase(h.nitrogen, "nitrogen risk");
    const coli = phrase(h.coliform, "coliform");
    const source = sourceStatus(h);
    dock.innerHTML = `
      <div class="php-cell php-nav">
        <span class="php-badge" aria-hidden="true">${BUG}</span>
        <div class="php-nav-copy">
          <strong>RANK ${h.rank} / ${list.length}</strong>
          <em>${list.length} Sites</em>
        </div>
        <div class="php-steps">
          <button type="button" class="php-step" data-step="-1" aria-label="Previous hotspot">‹</button>
          <button type="button" class="php-step" data-step="1" aria-label="Next hotspot">›</button>
        </div>
      </div>
      <div class="php-cell php-measure">
        <span class="php-ico" aria-hidden="true">${FLASK}</span>
        <div>
          <span class="php-label">BOD</span>
          <span class="php-value">${num(h.maxBod ?? h.bod)} <small>mg/L</small></span>
        </div>
      </div>
      <div class="php-cell php-measure">
        <span class="php-ico" aria-hidden="true">${FLASK}</span>
        <div>
          <span class="php-label">COD</span>
          <span class="php-value">${num(h.maxCod ?? h.cod)} <small>mg/L</small></span>
        </div>
      </div>
      <div class="php-cell php-class">
        <span class="php-ico is-algae" aria-hidden="true">${LEAF}</span>
        <div>
          <span class="php-label">Eutrophication</span>
          <b class="php-pill ${tone("eutro", eutro)}">${escapeHtml(eutro)}</b>
        </div>
      </div>
      <div class="php-cell php-class">
        <span class="php-ico is-nitro" aria-hidden="true">${ATOM}</span>
        <div>
          <span class="php-label">Nitrogen Risk</span>
          <b class="php-pill ${tone("nitrogen", nitro)}">${escapeHtml(nitro)}</b>
        </div>
      </div>
      <div class="php-cell php-class">
        <span class="php-ico is-coli" aria-hidden="true">${TUBE}</span>
        <div>
          <span class="php-label">Coliform Risk</span>
          <b class="php-pill ${tone("coliform", coli)}">${escapeHtml(coli)}</b>
        </div>
      </div>
      <div class="php-cell php-source">
        <span class="php-ico" aria-hidden="true">${STACK}</span>
        <div>
          <span class="php-label">Source</span>
          <b class="php-pill ${tone("source", source)}">${escapeHtml(source)}</b>
        </div>
      </div>`;
    dock.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", () => step(Number(btn.dataset.step)));
    });
  }

  function selectHotspot(h) {
    selected = h || null;
    paintDock(h);
  }

  function step(dir) {
    const list = data?.hotspots || [];
    if (!list.length) return;
    const idx = list.findIndex((x) => x.id === selected?.id);
    const next = list[(Math.max(0, idx) + dir + list.length) % list.length];
    selectHotspot(next);
    window.__MM_SCENE__?.focusPollutionHotspot?.(next.id || next.rank);
  }

  function render() {
    el.hidden = true;
    const list = data?.hotspots || [];
    if (!list.length) {
      dock.hidden = false;
      dock.innerHTML = `<p class="php-empty">DATA UNAVAILABLE</p>`;
      return;
    }
    dock.hidden = false;
    if (!selected) selected = list[0];
    const current = list.find((x) => x.id === selected?.id) || list[0];
    selectHotspot(current);
  }

  function show(payload) {
    open = true;
    if (payload) data = payload;
    selected = data?.hotspots?.[0] || null;
    render();
  }

  function hide() {
    open = false;
    selected = null;
    el.hidden = true;
    dock.hidden = true;
    dock.innerHTML = "";
    window.__MM_NAV__?.setPollutionHotspotPressed?.(false);
    window.__MM_SCENE__?.setPollutionHotspotsVisible?.(false);
  }

  document.addEventListener("pollution-hotspots-updated", (e) => {
    if (e.detail?.data) data = e.detail.data;
    if (open) render();
  });

  document.addEventListener("pollution-hotspot-select", (e) => {
    if (!open || !data?.hotspots) return;
    const h = data.hotspots.find((x) => x.id === e.detail?.id || x.rank === e.detail?.rank);
    if (h && h.id !== selected?.id) selectHotspot(h);
    else if (h) paintDock(h);
  });

  return { el, dock, show, hide, isOpen: () => open };
}

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v).toFixed(2) : "N/A";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
