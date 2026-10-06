/**
 * Official water-quality class schemes for Mula–Mutha Hydrology.
 * Ranges and colors are the single source of truth for legends, polygons, and tooltips.
 */

/** @typedef {{ id:string, kmlClass?:string, label:string, color:string, range:string, unit:string, min:number, max:number|null, inclusiveMax?:boolean }} WqClass */

/** TSS — 3 classes (mg/L) */
export const TSS_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "low",
    kmlClass: "Class 1",
    label: "Low",
    color: "#2ECC71",
    range: "0–10 mg/L",
    unit: "mg/L",
    min: 0,
    max: 10,
    inclusiveMax: true,
  },
  {
    id: "moderate",
    kmlClass: "Class 2",
    label: "Moderate",
    color: "#F39C12",
    range: "10–50 mg/L",
    unit: "mg/L",
    min: 10,
    max: 50,
    inclusiveMax: true,
  },
  {
    id: "high",
    kmlClass: "Class 3",
    label: "High",
    color: "#E74C3C",
    range: ">50 mg/L",
    unit: "mg/L",
    min: 50,
    max: null,
    inclusiveMax: false,
  },
]);

/**
 * Salinity — 5 NDSI classes (unitless index, −1 to 1), as defined in public/data/hydrology/salinity.geojson.
 */
export const SALINITY_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "very_low",
    kmlClass: "Very Low Salinity",
    label: "Very Low Salinity",
    color: "#0000FF",
    range: "−1.00 to −0.60",
    unit: "NDSI",
    min: -1.0,
    max: -0.6,
    inclusiveMax: false,
  },
  {
    id: "low",
    kmlClass: "Low Salinity",
    label: "Low Salinity",
    color: "#00BFFF",
    range: "−0.60 to −0.20",
    unit: "NDSI",
    min: -0.6,
    max: -0.2,
    inclusiveMax: false,
  },
  {
    id: "moderate",
    kmlClass: "Moderate Salinity",
    label: "Moderate Salinity",
    color: "#00FF00",
    range: "−0.20 to 0.20",
    unit: "NDSI",
    min: -0.2,
    max: 0.2,
    inclusiveMax: false,
  },
  {
    id: "high",
    kmlClass: "High Salinity",
    label: "High Salinity",
    color: "#FFFF00",
    range: "0.20 to 0.60",
    unit: "NDSI",
    min: 0.2,
    max: 0.6,
    inclusiveMax: false,
  },
  {
    id: "very_high",
    kmlClass: "Very High Salinity",
    label: "Very High Salinity",
    color: "#FF0000",
    range: "0.60 to 1.00",
    unit: "NDSI",
    min: 0.6,
    max: 1.0,
    inclusiveMax: true,
  },
]);

/** Chlorophyll-a (NDCI) — 2 classes (µg/L) */
export const CHLOROPHYLL_CLASSES = /** @type {WqClass[]} */ ([
  {
    id: "low",
    kmlClass: "Class 1",
    label: "Low",
    color: "#A5D6A7",
    range: "0–2 µg/L",
    unit: "µg/L",
    min: 0,
    max: 2,
    inclusiveMax: true,
  },
  {
    id: "high",
    kmlClass: "Class 2",
    label: "High",
    color: "#1B5E20",
    range: ">2 µg/L",
    unit: "µg/L",
    min: 2,
    max: null,
    inclusiveMax: false,
  },
]);

export const WQ_LAYER_SCHEMES = {
  water_quality_tss: {
    id: "water_quality_tss",
    title: "TSS",
    metric: "Total Suspended Solids",
    unit: "mg/L",
    classes: TSS_CLASSES,
    subtitle: "3 classes · mg/L",
  },
  salinity: {
    id: "salinity",
    title: "Salinity",
    metric: "Salinity",
    unit: "NDSI",
    classes: SALINITY_CLASSES,
    subtitle: "5 classes · NDSI",
  },
  water_quality_ndci: {
    id: "water_quality_ndci",
    title: "Chlorophyll-a",
    metric: "Chlorophyll-a",
    unit: "µg/L",
    classes: CHLOROPHYLL_CLASSES,
    subtitle: "2 classes · µg/L",
  },
};

/**
 * Classify a numeric sample into the official scheme.
 * Boundary rules:
 * - TSS: 10 → Low, 50 → Moderate, >50 → High
 * - Salinity (NDSI): lower edge inclusive, 1.00 → Very High
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
  const digits = unit === "NDSI" ? 2 : 1;
  return `${v.toFixed(digits)} ${unit}`;
}
