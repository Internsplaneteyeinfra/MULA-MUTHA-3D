import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
const text = fs.readFileSync(file, "utf8");
const blocks = [...text.matchAll(/<(?:ns0:)?GroundOverlay\b[\s\S]*?<\/(?:ns0:)?GroundOverlay>/gi)];
console.log("GroundOverlay count", blocks.length);
for (const [i, block] of blocks.entries()) {
  const b = block[0];
  const name = (b.match(/<(?:ns0:)?name>([^<]*)<\/(?:ns0:)?name>/i) || [])[1];
  const href = (b.match(/<(?:ns0:)?href>([\s\S]*?)<\/(?:ns0:)?href>/i) || [])[1]?.trim() || "";
  const north = Number((b.match(/<(?:ns0:)?north>\s*([^<]+)/i) || [])[1]);
  const south = Number((b.match(/<(?:ns0:)?south>\s*([^<]+)/i) || [])[1]);
  const east = Number((b.match(/<(?:ns0:)?east>\s*([^<]+)/i) || [])[1]);
  const west = Number((b.match(/<(?:ns0:)?west>\s*([^<]+)/i) || [])[1]);
  const isData = href.startsWith("data:");
  const isHttp = /^https?:/i.test(href);
  console.log({
    i,
    name,
    north,
    south,
    east,
    west,
    hrefKind: isData ? "data-uri" : isHttp ? "http" : "path",
    hrefPreview: href.slice(0, 80),
    hrefLen: href.length,
  });
}
