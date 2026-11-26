/**
 * Rank Mula–Mutha pollution hotspots from this project's own sources only:
 *   public/data/main_bod_cod_pixels.json
 *   src/jalnetra kml/eutrophication_trophic_class.kml
 *   src/jalnetra kml/Nitrogen mulamutha.kml
 *   src/jalnetra kml/coliform_ecoli_class.kml
 * Missing parameters stay null. No Mandovi values. No invented mg/L or CFU.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(
  "c:/Users/Sahil.Rajankar/Desktop/Shweta/Mandavi_River/package.json",
);
const { PNG } = require("pngjs");

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STUDY = { west: 73.85496516, east: 73.99343968, south: 18.5207626, north: 18.54727939 };

const KML_LAYERS = [
  {
    id: "eutrophication",
    label: "Eutrophication",
    unit: "µg/L Chl-a · TSI",
    path: "src/jalnetra kml/eutrophication_trophic_class.kml",
    classes: [
      { id: "oligo", label: "Oligotrophic", color: "#2c7bb6", severity: 0.15, valueText: "< 2.6 µg/L", display: "< 2.6 µg/L (TSI < 40)" },
      { id: "meso", label: "Mesotrophic", color: "#abd9e9", severity: 0.35, valueText: "2.6–7.3 µg/L", display: "2.6–7.3 µg/L (TSI 40–50)" },
      { id: "eutro", label: "Eutrophic", color: "#fdae61", severity: 0.7, valueText: "7.3–56 µg/L", display: "7.3–56 µg/L (TSI 50–70)" },
      { id: "hyper", label: "Hypereutrophic", color: "#d7191c", severity: 1, valueText: "> 56 µg/L", display: "> 56 µg/L (TSI > 70)" },
    ],
  },
  {
    id: "nitrogen",
    label: "Nitrogen",
    unit: "risk class (not mg N/L)",
    note: "KML is a risk class. Class is not converted to mg N/L.",
    path: "src/jalnetra kml/Nitrogen mulamutha.kml",
    classes: [
      { id: "low", label: "Low", color: "#1a9641", severity: 0.2, classIndex: 1, classOf: 3, valueText: "1 / 3", display: "Low risk (class 1 of 3)" },
      { id: "moderate", label: "Moderate", color: "#ffffbf", severity: 0.55, classIndex: 2, classOf: 3, valueText: "2 / 3", display: "Moderate risk (class 2 of 3)" },
      { id: "high", label: "High", color: "#d7191c", severity: 1, classIndex: 3, classOf: 3, valueText: "3 / 3", display: "High risk (class 3 of 3)" },
    ],
  },
  {
    id: "coliform",
    label: "Coliform",
    unit: "class (relative CFU band, not a counted CFU)",
    note: "Legend bands are relative classes. Not converted to a single CFU/100 ml count.",
    path: "src/jalnetra kml/coliform_ecoli_class.kml",
    classes: [
      { id: "good", label: "Good", color: "#2c7bb6", severity: 0.15, valueText: "≤ 250", display: "≤ 250 CFU/100 ml (relative)" },
      { id: "moderate", label: "Moderate", color: "#91cf60", severity: 0.4, valueText: "260–500", display: "260–500 (relative)" },
      { id: "high", label: "High", color: "#fdae61", severity: 0.75, valueText: "500–2000", display: "500–2000 (relative)" },
      { id: "highly_risk", label: "Highly risk", color: "#d7191c", severity: 1, valueText: "> 2000", display: "> 2000 (relative)" },
    ],
  },
];

const RED_SHADES = [
  { id: "light", label: "Elevated", hex: "#FF8A80", min: 0, max: 0.35 },
  { id: "medium", label: "High", hex: "#FBC02D", min: 0.35, max: 0.55 },
  { id: "strong", label: "Very High", hex: "#E53935", min: 0.55, max: 0.75 },
  { id: "severe", label: "Severe", hex: "#C62828", min: 0.75, max: 0.9 },
  { id: "extreme", label: "Extreme", hex: "#8B0000", min: 0.9, max: 1.01 },
];

const WEIGHTS = { bod: 0.3, eutrophication: 0.25, nitrogen: 0.2, coliform: 0.25 };

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function classFromRgb(r, g, b, classes) {
  let best = null;
  let bestD = Infinity;
  for (const c of classes) {
    const rgb = hexToRgb(c.color);
    const d = (r - rgb.r) ** 2 + (g - rgb.g) ** 2 + (b - rgb.b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  // KML PNGs are quantized, so legend orange sits farther than 70² from #fdae61.
  if (bestD > 150 * 150) return null;
  return best;
}
function shadeFor(score01) {
  const s = Math.max(0, Math.min(1, score01));
  return RED_SHADES.find((r) => s >= r.min && s < r.max) || RED_SHADES[RED_SHADES.length - 1];
}
function tag(text, name) {
  const re = new RegExp(`<(?:\\w+:)?${name}[^>]*>\\s*([^<]+)`, "i");
  return text.match(re)?.[1]?.trim() ?? null;
}
function inStudy(lon, lat) {
  return lon >= STUDY.west && lon <= STUDY.east && lat >= STUDY.south && lat <= STUDY.north;
}
function parseKmlOverlay(rel) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  const north = Number(tag(text, "north"));
  const south = Number(tag(text, "south"));
  const east = Number(tag(text, "east"));
  const west = Number(tag(text, "west"));
  const m = text.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/i);
  if (!m) throw new Error(`No PNG in ${rel}`);
  const png = PNG.sync.read(Buffer.from(m[1].replace(/\s+/g, ""), "base64"));
  return { north, south, east, west, png };
}
function packClassInfo(layerDef, cls, extra = {}) {
  if (!cls) return null;
  return {
    label: layerDef.label,
    classId: cls.id,
    classLabel: cls.label,
    severity: cls.severity,
    unit: layerDef.unit || "",
    valueText: cls.valueText || cls.label,
    display: cls.display || cls.label,
    classIndex: cls.classIndex ?? null,
    classOf: cls.classOf ?? null,
    ...extra,
  };
}
function sampleOverlayAt(overlay, layerDef, lon, lat) {
  const { north, south, east, west, png } = overlay;
  if (!(east > west) || !(north > south)) return null;
  const u = (lon - west) / (east - west);
  const v = (north - lat) / (north - south);
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const cx = Math.round(u * (png.width - 1));
  const cy = Math.round(v * (png.height - 1));
  function voteAt(px, py, rad = 1) {
    const votes = new Map();
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = Math.max(0, Math.min(png.width - 1, px + dx));
        const y = Math.max(0, Math.min(png.height - 1, py + dy));
        const i = (png.width * y + x) << 2;
        if (png.data[i + 3] < 40) continue;
        const cls = classFromRgb(png.data[i], png.data[i + 1], png.data[i + 2], layerDef.classes);
        if (!cls) continue;
        votes.set(cls.id, (votes.get(cls.id) || 0) + 1);
      }
    }
    if (!votes.size) return null;
    let bestId = null;
    let bestN = -1;
    for (const [id, n] of votes) if (n > bestN) { bestN = n; bestId = id; }
    return packClassInfo(layerDef, layerDef.classes.find((c) => c.id === bestId), { pixelCount: bestN });
  }
  return voteAt(cx, cy, 1) || voteAt(cx, cy, 3);
}
function sampleKmlLayer(layerDef) {
  const { north, south, east, west, png } = parseKmlOverlay(layerDef.path);
  const step = Math.max(4, Math.floor(Math.min(png.width, png.height) / 180));
  const cells = new Map();
  const classCounts = Object.fromEntries(layerDef.classes.map((c) => [c.id, 0]));
  let highPixels = 0;
  let sampled = 0;
  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      const i = (png.width * y + x) << 2;
      if (png.data[i + 3] < 40) continue;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      if (r + g + b < 40) continue;
      sampled++;
      const cls = classFromRgb(r, g, b, layerDef.classes);
      if (!cls) continue;
      classCounts[cls.id] = (classCounts[cls.id] || 0) + 1;
      if (cls.severity < 0.5) continue;
      const lon = west + (x / Math.max(1, png.width - 1)) * (east - west);
      const lat = north - (y / Math.max(1, png.height - 1)) * (north - south);
      if (!inStudy(lon, lat)) continue;
      highPixels++;
      const key = `${(Math.floor(lon / 0.008) * 0.008).toFixed(3)}:${(Math.floor(lat / 0.008) * 0.008).toFixed(3)}`;
      let c = cells.get(key);
      if (!c) {
        c = { lon: 0, lat: 0, n: 0, severitySum: 0, maxSeverity: 0, peakLon: lon, peakLat: lat, classId: cls.id };
        cells.set(key, c);
      }
      c.lon += lon; c.lat += lat; c.n += 1; c.severitySum += cls.severity;
      if (cls.severity > c.maxSeverity) {
        c.maxSeverity = cls.severity;
        c.peakLon = lon;
        c.peakLat = lat;
        c.classId = cls.id;
      }
    }
  }
  return { id: layerDef.id, label: layerDef.label, bounds: { north, south, east, west }, sampled, highPixels, classCounts, cells };
}

function bodLevel(v) {
  return !Number.isFinite(v) ? "na" : v <= 3 ? "good" : v <= 6 ? "moderate" : "high";
}
function codLevel(v) {
  return !Number.isFinite(v) ? "na" : v <= 10 ? "good" : v <= 30 ? "moderate" : "high";
}

const bodDoc = JSON.parse(fs.readFileSync(path.join(root, "public/data/main_bod_cod_pixels.json"), "utf8"));
const bodPts = [];
for (const row of bodDoc.points || []) {
  const [lon, lat, bod, cod] = row;
  if (![lon, lat, bod, cod].every(Number.isFinite)) continue;
  if (!inStudy(lon, lat)) continue;
  bodPts.push({ lon, lat, bod, cod, score: bod / 10 + cod / 30 });
}
bodPts.sort((a, b) => b.score - a.score);
const bodMaxScore = bodPts[0]?.score || 1;
const bodCells = new Map();
const topBod = bodPts.slice(0, Math.max(80, Math.floor(bodPts.length * 0.05)));
for (const p of topBod) {
  const key = `${(Math.floor(p.lon / 0.008) * 0.008).toFixed(3)}:${(Math.floor(p.lat / 0.008) * 0.008).toFixed(3)}`;
  let c = bodCells.get(key);
  if (!c) c = { lon: 0, lat: 0, n: 0, bod: 0, cod: 0, maxBod: 0, maxCod: 0, peakLon: p.lon, peakLat: p.lat, score: 0 };
  c.lon += p.lon; c.lat += p.lat; c.n += 1; c.bod += p.bod; c.cod += p.cod;
  if (p.bod > c.maxBod || (p.bod === c.maxBod && p.cod > c.maxCod)) {
    c.maxBod = p.bod; c.maxCod = p.cod; c.peakLon = p.lon; c.peakLat = p.lat; c.score = p.score;
  }
  bodCells.set(key, c);
}

console.log("Sampling Mula–Mutha KML overlays…");
const kmlResults = KML_LAYERS.map((def) => {
  const result = sampleKmlLayer(def);
  console.log(def.id, { highPixels: result.highPixels, cells: result.cells.size, classCounts: result.classCounts });
  return result;
});

const merged = new Map();
function ensureCell(key, lon, lat) {
  let c = merged.get(key);
  if (!c) {
    c = { id: key, lon, lat, layers: {}, bod: null, thickness: 0 };
    merged.set(key, c);
  }
  return c;
}
for (const [key, c] of bodCells) {
  const cell = ensureCell(key, c.peakLon, c.peakLat);
  cell.bod = {
    maxBod: +c.maxBod.toFixed(3),
    maxCod: +c.maxCod.toFixed(3),
    meanBod: +(c.bod / c.n).toFixed(3),
    meanCod: +(c.cod / c.n).toFixed(3),
    pixelCount: c.n,
    score01: Math.min(1, c.score / bodMaxScore),
    bodLevel: bodLevel(c.maxBod),
    codLevel: codLevel(c.maxCod),
    provenance: "public/data/main_bod_cod_pixels.json",
  };
  cell.thickness += c.n;
  cell.lon = c.peakLon;
  cell.lat = c.peakLat;
}
for (const layer of kmlResults) {
  const def = KML_LAYERS.find((d) => d.id === layer.id);
  for (const [key, c] of layer.cells) {
    const cell = ensureCell(key, c.peakLon, c.peakLat);
    const clsDef = def.classes.find((x) => x.id === c.classId);
    cell.layers[layer.id] = packClassInfo(def, clsDef, {
      severity: +c.maxSeverity.toFixed(3),
      pixelCount: c.n,
      meanSeverity: +(c.severitySum / c.n).toFixed(3),
      provenance: def.path,
    });
    cell.thickness += c.n;
    if (!cell.bod) {
      cell.lon = c.peakLon;
      cell.lat = c.peakLat;
    }
  }
}

function nearestBodCod(lon, lat) {
  let best = null;
  let bestD = Infinity;
  for (const p of bodPts) {
    const d = (p.lon - lon) ** 2 + (p.lat - lat) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best || bestD > 0.011 * 0.011) return null;
  return best;
}

const hotspots = [...merged.values()].map((c) => {
  const parts = [];
  let wSum = 0;
  let sSum = 0;
  if (c.bod) {
    parts.push({ id: "bod_cod", label: "BOD–COD", score: c.bod.score01, weight: WEIGHTS.bod });
    sSum += c.bod.score01 * WEIGHTS.bod;
    wSum += WEIGHTS.bod;
  }
  for (const lid of ["eutrophication", "nitrogen", "coliform"]) {
    const L = c.layers[lid];
    if (!L) continue;
    parts.push({ id: lid, label: L.label, score: L.severity, weight: WEIGHTS[lid], classLabel: L.classLabel, pixelCount: L.pixelCount });
    sSum += L.severity * WEIGHTS[lid];
    wSum += WEIGHTS[lid];
  }
  if (!wSum) return null;
  const weightedMean = sSum / wSum;
  const layerBonus = Math.min(0.14, (parts.length - 1) * 0.045);
  const thickBonus = Math.min(0.1, Math.log10(1 + c.thickness) / 35);
  const uncapped = weightedMean + layerBonus + thickBonus;
  const rawComposite = Math.min(1, uncapped);
  // Unclamped organic index. bod/10 + cod/30 already exceeds 1 at every
  // retained site, which is why dividing by the dataset maximum and then
  // adding bonuses clamps the raw score at 1. This term keeps the measured
  // mg/L values distinct. It does not replace those measurements.
  const organic = c.bod ? c.bod.maxBod / 10 + c.bod.maxCod / 30 : null;
  let uW = 0;
  let uS = 0;
  if (organic != null) {
    uS += organic * WEIGHTS.bod;
    uW += WEIGHTS.bod;
  }
  for (const lid of ["eutrophication", "nitrogen", "coliform"]) {
    const L = c.layers[lid];
    if (!L) continue;
    uS += L.severity * WEIGHTS[lid];
    uW += WEIGHTS[lid];
  }
  const underlying = uW ? uS / uW : null;
  return {
    id: c.id,
    rank: 0,
    name: null,
    lon: +c.lon.toFixed(6),
    lat: +c.lat.toFixed(6),
    chainageMeters: null,
    weightedMean: +weightedMean.toFixed(4),
    layerBonus: +layerBonus.toFixed(4),
    thickBonus: +thickBonus.toFixed(4),
    uncappedComposite: +uncapped.toFixed(4),
    rawComposite: +rawComposite.toFixed(4),
    underlying: underlying == null ? null : +underlying.toFixed(4),
    organicIndex: organic == null ? null : +organic.toFixed(4),
    composite: +rawComposite.toFixed(4),
    calibratedComposite: null,
    shade: null,
    shadeLabel: null,
    severity: null,
    color: null,
    thickness: c.thickness,
    layersPresent: parts.map((p) => p.id),
    contributingLayers: parts.map((p) => p.label),
    layerScores: parts,
    maxBod: c.bod?.maxBod ?? null,
    maxCod: c.bod?.maxCod ?? null,
    meanBod: c.bod?.meanBod ?? null,
    meanCod: c.bod?.meanCod ?? null,
    bodPixelCount: c.bod?.pixelCount ?? 0,
    bod: c.bod?.maxBod ?? null,
    cod: c.bod?.maxCod ?? null,
    eutrophication: c.layers.eutrophication || null,
    nitrogen: c.layers.nitrogen || null,
    coliform: c.layers.coliform || null,
    provenance: [
      c.bod ? "public/data/main_bod_cod_pixels.json" : null,
      ...["eutrophication", "nitrogen", "coliform"].map((id) => c.layers[id]?.provenance || null),
    ].filter(Boolean),
    observationDate: null,
    sourceUpdated: "2026-11-11",
    dataQuality: c.bod ? "OBSERVED+CLASSIFIED" : "CLASSIFIED",
  };
}).filter(Boolean).filter(
  (h) => h.layersPresent.length >= 2 || (h.layersPresent.length === 1 && h.composite >= 0.85 && h.thickness >= 8),
).sort((a, b) =>
  (b.underlying ?? -1) - (a.underlying ?? -1) ||
  b.thickness - a.thickness ||
  (b.maxBod ?? -1) - (a.maxBod ?? -1) ||
  (b.maxCod ?? -1) - (a.maxCod ?? -1),
);

// Spread the display score across the 12 published hotspots only. Doing it
// across every eligible cell leaves these 12 squeezed against the top.
const published = hotspots.slice(0, 12);
const under = published.map((h) => h.underlying).filter((v) => Number.isFinite(v));
const uLo = Math.min(...under);
const uHi = Math.max(...under);
for (const h of published) {
  const t = !Number.isFinite(h.underlying) || uHi === uLo ? h.rawComposite : (h.underlying - uLo) / (uHi - uLo);
  const calibrated = Math.min(1, Math.max(0, 0.15 + 0.85 * t));
  const shade = shadeFor(calibrated);
  h.calibratedComposite = +calibrated.toFixed(4);
  h.composite = h.calibratedComposite;
  h.shade = shade.id;
  h.shadeLabel = shade.label;
  h.severity = shade.label;
  h.color = shade.hex;
}

hotspots.forEach((h, i) => { h.rank = i + 1; });

const overlaysById = new Map(KML_LAYERS.map((def) => [def.id, { def, overlay: parseKmlOverlay(def.path) }]));
const top = hotspots.slice(0, 12);
for (const h of top) {
  if (!Number.isFinite(h.maxBod) || !Number.isFinite(h.maxCod)) {
    const hit = nearestBodCod(h.lon, h.lat);
    if (hit) {
      h.maxBod = +hit.bod.toFixed(3);
      h.maxCod = +hit.cod.toFixed(3);
      h.bod = h.maxBod;
      h.cod = h.maxCod;
      h.meanBod = h.meanBod ?? h.maxBod;
      h.meanCod = h.meanCod ?? h.maxCod;
      h.bodFilledFrom = "nearest-mula-mutha-pixel";
      h.provenance.push("public/data/main_bod_cod_pixels.json");
    }
  }
  for (const def of KML_LAYERS) {
    const pack = overlaysById.get(def.id);
    const hit = sampleOverlayAt(pack.overlay, def, h.lon, h.lat);
    if (!h[def.id] && hit) {
      h[def.id] = { ...hit, provenance: def.path };
      if (!h.layersPresent.includes(def.id)) h.layersPresent.push(def.id);
    }
  }
  h.eutrophicationClass = h.eutrophication?.classLabel || null;
  h.nitrogenRiskClass = h.nitrogen?.classLabel || null;
  h.coliformClass = h.coliform?.classLabel || null;
  h.name = `Mula–Mutha ${h.rank}`;
}

const payload = {
  river: "Mula–Mutha",
  source: [
    "public/data/main_bod_cod_pixels.json",
    "src/jalnetra kml/eutrophication_trophic_class.kml",
    "src/jalnetra kml/Nitrogen mulamutha.kml",
    "src/jalnetra kml/coliform_ecoli_class.kml",
  ],
  method:
    "Weights stay BOD 0.30, eutrophication 0.25, nitrogen risk 0.20, coliform 0.25. rawComposite is the original weighted mean plus multi-layer and thickness bonuses, clamped at 1. underlying keeps the same weights but uses the unclamped organic index bod/10 + cod/30 so measured mg/L values are not flattened. calibratedComposite (also written to composite) rescales underlying across the published hotspots from 0.15 to 1 for display and colour. High is yellow. TSS is not used. Nitrogen and coliform stay classes. BOD and COD numbers are the measured pixel values.",
  calibration: {
    reason: "Every published cell reached rawComposite 1.00 because class severities are already 0.7–1.0 and the bonuses are added before the cap.",
    rawComposite: "min(1, weightedMean + layerBonus + thickBonus)",
    underlying: "Same weights. BOD term is bod/10 + cod/30 with no dataset-max division and no cap.",
    rank: "underlying descending, then thickness, then max BOD, then max COD",
    calibratedComposite: "0.15 + 0.85 * (underlying - min) / (max - min) across the 12 published hotspots",
    highColour: "#FBC02D",
  },
  generated: new Date().toISOString(),
  studyBounds: STUDY,
  pixelCount: bodPts.length,
  candidateCount: hotspots.length,
  weights: WEIGHTS,
  redShades: RED_SHADES,
  availability: {
    bodCod: bodPts.length ? "OBSERVED" : "UNAVAILABLE",
    eutrophication: "CLASSIFIED",
    nitrogen: "CLASSIFIED",
    coliform: "CLASSIFIED",
    observationDate: null,
    sourceUpdated: "2026-11-11",
  },
  kmlSummaries: kmlResults.map((r) => ({
    id: r.id, label: r.label, highPixels: r.highPixels, sampled: r.sampled, classCounts: r.classCounts, bounds: r.bounds,
  })),
  hotspots: top,
};

const outDir = path.join(root, "public/data/mula_mutha");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "pollution_hotspots.json"), JSON.stringify(payload, null, 2));
console.log("wrote", top.length, "hotspots from", hotspots.length, "candidates");
for (const h of top) {
  console.log(`#${h.rank} ${h.severity} cal=${h.calibratedComposite} raw=${h.rawComposite} under=${h.underlying} BOD=${h.maxBod ?? "null"} COD=${h.maxCod ?? "null"}`);
}
