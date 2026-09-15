import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src/data/Jan_2026_to_Jun_2026_Silt_Classification");
const outRoot = path.join(root, "public/data/hydrology/silt");

fs.mkdirSync(outRoot, { recursive: true });

function unzipKmz(kmzPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const zipPath = path.join(destDir, "_tmp.zip");
  fs.copyFileSync(kmzPath, zipPath);
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`,
    { stdio: "pipe" },
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
  const name = kmlText.match(/<name>\s*([^<]+)\s*<\/name>/i)?.[1]?.trim() || "Silt";
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
  const hasGround = /<GroundOverlay/i.test(kmlText);
  const placemarks = (kmlText.match(/<Placemark/gi) || []).length;
  const folders = [...kmlText.matchAll(/<Folder[\s\S]*?<name>\s*([^<]+)\s*<\/name>/gi)].map((m) =>
    m[1].trim(),
  );
  return {
    name,
    desc: desc.slice(0, 500),
    bounds: { north, south, east, west },
    href,
    hasGround,
    placemarks,
    folders: [...new Set(folders)].slice(0, 20),
  };
}

const MONTHS = [
  ["Jan", 1],
  ["Feb", 2],
  ["Mar", 3],
  ["Apr", 4],
  ["May", 5],
  ["Jun", 6],
  ["Jul", 7],
];

const classYears = [];
for (const [mon, monthNum] of MONTHS) {
  const files = fs
    .readdirSync(srcDir)
    .filter((n) => new RegExp(`^${mon}_2026_Silt_Classification`, "i").test(n) && n.endsWith(".kmz"));
  if (!files.length) continue;
  const kmz = path.join(srcDir, files[0]);
  const key = `2026-${String(monthNum).padStart(2, "0")}`;
  const dest = path.join(outRoot, "classification", key);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  unzipKmz(kmz, dest);
  const kmlPath = findFile(dest, /\.kml$/i);
  if (!kmlPath) {
    console.warn("no kml", key);
    continue;
  }
  const meta = parseDocKml(fs.readFileSync(kmlPath, "utf8"));
  console.log(key, "ground", meta.hasGround, "placemarks", meta.placemarks, "href", meta.href, "folders", meta.folders);
  console.log("  desc:", meta.desc.slice(0, 200));
  console.log("  bounds", meta.bounds);

  if (meta.hasGround && meta.href) {
    const pngSrc = findFile(dest, new RegExp(path.basename(meta.href).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
      || findFile(dest, /\.(png|jpg|jpeg)$/i);
    if (pngSrc) {
      fs.copyFileSync(pngSrc, path.join(dest, "overlay.png"));
    }
  }

  // Also keep a flat doc.kml copy for polygon parse fallback
  fs.copyFileSync(kmlPath, path.join(dest, "doc.kml"));

  classYears.push({
    id: key,
    label: `${mon} 2026`,
    year: 2026,
    month: monthNum,
    name: meta.name,
    bounds: meta.bounds,
    hasGround: meta.hasGround,
    placemarks: meta.placemarks,
    source: files[0],
  });
}

// River_Silt_Classification overall?
const riverClass = path.join(srcDir, "River_Silt_Classification.kmz");
if (fs.existsSync(riverClass)) {
  const dest = path.join(outRoot, "classification", "river");
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  unzipKmz(riverClass, dest);
  const kmlPath = findFile(dest, /\.kml$/i);
  if (kmlPath) {
    const meta = parseDocKml(fs.readFileSync(kmlPath, "utf8"));
    console.log("river", "ground", meta.hasGround, "placemarks", meta.placemarks, meta.folders);
    fs.copyFileSync(kmlPath, path.join(dest, "doc.kml"));
    if (meta.hasGround && meta.href) {
      const pngSrc = findFile(dest, /\.(png|jpg|jpeg)$/i);
      if (pngSrc) fs.copyFileSync(pngSrc, path.join(dest, "overlay.png"));
    }
  }
}

fs.writeFileSync(
  path.join(outRoot, "classification", "index.json"),
  JSON.stringify({ periods: classYears }, null, 2),
);
console.log("done", classYears.map((p) => p.id).join(", "));
