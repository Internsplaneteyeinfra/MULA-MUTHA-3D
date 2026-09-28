import { ChevronRight, X } from "lucide";
import { lucideHtml } from "../icons.js";
import { state } from "../../state.js";
import { metersToStation, nearestChainage } from "../../scene/chainageMarkers.js";
import {
  SILT_DASH as DASH,
  escapeSiltHtml,
  formatSiltArea,
  formatSiltLatLon,
  formatSiltValue,
  isMissingSiltValue,
} from "./siltFormat.js";

const isMap2d = () =>
  !state.cinematicActive &&
  (state.cameraMode === "aerial" || state.cameraMode === "top" || state.cameraMode === "2d");

const INSTRUCTION = "Select 4 points around the area to analyze";

/**
 * "Silt Analysis" row inside River Data (2D only) + compact SILT AREA ANALYSIS panel.
 * Scene work lives in scene/siltAreaTool.js; this file only renders its snapshots.
 */
export function mountSiltAnalysisPanel(root, riverData, dataset) {
  const rows = riverData.el.querySelector(".river-data-rows");
  const row = document.createElement("button");
  row.type = "button";
  row.className = "river-data-row";
  row.id = "silt-analysis-btn";
  row.hidden = true;
  row.title = "Silt area analysis (4 points)";
  row.setAttribute("aria-expanded", "false");
  row.innerHTML = `
    <span class="river-data-row-icon" aria-hidden="true">🟫</span>
    <span class="river-data-row-label">Silt Analysis</span>
    <span class="river-data-row-value river-data-row-value--empty" aria-hidden="true"></span>
    <span class="river-data-row-action" aria-hidden="true">${lucideHtml(ChevronRight, { size: 14 })}</span>`;
  rows?.appendChild(row);

  const panel = document.createElement("aside");
  panel.className = "silt-panel map-chrome";
  panel.id = "silt-analysis-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Silt area analysis");
  panel.innerHTML = `
    <header class="silt-head">
      <button type="button" class="silt-title" data-silt="close" aria-label="Back to 2D data">
        <span aria-hidden="true">←</span> SILT AREA ANALYSIS
      </button>
      <button type="button" class="river-data-close" data-silt="close" aria-label="Close silt analysis">
        ${lucideHtml(X, { size: 14, className: "river-data-close-icon" })}
      </button>
    </header>
    <p class="silt-hint" id="silt-hint"></p>
    <div class="silt-body" id="silt-body"></div>
    <footer class="silt-foot">
      <button type="button" class="silt-btn" data-silt="reset">Reset Points</button>
      <button type="button" class="silt-btn silt-btn--ghost" data-silt="close">Close</button>
    </footer>`;
  root.appendChild(panel);

  const hintEl = panel.querySelector("#silt-hint");
  const bodyEl = panel.querySelector("#silt-body");
  let active = false;
  let suspended = false;
  let snap = null;
  let hotspot = null;

  const scene = () => window.__MM_SCENE__;

  function open() {
    riverData.closeProfile?.();
    scene()?.setSiltAnalysisActive?.(true);
  }

  function close() {
    scene()?.setSiltAnalysisActive?.(false);
  }

  row.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (active) close();
    else open();
  });

  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-silt]");
    if (btn) {
      if (btn.dataset.silt === "close") close();
      else if (btn.dataset.silt === "reset") scene()?.resetSiltAnalysis?.();
      return;
    }
    const hs = e.target.closest("[data-hotspot]");
    if (hs) scene()?.selectSiltHotspot?.(hs.dataset.hotspot);
  });

  document.addEventListener("silt-analysis-change", (e) => {
    snap = e.detail || null;
    active = !!snap?.active;
    suspended = !!snap?.suspended;
    panel.hidden = !active || suspended;
    row.classList.toggle("is-active", active);
    row.setAttribute("aria-expanded", active ? "true" : "false");
    if (!snap?.result) hotspot = null;
    render();
  });

  document.addEventListener("silt-hotspot-select", (e) => {
    hotspot = e.detail || null;
    render();
  });

  function render() {
    if (!active || suspended || !snap) return;
    const { phase, count, result } = snap;
    if (phase === "select") {
      hintEl.hidden = false;
      hintEl.textContent = `${INSTRUCTION} · ${count}/4`;
      bodyEl.innerHTML = pointsPreview(snap.points);
      return;
    }
    if (phase === "analyzing") {
      hintEl.hidden = false;
      hintEl.textContent = "Analysing silt raster inside polygon…";
      bodyEl.innerHTML = "";
      return;
    }
    hintEl.hidden = true;
    bodyEl.innerHTML = renderResult(result, hotspot, dataset);
  }

  let leaving = false;

  function update() {
    const in2d = isMap2d();
    if (!in2d) leaving = false;
    const show = in2d && !leaving;
    const showRow = show && !state.active2DAnalysis;
    if (row.hidden === showRow) row.hidden = !showRow;
    if (active && suspended === show) scene()?.setSiltAnalysisSuspended?.(!show);
  }

  /** Called when the user leaves 2D; the camera may still be mid-transition out of map mode. */
  function leave() {
    if (!isMap2d()) return;
    leaving = true;
    update();
  }

  /** 2D requested again — a pending leave (3D fly-out not finished) no longer applies. */
  function resume() {
    leaving = false;
  }

  return { update, leave, resume, el: panel };
}

