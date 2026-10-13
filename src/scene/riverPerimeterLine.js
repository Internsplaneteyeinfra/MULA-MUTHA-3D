import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { SURFACE_Y } from "./river.js";
import { terrainHeightAt } from "./terrain.js";

const COLOR = 0x3f9bff;
const WIDTH_PX = 1.6;
const OPACITY = 0.95;
const LIFT_M = 0.55;
/** KML rings contain a few unreliable vertex jumps; never draw a chord across them. */
const MAX_STEP_M = 250;

/**
 * Thin blue line along the exact KML river-water polygon (dataset.ringLocal).
 * Depth-tested and polygon-offset so buildings, bridge decks and terrain still occlude it.
 */
export function createRiverPerimeterLine(dataset) {
  const group = new THREE.Group();
  group.name = "riverPerimeter";
  const stations = dataset.corridor?.stations || [];
  const ring = dataset.ringLocal || [];
  const resolution = new THREE.Vector2(
    Math.max(1, window.innerWidth),
    Math.max(1, window.innerHeight),
  );
  if (ring.length < 3) return group;

  const y = (x, z) => Math.max(terrainHeightAt(x, z, stations), SURFACE_Y) + LIFT_M;
  const closed = [...ring, ring[0]];
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const positions = [];
      for (const p of run) positions.push(p.x, y(p.x, p.z), p.z);
      const geo = new LineGeometry();
      geo.setPositions(positions);
      const mat = new LineMaterial({
        color: COLOR,
        linewidth: WIDTH_PX,
        transparent: true,
        opacity: OPACITY,
        depthTest: true,
        depthWrite: false,
        worldUnits: false,
        resolution,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.renderOrder = 12;
      line.frustumCulled = false;
      group.add(line);
    }
    run = [];
  };
  for (let i = 0; i < closed.length; i++) {
    const c = closed[i];
    const prev = run[run.length - 1];
    if (prev && Math.hypot(c.x - prev.x, c.z - prev.z) > MAX_STEP_M) flush();
    run.push(c);
  }
  flush();

  group.userData.setResolution = (w, h) => {
    resolution.set(w, h);
    group.traverse((o) => o.material?.resolution?.set(w, h));
  };
  return group;
}
