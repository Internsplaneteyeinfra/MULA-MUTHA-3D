/**
 * KML ↔ GeoJSON helpers for Mula–Mutha AOI preparation.
 * JalNetra Flood API requires multipart `kml` (file) — GeoJSON is produced
 * for validation / inspection; the original KML remains the upload payload.
 */

/**
 * @typedef {{ lon: number, lat: number }} LonLat
 */

function parseCoords(raw) {
  return String(raw)
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const parts = tok.split(",");
      const lon = Number(parts[0]);
      const lat = Number(parts[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return { lon, lat };
    })
    .filter(Boolean);
}

function ringsFromPolygonBlock(block) {
  const rings = [];
  const coordsBlocks = [
    ...block.matchAll(/<(?:\w+:)?coordinates>([\s\S]*?)<\/(?:\w+:)?coordinates>/gi),
  ];
  for (const m of coordsBlocks) {
    const pts = parseCoords(m[1]);
    if (pts.length >= 4) rings.push(pts);
  }
  return rings;
}

/**
 * Extract outer rings from KML text (Polygon / MultiGeometry).
 * @param {string} kmlText
 * @returns {LonLat[][]}
 */
export function extractPolygonsFromKml(kmlText) {
  if (!kmlText || typeof kmlText !== "string") return [];
  const polygons = [];
  const polyBlocks = [...kmlText.matchAll(/<(?:\w+:)?Polygon\b[\s\S]*?<\/(?:\w+:)?Polygon>/gi)];
  for (const block of polyBlocks) {
    const rings = ringsFromPolygonBlock(block[0]);
    if (rings[0]) polygons.push(rings[0]);
  }
  return polygons;
}

/**
 * @param {LonLat[][]} polygons
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateKmlPolygons(polygons) {
  if (!polygons?.length) {
    return { ok: false, error: "No Polygon / MultiGeometry found in KML AOI." };
  }
  for (let i = 0; i < polygons.length; i++) {
    const ring = polygons[i];
    if (!ring || ring.length < 4) {
      return { ok: false, error: `AOI polygon ${i} has fewer than 4 vertices.` };
    }
    for (const p of ring) {
      if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat)) {
        return { ok: false, error: `AOI polygon ${i} has invalid coordinates.` };
      }
      if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) {
        return { ok: false, error: `AOI polygon ${i} coordinates out of range.` };
      }
    }
  }
  return { ok: true };
}

/** Close ring if first ≠ last (GeoJSON requirement). */
function closedRing(ring) {
  if (!ring?.length) return [];
  const out = ring.map((p) => [p.lon, p.lat]);
  const a = out[0];
  const b = out[out.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  return out;
}

/**
 * Convert extracted KML rings → GeoJSON FeatureCollection.
 * @param {LonLat[][]} polygons
 * @param {object} [properties]
 */
export function polygonsToGeoJSON(polygons, properties = {}) {
  const features = (polygons || []).map((ring, i) => ({
    type: "Feature",
    properties: { ...properties, index: i },
    geometry:
      polygons.length === 1
        ? { type: "Polygon", coordinates: [closedRing(ring)] }
        : { type: "Polygon", coordinates: [closedRing(ring)] },
  }));

  if (polygons.length > 1) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { ...properties, type: "MultiPolygon" },
          geometry: {
            type: "MultiPolygon",
            coordinates: polygons.map((ring) => [closedRing(ring)]),
          },
        },
      ],
    };
  }

  return { type: "FeatureCollection", features };
}

/**
 * Full AOI prep from KML text for JalNetra Flood API.
 * API multipart field is still the original KML file (not GeoJSON).
 *
 * @param {string} kmlText
 * @param {{ filename?: string }} [opts]
 */
export function prepareAoiFromKml(kmlText, opts = {}) {
  const polygons = extractPolygonsFromKml(kmlText);
  const validation = validateKmlPolygons(polygons);
  if (!validation.ok) {
    const err = new Error(validation.error || "Invalid AOI KML.");
    err.code = "INVALID_AOI";
    throw err;
  }

  const geojson = polygonsToGeoJSON(polygons, { source: "Mula-Mutha AOI" });
  const filename = opts.filename || "mula_mutha_aoi.kml";
  const kmlBlob = new Blob([kmlText], {
    type: "application/vnd.google-earth.kml+xml",
  });

  return {
    polygons,
    geojson,
    kmlText,
    kmlBlob,
    filename,
    /** Exact multipart field name required by OpenAPI */
    apiField: "kml",
  };
}

export default {
  extractPolygonsFromKml,
  validateKmlPolygons,
  polygonsToGeoJSON,
  prepareAoiFromKml,
};
