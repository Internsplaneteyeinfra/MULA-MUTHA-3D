import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src/data/LULC UPTO2025");
const outRoot = path.join(root, "public/data/hydrology/lulc");

fs.mkdirSync(outRoot, { recursive: true });

function unzipKmz(kmzPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const zipPath = path.join(destDir, "_tmp.zip");
  fs.copyFileSync(kmzPath, zipPath);
  // PowerShell Expand-Archive
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`,
    { stdio: "inherit" },
  );
  fs.unlinkSync(zipPath);
}

function parseDocKml(kmlText) {
  const name = kmlText.match(/<name>\s*([^<]+)\s*<\/name>/i)?.[1]?.trim() || "LULC";
  const descRaw =
    kmlText.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] ||
    kmlText.match(/<description>\s*([\s\S]*?)\s*<\/description>/i)?.[1] ||
    "";
  const desc = descRaw.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
  const north = Number(kmlText.match(/<north>\s*([^<]+)\s*<\/north>/i)?.[1]);
  const south = Number(kmlText.match(/<south>\s*([^<]+)\s*<\/south>/i)?.[1]);
  const east = Number(kmlText.match(/<east>\s*([^<]+)\s*<\/east>/i)?.[1]);
  const west = Number(kmlText.match(/<west>\s*([^<]+)\s*<\/west>/i)?.[1]);
  const href = kmlText.match(/<Icon>[\s\S]*?<href>\s*([^<]+)\s*<\/href>/i)?.[1]?.trim();
  const classes = [];
  for (const line of desc.split(/\n+/)) {
    const m = line.match(/^\s*(\d+)\s*-\s*([^:]+):\s*(#[0-9A-Fa-f]{6})/);
    if (m) {
      classes.push({
        id: `class_${m[1]}`,
        label: m[2].trim(),
        color: m[3].toUpperCase(),
        code: Number(m[1]),
      });
    }
  }
  return { name, desc, bounds: { north, south, east, west }, href, classes };
}

const years = [];
for (const year of [2021, 2022, 2023, 2024, 2025]) {
  const kmz = path.join(srcDir, `MulaMutha_LULC_${year}.kmz`);
  if (!fs.existsSync(kmz)) continue;
  const dest = path.join(outRoot, String(year));
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  unzipKmz(kmz, dest);
  const kmlPath = path.join(dest, "doc.kml");
  const meta = parseDocKml(fs.readFileSync(kmlPath, "utf8"));
  const pngName = meta.href || `MulaMutha_LULC_${year}.png`;
  const pngSrc = path.join(dest, pngName);
  const pngOut = path.join(dest, "overlay.png");
  if (fs.existsSync(pngSrc)) fs.copyFileSync(pngSrc, pngOut);
  const metaOut = {
    year,
    name: meta.name,
    bounds: meta.bounds,
    classes: meta.classes,
    overlay: `/data/hydrology/lulc/${year}/overlay.png`,
    source: `MulaMutha_LULC_${year}.kmz`,
  };
  fs.writeFileSync(path.join(dest, "meta.json"), JSON.stringify(metaOut, null, 2));
  years.push(metaOut);
  console.log("extracted", year, meta.classes.map((c) => c.label).join(", "));
}

// 2026 polygon KML
const kml2026 = path.join(srcDir, "lulc_2026.kml");
if (fs.existsSync(kml2026)) {
  const dest = path.join(outRoot, "2026");
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(kml2026, path.join(dest, "lulc_2026.kml"));
  // Peek classes from folder names / placemark names via simple scan
  const t = fs.readFileSync(kml2026, "utf8");
  const folders = [...t.matchAll(/<Folder[\s\S]*?<name>\s*([^<]+)\s*<\/name>/gi)].map((m) =>
    m[1].trim(),
  );
  console.log("2026 folders sample", [...new Set(folders)].slice(0, 15));
  years.push({
    year: 2026,
    name: "Mula-Mutha LULC 2026",
    type: "kmlPolygons",
    data: "/data/hydrology/lulc/2026/lulc_2026.kml",
    source: "lulc_2026.kml",
  });
}

fs.writeFileSync(path.join(outRoot, "index.json"), JSON.stringify({ years }, null, 2));
console.log("done", years.map((y) => y.year).join(", "));
