import fs from "fs";
import path from "path";

const dir = new URL("../public/data/osm_ways/", import.meta.url);
const dirPath = dir.pathname.replace(/^\/([A-Z]:)/, "$1");
const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".xml"));
const features = [];

for (const f of files) {
  const xml = fs.readFileSync(path.join(dirPath, f), "utf8");
  const nodes = new Map();
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*lat="([^"]+)" lon="([^"]+)"/g)) {
    nodes.set(m[1], { lat: +m[2], lon: +m[3] });
  }
  const nds = [...xml.matchAll(/<nd ref="(\d+)"/g)].map((m) => m[1]);
  const name = (xml.match(/<tag k="name" v="([^"]+)"/) || [])[1] || "Bridge";
  const highway = (xml.match(/<tag k="highway" v="([^"]+)"/) || [])[1] || "";
  const lanes = Number((xml.match(/<tag k="lanes" v="([^"]+)"/) || [])[1] || 2);
  const coords = nds.map((id) => nodes.get(id)).filter(Boolean);
  if (coords.length < 2) continue;
  features.push({
    type: "Feature",
    properties: {
      osmId: path.basename(f, ".xml"),
      name,
      highway,
      lanes,
      widthM: Math.max(9, lanes * 3.6),
      source: "OpenStreetMap",
    },
    geometry: {
      type: "LineString",
      coordinates: coords.map((c) => [c.lon, c.lat]),
    },
  });
}

const out = path.join(dirPath, "..", "bridges.geojson");
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      type: "FeatureCollection",
      name: "mula_mutha_osm_bridges",
      attribution: "© OpenStreetMap contributors",
      features,
    },
    null,
    2,
  ),
);
console.log("wrote", features.length, "bridges to", out);
for (const f of features) {
  const a = f.geometry.coordinates[0];
  const b = f.geometry.coordinates.at(-1);
  console.log(f.properties.name, a, "→", b);
}
