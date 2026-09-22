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
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`,
    { stdio: "inherit" },
  );
  fs.unlinkSync(zipPath);
}

function findFile(dir, re) {
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        const hit = walk(p);
        if (hit) return hit;
      } else if (re.test(name)) return p;
    }
    return null;
  };
  return walk(dir);
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
  const href = kmlText
    .match(/<GroundOverlay[\s\S]*?<Icon>[\s\S]*?<href>\s*([^<]+)\s*<\/href>/i)?.[1]
    ?.trim();
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

function extractYearKmz(year, kmzName) {
  const kmz = path.join(srcDir, kmzName);
  if (!fs.existsSync(kmz)) return null;
  const dest = path.join(outRoot, String(year));
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  unzipKmz(kmz, dest);
  const kmlPath = findFile(dest, /\.kml$/i);
  if (!kmlPath) {
    console.warn("no kml in", kmzName);
    return null;
  }
  const meta = parseDocKml(fs.readFileSync(kmlPath, "utf8"));
  const overlaySrc =
    findFile(dest, /(?:^|[\\/])overlay\.(png|jpg|jpeg)$/i) ||
    (meta.href && !/^data:/i.test(meta.href)
      ? findFile(dest, new RegExp(path.basename(meta.href).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
      : null) ||
    findFile(dest, /\.png$/i);
  const pngOut = path.join(dest, "overlay.png");
  if (overlaySrc) fs.copyFileSync(overlaySrc, pngOut);
  else console.warn("NO OVERLAY for", year);

  // Keep a stable doc.kml at dest root
  fs.copyFileSync(kmlPath, path.join(dest, "doc.kml"));

  const metaOut = {
    year,
    name: meta.name,
    type: "groundOverlay",
    bounds: meta.bounds,
    classes: meta.classes,
    overlay: `/data/hydrology/lulc/${year}/overlay.png`,
    source: `src/data/LULC UPTO2025/${kmzName}`,
  };
  fs.writeFileSync(path.join(dest, "meta.json"), JSON.stringify(metaOut, null, 2));
  console.log(
    "extracted",
    year,
    meta.classes.length ? meta.classes.map((c) => c.label).join(", ") : "(smoothed raster)",
    "bounds",
    meta.bounds,
  );
  return metaOut;
}

const years = [];
for (const year of [2021, 2022, 2023, 2024, 2025]) {
  const hit = extractYearKmz(year, `MulaMutha_LULC_${year}.kmz`);
  if (hit) years.push(hit);
}

// 2026 is now a GroundOverlay KMZ (same pattern as 2021–2025), not vector polygons.
const y2026 =
  extractYearKmz(2026, "lulc_2026.kmz") ||
  (() => {
    const kml2026 = path.join(srcDir, "lulc_2026.kml");
    if (!fs.existsSync(kml2026)) return null;
    const dest = path.join(outRoot, "2026");
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(kml2026, path.join(dest, "lulc_2026.kml"));
    return {
      year: 2026,
      name: "Mula-Mutha LULC 2026",
      type: "kmlPolygons",
      data: "/data/hydrology/lulc/2026/lulc_2026.kml",
      source: "lulc_2026.kml",
    };
  })();
if (y2026) years.push(y2026);

fs.writeFileSync(path.join(outRoot, "index.json"), JSON.stringify({ years }, null, 2));
console.log("done", years.map((y) => y.year).join(", "));
