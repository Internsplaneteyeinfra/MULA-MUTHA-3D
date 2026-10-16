import { ChevronLeft, ChevronRight, ChevronUp, Play, Pause, RotateCcw, RefreshCw, SkipBack } from "lucide";
import { lucideHtml } from "./icons.js";
import { todayApiDate } from "../services/jalnetraFloodService.js";
import { validYmd, fmtYmd, fmtHa, fmtTimestamp, joinValid } from "./floodFieldFormat.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Date status classes rendered in the timeline. */
export const DAY_STATUS = {
  AVAILABLE: "available",
  GENERATABLE: "generatable",
  PROCESSING: "processing",
  UNAVAILABLE: "unavailable",
};

const STATUS_LABEL = {
  available: "Stored simulation",
  generatable: "Generatable",
  processing: "Loading",
  unavailable: "Unavailable",
};

function ymdParts(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return { y, m: m - 1, d };
}

function dayNum(ymd) {
  const { y, m, d } = ymdParts(ymd);
  return Math.round(Date.UTC(y, m, d) / 86_400_000);
}

/** `25 Sep` / `02 Aug` — year is shown separately in the year bar. */
function chipLabel(ymd) {
  const { m, d } = ymdParts(ymd);
  return `${String(d).padStart(2, "0")} ${MONTHS[m]}`;
}

