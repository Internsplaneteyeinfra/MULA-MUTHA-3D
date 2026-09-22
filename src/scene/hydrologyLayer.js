/**
 * Hydrology thematic overlays for MULA-MUTHA-3D.
 * Ground overlays (geology, bank_erosion) + Salinity polygons.
 * Land Use / WQ / Pollution / AQI are config-only unavailable — no fake data.
 *
 * Self-contained under /data/hydrology — no runtime dependency on Shweta_River-2.0.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { lonLatToLocal, localToLonLat } from "../geo/geoReference.js";
import { parseClassedPolygonKml } from "../geo/kml.js";
import { overlayBoxToLocalBounds } from "../utils/floodGeometry.js";
import { terrainHeightAt } from "./terrain.js";
import { SURFACE_Y } from "./river.js";
import { createPollutionGarbageLayer } from "./pollutionGarbageLayer.js";
/** Bundled asset — Vite always serves this (public/data new files can 404 as HTML). */
import bankErosionOverlayUrl from "../assets/hydrology/bank_erosion_overlay.png";
import bankErosionLegendUrl from "../assets/hydrology/bank_erosion_legend.png";
/** Chlorophyll-a polygons — exact copy of src/data/NDCI.kml */
import ndciKmlUrl from "../assets/hydrology/NDCI.kml?url";
/** Salinity ground overlay — exact extract of src/data/salinity.kmz */
import salinityOverlayUrl from "../assets/hydrology/salinity_overlay.png";
import salinityLegendUrl from "../assets/hydrology/salinity_legend.png";
/** TSS ground overlay — exact extract of src/data/TSS.kmz */
import tssOverlayUrl from "../assets/hydrology/tss_overlay.png";
import tssLegendUrl from "../assets/hydrology/tss_legend.png";
import { LITHOLOGY_CLASSES } from "../ui/components/geologyWorkspace.js";
import {
  createBankErosionMaterial,
  updateBankErosionMaterial,
} from "./hydrology/bankErosionMaterial.js";
import {
  classRepresentativeValue,
  formatWqValue,
  WQ_LAYER_SCHEMES,
  CHLOROPHYLL_CLASSES,
  SALINITY_CLASSES,
  TSS_CLASSES,
} from "../geo/waterQualityClasses.js";

const CONFIG_URL = "/data/hydrology/hydrologyConfig.json";
const CONFIG_VERSION = 24;

const POLYGON_LAYER_IDS = new Set([
  "water_quality_ndwi",
  "water_quality_wst",
  "water_quality_ndci",
  "landuse_lulc",
]);

const DRAPED_CLASS_LAYER_IDS = new Set([
  "geology",
  "bank_erosion",
  "vegetation_extent",
  "vegetation_health",
  "salinity",
  "water_quality_tss",
]);

const VEGETATION_EXTENT_CLASSES = [
  { id: "non_vegetation", label: "Non-Vegetation", color: "#A9A9A9" },
  { id: "trees", label: "Trees", color: "#228B22" },
  { id: "shrub", label: "Shrub / Scrub", color: "#9ACD32" },
  { id: "grass", label: "Grass / Herbaceous", color: "#90EE90" },
  { id: "mixed", label: "Mixed / Diverse", color: "#8A2BE2" },
];

const LULC_LEGEND = [
  { label: "Forest", color: "#006400" },
  { label: "Crop Land", color: "#E6A23C" },
  { label: "Barren Land", color: "#A9A9A9" },
  { label: "Water Bodies", color: "#2196F3" },
  { label: "Settlements", color: "#C62828" },
];

/** 2021–2025 KMZ raster class codes (baked into overlay PNG). */
const LULC_CLASSES = [
  { id: "class_0", kmlClass: "Class 0", label: "Forest", color: "#006400" },
  { id: "class_1", kmlClass: "Class 1", label: "Crop Land", color: "#E6A23C" },
  { id: "class_2", kmlClass: "Class 2", label: "Barren Land", color: "#A9A9A9" },
  { id: "class_3", kmlClass: "Class 3", label: "Water Bodies", color: "#2196F3" },
  { id: "class_4", kmlClass: "Class 4", label: "Settlements", color: "#C62828" },
];

/**
 * 2026 vector KML uses a different Class index → meaning than the KMZ rasters.
 * Native KML colors: 0 blue, 1 red, 2 green, 3 gold, 4 brown.
 * Reference: green = forest / class 2, red = settlements.
 */
const LULC_CLASSES_2026 = [
  { id: "class_0", kmlClass: "Class 0", label: "Water Bodies", color: "#2196F3" },
  { id: "class_1", kmlClass: "Class 1", label: "Settlements", color: "#C62828" },
  { id: "class_2", kmlClass: "Class 2", label: "Forest", color: "#006400" },
  { id: "class_3", kmlClass: "Class 3", label: "Crop Land", color: "#E6A23C" },
  { id: "class_4", kmlClass: "Class 4", label: "Barren Land", color: "#A9A9A9" },
];

const LULC_YEARS = [
  {
    year: 2021,
    type: "groundOverlay",
    overlay: "/data/hydrology/lulc/2021/overlay.png",
    bounds: {
      north: 18.56235850242967,
      south: 18.509203857291638,
      east: 73.9963853971848,
      west: 73.84988078051396,
    },
  },
  {
    year: 2022,
    type: "groundOverlay",
    overlay: "/data/hydrology/lulc/2022/overlay.png",
    bounds: {
      north: 18.56235850242967,
      south: 18.509203857291638,
      east: 73.9963853971848,
      west: 73.84988078051396,
    },
  },
  {
    year: 2023,
    type: "groundOverlay",
    overlay: "/data/hydrology/lulc/2023/overlay.png",
    bounds: {
      north: 18.56235850242967,
      south: 18.509203857291638,
      east: 73.9963853971848,
      west: 73.84988078051396,
    },
  },
  {
    year: 2024,
    type: "groundOverlay",
    overlay: "/data/hydrology/lulc/2024/overlay.png",
    bounds: {
      north: 18.56235850242967,
      south: 18.509203857291638,
      east: 73.9963853971848,
      west: 73.84988078051396,
    },
  },
  {
    year: 2025,
    type: "groundOverlay",
    overlay: "/data/hydrology/lulc/2025/overlay.png",
    bounds: {
      north: 18.56235850242967,
      south: 18.509203857291638,
      east: 73.9963853971848,
      west: 73.84988078051396,
    },
  },
  {
    year: 2026,
    type: "groundOverlay",
    overlay: "/data/hydrology/lulc/2026/overlay.png",
    bounds: {
      north: 18.5616160663,
      south: 18.5098917794,
      east: 73.9961284727,
      west: 73.8501433362,
    },
  },
];

const SILT_CLASS_BOUNDS = {
  north: 18.5473360082,
  south: 18.5207458757,
  east: 73.9935113007,
  west: 73.8549012524,
};

const SILT_CLASS_CLASSES = [
  { id: "low", label: "Low", color: "#2ECC71" },
  { id: "moderate", label: "Moderate", color: "#A8E010" },
  { id: "high", label: "High", color: "#F39C12" },
  { id: "very_high", label: "Very High", color: "#E74C3C" },
];

const SILT_CLASS_PERIODS = [
  { id: "2026-01", label: "Jan", year: 2026, month: 1, overlay: "/data/hydrology/silt/classification/2026-01/overlay.png", legend: "/data/hydrology/silt/classification/2026-01/legend.png" },
  { id: "2026-02", label: "Feb", year: 2026, month: 2, overlay: "/data/hydrology/silt/classification/2026-02/overlay.png", legend: "/data/hydrology/silt/classification/2026-02/legend.png" },
  { id: "2026-03", label: "Mar", year: 2026, month: 3, overlay: "/data/hydrology/silt/classification/2026-03/overlay.png", legend: "/data/hydrology/silt/classification/2026-03/legend.png" },
  { id: "2026-04", label: "Apr", year: 2026, month: 4, overlay: "/data/hydrology/silt/classification/2026-04/overlay.png", legend: "/data/hydrology/silt/classification/2026-04/legend.png" },
  { id: "2026-05", label: "May", year: 2026, month: 5, overlay: "/data/hydrology/silt/classification/2026-05/overlay.png", legend: "/data/hydrology/silt/classification/2026-05/legend.png" },
  { id: "2026-06", label: "Jun", year: 2026, month: 6, overlay: "/data/hydrology/silt/classification/2026-06/overlay.png", legend: "/data/hydrology/silt/classification/2026-06/legend.png" },
  { id: "2026-07", label: "Jul", year: 2026, month: 7, overlay: "/data/hydrology/silt/classification/2026-07/overlay.png", legend: "/data/hydrology/silt/classification/2026-07/legend.png" },
];

/** Continuous silt volume surface (YlOrBr, fixed 0–94.31 scale). Same LatLonBox as classification. */
const SILT_VOLUME_BOUNDS = { ...SILT_CLASS_BOUNDS };

/** Continuous silt volume ramp (YlOrBr). `value` is the scale endpoint for hover sampling. */
const SILT_VOLUME_MAX = 94.31;
const SILT_VOLUME_CLASSES = [
  { id: "v0", label: "0", color: "#FFFFD4", value: 0, range: "low" },
  { id: "v25", label: "~24", color: "#FED98E", value: SILT_VOLUME_MAX * 0.25, range: "" },
  { id: "v50", label: "~47", color: "#FE9929", value: SILT_VOLUME_MAX * 0.5, range: "" },
  { id: "v75", label: "~71", color: "#D95F0E", value: SILT_VOLUME_MAX * 0.75, range: "" },
  { id: "v100", label: "94.3", color: "#993404", value: SILT_VOLUME_MAX, range: "high" },
];

