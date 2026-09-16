/**
 * Click vs hover selection helpers for garbage layer.
 * Hover = preview only; click = select + optional camera focus.
 */

/**
 * @param {object|null} record
 * @param {{ focusCamera?: boolean }} [opts]
 */
export function applyGarbageClick(record, opts = {}) {
  if (!record?.id) {
    window.__MM_SCENE__?.clearGarbageSelection?.();
    return null;
  }
  return window.__MM_SCENE__?.selectGarbage?.(record.id, {
    focusCamera: opts.focusCamera !== false,
  });
}
