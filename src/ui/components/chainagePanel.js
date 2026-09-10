import { Milestone, ChevronLeft, ChevronRight, X, PenLine } from "lucide";
import { state } from "../../state.js";
import { metersToStation } from "../../scene/chainageMarkers.js";
import { lucideHtml } from "../icons.js";

const NOTES_KEY = "mm_chainage_notes_v1";

/**
 * Compact premium chainage panel: chevron nav + annotation.
 * Notes editor opens only after the user clicks Annotation.
 * Logic (prev/next/select/notes) unchanged — UI presentation only.
 */
export function mountChainagePanel(root, dataset) {
  const el = document.createElement("aside");
  el.className = "hud chainage-panel";
  el.id = "chainage-panel";
  el.hidden = true;
  el.setAttribute("aria-label", "Chainage");

  el.innerHTML = `
    <header class="chainage-panel-header">
      <div class="chainage-panel-title">
        ${lucideHtml(Milestone, { size: 15, className: "ch-icon" })}
        <strong>CHAINAGE</strong>
      </div>
      <button type="button" class="chainage-panel-close" id="ch-panel-close" aria-label="Close">
        ${lucideHtml(X, { size: 16, className: "ch-icon" })}
      </button>
    </header>
    <div class="chainage-panel-body">
      <div class="chainage-panel-nav" role="group" aria-label="Chainage navigation">
        <button type="button" class="chainage-panel-nav-btn" id="ch-panel-prev" title="Previous station" aria-label="Previous station">
          ${lucideHtml(ChevronLeft, { size: 22, className: "ch-icon" })}
        </button>
        <span class="chainage-panel-station" id="ch-panel-station">—</span>
        <button type="button" class="chainage-panel-nav-btn" id="ch-panel-next" title="Next station" aria-label="Next station">
          ${lucideHtml(ChevronRight, { size: 22, className: "ch-icon" })}
        </button>
      </div>
      <button type="button" class="chainage-panel-anno-btn" id="ch-panel-anno-toggle" aria-expanded="false" title="Annotations">
        ${lucideHtml(PenLine, { size: 16, className: "ch-icon" })}
        <span class="chainage-panel-anno-label">Annotation</span>
        <span class="chainage-panel-anno-count" id="ch-panel-anno-count" hidden>0</span>
      </button>
      <section class="chainage-panel-notes" id="ch-panel-notes" hidden>
        <div class="chainage-panel-notes-head">
          <strong>ANNOTATIONS</strong>
          <span class="chainage-panel-notes-hint">Saved on this device</span>
        </div>
        <textarea id="ch-panel-note-input" rows="3" placeholder="Add a note for this station…" maxlength="800"></textarea>
        <button type="button" class="chainage-panel-add" id="ch-panel-add">Add annotation</button>
        <ul class="chainage-panel-note-list" id="ch-panel-note-list"></ul>
      </section>
    </div>
  `;
  root.appendChild(el);

  const stationEl = el.querySelector("#ch-panel-station");
  const noteInput = el.querySelector("#ch-panel-note-input");
  const noteList = el.querySelector("#ch-panel-note-list");
  const notesSection = el.querySelector("#ch-panel-notes");
  const annoToggle = el.querySelector("#ch-panel-anno-toggle");
  const annoCount = el.querySelector("#ch-panel-anno-count");
  let currentMeters = null;
  let notesOpen = false;

  function setNotesOpen(open) {
    notesOpen = !!open;
    if (notesOpen) {
      notesSection.removeAttribute("hidden");
    } else {
      notesSection.setAttribute("hidden", "");
    }
    annoToggle.classList.toggle("is-open", notesOpen);
    annoToggle.setAttribute("aria-expanded", notesOpen ? "true" : "false");
    if (notesOpen) {
      noteInput.focus();
    }
  }

  function close() {
    el.hidden = true;
    setNotesOpen(false);
  }

  function open(meters) {
    if (state.cinematicActive) return;
    const points = sortedChainage(dataset);
    const p = points.find((c) => c.meters === meters) || points.find((c) => Math.abs(c.meters - meters) < 0.5);
    if (!p) return;
    const switched = currentMeters !== p.meters;
    const firstOpen = el.hidden;
    currentMeters = p.meters;
    state.selectedChainageMeters = p.meters;
    state.showChainage = true;
    el.hidden = false;
    // Notes editor never auto-opens — only Annotation click
    if (firstOpen || switched) setNotesOpen(false);
    render(p, points);
  }

  function render(p, points) {
    const idx = points.findIndex((c) => c.meters === p.meters);
    const prev = idx > 0 ? points[idx - 1] : null;
    const next = idx >= 0 && idx < points.length - 1 ? points[idx + 1] : null;

    stationEl.textContent = p.label || metersToStation(p.meters);

    el.querySelector("#ch-panel-prev").disabled = !prev;
    el.querySelector("#ch-panel-next").disabled = !next;
    el.querySelector("#ch-panel-prev").dataset.meters = prev ? String(prev.meters) : "";
    el.querySelector("#ch-panel-next").dataset.meters = next ? String(next.meters) : "";

    syncAnnoCount(p.meters);
    if (notesOpen) renderNotes(p.meters);
  }

  function syncAnnoCount(meters) {
    const n = getNotesFor(meters).length;
    if (n > 0) {
      annoCount.hidden = false;
      annoCount.textContent = String(n);
    } else {
      annoCount.hidden = true;
      annoCount.textContent = "0";
    }
  }

  function renderNotes(meters) {
    const notes = getNotesFor(meters);
    if (!notes.length) {
      noteList.innerHTML = `<li class="chainage-panel-note empty">No annotations yet</li>`;
      return;
    }
    noteList.innerHTML = notes
      .map(
        (n) => `<li class="chainage-panel-note" data-id="${n.id}">
          <p>${escapeHtml(n.text)}</p>
          <div class="chainage-panel-note-meta">
            <time>${formatTime(n.createdAt)}</time>
            <button type="button" class="chainage-panel-note-del" data-id="${n.id}" aria-label="Delete note">Delete</button>
          </div>
        </li>`,
      )
      .join("");
  }

  el.querySelector("#ch-panel-close").addEventListener("click", close);

  annoToggle.addEventListener("click", () => {
    setNotesOpen(!notesOpen);
    if (notesOpen && currentMeters != null) renderNotes(currentMeters);
  });

  el.querySelector("#ch-panel-prev").addEventListener("click", (e) => {
    const m = Number(e.currentTarget.dataset.meters);
    if (!Number.isFinite(m)) return;
    open(m);
    document.dispatchEvent(
      new CustomEvent("chainage-select", { detail: { meters: m, focus: true } }),
    );
  });
  el.querySelector("#ch-panel-next").addEventListener("click", (e) => {
    const m = Number(e.currentTarget.dataset.meters);
    if (!Number.isFinite(m)) return;
    open(m);
    document.dispatchEvent(
      new CustomEvent("chainage-select", { detail: { meters: m, focus: true } }),
    );
  });

  el.querySelector("#ch-panel-add").addEventListener("click", () => {
    if (currentMeters == null) return;
    const text = String(noteInput.value || "").trim();
    if (!text) return;
    addNote(currentMeters, text);
    noteInput.value = "";
    syncAnnoCount(currentMeters);
    renderNotes(currentMeters);
  });

  noteList.addEventListener("click", (e) => {
    const btn = e.target.closest(".chainage-panel-note-del");
    if (!btn || currentMeters == null) return;
    deleteNote(currentMeters, btn.dataset.id);
    syncAnnoCount(currentMeters);
    renderNotes(currentMeters);
  });

  // Do not auto-open this panel on every chainage change (keeps map-first default).
  // Sync silently while closed; open only when already visible or explicitly requested.
  document.addEventListener("chainage-select", (e) => {
    const m = e.detail?.meters;
    if (m == null) return;
    if (e.detail?.openPanel || !el.hidden) {
      open(m);
      return;
    }
    currentMeters = m;
  });

  document.addEventListener("chainage-panel-open", (e) => {
    const m = e.detail?.meters ?? state.selectedChainageMeters ?? sortedChainage(dataset)[0]?.meters;
    if (m == null) return;
    open(m);
    if (e.detail?.notes) setNotesOpen(true);
  });

  return {
    el,
    open,
    close,
    update: () => {
      if (el.hidden || currentMeters == null) return;
      const points = sortedChainage(dataset);
      const p = points.find((c) => c.meters === currentMeters);
      if (p) render(p, points);
    },
  };
}

function sortedChainage(dataset) {
  return [...(dataset?.chainage || [])].sort((a, b) => (a.meters ?? 0) - (b.meters ?? 0));
}

function loadAllNotes() {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveAllNotes(all) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota */
  }
}

function getNotesFor(meters) {
  const all = loadAllNotes();
  return all[String(Math.round(meters))] || [];
}

function addNote(meters, text) {
  const key = String(Math.round(meters));
  const all = loadAllNotes();
  const list = all[key] || [];
  list.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text,
    createdAt: Date.now(),
  });
  all[key] = list.slice(0, 40);
  saveAllNotes(all);
}

function deleteNote(meters, id) {
  const key = String(Math.round(meters));
  const all = loadAllNotes();
  all[key] = (all[key] || []).filter((n) => n.id !== id);
  saveAllNotes(all);
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
