/**
 * Digital Twin Right Panel — Mula–Mutha Operational Dashboard
 *
 * Two modes:
 *   OVERVIEW — discharge, mean WSE, risk counts, N assets
 *   DETAIL   — selected asset: margin, P72h, WSE, threshold, risk badge
 *
 * Mounts as a floating glass panel on the right side of the viewport.
 * Listens to "twin-state-change" to update reactively.
 * Dispatches "twin-asset-select" via digitalTwinService when user clicks
 * on an asset in the mini-risk list.
 */

import { selectTwinAsset } from "../../services/digitalTwinService.js";

const STATUS_LABEL = { ok: "OK", warn: "WARN", critical: "CRITICAL", unknown: "—" };
const STATUS_COLOR = {
  ok: "var(--dt-ok)",
  warn: "var(--dt-warn)",
  critical: "var(--dt-critical)",
  unknown: "var(--dt-muted)",
};

export function mountDigitalTwinPanel(root) {
  const el = document.createElement("aside");
  el.id = "dt-panel";
  el.className = "dt-panel hud";
  el.setAttribute("aria-label", "Digital Twin Status Panel");
  el.innerHTML = _buildSkeleton();
  root.appendChild(el);

  // ─── DOM refs ────────────────────────────────────────────────────────────
  const overviewSection = el.querySelector("#dt-overview");
  const detailSection = el.querySelector("#dt-detail");
  const overviewBtn = el.querySelector("#dt-back-btn");
  const closeBtn = el.querySelector("#dt-close-btn");
  const toggleBtn = el.querySelector("#dt-toggle-btn");
  const panelBody = el.querySelector(".dt-panel__body");

  let _collapsed = false;
  let _currentState = null;

  // ─── Toggle collapse ─────────────────────────────────────────────────────
  toggleBtn?.addEventListener("click", () => {
    _collapsed = !_collapsed;
    el.classList.toggle("dt-panel--collapsed", _collapsed);
    if (toggleBtn) toggleBtn.textContent = _collapsed ? "▸" : "▾";
  });

  closeBtn?.addEventListener("click", () => {
    el.hidden = true;
  });

  // ─── Back to overview ─────────────────────────────────────────────────────
  overviewBtn?.addEventListener("click", () => {
    selectTwinAsset(null);
  });

  // ─── State listener ────────────────────────────────────────────────────────
  document.addEventListener("twin-state-change", (e) => {
    _currentState = e.detail;
    _render(e.detail);
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  function _render(state) {
    if (!state) return;
    if (state.selectedAsset) {
      _renderDetail(state.selectedAsset, state);
    } else {
      _renderOverview(state);
    }
  }

  function _renderOverview(state) {
    overviewSection.hidden = false;
    detailSection.hidden = true;
    overviewBtn.hidden = true;

    const q = el.querySelector("#dt-discharge");
    const w = el.querySelector("#dt-wse");
    const label = el.querySelector("#dt-source-label");
    const risk_ok = el.querySelector("#dt-risk-ok");
    const risk_warn = el.querySelector("#dt-risk-warn");
    const risk_crit = el.querySelector("#dt-risk-crit");
    const assetList = el.querySelector("#dt-asset-list");

    if (q) q.textContent = state.discharge_m3s != null ? `${state.discharge_m3s.toFixed(1)} m³/s` : "—";
    if (w) w.textContent = state.meanWse_m != null ? `${state.meanWse_m.toFixed(2)} m` : "—";
    if (label) {
      label.textContent = state.modelled ? "MODEL" : "LIVE";
      label.dataset.kind = state.modelled ? "model" : "live";
    }
    if (risk_ok) risk_ok.textContent = state.riskCounts?.ok ?? 0;
    if (risk_warn) risk_warn.textContent = state.riskCounts?.warn ?? 0;
    if (risk_crit) risk_crit.textContent = state.riskCounts?.critical ?? 0;

    if (assetList) {
      const sorted = [...(state.assets ?? [])].sort(
        (a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0),
      );
      assetList.innerHTML = sorted.slice(0, 6).map((a) => `
        <div class="dt-asset-row dt-asset-row--${a.status}" data-asset-id="${a.id}" tabindex="0" role="button" aria-label="${a.name} ${STATUS_LABEL[a.status]}">
          <span class="dt-asset-dot"></span>
          <span class="dt-asset-name">${a.name}</span>
          <span class="dt-asset-km">${a.chainage_km?.toFixed(1)} km</span>
          <span class="dt-asset-status">${STATUS_LABEL[a.status]}</span>
        </div>
      `).join("");

      assetList.querySelectorAll("[data-asset-id]").forEach((row) => {
        row.addEventListener("click", () => selectTwinAsset(row.dataset.assetId));
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") selectTwinAsset(row.dataset.assetId);
        });
      });
    }
  }

  function _renderDetail(asset, state) {
    overviewSection.hidden = true;
    detailSection.hidden = false;
    overviewBtn.hidden = false;

    const name = el.querySelector("#dt-detail-name");
    const badge = el.querySelector("#dt-detail-badge");
    const km = el.querySelector("#dt-detail-km");
    const wse = el.querySelector("#dt-detail-wse");
    const thr = el.querySelector("#dt-detail-thr");
    const margin = el.querySelector("#dt-detail-margin");
    const p72 = el.querySelector("#dt-detail-p72margin");
    const riskBar = el.querySelector("#dt-risk-bar-fill");
    const riskScore = el.querySelector("#dt-risk-score");
    const coord = el.querySelector("#dt-detail-coord");

    if (name) name.textContent = asset.name;
    if (km) km.textContent = `${asset.chainage_km?.toFixed(1)} km`;
    if (badge) {
      badge.textContent = STATUS_LABEL[asset.status] ?? "—";
      badge.dataset.status = asset.status ?? "ok";
    }
    if (wse) wse.textContent = asset.wse_m != null ? `${asset.wse_m.toFixed(2)} m` : "—";
    if (thr) thr.textContent = asset.threshold_m != null ? `${asset.threshold_m.toFixed(2)} m` : "—";
    if (margin) {
      const m = asset.margin_m ?? 0;
      margin.textContent = `${m >= 0 ? "+" : ""}${m.toFixed(2)} m`;
      margin.dataset.sign = m >= 0 ? "pos" : "neg";
    }
    if (p72) {
      const m = asset.p72h_margin ?? 0;
      p72.textContent = `${m >= 0 ? "+" : ""}${m.toFixed(2)} m`;
      p72.dataset.sign = m >= 0 ? "pos" : "neg";
    }
    if (riskBar) {
      const pct = Math.min(100, Math.max(0, asset.riskScore ?? 0));
      riskBar.style.width = `${pct}%`;
      riskBar.dataset.status = asset.status ?? "ok";
    }
    if (riskScore) riskScore.textContent = `${asset.riskScore ?? 0}`;
    if (coord) coord.textContent = `${asset.lat?.toFixed(5)}° N  ${asset.lon?.toFixed(5)}° E`;
  }

  function _buildSkeleton() {
    return `
      <header class="dt-panel__header">
        <div class="dt-panel__title">
          <strong>Digital Twin</strong>
          <span id="dt-source-label" class="dt-source-badge" data-kind="model">MODEL</span>
        </div>
        <div class="dt-panel__controls">
          <button id="dt-toggle-btn" class="dt-icon-btn" title="Collapse" type="button">▾</button>
          <button id="dt-close-btn" class="dt-icon-btn" title="Close" type="button">✕</button>
        </div>
      </header>
      <div class="dt-panel__body">
        <!-- OVERVIEW -->
        <section id="dt-overview">
          <div class="dt-kv-grid">
            <div class="dt-kv">
              <span class="dt-kv__k">Discharge</span>
              <span class="dt-kv__v" id="dt-discharge">—</span>
            </div>
            <div class="dt-kv">
              <span class="dt-kv__k">Mean WSE</span>
              <span class="dt-kv__v" id="dt-wse">—</span>
            </div>
          </div>
          <div class="dt-risk-strip" aria-label="Risk summary">
            <div class="dt-risk-chip dt-risk-chip--ok">
              <span class="dt-risk-chip__dot"></span>
              <span id="dt-risk-ok" class="dt-risk-chip__count">0</span>
              <span class="dt-risk-chip__label">OK</span>
            </div>
            <div class="dt-risk-chip dt-risk-chip--warn">
              <span class="dt-risk-chip__dot"></span>
              <span id="dt-risk-warn" class="dt-risk-chip__count">0</span>
              <span class="dt-risk-chip__label">WARN</span>
            </div>
            <div class="dt-risk-chip dt-risk-chip--critical">
              <span class="dt-risk-chip__dot"></span>
              <span id="dt-risk-crit" class="dt-risk-chip__count">0</span>
              <span class="dt-risk-chip__label">CRIT</span>
            </div>
          </div>
          <div class="dt-section-label">Assets by risk</div>
          <div id="dt-asset-list" class="dt-asset-list" role="listbox" aria-label="Asset risk list"></div>
        </section>

        <!-- DETAIL -->
        <section id="dt-detail" hidden>
          <button id="dt-back-btn" class="dt-back-btn" aria-label="Back to overview">← Overview</button>
          <div class="dt-detail-card">
            <div class="dt-detail-head">
              <strong id="dt-detail-name" class="dt-detail-name">—</strong>
              <span id="dt-detail-badge" class="dt-status-badge" data-status="ok">OK</span>
            </div>
            <div class="dt-detail-meta">
              <span id="dt-detail-km" class="dt-detail-km">—</span>
              <span id="dt-detail-coord" class="dt-detail-coord">—</span>
            </div>
            <div class="dt-detail-metrics">
              <div class="dt-metric">
                <span class="dt-metric__k">WSE Now</span>
                <span class="dt-metric__v" id="dt-detail-wse">—</span>
              </div>
              <div class="dt-metric">
                <span class="dt-metric__k">Threshold</span>
                <span class="dt-metric__v" id="dt-detail-thr">—</span>
              </div>
              <div class="dt-metric">
                <span class="dt-metric__k">Margin</span>
                <span class="dt-metric__v dt-metric__v--signed" id="dt-detail-margin">—</span>
              </div>
              <div class="dt-metric">
                <span class="dt-metric__k">+72 h margin</span>
                <span class="dt-metric__v dt-metric__v--signed" id="dt-detail-p72margin">—</span>
              </div>
            </div>
            <div class="dt-risk-bar-wrap" aria-label="Risk score">
              <div class="dt-risk-bar">
                <div class="dt-risk-bar__fill" id="dt-risk-bar-fill" data-status="ok" style="width:0%"></div>
              </div>
              <span class="dt-risk-score-label">Risk <strong id="dt-risk-score">0</strong>/100</span>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  return {
    el,
    show() { el.hidden = false; },
    hide() { el.hidden = true; },
    render: _render,
  };
}
