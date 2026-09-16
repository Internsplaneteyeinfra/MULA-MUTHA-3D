/**
 * Load & parse mula-mutha-garbage-locations.kml (authoritative).
 * Does not invent names, types, dates, quantities, or coordinates.
 *
 * Prefer Vite-bundled `?raw` text so we never depend on public/ + SW
 * serving SPA HTML for missing/cached paths.
 */

/** Expected Point count in the authoritative KML. */
export const EXPECTED_GARBAGE_POINTS = 67;

/**
 * @param {string} text
 * @returns {{
 *   records: object[],
 *   report: object,
 * }}
 */
export function parseGarbageKml(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("[GarbageLoader] Empty KML text");
  }
  if (/^\s*<!DOCTYPE html/i.test(text) || /^\s*<html[\s>]/i.test(text)) {
    throw new Error("[GarbageLoader] Payload is HTML, not KML");
  }
  if (!/<kml[\s>]/i.test(text)) {
    throw new Error("[GarbageLoader] Payload has no <kml> root");
  }

  const placemarks = [...text.matchAll(/<Placemark[\s\S]*?<\/Placemark>/gi)];
  const records = [];
  let invalidCoordinates = 0;
  let withNames = 0;
  let withDescriptions = 0;
  let withExtendedData = 0;
  let withDates = 0;
  let withType = 0;
  let points = 0;
  let lines = 0;
  let polys = 0;

  for (let i = 0; i < placemarks.length; i++) {
    const content = placemarks[i][0];
    const geometry = extractGeometry(content);
    if (!geometry) {
      invalidCoordinates += 1;
      continue;
    }
    if (geometry.geometryType === "Point") points += 1;
    else if (geometry.geometryType === "LineString") lines += 1;
    else if (geometry.geometryType === "Polygon") polys += 1;

    const { lon, lat } = geometry;
    if (!isValidLonLat(lon, lat)) {
      invalidCoordinates += 1;
      continue;
    }

    const nameRaw = content.match(/<name>\s*([^<]*)\s*<\/name>/i)?.[1]?.trim() || "";
    const name = nameRaw || null;

    const descM = content.match(/<description>\s*([\s\S]*?)\s*<\/description>/i);
    const description = descM ? cleanHtml(descM[1]) : null;
    if (description) withDescriptions += 1;
    if (name) withNames += 1;

    const properties = parseExtendedData(content);
    if (Object.keys(properties).length) withExtendedData += 1;

    const date =
      properties.date ||
      properties.Date ||
      properties.DATE ||
      properties.observed_date ||
      null;
    if (date) withDates += 1;

    const category =
      properties.type ||
      properties.Type ||
      properties.category ||
      properties.Category ||
      properties.garbage_type ||
      properties.class ||
      null;
    if (category) withType += 1;

    const quantityRaw =
      properties.quantity || properties.Quantity || properties.count || properties.Count || null;
    const quantity =
      quantityRaw != null && Number.isFinite(Number(quantityRaw)) ? Number(quantityRaw) : null;

    records.push({
      id: `g-${i + 1}`,
      sourceIndex: i + 1,
      name,
      description: description || null,
      lon,
      lat,
      alt: geometry.alt ?? 0,
      geometryType: geometry.geometryType,
      coordinates: geometry.coordinates,
      properties,
      category: category || null,
      quantity,
      date: date || null,
      visualCategory: category ? mapVisualCategory(category) : "general_waste",
    });
  }

  const report = {
    totalPlacemarks: placemarks.length,
    validRecords: records.length,
    invalidCoordinates,
    points,
    lines,
    polys,
    withNames,
    withoutNames: records.length - withNames,
    withDescriptions,
    withExtendedData,
    withDates,
    withType,
  };

  console.info(`[GarbageLoader] Loaded garbage points: ${records.length}`);
  if (records.length !== EXPECTED_GARBAGE_POINTS) {
    console.warn(
      `[GarbageLoader] Expected ${EXPECTED_GARBAGE_POINTS} Point placemarks, got ${records.length}. ` +
        `Placemarks scanned=${placemarks.length}, invalidCoords=${invalidCoordinates}. ` +
        `Not fabricating missing records.`,
    );
  }

  return { records, report };
}

/**
 * Load garbage KML from bundled raw text and/or a URL.
 * Prefer `bundledText` (Vite ?raw) to avoid public/ + service-worker HTML cache.
 *
 * @param {string|null} url
 * @param {{ bundledText?: string|null }} [opts]
 */