const SILT_VOLUME_PERIODS = [
  { id: "2026-01", label: "Jan", year: 2026, month: 1, overlay: "/data/hydrology/silt/volume/2026-01/overlay.png", legend: "/data/hydrology/silt/volume/2026-01/legend.png" },
  { id: "2026-02", label: "Feb", year: 2026, month: 2, overlay: "/data/hydrology/silt/volume/2026-02/overlay.png", legend: "/data/hydrology/silt/volume/2026-02/legend.png" },
  { id: "2026-03", label: "Mar", year: 2026, month: 3, overlay: "/data/hydrology/silt/volume/2026-03/overlay.png", legend: "/data/hydrology/silt/volume/2026-03/legend.png" },
  { id: "2026-04", label: "Apr", year: 2026, month: 4, overlay: "/data/hydrology/silt/volume/2026-04/overlay.png", legend: "/data/hydrology/silt/volume/2026-04/legend.png" },
  { id: "2026-05", label: "May", year: 2026, month: 5, overlay: "/data/hydrology/silt/volume/2026-05/overlay.png", legend: "/data/hydrology/silt/volume/2026-05/legend.png" },
  { id: "2026-06", label: "Jun", year: 2026, month: 6, overlay: "/data/hydrology/silt/volume/2026-06/overlay.png", legend: "/data/hydrology/silt/volume/2026-06/legend.png" },
  { id: "2026-07", label: "Jul", year: 2026, month: 7, overlay: "/data/hydrology/silt/volume/2026-07/overlay.png", legend: "/data/hydrology/silt/volume/2026-07/legend.png" },
];

/** Hardcoded fallbacks so Bank Erosion / Silt / Chlorophyll work even if an old config is cached. */
const BUILTIN_LAYER_DEFS = {
  water_quality_ndci: {
    id: "water_quality_ndci",
    name: "Chlorophyll-a",
    available: true,
    type: "kmlPolygons",
    crs: "EPSG:4326",
    data: ndciKmlUrl,
    source: "src/data/NDCI.kml",
    opacity: 0.88,
    liftM: 0.65,
    legendTitle: "Chlorophyll-a",
    legendSubtitle: "2 classes · µg/L · src/data/NDCI.kml",
    unit: "µg/L",
    classes: CHLOROPHYLL_CLASSES,
    renderType: "terrainDrapedPolygonsMergedByClass",
  },
  salinity: {
    id: "salinity",
    name: "SALINITY",
    available: true,
    type: "groundOverlay",
    crs: "EPSG:4326",
    bounds: {
      north: 18.5621806682,
      south: 18.509269898,
      east: 73.9940952056,
      west: 73.8527902114,
    },
    overlay: salinityOverlayUrl,
    legend: salinityLegendUrl,
    meta: "/data/hydrology/water_quality/salinity/meta.json",
    source: "src/data/salinity.kmz",
    opacity: 1,
    gridSegments: 128,
    liftM: 0.55,
    flipU: false,
    flipV: true,
    legendTitle: "Salinity",
    legendSubtitle: "5 classes · ppt · src/data/salinity.kmz",
    unit: "ppt",
    classes: SALINITY_CLASSES,
    legendClasses: SALINITY_CLASSES,
    renderType: "terrainDrapedTexture",
  },
  water_quality_tss: {
    id: "water_quality_tss",
    name: "TSS",
    available: true,
    type: "groundOverlay",
    crs: "EPSG:4326",
    bounds: {
      north: 18.548421173,
      south: 18.5193301309,
      east: 73.9941221551,
      west: 73.853726256,
    },
    overlay: tssOverlayUrl,
    legend: tssLegendUrl,
    meta: "/data/hydrology/water_quality/tss/meta.json",
    source: "src/data/TSS.kmz",
    opacity: 1,
    gridSegments: 128,
    liftM: 0.55,
    flipU: false,
    flipV: true,
    legendTitle: "TSS",
    legendSubtitle: "3 classes · mg/L · src/data/TSS.kmz",
    unit: "mg/L",
    classes: TSS_CLASSES,
    legendClasses: TSS_CLASSES,
    renderType: "terrainDrapedTexture",
  },
  bank_erosion: {
    id: "bank_erosion",
    name: "BANK EROSION HOTSPOTS",
    available: true,
    type: "groundOverlay",
    crs: "EPSG:4326",
    bounds: {
      north: 18.54742583968735,
      south: 18.520745875749,
      east: 73.9935113006977,
      west: 73.85472158930123,
    },
    overlay: bankErosionOverlayUrl,
    legend: bankErosionLegendUrl,
    meta: "/data/hydrology/bank_erosion/meta.json",
    source: "Smoth kmls/bank_erosion_hotspot_smoothed.kmz",
    opacity: 1,
    gridSegments: 144,
    liftM: 1.6,
    flipU: false,
    flipV: true,
    renderType: "terrainDrapedTexture",
    legendTitle: "Bank erosion hotspots",
    legendSubtitle: "2016–2026 smoothed continuous overlay.",
    legendClasses: [
      { id: "none", label: "No erosion", color: "#90EE90", pct: "83.1%" },
      { id: "low", label: "Low erosion", color: "#FFFF00", pct: "15.5%" },
      { id: "moderate", label: "Moderate erosion", color: "#FFA500", pct: "1.4%" },
      { id: "high", label: "High erosion", color: "#FF0000", pct: "0%" },
      { id: "very_high", label: "Very high erosion", color: "#8B0000", pct: "0%" },
    ],
  },
  silt_classification: {
    id: "silt_classification",
    name: "SILT CLASSIFICATION",
    available: true,
    type: "siltClassificationPeriods",
    crs: "EPSG:4326",
    defaultPeriod: "2026-07",
    opacity: 1,
    liftM: 1.4,
    gridSegments: 128,
    legendTitle: "Silt Classification",
    legendSubtitle: "Discrete silt classes · Jan–Jul 2026 KMZ",
    source: "src/data/Jan_2026_to_Jun_2026_Silt_Classification",
    bounds: SILT_CLASS_BOUNDS,
    classes: SILT_CLASS_CLASSES,
    periods: SILT_CLASS_PERIODS,
    renderType: "terrainDrapedSiltClassification",
  },
  silt_volume_surface: {
    id: "silt_volume_surface",
    name: "SILT VOLUME SURFACE",
    available: true,
    type: "siltVolumePeriods",
    crs: "EPSG:4326",
    defaultPeriod: "2026-07",
    opacity: 1,
    liftM: 1.5,
    gridSegments: 128,
    legendTitle: "Silt Volume Surface",
    legendSubtitle: "Volume surface · fixed 0–94.31 · Jan–Jul 2026 KMZ",
    source: "src/data/Jan_2026_to_Jun_2026_Silt_Classification",
    bounds: SILT_VOLUME_BOUNDS,
    classes: SILT_VOLUME_CLASSES,
    periods: SILT_VOLUME_PERIODS,
    renderType: "terrainDrapedSiltVolume",
  },
  vegetation_extent: {
    id: "vegetation_extent",
    name: "VEGETATION TYPE",
    available: true,
    type: "groundOverlay",
    crs: "EPSG:4326",
    bounds: {
      north: 18.56563988,
      south: 18.50179885,
      east: 74.01249107,
      west: 73.83580284,
    },
    overlay: "/data/hydrology/vegetation/vegetation_type_overlay.png?v=18",
    meta: "/data/hydrology/vegetation/vegetation_type_meta.json",
    source: "src/data/vegetation_type.kml",
    opacity: 0.82,
    gridSegments: 128,
    liftM: 1.1,
    flipU: false,
    flipV: true,
    renderType: "terrainDrapedTexture",
    legendTitle: "Vegetation Type",
    legendSubtitle: "Study-area vegetation type overlay",
    legendClasses: VEGETATION_EXTENT_CLASSES,
  },
  vegetation_health: {
    id: "vegetation_health",
    name: "VEGETATION HEALTH",
    available: true,
    type: "groundOverlay",
    crs: "EPSG:4326",
    bounds: {
      north: 18.56563988,
      south: 18.50179885,
      east: 74.01249107,
      west: 73.83580284,
    },
    overlay: "/data/hydrology/vegetation/vegetation_health_overlay.png?v=18",
    meta: "/data/hydrology/vegetation/vegetation_health_meta.json",
    source: "src/data/vegetation_health.kml",
    opacity: 0.82,
    gridSegments: 128,
    liftM: 1.15,
    flipU: false,
    flipV: true,
    renderType: "terrainDrapedTexture",
    legendTitle: "Vegetation Health",
    legendSubtitle: "Study-area vegetation health overlay",
    legendClasses: [
      { id: "poor", label: "Stressed / Poor", color: "#C62828" },
      { id: "moderate", label: "Moderate", color: "#F9A825" },
      { id: "good", label: "Healthy", color: "#2E7D32" },
      { id: "dense", label: "Dense canopy", color: "#1B5E20" },
    ],
  },
};

const CLASS_COLOR = {
  Low: "#2ECC71",
  Moderate: "#F39C12",
  High: "#E74C3C",
  "Very Low": "#0000FF",
  "Very High": "#FF0000",
  "Very Low Salinity": "#0000FF",
  "Low Salinity": "#00BFFF",
  "Moderate Salinity": "#00FF00",
  "High Salinity": "#FFFF00",
  "Very High Salinity": "#FF0000",
};

/**
 * @param {object} dataset
 */
