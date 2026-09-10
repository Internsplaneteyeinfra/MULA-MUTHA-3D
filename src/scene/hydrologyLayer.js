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
import { overlayBoxToLocalBounds } from "../utils/floodGeometry.js";
import { terrainHeightAt } from "./terrain.js";
import { SURFACE_Y } from "./river.js";
/** Bundled asset — Vite always serves this (public/data new files can 404 as HTML). */
import bankErosionOverlayUrl from "../assets/hydrology/bank_erosion_overlay.png";
import bankErosionLegendUrl from "../assets/hydrology/bank_erosion_legend.png";
import { LITHOLOGY_CLASSES } from "../ui/components/geologyWorkspace.js";

const CONFIG_URL = "/data/hydrology/hydrologyConfig.json";
const CONFIG_VERSION = 3;

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
  };
  /** @deprecated alias — keep older references working during loadGeology */
  const geology = drapedOverlays.geology;
  const salinity = {
    root: null,
    loaded: false,
    loading: null,
    featureIndex: [],
    meshes: [],
  };

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
    if (salinity.root) salinity.root.visible = false;
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

      // Lon/lat draped grid — same pipeline for geology + bank erosion.
      // With texture.flipY=false, flipV maps image top to geographic north.
      const mesh = await buildDrapedGridMesh({
        id,
        def: {
          ...def,
          flipU: false,
          flipV: true,
          gridSegments: id === "bank_erosion" ? Math.max(112, Number(def.gridSegments) || 144) : def.gridSegments,
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
        nearest: id === "bank_erosion",
        highContrast: id === "bank_erosion",
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
   * Salinity polygons → 5 class-merged terrain-draped meshes.
   */
  async function loadSalinity(def) {
    if (salinity.loaded) return;
    if (salinity.loading) return salinity.loading;

    salinity.loading = (async () => {
      const res = await fetch(def.data, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`Salinity data unavailable (${res.status})`);
      const gj = await res.json();
      const lift = Number(def.liftM) || 0.35;
      const opacity = Number(def.opacity) ?? 0.65;

      const buckets = new Map();
      for (const c of def.classes || []) {
        buckets.set(c.label, { geos: [], color: c.color, label: c.label, range: c.range });
      }

      const featureIndex = [];
      const feats = gj.features || [];
      for (let fi = 0; fi < feats.length; fi++) {
        const f = feats[fi];
        const props = f.properties || {};
        const label = props.class_label || stripRange(props.class) || "Unknown";
        const color = CLASS_COLOR[label] || normalizeHex(props.color) || "#888888";
        if (!buckets.has(label)) {
          buckets.set(label, { geos: [], color, label, range: props.range || null });
        }
        const verts = ringToLocalVerts(f.geometry);
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
          class: props.class || label,
          range: props.range || null,
          name: props.name || null,
          description: props.description || null,
          color,
          x: cx,
          z: cz,
          vertices: verts,
        });
      }

      const root = new THREE.Group();
      root.name = "hydrologySalinity";
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
        mesh.name = `salinity_${bucket.label.replace(/\s+/g, "_")}`;
        mesh.renderOrder = 5;
        mesh.userData.hydrology = "salinity";
        mesh.userData.class_label = bucket.label;
        mesh.userData.range = bucket.range;
        mesh.userData.color = bucket.color;
        root.add(mesh);
        meshes.push(mesh);
      }

      group.add(root);
      salinity.root = root;
      salinity.meshes = meshes;
      salinity.featureIndex = featureIndex;
      salinity.loaded = true;
      salinity.loading = null;
      root.userData.featureIndex = featureIndex;
      root.userData.meshCount = meshes.length;
      root.userData.featureCount = featureIndex.length;
    })().catch((err) => {
      salinity.loading = null;
      throw err;
    });

    return salinity.loading;
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

    if (id === "salinity") {
      await loadSalinity(def);
      if (pendingShowId !== id) return { ok: false, id, available: false, superseded: true };
      clearActiveMeshes();
      if (salinity.root) salinity.root.visible = true;
      activeId = id;
      group.visible = true;
      return {
        ok: true,
        id,
        available: true,
        legend: {
          type: "classes",
          title: def.name,
          classes: (def.classes || []).map((c) => ({
            label: c.label,
            color: c.color,
            range: c.range,
          })),
        },
        stats: {
          features: salinity.featureIndex.length,
          meshes: salinity.meshes.length,
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

  /** Ray pick salinity / bank erosion / geology at local XZ. */
  function pickAt(x, z) {
    if (activeId === "bank_erosion") {
      return sampleBankErosionAt(x, z);
    }
    if (activeId === "geology") {
      return sampleGeologyAt(x, z);
    }
    if (activeId !== "salinity" || !salinity.featureIndex.length) return null;
    let best = null;
    let bestD = Infinity;
    for (const f of salinity.featureIndex) {
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
    if (salinity.root) {
      group.remove(salinity.root);
      disposeObject(salinity.root);
      salinity.root = null;
      salinity.meshes = [];
      salinity.featureIndex = [];
      salinity.loaded = false;
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
    if (activeId === "salinity" && salinity.featureIndex.length) {
      let minLon = Infinity;
      let maxLon = -Infinity;
      let minLat = Infinity;
      let maxLat = -Infinity;
      const step = Math.max(1, Math.floor(salinity.featureIndex.length / 40));
      for (let i = 0; i < salinity.featureIndex.length; i += step) {
        const f = salinity.featureIndex[i];
        const ll = f.vertices[0];
        if (!ll) continue;
        minLon = Math.min(minLon, ll.lon);
        maxLon = Math.max(maxLon, ll.lon);
        minLat = Math.min(minLat, ll.lat);
        maxLat = Math.max(maxLat, ll.lat);
      }
      out.checks.push({
        layer: "salinity",
        sampleLon: [minLon, maxLon],
        sampleLat: [minLat, maxLat],
        features: salinity.featureIndex.length,
        meshes: salinity.meshes.length,
        ok:
          minLon >= 73.85 &&
          maxLon <= 74.0 &&
          minLat >= 18.5 &&
          maxLat <= 18.57,
      });
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