export async function loadGarbageKml(url, opts = {}) {
  const bundled = opts.bundledText;
  if (typeof bundled === "string" && bundled.trim() && /<kml[\s>]/i.test(bundled)) {
    console.info("[GarbageLoader] Source: Vite-bundled KML (?raw)");
    console.info("[GarbageLoader] HTTP: n/a (bundled)");
    console.info("[GarbageLoader] Content-Type: application/vnd.google-earth.kml+xml (bundled)");
    return parseGarbageKml(bundled);
  }

  if (!url) {
    throw new Error("[GarbageLoader] No bundled KML and no URL provided");
  }

  console.info(`[GarbageSystem] KML URL: ${url}`);
  const abs = url.startsWith("http") ? url : new URL(url, window.location.origin).href;
  const res = await fetch(abs, { signal: AbortSignal.timeout(30000), cache: "no-store" });
  const contentType = res.headers.get("content-type") || "(none)";
  console.info(`[GarbageLoader] HTTP: ${res.status} ${res.statusText || ""}`.trim());
  console.info(`[GarbageLoader] Content-Type: ${contentType}`);

  if (!res.ok) {
    throw new Error(`[GarbageLoader] HTTP ${res.status} for ${abs}`);
  }

  const text = await res.text();
  const head = text.slice(0, 120).replace(/\s+/g, " ");
  if (/^\s*<!DOCTYPE html/i.test(text) || /^\s*<html[\s>]/i.test(text)) {
    throw new Error(
      `[GarbageLoader] URL returned HTML instead of KML: ${abs} (content-type=${contentType}, head="${head}")`,
    );
  }
  if (!/<kml[\s>]/i.test(text)) {
    throw new Error(
      `[GarbageLoader] URL has no <kml> root: ${abs} (content-type=${contentType}, head="${head}")`,
    );
  }

  return parseGarbageKml(text);
}

function isValidLonLat(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return false;
  if (lon < 73.6 || lon > 74.2 || lat < 18.3 || lat > 18.8) return false;
  return true;
}

function cleanHtml(raw) {
  return String(raw || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseExtendedData(content) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of content.matchAll(
    /<Data\s+name=["']([^"']+)["']\s*>[\s\S]*?<value>\s*([\s\S]*?)\s*<\/value>/gi,
  )) {
    out[m[1]] = cleanHtml(m[2]);
  }
  for (const m of content.matchAll(/<SimpleData\s+name=["']([^"']+)["']\s*>\s*([^<]*)\s*<\/SimpleData>/gi)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

function extractGeometry(content) {
  const pointM = content.match(
    /<(?:\w+:)?Point\b[\s\S]*?<(?:\w+:)?coordinates>\s*([^<]+)\s*<\/(?:\w+:)?coordinates>/i,
  );
  if (pointM) {
    const c = parseFirstCoord(pointM[1]);
    if (!c) return null;
    return { geometryType: "Point", lon: c.lon, lat: c.lat, alt: c.alt, coordinates: [c] };
  }

  const lineM = content.match(
    /<(?:\w+:)?LineString\b[\s\S]*?<(?:\w+:)?coordinates>\s*([^<]+)\s*<\/(?:\w+:)?coordinates>/i,
  );
  if (lineM) {
    const coords = parseAllCoords(lineM[1]);
    if (!coords.length) return null;
    const mid = coords[Math.floor(coords.length / 2)];
    return {
      geometryType: "LineString",
      lon: mid.lon,
      lat: mid.lat,
      alt: mid.alt,
      coordinates: coords,
    };
  }

  const polyM = content.match(
    /<(?:\w+:)?Polygon\b[\s\S]*?<(?:\w+:)?coordinates>\s*([^<]+)\s*<\/(?:\w+:)?coordinates>/i,
  );
  if (polyM) {
    const coords = parseAllCoords(polyM[1]);
    if (!coords.length) return null;
    let sx = 0;
    let sy = 0;
    for (const c of coords) {
      sx += c.lon;
      sy += c.lat;
    }
    const n = coords.length;
    return {
      geometryType: "Polygon",
      lon: sx / n,
      lat: sy / n,
      alt: 0,
      coordinates: coords,
    };
  }
  return null;
}

function parseFirstCoord(raw) {
  const all = parseAllCoords(raw);
  return all[0] || null;
}

function parseAllCoords(raw) {
  const out = [];
  for (const token of String(raw).trim().split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(",");
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    const alt = parts.length > 2 ? Number(parts[2]) : 0;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push({ lon, lat, alt: Number.isFinite(alt) ? alt : 0 });
  }
  return out;
}

function mapVisualCategory(category) {
  const s = String(category).toLowerCase();
  if (/tire|tyre/.test(s)) return "tire";
  if (/bottle/.test(s)) return "plastic_bottle";
  if (/bag/.test(s)) return "plastic_bag";
  if (/container|drum|barrel/.test(s)) return "floating_container";
  if (/debris|cluster|pile/.test(s)) return "debris_cluster";
  return "general_waste";
}
