#!/usr/bin/env node
/**
 * CI smoke checks after `vite build`.
 * Fails the pipeline if critical runtime assets are missing from dist/.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");

const REQUIRED = [
  "index.html",
  "data/mula_mutha_water_depth.csv",
  "data/Mula_MuthaAOI_2.kml",
  "data/Mula_Mutha_Chainage_Analysis.kml",
  "data/buildings.geojson",
  "data/roads.geojson",
  "data/bridges.geojson",
  "data/trees.geojson",
  "data/FABDEM_DTM_FINAL.tif",
  "assets/trees/palm.glb",
  "assets/buildings/residential/house_01.glb",
];

function fail(msg) {
  console.error(`CI SMOKE FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

if (!existsSync(DIST)) fail("dist/ missing — run npm run build first");

const issues = [];
for (const rel of REQUIRED) {
  const p = join(DIST, rel);
  if (!existsSync(p)) issues.push(`missing dist/${rel}`);
  else {
    const n = statSync(p).size;
    if (n < 16) issues.push(`too small dist/${rel} (${n} bytes)`);
    else ok(rel);
  }
}

// At least one hashed JS/CSS bundle
const assetsDir = join(DIST, "assets");
if (!existsSync(assetsDir)) fail("dist/assets/ missing");
const bundles = readdirSync(assetsDir).filter((f) => /\.(js|css)$/.test(f));
if (!bundles.length) fail("no JS/CSS bundles in dist/assets/");
ok(`bundles: ${bundles.length} (${bundles.slice(0, 3).join(", ")}${bundles.length > 3 ? "…" : ""})`);

if (issues.length) {
  for (const i of issues) console.error(`  ✗ ${i}`);
  process.exit(1);
}

console.log("CI smoke passed.");