function renderResult(r, hotspot, dataset) {
  if (!r) return "";
  const selected = sec(
    "Selected Area",
    `${kv("Area", formatSiltArea(r.selectedAreaM2))}
     ${kv("Perimeter", formatSiltValue(r.perimeterM, { digits: 1, unit: " m" }))}
     ${kv("Centroid", formatSiltLatLon(r.centroid?.lat, r.centroid?.lon))}
     ${r.reordered ? `<p class="silt-note">Edges crossed — vertices ordered around centre.</p>` : ""}`,
  );

  if (!r.available) {
    return `${selected}
      ${sec("Silt Coverage", `<div class="silt-hero">${DASH}</div>${note(r.reason, "Silt dataset unavailable", true)}`)}
      ${thicknessSection(r)}
      ${verificationSection(r)}
      ${pointsSection(r.points)}`;
  }

  const silt = r.silt;
  const coverageBody = silt
    ? `<div class="silt-hero"><span>${pct(silt.coveragePct, 1, "<small>%</small>")}</span> ${badge(silt.status)}</div>
       ${kv("Silt Area", formatSiltArea(silt.areaM2))}
       <ul class="silt-classes">${(r.classes || [])
         .map(
           (c) => `<li><span class="silt-sw" style="background:${escapeSiltHtml(c.color || "transparent")}"></span><span>${text(c.label)}</span>
             <span class="silt-cv">${formatSiltArea(c.areaM2, true)}</span> <span class="silt-cp">${pct(c.pct, 0)}</span></li>`,
         )
         .join("")}</ul>
       <p class="silt-note">Silt area = cells with a silt class (Low–Very High) in ${text(r.source?.classification)}.</p>`
    : `<div class="silt-hero">${DASH}</div>${note(
        null,
        r.outsideExtent ? "Polygon is outside the silt raster extent" : "Silt dataset unavailable inside polygon",
        true,
      )}`;

  const cov = r.coverage || {};
  const raster =
    isMissingSiltValue(r.raster?.dxM) || isMissingSiltValue(r.raster?.dyM)
      ? DASH
      : `${formatSiltValue(r.raster.dxM, { digits: 2 })} × ${formatSiltValue(r.raster.dyM, { digits: 2, unit: " m" })}`;
  const observations = sec(
    "Observations",
    `${kv("Valid cells", formatSiltValue(r.validCells, { digits: 0 }))}
     ${kv("Raster cell", raster)}
     <div class="silt-sub">DATA COVERAGE</div>
     ${kv("Covered", formatSiltArea(cov.coveredM2, true))}
     ${kv("Uncovered", formatSiltArea(cov.uncoveredM2, true))}
     ${kv("Polygon with data", pct(cov.pct, 1))}`,
  );

  return `${selected}
    ${sec("Silt Coverage", coverageBody)}
    ${thicknessSection(r)}
    ${observations}
    ${hotspotSection(r, hotspot, dataset)}
    ${verificationSection(r)}
    ${pointsSection(r.points)}`;
}