export function createHydrologyLayer(dataset) {
  const group = new THREE.Group();
  group.name = "hydrology";
  group.visible = false;

  const stations = dataset?.corridor?.stations || [];
  /** @type {object|null} */
  let config = null;
  /** @type {string|null} */
  let activeId = null;
  /** Bumps on every show/hide so a slow load cannot overwrite a newer selection. */
  let showSeq = 0;
  /** Last UI-requested layer id (survives showSeq races for draped overlays). */
  let pendingShowId = null;

  const drapedOverlays = {
    geology: { mesh: null, loaded: false, loading: null, sampler: null },
    bank_erosion: { mesh: null, loaded: false, loading: null, sampler: null },
    landuse_lulc: { mesh: null, loaded: false, loading: null, sampler: null },
    silt_classification: { mesh: null, loaded: false, loading: null, sampler: null },
    silt_volume_surface: { mesh: null, loaded: false, loading: null, sampler: null },
    salinity: { mesh: null, loaded: false, loading: null, sampler: null },
    water_quality_tss: { mesh: null, loaded: false, loading: null, sampler: null },
  };
  /** @deprecated alias — keep older references working during loadGeology */
  const geology = drapedOverlays.geology;
  /** Active LULC year (2021–2026). */
  let lulcYear = 2026;
  /** Active silt classification period id (YYYY-MM). Default = most recent. */
  let siltClassPeriod = SILT_CLASS_PERIODS[SILT_CLASS_PERIODS.length - 1].id;
  let siltVolumePeriod = SILT_VOLUME_PERIODS[SILT_VOLUME_PERIODS.length - 1].id;
  /** Detected garbage pins (pollution layer). */
  const pollutionGarbage = createPollutionGarbageLayer({ stations });
  group.add(pollutionGarbage);
  /** Classed polygon layers (salinity + water-quality metrics). */
  const polygonLayers = Object.create(null);

  function polygonSlot(id) {
    if (!polygonLayers[id]) {
      polygonLayers[id] = {
        root: null,
        loaded: false,
        loading: null,
        featureIndex: [],
        meshes: [],
      };
    }
    return polygonLayers[id];
  }
  /** @deprecated alias for pick / validate helpers */
  const salinity = drapedOverlays.salinity;

  function mergeBuiltinLayers(cfg) {
    if (!cfg || !Array.isArray(cfg.layers)) {
      return { version: CONFIG_VERSION, layers: Object.values(BUILTIN_LAYER_DEFS) };
    }
    const byId = new Map(cfg.layers.map((l) => [l.id, l]));
    for (const [id, def] of Object.entries(BUILTIN_LAYER_DEFS)) {
      // Always prefer bundled overlay URLs for bank_erosion (public/data may 404 as HTML)
      byId.set(id, { ...(byId.get(id) || {}), ...def });
    }
    return { ...cfg, layers: [...byId.values()] };
  }

  async function ensureConfig() {
    if (config) return config;
    const url = `${CONFIG_URL}?v=${CONFIG_VERSION}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000), cache: "no-store" });
    if (!res.ok) throw new Error(`Hydrology config unavailable (${res.status})`);
    config = mergeBuiltinLayers(await res.json());
    return config;
  }

  function layerDef(id) {
    const fromConfig = config?.layers?.find((l) => l.id === id);
    const builtin = BUILTIN_LAYER_DEFS[id];
    let def = fromConfig && builtin ? { ...fromConfig, ...builtin } : fromConfig || builtin || null;
    const scheme = WQ_LAYER_SCHEMES[id];
    if (def && scheme) {
      def = {
        ...def,
        classes: scheme.classes,
        unit: scheme.unit,
        legendTitle: scheme.title,
        legendSubtitle: scheme.subtitle,
      };
    }
    return def;
  }

  function clearActiveMeshes() {
    for (const slot of Object.values(drapedOverlays)) {
      if (slot.mesh) slot.mesh.visible = false;
    }
    for (const slot of Object.values(polygonLayers)) {
      if (slot.root) slot.root.visible = false;
    }
    pollutionGarbage.userData?.setVisible?.(false);
  }

  function disposeObject(obj) {
    if (!obj) return;
    obj.traverse?.((child) => {
      child.geometry?.dispose?.();
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of mats) {
          m.map?.dispose?.();
          m.dispose?.();
        }
      }
    });
  }

  /**
   * Terrain-draped GroundOverlay (LatLonBox → subdivided grid).
   * Used for geology + bank_erosion KMZ extracts — accurate lon/lat placement.
   */
  async function loadDrapedOverlay(def) {
    const id = def.id;
    if (!drapedOverlays[id]) {
      drapedOverlays[id] = { mesh: null, loaded: false, loading: null, sampler: null };
    }
    const slot = drapedOverlays[id];
    if (!slot) throw new Error(`No draped overlay slot for ${id}`);

    const GEO_UV_VERSION = CONFIG_VERSION;
    // Wait out in-flight loads so year/period switches don't keep the previous overlay.
    while (slot.loading) {
      await slot.loading.catch(() => {});
    }

    if (
      slot.loaded &&
      (slot.mesh?.userData?.geoUvVersion !== GEO_UV_VERSION ||
        slot.mesh?.userData?.overlayUrl !== def.overlay)
    ) {
      group.remove(slot.mesh);
      disposeObject(slot.mesh);
      slot.mesh = null;
      slot.loaded = false;
      slot.sampler = null;
    }
    // Force silt samplers to rebuild when overlay URL is unchanged but
    // sampler code / PNG content changed (same public path).
    if (
      slot.loaded &&
      (id === "silt_classification" || id === "silt_volume_surface") &&
      slot.sampler?.kind !== id
    ) {
      slot.sampler = null;
    }
    if (slot.loaded) {
      if (id === "bank_erosion" && !slot.sampler) {
        slot.sampler = await createBankErosionSampler(def).catch(() => null);
      }
      if (id === "geology" && !slot.sampler) {
        slot.sampler = await createGeologySampler(def).catch(() => null);
      }
      if (
        (id === "landuse_lulc" ||
          id === "silt_classification" ||
          id === "silt_volume_surface" ||
          id === "salinity" ||
          id === "water_quality_tss") &&
        !slot.sampler
      ) {
        slot.sampler = await createLandUseSampler(def, id).catch((err) => {
          console.warn(`[${id}] hover sampler unavailable`, err);
          return null;
        });
      }
      return;
    }
    if (slot.loading) return slot.loading;

    slot.loading = (async () => {
      const box = def.bounds;
      const west = Number(box.west);
      const east = Number(box.east);
      const north = Number(box.north);
      const south = Number(box.south);
      if (![west, east, north, south].every(Number.isFinite) || east === west || north === south) {
        throw new Error(`${id} LatLonBox bounds are invalid`);
      }

      const bounds = overlayBoxToLocalBounds(box);
      const lift = Number(def.liftM) || 0.35;
      const opacity = Number(def.opacity) ?? 0.78;

      const mesh = await buildDrapedGridMesh({
        id,
        def: {
          ...def,
          flipU: false,
          flipV: true,
          gridSegments:
            id === "bank_erosion"
              ? Math.max(112, Number(def.gridSegments) || 144)
              : id === "landuse_lulc" ||
                  id === "silt_classification" ||
                  id === "silt_volume_surface" ||
                  id === "salinity" ||
                  id === "water_quality_tss"
                ? Math.max(96, Number(def.gridSegments) || 112)
                : def.gridSegments,
        },
        bounds,
        west,
        east,
        north,
        south,
        stations,
        lift: id === "bank_erosion" ? Math.max(lift, 1.2) : lift,
        opacity:
          id === "bank_erosion" || id === "salinity" || id === "water_quality_tss" ? 1 : opacity,
        version: GEO_UV_VERSION,
        // Classification: nearest keeps only legend class colors.
        // Volume / continuous salinity/TSS ramp: linear softens.
        nearest: id === "landuse_lulc" || id === "silt_classification",
        highContrast:
          id === "bank_erosion" ||
          id === "landuse_lulc" ||
          id === "silt_classification" ||
          id === "silt_volume_surface" ||
          id === "salinity" ||
          id === "water_quality_tss",
        animateBankErosion: id === "bank_erosion",
      });

      group.add(mesh);
      slot.mesh = mesh;
      slot.loaded = true;
      if (id === "bank_erosion") {
        try {
          slot.sampler = await createBankErosionSampler(def);
        } catch (err) {
          console.warn("[bank_erosion] hover sampler unavailable", err);
          slot.sampler = null;
        }
      }
      if (id === "geology") {
        try {
          slot.sampler = await createGeologySampler(def);
        } catch (err) {
          console.warn("[geology] click sampler unavailable", err);
          slot.sampler = null;
        }
      }
      if (
        id === "landuse_lulc" ||
        id === "silt_classification" ||
        id === "silt_volume_surface" ||
        id === "salinity" ||
        id === "water_quality_tss"
      ) {
        try {
          slot.sampler = await createLandUseSampler(def, id);
        } catch (err) {
          console.warn(`[${id}] hover sampler unavailable`, err);
          slot.sampler = null;
        }
      }
    })()
      .catch((err) => {
        throw err;
      })
      .finally(() => {
        slot.loading = null;
      });

    return slot.loading;
  }

  /** @deprecated use loadDrapedOverlay */
  async function loadGeology(def) {
    return loadDrapedOverlay(def);
  }

  /**
   * Classed polygons (GeoJSON or KML) → terrain-draped meshes merged by class.
   * Used for salinity + TSS / NDWI / NDCI / WST water-quality KMLs.
   */
  async function loadClassedPolygons(def) {
    const id = def.id;
    const slot = polygonSlot(id);
    const schemaKey = JSON.stringify(
      (def.classes || []).map((c) => [c.kmlClass || c.id, c.label, c.color, c.range]),
    );
    if (slot.loaded && slot.schemaKey !== schemaKey) {
      if (slot.root) {
        group.remove(slot.root);
        disposeObject(slot.root);
      }
      slot.root = null;
      slot.meshes = [];
      slot.featureIndex = [];
      slot.loaded = false;
      slot.loading = null;
    }
    if (slot.loaded) return;
    if (slot.loading) return slot.loading;

    slot.loading = (async () => {
      const dataUrl = String(def.data || "");
      if (!dataUrl) throw new Error(`${id} has no data URL`);

      const lift = Number(def.liftM) || 0.35;
      const opacity = Number(def.opacity) ?? 0.65;
      const isKml = /\.kml(\?|$)/i.test(dataUrl);

      /** @type {{ class_label:string, class?:string, range?:string|null, name?:string|null, description?:string|null, color?:string|null, coordinates?:{lon:number,lat:number}[], geometry?:object }[]} */
      let rawFeatures = [];

      if (isKml) {
        const fetchUrl = dataUrl.includes("?")
          ? dataUrl
          : `${dataUrl}?v=${CONFIG_VERSION}`;
        const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(90000), cache: "no-store" });
        if (!res.ok) throw new Error(`${id} KML unavailable (${res.status})`);
        const text = await res.text();
        if (/^\s*<!DOCTYPE html/i.test(text) || /^\s*<html/i.test(text)) {
          throw new Error(`${id} KML URL returned HTML — check public/data path`);
        }
        rawFeatures = parseClassedPolygonKml(text);
        if (!rawFeatures.length) {
          throw new Error(`${id}: no polygons parsed from ${dataUrl}`);
        }
      } else {
        const res = await fetch(dataUrl, { signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw new Error(`${id} data unavailable (${res.status})`);
        const gj = await res.json();
        rawFeatures = (gj.features || []).map((f, fi) => {
          const props = f.properties || {};
          return {
            id: fi,
            class_label: props.class_label || stripRange(props.class) || "Unknown",
            class: props.class || props.class_label || null,
            range: props.range || null,
            name: props.name || null,
            description: props.description || null,
            color: normalizeHex(props.color),
            geometry: f.geometry,
          };
        });
      }

      const buckets = new Map();
      for (const c of def.classes || []) {
        buckets.set(c.label, {
          geos: [],
          color: c.color,
          label: c.label,
          range: c.range || null,
        });
      }

      const featureIndex = [];
      for (let fi = 0; fi < rawFeatures.length; fi++) {
        const f = rawFeatures[fi];
        const meta = resolveClassMeta(def, f.class_label || "Unknown", f);
        const label = meta.label;
        const color = meta.color;
        if (!buckets.has(label)) {
          buckets.set(label, {
            geos: [],
            color,
            label,
            range: meta.range || null,
          });
        } else if (meta.color && buckets.get(label).color !== meta.color) {
          buckets.get(label).color = meta.color;
        }
        if (meta.range && !buckets.get(label).range) {
          buckets.get(label).range = meta.range;
        }
        const verts = f.coordinates?.length
          ? lonLatRingToLocalVerts(f.coordinates)
          : ringToLocalVerts(f.geometry);
        if (!verts || verts.length < 3) continue;
        const geo = polygonToTerrainGeometry(verts, stations, lift);
        if (!geo) continue;
        buckets.get(label).geos.push(geo);

        let cx = 0;
        let cz = 0;
        for (const v of verts) {
          cx += v.x;
          cz += v.z;
        }
        cx /= verts.length;
        cz /= verts.length;
        featureIndex.push({
          id: fi,
          class_label: label,
          class: label,
          sourceClass: f.class_label || null,
          range: meta.range || buckets.get(label).range || null,
          unit: meta.unit || def.unit || null,
          value: meta.value ?? null,
          valueText: meta.valueText || null,
          metric: meta.metric || def.legendTitle || def.name || null,
          name: f.name || null,
          description: f.description || null,
          color: buckets.get(label).color || color,
          x: cx,
          z: cz,
          vertices: verts,
          hydrology: id,
        });
      }

      const root = new THREE.Group();
      root.name = `hydrology_${id}`;
      root.visible = false;
      const meshes = [];

      for (const [, bucket] of buckets) {
        if (!bucket.geos.length) continue;
        const merged = mergeGeometries(bucket.geos, false);
        bucket.geos.forEach((g) => g.dispose());
        if (!merged) continue;
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(bucket.color),
          transparent: true,
          opacity: Math.min(1, Math.max(0.55, opacity)),
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          toneMapped: false,
        });
        const mesh = new THREE.Mesh(merged, mat);
        mesh.name = `${id}_${bucket.label.replace(/\s+/g, "_")}`;
        mesh.renderOrder = id === "water_quality_ndci" || id === "water_quality_tss" || id === "salinity" ? 46 : 5;
        mesh.frustumCulled = false;
        mesh.userData.hydrology = id;
        mesh.userData.class_label = bucket.label;
        mesh.userData.range = bucket.range;
        mesh.userData.color = bucket.color;
        root.add(mesh);
        meshes.push(mesh);
      }

      if (!meshes.length) {
        throw new Error(`${id}: no polygon meshes built from ${dataUrl}`);
      }

      group.add(root);
      slot.root = root;
      slot.meshes = meshes;
      slot.featureIndex = featureIndex;
      slot.schemaKey = schemaKey;
      slot.loaded = true;
      slot.loading = null;
      root.userData.featureIndex = featureIndex;
      root.userData.meshCount = meshes.length;
      root.userData.featureCount = featureIndex.length;
    })().catch((err) => {
      slot.loading = null;
      throw err;
    });

    return slot.loading;
  }

  /** @deprecated use loadClassedPolygons */
  async function loadSalinity(def) {
    return loadClassedPolygons(def);
  }

  function getLulcYears(def) {
    const fromDef = Array.isArray(def?.years) && def.years.length ? def.years : null;
    return fromDef || LULC_YEARS;
  }

  function resolveLulcYearEntry(def, year) {
    const years = getLulcYears(def);
    const y = Number(year);
    return years.find((e) => Number(e.year) === y) || years[years.length - 1] || null;
  }

  function buildLulcLegend(def, year) {
    const classes = (def.legendClasses?.length ? def.legendClasses : LULC_LEGEND).map((c) => ({
      label: c.label,
      color: c.color,
      range: c.range,
    }));
    return {
      type: "classes",
      title: def.legendTitle || def.name || "LULC",
      subtitle: `${year} · ${def.legendSubtitle || "Mula–Mutha land cover"}`,
      classes,
      years: getLulcYears(def).map((e) => Number(e.year)),
      activeYear: year,
      layerId: "landuse_lulc",
    };
  }

  async function showLulcLayer(def, expectedSeq = null, opts = {}) {
    const years = getLulcYears(def);
    if (!years.length) {
      return {
        ok: false,
        id: "landuse_lulc",
        available: false,
        message: "No LULC years configured",
      };
    }
    // Open on configured default (or most recent) unless caller is switching years
    if (!opts.keepSelection) {
      const preferred = Number(def.defaultYear);
      const preferredEntry = Number.isFinite(preferred)
        ? years.find((e) => Number(e.year) === preferred)
        : null;
      const latest = years[years.length - 1];
      lulcYear = Number((preferredEntry || latest).year);
    }
    const yearEntry = resolveLulcYearEntry(def, lulcYear) || years[years.length - 1];
    lulcYear = Number(yearEntry.year);
    const yearType = yearEntry.type || (yearEntry.overlay ? "groundOverlay" : "kmlPolygons");

    if (yearType === "groundOverlay") {
      const drapedDef = {
        ...def,
        id: "landuse_lulc",
        type: "groundOverlay",
        overlay: yearEntry.overlay,
        bounds: yearEntry.bounds || def.bounds,
        opacity: Number(def.opacity) || 0.82,
        liftM: Number(def.liftM) || 0.45,
        gridSegments: Number(def.gridSegments) || 112,
        legendClasses: def.legendClasses?.length ? def.legendClasses : LULC_LEGEND,
      };
      await loadDrapedOverlay(drapedDef);
      if (expectedSeq != null && showSeq !== expectedSeq) {
        return { ok: true, id: "landuse_lulc", available: false, superseded: true };
      }
      if (pendingShowId !== "landuse_lulc") {
        return { ok: true, id: "landuse_lulc", available: false, superseded: true };
      }
      const poly = polygonSlot("landuse_lulc");
      if (poly.root) poly.root.visible = false;
      clearActiveMeshes();
      const slot = drapedOverlays.landuse_lulc;
      if (slot?.mesh) {
        slot.mesh.visible = true;
        if (slot.mesh.material) {
          slot.mesh.material.opacity = Math.min(1, Number(drapedDef.opacity) || 0.82);
          slot.mesh.material.needsUpdate = true;
        }
      }
      activeId = "landuse_lulc";
      group.visible = !!slot?.mesh;
      return {
        ok: !!slot?.mesh,
        id: "landuse_lulc",
        available: !!slot?.mesh,
        message: slot?.mesh ? undefined : "Failed to build LULC overlay",
        legend: buildLulcLegend(def, lulcYear),
        stats: { year: lulcYear, type: "groundOverlay", hasMesh: !!slot?.mesh },
      };
    }

    const polyDef = {
      ...def,
      id: "landuse_lulc",
      type: "kmlPolygons",
      data: yearEntry.data,
      // 2026 vector Class N ≠ KMZ raster codes — use vector map
      classes:
        yearEntry.classes?.length
          ? yearEntry.classes
          : Number(yearEntry.year) === 2026
            ? LULC_CLASSES_2026
            : def.classes?.length
              ? def.classes
              : LULC_CLASSES,
      opacity: Number(def.opacity) || 0.7,
      liftM: Number(def.liftM) || 0.4,
    };
    await loadClassedPolygons(polyDef);
    if (expectedSeq != null && showSeq !== expectedSeq) {
      return { ok: true, id: "landuse_lulc", available: false, superseded: true };
    }
    if (pendingShowId !== "landuse_lulc") {
      return { ok: true, id: "landuse_lulc", available: false, superseded: true };
    }
    clearActiveMeshes();
    const slot = polygonSlot("landuse_lulc");
    if (slot.root) slot.root.visible = true;
    activeId = "landuse_lulc";
    group.visible = !!slot.root;
    return {
      ok: !!slot.root && slot.meshes.length > 0,
      id: "landuse_lulc",
      available: !!slot.root && slot.meshes.length > 0,
      legend: buildLulcLegend(def, lulcYear),
      stats: {
        year: lulcYear,
        type: "kmlPolygons",
        features: slot.featureIndex.length,
        meshes: slot.meshes.length,
      },
    };
  }

  async function setLulcYear(year) {
    await ensureConfig();
    const def = layerDef("landuse_lulc");
    if (!def?.available) {
      return { ok: false, id: "landuse_lulc", available: false, message: "LULC unavailable" };
    }
    const entry = resolveLulcYearEntry(def, year);
    if (!entry) {
      return { ok: false, id: "landuse_lulc", available: false, message: `No LULC for ${year}` };
    }
    lulcYear = Number(entry.year);
    pendingShowId = "landuse_lulc";
    const seq = ++showSeq;
    return showLulcLayer(def, seq, { keepSelection: true });
  }

  function getSiltPeriods(def) {
    const fromDef = Array.isArray(def?.periods) && def.periods.length ? def.periods : null;
    return fromDef || SILT_CLASS_PERIODS;
  }

  function resolveSiltPeriodEntry(def, periodId) {
    const periods = getSiltPeriods(def);
    const id = String(periodId || "");
    return periods.find((p) => String(p.id) === id) || periods[periods.length - 1] || null;
  }

  function buildSiltClassLegend(def, period) {
    const classes = (def.classes?.length ? def.classes : SILT_CLASS_CLASSES).map((c) => ({
      label: c.label,
      color: c.color,
      range: c.range,
    }));
    const periods = getSiltPeriods(def);
    return {
      type: "classes",
      title: def.legendTitle || def.name || "Silt Classification",
      subtitle: `${period.label || period.id} ${period.year || ""} · ${def.legendSubtitle || "Discrete silt classes"}`.replace(/\s+/g, " ").trim(),
      classes,
      periods: periods.map((p) => ({
        id: p.id,
        label: p.label || p.id,
        year: p.year,
        month: p.month,
      })),
      activePeriod: period.id,
      layerId: "silt_classification",
    };
  }

  async function showSiltClassificationLayer(def, expectedSeq = null, opts = {}) {
    const periods = getSiltPeriods(def);
    if (!periods.length) {
      return {
        ok: false,
        id: "silt_classification",
        available: false,
        message: "No silt classification periods configured",
      };
    }
    // Always open on most recent period unless switching
    if (!opts.keepSelection) {
      siltClassPeriod = periods[periods.length - 1].id;
    }
    const period = resolveSiltPeriodEntry(def, siltClassPeriod) || periods[periods.length - 1];
    siltClassPeriod = period.id;

    const drapedDef = {
      ...def,
      id: "silt_classification",
      type: "groundOverlay",
      overlay: period.overlay,
      bounds: period.bounds || def.bounds || SILT_CLASS_BOUNDS,
      opacity: Number(def.opacity) || 0.88,
      liftM: Number(def.liftM) || 1.2,
      gridSegments: Number(def.gridSegments) || 128,
      legendClasses: def.classes || def.legendClasses || [],
    };
    await loadDrapedOverlay(drapedDef);
    if (expectedSeq != null && showSeq !== expectedSeq) {
      return { ok: true, id: "silt_classification", available: false, superseded: true };
    }
    if (pendingShowId !== "silt_classification") {
      return { ok: true, id: "silt_classification", available: false, superseded: true };
    }
    clearActiveMeshes();
    const slot = drapedOverlays.silt_classification;
    if (slot?.mesh) {
      slot.mesh.visible = true;
      if (slot.mesh.material) {
        slot.mesh.material.opacity = Math.min(1, Number(drapedDef.opacity) || 0.88);
        slot.mesh.material.needsUpdate = true;
      }
    }
    activeId = "silt_classification";
    group.visible = !!slot?.mesh;
    return {
      ok: !!slot?.mesh,
      id: "silt_classification",
      available: !!slot?.mesh,
      message: slot?.mesh ? undefined : "Failed to build silt classification overlay",
      legend: buildSiltClassLegend(def, period),
      stats: {
        period: period.id,
        type: "groundOverlay",
        hasMesh: !!slot?.mesh,
        bounds: drapedDef.bounds,
      },
    };
  }

  async function setSiltClassificationPeriod(periodId) {
    await ensureConfig();
    const def = layerDef("silt_classification");
    if (!def?.available) {
      return {
        ok: false,
        id: "silt_classification",
        available: false,
        message: "Silt classification unavailable",
      };
    }
    const entry = resolveSiltPeriodEntry(def, periodId);
    if (!entry) {
      return {
        ok: false,
        id: "silt_classification",
        available: false,
        message: `No silt classification for ${periodId}`,
      };
    }
    siltClassPeriod = entry.id;
    pendingShowId = "silt_classification";
    const seq = ++showSeq;
    return showSiltClassificationLayer(def, seq, { keepSelection: true });
  }

  function getSiltVolumePeriods(def) {
    const fromDef = Array.isArray(def?.periods) && def.periods.length ? def.periods : null;
    return fromDef || SILT_VOLUME_PERIODS;
  }

  function resolveSiltVolumePeriodEntry(def, periodId) {
    const periods = getSiltVolumePeriods(def);
    const id = String(periodId || "");
    return periods.find((p) => String(p.id) === id) || periods[periods.length - 1] || null;
  }

  function buildSiltVolumeLegend(def, period) {
    const classes = (def.classes?.length ? def.classes : SILT_VOLUME_CLASSES).map((c) => ({
      label: c.label,
      color: c.color,
      range: c.range,
    }));
    const periods = getSiltVolumePeriods(def);
    return {
      type: "classes",
      title: def.legendTitle || def.name || "Silt Volume Surface",
      subtitle: `${period.label || period.id} ${period.year || ""} · ${def.legendSubtitle || "0–94.31 scale"}`.replace(/\s+/g, " ").trim(),
      classes,
      periods: periods.map((p) => ({
        id: p.id,
        label: p.label || p.id,
        year: p.year,
        month: p.month,
      })),
      activePeriod: period.id,
      layerId: "silt_volume_surface",
      imageUrl: period.legend || null,
    };
  }

  async function showSiltVolumeLayer(def, expectedSeq = null, opts = {}) {
    const periods = getSiltVolumePeriods(def);
    if (!periods.length) {
      return {
        ok: false,
        id: "silt_volume_surface",
        available: false,
        message: "No silt volume periods configured",
      };
    }
    if (!opts.keepSelection) {
      siltVolumePeriod = periods[periods.length - 1].id;
    }
    const period = resolveSiltVolumePeriodEntry(def, siltVolumePeriod) || periods[periods.length - 1];
    siltVolumePeriod = period.id;

    const drapedDef = {
      ...def,
      id: "silt_volume_surface",
      type: "groundOverlay",
      overlay: period.overlay,
      bounds: period.bounds || def.bounds || SILT_VOLUME_BOUNDS,
      opacity: Number(def.opacity) || 1,
      liftM: Number(def.liftM) || 1.5,
      gridSegments: Number(def.gridSegments) || 128,
      legendClasses: def.classes || def.legendClasses || [],
    };
    await loadDrapedOverlay(drapedDef);
    if (expectedSeq != null && showSeq !== expectedSeq) {
      return { ok: true, id: "silt_volume_surface", available: false, superseded: true };
    }
    if (pendingShowId !== "silt_volume_surface") {
      return { ok: true, id: "silt_volume_surface", available: false, superseded: true };
    }
    clearActiveMeshes();
    const slot = drapedOverlays.silt_volume_surface;
    if (slot?.mesh) {
      slot.mesh.visible = true;
      if (slot.mesh.material) {
        slot.mesh.material.opacity = Math.min(1, Number(drapedDef.opacity) || 1);
        slot.mesh.material.needsUpdate = true;
      }
    }
    activeId = "silt_volume_surface";
    group.visible = !!slot?.mesh;
    return {
      ok: !!slot?.mesh,
      id: "silt_volume_surface",
      available: !!slot?.mesh,
      message: slot?.mesh ? undefined : "Failed to build silt volume overlay",
      legend: buildSiltVolumeLegend(def, period),
      stats: {
        period: period.id,
        type: "groundOverlay",
        hasMesh: !!slot?.mesh,
        bounds: drapedDef.bounds,
      },
    };
  }

  async function setSiltVolumePeriod(periodId) {
    await ensureConfig();
    const def = layerDef("silt_volume_surface");
    if (!def?.available) {
      return {
        ok: false,
        id: "silt_volume_surface",
        available: false,
        message: "Silt volume unavailable",
      };
    }
    const entry = resolveSiltVolumePeriodEntry(def, periodId);
    if (!entry) {
      return {
        ok: false,
        id: "silt_volume_surface",
        available: false,
        message: `No silt volume for ${periodId}`,
      };
    }
    siltVolumePeriod = entry.id;
    pendingShowId = "silt_volume_surface";
    const seq = ++showSeq;
    return showSiltVolumeLayer(def, seq, { keepSelection: true });
  }

  /**
   * @param {string} id
   * @returns {Promise<{ ok:boolean, id:string, available:boolean, legend?:object, message?:string, stats?:object }>}
   */
  async function showLayer(id) {
    const seq = ++showSeq;
    pendingShowId = id;
    await ensureConfig();
    if (pendingShowId !== id) return { ok: false, id, available: false, superseded: true };

    const def = layerDef(id);
    if (!def) return { ok: false, id, available: false, message: "Unknown hydrology layer" };

    if (!def.available) {
      if (pendingShowId !== id) return { ok: false, id, available: false, superseded: true };
      clearActiveMeshes();
      activeId = id;
      group.visible = false;
      return {
        ok: true,
        id,
        available: false,
        message: def.unavailableLabel || "DATA UNAVAILABLE",
        reason: def.reason || null,
        legend: null,
      };
    }

    if (DRAPED_CLASS_LAYER_IDS.has(id)) {
      await loadDrapedOverlay(def);
      if (pendingShowId !== id) {
        // A newer request won — don't report failure for the stale one
        return { ok: true, id, available: false, superseded: true };
      }
      clearActiveMeshes();
      const slot = drapedOverlays[id];
      // If a prior failed attempt left loaded=true without mesh, force rebuild once
      if (!slot?.mesh && slot) {
        slot.loaded = false;
        slot.loading = null;
        await loadDrapedOverlay(def);
      }
      if (pendingShowId !== id) {
        return { ok: true, id, available: false, superseded: true };
      }
      clearActiveMeshes();
      if (slot?.mesh) {
        slot.mesh.visible = true;
        if (slot.mesh.material) {
          slot.mesh.material.opacity = Math.min(1, Number(def.opacity) || 1);
          slot.mesh.material.needsUpdate = true;
        }
      }
      activeId = id;
      group.visible = !!slot?.mesh;
      const legend =
        def.legendClasses?.length || def.classes?.length
          ? {
              type: "classes",
              title: def.legendTitle || def.name,
              subtitle: def.legendSubtitle || null,
              layerId: id,
              classes: (def.legendClasses || def.classes).map((c) => ({
                label: c.label,
                color: c.color,
                range: c.range || null,
                pct: c.pct || c.range || null,
              })),
            }
          : { type: "image", url: def.legend, title: def.name, layerId: id };
      return {
        ok: !!slot?.mesh,
        id,
        available: !!slot?.mesh,
        message: slot?.mesh ? undefined : `Failed to build ${id} overlay mesh`,
        legend,
        stats: {
          bounds: def.bounds,
          segments: def.gridSegments,
          opacity: def.opacity,
          hasMesh: !!slot?.mesh,
        },
      };
    }

    if (id === "landuse_lulc" || def.type === "lulcYears") {
      return showLulcLayer(def, pendingShowId === id ? showSeq : -1);
    }

    if (id === "silt_classification" || def.type === "siltClassificationPeriods") {
      return showSiltClassificationLayer(def, pendingShowId === id ? showSeq : -1);
    }

    if (id === "silt_volume_surface" || def.type === "siltVolumePeriods") {
      return showSiltVolumeLayer(def, pendingShowId === id ? showSeq : -1);
    }

    if (id === "pollution" || def.type === "garbagePoints") {
      const dataUrl = def.data || "/data/hydrology/pollution/garbage-locations.kml";
      try {
        await pollutionGarbage.userData.load(dataUrl);
      } catch (err) {
        console.error("[GarbageSystem] Initialization failed:", err);
        return {
          ok: false,
          id: "pollution",
          available: false,
          message: err?.message || "Garbage layer failed to load",
        };
      }
      if (pendingShowId !== id) {
        return { ok: true, id, available: false, superseded: true };
      }
      clearActiveMeshes();
      pollutionGarbage.userData.setVisible(true);
      pollutionGarbage.userData.setLabelsEnabled?.(true);
      pollutionGarbage.userData.setClassFilter?.(null);
      activeId = "pollution";
      group.visible = true;
      const count = pollutionGarbage.userData.getCount?.() || 0;
      const report = pollutionGarbage.userData.getReport?.() || {};
      const riverN = (report.riverAssociated || 0) + (report.nearRiver || 0);
      return {
        ok: count > 0,
        id: "pollution",
        available: count > 0,
        message: count > 0 ? undefined : "No garbage locations found",
        legend: {
          type: "classes",
          title: def.legendTitle || "Pollution",
          subtitle:
            def.legendSubtitle ||
            `${count} KML sites · ${riverN} river-associated`,
          classes: [
            { label: "Garbage location", color: "#E89A1C" },
            { label: "Density LOW", color: "#F1C40F" },
            { label: "Density MEDIUM", color: "#E67E22" },
            { label: "Density HIGH", color: "#C0392B" },
          ],
          layerId: "pollution",
          garbageDensityToggle: true,
          densityOn: !!pollutionGarbage.userData.getShowDensity?.(),
        },
        stats: {
          sites: count,
          data: dataUrl,
          report,
        },
      };
    }

    if (POLYGON_LAYER_IDS.has(id) || def.type === "polygon" || def.type === "kmlPolygons") {
      await loadClassedPolygons(def);
      if (pendingShowId !== id) return { ok: false, id, available: false, superseded: true };
      clearActiveMeshes();
      const slot = polygonSlot(id);
      if (slot.root) slot.root.visible = true;
      activeId = id;
      group.visible = !!slot.root;
      const legendClasses =
        (def.classes || []).length > 0
          ? def.classes
          : slot.meshes.map((m) => ({
              label: m.userData.class_label,
              color: m.userData.color,
              range: m.userData.range,
            }));
      return {
        ok: !!slot.root,
        id,
        available: !!slot.root && slot.meshes.length > 0,
        legend: {
          type: "classes",
          title: def.legendTitle || def.name,
          subtitle: def.legendSubtitle || null,
          layerId: id,
          classes: legendClasses.map((c) => ({
            label: c.label,
            color: c.color,
            range: c.range,
          })),
        },
        stats: {
          features: slot.featureIndex.length,
          meshes: slot.meshes.length,
          bounds: def.bounds,
          opacity: def.opacity,
        },
      };
    }

    return { ok: false, id, available: false, message: "Layer not implemented in this phase" };
  }

  function hideAll() {
    showSeq += 1;
    pendingShowId = null;
    clearActiveMeshes();
    activeId = null;
    group.visible = false;
  }

  function getActiveId() {
    return activeId;
  }

  function getConfig() {
    return config;
  }

  /** Ray pick salinity / WQ polygons / bank erosion / geology / pollution at local XZ. */
  function pickAt(x, z) {
    if (activeId === "bank_erosion") {
      return sampleBankErosionAt(x, z);
    }
    if (activeId === "geology") {
      return sampleGeologyAt(x, z);
    }
    if (
      activeId === "landuse_lulc" ||
      activeId === "silt_classification" ||
      activeId === "silt_volume_surface" ||
      activeId === "salinity" ||
      activeId === "water_quality_tss"
    ) {
      return sampleLandUseAt(x, z);
    }
    if (activeId === "pollution") {
      return pollutionGarbage.userData?.pickAt?.(x, z) || null;
    }
    if (!POLYGON_LAYER_IDS.has(activeId)) return null;
    const slot = polygonSlot(activeId);
    if (!slot.featureIndex.length) return null;
    let best = null;
    let bestD = Infinity;
    for (const f of slot.featureIndex) {
      if (!pointInPolyXZ(x, z, f.vertices)) continue;
      const d = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  }

  /** Sample draped class overlay (salinity / NDCI) at local XZ. */
  function sampleDrapedClassAt(id, x, z) {
    const slot = drapedOverlays[id];
    const sampler = slot?.sampler;
    if (!sampler || activeId !== id) return null;
    const ll = localToLonLat(x, z);
    const hit = sampler.sampleLonLat(ll.lon, ll.lat);
    if (!hit) return null;
    return {
      ...hit,
      x,
      z,
      lon: ll.lon,
      lat: ll.lat,
      hydrology: id,
    };
  }

  /** Sample bank-erosion class at local XZ from the draped overlay raster. */
  function sampleBankErosionAt(x, z) {
    return sampleDrapedClassAt("bank_erosion", x, z);
  }

  /** Sample spectral lithology class at local XZ (click identification). */
  function sampleGeologyAt(x, z) {
    const slot = drapedOverlays.geology;
    const sampler = slot?.sampler;
    if (!sampler || activeId !== "geology") return null;
    const ll = localToLonLat(x, z);
    const hit = sampler.sampleLonLat(ll.lon, ll.lat);
    if (!hit) return null;
    return {
      ...hit,
      x,
      z,
      lon: ll.lon,
      lat: ll.lat,
      hydrology: "geology",
    };
  }

  /** Sample LULC / silt class under the pointer for hover tooltips. */
  function sampleLandUseAt(x, z) {
    const id = activeId;
    if (
      id !== "landuse_lulc" &&
      id !== "silt_classification" &&
      id !== "silt_volume_surface" &&
      id !== "salinity" &&
      id !== "water_quality_tss"
    ) {
      return null;
    }
    const slot = drapedOverlays[id];
    const sampler = slot?.sampler;
    if (!sampler) return null;
    const ll = localToLonLat(x, z);
    const hit = sampler.sampleLonLat(ll.lon, ll.lat);
    if (!hit) return null;
    const scheme = WQ_LAYER_SCHEMES[id];
    const schemeClass =
      scheme?.classes?.find(
        (c) =>
          String(c.label).toLowerCase() === String(hit.class_label || hit.label || "").toLowerCase() ||
          String(c.id).toLowerCase() === String(hit.id || "").toLowerCase(),
      ) || null;
    return {
      ...hit,
      x,
      z,
      lon: ll.lon,
      lat: ll.lat,
      hydrology: id,
      range: hit.range || hit.pct || schemeClass?.range || null,
      unit: scheme?.unit || hit.unit || null,
      metric: scheme?.metric || null,
      value: hit.value ?? (schemeClass ? classRepresentativeValue(schemeClass) : null),
      valueText:
        hit.valueText ||
        (schemeClass && scheme?.unit
          ? formatWqValue(classRepresentativeValue(schemeClass), scheme.unit)
          : null),
      layerTitle:
        id === "landuse_lulc"
          ? "LULC"
          : id === "silt_volume_surface"
            ? "SILT VOLUME"
            : id === "salinity"
              ? "SALINITY"
              : id === "water_quality_tss"
                ? "TSS"
                : "SILT CLASS",
    };
  }

  function dispose() {
    hideAll();
    for (const slot of Object.values(drapedOverlays)) {
      if (slot.mesh) {
        group.remove(slot.mesh);
        disposeObject(slot.mesh);
        slot.mesh = null;
        slot.loaded = false;
      }
      slot.sampler = null;
    }
    for (const slot of Object.values(polygonLayers)) {
      if (slot.root) {
        group.remove(slot.root);
        disposeObject(slot.root);
        slot.root = null;
        slot.meshes = [];
        slot.featureIndex = [];
        slot.loaded = false;
        slot.loading = null;
      }
    }
    pollutionGarbage.userData?.dispose?.();
    group.remove(pollutionGarbage);
  }

  let erosionAnimTime = 0;

  function update(dt) {
    if (activeId === "pollution") {
      pollutionGarbage.userData?.update?.(dt, group.userData._camera || null);
    }
    if (activeId === "bank_erosion") {
      erosionAnimTime += dt;
      const mesh = drapedOverlays.bank_erosion?.mesh;
      if (mesh?.userData?.animateBankErosion) {
        updateBankErosionMaterial(mesh.material, erosionAnimTime);
      }
    }
  }

  function setCamera(camera) {
    group.userData._camera = camera || null;
  }

  /** Validate active layer geographic footprint (lon/lat of corners / samples). */
  function validateExtent() {
    const out = { activeId, checks: [] };
    if (activeId === "geology" && geology.mesh) {
      const b = geology.mesh.userData.boundsLonLat;
      out.checks.push({
        layer: "geology",
        lon: [b.west, b.east],
        lat: [b.south, b.north],
        ok:
          b.west >= 73.84 &&
          b.east <= 74.0 &&
          b.south >= 18.5 &&
          b.north <= 18.57,
      });
    }
    if (POLYGON_LAYER_IDS.has(activeId)) {
      const slot = polygonSlot(activeId);
      if (slot.featureIndex.length) {
        let minLon = Infinity;
        let maxLon = -Infinity;
        let minLat = Infinity;
        let maxLat = -Infinity;
        const step = Math.max(1, Math.floor(slot.featureIndex.length / 40));
        for (let i = 0; i < slot.featureIndex.length; i += step) {
          const f = slot.featureIndex[i];
          const ll = f.vertices[0];
          if (!ll) continue;
          minLon = Math.min(minLon, ll.lon);
          maxLon = Math.max(maxLon, ll.lon);
          minLat = Math.min(minLat, ll.lat);
          maxLat = Math.max(maxLat, ll.lat);
        }
        out.checks.push({
          layer: activeId,
          sampleLon: [minLon, maxLon],
          sampleLat: [minLat, maxLat],
          features: slot.featureIndex.length,
          meshes: slot.meshes.length,
          ok:
            minLon >= 73.85 &&
            maxLon <= 74.0 &&
            minLat >= 18.5 &&
            maxLat <= 18.57,
        });
      }
    }
    return out;
  }

  group.userData = {
    showLayer,
    hideAll,
    getActiveId,
    getConfig,
    ensureConfig,
    pickAt,
    sampleBankErosionAt,
    sampleGeologyAt,
    sampleLandUseAt,
    setLulcYear,
    getLulcYear: () => lulcYear,
    setSiltClassificationPeriod,
    getSiltClassificationPeriod: () => siltClassPeriod,
    setSiltVolumePeriod,
    getSiltVolumePeriod: () => siltVolumePeriod,
    update,
    setCamera,
    dispose,
    validateExtent,
    layerDef: (id) => layerDef(id),
    getPollutionLayer: () => pollutionGarbage,
  };

  return group;
}

function sampleHydroY(x, z, stations, lift) {
  const ty = stations?.length ? terrainHeightAt(x, z, stations) : SURFACE_Y + 2;
  // Always sit on/above the water surface so river-corridor overlays are not buried
  // under the translucent water mesh (SURFACE_Y = 9.4).
  const base = Math.max(ty, SURFACE_Y);
  return base + Math.max(0.55, Number(lift) || 0.55);
}

/**
 * Decode bank-erosion overlay into ImageData and match pixels to legend classes.
 * UV mapping must mirror buildDrapedGridMesh (flipV for bank_erosion).
 */
async function createBankErosionSampler(def) {
  const box = def.bounds;
  const west = Number(box.west);
  const east = Number(box.east);
  const north = Number(box.north);
  const south = Number(box.south);
  const flipU = false;
  const flipV = true;
  const classes = (def.legendClasses || []).map((c) => {
    const hex = normalizeHex(c.color) || "#888888";
    const rgb = hexToRgb(hex);
    return {
      id: c.id,
      label: c.label,
      color: hex,
      pct: c.pct || null,
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
    };
  });

  const abs = def.overlay.startsWith("http")
    ? def.overlay
    : new URL(def.overlay, window.location.origin).href;
  const res = await fetch(abs, { cache: "no-store" });
  if (!res.ok) throw new Error(`Bank erosion sampler image unavailable (${res.status})`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;

  function sampleLonLat(lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < west || lon > east || lat < south || lat > north) return null;
    const u = (lon - west) / (east - west);
    // Match buildDrapedGridMesh UV: with flipV, north→image top (v=0).
    const texU = flipU ? 1 - u : u;
    const texV = flipV
      ? (north - lat) / (north - south)
      : (lat - south) / (north - south);
    const px = Math.min(width - 1, Math.max(0, Math.round(texU * (width - 1))));
    const py = Math.min(height - 1, Math.max(0, Math.round(texV * (height - 1))));
    const i = (py * width + px) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 28) return null;
    // Skip near-black / empty corridor fill
    if (r + g + b < 40) return null;

    let best = null;
    let bestD = Infinity;
    for (const c of classes) {
      const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    // Reject weak matches (mixed / anti-aliased edge far from class colors)
    if (!best || bestD > 95 * 95) return null;
    return {
      class_label: best.label,
      label: best.label,
      id: best.id,
      color: best.color,
      pct: best.pct,
      class: best.label,
    };
  }

  return { sampleLonLat, width, height, west, east, north, south };
}

/**
 * LULC / silt draped overlay sampler — same UV as buildDrapedGridMesh (flipV).
 * Silt overlays are upscaled (~12k px) — use a dedicated downsampled sampler.
 */
async function createLandUseSampler(def, id) {
  if (id === "silt_classification" || id === "silt_volume_surface") {
    return createSiltOverlaySampler(def, id);
  }
  const classes =
    (Array.isArray(def.legendClasses) && def.legendClasses.length
      ? def.legendClasses
      : null) ||
    (Array.isArray(def.classes) && def.classes.length ? def.classes : null) ||
    (id === "landuse_lulc" ? LULC_LEGEND : []);
  if (!classes.length || !def.overlay || !def.bounds) {
    throw new Error(`${id} sampler missing classes/overlay/bounds`);
  }
  return createBankErosionSampler({
    ...def,
    legendClasses: classes.map((c, i) => ({
      id: c.id || `class_${i}`,
      label: c.label,
      color: c.color,
      pct: c.pct || c.range || null,
    })),
  });
}

/**
 * Decode silt classification / volume overlays for hover.
 * - Classification: snap to discrete legend colors (Low → Very High)
 * - Volume: project pixel RGB onto the white→brown ramp → numeric 0–94.31
 * Downsamples large smoothed PNGs so getImageData stays reliable on Windows.
 */
async function createSiltOverlaySampler(def, id) {
  const box = def.bounds;
  const west = Number(box.west);
  const east = Number(box.east);
  const north = Number(box.north);
  const south = Number(box.south);
  if (![west, east, north, south].every(Number.isFinite)) {
    throw new Error(`${id} sampler bounds invalid`);
  }

  const isVolume = id === "silt_volume_surface";
  const rawClasses =
    (Array.isArray(def.legendClasses) && def.legendClasses.length
      ? def.legendClasses
      : null) ||
    (Array.isArray(def.classes) && def.classes.length ? def.classes : null) ||
    (isVolume ? SILT_VOLUME_CLASSES : SILT_CLASS_CLASSES);

  const classes = rawClasses.map((c, i) => {
    const hex = normalizeHex(c.color) || "#888888";
    const rgb = hexToRgb(hex);
    const value =
      Number.isFinite(Number(c.value))
        ? Number(c.value)
        : isVolume
          ? (i / Math.max(1, rawClasses.length - 1)) * SILT_VOLUME_MAX
          : null;
    return {
      id: c.id || `class_${i}`,
      label: c.label,
      color: hex,
      pct: c.pct || c.range || null,
      value,
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
    };
  });

  const abs = def.overlay.startsWith("http")
    ? def.overlay
    : new URL(def.overlay, window.location.origin).href;
  const res = await fetch(abs, { cache: "no-store" });
  if (!res.ok) throw new Error(`${id} sampler image unavailable (${res.status})`);
  const blob = await res.blob();
  const full = await createImageBitmap(blob);
  const maxW = 2048;
  const scale = Math.min(1, maxW / Math.max(1, full.width));
  const width = Math.max(1, Math.round(full.width * scale));
  const height = Math.max(1, Math.round(full.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = !isVolume ? false : true;
  ctx.drawImage(full, 0, 0, width, height);
  full.close?.();
  const { data } = ctx.getImageData(0, 0, width, height);

  function rgbToHex(r, g, b) {
    const h = (n) => n.toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  /** Project RGB onto piecewise-linear legend ramp → continuous value. */
  function volumeFromRgb(r, g, b) {
    if (classes.length < 2) {
      return { value: classes[0]?.value ?? 0, color: classes[0]?.color, label: classes[0]?.label };
    }
    let bestD = Infinity;
    let bestValue = 0;
    let bestColor = classes[0].color;
    let bestLabel = classes[0].label;
    for (let i = 0; i < classes.length - 1; i++) {
      const a = classes[i];
      const c = classes[i + 1];
      const abx = c.r - a.r;
      const aby = c.g - a.g;
      const abz = c.b - a.b;
      const abLen2 = abx * abx + aby * aby + abz * abz || 1;
      let t = ((r - a.r) * abx + (g - a.g) * aby + (b - a.b) * abz) / abLen2;
      t = Math.max(0, Math.min(1, t));
      const pr = a.r + abx * t;
      const pg = a.g + aby * t;
      const pb = a.b + abz * t;
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < bestD) {
        bestD = d;
        const va = Number.isFinite(a.value) ? a.value : 0;
        const vc = Number.isFinite(c.value) ? c.value : SILT_VOLUME_MAX;
        bestValue = va + (vc - va) * t;
        bestColor = rgbToHex(
          Math.round(pr),
          Math.round(pg),
          Math.round(pb),
        );
        // Prefer the nearer stop label for the chip text
        bestLabel = t < 0.5 ? a.label : c.label;
      }
    }
    // Also allow snap to endpoint classes (outside segment projection)
    for (const c of classes) {
      const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
      if (d < bestD) {
        bestD = d;
        bestValue = Number.isFinite(c.value) ? c.value : bestValue;
        bestColor = c.color;
        bestLabel = c.label;
      }
    }
    return {
      value: Math.max(0, Math.min(SILT_VOLUME_MAX, bestValue)),
      color: bestColor,
      label: bestLabel,
      matchDist: Math.sqrt(bestD),
    };
  }

  function classFromRgb(r, g, b) {
    let best = null;
    let bestD = Infinity;
    for (const c of classes) {
      const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    // Remapped overlays are exact legend colors; allow some edge bleed.
    if (!best || bestD > 110 * 110) return null;
    return best;
  }

  function sampleLonLat(lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < west || lon > east || lat < south || lat > north) return null;
    const texU = (lon - west) / (east - west);
    const texV = (north - lat) / (north - south);
    const px = Math.min(width - 1, Math.max(0, Math.round(texU * (width - 1))));
    const py = Math.min(height - 1, Math.max(0, Math.round(texV * (height - 1))));
    const i = (py * width + px) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 20) return null;
    if (r + g + b < 24) return null;

    if (isVolume) {
      const hit = volumeFromRgb(r, g, b);
      const value = hit.value;
      const valueLabel =
        value >= 10 ? value.toFixed(1) : value.toFixed(2);
      return {
        class_label: valueLabel,
        label: valueLabel,
        id: "volume",
        color: hit.color || rgbToHex(r, g, b),
        sampleColor: rgbToHex(r, g, b),
        pct: null,
        value,
        valueMax: SILT_VOLUME_MAX,
        unit: "",
        rampLabel: hit.label,
        class: valueLabel,
      };
    }

    const best = classFromRgb(r, g, b);
    if (!best) return null;
    return {
      class_label: best.label,
      label: best.label,
      id: best.id,
      color: best.color,
      sampleColor: rgbToHex(r, g, b),
      pct: best.pct,
      class: best.label,
    };
  }

  return { sampleLonLat, width, height, west, east, north, south, kind: id };
}

/**
 * Geology / Spectral Lithology overlay sampler — matches LITHOLOGY_CLASSES colors.
 * UV matches buildDrapedGridMesh with flipV (north = image top).
 */
async function createGeologySampler(def) {
  const box = def.bounds;
  const west = Number(box.west);
  const east = Number(box.east);
  const north = Number(box.north);
  const south = Number(box.south);
  const classes = LITHOLOGY_CLASSES.map((c) => ({
    id: c.id,
    label: c.label,
    color: c.color,
    pct: c.pct,
    samples: (c.samples || []).map(([r, g, b]) => ({ r, g, b })),
  }));

  const abs = def.overlay.startsWith("http")
    ? def.overlay
    : new URL(def.overlay, window.location.origin).href;
  const res = await fetch(abs, { cache: "no-store" });
  if (!res.ok) throw new Error(`Geology sampler image unavailable (${res.status})`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;

  function sampleLonLat(lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < west || lon > east || lat < south || lat > north) return null;
    const texU = (lon - west) / (east - west);
    // flipV: north → image top (v=0)
    const texV = (north - lat) / (north - south);
    const px = Math.min(width - 1, Math.max(0, Math.round(texU * (width - 1))));
    const py = Math.min(height - 1, Math.max(0, Math.round(texV * (height - 1))));
    const i = (py * width + px) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 28 || r + g + b < 40) return null;

    let best = null;
    let bestD = Infinity;
    for (const c of classes) {
      for (const s of c.samples) {
        const d = (s.r - r) ** 2 + (s.g - g) ** 2 + (s.b - b) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    if (!best || bestD > 110 * 110) return null;
    return {
      class_label: best.label,
      label: best.label,
      id: best.id,
      color: best.color,
      pct: best.pct,
      class: best.label,
    };
  }

  return { sampleLonLat, width, height, west, east, north, south };
}

function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Geology-style terrain-draped grid (keeps Spectral Lithology behaviour). */
async function buildDrapedGridMesh({
  id,
  def,
  bounds,
  west,
  east,
  north,
  south,
  stations,
  lift,
  opacity,
  version,
  nearest = false,
  highContrast = false,
  animateBankErosion = false,
}) {
  const segs = Math.max(32, Math.min(160, Number(def.gridSegments) || 96));
  const lonSpan = east - west;
  const latSpan = north - south;
  const flipU = !!def.flipU;
  const flipV = !!def.flipV;

  const positions = new Float32Array((segs + 1) * (segs + 1) * 3);
  const uvs = new Float32Array((segs + 1) * (segs + 1) * 2);
  let vi = 0;
  for (let iy = 0; iy <= segs; iy++) {
    const tv = iy / segs;
    const lat = north - tv * latSpan;
    for (let ix = 0; ix <= segs; ix++) {
      const tu = ix / segs;
      const lon = west + tu * lonSpan;
      const p = lonLatToLocal(lon, lat);
      const y = sampleHydroY(p.x, p.z, stations, lift);
      positions[vi * 3] = p.x;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = p.z;
      let u = tu;
      let v = 1 - tv;
      if (flipU) u = 1 - u;
      if (flipV) v = 1 - v;
      uvs[vi * 2] = u;
      uvs[vi * 2 + 1] = v;
      vi += 1;
    }
  }

  const draped = new THREE.BufferGeometry();
  draped.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  draped.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  const indices = [];
  for (let iy = 0; iy < segs; iy++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iy * (segs + 1) + ix;
      const b = a + 1;
      const c = a + (segs + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  draped.setIndex(indices);
  draped.computeVertexNormals();

  const texture = await loadBoostedOverlayTexture(`${def.overlay}?v=${version}`, nearest);
  const mat = animateBankErosion
    ? createBankErosionMaterial(texture, {
        opacity: Math.min(1, Math.max(0.85, opacity)),
      })
    : new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: Math.min(1, Math.max(highContrast ? 1 : 0.85, opacity)),
        alphaTest: highContrast ? 0.08 : 0.02,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
  const mesh = new THREE.Mesh(draped, mat);
  mesh.name = `hydrology_${id}`;
  mesh.renderOrder = highContrast || animateBankErosion ? 48 : 18;
  mesh.frustumCulled = !(highContrast || animateBankErosion);
  mesh.visible = false;
  mesh.userData.hydrology = id;
  mesh.userData.geoUvVersion = version;
  mesh.userData.overlayUrl = def.overlay;
  mesh.userData.boundsLonLat = { west, east, north, south };
  mesh.userData.boundsLocal = bounds;
  mesh.userData.animateBankErosion = !!animateBankErosion;
  return mesh;
}

/**
 * Flat KMZ GroundOverlay plane in local XZ — bank erosion ribbon stays readable in 2D.
 * Corners match LatLonBox exactly via lonLatToLocal.
 */
async function buildFlatGroundOverlayMesh({
  id,
  bounds,
  west,
  east,
  north,
  south,
  overlayUrl,
  opacity,
  lift,
  version,
}) {
  const nw = lonLatToLocal(west, north);
  const ne = lonLatToLocal(east, north);
  const se = lonLatToLocal(east, south);
  const sw = lonLatToLocal(west, south);
  const y = SURFACE_Y + Math.max(2.5, Number(lift) || 2.5);

  const positions = new Float32Array([
    nw.x, y, nw.z,
    ne.x, y, ne.z,
    se.x, y, se.z,
    sw.x, y, sw.z,
  ]);
  // Image top = north (Google Earth GroundOverlay convention)
  const uvs = new Float32Array([
    0, 1,
    1, 1,
    1, 0,
    0, 0,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  geo.computeVertexNormals();

  const texture = await loadBoostedOverlayTexture(`${overlayUrl}?v=${version}`, true);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    alphaTest: 0.08,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `hydrology_${id}`;
  mesh.renderOrder = 48;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.userData.hydrology = id;
  mesh.userData.geoUvVersion = version;
  mesh.userData.overlayUrl = overlayUrl;
  mesh.userData.boundsLonLat = { west, east, north, south };
  mesh.userData.boundsLocal = bounds;
  mesh.userData.flatGroundOverlay = true;
  return mesh;
}

/** Load overlay PNG via fetch (avoids stale service-worker image cache) then TextureLoader. */
async function loadBoostedOverlayTexture(url, nearest) {
  const abs = url.startsWith("http") ? url : new URL(url, window.location.origin).href;
  let objectUrl = null;
  try {
    const res = await fetch(abs, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${abs}`);
    const blob = await res.blob();
    if (!blob || blob.size < 32) throw new Error(`Empty overlay image (${blob?.size || 0} bytes)`);
    objectUrl = URL.createObjectURL(blob);
    const texture = await loadTexture(objectUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.flipY = false;
    texture.needsUpdate = true;
    return texture;
  } catch (err) {
    // Fallback: direct TextureLoader (same path lithology uses)
    try {
      const texture = await loadTexture(abs);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.flipY = false;
      texture.needsUpdate = true;
      return texture;
    } catch (err2) {
      throw new Error(formatLoadError(err2, abs) || formatLoadError(err, abs));
    }
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function formatLoadError(err, url) {
  if (!err) return `Failed to load ${url}`;
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  if (err.type) return `Image load ${err.type} for ${url}`;
  if (err.target?.src) return `Image load failed: ${err.target.src}`;
  return `Failed to load ${url}`;
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => resolve(tex),
      undefined,
      (err) => reject(err || new Error(`Failed to load texture ${url}`)),
    );
  });
}

