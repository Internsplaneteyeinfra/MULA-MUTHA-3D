/**
 * Extract GroundOverlay PNG + LatLonBox from JalNetra KMLs into public/data/hydrology.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".");
const SRC_DIR = path.join(ROOT, "src", "jalnetra kml");
const EXTRA = [
  {
    src: path.join("c:/Users/Sahil.Rajankar/Downloads", "nitrogen_risk_class (1).kml"),
    destName: "nitrogen_risk_class.kml",
  },
];

const JOBS = [
  {
    file: "tss.kml",
    outDir: "public/data/hydrology/water_quality/tss",
    id: "water_quality_tss",
    name: "TSS",
  },
  {
    file: "relative_salinity.kml",
    outDir: "public/data/hydrology/water_quality/salinity",
    id: "salinity",
    name: "Salinity",
  },
  {
    file: "chlorophyl.kml",
    outDir: "public/data/hydrology/water_quality/ndci",
    id: "water_quality_ndci",
    name: "Chlorophyll-a",
  },
  {
    file: "coliform_ecoli_class.kml",
    outDir: "public/data/hydrology/water_quality/coliform",
    id: "water_quality_coliform",
    name: "Coliform",
  },
  {
    file: "eutrophication_trophic_class.kml",
    outDir: "public/data/hydrology/pollution/eutrophication",
    id: "pollution_eutrophication",
    name: "Eutrophication",
  },
  {
    file: "nitrogen_risk_class.kml",
    outDir: "public/data/hydrology/pollution/nitrogen",
    id: "pollution_nitrogen",
    name: "Nitrogen",
    requireMulaBounds: true,
  },
  {
    file: "bank_erosion_hotspots_2016_2026.kml",
    outDir: "public/data/hydrology/bank_erosion",
    id: "bank_erosion",
    name: "Bank erosion",
  },
  {
    file: "lithology.kml",
    outDir: "public/data/hydrology/geology",
    id: "geology",
    name: "Lithology",
  },
  {
    file: "river_foam.kml",
    outDir: "public/data/hydrology/pollution/foam",
    id: "pollution_foam",
    name: "River foam",
  },
];

function ensureExtraCopies() {
  for (const extra of EXTRA) {
    const dest = path.join(SRC_DIR, extra.destName);
    if (fs.existsSync(dest)) continue;
    if (!fs.existsSync(extra.src)) {
      console.warn("missing extra", extra.src);
      continue;
    }
    fs.copyFileSync(extra.src, dest);
    console.log("copied", extra.destName);
  }
}

function parseOverlay(text) {
  const block = text.match(/<(?:ns0:)?GroundOverlay\b[\s\S]*?<\/(?:ns0:)?GroundOverlay>/i)?.[0];
  if (!block) return null;
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
  return { href, bounds: { north, south, east, west }, legend };
}

function writePng(href, outPng) {
  const m = href.match(/^data:image\/png;base64,(.+)$/i);
  if (!m) throw new Error("Expected data:image/png;base64 href");
  fs.writeFileSync(outPng, Buffer.from(m[1], "base64"));
}

ensureExtraCopies();

for (const job of JOBS) {
  const src = path.join(SRC_DIR, job.file);
  if (!fs.existsSync(src)) {
    console.warn("SKIP missing", job.file);
    continue;
  }
  const text = fs.readFileSync(src, "utf8");
  const parsed = parseOverlay(text);
  if (!parsed?.href) {
    console.warn("SKIP no overlay", job.file);
    continue;
  }
  const { bounds } = parsed;
  if (job.requireMulaBounds && !(bounds.north > 18.4 && bounds.south > 18.4)) {
    console.warn(
      "SKIP nitrogen — overlay bounds are not Mula–Mutha:",
      bounds,
      "(add a Mula–Mutha nitrogen_risk_class.kml to src/jalnetra kml)",
    );
    // Remove wrong-AOI copy so we don't ship Mandovi data as Mula nitrogen
    try {
      fs.unlinkSync(src);
    } catch {
      /* ignore */
    }
    continue;
  }

  const outAbs = path.join(ROOT, job.outDir);
  fs.mkdirSync(outAbs, { recursive: true });
  const overlayRel = `/${job.outDir.replace(/\\/g, "/").replace(/^public/, "").replace(/^\//, "")}/overlay.png`.replace(
    "//",
    "/",
  );
  // Normalize: public/data/... → /data/...
  const publicUrl = `/${job.outDir.replace(/^public[\\/]/, "").replace(/\\/g, "/")}/overlay.png`;
  writePng(parsed.href, path.join(outAbs, "overlay.png"));
  const meta = {
    id: job.id,
    name: job.name,
    type: "groundOverlay",
    source: `src/jalnetra kml/${job.file}`,
    bounds,
    overlay: publicUrl,
    legendClasses: parsed.legend,
    updated: "2026-11-11",
  };
  fs.writeFileSync(path.join(outAbs, "meta.json"), JSON.stringify(meta, null, 2));
  console.log("OK", job.id, publicUrl, bounds, `legend=${parsed.legend.length}`);
}