/** Thickness and volume stay "—": the project has no silt-thickness layer, and neither depth nor the volume surface substitutes for it. */
function thicknessSection(r) {
  const vi = r.volumeIndex;
  const viBody =
    vi?.status === "DERIVED"
      ? `${kv("Min / Mean / Max", [vi.min, vi.mean, vi.max].map((v) => formatSiltValue(v, { digits: 1 })).join(" / "))}
         ${kv("Median", formatSiltValue(vi.median, { digits: 1 }))}
         <p class="silt-note">Volume-surface value on 0–${formatSiltValue(vi.scaleMax)} scale · unit unconfirmed in source · not thickness.</p>`
      : note(vi?.note, "Volume surface unavailable");
  return `${sec(
    "Silt Thickness",
    `${kv("Min / Mean / Max", `${DASH} / ${DASH} / ${DASH}`)}
     ${note(r.thickness?.note, "No silt thickness layer in project data")}`,
  )}
  ${sec("Estimated Volume", `${kv("Volume", DASH)}${note(r.volumeM3?.note, "Needs thickness in metres")}`)}
  ${vi ? sec(`Volume Surface Index ${badge(vi.status)}`, viBody) : ""}`;
}

function hotspotSection(r, hotspot, dataset) {
  const list = r.hotspots || [];
  if (!list.length) {
    return sec("Hotspots · 0", `<p class="silt-note">No High / Very High silt cells inside polygon.</p>`);
  }
  const total = list[0].totalHotspots || list.length;
  const items = list
    .map(
      (h) => `<button type="button" class="silt-hs${hotspot?.id === h.id ? " is-active" : ""}" data-hotspot="${escapeSiltHtml(h.id)}">
        <b>${text(h.id)}</b> <span>${text(h.dominant)}</span> <span class="silt-cv">${formatSiltArea(h.areaM2, true)}</span></button>`,
    )
    .join("");
  let detail = "";
  if (hotspot) {
    const ch = nearestChainage(hotspot.x, hotspot.z, dataset?.chainage);
    detail = `<div class="silt-hs-card">
      ${kv("Location", ch && Number.isFinite(ch.meters) ? `CH ${metersToStation(ch.meters).replace(/^\+/, "")}` : DASH)}
      ${kv("Lat", formatSiltValue(hotspot.lat, { digits: 6 }))}
      ${kv("Lon", formatSiltValue(hotspot.lon, { digits: 6 }))}
      ${kv("Silt value", isMissingSiltValue(hotspot.classLabel) ? DASH : `${text(hotspot.classLabel)} class`)}
      ${kv("Vol. surface", isMissingSiltValue(hotspot.volumeIndex) ? DASH : `${formatSiltValue(hotspot.volumeIndex, { digits: 1 })} (unit unconfirmed)`)}
      ${kv("Thickness", DASH)}
      ${kv("Source", text(hotspot.source))}
      ${kv("Verification", badge(hotspot.status))}
    </div>`;
  }
  return sec(
    `Hotspots · ${formatSiltValue(total, { digits: 0 })}`,
    `<p class="silt-note">Connected High / Very High class cells (dataset classes 3–4)${
      total > list.length ? ` · largest ${list.length} shown` : ""
    }.</p><div class="silt-hs-list">${items}</div>${detail}`,
  );
}

