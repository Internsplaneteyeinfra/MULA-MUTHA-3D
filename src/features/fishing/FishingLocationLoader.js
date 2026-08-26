/**
 * Parse Fishing_Locations.kml Placemark Points — names + lon/lat only.
 * Does not invent place names; uses KML <name> as location ID.
 *
 * Bundled via ?raw so boot does not depend on /data fetch (SPA HTML fallback).
 */
import fishingKmlRaw from "./Fishing_Locations.kml?raw";

export function parseFishingLocationsKml(text) {
  if (!text || /<!DOCTYPE html>/i.test(text) || /<html[\s>]/i.test(text)) {
    return [];
  }

  const locations = [];
  const blocks = [...text.matchAll(/<Placemark[\s\S]*?<\/Placemark>/gi)];
  for (const block of blocks) {
    const xml = block[0];
    const nameMatch = xml.match(/<name>\s*([^<]+)\s*<\/name>/i);
    // Point coords may sit after gx:drawOrder; allow whitespace/newlines inside coordinates
    const coordMatch =
      xml.match(/<Point[\s\S]*?<coordinates>\s*([^<]+?)\s*<\/coordinates>/i) ||
      xml.match(/<coordinates>\s*([-\d.]+)\s*,\s*([-\d.]+)(?:\s*,\s*[-\d.]*)?\s*<\/coordinates>/i);
    if (!coordMatch) continue;

    let lon;
    let lat;
    if (coordMatch.length >= 3 && coordMatch[2] != null && !coordMatch[1].includes(",")) {
      lon = Number(coordMatch[1]);
      lat = Number(coordMatch[2]);
    } else {
      const parts = coordMatch[1].trim().split(/[\s,]+/);
      lon = Number(parts[0]);
      lat = Number(parts[1]);
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const id = (nameMatch?.[1] || `F${locations.length + 1}`).trim();
    locations.push({ id, name: id, lon, lat });
  }
  return locations;
}

export async function loadFishingLocations(url = "/data/Fishing_Locations.kml") {
  // 1) Bundled copy (authoritative — from Downloads / project)
  let locations = parseFishingLocationsKml(fishingKmlRaw);
  if (locations.length) {
    console.info("Fishing locations (bundled)", { count: locations.length, ids: locations.map((l) => l.id) });
    return locations;
  }

  // 2) Network fallbacks
  const urls = [url, "/data/Fishing_Locations.kml"].filter((u, i, a) => a.indexOf(u) === i);
  let lastErr = null;
  for (const u of urls) {
    try {
      const res = await fetch(u);
      if (!res.ok) {
        lastErr = new Error(`Failed to load Fishing_Locations.kml (${res.status})`);
        continue;
      }
      const text = await res.text();
      locations = parseFishingLocationsKml(text);
      if (locations.length) {
        console.info("Fishing locations (fetch)", { url: u, count: locations.length });
        return locations;
      }
      lastErr = new Error(`No fishing placemarks found in KML (${u})`);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error("No fishing placemarks found in KML");
}
