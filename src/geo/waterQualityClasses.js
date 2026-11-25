/**
 * Official water-quality class schemes for Mula–Mutha Hydrology.
 * Ranges and colors are the single source of truth for legends, polygons, and tooltips.
 * Units follow Mandovi RiverEye (see layerUnits.js).
 */

import { LAYER_UNITS, unitFor } from "./layerUnits.js";

/** @typedef {{ id:string, kmlClass?:string, label:string, color:string, range:string, unit:string, min:number|null, max:number|null, inclusiveMax?:boolean }} WqClass */

const U = {
  tss: unitFor("water_quality_tss") || "mg/L",
  salinity: unitFor("salinity") || "ppt",
  ndci: unitFor("water_quality_ndci") || "index",
  ndwi: unitFor("water_quality_ndwi") || "index",
  wst: unitFor("water_quality_wst") || "°C",
  coliform: unitFor("water_quality_coliform") || "CFU/100 ml",
  eutro: unitFor("pollution_eutrophication") || "TSI",
  nitrogen: unitFor("pollution_nitrogen") || "class",
  bod: unitFor("bod") || "mg/L",
  bodClass: unitFor("bod_class") || "class",
  hotspot: unitFor("pollution_hotspot_score") || "0–1",
  severity: unitFor("pollution_severity") || "class",
};

/** TSS / Turbidity — mg/L (Mandovi RiverEye). */
export const TSS_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "low",
    kmlClass: "Low",
    label: "Low",
    color: "#2196F3",
    range: `TSS ≤ 0.62 ${U.tss}`,
    unit: U.tss,
    min: 0,
    max: 0.62,
    inclusiveMax: true,
  },
  {
    id: "medium",
    kmlClass: "Medium",
    label: "Medium",
    color: "#FFC107",
    range: `0.62–1.17 ${U.tss}`,
    unit: U.tss,
    min: 0.62,
    max: 1.17,
    inclusiveMax: true,
  },
  {
    id: "high",
    kmlClass: "High",
    label: "High",
    color: "#F44336",
    range: `TSS > 1.17 ${U.tss}`,
    unit: U.tss,
    min: 1.17,
    max: null,
    inclusiveMax: false,
  },
]);

/** Salinity — ppt (Mandovi RiverEye). */
export const SALINITY_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "very_low",
    kmlClass: "Very Low",
    label: "Very Low",
    color: "#0000FF",
    range: `0.00–0.20 ${U.salinity}`,
    unit: U.salinity,
    min: 0,
    max: 0.2,
    inclusiveMax: true,
  },
  {
    id: "low",
    kmlClass: "Low",
    label: "Low",
    color: "#00BFFF",
    range: `0.20–0.40 ${U.salinity}`,
    unit: U.salinity,
    min: 0.2,
    max: 0.4,
    inclusiveMax: true,
  },
  {
    id: "moderate",
    kmlClass: "Moderate",
    label: "Moderate",
    color: "#00FF00",
    range: `0.40–0.60 ${U.salinity}`,
    unit: U.salinity,
    min: 0.4,
    max: 0.6,
    inclusiveMax: true,
  },
  {
    id: "high",
    kmlClass: "High",
    label: "High",
    color: "#FFFF00",
    range: `0.60–0.80 ${U.salinity}`,
    unit: U.salinity,
    min: 0.6,
    max: 0.8,
    inclusiveMax: true,
  },
  {
    id: "very_high",
    kmlClass: "Very High",
    label: "Very High",
    color: "#FF0000",
    range: `0.80–1.00 ${U.salinity}`,
    unit: U.salinity,
    min: 0.8,
    max: 1,
    inclusiveMax: true,
  },
]);

/** Chlorophyll-a / NDCI — dimensionless index (Mandovi RiverEye). */
export const CHLOROPHYLL_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "low",
    kmlClass: "Low Chlorophyll",
    label: "Low",
    color: "#C8E6C9",
    range: "NDCI < 0 (index)",
    unit: U.ndci,
    min: null,
    max: 0,
    inclusiveMax: false,
  },
  {
    id: "high",
    kmlClass: "High Chlorophyll",
    label: "High",
    color: "#1B5E20",
    range: "NDCI ≥ 0 (index)",
    unit: U.ndci,
    min: 0,
    max: null,
    inclusiveMax: true,
  },
]);

/** NDWI — dimensionless index (Mandovi RiverEye). */
export const NDWI_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "non_water",
    kmlClass: "Class 1",
    label: "Non-water",
    color: "#8B5A2B",
    range: "NDWI ≤ 0 (index)",
    unit: U.ndwi,
    min: -1,
    max: 0,
    inclusiveMax: true,
  },
  {
    id: "water",
    kmlClass: "Class 2",
    label: "Water",
    color: "#0D47A1",
    range: "NDWI > 0 (index)",
    unit: U.ndwi,
    min: 0,
    max: 1,
    inclusiveMax: true,
  },
]);

