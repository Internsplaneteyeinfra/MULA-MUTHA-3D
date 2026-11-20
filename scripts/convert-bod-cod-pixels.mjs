import fs from "node:fs";
import path from "node:path";

const src = process.argv[2];
const dest = process.argv[3];
if (!src || !dest) {
  console.error("Usage: node convert-bod-cod-pixels.mjs <input.kml> <output.json>");
  process.exit(1);
}

const text = fs.readFileSync(src, "utf8");
const placemarks = [...text.matchAll(/<(?:ns0:)?Placemark[\s\S]*?<\/(?:ns0:)?Placemark>/gi)];
const points = [];

for (const block of placemarks) {
  const content = block[0];
  const desc =
    content.match(/<(?:ns0:)?description>([\s\S]*?)<\/(?:ns0:)?description>/i)?.[1] || "";
  const bodM = desc.match(/BOD:\s*([\d.]+)/i);
  const codM = desc.match(/COD:\s*([\d.]+)/i);
  const latM = desc.match(/Latitude:\s*([\d.-]+)/i);
  const lonM = desc.match(/Longitude:\s*([\d.-]+)/i);
  let lat = latM ? Number(latM[1]) : NaN;
  let lon = lonM ? Number(lonM[1]) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const coords =
      content.match(/<(?:ns0:)?coordinates>([\s\S]*?)<\/(?:ns0:)?coordinates>/i)?.[1] || "";
    const pairs = coords
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => {
        const [lo, la] = s.split(",").map(Number);
        return { lon: lo, lat: la };
      })
      .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));
    if (pairs.length) {
      lon = pairs.reduce((a, p) => a + p.lon, 0) / pairs.length;
      lat = pairs.reduce((a, p) => a + p.lat, 0) / pairs.length;
    }
  }

  const bod = bodM ? Number(bodM[1]) : NaN;
  const cod = codM ? Number(codM[1]) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(bod) || !Number.isFinite(cod)) {
    continue;
  }
  points.push([+lon.toFixed(6), +lat.toFixed(6), +bod.toFixed(2), +cod.toFixed(2)]);
}

const out = {
  version: 1,
  source: path.basename(src),
  count: points.length,
  /** Compact [lon, lat, bod, cod] tuples */
  points,
};

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`placemarks=${placemarks.length} points=${points.length}`);
console.log(`wrote ${dest} (${fs.statSync(dest).size} bytes)`);
console.log("sample", JSON.stringify(points.slice(0, 3)));
