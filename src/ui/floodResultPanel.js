/**
 * Compact Flood Result card (left side).
 * Only shows API-returned or directly derived fields; "—" for missing.
 */

export function mountFloodResultPanel(root, handlers = {}) {
  const panel = document.createElement("aside");
  panel.className = "flood-result-panel map-chrome";
  panel.id = "flood-result-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <header class="flood-result-panel__head">
      <strong>FLOOD RESULT</strong>
      <button type="button" class="flood-result-close" id="flood-result-close" aria-label="Close">×</button>
    </header>
    <p class="flood-result-disclaimer">Flood extent generated from JalNetra Flood API results.</p>
    <div class="flood-result-panel__body" id="flood-result-body"></div>
    <details class="flood-result-details" id="flood-result-details" hidden>
      <summary>Details</summary>
      <pre class="flood-result-details__pre" id="flood-result-details-pre"></pre>
    </details>
    <div class="flood-result-panel__actions">
      <button type="button" class="flood-result-action" id="flood-result-replay">▶ Replay Animation</button>
      <button type="button" class="flood-result-action" id="flood-result-focus">Focus Flood</button>
      <button type="button" class="flood-result-action flood-result-action--danger" id="flood-result-clear">Clear Simulation</button>
    </div>
  `;
  root.appendChild(panel);

  const body = panel.querySelector("#flood-result-body");
  const details = panel.querySelector("#flood-result-details");
  const detailsPre = panel.querySelector("#flood-result-details-pre");

  function dash(v) {
    if (v == null || v === "") return "—";
    return v;
  }

  function row(label, value) {
    return `<div class="flood-result-row"><span class="k">${label}</span><span class="v">${dash(value)}</span></div>`;
  }

  function fmtHa(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return `${n.toFixed(2)} ha`;
  }

  function show(info, opts = {}) {
    if (!info && !opts.error) {
      panel.hidden = true;
      return;
    }

    if (opts.error) {
      body.innerHTML = [
        row("Status", "Error"),
        row("Message", "Flood simulation could not be completed."),
      ].join("");
      if (opts.errorDetails) {
        details.hidden = false;
        detailsPre.textContent = String(opts.errorDetails);
      } else {
        details.hidden = true;
        detailsPre.textContent = "";
      }
      panel.hidden = false;
      return;
    }

    const range =
      info.start_date && info.end_date
        ? info.start_date === info.end_date
          ? info.start_date
          : `${info.start_date} → ${info.end_date}`
        : null;

    const currentScene =
      info.current_scene != null && info.total_scenes != null
        ? `${info.current_scene} / ${info.total_scenes}`
        : info.current_scene != null
          ? String(info.current_scene)
          : null;

    body.innerHTML = [
      row("Status", info.status || "ready"),
      row("Date Range", range),
      row("Scene Date", info.scene_date),
      row("Flood Area", fmtHa(info.flood_area_ha)),
      row("Water Area", fmtHa(info.water_area_ha)),
      row("Number of Scenes", info.scene_count ?? info.total_scenes),
      row("Current Scene", currentScene),
      row(
        "Comparison Result",
        info.comparison_count != null ? `${info.comparison_count} comparisons` : null,
      ),
      row("Buffer", typeof info.buffer_m === "number" ? `${info.buffer_m} m` : null),
      row("Depth", info.depth_note || null),
      row(
        "Retrieved",
        info.retrievedAt ? new Date(info.retrievedAt).toLocaleString() : null,
      ),
      info.fromCache ? row("Source", "Cached result") : "",
    ]
      .filter(Boolean)
      .join("");

    details.hidden = true;
    detailsPre.textContent = "";
    panel.hidden = false;
  }

  function hide() {
    panel.hidden = true;
  }

  function updateScene(info) {
    if (panel.hidden || !info) return;
    show(info);
  }

  panel.querySelector("#flood-result-close")?.addEventListener("click", () => {
    hide();
    handlers.onClose?.();
  });
  panel.querySelector("#flood-result-replay")?.addEventListener("click", () =>
    handlers.onReplay?.(),
  );
  panel.querySelector("#flood-result-focus")?.addEventListener("click", () =>
    handlers.onFocus?.(),
  );
  panel.querySelector("#flood-result-clear")?.addEventListener("click", () =>
    handlers.onClear?.(),
  );

  return { el: panel, show, hide, updateScene };
}

/** Compat alias for previous mountFloodInfoPanel name */
export const mountFloodInfoPanel = mountFloodResultPanel;