/** WST — °C (Mandovi RiverEye). */
export const WST_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "very_low",
    kmlClass: "Class 1",
    label: "Very low",
    color: "#0D47A1",
    range: `<27 ${U.wst}`,
    unit: U.wst,
    min: 0,
    max: 27,
    inclusiveMax: false,
  },
  {
    id: "low",
    kmlClass: "Class 2",
    label: "Low",
    color: "#64B5F6",
    range: `27–30 ${U.wst}`,
    unit: U.wst,
    min: 27,
    max: 30,
    inclusiveMax: false,
  },
  {
    id: "moderate",
    kmlClass: "Class 3",
    label: "Moderate",
    color: "#FDD835",
    range: `30–33 ${U.wst}`,
    unit: U.wst,
    min: 30,
    max: 33,
    inclusiveMax: false,
  },
  {
    id: "high",
    kmlClass: "Class 4",
    label: "High",
    color: "#E53935",
    range: `33–36 ${U.wst}`,
    unit: U.wst,
    min: 33,
    max: 36,
    inclusiveMax: false,
  },
  {
    id: "very_high",
    kmlClass: "Class 5",
    label: "Very high",
    color: "#8E0000",
    range: `≥36 ${U.wst}`,
    unit: U.wst,
    min: 36,
    max: null,
    inclusiveMax: true,
  },
]);

/** E. coli / coliform — CFU/100 ml in legend; relative bathing class (Mandovi RiverEye). */
export const COLIFORM_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "good",
    kmlClass: "Good",
    label: "Good",
    color: "#2c7bb6",
    range: `≤ 250 ${U.coliform} (relative)`,
    unit: U.coliform,
    min: 0,
    max: 250,
    inclusiveMax: true,
  },
  {
    id: "moderate",
    kmlClass: "Moderate",
    label: "Moderate",
    color: "#91cf60",
    range: `260–500 ${U.coliform} (relative)`,
    unit: U.coliform,
    min: 260,
    max: 500,
    inclusiveMax: true,
  },
  {
    id: "high",
    kmlClass: "High",
    label: "High",
    color: "#fdae61",
    range: `500–2000 ${U.coliform} (relative)`,
    unit: U.coliform,
    min: 500,
    max: 2000,
    inclusiveMax: true,
  },
  {
    id: "highly_risk",
    kmlClass: "Highly risk",
    label: "Highly risk",
    color: "#d7191c",
    range: `> 2000 ${U.coliform} (relative)`,
    unit: U.coliform,
    min: 2000,
    max: null,
    inclusiveMax: false,
  },
]);

/** Eutrophication — Carlson TSI (dimensionless); hotspot also µg/L Chl-a (Mandovi RiverEye). */
export const EUTROPHICATION_CLASSES = [
  {
    id: "oligo",
    label: "Oligotrophic",
    color: "#2c7bb6",
    range: "TSI < 40 · < 2.6 µg/L Chl-a",
    unit: U.eutro,
  },
  {
    id: "meso",
    label: "Mesotrophic",
    color: "#abd9e9",
    range: "TSI 40–50 · 2.6–7.3 µg/L Chl-a",
    unit: U.eutro,
  },
  {
    id: "eutro",
    label: "Eutrophic",
    color: "#fdae61",
    range: "TSI 50–70 · 7.3–56 µg/L Chl-a",
    unit: U.eutro,
  },
  {
    id: "hyper",
    label: "Hypereutrophic",
    color: "#d7191c",
    range: "TSI > 70 · > 56 µg/L Chl-a",
    unit: U.eutro,
  },
];

/** Nitrogen — risk class / categorical, not mg N/L (Mandovi RiverEye). */
export const NITROGEN_RISK_CLASSES = [
  { id: "low", label: "Low", color: "#1a9641", range: "risk ≤ 0.33", unit: U.nitrogen },
  { id: "moderate", label: "Moderate", color: "#ffffbf", range: "0.33–0.66", unit: U.nitrogen },
  { id: "high", label: "High", color: "#d7191c", range: "risk > 0.66", unit: U.nitrogen },
];

/** BOD class A–E — categorical (Mandovi RiverEye). */
export const BOD_CLASS_CLASSES = [
  { id: "A", label: "Class A", color: "#1a9641", range: "A", unit: U.bodClass },
  { id: "B", label: "Class B", color: "#a6d96a", range: "B", unit: U.bodClass },
  { id: "C", label: "Class C", color: "#ffffbf", range: "C", unit: U.bodClass },
  { id: "D", label: "Class D", color: "#fdae61", range: "D", unit: U.bodClass },
  { id: "E", label: "Class E", color: "#d7191c", range: "E", unit: U.bodClass },
];

/** Pollution severity — class / categorical. */
export const POLLUTION_SEVERITY_CLASSES = [
  { id: "low", label: "Low", color: "#1a9641", range: "low", unit: U.severity },
  { id: "moderate", label: "Moderate", color: "#ffffbf", range: "moderate", unit: U.severity },
  { id: "high", label: "High", color: "#fdae61", range: "high", unit: U.severity },
  { id: "severe", label: "Severe", color: "#d7191c", range: "severe", unit: U.severity },
];

