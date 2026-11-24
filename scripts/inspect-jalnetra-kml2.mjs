import fs from "node:fs";
import path from "node:path";

const file = process.argv[2] || "src/jalnetra kml/coliform_ecoli_class.kml";
const text = fs.readFileSync(file, "utf8");
console.log("has ns0:", /ns0:/.test(text));
console.log("Placemark count", (text.match(/<(?:ns0:)?Placemark\b/gi) || []).length);
console.log("Style count", (text.match(/<(?:ns0:)?Style\b/gi) || []).length);
console.log("Polygon count", (text.match(/<(?:ns0:)?Polygon\b/gi) || []).length);
console.log("GroundOverlay", (text.match(/<(?:ns0:)?GroundOverlay\b/gi) || []).length);
console.log("styleUrl samples", [...text.matchAll(/<(?:ns0:)?styleUrl>\s*([^<]+)\s*<\/(?:ns0:)?styleUrl>/gi)].slice(0, 5).map((m) => m[1].trim()));
console.log("name samples near placemark:");
const pm = [...text.matchAll(/<(?:ns0:)?Placemark\b[\s\S]{0,400}/gi)].slice(0, 3);
for (const m of pm) console.log("---\n", m[0].slice(0, 350).replace(/\s+/g, " "));
// Class legend colors from description
const desc = (text.match(/<(?:ns0:)?description>([\s\S]*?)<\/(?:ns0:)?description>/i) || [])[1] || "";
const colorLines = [...desc.matchAll(/#([0-9A-Fa-f]{6})\s+([^\n<#]+)/g)].map((m) => `#${m[1]} ${m[2].trim()}`);
console.log("legend colors:", colorLines);
