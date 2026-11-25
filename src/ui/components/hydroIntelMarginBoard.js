/**
 * NadiTwin-style Margin Board overlay (By location / Every 1 km).
 * MODELLED / PROVISIONAL only — does not unlock Phase 8 safety boards.
 */
import {
  fetchMarginBoardRows,
  parseAtToLocalParts,
} from "../../services/hydrology/naditwinHistoricService.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmt(v, digits = 2, unit = "") {
  if (v == null || !Number.isFinite(Number(v))) return "N/A";
  return `${Number(v).toFixed(digits)}${unit ? ` ${unit}` : ""}`;
}

function fmtCh(m) {
  if (!Number.isFinite(Number(m))) return "N/A";
  const n = Math.max(0, Math.round(Number(m)));
  return `${Math.floor(n / 1000)}+${String(n % 1000).padStart(3, "0")}`;
}

function statusClass(status) {
  const s = String(status || "").toUpperCase().trim();
  if (s === "DANGER") return "danger";
  if (s === "WARNING") return "warning";
  if (s === "WATCH") return "watch";
  if (s === "SAFE") return "safe";
  // Unavailable / unknown — neutral grey; never invent a risk class from colour
  return "unverified";
}

function statusBadgeLabel(status) {
  const s = String(status || "").toUpperCase().trim();
  if (s === "DANGER" || s === "WARNING" || s === "WATCH" || s === "SAFE") return s;
  return "UNVERIFIED";
}

function cardHtml(row) {
  const rawStatus = String(row.status || "").toUpperCase().trim();
  const cls = statusClass(rawStatus);
  const badge = statusBadgeLabel(rawStatus);
  const range =
    Number.isFinite(row.from_km) && Number.isFinite(row.to_km)
      ? `${Number(row.from_km).toFixed(2)} → ${Number(row.to_km).toFixed(2)} km`
      : "N/A";
  return `
    <article class="hip-mb-card" data-status="${cls}">
      <header class="hip-mb-card__head">
        <div>
          <div class="hip-mb-card__name">${esc(row.name || row.id || "—")}</div>
          <div class="hip-mb-card__range">${esc(range)} · CH ${esc(row.label || fmtCh(row.chainage_m))}</div>
        </div>
        <span class="hip-mb-card__status" title="NadiTwin MODELLED / PROVISIONAL · Phase 8 LOCKED">${esc(badge)}</span>
      </header>
      <div class="hip-mb-card__grid">
        <div><span>Margin below danger</span><b>${fmt(row.margin_now_m, 2, "m")}</b></div>
        <div><span>Discharge Q</span><b>${fmt(row.q_now, 2, "m³/s")}</b></div>
        <div><span>River stage</span><b>${fmt(row.wse_now, 2, "m")}</b></div>
        <div><span>Water depth</span><b>${fmt(row.depth_now_m, 2, "m")}</b></div>
        <div><span>Danger level</span><b>${fmt(row.levels?.danger ?? row.threshold, 2, "m")}</b></div>
        <div><span>Bank height</span><b>${fmt(row.bank_height_m, 2, "m")}</b></div>
        <div><span>Q at danger</span><b>${fmt(row.q_danger, 1, "m³/s")}</b></div>
        <div><span>72 h peak Q</span><b>${fmt(row.peak_q_72h, 2, "m³/s")}</b></div>
        <div><span>Forecast peak stage</span><b>${fmt(row.peak_stage_72h, 2, "m")}</b></div>
        <div><span>Peak timing</span><b>${row.peak_in_h != null ? `${fmt(row.peak_in_h, 0)} h` : "N/A"}</b></div>
        <div><span>Exceedance P72</span><b>${row.p_exceed_72h != null ? `${fmt(Number(row.p_exceed_72h) * (Number(row.p_exceed_72h) <= 1 ? 100 : 1), 0)}%` : "N/A"}</b></div>
        <div><span>Rain now</span><b>${fmt(row.rain_now_mmh, 2, "mm/h")}</b></div>
        <div><span>Rain past 24 h</span><b>${fmt(row.rain_past_24h_mm, 1, "mm")}</b></div>
        <div><span>Rain next 24 h</span><b>${fmt(row.rain_next_24h_mm, 1, "mm")}</b></div>
        <div><span>Most vulnerable CH</span><b>${esc(row.label || fmtCh(row.chainage_m))}</b></div>
        <div><span>Basis</span><b>${esc(row.basis || "—")}</b></div>
      </div>
    </article>`;
}

