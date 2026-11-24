import fs from "node:fs";
import path from "node:path";

const src = path.resolve("src/jalnetra kml/Nitrogen mulamutha.kml");
const outDir = path.resolve("public/data/hydrology/pollution/nitrogen");
const text = fs.readFileSync(src, "utf8");
const block = text.match(/<(?:ns0:)?GroundOverlay\b[\s\S]*?<\/(?:ns0:)?GroundOverlay>/i)?.[0];
if (!block) throw new Error("No GroundOverlay in nitrogen KML");

const href = (block.match(/<(?:ns0:)?href>([\s\S]*?)<\/(?:ns0:)?href>/i) || [])[1]?.trim() || "";
const north = Number((block.match(/<(?:ns0:)?north>\s*([^<]+)/i) || [])[1]);
const south = Number((block.match(/<(?:ns0:)?south>\s*([^<]+)/i) || [])[1]);
const east = Number((block.match(/<(?:ns0:)?east>\s*([^<]+)/i) || [])[1]);
const west = Number((block.match(/<(?:ns0:)?west>\s*([^<]+)/i) || [])[1]);
const desc = (text.match(/<(?:ns0:)?description>([\s\S]*?)<\/(?:ns0:)?description>/i) || [])[1] || "";
const legend = [...desc.matchAll(/#([0-9A-Fa-f]{6})\s+([^\n<#]+)/g)].map((m) => ({
  color: `#${m[1]}`,
  label: m[2].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim(),
}));

if (!(north > 18.4 && south > 18.4)) {
  throw new Error(`Bounds are not Mula–Mutha: N=${north} S=${south}`);
}

const m = href.match(/^data:image\/png;base64,(.+)$/i);
if (!m) throw new Error("Expected data:image/png;base64 href");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "overlay.png"), Buffer.from(m[1], "base64"));

const meta = {
  id: "pollution_nitrogen",
  name: "Nitrogen",
  type: "groundOverlay",
  source: "src/jalnetra kml/Nitrogen mulamutha.kml",
  bounds: { north, south, east, west },
  overlay: "/data/hydrology/pollution/nitrogen/overlay.png",
  legendClasses: legend,
  updated: "2026-11-11",
};
fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2));

// Also copy to a stable filename without spaces for tooling
const stable = path.resolve("src/jalnetra kml/nitrogen_risk_class.kml");
if (!fs.existsSync(stable)) {
  fs.copyFileSync(src, stable);
}

console.log("OK nitrogen", meta.bounds, `legend=${legend.length}`, `png=${fs.statSync(path.join(outDir, "overlay.png")).size}`);
console.log("legend", legend);
