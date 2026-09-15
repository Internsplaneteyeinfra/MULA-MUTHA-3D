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
/** Bundled asset — Vite always serves this (public/data new files can 404 as HTML). */
import bankErosionOverlayUrl from "../assets/hydrology/bank_erosion_overlay.png";
import bankErosionLegendUrl from "../assets/hydrology/bank_erosion_legend.png";
import { LITHOLOGY_CLASSES } from "../ui/components/geologyWorkspace.js";

const CONFIG_URL = "/data/hydrology/hydrologyConfig.json";
const CONFIG_VERSION = 9;

const POLYGON_LAYER_IDS = new Set([
  "salinity",
  "water_quality_tss",
  "water_quality_ndwi",
  "water_quality_ndci",
  "water_quality_wst",
  "landuse_lulc",
]);

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
    type: "kmlPolygons",
    data: "/data/hydrology/lulc/2026/lulc_2026.kml",
  },
];

const SILT_CLASS_BOUNDS = {
  north: 18.547336008158936,
  south: 18.520745875748997,
  east: 73.99351130069769,
  west: 73.85490125235805,
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

/** Hardcoded fallbacks so Bank Erosion works even if an old config is cached. */
const BUILTIN_LAYER_DEFS = {
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
    source: "bank_erosion_hotspot.kmz",
    opacity: 1,
    gridSegments: 144,
    liftM: 1.6,
    flipU: false,
    flipV: true,
    renderType: "terrainDrapedTexture",
    legendTitle: "Bank erosion hotspots",
    legendSubtitle: "2016–2026 classified overlay.",
    legendClasses: [
      { id: "none", label: "No erosion", color: "#7CFF2A", pct: "83.1%" },
      { id: "low", label: "Low erosion", color: "#FFE600", pct: "15.5%" },
      { id: "moderate", label: "Moderate erosion", color: "#FF8C00", pct: "1.4%" },
      { id: "high", label: "High erosion", color: "#FF3737", pct: "0%" },
      { id: "very_high", label: "Very high erosion", color: "#A0001E", pct: "0%" },
    ],
  },
};

