/**
 * Compact Flood Playback panel — independent from Chainage timeline.
 * Shown when JalNetra returns multiple datewise scenes.
 */

export function mountFloodPlaybackControls(root, handlers = {}) {
  const panel = document.createElement("div");
  panel.className = "flood-playback map-chrome";
  panel.id = "flood-playback";
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Flood scene playback");

  panel.innerHTML = `
    <div class="flood-playback__label">FLOOD PLAYBACK</div>
    <div class="flood-playback__controls">
      <button type="button" class="flood-playback-btn" id="flood-pb-play" title="Play scenes">▶ Play</button>
      <button type="button" class="flood-playback-btn" id="flood-pb-pause" title="Pause">❚❚ Pause</button>
      <button type="button" class="flood-playback-btn" id="flood-pb-replay" title="Replay">↺ Replay</button>
    </div>
    <div class="flood-playback__timeline">
      <span class="flood-playback-track-end" aria-hidden="true">▐</span>
      <input type="range" id="flood-pb-timeline" min="0" max="0" step="1" value="0" aria-label="Flood scene timeline" />
      <span class="flood-playback-track-end" aria-hidden="true">▐</span>
    </div>
    <div class="flood-playback__meta">
      <span id="flood-pb-scene">Scene —</span>
      <span id="flood-pb-date">Date: —</span>
    </div>
  `;
  root.appendChild(panel);

  const timeline = panel.querySelector("#flood-pb-timeline");
  const sceneEl = panel.querySelector("#flood-pb-scene");
  const dateEl = panel.querySelector("#flood-pb-date");

  /** @type {any[]} */
  let scenes = [];

  function syncMeta(index) {
    const s = scenes[index];
    const n = scenes.length;
    sceneEl.textContent = n ? `Scene ${index + 1} / ${n}` : "Scene —";
    dateEl.textContent = s?.date ? `Date: ${s.date}` : "Date: —";
    if (timeline) timeline.value = String(index);
  }

  function setScenes(list, currentIndex = 0) {
    scenes = Array.isArray(list) ? list : [];
    const max = Math.max(0, scenes.length - 1);
    timeline.max = String(max);
    timeline.disabled = scenes.length < 2;
    const idx = Math.max(0, Math.min(max, currentIndex | 0));
    syncMeta(idx);
    panel.hidden = scenes.length < 2;
  }

  function show() {
    if (scenes.length >= 2) panel.hidden = false;
  }

  function hide() {
    panel.hidden = true;
  }

  function setIndex(index) {
    syncMeta(index);
  }

  panel.querySelector("#flood-pb-play")?.addEventListener("click", () => {
    handlers.onPlay?.();
  });
  panel.querySelector("#flood-pb-pause")?.addEventListener("click", () => {
    handlers.onPause?.();
  });
  panel.querySelector("#flood-pb-replay")?.addEventListener("click", () => {
    handlers.onReplay?.();
  });
  timeline?.addEventListener("input", () => {
    const i = Number(timeline.value) || 0;
    syncMeta(i);
    handlers.onSeek?.(i);
  });

  return { el: panel, setScenes, setIndex, show, hide };
}
