/**
 * Height resolution with explicit source labels.
 * Never claim estimated values as surveyed measurements.
 */

export function resolveBuildingHeight(props = {}) {
  const tagged = parseMeters(props.heightM ?? props.height);
  if (tagged != null && tagged > 1) {
    return { height: tagged, height_source: props.height_source || "OSM_HEIGHT" };
  }
  if (props.height_source === "OSM_HEIGHT" && Number.isFinite(props.heightM)) {
    return { height: props.heightM, height_source: "OSM_HEIGHT" };
  }
  const levels = Number(props.levels ?? props["building:levels"]);
  if (Number.isFinite(levels) && levels > 0) {
    return { height: levels * 3.1, height_source: "ESTIMATED_FROM_BUILDING_LEVELS" };
  }
  if (props.height_source && Number.isFinite(props.heightM)) {
    return { height: props.heightM, height_source: props.height_source };
  }
  const byType = estimateFromBuildingType(props.building);
  return { height: byType, height_source: "DEFAULT_ESTIMATE" };
}

export function resolveTreeHeight(props = {}, seed = 0) {
  const h = parseMeters(props.tree_height ?? props.height);
  if (h != null && h > 0.5) {
    return { height: h, height_source: props.height_source || "OSM_TREE_HEIGHT" };
  }
  const est = parseMeters(props.est_height);
  if (est != null && est > 0.5) {
    return { height: est, height_source: "OSM_EST_HEIGHT" };
  }
  if (props.height_source && Number.isFinite(props.tree_height)) {
    return { height: props.tree_height, height_source: props.height_source };
  }
  const base = 7.5 + ((seed % 17) - 8) * 0.35;
  return { height: Math.max(4, Math.min(18, base)), height_source: "VISUAL_ESTIMATE" };
}

function parseMeters(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = Number(String(raw).toLowerCase().replace(/m/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function estimateFromBuildingType(building) {
  const t = String(building || "yes").toLowerCase();
  if (/warehouse|industrial|factory/.test(t)) return 9;
  if (/apartments/.test(t)) return 15;
  if (/commercial|office|retail|hotel/.test(t)) return 10;
  if (/house|detached|bungalow/.test(t)) return 7;
  return 8.5;
}
