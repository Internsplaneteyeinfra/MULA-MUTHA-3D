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
 * Parse Chainage Analysis / 10 m chainage KML:
 * - River boundary polygon
 * - River centerline LineString
 * - Chainage points named N+MMM (10 m or 100 m interval)
 *
 * Prefer ExtendedData longitude/latitude/chainage_label/chainage_m when present
 * so stations match the authoritative KML field format exactly.
 */
export function parseChainageAnalysisKml(text) {
  const geom = parseKmlGeometry(text);
  const polygon = geom.polygons[0] || null;

  // Explicitly extract River centerline LineString (ignore LinearRings from polygon)
  let centerline = null;
  const clBlock = text.match(
    /<name>\s*River\s+Centerline\s*<\/name>[\s\S]*?<LineString[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i,
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
    const content = block[0];
    const nameM = content.match(/<name>\s*(\d+)\+(\d+)\s*<\/name>/i);
    const labelExt = kmlDataValue(content, "chainage_label");
    const labelFromExt = labelExt?.match(/^(\d+)\+(\d+)$/);
    if (!nameM && !labelFromExt) continue;

    const km = Number(labelFromExt?.[1] ?? nameM[1]);
    const rem = Number(labelFromExt?.[2] ?? nameM[2]);
    const metersExt = Number(kmlDataValue(content, "chainage_m"));
    const meters = Number.isFinite(metersExt)
      ? Math.round(metersExt)
      : km * 1000 + rem;
    const label =
      (labelExt && /^\d+\+\d+$/.test(labelExt.trim())
        ? labelExt.trim()
        : null) || `${km}+${String(rem).padStart(3, "0")}`;

    const lonExt = Number(kmlDataValue(content, "longitude"));
    const latExt = Number(kmlDataValue(content, "latitude"));
    let lon = Number.isFinite(lonExt) ? lonExt : null;
    let lat = Number.isFinite(latExt) ? latExt : null;
    if (lon == null || lat == null) {
      const pointM = content.match(/<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i);
      if (!pointM) continue;
      const pts = parseCoords(pointM[1]);
      if (!pts.length) continue;
      lon = pts[0].lon;
      lat = pts[0].lat;
    }

    const pinNo = Number(kmlDataValue(content, "pin_no"));
    chainage.push({
      label,
      meters,
      major: Math.round(meters) % 1000 === 0,
      pinNo: Number.isFinite(pinNo) ? pinNo : undefined,
      lon,
      lat,
    });
  }
  chainage.sort((a, b) => a.meters - b.meters);
  if (chainage.length) {
    chainage[0].major = true;
    chainage[chainage.length - 1].major = true;
  }

  const intervalM = detectChainageIntervalM(chainage);
  const sourceName =
    intervalM === 10
      ? "Mula-Mutha River — 10 m chainage"
      : "Mula Mutha River – Chainage Analysis";

  return {
    polygon,
    centerline,
    chainage,
    intervalM,
    sourceName,
  };
}

function kmlDataValue(content, name) {
  const re = new RegExp(
    `<Data\\s+name="${name}"[^>]*>\\s*<value>\\s*([^<]+?)\\s*</value>`,
    "i",
  );
  const m = content.match(re);
  return m?.[1]?.trim() ?? null;
}

/** Modal spacing between consecutive stations (typically 10 or 100). */
function detectChainageIntervalM(chainage) {
  if (!chainage || chainage.length < 3) return 100;
  const counts = new Map();
  for (let i = 1; i < Math.min(chainage.length, 80); i++) {
    const d = Math.round(Math.abs(chainage[i].meters - chainage[i - 1].meters));
    if (d <= 0) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = 100;
  let bestN = 0;
  for (const [d, n] of counts) {
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
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

/** KML PolyStyle color is aabbggrr → CSS #RRGGBB */
export function kmlColorToHex(aabbgrr) {
  const s = String(aabbgrr || "").trim();
  if (!/^[0-9a-fA-F]{8}$/.test(s)) return null;
  return `#${s.slice(6, 8)}${s.slice(4, 6)}${s.slice(2, 4)}`.toUpperCase();
}

function classLabelFromPlacemarkName(name) {
  const n = String(name || "").trim();
  const salinity = n.match(
    /^(Very Low Salinity|Low Salinity|Moderate Salinity|High Salinity|Very High Salinity)/i,
  );
  if (salinity) return salinity[1];
  const cls = n.match(/^(Class\s*\d+)/i);
  if (cls) return cls[1].replace(/\s+/g, " ");
  // "Trees 12" / "Non-Vegetation 3" → class stem
  return n
    .replace(/^\W+/, "")
    .replace(/\s+\d+$/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim() || "Unknown";
}

/**
 * Classed thematic polygons (TSS / NDWI / NDCI / WST / salinity).
 * Placemark name → class label; PolyStyle color from styleUrl.
 */
export function parseClassedPolygonKml(text) {
  const styles = new Map();
  for (const m of text.matchAll(/<Style\s+id="([^"]+)"[\s\S]*?<\/Style>/gi)) {
    const colorM = m[0].match(
      /<PolyStyle[\s\S]*?<color>\s*([0-9A-Fa-f]{8})\s*<\/color>/i,
    );
    if (colorM) styles.set(m[1], kmlColorToHex(colorM[1]));
  }

  const features = [];
  const placemarks = [...text.matchAll(/<Placemark[\s\S]*?<\/Placemark>/gi)];
  for (let i = 0; i < placemarks.length; i++) {
    const content = placemarks[i][0];
    const nameM = content.match(/<name>\s*([^<]*)\s*<\/name>/i);
    const name = nameM?.[1]?.trim() || "";
    const descM = content.match(/<description>\s*([\s\S]*?)\s*<\/description>/i);
    const description = (descM?.[1] || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    const styleM = content.match(/<styleUrl>\s*#?([^<\s]+)\s*<\/styleUrl>/i);
    const styleId = styleM?.[1]?.trim() || "";
    const outer = content.match(
      /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i,
    );
    if (!outer) continue;
    const coordinates = parseCoords(outer[1]);
    if (coordinates.length < 4) continue;

    const class_label = classLabelFromPlacemarkName(name);
    let range = null;
    const rangeM = description.match(/Range:\s*([^\n<]+)/i);
    if (rangeM) range = rangeM[1].trim();

    features.push({
      id: i,
      name,
      description,
      styleId,
      class_label,
      class: class_label,
      range,
      color: styles.get(styleId) || null,
      coordinates,
    });
  }
  return features;
}

/**
 * Parse KML Point placemarks (garbage / site locations).
 * @returns {{ id:number, name:string, description:string, lon:number, lat:number }[]}
 */
export function parsePointPlacemarksKml(text) {
  const features = [];
  const placemarks = [...text.matchAll(/<Placemark[\s\S]*?<\/Placemark>/gi)];
  for (let i = 0; i < placemarks.length; i++) {
    const content = placemarks[i][0];
    const pointM = content.match(
      /<(?:\w+:)?Point\b[\s\S]*?<(?:\w+:)?coordinates>\s*([^<]+)\s*<\/(?:\w+:)?coordinates>/i,
    );
    if (!pointM) continue;
    const coords = parseCoords(pointM[1]);
    if (!coords.length) continue;
    const { lon, lat } = coords[0];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const nameM = content.match(/<name>\s*([^<]*)\s*<\/name>/i);
    const name = nameM?.[1]?.trim() || "";
    const descM = content.match(/<description>\s*([\s\S]*?)\s*<\/description>/i);
    const description = (descM?.[1] || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trim();

    features.push({
      id: i + 1,
      name: name || null,
      description: description || null,
      lon,
      lat,
    });
  }
  return features;
}
