/**
 * Official water-quality class schemes for Mula–Mutha Hydrology.
 * Ranges and colors are the single source of truth for legends, polygons, and tooltips.
 */

/** @typedef {{ id:string, kmlClass?:string, label:string, color:string, range:string, unit:string, min:number, max:number|null, inclusiveMax?:boolean }} WqClass */

/** TSS — spectral proxy classes (JalNetra 2026-11-11). */
export const TSS_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "low",
    kmlClass: "Low",
    label: "Low",
    color: "#2196F3",
    range: "TSS ≤ 0.62",
    unit: "",
    min: 0,
    max: 0.62,
    inclusiveMax: true,
  },
  {
    id: "medium",
    kmlClass: "Medium",
    label: "Medium",
    color: "#FFC107",
    range: "0.62–1.17",
    unit: "",
    min: 0.62,
    max: 1.17,
    inclusiveMax: true,
  },
  {
    id: "high",
    kmlClass: "High",
    label: "High",
    color: "#F44336",
    range: "TSS > 1.17",
    unit: "",
    min: 1.17,
    max: null,
    inclusiveMax: false,
  },
]);

/**
 * Relative salinity index (0–1) — JalNetra 2026-11-11.
 */
export const SALINITY_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "very_low",
    kmlClass: "Very Low",
    label: "Very Low",
    color: "#0000FF",
    range: "0.00–0.20",
    unit: "",
    min: 0,
    max: 0.2,
    inclusiveMax: true,
  },
  {
    id: "low",
    kmlClass: "Low",
    label: "Low",
    color: "#00BFFF",
    range: "0.20–0.40",
    unit: "",
    min: 0.2,
    max: 0.4,
    inclusiveMax: true,
  },
  {
    id: "moderate",
    kmlClass: "Moderate",
    label: "Moderate",
    color: "#00FF00",
    range: "0.40–0.60",
    unit: "",
    min: 0.4,
    max: 0.6,
    inclusiveMax: true,
  },
  {
    id: "high",
    kmlClass: "High",
    label: "High",
    color: "#FFFF00",
    range: "0.60–0.80",
    unit: "",
    min: 0.6,
    max: 0.8,
    inclusiveMax: true,
  },
  {
    id: "very_high",
    kmlClass: "Very High",
    label: "Very High",
    color: "#FF0000",
    range: "0.80–1.00",
    unit: "",
    min: 0.8,
    max: 1,
    inclusiveMax: true,
  },
]);

/** Chlorophyll-a (NDCI proxy) — JalNetra 2026-11-11. */
export const CHLOROPHYLL_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "low",
    kmlClass: "Low Chlorophyll",
    label: "Low",
    color: "#C8E6C9",
    range: "NDCI < 0",
    unit: "",
    min: null,
    max: 0,
    inclusiveMax: false,
  },
  {
    id: "high",
    kmlClass: "High Chlorophyll",
    label: "High",
    color: "#1B5E20",
    range: "NDCI ≥ 0",
    unit: "",
    min: 0,
    max: null,
    inclusiveMax: true,
  },
]);

/** E. coli / coliform — relative CFU class (JalNetra 2026-11-11). */
export const COLIFORM_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "good",
    kmlClass: "Good",
    label: "Good",
    color: "#2c7bb6",
    range: "≤ 250 CFU/100 ml (relative)",
    unit: "CFU/100 ml",
    min: 0,
    max: 250,
    inclusiveMax: true,
  },
  {
    id: "moderate",
    kmlClass: "Moderate",
    label: "Moderate",
    color: "#91cf60",
    range: "260–500 (relative)",
    unit: "CFU/100 ml",
    min: 260,
    max: 500,
    inclusiveMax: true,
  },
  {
    id: "high",
    kmlClass: "High",
    label: "High",
    color: "#fdae61",
    range: "500–2000 (relative)",
    unit: "CFU/100 ml",
    min: 500,
    max: 2000,
    inclusiveMax: true,
  },
  {
    id: "highly_risk",
    kmlClass: "Highly risk",
    label: "Highly risk",
    color: "#d7191c",
    range: "> 2000 (relative)",
    unit: "CFU/100 ml",
    min: 2000,
    max: null,
    inclusiveMax: false,
  },
]);

