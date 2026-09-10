/**
 * Hydrology thematic overlays for MULA-MUTHA-3D.
 * Geology (terrain-draped GroundOverlay) + Salinity (class-merged polygons).
 * Land Use / WQ / Pollution / AQI are config-only unavailable — no fake data.
 *
 * Self-contained under /data/hydrology — no runtime dependency on Shweta_River-2.0.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { lonLatToLocal } from "../geo/geoReference.js";
import { overlayBoxToLocalBounds } from "../utils/floodGeometry.js";
import { terrainHeightAt } from "./terrain.js";
import { SURFACE_Y } from "./river.js";

const CONFIG_URL = "/data/hydrology/hydrologyConfig.json";

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

  const geology = { mesh: null, loaded: false, loading: null };
  const salinity = {
    root: null,
    loaded: false,
    loading: null,
    featureIndex: [],
    meshes: [],
  };

  async function ensureConfig() {
    if (config) return config;
    const res = await fetch(CONFIG_URL, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`Hydrology config unavailable (${res.status})`);
    config = await res.json();
    return config;
  }

  function layerDef(id) {
    return config?.layers?.find((l) => l.id === id) || null;
  }

  function clearActiveMeshes() {
    if (geology.mesh) geology.mesh.visible = false;
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
   * Terrain-draped geology GroundOverlay (LatLonBox → subdivided grid).
   * Vertices are sampled in lon/lat so UVs stay georeferenced under flipX
   * (west→east image columns match geographic west→east, not local minX→maxX).
   */
  async function loadGeology(def) {
    const GEO_UV_VERSION = 2;
    if (geology.loaded && geology.mesh?.userData?.geoUvVersion !== GEO_UV_VERSION) {
      group.remove(geology.mesh);
      disposeObject(geology.mesh);
      geology.mesh = null;
      geology.loaded = false;
    }
    if (geology.loaded) return;
    if (geology.loading) return geology.loading;

    geology.loading = (async () => {
      const box = def.bounds;
      const west = Number(box.west);
      const east = Number(box.east);
      const north = Number(box.north);
      const south = Number(box.south);
      if (![west, east, north, south].every(Number.isFinite) || east === west || north === south) {
        throw new Error("Geology LatLonBox bounds are invalid");
      }

      const bounds = overlayBoxToLocalBounds(box);
      const segs = Math.max(32, Math.min(160, Number(def.gridSegments) || 96));
      const lift = Number(def.liftM) || 0.35;
      const opacity = Number(def.opacity) ?? 0.78;
      const lonSpan = east - west;
      const latSpan = north - south;

      // Optional texture mirror (only if a specific asset needs it — default correct geo UVs)
      const flipU = !!def.flipU;
      const flipV = !!def.flipV;

      const positions = new Float32Array((segs + 1) * (segs + 1) * 3);
      const uvs = new Float32Array((segs + 1) * (segs + 1) * 2);
      let vi = 0;
      for (let iy = 0; iy <= segs; iy++) {
        // Row 0 = north (top of KML overlay image)
        const tv = iy / segs;
        const lat = north - tv * latSpan;
        for (let ix = 0; ix <= segs; ix++) {
          // Col 0 = west (left of KML overlay image)
          const tu = ix / segs;
          const lon = west + tu * lonSpan;
          const p = lonLatToLocal(lon, lat);
          const y = sampleHydroY(p.x, p.z, stations, lift);
          positions[vi * 3] = p.x;
          positions[vi * 3 + 1] = y;
          positions[vi * 3 + 2] = p.z;
          // Three.js: v=0 bottom of texture → map north to v=1
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

      const texture = await loadTexture(def.overlay);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.flipY = true;
      texture.needsUpdate = true;

      const mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });

      const mesh = new THREE.Mesh(draped, mat);
      mesh.name = "hydrologyGeology";
      mesh.renderOrder = 4;
      mesh.visible = false;
      mesh.userData.hydrology = "geology";
      mesh.userData.geoUvVersion = GEO_UV_VERSION;
      mesh.userData.boundsLonLat = { west, east, north, south };
      mesh.userData.boundsLocal = bounds;
      group.add(mesh);
      geology.mesh = mesh;
      geology.loaded = true;
      geology.loading = null;
    })().catch((err) => {
      geology.loading = null;
      throw err;
    });

    return geology.loading;
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
    await ensureConfig();
    const def = layerDef(id);
    if (!def) return { ok: false, id, available: false, message: "Unknown hydrology layer" };

    if (!def.available) {
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

    if (id === "geology") {
      await loadGeology(def);
      clearActiveMeshes();
      if (geology.mesh) geology.mesh.visible = true;
      activeId = id;
      group.visible = true;
      return {
        ok: true,
        id,
        available: true,
        legend: { type: "image", url: def.legend, title: def.name },
        stats: {
          bounds: def.bounds,
          segments: def.gridSegments,
          opacity: def.opacity,
        },
      };
    }

    if (id === "salinity") {
      await loadSalinity(def);
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

  /** Ray pick salinity feature at local XZ (efficient index scan). */
  function pickAt(x, z) {
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

  function dispose() {
    hideAll();
    if (geology.mesh) {
      group.remove(geology.mesh);
      disposeObject(geology.mesh);
      geology.mesh = null;
      geology.loaded = false;
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
    dispose,
    validateExtent,
    layerDef: (id) => layerDef(id),
  };

  return group;
}

function sampleHydroY(x, z, stations, lift) {
  const ty = stations?.length ? terrainHeightAt(x, z, stations) : SURFACE_Y + 2;
  return Math.max(ty, SURFACE_Y - 0.6) + lift;
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
