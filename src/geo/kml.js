/** Parse KML Polygon / LineString / Point coordinates into lon/lat. */

export function parseKmlGeometry(text) {
  const polygons = [];
  const lines = [];

  const polyBlocks = [...text.matchAll(/<Polygon[\s\S]*?<\/Polygon>/gi)];
  for (const block of polyBlocks) {
    const rings = [...block[0].matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
    for (const r of rings) {
      const pts = parseCoords(r[1]);
      if (pts.length >= 4) polygons.push(pts);
    }
  }

  const lineBlocks = [...text.matchAll(/<(?:LineString|LinearRing)[\s\S]*?<\/(?:LineString|LinearRing)>/gi)];
  for (const block of lineBlocks) {
    const rings = [...block[0].matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
    for (const r of rings) {
      const pts = parseCoords(r[1]);
      if (pts.length >= 2) lines.push(pts);
    }
  }

  return { polygons, lines };
}

/**
 * Parse Chainage Analysis KML:
 * - River Boundary polygon
 * - River Centerline LineString
 * - Chainage Points named N+MMM (every 100 m)
 */
export function parseChainageAnalysisKml(text) {
  const geom = parseKmlGeometry(text);
  const polygon = geom.polygons[0] || null;

  // Explicitly extract "River Centerline" LineString (ignore LinearRings from polygon)
  let centerline = null;
  const clBlock = text.match(
    /<name>\s*River Centerline\s*<\/name>[\s\S]*?<LineString[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i,
  );
  if (clBlock) {
    const pts = parseCoords(clBlock[1]);
    if (pts.length >= 2) centerline = pts;
  }
  if (!centerline) {
    // Fallback: longest LineString block only (not LinearRing)
    const lineBlocks = [...text.matchAll(/<LineString[\s\S]*?<\/LineString>/gi)];
    let bestLen = 0;
    for (const block of lineBlocks) {
      const rings = [...block[0].matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
      for (const r of rings) {
        const pts = parseCoords(r[1]);
        if (pts.length < 10) continue;
        let len = 0;
        for (let i = 1; i < pts.length; i++) {
          len += Math.hypot(pts[i].lon - pts[i - 1].lon, pts[i].lat - pts[i - 1].lat);
        }
        if (len > bestLen) {
          bestLen = len;
          centerline = pts;
        }
      }
    }
  }

  const chainage = [];
  const placemarks = [...text.matchAll(/<Placemark[\s\S]*?<\/Placemark>/gi)];
  for (const block of placemarks) {
    const nameM = block[0].match(/<name>\s*(\d+)\+(\d+)\s*<\/name>/i);
    if (!nameM) continue;
    const km = Number(nameM[1]);
    const m = Number(nameM[2]);
    const meters = km * 1000 + m;
    const pointM = block[0].match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i);
    if (!pointM) continue;
    const pts = parseCoords(pointM[1]);
    if (!pts.length) continue;
    const label = `${km}+${String(m).padStart(3, "0")}`;
    chainage.push({
      label,
      meters,
      major: m === 0 || label === "16+400",
      lon: pts[0].lon,
      lat: pts[0].lat,
    });
  }
  chainage.sort((a, b) => a.meters - b.meters);

  return {
    polygon,
    centerline,
    chainage,
    sourceName: "Mula Mutha River – Chainage Analysis",
  };
}

function parseCoords(raw) {
  return raw
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
