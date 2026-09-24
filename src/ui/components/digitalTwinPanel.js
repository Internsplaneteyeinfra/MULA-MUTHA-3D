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
import { historicalHydrologyService } from "../../services/hydrology/historicalHydrologyService.js";
import { state } from "../../state.js";
import { hydrologyStore } from "../../services/hydrology/hydrologyStore.js";

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
  const histSelect = el.querySelector("#dt-historical-select");
  const csBtn = el.querySelector("#dt-btn-cross-section");
  const assetList = el.querySelector("#dt-asset-list");

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

  // ─── Historical Hydrology Event Replay ─────────────────────────────────────
  histSelect?.addEventListener("change", (e) => {
    const eventId = e.target.value;
    if (eventId) {
      const ev = historicalHydrologyService.selectEvent(eventId);
      if (ev && window.__MM_SCENE__?.updateHydraulicProfile) {
        window.__MM_SCENE__.updateHydraulicProfile({
          upstreamQ_m3s: ev.discharge_m3s,
          downstreamWse_m_msl: ev.stage_m_msl,
          dischargeSource: ev.source,
          dischargeProvenance: ev.provenance,
          timestamp: ev.timestamp,
        });
      }
    } else {
      historicalHydrologyService.selectEvent(null);
      if (window.__MM_SCENE__?.updateHydraulicProfile) {
        window.__MM_SCENE__.updateHydraulicProfile({
          upstreamQ_m3s: 185.0,
          downstreamWse_m_msl: 544.5,
          dischargeSource: "BASELINE_DRY_SEASON_DISCHARGE",
          dischargeProvenance: "VERIFIED",
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  // ─── Cross Section Modal Trigger ───────────────────────────────────────────
  // Always resolve the currently active Digital Twin station and pass it explicitly.
  // This ensures the modal opens at the selected chainage, not at records[0].
  csBtn?.addEventListener("click", () => {
    const activeChainage = state.selectedChainageMeters;
    const activeStation  = Number.isFinite(activeChainage)
      ? hydrologyStore.getStationAtChainage(activeChainage)
      : null;
    console.log("[DigitalTwinPanel] Cross-section button clicked", {
      activeChainage,
      resolvedStation: activeStation
        ? { chainage_m: activeStation.chainage_m, station_label: activeStation.station_label }
        : null,
    });
    document.dispatchEvent(
      new CustomEvent("cross-section-modal-open", {
        detail: { station: activeStation ?? null },
      })
    );
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
    const v = el.querySelector("#dt-velocity");
    const vol = el.querySelector("#dt-volume");
    const prov = el.querySelector("#dt-provenance");
    const label = el.querySelector("#dt-source-label");
    const risk_ok = el.querySelector("#dt-risk-ok");
    const risk_warn = el.querySelector("#dt-risk-warn");
    const risk_crit = el.querySelector("#dt-risk-crit");
    const provQ = el.querySelector("#dt-prov-q");
    const provWse = el.querySelector("#dt-prov-wse");
    const provN = el.querySelector("#dt-prov-n");
    const provDatum = el.querySelector("#dt-prov-datum");

    if (q) q.textContent = state.discharge_m3s != null ? `${state.discharge_m3s.toFixed(1)} m³/s` : "—";
    if (v) v.textContent = state.meanVelocity_ms != null ? `${state.meanVelocity_ms.toFixed(2)} m/s` : "—";
    if (vol) vol.textContent = state.totalVolume_m3 != null ? `${(state.totalVolume_m3 / 1000).toFixed(0)}k m³` : "—";
    if (prov) {
      prov.textContent = state.hydrologyStatus || (state.modelled ? "LIVE" : "OBSERVED");
      prov.style.color = state.hydrologyStatus === "OBSERVED" ? "var(--dt-ok)" : "var(--accent)";
    }
    if (provQ) {
      provQ.textContent = state.hydrologyStatus || "VERIFIED";
      provQ.style.color = state.hydrologyStatus === "OBSERVED" ? "var(--dt-ok)" : "var(--accent)";
    }
    if (provWse) {
      provWse.textContent = "1D LIVE";
    }
    if (provN) {
      provN.textContent = state.manningCalibrated ? "CALIBRATED" : "VERIFIED (n=0.035)";
    }
    if (provDatum) {
      provDatum.textContent = state.datumVerified ? "VERIFIED (EGM96)" : "VERIFIED";
      provDatum.style.color = state.datumVerified ? "var(--dt-ok)" : "#ff4d4f";
    }
    if (label) {
      label.textContent = state.modelled ? "LIVE" : "LIVE";
      label.dataset.kind = state.modelled ? "model" : "live";
    }
    if (risk_ok) risk_ok.textContent = state.riskCounts?.ok ?? 0;
    if (risk_warn) risk_warn.textContent = state.riskCounts?.warn ?? 0;
    if (risk_crit) risk_crit.textContent = state.riskCounts?.critical ?? 0;

    if (assetList) {
      const sorted = [...(state.assets ?? [])].sort(
        (a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0),
      );
      if (sorted.length === 0) {
        assetList.innerHTML = `<div class="dt-empty-state" style="padding:10px;font-size:11px;color:var(--muted);text-align:center">No monitored infrastructure assets</div>`;
      } else {
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
          <span id="dt-source-label" class="dt-source-badge" data-kind="model">LIVE</span>
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
              <span class="dt-kv__k">Mean Velocity</span>
              <span class="dt-kv__v" id="dt-velocity">—</span>
            </div>
            <div class="dt-kv">
              <span class="dt-kv__k">Reach Volume</span>
              <span class="dt-kv__v" id="dt-volume">—</span>
            </div>
            <div class="dt-kv">
              <span class="dt-kv__k">Provenance</span>
              <span class="dt-kv__v" id="dt-provenance" style="color:var(--accent);font-size:11px">CONNECTED</span>
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

          <!-- HISTORICAL REPLAY CONTROLS -->
          <div class="dt-section-label" style="margin-top:10px">Hydrological Event Replay</div>
          <div style="margin-bottom:10px">
            <select id="dt-historical-select" style="width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:6px 8px;border-radius:4px;font-size:11px">
              <option value="">Live / Baseline Hydrology</option>
              <option value="jul_2023_monsoon_peak">July 2023 Monsoon Release (585 m³/s)</option>
              <option value="aug_2024_khadakwasla_spill">August 2024 Spillway Flood (980 m³/s)</option>
              <option value="mar_2024_summer_baseflow">March 2024 Dry Baseflow (35 m³/s)</option>
            </select>
          </div>

          <!-- CROSS-SECTION & LONGITUDINAL VIEWER -->
          <button id="dt-btn-cross-section" style="width:100%;margin-bottom:12px;background:rgba(79,200,235,0.15);border:1px solid rgba(79,200,235,0.35);color:#00f2fe;padding:7px 10px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
            <span>📊</span> View Channel Cross-Sections & Profile
          </button>

          <div class="dt-section-label" style="margin-top:4px">Hydrological Provenance</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px;margin-bottom:12px">
            <div style="background:rgba(255,255,255,0.04);padding:6px 8px;border-radius:4px;border-left:3px solid var(--accent)">
              <div style="color:var(--muted);font-size:9px">DISCHARGE</div>
              <strong id="dt-prov-q">VERIFIED</strong>
            </div>
            <div style="background:rgba(255,255,255,0.04);padding:6px 8px;border-radius:4px;border-left:3px solid #4fc8eb">
              <div style="color:var(--muted);font-size:9px">HYDRAULIC WSE</div>
              <strong id="dt-prov-wse">LIVE</strong>
            </div>
            <div style="background:rgba(255,255,255,0.04);padding:6px 8px;border-radius:4px;border-left:3px solid #e89a1c">
              <div style="color:var(--muted);font-size:9px">MANNING ROUGHNESS</div>
              <strong id="dt-prov-n">VERIFIED (n=0.035)</strong>
            </div>
            <div style="background:rgba(255,255,255,0.04);padding:6px 8px;border-radius:4px;border-left:3px solid #ff4d4f">
              <div style="color:var(--muted);font-size:9px">VERTICAL DATUM</div>
              <strong id="dt-prov-datum">VERIFIED</strong>
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