export const WQ_LAYER_SCHEMES = {
  water_quality_tss: {
    id: "water_quality_tss",
    title: "TSS / Turbidity",
    metric: "Turbidity / TSS",
    unit: U.tss,
    classes: TSS_CLASSES,
    subtitle: `3 classes · ${U.tss} · Mandovi RiverEye units`,
  },
  salinity: {
    id: "salinity",
    title: "Salinity",
    metric: "Salinity",
    unit: U.salinity,
    classes: SALINITY_CLASSES,
    subtitle: `5 classes · ${U.salinity} · Mandovi RiverEye units`,
  },
  water_quality_ndci: {
    id: "water_quality_ndci",
    title: "Chlorophyll-a / NDCI",
    metric: "NDCI Chlorophyll Proxy",
    unit: U.ndci,
    classes: CHLOROPHYLL_CLASSES,
    subtitle: `2 classes · NDCI ${U.ndci} · Mandovi RiverEye units`,
  },
  water_quality_ndwi: {
    id: "water_quality_ndwi",
    title: "NDWI",
    metric: "Permanent Water Index",
    unit: U.ndwi,
    classes: NDWI_CLASSES,
    subtitle: `2 classes · NDWI ${U.ndwi} · Mandovi RiverEye units`,
  },
  water_quality_wst: {
    id: "water_quality_wst",
    title: "WST — Temperature",
    metric: "Water Surface Temperature",
    unit: U.wst,
    classes: WST_CLASSES,
    subtitle: `5 classes · ${U.wst} · Mandovi RiverEye units`,
  },
  water_quality_coliform: {
    id: "water_quality_coliform",
    title: "Coliform / E. coli",
    metric: "E. coli / coliform class",
    unit: U.coliform,
    classes: COLIFORM_CLASSES,
    subtitle: `4 classes · ${U.coliform} · relative bathing class`,
  },
  pollution_eutrophication: {
    id: "pollution_eutrophication",
    title: "Eutrophication",
    metric: "Carlson TSI",
    unit: U.eutro,
    classes: EUTROPHICATION_CLASSES,
    subtitle: `TSI (Carlson) · hotspot also µg/L Chl-a · Mandovi RiverEye units`,
  },
  pollution_nitrogen: {
    id: "pollution_nitrogen",
    title: "Nitrogen",
    metric: "High-nitrogen risk class",
    unit: U.nitrogen,
    classes: NITROGEN_RISK_CLASSES,
    subtitle: `Risk ${U.nitrogen} · not mg N/L · Mandovi RiverEye units`,
  },
  bod_class: {
    id: "bod_class",
    title: "BOD class (A–E)",
    metric: "BOD class",
    unit: U.bodClass,
    classes: BOD_CLASS_CLASSES,
    subtitle: `Categorical A–E · BOD also ${U.bod}`,
  },
  pollution_severity: {
    id: "pollution_severity",
    title: "Pollution severity",
    metric: "Pollution severity",
    unit: U.severity,
    classes: POLLUTION_SEVERITY_CLASSES,
    subtitle: `Severity ${U.severity} · score ${U.hotspot}`,
  },
};

/** Re-export units catalog for HUD / tooltip consumers. */
export { LAYER_UNITS, unitFor };

/**
 * Classify a numeric sample into the official scheme.
 * @param {number} value
 * @param {WqClass[]} classes
 */
export function classifyWaterQualityValue(value, classes) {
  const v = Number(value);
  if (!Number.isFinite(v) || !classes?.length) return null;

  for (let i = 0; i < classes.length; i++) {
    const c = classes[i];
    const min = c.min == null ? -Infinity : Number(c.min);
    const max = c.max == null ? null : Number(c.max);
    const next = classes[i + 1];

    if (max == null) {
      if (v > min) return c;
      continue;
    }

    const upperOk = c.inclusiveMax ? v <= max : v < max;
    if (v >= min && upperOk) {
      if (next && v === max && next.min === max && c.inclusiveMax) return c;
      return c;
    }
  }
  return null;
}

/** Representative midpoint (or just-above threshold) for tooltip numeric display. */
export function classRepresentativeValue(c) {
  if (!c) return null;
  const min = Number(c.min);
  if (!Number.isFinite(min) && c.max == null) return null;
  if (c.max == null) {
    if (c.unit === "µg/L" || c.unit === "TSI") return (Number.isFinite(min) ? min : 0) + 1;
    return (Number.isFinite(min) ? min : 0) + 10;
  }
  const lo = Number.isFinite(min) ? min : 0;
  return (lo + Number(c.max)) / 2;
}

export function formatWqValue(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "—";
  if (!unit || unit === "class" || unit === "index") {
    if (unit === "index") return `${v.toFixed(2)} (index)`;
    if (unit === "class") return String(v);
    return v.toFixed(2);
  }
  const digits = unit === "ppt" || unit === "0–1" || unit === "TSI" ? 2 : 1;
  return `${v.toFixed(digits)} ${unit}`;
}
