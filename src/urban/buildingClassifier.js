/**
 * Classify OSM footprints into building categories.
 * Height / type from tags when present; otherwise geometry + seeded heuristics.
 * Treats the OSM Map-API default height (~8.5 m) as "unknown" so skyline varies.
 */

const ASSET_BY_CLASS = {
  house: ["residential/house_01", "residential/house_02", "residential/house_03"],
  row: ["residential/row_house_01", "commercial/shop_block_01"],
  apartment_low: ["apartments/apartment_lowrise"],
  apartment_mid: ["apartments/apartment_midrise"],
  apartment_high: ["apartments/apartment_highrise"],
  commercial: ["commercial/commercial_01", "commercial/shop_block_01"],
  warehouse: ["industrial/warehouse_01"],
};

/** Fetch pipeline default when OSM has no height — not a surveyed value. */
function isDefaultHeight(h) {
  return h != null && Math.abs(h - 8.5) < 0.15;
}

export function classifyBuilding(building, metrics) {
  const tag = String(building.building || "yes").toLowerCase();
  const area = metrics.areaM2;
  const aspect = metrics.aspect;
  const seed = Math.abs(
    Number(building.id) ||
      hashStr(String(building.id ?? "")) ||
      Math.floor(metrics.centroidX * 10 + metrics.centroidZ),
  );

  let height = metrics.heightM;
  if (isDefaultHeight(height)) height = null;

  // Tag-driven overrides
  if (/warehouse|industrial|factory|shed/.test(tag)) {
    return finalize("warehouse", height ?? 9 + (seed % 4), area, metrics, building, seed);
  }
  if (/commercial|retail|office|hotel|mall|shop/.test(tag)) {
    return finalize(
      "commercial",
      height ?? estimateCommercialHeight(area, seed),
      area,
      metrics,
      building,
      seed,
    );
  }
  if (/apartments/.test(tag) || (/residential/.test(tag) && area > 280)) {
    const h = height ?? estimateAptHeight(area, seed);
    return finalize(aptClass(h), h, area, metrics, building, seed);
  }
  if (/house|detached|bungalow|villa|semidetached_house/.test(tag)) {
    return finalize("house", height ?? 4.5 + (seed % 8) * 0.55, area, metrics, building, seed);
  }

  // Geometry-driven (building=yes majority)
  if (area < 100) {
    return finalize("house", height ?? 4.2 + (seed % 7) * 0.65, area, metrics, building, seed);
  }
  if (area < 160) {
    return finalize("house", height ?? 7 + (seed % 6) * 0.75, area, metrics, building, seed);
  }
  if (aspect > 2.4 && area < 350) {
    return finalize("row", height ?? 8 + (seed % 4) * 0.8, area, metrics, building, seed);
  }
  if (area > 1400 && (!height || height < 14)) {
    return finalize("warehouse", height ?? 9 + (seed % 3), area, metrics, building, seed);
  }
  if (area > 900 || (height && height > 28)) {
    const h = height ?? estimateAptHeight(area, seed);
    return finalize(aptClass(h), h, area, metrics, building, seed);
  }
  if (area > 280) {
    // Mix of low apartments and larger houses based on seed
    if (seed % 5 === 0) {
      return finalize("commercial", height ?? estimateCommercialHeight(area, seed), area, metrics, building, seed);
    }
    const h = height ?? estimateAptHeight(area, seed);
    return finalize(aptClass(h), h, area, metrics, building, seed);
  }
  if (aspect > 1.8) {
    return finalize("row", height ?? 8 + (seed % 3), area, metrics, building, seed);
  }
  return finalize("house", height ?? 7.2 + (seed % 6) * 0.45, area, metrics, building, seed);
}

function aptClass(h) {
  if (h >= 30) return "apartment_high";
  if (h >= 16) return "apartment_mid";
  return "apartment_low";
}

function estimateAptHeight(area, seed = 0) {
  const jitter = ((seed % 7) - 3) * 1.2;
  if (area > 900) return Math.max(22, 28 + jitter);
  if (area > 550) return Math.max(16, 22 + jitter);
  if (area > 400) return Math.max(12, 16 + jitter);
  return Math.max(10, 12 + jitter * 0.8);
}

function estimateCommercialHeight(area, seed = 0) {
  const jitter = (seed % 5) * 1.1;
  if (area > 600) return 14 + jitter;
  return 8 + jitter;
}

function finalize(cls, height, area, metrics, building, seed) {
  const options = ASSET_BY_CLASS[cls] || ASSET_BY_CLASS.house;
  const pick = options[seed % options.length];
  const h = Math.max(4.5, Math.min(90, height ?? metrics.heightM ?? 8));
  const floors = Math.max(1, Math.round(h / 3.1));
  const height_source =
    building.height_source ||
    (building.heightM != null && !isDefaultHeight(building.heightM) ? "OSM_HEIGHT" : "DEFAULT_ESTIMATE");
  return {
    class: cls,
    assetId: pick,
    heightM: h,
    height_source,
    floors,
    paletteSeed: seed,
    useGlb: true,
    footprintSource: building.source || "osm",
    tier: tierFor(cls, h, area, seed),
  };
}

/** Visual hierarchy tier: 1=landmark · 2=major · 3=house · 4=distant LOD */
function tierFor(cls, h, area, seed) {
  if (cls === "apartment_high" || (cls === "commercial" && area > 500)) return 1;
  if (cls === "apartment_mid" || cls === "commercial" || cls === "warehouse") return 2;
  if (cls === "house" || cls === "row" || cls === "apartment_low") return 3;
  return seed % 3 === 0 ? 2 : 3;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

export { ASSET_BY_CLASS };