function normalizeHex(c) {
  if (!c) return null;
  const s = String(c).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
  }
  return null;
}

function stripRange(name) {
  return String(name || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

/**
 * Map raw KML/GeoJSON class ("Class 1" / "Very Low Salinity") → configured legend label/color/range.
 */
function resolveClassMeta(def, rawLabel, feature = null) {
  const raw = String(rawLabel || "Unknown").trim();
  const classes = def?.classes || [];
  const stripped = stripRange(raw);
  const numM = raw.match(/^Class\s*(\d+)$/i);
  const classNum = numM ? Number(numM[1]) : null;

  let hit =
    classes.find((c) => c.kmlClass && String(c.kmlClass).toLowerCase() === raw.toLowerCase()) ||
    classes.find((c) => c.kmlClass && String(c.kmlClass).toLowerCase() === stripped.toLowerCase()) ||
    classes.find((c) => c.label && String(c.label).toLowerCase() === raw.toLowerCase()) ||
    classes.find((c) => c.label && String(c.label).toLowerCase() === stripped.toLowerCase()) ||
    classes.find((c) => c.id && String(c.id).toLowerCase() === raw.toLowerCase().replace(/\s+/g, "_")) ||
    null;

  if (!hit && classNum != null) {
    hit =
      classes.find((c) => c.id === `class_${classNum}`) ||
      classes.find((c) => String(c.kmlClass || "").match(new RegExp(`^Class\\s*${classNum}$`, "i"))) ||
      null;
  }

  // Salinity KML: "Very Low Salinity" → scheme label "Very Low"
  if (!hit && /salinity/i.test(stripped)) {
    const short = stripped.replace(/\s*salinity\s*$/i, "").trim();
    hit = classes.find((c) => String(c.label).toLowerCase() === short.toLowerCase()) || null;
  }

  if (hit) {
    const scheme = WQ_LAYER_SCHEMES[def?.id];
    const unit = hit.unit || def?.unit || scheme?.unit || null;
    const mid = classRepresentativeValue(hit);
    return {
      label: hit.label,
      color: normalizeHex(hit.color) || CLASS_COLOR[hit.label] || "#888888",
      range: hit.range || feature?.range || null,
      unit,
      value: mid,
      valueText: mid != null && unit ? formatWqValue(mid, unit) : null,
      metric: scheme?.metric || def?.legendTitle || def?.name || null,
    };
  }

  const color =
    CLASS_COLOR[raw] ||
    CLASS_COLOR[stripped] ||
    normalizeHex(feature?.color) ||
    "#888888";
  return {
    label: stripped || raw,
    color,
    range: feature?.range || null,
    unit: def?.unit || null,
    value: null,
    valueText: null,
    metric: def?.legendTitle || def?.name || null,
  };
}

function ringToLocalVerts(geometry) {
  if (!geometry) return null;
  let ring = null;
  if (geometry.type === "Polygon") ring = geometry.coordinates?.[0];
  else if (geometry.type === "MultiPolygon") ring = geometry.coordinates?.[0]?.[0];
  if (!ring || ring.length < 4) return null;
  const verts = [];
  for (const c of ring) {
    const lon = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = lonLatToLocal(lon, lat);
    verts.push({ x: p.x, z: p.z, lon, lat });
  }
  if (verts.length >= 2) {
    const a = verts[0];
    const b = verts[verts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6) verts.pop();
  }
  return verts.length >= 3 ? verts : null;
}

/** Lon/lat ring from parseClassedPolygonKml → local XZ verts. */
function lonLatRingToLocalVerts(coordinates) {
  if (!coordinates?.length) return null;
  const verts = [];
  for (const c of coordinates) {
    const lon = Number(c.lon ?? c[0]);
    const lat = Number(c.lat ?? c[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = lonLatToLocal(lon, lat);
    verts.push({ x: p.x, z: p.z, lon, lat });
  }
  if (verts.length >= 2) {
    const a = verts[0];
    const b = verts[verts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6) verts.pop();
  }
  return verts.length >= 3 ? verts : null;
}

function polygonToTerrainGeometry(verts, stations, lift) {
  try {
    const shape = new THREE.Shape();
    shape.moveTo(verts[0].x, -verts[0].z);
    for (let i = 1; i < verts.length; i++) {
      shape.lineTo(verts[i].x, -verts[i].z);
    }
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, sampleHydroY(x, z, stations, lift));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  } catch {
    return null;
  }
}

function pointInPolyXZ(x, z, verts) {
  if (!verts || verts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x;
    const zi = verts[i].z;
    const xj = verts[j].x;
    const zj = verts[j].z;
    const intersect = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
