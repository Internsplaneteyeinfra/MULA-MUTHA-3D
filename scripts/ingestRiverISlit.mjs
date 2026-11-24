/**
 * Ingest River-I-slit Classification + Volume KMLs (base64 GroundOverlays)
 * into public/data/hydrology/silt/{classification,volume}/{YYYY-MM}/
 * and generate src/data/siltPeriods.generated.js
 *
 * Usage:
 *   node scripts/ingestRiverISlit.mjs [sourceDir]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSrc =
  "C:/Users/Sahil.Rajankar/Downloads/8baca5089bc646a1af9ae4b144b216d4/River-I-slit";
const srcRoot = path.resolve(process.argv[2] || defaultSrc);
const outRoot = path.join(root, "public/data/hydrology/silt");
const genPath = path.join(root, "src/data/siltPeriods.generated.js");

const MONTH_ALIASES = [
  ["january", 1],
  ["jan", 1],
  ["february", 2],
  ["feb", 2],
  ["march", 3],
  ["mar", 3],
  ["april", 4],
  ["apr", 4],
  ["may", 5],
  ["june", 6],
  ["jun", 6],
  ["jully", 7],
  ["july", 7],
  ["jul", 7],
  ["august", 8],
  ["aug", 8],
  ["september", 9],
  ["sept", 9],
  ["sep", 9],
  ["october", 10],
  ["oct", 10],
  ["november", 11],
  ["nov", 11],
  ["december", 12],
  ["dec", 12],
];

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DEFAULT_BOUNDS = {
  north: 18.5473360082,
  south: 18.5207458757,
  east: 73.9935113007,
  west: 73.8549012524,
};

function monthFromFilename(name) {
  const stem = String(name || "")
    .toLowerCase()
    .replace(/\.kml$/i, "");
  for (const [alias, num] of MONTH_ALIASES) {
    if (stem.includes(alias)) return num;
  }
  return null;
}

function parseKml(text) {
  const name =
    text.match(/<(?:\w+:)?name>\s*([^<]+)\s*<\/(?:\w+:)?name>/i)?.[1]?.trim() || "Silt";
  const descRaw =
    text.match(/<(?:\w+:)?description><!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] ||
    text.match(/<(?:\w+:)?description>\s*([\s\S]*?)\s*<\/(?:\w+:)?description>/i)?.[1] ||
    "";
  const desc = descRaw.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
  const north = Number(text.match(/<(?:\w+:)?north>\s*([^<\s]+)/i)?.[1]);
  const south = Number(text.match(/<(?:\w+:)?south>\s*([^<\s]+)/i)?.[1]);
  const east = Number(text.match(/<(?:\w+:)?east>\s*([^<\s]+)/i)?.[1]);
  const west = Number(text.match(/<(?:\w+:)?west>\s*([^<\s]+)/i)?.[1]);
  const bounds =
    [north, south, east, west].every((n) => Number.isFinite(n))
      ? { north, south, east, west }
      : { ...DEFAULT_BOUNDS };

  const hrefMatch = text.match(
    /<(?:\w+:)?GroundOverlay[\s\S]*?<(?:\w+:)?href>\s*([^<]+?)\s*<\/(?:\w+:)?href>/i,
  );
  const href = hrefMatch?.[1]?.trim() || null;
  let overlayB64 = null;
  if (href && /^data:image\/png;base64,/i.test(href)) {
    overlayB64 = href.replace(/^data:image\/png;base64,/i, "").replace(/\s+/g, "");
  } else {
    const m = text.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/i);
    if (m) overlayB64 = m[1].replace(/\s+/g, "");
  }

  let legendB64 = null;
  const screenHref = text.match(
    /<(?:\w+:)?ScreenOverlay[\s\S]*?<(?:\w+:)?href>\s*([^<]+?)\s*<\/(?:\w+:)?href>/i,
  )?.[1]?.trim();
  if (screenHref && /^data:image\/png;base64,/i.test(screenHref)) {
    legendB64 = screenHref.replace(/^data:image\/png;base64,/i, "").replace(/\s+/g, "");
  }

  return { name, desc: desc.slice(0, 500), bounds, overlayB64, legendB64 };
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFallbackLegend(kind, destFile) {
  const candidates = [
    path.join(outRoot, kind, "2026-01", "legend.png"),
    path.join(outRoot, kind, "2026-07", "legend.png"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      fs.copyFileSync(c, destFile);
      return true;
    }
  }
  return false;
}

function ingestKind(kind, folderName) {
  const periods = [];
  if (!fs.existsSync(srcRoot)) {
    throw new Error(`Source not found: ${srcRoot}`);
  }

  for (const yearName of fs.readdirSync(srcRoot).sort()) {
    const year = Number(yearName);
    if (!Number.isFinite(year) || year < 2000 || year > 2100) continue;
    const folder = path.join(srcRoot, yearName, folderName);
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) continue;

    for (const file of fs.readdirSync(folder)) {
      if (!/\.kml$/i.test(file)) continue;
      const month = monthFromFilename(file);
      if (!month) {
        console.warn(`skip (no month): ${yearName}/${folderName}/${file}`);
        continue;
      }
      const id = `${year}-${String(month).padStart(2, "0")}`;
      const kmlPath = path.join(folder, file);
      const text = fs.readFileSync(kmlPath, "utf8");
      const meta = parseKml(text);
      if (!meta.overlayB64) {
        console.warn(`skip (no overlay): ${yearName}/${folderName}/${file}`);
        continue;
      }

      const dest = path.join(outRoot, kind, id);
      ensureDir(dest);
      const overlayPath = path.join(dest, "overlay.png");
      fs.writeFileSync(overlayPath, Buffer.from(meta.overlayB64, "base64"));

      const legendPath = path.join(dest, "legend.png");
      if (meta.legendB64) {
        fs.writeFileSync(legendPath, Buffer.from(meta.legendB64, "base64"));
      } else {
        copyFallbackLegend(kind, legendPath);
      }

      fs.writeFileSync(path.join(dest, "doc.kml"), text);
      fs.writeFileSync(
        path.join(dest, "meta.json"),
        JSON.stringify(
          {
            id,
            year,
            month,
            name: meta.name,
            bounds: meta.bounds,
            source: file,
            kind,
          },
          null,
          2,
        ),
      );

      const entry = {
        id,
        label: MONTH_LABELS[month - 1],
        year,
        month,
        name: meta.name,
        bounds: meta.bounds,
        source: file,
        overlay: `/data/hydrology/silt/${kind}/${id}/overlay.png`,
        legend: `/data/hydrology/silt/${kind}/${id}/legend.png`,
      };
      const existing = periods.findIndex((p) => p.id === id);
      if (existing >= 0) {
        console.warn(`overwrite ${kind} ${id} with ${file}`);
        periods[existing] = entry;
      } else {
        periods.push(entry);
      }
      console.log(`ok ${kind} ${id} ← ${file} (${Math.round(meta.overlayB64.length / 1024)} KB b64)`);
    }
  }

  periods.sort((a, b) => a.year - b.year || a.month - b.month);
  return periods;
}

function writeIndex(kind, periods, extra = {}) {
  const dir = path.join(outRoot, kind);
  ensureDir(dir);
  fs.writeFileSync(
    path.join(dir, "index.json"),
    JSON.stringify({ periods, ...extra }, null, 2),
  );
}

function periodConst(p) {
  return `  { id: "${p.id}", label: "${p.label}", year: ${p.year}, month: ${p.month}, overlay: "${p.overlay}", legend: "${p.legend}" }`;
}

console.log("Source:", srcRoot);
ensureDir(outRoot);

const classPeriods = ingestKind("classification", "Classification");
const volPeriods = ingestKind("volume", "Volume");

writeIndex("classification", classPeriods);
writeIndex("volume", volPeriods, { scale: { min: 0, max: 94.31, units: "relative" } });

const latestClass = classPeriods[classPeriods.length - 1]?.id || "2026-01";
const latestVol = volPeriods[volPeriods.length - 1]?.id || "2026-01";

const gen = `/** AUTO-GENERATED by scripts/ingestRiverISlit.mjs — do not edit by hand */
export const SILT_CLASS_PERIODS = [
${classPeriods.map(periodConst).join(",\n")}
];

export const SILT_VOLUME_PERIODS = [
${volPeriods.map(periodConst).join(",\n")}
];

export const SILT_CLASS_DEFAULT_PERIOD = "${latestClass}";
export const SILT_VOLUME_DEFAULT_PERIOD = "${latestVol}";
`;

ensureDir(path.dirname(genPath));
fs.writeFileSync(genPath, gen);

console.log(`\nclassification: ${classPeriods.length} periods, default ${latestClass}`);
console.log(`volume: ${volPeriods.length} periods, default ${latestVol}`);
console.log(`wrote ${genPath}`);
