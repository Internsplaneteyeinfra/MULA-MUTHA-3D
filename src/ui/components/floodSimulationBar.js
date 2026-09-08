import { Waves, Play, Loader2 } from "lucide";
import { lucideHtml } from "../icons.js";
import { todayApiDate, isValidApiDate } from "../../services/jalnetraFloodService.js";

/**
 * Compact top Flood Simulation control bar.
 */
export function mountFloodSimulationBar(root, handlers = {}) {
  const bar = document.createElement("div");
  bar.className = "flood-sim-bar map-chrome";
  bar.id = "flood-sim-bar";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Flood simulation controls");

  const today = todayApiDate();
  // Default window: last ~45 days ending today (Sentinel-1 friendly)
  const startDefault = (() => {
    const [y, m, d] = today.split("-").map(Number);
    const dt = new Date(y, m - 1, d - 45);
    const p = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  })();

  bar.innerHTML = `
    <div class="flood-sim-bar__brand">
      ${lucideHtml(Waves, { size: 15, className: "flood-sim-bar__icon" })}
      <strong>FLOOD SIMULATION</strong>
    </div>
    <div class="flood-sim-bar__controls">
      <button type="button" class="flood-sim-btn flood-sim-btn--today" id="flood-today" title="Use today's date and run">
        TODAY
      </button>
      <label class="flood-sim-date">
        <span>START</span>
        <input type="date" id="flood-start" value="${startDefault}" />
      </label>
      <span class="flood-sim-arrow" aria-hidden="true">→</span>
      <label class="flood-sim-date">
        <span>END</span>
        <input type="date" id="flood-end" value="${today}" />
      </label>
      <button type="button" class="flood-sim-btn flood-sim-btn--run" id="flood-run">
        <span class="flood-sim-run-label">${lucideHtml(Play, { size: 13 })} RUN SIMULATION</span>
        <span class="flood-sim-run-loading" hidden>${lucideHtml(Loader2, { size: 13, className: "flood-spin" })} RUNNING…</span>
      </button>
    </div>
    <div class="flood-sim-bar__status" id="flood-sim-status" aria-live="polite"></div>
  `;

  root.appendChild(bar);

  const startEl = bar.querySelector("#flood-start");
  const endEl = bar.querySelector("#flood-end");
  const runBtn = bar.querySelector("#flood-run");
  const todayBtn = bar.querySelector("#flood-today");
  const statusEl = bar.querySelector("#flood-sim-status");
  const runLabel = bar.querySelector(".flood-sim-run-label");
  const runLoading = bar.querySelector(".flood-sim-run-loading");

  let busy = false;

  function setStatus(msg, kind = "") {
    statusEl.textContent = msg || "";
    statusEl.dataset.kind = kind || "";
  }

  function datesValid() {
    const start_date = startEl.value;
    const end_date = endEl.value;
    if (!isValidApiDate(start_date) || !isValidApiDate(end_date)) return false;
    if (start_date > end_date) return false;
    return true;
  }

  function syncRunEnabled() {
    if (busy) {
      runBtn.disabled = true;
      return;
    }
    const ok = datesValid();
    runBtn.disabled = !ok;
    if (!ok && startEl.value && endEl.value && startEl.value > endEl.value) {
      setStatus("End date must be on or after start date.", "error");
    } else if (statusEl.dataset.kind === "error" && /end date must/i.test(statusEl.textContent || "")) {
      setStatus("");
    }
  }

  function setBusy(on) {
    busy = !!on;
    todayBtn.disabled = busy;
    startEl.disabled = busy;
    endEl.disabled = busy;
    runBtn.classList.toggle("is-loading", busy);
    runLabel.toggleAttribute("hidden", busy);
    runLoading.toggleAttribute("hidden", !busy);
    syncRunEnabled();
  }

  function readDates() {
    const start_date = startEl.value;
    const end_date = endEl.value;
    if (!isValidApiDate(start_date) || !isValidApiDate(end_date)) {
      throw new Error("Select valid start and end dates.");
    }
    if (start_date > end_date) {
      throw new Error("Start date must be on or before end date.");
    }
    return { start_date, end_date };
  }

  async function run(opts = {}) {
    if (busy) return;
    if (!datesValid()) {
      setStatus("Enter a valid start and end date.", "error");
      return;
    }
    setBusy(true);
    try {
      const dates = opts.dates || readDates();
      setStatus("Preparing KML…", "loading");
      await handlers.onRun?.(dates);
    } catch (err) {
      if (err?.message && !/cancel/i.test(err.message)) {
        setStatus(err.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  todayBtn.addEventListener("click", async () => {
    if (busy) return;
    const t = todayApiDate();
    // Sentinel-friendly window ending today (API needs a range)
    const [y, m, d] = t.split("-").map(Number);
    const dt = new Date(y, m - 1, d - 45);
    const p = (n) => String(n).padStart(2, "0");
    const start = `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
    startEl.value = start;
    endEl.value = t;
    syncRunEnabled();
    setStatus("Preparing KML…", "loading");
    try {
      setBusy(true);
      await handlers.onToday?.({
        start_date: start,
        end_date: t,
        preferDate: t,
        autoWiden: true,
      });
    } catch (err) {
      setStatus(
        err?.message || "Flood simulation could not be completed.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  });

  runBtn.addEventListener("click", async () => {
    try {
      await run();
    } catch {
      /* status already set */
    }
  });

  startEl.addEventListener("input", syncRunEnabled);
  endEl.addEventListener("input", syncRunEnabled);
  startEl.addEventListener("change", syncRunEnabled);
  endEl.addEventListener("change", syncRunEnabled);
  syncRunEnabled();

  return {
    el: bar,
    setStatus,
    setBusy,
    setDates(start, end) {
      if (start) startEl.value = start;
      if (end) endEl.value = end;
      syncRunEnabled();
    },
    getDates: readDates,
  };
}
