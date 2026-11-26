import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { lonLatToLocal } from "../geo/geoReference.js";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";
import { applyDrapeDepth } from "./drapeDepth.js";

/**
 * Boundary lines only. Polygon fill is off for every historical extent.
 * Colours follow the KML: green traced river, yellow 2016/2019, orange 20 Aug 2025, red 25 Jul 2024.
 * Coordinates are the original rings. No buffer and no geographic offset.
 */
const LINE_WIDTH = 3.5;
const STYLES = {
  "flood-red": { id: "red", line: 0xff0000, lineOrder: 8 },
  "flood-orange": { id: "orange", line: 0xff8000, lineOrder: 9 },
  "flood-yellow": { id: "yellow", line: 0xe6d400, lineOrder: 10 },
  "m_ylw-pushpin": { id: "river", line: 0x00aa00, lineOrder: 11 },
};

const DRAW_ORDER = ["flood-red", "flood-orange", "flood-yellow", "m_ylw-pushpin"];
/** All historical outlines start off: red, orange, yellow, and the green river line. */
const FLOOD_LINE_OFF = new Set(["flood-red", "flood-orange", "flood-yellow", "m_ylw-pushpin"]);
const LIFT_M = 0.35;
const EDGE_M = 32;

/**
 * Historical flood outlines from MulaMuthaRiver-floodExtents2016-2026.kml.
 * Lines only. All four outlines start hidden. Not connected to the live water surface.
 */
export function createHistoricalFloodExtents(dataset, kmlText) {
  const group = new THREE.Group();
  group.name = "historicalFloodExtents";
  group.visible = true;

  const stations = dataset?.corridor?.stations || [];
  const resolution = new THREE.Vector2(
    Math.max(1, window.innerWidth),
    Math.max(1, window.innerHeight),
  );

  const polygons = parsePolygons(kmlText || "").sort(
    (a, b) => DRAW_ORDER.indexOf(a.style) - DRAW_ORDER.indexOf(b.style),
  );

  const stats = [];
  for (const poly of polygons) {
    const ring = projectRing(poly.coords);
    if (ring.length < 3) continue;
    const line = makeOutline(ring, poly.spec, stations, resolution);
    if (!line) continue;
    line.visible = !FLOOD_LINE_OFF.has(poly.style);
    group.add(line);
    stats.push({
      style: poly.style,
      id: poly.spec.id,
      sourceVertices: ring.length,
      fill: false,
      fillOpacity: 0,
      strokeOpacity: 1,
    });
  }

  group.userData.setResolution = (w, h) => {
    resolution.set(w, h);
    group.traverse((obj) => {
      if (obj.material?.resolution) obj.material.resolution.set(w, h);
    });
  };
  group.userData.stats = { polygons: stats };
  console.info("[flood-extents] kml polygons", group.userData.stats);
  return group;
}

function parsePolygons(text) {
  const out = [];
  const marks = [...text.matchAll(/<Placemark[\s\S]*?<\/Placemark>/gi)];
  for (const mark of marks) {
    const block = mark[0];
    if (!/<Polygon[\s>]/i.test(block)) continue;
    const styleMatch = block.match(/<styleUrl>\s*#([A-Za-z0-9_-]+)\s*<\/styleUrl>/i);
    const style = styleMatch?.[1];
    const spec = STYLES[style];
    const coords = block.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
    if (!spec || !coords) continue;
    const pts = [];
    for (const token of coords[1].trim().split(/\s+/)) {
      const [lon, lat] = token.split(",").map(Number);
      if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push({ lon, lat });
    }
    if (pts.length >= 4) out.push({ style, spec, coords: pts });
  }
  return out;
}

function projectRing(coords) {
  const local = [];
  for (const c of coords) {
    try {
      const p = lonLatToLocal(c.lon, c.lat);
      if (Number.isFinite(p?.x) && Number.isFinite(p?.z)) local.push({ x: p.x, z: p.z, lon: c.lon, lat: c.lat });
    } catch {
      /* skip an unprojected vertex rather than invent a replacement */
    }
  }
  if (local.length >= 2) {
    const a = local[0];
    const b = local[local.length - 1];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1) local.pop();
  }
  return local;
}

function groundY(x, z, stations) {
  const ground = terrainHeightAt(x, z, stations);
  return (Number.isFinite(ground) ? ground : SURFACE_Y) + LIFT_M;
}

function makeOutline(ring, spec, stations, resolution) {
  const path = densifyEdges(ring, EDGE_M);
  if (path.length < 2) return null;
  path.push(path[0]);
  const positions = [];
  for (const p of path) positions.push(p.x, groundY(p.x, p.z, stations) + 0.12, p.z);
  const geo = new LineGeometry();
  geo.setPositions(positions);
  const mat = new LineMaterial({
    color: spec.line,
    linewidth: LINE_WIDTH,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -spec.lineOrder,
    polygonOffsetUnits: -spec.lineOrder,
    worldUnits: false,
    resolution,
  });
  applyDrapeDepth(mat, 1.4);
  const line = new Line2(geo, mat);
  line.computeLineDistances();
  line.name = `flood-line-${spec.id}`;
  line.renderOrder = spec.lineOrder;
  line.frustumCulled = false;
  return line;
}

/** Points stay on the original segments. No vertices are dropped. */
function densifyEdges(ring, stepM) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push({ x: a.x, z: a.z });
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(d / stepM);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}
