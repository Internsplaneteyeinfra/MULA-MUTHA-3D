/**
 * Developer-only flags. Production UI never exposes these.
 * Enable fishing debug: set DEBUG_FISHING = true, or in console:
 *   localStorage.setItem("mm_debug_fishing", "1"); location.reload();
 */
export const DEBUG_FISHING =
  typeof localStorage !== "undefined" && localStorage.getItem("mm_debug_fishing") === "1";
