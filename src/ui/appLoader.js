/**
 * Compact PLANET.EYE AI app loader — cyan droplet + ring.
 * Scene and controls stay interactive underneath (pointer-events: none).
 */

const STATUS = {
  river: "Loading River Data",
  terrain: "Loading Terrain",
  flood: "Processing Flood Simulation",
  sync: "Synchronizing Data",
  scene: "Building Scene",
  ready: "Ready",
};

/** @type {HTMLElement | null} */
let el = null;
/** @type {HTMLElement | null} */
let msgEl = null;
/** @type {HTMLElement | null} */
let barEl = null;
/** @type {HTMLElement | null} */
let barFill = null;
/** @type {Map<string, { message: string, progress: number | null }>} */
const ops = new Map();
let hideTimer = 0;

function ensureMounted() {
  if (el && document.body.contains(el)) return el;
  let host = document.getElementById("app-loader");
  if (!host) {
    host = document.createElement("div");
    host.id = "app-loader";
    host.className = "app-loader";
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-busy", "false");
    host.hidden = true;
    host.innerHTML = `
      <div class="app-loader__chip">
        <div class="app-loader__mark" aria-hidden="true">
          <span class="app-loader__ring"></span>
          <span class="app-loader__ripple"></span>
          <span class="app-loader__ripple app-loader__ripple--delay"></span>
          <svg class="app-loader__drop" viewBox="0 0 24 24" width="18" height="18">
            <path fill="currentColor" d="M12 2.2C12 2.2 5.5 10.1 5.5 14.2a6.5 6.5 0 0 0 13 0C18.5 10.1 12 2.2 12 2.2z"/>
          </svg>
        </div>
        <div class="app-loader__copy">
          <span class="app-loader__msg" id="app-loader-msg">Loading…</span>
          <div class="app-loader__bar" id="app-loader-bar" hidden>
            <i id="app-loader-bar-fill"></i>
          </div>
        </div>
      </div>
    `;
    const app = document.getElementById("app") || document.body;
    app.appendChild(host);
  }
  el = host;
  msgEl = host.querySelector("#app-loader-msg");
  barEl = host.querySelector("#app-loader-bar");
  barFill = host.querySelector("#app-loader-bar-fill");
  return el;
}

function activeOp() {
  // Prefer flood > sync > terrain > river > first
  const order = ["flood", "sync", "terrain", "river", "scene", "boot"];
  for (const id of order) {
    if (ops.has(id)) return { id, ...ops.get(id) };
  }
  const first = ops.entries().next().value;
  return first ? { id: first[0], ...first[1] } : null;
}

function paint() {
  ensureMounted();
  const op = activeOp();
  if (!op) {
    el.classList.remove("is-visible", "is-error");
    el.setAttribute("aria-busy", "false");
    el.hidden = true;
    if (barEl) barEl.hidden = true;
    return;
  }
  el.hidden = false;
  el.classList.add("is-visible");
  el.classList.toggle("is-error", !!op.error);
  el.setAttribute("aria-busy", op.error ? "false" : "true");
  if (msgEl) msgEl.textContent = op.message || STATUS.sync;
  const hasProg = Number.isFinite(op.progress) && op.progress >= 0;
  if (barEl) barEl.hidden = !hasProg;
  if (hasProg && barFill) {
    barFill.style.width = `${Math.max(0, Math.min(100, op.progress * 100))}%`;
  }
}

/**
 * Map verbose pipeline text → short status labels.
 * @param {string} [raw]
 */
export function normalizeLoaderMessage(raw = "") {
  const s = String(raw).toLowerCase();
  if (/flood|jalnetra|inundat/.test(s)) return STATUS.flood;
  if (/terrain|fabdem|dtm|dem|building|vegetation|road/.test(s)) return STATUS.terrain;
  if (/sync|weather|discharge|live|telemetry|finalis|ready/.test(s)) return STATUS.sync;
  if (/river|bathym|csv|kml|corridor|depth|bridge|drainage|excel/.test(s)) return STATUS.river;
  if (/scene|geographic|world/.test(s)) return STATUS.scene;
  return raw?.trim() || STATUS.sync;
}

/**
 * @param {string} id
 * @param {{ message?: string, progress?: number | null }} [opts]
 */
export function showLoader(id, opts = {}) {
  clearTimeout(hideTimer);
  const message = normalizeLoaderMessage(opts.message || STATUS[id] || STATUS.sync);
  const prev = ops.get(id);
  ops.set(id, {
    message,
    progress: opts.progress !== undefined ? opts.progress : prev?.progress ?? null,
    error: false,
  });
  paint();
}

/**
 * @param {string} id
 * @param {{ message?: string, progress?: number | null }} [opts]
 */
export function updateLoader(id, opts = {}) {
  if (!ops.has(id)) {
    showLoader(id, opts);
    return;
  }
  const cur = ops.get(id);
  if (opts.message != null) cur.message = normalizeLoaderMessage(opts.message);
  if (opts.progress !== undefined) cur.progress = opts.progress;
  cur.error = false;
  paint();
}

/**
 * @param {string} id
 * @param {{ immediate?: boolean }} [opts]
 */
export function hideLoader(id, opts = {}) {
  ops.delete(id);
  if (ops.size === 0) {
    if (opts.immediate) {
      paint();
      return;
    }
    // Brief settle so the last status can flash “Ready” if set
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => paint(), 180);
  } else {
    paint();
  }
}

/** Force-clear every op (boot fatal error recovery). */
export function clearLoader() {
  ops.clear();
  clearTimeout(hideTimer);
  paint();
}

/**
 * Show error briefly, then clear that op so the loader never sticks.
 * @param {string} id
 * @param {string} message
 */
export function failLoader(id, message) {
  clearTimeout(hideTimer);
  ops.set(id, {
    message: message || "Something went wrong",
    progress: null,
    error: true,
  });
  paint();
  hideTimer = window.setTimeout(() => {
    ops.delete(id);
    paint();
  }, 2200);
}

/**
 * Run an async task with automatic show/hide (and fail on throw).
 * @template T
 * @param {string} id
 * @param {() => Promise<T>} fn
 * @param {{ message?: string }} [opts]
 * @returns {Promise<T>}
 */
export async function withLoader(id, fn, opts = {}) {
  showLoader(id, { message: opts.message, progress: null });
  try {
    const result = await fn();
    hideLoader(id);
    return result;
  } catch (err) {
    failLoader(id, err?.message || "Request failed");
    throw err;
  }
}

export const LOADER_STATUS = STATUS;

/** Boot helper: progress 0..1 with short status mapping. */
export function bootProgress(p, msg) {
  showLoader("boot", {
    message: msg,
    progress: Number.isFinite(p) ? p : null,
  });
}

export function mountAppLoader() {
  ensureMounted();
  paint();
  return {
    show: showLoader,
    update: updateLoader,
    hide: hideLoader,
    fail: failLoader,
    clear: clearLoader,
    withLoader,
    bootProgress,
  };
}

// Expose for flood / scene modules without circular imports
if (typeof window !== "undefined") {
  window.__MM_LOADER__ = {
    show: showLoader,
    update: updateLoader,
    hide: hideLoader,
    fail: failLoader,
    clear: clearLoader,
    withLoader,
    normalize: normalizeLoaderMessage,
  };
}