function fmtDate(ymd, withYear = true) {
  return fmtYmd(ymd, withYear) ?? "";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/**
 * Flood Playback panel: chips for API-verified simulation dates only, plus
 * playback of the currently loaded date. No calendar days are synthesised —
 * every chip corresponds to a `datewise` record returned by JalNetra.
 */
export function mountFloodPlaybackControls(root, handlers = {}) {
  const panel = document.createElement("div");
  panel.className = "flood-playback map-chrome integrated-flood-panel";
  panel.id = "flood-playback";
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Flood simulation dates and playback controls");

  /** @type {any | null} */
  let catalog = null;
  let selected = null;
  let loadedDate = null;
  let viewYear = null;
  let refreshing = false;
  let busy = false;
  let scrubbing = false;
  /** kml_ids the server reported as expired (404) — regenerate to restore. */
  const expiredIds = new Set();
  /** Dates with a load / regeneration in flight. */
  const processing = new Set();
  /** Dates that exist in the catalog but contain no flood-class pixels. */
  const noFloodDates = new Set();

  panel.innerHTML = `
    <div class="fpt-head">
      <button type="button" class="fpt-toggle" aria-expanded="false" aria-controls="fpt-more">
        <span class="flood-playback__label">FLOOD PLAYBACK</span>
        <span class="fpt-toggle__icon" aria-hidden="true">${lucideHtml(ChevronUp, { size: 14 })}</span>
      </button>
      <button type="button" class="fpt-refresh" title="Check JalNetra for newly published scenes" aria-label="Refresh available dates">${lucideHtml(RefreshCw, { size: 11 })}</button>
    </div>

    <div class="fpt-compact">
      <div class="fpt-compact__row">
        <button type="button" class="flood-playback-btn fpt-date-prev" data-act="prev-date" title="Previous date" aria-label="Previous date">${lucideHtml(ChevronLeft, { size: 13 })}</button>
        <select class="fpt-date-select" aria-label="Historical flood date"></select>
        <button type="button" class="flood-playback-btn fpt-date-next" data-act="next-date" title="Next date" aria-label="Next date">${lucideHtml(ChevronRight, { size: 13 })}</button>
        <button type="button" class="flood-playback-btn fpt-playpause" data-act="playpause" title="Play / pause" aria-label="Play or pause" disabled>${lucideHtml(Play, { size: 12, fill: "currentColor" })}</button>
      </div>
      <div class="flood-playback__timeline fpt-compact__timeline">
        <span class="flood-playback-track-end" aria-hidden="true">River</span>
        <input type="range" class="fpt-scrub" min="0" max="1000" step="1" value="0" aria-label="Flood spread progress" disabled />
        <span class="flood-playback-track-end" aria-hidden="true">Extent</span>
      </div>
    </div>

    <div class="fpt-more" id="fpt-more" hidden>
      <div class="fpt-summary" aria-live="polite">Loading available dates…</div>
      <div class="fpt-datebar">
        <button type="button" class="ft-nav-btn fpt-prev" aria-label="Previous year with data">${lucideHtml(ChevronLeft, { size: 12 })}</button>
        <span class="fpt-year"></span>
        <button type="button" class="ft-nav-btn fpt-next" aria-label="Next year with data">${lucideHtml(ChevronRight, { size: 12 })}</button>
        <div class="fpt-chips" role="listbox" aria-label="Available simulation dates"></div>
      </div>
      <div class="flood-playback__controls">
        <button type="button" class="flood-playback-btn" data-act="play" title="Play / resume flood spread">${lucideHtml(Play, { size: 12, fill: "currentColor" })} Play</button>
        <button type="button" class="flood-playback-btn" data-act="pause" title="Pause">${lucideHtml(Pause, { size: 12, fill: "currentColor" })} Pause</button>
        <button type="button" class="flood-playback-btn" data-act="replay" title="Replay from river">${lucideHtml(RotateCcw, { size: 12 })} Replay</button>
        <button type="button" class="flood-playback-btn" data-act="reset" title="Reset to river level">${lucideHtml(SkipBack, { size: 12 })} Reset</button>
      </div>
      <div class="fpt-selected" hidden>
        <div class="fpt-selected__text"><strong class="fpt-selected__date"></strong><span class="fpt-selected__meta"></span></div>
        <button type="button" class="flood-playback-btn fpt-generate" hidden>Generate Simulation</button>
      </div>
    </div>
    <div class="flood-pb-status" style="display:none;"></div>
  `;
  root.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const yearEl = $(".fpt-year");
  const prevBtn = $(".fpt-prev");
  const nextBtn = $(".fpt-next");
  const chipsEl = $(".fpt-chips");
  const summaryEl = $(".fpt-summary");
  const selBox = $(".fpt-selected");
  const selDateEl = $(".fpt-selected__date");
  const selMetaEl = $(".fpt-selected__meta");
  const genBtn = $(".fpt-generate");
  const refreshBtn = $(".fpt-refresh");
  const scrub = $(".fpt-scrub");
  const statusEl = $(".flood-pb-status");
  const dateSelect = $(".fpt-date-select");
  const playPauseBtn = $(".fpt-playpause");
  const moreEl = $(".fpt-more");
  const toggleBtn = $(".fpt-toggle");
  const ctrlBtns = [...panel.querySelectorAll(".flood-playback__controls button, .fpt-playpause")];
  let expanded = false;
  let isPlaying = false;

  /** Catalog records with a real calendar date — the only source of chips. */
  function verifiedScenes() {
    return (catalog?.scenes || []).filter((s) => validYmd(s?.date));
  }

  function sceneFor(ymd) {
    return verifiedScenes().find((s) => s.date === ymd) || null;
  }

  /** Years that contain at least one verified record, ascending. */
  function verifiedYears() {
    const ys = new Set(verifiedScenes().map((s) => Number(s.date.slice(0, 4))));
    return [...ys].sort((a, b) => a - b);
  }

  /** Verified records for the viewed year, newest first. */
  function visibleScenes() {
    if (viewYear == null) return [];
    return verifiedScenes()
      .filter((s) => Number(s.date.slice(0, 4)) === viewYear)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  /** Expected-but-unpublished Sentinel-1 passes after the latest catalog scene. */
  function isExpectedPass(ymd) {
    if (!catalog?.latestDate || !catalog.cadenceDays) return false;
    const diff = dayNum(ymd) - dayNum(catalog.latestDate);
    return diff > 0 && diff % catalog.cadenceDays === 0;
  }

  /** @returns {{ status: string, reason: string }} */
  function dayStatus(ymd) {
    if (processing.has(ymd)) return { status: DAY_STATUS.PROCESSING, reason: "Loading flood product…" };
    const scene = sceneFor(ymd);
    if (scene) {
      if (expiredIds.has(scene.kml_id)) {
        return {
          status: DAY_STATUS.GENERATABLE,
          reason: "Source scene verified, stored KML expired on the server — Generate re-runs JalNetra processing.",
        };
      }
      const area = fmtHa(scene.flood_area_ha);
      return {
        status: DAY_STATUS.AVAILABLE,
        reason: joinValid([
          "Stored Sentinel-1 flood simulation",
          area && `flood ${area}`,
          noFloodDates.has(ymd) && "no flood-class pixels",
        ]),
      };
    }
    if (ymd > todayApiDate()) return { status: DAY_STATUS.UNAVAILABLE, reason: "Future date — no observation yet." };
    if (!catalog) return { status: DAY_STATUS.UNAVAILABLE, reason: "Available dates not loaded yet." };
    if (validYmd(catalog.windowStart) && ymd < catalog.windowStart) {
      return { status: DAY_STATUS.UNAVAILABLE, reason: `Outside JalNetra coverage (starts ${fmtDate(catalog.windowStart)}).` };
    }
    if (isExpectedPass(ymd)) {
      return { status: DAY_STATUS.UNAVAILABLE, reason: "Expected Sentinel-1 pass — not yet published by JalNetra." };
    }
    return { status: DAY_STATUS.UNAVAILABLE, reason: "No verified flood simulation for this date." };
  }

  function renderYear() {
    const years = verifiedYears();
    if (!years.length) {
      viewYear = null;
    } else if (viewYear == null || !years.includes(viewYear)) {
      viewYear = years[years.length - 1];
    }
    const i = years.indexOf(viewYear);
    yearEl.hidden = viewYear == null;
    yearEl.textContent = viewYear == null ? "" : String(viewYear);
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i < 0 || i >= years.length - 1;
    prevBtn.hidden = nextBtn.hidden = years.length < 2;
  }

  function renderChips() {
    chipsEl.innerHTML = "";
    const list = visibleScenes();
    if (!list.length) {
      const empty = document.createElement("span");
      empty.className = "fpt-empty";
      empty.textContent = refreshing && !catalog ? "Loading available dates…" : "No flood simulation dates available";
      chipsEl.appendChild(empty);
      return;
    }
    const multiMonth = new Set(list.map((s) => s.date.slice(0, 7))).size > 1;
    let lastMonth = null;
    let focusEl = null;
    for (const scene of list) {
      const ymd = scene.date;
      const month = ymd.slice(0, 7);
      if (multiMonth && month !== lastMonth) {
        const tag = document.createElement("span");
        tag.className = "fpt-month-tag";
        tag.textContent = MONTHS[ymdParts(ymd).m];
        chipsEl.appendChild(tag);
        lastMonth = month;
      }
      const { status, reason } = dayStatus(ymd);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `fpt-chip is-${status}${ymd === selected ? " is-selected" : ""}${ymd === loadedDate ? " is-loaded" : ""}`;
      chip.dataset.ymd = ymd;
      chip.setAttribute("role", "option");
      chip.setAttribute("aria-selected", String(ymd === selected));
      chip.title = `${fmtDate(ymd)} — ${reason}`;
      chip.textContent = fmtDate(ymd, true) || chipLabel(ymd);
      chip.addEventListener("click", () => selectDay(ymd));
      chipsEl.appendChild(chip);
      if (ymd === selected) focusEl = chip;
    }
    if (focusEl) {
      requestAnimationFrame(() => {
        const left = focusEl.offsetLeft - chipsEl.clientWidth / 2 + focusEl.clientWidth / 2;
        chipsEl.scrollLeft = Math.max(0, left);
      });
    }
  }

  function renderSummary() {
    if (!catalog) {
      summaryEl.textContent = refreshing ? "Loading available dates from JalNetra…" : "Available dates not loaded";
      return;
    }
    if (!verifiedScenes().length) {
      summaryEl.textContent = refreshing ? "Checking JalNetra for new scenes…" : "No flood simulation dates available";
      return;
    }
    const inYear = visibleScenes();
    const generatable = inYear.filter((s) => expiredIds.has(s.kml_id)).length;
    const latest = fmtYmd(catalog.latestDate, false);
    const next = validYmd(catalog.nextExpectedDate);
    const pending = next && next <= todayApiDate() ? fmtYmd(next, false) : null;
    summaryEl.textContent = joinValid([
      `${inYear.length} available date${inYear.length === 1 ? "" : "s"}`,
      generatable && `${generatable} expired`,
      pending && `next ~${pending} pending`,
      refreshing ? "refreshing…" : catalog.fromCache && "cached",
    ]);
    const checked = fmtTimestamp(catalog.fetchedAt);
    summaryEl.title = joinValid(
      [
        latest && `Latest verified scene: ${latest}`,
        pending && `Next Sentinel-1 pass ~${pending} — not yet published by JalNetra`,
        generatable && `${generatable} stored product(s) expired — select and Generate`,
        checked && `Checked ${checked}${catalog.fromCache ? " (cached list)" : ""}`,
      ],
      "\n",
    );
  }

  function renderSelected() {
    if (!selected) {
      selBox.hidden = true;
      genBtn.hidden = true;
      return;
    }
    selBox.hidden = false;
    const { status, reason } = dayStatus(selected);
    const scene = sceneFor(selected);
    const dateLabel = fmtDate(selected, true);
    selDateEl.textContent = dateLabel;
    selDateEl.hidden = !dateLabel;
    const pre = fmtYmd(scene?.pre_date, false);
    const post = fmtYmd(scene?.post_date, false);
    const area = fmtHa(scene?.flood_area_ha);
    const extra = joinValid([pre && post && `obs ${pre} → ${post}`, area && `flood ${area}`]);
    selMetaEl.innerHTML = `<span class="fpt-badge is-${status}">${STATUS_LABEL[status]}</span>${esc(extra || reason)}`;
    selMetaEl.title = reason;
    genBtn.hidden = status !== DAY_STATUS.GENERATABLE;
    genBtn.disabled = busy || refreshing;
  }

  function allVerifiedDates() {
    return verifiedScenes()
      .map((s) => s.date)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }

  /** Prefer selected (user intent) so prev/next/dropdown stay responsive while a load finishes. */
  function activeDate() {
    return selected || loadedDate || null;
  }

  function renderDateSelect() {
    const dates = allVerifiedDates();
    const active = activeDate();
    const sig = dates.join("|");

    // Rebuild options only when the catalog list changes — wiping <select>
    // on every render closes the open menu and breaks picking a date.
    if (dateSelect.dataset.sig !== sig) {
      dateSelect.dataset.sig = sig;
      dateSelect.innerHTML = "";
      if (!dates.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = refreshing ? "Loading…" : "No dates";
        dateSelect.appendChild(opt);
      } else {
        for (const ymd of dates) {
          const opt = document.createElement("option");
          opt.value = ymd;
          opt.textContent = fmtDate(ymd, true) || ymd;
          dateSelect.appendChild(opt);
        }
      }
    }

    dateSelect.disabled = !dates.length;
    const datePrev = panel.querySelector(".fpt-date-prev");
    const dateNext = panel.querySelector(".fpt-date-next");
    if (datePrev) datePrev.disabled = !dates.length;
    if (dateNext) dateNext.disabled = !dates.length;

    if (!dates.length) return;
    const want = active && dates.includes(active) ? active : dates[0];
    if (dateSelect.value !== want) dateSelect.value = want;
  }

  function syncPlayPauseIcon() {
    playPauseBtn.innerHTML = isPlaying
      ? lucideHtml(Pause, { size: 12, fill: "currentColor" })
      : lucideHtml(Play, { size: 12, fill: "currentColor" });
    playPauseBtn.title = isPlaying ? "Pause" : "Play / resume";
  }

  function setExpanded(on) {
    expanded = !!on;
    moreEl.hidden = !expanded;
    toggleBtn.setAttribute("aria-expanded", String(expanded));
    panel.classList.toggle("is-expanded", expanded);
  }

  function render() {
    renderYear();
    renderChips();
    renderSummary();
    renderSelected();
    renderDateSelect();
    syncPlayPauseIcon();
    refreshBtn.classList.toggle("is-spinning", refreshing);
    refreshBtn.disabled = refreshing;
  }

  function selectDay(ymd, { force = false } = {}) {
    const next = validYmd(ymd);
    if (!next) return;
    // Already showing this scene — ignore duplicate picks (unless force retry).
    if (!force && next === selected && next === loadedDate && !busy) {
      if (dateSelect.value !== next) dateSelect.value = next;
      return;
    }
    selected = next;
    if (sceneFor(next)) viewYear = Number(next.slice(0, 4));
    renderDateSelect();
    renderSelected();
    renderChips();
    const { status, reason } = dayStatus(next);
    handlers.onSelectDate?.(next, { status, reason, scene: sceneFor(next) });
  }

  function stepYear(dir) {
    const years = verifiedYears();
    const i = years.indexOf(viewYear);
    const next = years[i + dir];
    if (next == null) return;
    viewYear = next;
    render();
  }

  function stepDate(dir) {
    const dates = allVerifiedDates();
    if (!dates.length) return;
    const cur = activeDate();
    let i = dates.indexOf(cur);
    if (i < 0) i = 0;
    const next = dates[i + dir];
    if (next) selectDay(next, { force: true });
  }

  // —— Public API ——
  function setCatalog(next, { resetExpired = false } = {}) {
    catalog = next || null;
    if (resetExpired) {
      expiredIds.clear();
      noFloodDates.clear();
    }
    if (selected && sceneFor(selected)) viewYear = Number(selected.slice(0, 4));
    render();
  }

  function setSelected(ymd, { focus = true } = {}) {
    selected = ymd || null;
    if (focus && ymd && sceneFor(ymd)) viewYear = Number(ymd.slice(0, 4));
    render();
  }

  function setLoadedDate(ymd) {
    loadedDate = validYmd(ymd) || null;
    // Sync selection to the loaded scene only when not mid-request for another date.
    if (loadedDate && (!busy || selected === loadedDate || !selected)) {
      selected = loadedDate;
      viewYear = Number(loadedDate.slice(0, 4));
    }
    const ready = !!loadedDate;
    ctrlBtns.forEach((b) => {
      // Play/pause + expanded controls need a loaded scene; date nav stays usable.
      if (b.classList.contains("fpt-date-prev") || b.classList.contains("fpt-date-next")) return;
      b.disabled = !ready;
    });
    scrub.disabled = !ready;
    if (!ready) {
      isPlaying = false;
      setProgress(0);
    }
    renderDateSelect();
    renderChips();
    renderSelected();
    syncPlayPauseIcon();
  }

  function setPlaying(on) {
    isPlaying = !!on;
    syncPlayPauseIcon();
  }

  function markExpired(kmlId) {
    if (kmlId) expiredIds.add(kmlId);
    render();
  }

  function markNoFlood(ymd) {
    if (ymd) noFloodDates.add(ymd);
    render();
  }

  function setProcessing(ymd, on) {
    if (!ymd) return;
    if (on) processing.add(ymd);
    else processing.delete(ymd);
    render();
  }

  function setRefreshing(on) {
    refreshing = !!on;
    render();
  }

  function setProgress(p) {
    if (scrubbing) return;
    scrub.value = String(Math.round(Math.max(0, Math.min(1, Number(p) || 0)) * 1000));
  }

  function setStatus(msg, kind = "") {
    statusEl.textContent = msg || "";
    statusEl.className = `flood-pb-status ${kind}`;
    statusEl.style.display = msg ? "block" : "none";
  }

  function setBusy(on) {
    busy = !!on;
    panel.classList.toggle("is-loading", busy);
    // Keep the date dropdown usable so the user can switch scenes mid-load.
    renderDateSelect();
    renderSelected();
  }

  prevBtn.addEventListener("click", () => stepYear(-1));
  nextBtn.addEventListener("click", () => stepYear(1));
  refreshBtn.addEventListener("click", () => handlers.onRefresh?.());
  genBtn.addEventListener("click", () => {
    if (selected) handlers.onGenerate?.(selected);
  });
  toggleBtn.addEventListener("click", () => setExpanded(!expanded));
  dateSelect.addEventListener("change", () => {
    if (dateSelect.value) selectDay(dateSelect.value, { force: true });
  });
  // Newest-first list: prev = older (index+1), next = newer (index-1).
  panel.querySelector(".fpt-date-prev")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    stepDate(1);
  });
  panel.querySelector(".fpt-date-next")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    stepDate(-1);
  });
  playPauseBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (playPauseBtn.disabled) return;
    if (isPlaying) {
      isPlaying = false;
      syncPlayPauseIcon();
      handlers.onPause?.();
    } else {
      isPlaying = true;
      syncPlayPauseIcon();
      handlers.onPlay?.();
    }
  });
  panel.querySelector(".flood-playback__controls").addEventListener("click", (e) => {
    const act = e.target.closest("button")?.dataset.act;
    if (act === "play") {
      isPlaying = true;
      syncPlayPauseIcon();
      handlers.onPlay?.();
    } else if (act === "pause") {
      isPlaying = false;
      syncPlayPauseIcon();
      handlers.onPause?.();
    } else if (act === "replay") {
      isPlaying = true;
      syncPlayPauseIcon();
      handlers.onReplay?.();
    } else if (act === "reset") {
      isPlaying = false;
      syncPlayPauseIcon();
      setProgress(0);
      handlers.onReset?.();
    }
  });
  scrub.addEventListener("pointerdown", () => (scrubbing = true));
  window.addEventListener("pointerup", () => (scrubbing = false));
  scrub.addEventListener("input", () => handlers.onScrub?.(Number(scrub.value) / 1000));

  window.addEventListener("flood-sim-complete", () => {
    isPlaying = false;
    syncPlayPauseIcon();
  });

  ctrlBtns.forEach((b) => (b.disabled = true));
  setExpanded(false);
  render();

  return {
    el: panel,
    show: () => (panel.hidden = false),
    hide: () => (panel.hidden = true),
    setCatalog,
    setSelected,
    setLoadedDate,
    setPlaying,
    markExpired,
    markNoFlood,
    setProcessing,
    setRefreshing,
    setProgress,
    setStatus,
    setBusy,
    getSelected: () => selected,
    getCatalog: () => catalog,
    /** Dates currently rendered as chips (newest first). */
    getVisibleDates: () => visibleScenes().map((s) => s.date),
    dayStatus,
  };
}
