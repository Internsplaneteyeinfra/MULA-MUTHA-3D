/**
 * Authoritative WGS84 → local ENU pipeline for every geographic layer.
 * All loaders MUST use this module — no per-layer origins or conversions.
 */
import {
  projectLonLat as utmProject,
  unprojectUtm,
  createLocalFrame as buildFrame,
} from "./projection.js";

/** @typedef {{ lon: number, lat: number, elevation?: number }} LonLat */
/** @typedef {{ x: number, y?: number, z: number }} LocalPoint */

let _ref = null;
/** @type {ReturnType<typeof buildFrame> | null} */
let _frame = null;

/**
 * Initialise (or replace) the shared georeference from KML bbox center.
 * @param {{ lon: number, lat: number, elevation?: number }} origin
 * @param {Array<{ easting?: number, northing?: number }>} [seedPoints]
 */
export function initGeoReference(origin, seedPoints = []) {
  _ref = {
    referenceLongitude: origin.lon,
    referenceLatitude: origin.lat,
    referenceElevation: origin.elevation ?? 0,
  };
  _frame = buildFrame(seedPoints, { originLonLat: origin });
  return getGeoReference();
}

/** @returns {{ referenceLongitude: number, referenceLatitude: number, referenceElevation: number, frame: object }} */
export function getGeoReference() {
  if (!_ref || !_frame) {
    throw new Error("geoReference not initialised — call initGeoReference first");
  }
  return { ..._ref, frame: _frame };
}

export function getReferenceLongitude() {
  return _ref?.referenceLongitude;
}
export function getReferenceLatitude() {
  return _ref?.referenceLatitude;
}
export function getReferenceElevation() {
  return _ref?.referenceElevation ?? 0;
}

/**
 * WGS84 lon/lat (+ optional elevation metres) → Three.js local X/Z (Y = up).
 * @param {number} lon
 * @param {number} lat
 * @param {number} [elevation=0]
 * @returns {{ x: number, y: number, z: number, lon: number, lat: number, easting: number, northing: number }}
 */
export function lonLatToLocal(lon, lat, elevation = 0) {
  const { frame } = getGeoReference();
  const u = utmProject(lon, lat);
  const p = frame.toLocal(u.easting, u.northing);
  return {
    x: p.x,
    y: elevation - getReferenceElevation(),
    z: p.z,
    lon,
    lat,
    easting: u.easting,
    northing: u.northing,
  };
}

/**
 * Local X/Z → WGS84 lon/lat.
 * @param {number} x
 * @param {number} z
 * @returns {{ lon: number, lat: number, easting: number, northing: number }}
 */
export function localToLonLat(x, z) {
  const { frame } = getGeoReference();
  const ll = frame.toLonLat(x, z);
  const u = frame.toUtm(x, z);
  return { lon: ll.lon, lat: ll.lat, easting: u.easting, northing: u.northing };
}

/**
 * Horizontal distance in metres between two local points.
 * @param {{ x: number, z: number }} a
 * @param {{ x: number, z: number }} b
 */
export function metersDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Project a GeoJSON feature's coordinates into local space.
 * Supports Point, LineString, Polygon (outer ring).
 * @param {import('geojson').Feature} feature
 */
export function projectFeature(feature) {
  const g = feature?.geometry;
  if (!g) return null;

  if (g.type === "Point") {
    const [lon, lat, elev = 0] = g.coordinates;
    return { type: "Point", coordinates: lonLatToLocal(lon, lat, elev) };
  }

  if (g.type === "LineString") {
    return {
      type: "LineString",
      coordinates: g.coordinates.map(([lon, lat, elev = 0]) => lonLatToLocal(lon, lat, elev)),
    };
  }

  if (g.type === "Polygon") {
    const ring = g.coordinates[0] || [];
    return {
      type: "Polygon",
      coordinates: [ring.map(([lon, lat, elev = 0]) => lonLatToLocal(lon, lat, elev))],
    };
  }

  return null;
}

/** Re-export frame factory for dataset bootstrap (uses same projection constants). */
export { buildFrame as createLocalFrame, utmProject as projectLonLat, unprojectUtm };