/**
 * @param {HTMLElement} host — usually #hip-content parent or panel
 * @param {{ getMode: Function, getHistoricAt: Function }} ctx
 */
export function mountMarginBoard(host, ctx) {
  let open = false;
  let view = "locations";
  let token = 0;

  let overlay = host.querySelector("#hip-margin-board");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "hip-margin-board";
    overlay.className = "hip-margin-board";
    overlay.hidden = true;
    host.appendChild(overlay);
  }

  async function render() {
    const my = ++token;
    const mode = ctx.getMode?.() || "live";
    const at = mode === "historic" ? ctx.getHistoricAt?.() : null;
    overlay.hidden = false;
    open = true;
    overlay.innerHTML = `
      <div class="hip-margin-board__panel">
        <div class="hip-margin-board__bar">
          <div>
            <div class="hip-margin-board__title">Margin Board — By Location</div>
            <div class="hip-margin-board__disc">MODELLED / PROVISIONAL · Phase 8 safety boards remain LOCKED</div>
          </div>
          <div class="hip-margin-board__actions">
            <div class="hip-margin-board__tabs">
              <button type="button" class="hip-mb-tab${view === "locations" ? " active" : ""}" data-view="locations">By location</button>
              <button type="button" class="hip-mb-tab${view === "chainage" ? " active" : ""}" data-view="chainage">Every 1 km</button>
            </div>
            <button type="button" id="hip-mb-close" class="hip-expand-bar__btn">Close Margin Board</button>
          </div>
        </div>
        <div class="hip-margin-board__meta" id="hip-mb-meta">Loading…</div>
        <div class="hip-margin-board__grid" id="hip-mb-grid"><div class="hip-loading">Loading margin board…</div></div>
      </div>`;

    overlay.querySelectorAll(".hip-mb-tab").forEach((btn) => {
      btn.onclick = () => {
        view = btn.getAttribute("data-view") || "locations";
        render();
      };
    });
    overlay.querySelector("#hip-mb-close")?.addEventListener("click", () => close());

    const pack = await fetchMarginBoardRows(view, at);
    if (my !== token) return;
    const meta = overlay.querySelector("#hip-mb-meta");
    const grid = overlay.querySelector("#hip-mb-grid");
    if (!pack.ok) {
      if (meta) {
        meta.textContent = pack.message || "MARGIN BOARD DATA UNAVAILABLE";
      }
      if (grid) {
        grid.innerHTML = `<div class="hip-error">${esc(pack.message || "Unavailable")}</div>`;
      }
      return;
    }
    const atLabel = at ? (parseAtToLocalParts(at)?.label || at) : "LIVE";
    if (meta) {
      meta.innerHTML = `<b>${view === "chainage" ? "Every 1 km" : "By location"}</b> · ${esc(atLabel)} · ${pack.rows.length} cards · ${esc(pack.disclaimer || "")}`;
    }
    if (grid) grid.innerHTML = pack.rows.map(cardHtml).join("");
  }

  function close() {
    open = false;
    overlay.hidden = true;
    overlay.innerHTML = "";
  }

  function toggle() {
    if (open) close();
    else void render();
  }

  return {
    open: () => void render(),
    close,
    toggle,
    isOpen: () => open,
    refresh: () => (open ? render() : Promise.resolve()),
  };
}