function verificationSection(r) {
  const vi = r.volumeIndex;
  const viDerived = vi?.status === "DERIVED";
  const rows = [
    ["Silt classes", r.silt ? "DERIVED" : "UNAVAILABLE", r.silt ? "Colour-decoded from source KMZ raster" : "No valid cells"],
    ["Volume surface", viDerived ? "DERIVED" : "UNAVAILABLE", viDerived ? "Colour-decoded · unit unconfirmed" : "No decoded values inside polygon"],
    ["Silt thickness", "UNAVAILABLE", "Not in project data"],
    ["Field survey", "UNAVAILABLE", "No ground-truth silt observations"],
  ];
  const src = [r.source?.classification, r.source?.volume].filter((s) => !isMissingSiltValue(s));
  return sec(
    "Verification",
    `<ul class="silt-verif">${rows
      .map(([k, s, n]) => `<li><span>${k}</span> ${badge(s)} <small>${escapeSiltHtml(n)}</small></li>`)
      .join("")}</ul>
     ${src.length ? `<p class="silt-note">Source: ${src.map(escapeSiltHtml).join(" · ")}</p>` : ""}`,
  );
}

function pointsSection(points) {
  if (!points?.length) return "";
  return sec(
    "Points",
    `<div class="silt-pts">${points
      .map((p) => {
        const near =
          p.nearestM === 0
            ? "at cell"
            : isMissingSiltValue(p.nearestM)
              ? "none ≤ 60 m"
              : formatSiltValue(p.nearestM, { digits: 1, unit: " m" });
        const silt = isMissingSiltValue(p.classLabel)
          ? DASH
          : `<i class="silt-sw" style="background:${escapeSiltHtml(p.classColor || "transparent")}"></i>${text(p.classLabel)}`;
        return `<div class="silt-pt">
          <div class="silt-pt-head"><b>${text(p.id)}</b> ${badge(p.status)}</div>
          <div class="silt-pt-grid">
            <span>Lat</span> <span>${formatSiltValue(p.lat, { digits: 6 })}</span>
            <span>Lon</span> <span>${formatSiltValue(p.lon, { digits: 6 })}</span>
            <span>Silt</span> <span>${silt}</span>
            <span>Vol. surface</span> <span>${formatSiltValue(p.volumeIndex, { digits: 1 })}</span>
            <span>Thickness</span> <span>${DASH}</span>
            <span>Nearest obs.</span> <span>${near}</span>
          </div>
          ${p.status === "UNAVAILABLE" ? note(p.verification, "No nearby verified observation", false, "Verification: ") : ""}
        </div>`;
      })
      .join("")}</div>`,
  );
}

function pointsPreview(points) {
  if (!points?.length) return "";
  return `<div class="silt-pts silt-pts--preview">${points
    .map((p) => `<div class="silt-pt-mini"><b>${text(p.id)}</b> <span>placed</span></div>`)
    .join("")}</div>`;
}

function sec(title, body) {
  return `<section class="silt-sec"><h4>${title}</h4>${body}</section>`;
}

function kv(k, v) {
  return `<div class="silt-kv"><span>${k}</span> <span>${v}</span></div>`;
}

function note(msg, fallback, warn = false, prefix = "") {
  const body = isMissingSiltValue(msg) ? escapeSiltHtml(fallback) : escapeSiltHtml(msg);
  return `<p class="silt-note${warn ? " silt-note--warn" : ""}">${prefix}${body}</p>`;
}

function badge(status) {
  const s = isMissingSiltValue(status) ? "UNAVAILABLE" : String(status).toUpperCase().replace(/[^A-Z_]/g, "");
  return `<span class="silt-badge silt-badge--${s.toLowerCase()}">${s || "UNAVAILABLE"}</span>`;
}

function text(value) {
  return formatSiltValue(value);
}

function pct(value, digits, suffix = "%") {
  return isMissingSiltValue(value) ? DASH : `${formatSiltValue(value, { digits })}${suffix}`;
}