const CLASS_COLOR = {
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
  };
  /** @deprecated alias — keep older references working during loadGeology */
  const geology = drapedOverlays.geology;
  /** Active LULC year (2021–2026). */
  let lulcYear = 2026;
  /** Active silt classification period id (YYYY-MM). Default = most recent. */
  let siltClassPeriod = SILT_CLASS_PERIODS[SILT_CLASS_PERIODS.length - 1].id;
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
  const salinity = polygonSlot("salinity");

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
    if (fromConfig && builtin) return { ...fromConfig, ...builtin };
    return fromConfig || builtin || null;
  }

  function clearActiveMeshes() {
    for (const slot of Object.values(drapedOverlays)) {
      if (slot.mesh) slot.mesh.visible = false;
    }
    for (const slot of Object.values(polygonLayers)) {
      if (slot.root) slot.root.visible = false;
    }
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

    const GEO_UV_VERSION = 13;
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
    if (slot.loaded) {
      if (id === "bank_erosion" && !slot.sampler) {
        slot.sampler = await createBankErosionSampler(def).catch(() => null);
      }
      if (id === "geology" && !slot.sampler) {
        slot.sampler = await createGeologySampler(def).catch(() => null);
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
              : id === "landuse_lulc" || id === "silt_classification"
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
        opacity: id === "bank_erosion" ? 1 : opacity,
        version: GEO_UV_VERSION,
        nearest:
          id === "bank_erosion" || id === "landuse_lulc" || id === "silt_classification",
        highContrast: id === "bank_erosion" || id === "silt_classification",
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
      slot.loading = null;
    })().catch((err) => {
      slot.loading = null;
      throw err;
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
        const res = await fetch(dataUrl, { signal: AbortSignal.timeout(90000) });
        if (!res.ok) throw new Error(`${id} KML unavailable (${res.status})`);
        const text = await res.text();
        if (/^\s*<!DOCTYPE html/i.test(text) || /^\s*<html/i.test(text)) {
          throw new Error(`${id} KML URL returned HTML — check public/data path`);
        }
        rawFeatures = parseClassedPolygonKml(text);
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
          opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const mesh = new THREE.Mesh(merged, mat);
        mesh.name = `${id}_${bucket.label.replace(/\s+/g, "_")}`;
        mesh.renderOrder = 5;
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
    // Open on most recent unless caller is switching years
    if (!opts.keepSelection) {
      const latest = years[years.length - 1];
      lulcYear = Number(latest.year);
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

    if (id === "geology" || id === "bank_erosion") {
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
        def.legendClasses?.length
          ? {
              type: "classes",
              title: def.legendTitle || def.name,
              subtitle: def.legendSubtitle || null,
              classes: def.legendClasses.map((c) => ({
                label: c.label,
                color: c.color,
                pct: c.pct,
              })),
            }
          : { type: "image", url: def.legend, title: def.name };
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

  /** Ray pick salinity / WQ polygons / bank erosion / geology at local XZ. */
  function pickAt(x, z) {
    if (activeId === "bank_erosion") {
      return sampleBankErosionAt(x, z);
    }
    if (activeId === "geology") {
      return sampleGeologyAt(x, z);
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

  /** Sample bank-erosion class at local XZ from the draped overlay raster. */
  function sampleBankErosionAt(x, z) {
    const slot = drapedOverlays.bank_erosion;
    const sampler = slot?.sampler;
    if (!sampler || activeId !== "bank_erosion") return null;
    const ll = localToLonLat(x, z);
    const hit = sampler.sampleLonLat(ll.lon, ll.lat);
    if (!hit) return null;
    return {
      ...hit,
      x,
      z,
      lon: ll.lon,
      lat: ll.lat,
      hydrology: "bank_erosion",
    };
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
    setLulcYear,
    getLulcYear: () => lulcYear,
    setSiltClassificationPeriod,
    getSiltClassificationPeriod: () => siltClassPeriod,
    dispose,
    validateExtent,
    layerDef: (id) => layerDef(id),
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
      // tu=0 → west, tv=0 → north; with flipY=false, v=1 is image top (=north)
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
  const mat = new THREE.MeshBasicMaterial({
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
  mesh.renderOrder = highContrast ? 48 : 18;
  mesh.frustumCulled = !highContrast;
  mesh.visible = false;
  mesh.userData.hydrology = id;
  mesh.userData.geoUvVersion = version;
  mesh.userData.overlayUrl = def.overlay;
  mesh.userData.boundsLonLat = { west, east, north, south };
  mesh.userData.boundsLocal = bounds;
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
 * Map raw KML/GeoJSON class ("Class 1") → configured legend label/color/range.
 */
function resolveClassMeta(def, rawLabel, feature = null) {
  const raw = String(rawLabel || "Unknown").trim();
  const classes = def?.classes || [];
  const numM = raw.match(/^Class\s*(\d+)$/i);
  const classNum = numM ? Number(numM[1]) : null;

  let hit =
    classes.find((c) => c.kmlClass && String(c.kmlClass).toLowerCase() === raw.toLowerCase()) ||
    classes.find((c) => c.label && String(c.label).toLowerCase() === raw.toLowerCase()) ||
    classes.find((c) => c.id && String(c.id).toLowerCase() === raw.toLowerCase().replace(/\s+/g, "_")) ||
    null;

  if (!hit && classNum != null) {
    hit =
      classes.find((c) => c.id === `class_${classNum}`) ||
      classes.find((c) => String(c.kmlClass || "").match(new RegExp(`^Class\\s*${classNum}$`, "i"))) ||
      null;
  }

  if (hit) {
    return {
      label: hit.label,
      color: normalizeHex(hit.color) || CLASS_COLOR[hit.label] || "#888888",
      range: hit.range || feature?.range || null,
    };
  }

  const color =
    CLASS_COLOR[raw] ||
    CLASS_COLOR[stripRange(raw)] ||
    normalizeHex(feature?.color) ||
    "#888888";
  return {
    label: stripRange(raw) || raw,
    color,
    range: feature?.range || null,
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
