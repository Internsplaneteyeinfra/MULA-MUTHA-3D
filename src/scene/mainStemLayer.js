import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { parseDrainageKml } from "../geo/kml.js";
import { lonLatToLocal } from "../geo/geoReference.js";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";

/**
 * Main Stem layer from `src/data/main stream.kml` (Mula–Mutha centerline).
 * Lon/lat → EPSG:32643 local frame via shared geoReference (same as river).
 */
export function createMainStemLayer(dataset, kmlText) {
  const group = new THREE.Group();
  group.name = "mainStemLayer";
  group.visible = false;

  const stations = dataset.corridor?.stations || [];
  const features = parseDrainageKml(kmlText || "");
  const paths = [];

  for (const f of features) {
    const coords = f.coordinates || [];
    if (coords.length < 2) continue;
    const local = [];
    for (const c of coords) {
      const lon = Number(c.lon ?? c[0]);
      const lat = Number(c.lat ?? c[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      // Sanity: Mula–Mutha AOI (reject swapped lat/lon)
      if (lon < 73.7 || lon > 74.2 || lat < 18.4 || lat > 18.7) {
        console.warn("[main_stem] skipped coord outside AOI", { lon, lat });
        continue;
      }
      try {
        const p = lonLatToLocal(lon, lat);
        local.push({ lon, lat, x: p.x, z: p.z });
      } catch (err) {
        console.warn("[main_stem] project failed", lon, lat, err.message);
      }
    }
    if (local.length >= 2) {
      paths.push({
        name: f.name || "Mula-Mutha",
        waterway: f.waterway || "river",
        pts: densify(local, 18),
      });
    }
  }

  const resolution = new THREE.Vector2(
    Math.max(1, window.innerWidth),
    Math.max(1, window.innerHeight),
  );

  let vertexCount = 0;
  for (const path of paths) {
    const curvePts = path.pts.map((p) => {
      const ty = terrainHeightAt(p.x, p.z, stations);
      const y =
        Number.isFinite(ty) ? Math.max(ty, SURFACE_Y) + 1.6 : SURFACE_Y + 1.6;
      return new THREE.Vector3(p.x, y, p.z);
    });
    vertexCount += curvePts.length;

    // Dark halo + bright gold stem (readable over water/terrain)
    group.add(
      makeFatLine(curvePts, {
        color: 0x1a1000,
        linewidth: 7,
        opacity: 0.55,
        resolution,
        renderOrder: 24,
      }),
    );
    group.add(
      makeFatLine(curvePts, {
        color: 0xf5c542,
        linewidth: 3.4,
        opacity: 0.98,
        resolution,
        renderOrder: 25,
      }),
    );

    // Soft tube for volume at overview
    try {
      const curve = new THREE.CatmullRomCurve3(curvePts, false, "catmullrom", 0.12);
      const tubular = Math.max(24, Math.min(320, Math.floor(curve.getLength() / 8)));
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, tubular, 4.2, 8, false),
        new THREE.MeshBasicMaterial({
          color: 0xf0b429,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      tube.renderOrder = 23;
      tube.frustumCulled = false;
      group.add(tube);
    } catch {
      /* skip tube if degenerate */
    }
  }

  group.userData.stats = {
    features: features.length,
    paths: paths.length,
    vertices: vertexCount,
    name: paths[0]?.name || "Main Stem",
  };
  group.userData.resolution = resolution;
  group.userData.setResolution = (w, h) => {
    resolution.set(w, h);
    group.traverse((obj) => {
      if (obj.material?.resolution) obj.material.resolution.set(w, h);
    });
  };

  group.userData.setVisible = (on) => {
    group.visible = !!on;
  };

  group.userData.dispose = () => {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  };

  console.info("[main_stem] ready", group.userData.stats);
  return group;
}

function densify(pts, stepM) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.floor(d / stepM));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({
        lon: a.lon + (b.lon - a.lon) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
      });
    }
  }
  return out;
}

function makeFatLine(points, { color, linewidth, opacity, resolution, renderOrder }) {
  const positions = [];
  for (const p of points) positions.push(p.x, p.y, p.z);
  const geo = new LineGeometry();
  geo.setPositions(positions);
  const mat = new LineMaterial({
    color,
    linewidth,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
    resolution,
  });
  const line = new Line2(geo, mat);
  line.computeLineDistances();
  line.renderOrder = renderOrder;
  line.frustumCulled = false;
  return line;
}
