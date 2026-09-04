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

/**
 * Parse OSM waterway drainage KML (rivers, streams, drains, canals, ditches).
 * Each LineString becomes one feature with name + all SimpleData props.
 */
export function parseDrainageKml(text) {
  const features = [];
  const placemarks = [...text.matchAll(/<Placemark[\s\S]*?<\/Placemark>/gi)];
  for (const block of placemarks) {
    const content = block[0];
    const nameM = content.match(/<name>\s*([^<]*)\s*<\/name>/i);
    const name = nameM?.[1]?.trim() || "";
    const props = {};
    for (const m of content.matchAll(/<SimpleData name="([^"]+)">\s*([^<]*)\s*<\/SimpleData>/gi)) {
      const key = m[1].trim();
      const val = m[2].trim();
      if (val) props[key] = val;
    }
    const waterway = (props.waterway || "stream").toLowerCase();
    const coordBlocks = [...content.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
    for (const c of coordBlocks) {
      const coordinates = parseCoords(c[1]);
      if (coordinates.length >= 2) {
        features.push({
          name,
          waterway,
          osmId: props.osm_id || props.full_id || "",
          osmType: props.osm_type || "",
          nameEn: props["name:en"] || "",
          nameMr: props["name:mr"] || "",
          nameHi: props["name:hi"] || "",
          nameGu: props["name:gu"] || "",
          width: props.width || "",
          intermittent: props.intermittent || "",
          tunnel: props.tunnel || "",
          bridge: props.bridge || "",
          boat: props.boat || "",
          city: props["addr:city"] || "",
          intName: props.int_name || "",
          wikidata: props.wikidata || "",
          layer: props.layer || "",
          props,
          coordinates,
        });
      }
    }
  }
  return features;
}

/**
 * Parse Jul 2026 smoothed depth-class polygons (1.5–2.0 m bands).
 * Each Placemark Polygon → one feature with depth class + opacity metadata.
 */
export function parseDepthZonesKml(text) {
  const features = [];
  const placemarks = [...text.matchAll(/<Placemark[\s\S]*?<\/Placemark>/gi)];
  for (const block of placemarks) {
    const content = block[0];
    const nameM = content.match(/<name>\s*([^<]*)\s*<\/name>/i);
    const name = nameM?.[1]?.trim() || "";
    const descM = content.match(/<description>\s*([^<]*)\s*<\/description>/i);
    const description = descM?.[1]?.trim() || "";
    const styleM = content.match(/<styleUrl>\s*#?([^<\s]+)\s*<\/styleUrl>/i);
    const styleId = styleM?.[1]?.trim() || "";

    const bandM = name.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*m/i);
    if (!bandM) continue;
    const depthMin = Number(bandM[1]);
    const depthMax = Number(bandM[2]);
    if (!Number.isFinite(depthMin) || !Number.isFinite(depthMax)) continue;

    let fillOpacity = 0.55;
    const opM = description.match(/fill opacity\s+(\d+)\s*%/i);
    if (opM) fillOpacity = Math.min(1, Math.max(0.08, Number(opM[1]) / 100));

    let areaM2 = null;
    const areaM = description.match(/area\s+([\d,]+)\s*m/i);
    if (areaM) areaM2 = Number(areaM[1].replace(/,/g, ""));

    const outer = content.match(
      /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i,
    );
    if (!outer) continue;
    const coordinates = parseCoords(outer[1]);
    if (coordinates.length < 4) continue;

    features.push({
      name,
      description,
      styleId,
      depthMin,
      depthMax,
      depthMid: (depthMin + depthMax) * 0.5,
      depthClass: `${depthMin.toFixed(1)}-${depthMax.toFixed(1)}`,
      fillOpacity,
      areaM2,
      coordinates,
    });
  }
  return features;
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
