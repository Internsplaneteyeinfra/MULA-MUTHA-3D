/**
 * Canonical display units — Mandovi RiverEye convention.
 * Single source for legends, tooltips, HUDs, and hydrologyConfig merge.
 *
 * kind:
 *   physical | index | class | coverage | area | volume
 */

/** @typedef {{ unit: string, kind: string, label?: string, note?: string }} LayerUnitDef */

/** @type {Record<string, LayerUnitDef>} */
export const LAYER_UNITS = {
  // ── Water quality ────────────────────────────────────────────────────────
  water_quality_tss: {
    unit: "mg/L",
    kind: "physical",
    label: "TSS / Turbidity",
    note: "Total suspended solids / turbidity",
  },
  salinity: {
    unit: "ppt",
    kind: "physical",
    label: "Salinity",
  },
  water_quality_ndci: {
    unit: "index",
    kind: "index",
    label: "Chlorophyll-a / NDCI",
    note: "Dimensionless NDCI proxy",
  },
  water_quality_ndwi: {
    unit: "index",
    kind: "index",
    label: "NDWI",
    note: "Dimensionless water index",
  },
  water_quality_wst: {
    unit: "°C",
    kind: "physical",
    label: "WST (water surface temperature)",
  },
  bod: {
    unit: "mg/L",
    kind: "physical",
    label: "BOD",
  },
  cod: {
    unit: "mg/L",
    kind: "physical",
    label: "COD",
  },
  bod_class: {
    unit: "class",
    kind: "class",
    label: "BOD class (A–E)",
    note: "Categorical A–E",
  },
  pollution_eutrophication: {
    unit: "TSI",
    kind: "index",
    label: "Eutrophication",
    note: "Carlson TSI (dimensionless); hotspot note also uses µg/L Chl-a",
  },
  pollution_nitrogen: {
    unit: "class",
    kind: "class",
    label: "Nitrogen",
    note: "Risk class / categorical (not mg N/L)",
  },
  water_quality_coliform: {
    unit: "CFU/100 ml",
    kind: "physical",
    label: "Coliform / E. coli",
    note: "Legend CFU/100 ml; layer treated as relative bathing class",
  },
  pollution_hotspot_score: {
    unit: "0–1",
    kind: "index",
    label: "Pollution hotspot score",
    note: "Dimensionless score",
  },
  pollution_severity: {
    unit: "class",
    kind: "class",
    label: "Pollution severity",
  },
  water_quality_area_stats: {
    unit: "ha · %",
    kind: "area",
    label: "Water-quality area stats",
  },

  // ── Land use ─────────────────────────────────────────────────────────────
  landuse_lulc: {
    unit: "class",
    kind: "class",
    label: "LULC (Forest / Crop / Barren / Water / Settlements)",
  },
  lulc_coverage: {
    unit: "%",
    kind: "coverage",
    label: "LULC coverage",
  },
  vegetation_extent: {
    unit: "class",
    kind: "class",
    label: "Vegetation type",
  },
  vegetation_health: {
    unit: "class",
    kind: "class",
    label: "Vegetation health",
  },

  // ── Geology ──────────────────────────────────────────────────────────────
  bathymetry: {
    unit: "m",
    kind: "physical",
    label: "Bathymetry / water depth",
  },
  bathymetry_classes: {
    unit: "m",
    kind: "physical",
    label: "Bathymetry depth classes",
  },
  channel_width: {
    unit: "m",
    kind: "physical",
    label: "Channel / river width",
  },
  chainage: {
    unit: "m",
    kind: "physical",
    label: "Chainage / distance",
    note: "Also km in some HUDs",
  },
  spectral_lithology: {
    unit: "class · %",
    kind: "class",
    label: "Spectral lithology",
    note: "Class / categorical (coverage %)",
  },
  bank_erosion: {
    unit: "class · %",
    kind: "class",
    label: "Bank erosion",
    note: "Class / categorical (coverage %)",
  },
  sediment_sand: {
    unit: "wt %",
    kind: "physical",
    label: "Sediment sand",
  },
  sediment_silt: {
    unit: "wt %",
    kind: "physical",
    label: "Sediment silt",
  },
  sediment_clay: {
    unit: "wt %",
    kind: "physical",
    label: "Sediment clay",
  },
  sediment_sorting: {
    unit: "class",
    kind: "class",
    label: "Sediment sorting / rock color",
  },
  silt_classification: {
    unit: "class",
    kind: "class",
    label: "Silt classification",
  },
  silt_volume_surface: {
    unit: "m³",
    kind: "volume",
    label: "Silt volume surface",
    note: "Relative index scale, assumed 1 m layer",
  },
  silt_selected_area: {
    unit: "m² · ha",
    kind: "area",
    label: "Silt selected area",
  },
  silt_volume_index_total: {
    unit: "m³",
    kind: "volume",
    label: "Silt volume index total",
    note: "Also Mcft in UI",
  },
  silt_deposition_index: {
    unit: "index",
    kind: "index",
    label: "Silt / deposition index",
  },
  silt_coverage: {
    unit: "%",
    kind: "coverage",
    label: "Silt coverage",
  },
  silt_elevation: {
    unit: "m",
    kind: "physical",
    label: "Elevation (silt cross-section)",
  },
};

/** Resolve unit string for a layer / metric id. */
export function unitFor(id) {
  const d = LAYER_UNITS[id];
  return d?.unit ?? "";
}

/** Full unit definition, or null. */
export function unitDef(id) {
  return LAYER_UNITS[id] || null;
}

/** Subtitle fragment like "· mg/L" (empty if none). */
export function unitSuffix(id) {
  const u = unitFor(id);
  return u ? ` · ${u}` : "";
}

/** Format a numeric value with its layer unit. */
export function formatWithUnit(id, value, { digits = 2, fallback = "—" } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const u = unitFor(id);
  const text = n.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return u ? `${text} ${u}` : text;
}