/** Eutrophication trophic class — JalNetra 2026-11-11. */
export const EUTROPHICATION_CLASSES = [
  {
    id: "oligo",
    label: "Oligotrophic",
    color: "#2c7bb6",
    range: "< 2.6 µg/L (TSI < 40)",
  },
  {
    id: "meso",
    label: "Mesotrophic",
    color: "#abd9e9",
    range: "2.6–7.3 µg/L (TSI 40–50)",
  },
  {
    id: "eutro",
    label: "Eutrophic",
    color: "#fdae61",
    range: "7.3–56 µg/L (TSI 50–70)",
  },
  {
    id: "hyper",
    label: "Hypereutrophic",
    color: "#d7191c",
    range: "> 56 µg/L (TSI > 70)",
  },
];

/** High-nitrogen risk class (JalNetra Mula–Mutha). */
export const NITROGEN_RISK_CLASSES = [
  { id: "low", label: "Low", color: "#1a9641", range: "risk ≤ 0.33" },
  { id: "moderate", label: "Moderate", color: "#ffffbf", range: "0.33–0.66" },
  { id: "high", label: "High", color: "#d7191c", range: "risk > 0.66" },
];

export const WQ_LAYER_SCHEMES = {
  water_quality_tss: {
    id: "water_quality_tss",
    title: "TSS",
    metric: "Turbidity / TSS Proxy",
    unit: "",
    classes: TSS_CLASSES,
    subtitle: "3 classes · spectral proxy · 2026-11-11",
  },
  salinity: {
    id: "salinity",
    title: "Salinity",
    metric: "Relative Salinity Index",
    unit: "",
    classes: SALINITY_CLASSES,
    subtitle: "5 classes · relative 0–1 · 2026-11-11",
  },
  water_quality_ndci: {
    id: "water_quality_ndci",
    title: "Chlorophyll-a",
    metric: "NDCI Chlorophyll Proxy",
    unit: "",
    classes: CHLOROPHYLL_CLASSES,
    subtitle: "2 classes · NDCI · 2026-11-11",
  },
  water_quality_coliform: {
    id: "water_quality_coliform",
    title: "Coliform",
    metric: "E. coli / coliform class",
    unit: "CFU/100 ml",
    classes: COLIFORM_CLASSES,
    subtitle: "4 classes · relative · 2026-11-11",
  },
  pollution_eutrophication: {
    id: "pollution_eutrophication",
    title: "Eutrophication",
    metric: "Trophic class",
    unit: "µg/L",
    classes: EUTROPHICATION_CLASSES,
    subtitle: "Trophic class · 2026-11-11",
  },
  pollution_nitrogen: {
    id: "pollution_nitrogen",
    title: "Nitrogen",
    metric: "High-nitrogen risk class",
    unit: "",
    classes: NITROGEN_RISK_CLASSES,
    subtitle: "High-nitrogen risk class · 2026-11-11",
  },
};

/**
 * Classify a numeric sample into the official scheme.
 * Boundary rules:
 * - TSS: 10 → Low, 50 → Moderate, >50 → High
 * - Salinity (ppt): lower edge inclusive, values above 30 → Very High
 * - Chlorophyll-a: 2 → Low, >2 → High
 * @param {number} value
 * @param {WqClass[]} classes
 */
export function classifyWaterQualityValue(value, classes) {
  const v = Number(value);
  if (!Number.isFinite(v) || !classes?.length) return null;

  // Walk in order; each class owns [min, max] with inclusiveMax on the upper edge.
  // Open-ended High classes own (min, ∞).
  for (let i = 0; i < classes.length; i++) {
    const c = classes[i];
    const min = Number(c.min);
    const max = c.max == null ? null : Number(c.max);
    const next = classes[i + 1];

    if (max == null) {
      // ">X" class — strictly greater than min
      if (v > min) return c;
      continue;
    }

    // Prefer assigning the shared upper boundary to this class when inclusiveMax
    // and the next class starts at the same number.
    const upperOk = c.inclusiveMax ? v <= max : v < max;
    if (v >= min && upperOk) {
      // If next class also claims this exact value as its min with exclusive prev,
      // keep current when inclusiveMax.
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
  if (c.max == null) {
    if (c.unit === "µg/L") return min + 1;
    return min + 10;
  }
  return (min + Number(c.max)) / 2;
}

export function formatWqValue(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "—";
  const digits = unit === "ppt" ? 2 : 1;
  return `${v.toFixed(digits)} ${unit}`;
}
