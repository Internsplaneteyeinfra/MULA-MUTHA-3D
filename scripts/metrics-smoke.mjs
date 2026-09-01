/** Quick metrics test without browser — validates projection pipeline numbers. */
import { readFileSync } from "fs";
import { parseChainageAnalysisKml } from "../src/geo/kml.js";
import { loadDepthCsv } from "../src/geo/csv.js";
import { initGeoReference, lonLatToLocal } from "../src/geo/geoReference.js";
import { computeProjectionMetrics } from "../src/geo/projectionMetrics.js";
import { kmlBoundsCenter } from "../src/geo/load.js";
import { validateLonLatPoints } from "../src/geo/kmlValidate.js";
import { createLocalFrame, projectLonLat } from "../src/geo/projection.js";

const kmlText = readFileSync("public/data/Mula_Mutha_Chainage_Analysis.kml", "utf8");
const parsed = parseChainageAnalysisKml(kmlText);
const ringGeo = parsed.polygon;
const kmlVal = validateLonLatPoints(ringGeo, { label: "KML" });
const origin = kmlBoundsCenter(kmlVal.bbox);
initGeoReference(origin, ringGeo.map((c) => {
  const u = projectLonLat(c.lon, c.lat);
  return { easting: u.easting, northing: u.northing };
}));

const ringLocal = ringGeo.map((c) => {
  const p = lonLatToLocal(c.lon, c.lat);
  return { ...c, x: p.x, z: p.z };
});
const centerlineLocal = parsed.centerline.map((c) => {
  const p = lonLatToLocal(c.lon, c.lat);
  return { lon: c.lon, lat: c.lat, x: p.x, z: p.z };
});

// Minimal corridor stub from centerline
const stations = centerlineLocal.map((c, i) => ({
  x: c.x,
  z: c.z,
  flowX: i < centerlineLocal.length - 1 ? centerlineLocal[i + 1].x - c.x : 1,
  flowZ: i < centerlineLocal.length - 1 ? centerlineLocal[i + 1].z - c.z : 0,
  halfWidth: 45,
  half: 45,
}));
for (const s of stations) {
  const len = Math.hypot(s.flowX, s.flowZ) || 1;
  s.flowX /= len;
  s.flowZ /= len;
}

const roadsFc = JSON.parse(readFileSync("public/data/roads.geojson", "utf8"));
const bldgsFc = JSON.parse(readFileSync("public/data/buildings.geojson", "utf8"));

const frame = initGeoReference(origin).frame;
function projRoads() {
  const out = [];
  for (const f of roadsFc.features.slice(0, 500)) {
    const verts = f.geometry.coordinates.map(([lon, lat]) => {
      const p = lonLatToLocal(lon, lat);
      return { lon, lat, x: p.x, z: p.z };
    });
    const mx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
    const mz = verts.reduce((s, v) => s + v.z, 0) / verts.length;
    out.push({ vertices: verts, midX: mx, midZ: mz });
  }
  return out;
}
function projBldgs() {
  const out = [];
  for (const f of bldgsFc.features.slice(0, 800)) {
    const ring = f.geometry.coordinates[0];
    const verts = ring.map(([lon, lat]) => {
      const p = lonLatToLocal(lon, lat);
      return { lon, lat, x: p.x, z: p.z };
    });
    const mx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
    const mz = verts.reduce((s, v) => s + v.z, 0) / verts.length;
    out.push({ vertices: verts, midX: mx, midZ: mz });
  }
  return out;
}

const metrics = computeProjectionMetrics({
  ringGeo,
  ringLocal,
  centerlineLocal,
  corridor: { stations },
  osm: { roads: projRoads(), buildings: projBldgs() },
  bridges: [],
  points: [],
});

console.log("PROJECTION VALIDATION (offline)");
for (const r of metrics.rows) {
  console.log(`${r.icon} ${r.label.padEnd(24)} ${r.errStr}`);
}
