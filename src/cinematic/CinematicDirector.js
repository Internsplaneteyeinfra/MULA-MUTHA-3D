/**
 * RIVER.EYE cinematic director — 26.0 s, single CesiumJS renderer for everything above water.
 *
 *  Architecture (one globe, one coordinate system):
 *   - CesiumJS owns the globe, terrain, imagery, sun, atmosphere and the camera (WGS84 throughout).
 *   - River surfaces are Cesium Primitives built from real centerlines (HydroRIVERS / local KML), see RiverRibbons.js.
 *   - Three.js is only used for the short underwater cut (fish, caustics, water column) on a separate transparent
 *     canvas that cross-fades over Cesium; it never draws geography.
 *
 *  Data: HydroRIVERS v10 (HydroSHEDS) centerlines, Natural Earth 10 m India boundary, local surveyed Mula–Mutha KML
 *  centerline, ArcGIS World Imagery, AWS Terrain Tiles (SRTM/NASADEM) elevation.
 *
 *  Timeline: 0–3 Earth→India · 3–5.3 Himalaya→Devprayag · 5.3–10.9 Ganga gorge approach/tracking · 11–16 Khadakwasla
 *            spillway + Mutha · 16–18.9 underwater · 18.9–21.5 Pune tracking · 22–24.7 lithology/flood previews · 24.7–26 brand.
 */
import { riverAudio } from "./audio/AudioSynthesizer.js";
import { createTerrariumTerrainProvider, sampleTerrariumHeight, registerBurnChannel } from "./cesium/TerrariumTerrainProvider.js";
import { conditionRiverProfile, createRiverPrimitive } from "./cesium/RiverRibbons.js";
import { createUnderwaterScene } from "./scenes/UnderwaterFishScene.js";
import { createWaterSpray } from "./cesium/WaterSpray.js";
import { createSpillway } from "./cesium/Spillway.js";
import { createTilePrefetcher } from "./cesium/TilePrefetcher.js";
import { parseChainageAnalysisKml } from "../geo/kml.js";

export const SCENES = [
  { id: "earth_to_india", number: "01", name: "Real Earth to India", subName: "Satellite imagery on a WGS84 globe", start: 0, end: 3, color: "#06b6d4" },
  { id: "himalayas", number: "02", name: "Himalaya & River Birth", subName: "Garhwal Himalaya to Devprayag, where the Ganga begins", start: 3, end: 6, color: "#38bdf8" },
  { id: "river_tracking", number: "03", name: "River Tracking", subName: "Ganga gorge to Lakshman Jhula, Rishikesh", start: 6, end: 11, color: "#10b981" },
  { id: "dam_spillway", number: "04", name: "Dam & Spillway", subName: "Khadakwasla Dam (simulated release) · Mutha River", start: 11, end: 16, color: "#84cc16" },
  { id: "underwater_life", number: "05", name: "Underwater Life", subName: "Freshwater fish, illustrative", start: 16, end: 19, color: "#f97316" },
  { id: "pune_reach", number: "06", name: "Mula–Mutha, Pune", subName: "River tracking through Pune", start: 19, end: 21.5, color: "#a78bfa" },
  { id: "lithology_preview", number: "07", name: "River Corridor Lithology", subName: "Existing spectral lithology layer", start: 22, end: 23.35, color: "#38bdf8" },
  { id: "flood_preview", number: "08", name: "Flood-water Samples", subName: "Estimated flood-water sample extent · 3–15 July 2026", start: 23.35, end: 24.7, color: "#2f9bd6" },
  { id: "final_landing", number: "09", name: "RIVER.EYE", subName: "See the river. Understand the flow. Protect the future.", start: 24.7, end: 26, color: "#eab308" },
];
export const TOTAL_DURATION = 26.0;

const RIVER_COLORS = {
  Ganga: "#22d3ee", Yamuna: "#60a5fa", Brahmaputra: "#34d399", Narmada: "#2dd4bf",
  Krishna: "#a5f3fc", Godavari: "#fbbf24", "Mula-Mutha": "#f0abfc",
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/** Catmull–Rom (non-uniform-time, tangent-scaled) over keyframes {t, v:[...numbers]} */
function sampleKeys(keys, t) {
  if (t <= keys[0].t) return keys[0].v.slice();
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v.slice();
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
  // A hard key is a scene cut. Never spline across it — that swing flew back out to the globe.
  if (k2.hard) return (t + 1e-4 >= k2.t ? k2.v : k1.v).slice();
  const dt = k2.t - k1.t;
  const u = (t - k1.t) / dt;
  const u2 = u * u, u3 = u2 * u;
  // Monotone-limited tangents (Fritsch–Carlson style): no overshoot between keys, even after a long fast arc.
  // Plain Catmull–Rom keeps constant speed through river bends (zeroing tangents at every lon/lat reversal made the
  // camera slow down and surge on each bend). Limiting is applied only when adjacent segment slopes differ by >4x,
  // i.e. next to a long fast move, where an unlimited tangent would overshoot.
  const tangent = (a, b, c, ta, tb, tc) => {
    const d0 = (b - a) / Math.max(1e-6, tb - ta);
    const d1 = (c - b) / Math.max(1e-6, tc - tb);
    const m = (c - a) / Math.max(1e-6, tc - ta);
    const big = Math.max(Math.abs(d0), Math.abs(d1));
    const small = Math.min(Math.abs(d0), Math.abs(d1));
    if (big < 4 * small + 1e-9) return m;
    if (d0 * d1 <= 0) return 0;
    return Math.sign(m) * Math.min(Math.abs(m), 3 * Math.abs(d0), 3 * Math.abs(d1));
  };
  return k1.v.map((_, c) => {
    const a0 = k1.hard ? k1 : k0;
    const a3 = k3.hard ? k2 : k3;
    const m1 = (a0 === k1 ? (k2.v[c] - k1.v[c]) / dt : tangent(a0.v[c], k1.v[c], k2.v[c], a0.t, k1.t, k2.t)) * dt;
    const m2 = (a3 === k2 ? (k2.v[c] - k1.v[c]) / dt : tangent(k1.v[c], k2.v[c], a3.v[c], k1.t, k2.t, a3.t)) * dt;
    return (2 * u3 - 3 * u2 + 1) * k1.v[c] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * k2.v[c] + (u3 - u2) * m2;
  });
}

function bearingDeg(a, b) {
  const la1 = (a[1] * Math.PI) / 180, la2 = (b[1] * Math.PI) / 180, dl = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const clampN = (x, a, b) => Math.max(a, Math.min(b, x));

/** Polylines -> flat list of segments [ax, ay, bx, by] in degrees. */
function toSegments(lines) {
  const segs = [];
  for (const l of lines) for (let i = 1; i < l.length; i++) segs.push([l[i - 1][0], l[i - 1][1], l[i][0], l[i][1]]);
  return segs;
}

/** Nearest distance (m) to segments on the left and right of a centreline vertex, within maxM. */
function sideDistances(p, pts, i, segs, maxM) {
  const cos = Math.cos((p[1] * Math.PI) / 180);
  const mx = 111320 * cos, my = 110574;
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const tx = (b[0] - a[0]) * mx, ty = (b[1] - a[1]) * my;
  let left = Infinity, right = Infinity;
  for (const s of segs) {
    const ax = (s[0] - p[0]) * mx, ay = (s[1] - p[1]) * my, bx = (s[2] - p[0]) * mx, by = (s[3] - p[1]) * my;
    if (Math.min(ax, bx) > maxM || Math.max(ax, bx) < -maxM || Math.min(ay, by) > maxM || Math.max(ay, by) < -maxM) continue;
    const dx = bx - ax, dy = by - ay;
    const k = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const cx = ax + dx * k, cy = ay + dy * k;
    const d = Math.hypot(cx, cy);
    if (d > maxM) continue;
    if (tx * cy - ty * cx > 0) left = Math.min(left, d);
    else right = Math.min(right, d);
  }
  const have = [left, right].filter((v) => v < Infinity);
  return { left, right, mean: have.length ? have.reduce((x, y) => x + y, 0) / have.length : null };
}

function smoothArr(arr, w) {
  return arr.map((_, i) => {
    let s = 0, c = 0;
    for (let k = -w; k <= w; k++) if (arr[i + k] !== undefined) { s += arr[i + k]; c++; }
    return s / c;
  });
}

function offsetLL(lon, lat, eastM, northM) {
  const cos = Math.cos((lat * Math.PI) / 180);
  return [lon + eastM / (111320 * cos), lat + northM / 110574];
}

/** Point at distance (m) and bearing (deg) from lon/lat on a sphere. */
function destPoint(lon, lat, brgDeg, distM) {
  const R = 6371008.8, d = distM / R, b = (brgDeg * Math.PI) / 180;
  const la1 = (lat * Math.PI) / 180, lo1 = (lon * Math.PI) / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [(lo2 * 180) / Math.PI, (la2 * 180) / Math.PI];
}

function unwrap(prev, h) {
  while (h - prev > 180) h -= 360;
  while (h - prev < -180) h += 360;
  return h;
}

/** Distance-parameterised point along a conditioned profile. */
function pointAt(profile, dist) {
  const { pts, s, h } = profile;
  const d = Math.max(0, Math.min(s[s.length - 1], dist));
  let i = 1;
  while (i < s.length - 1 && s[i] < d) i++;
  const k = (d - s[i - 1]) / Math.max(1e-6, s[i] - s[i - 1]);
  return { lon: lerp(pts[i - 1][0], pts[i][0], k), lat: lerp(pts[i - 1][1], pts[i][1], k), h: lerp(h[i - 1], h[i], k) };
}

/**
 * Sharp profile. The globe always draws at the screen's real pixel size (devicePixelRatio).
 * A smaller resolutionScale upscales a soft image. Screen-space error stays near 1 so imagery
 * is about one satellite texel per screen pixel. Override LOD only with ?quality=low|high.
 */
function detectQuality() {
  const forced = new URLSearchParams(window.location.search).get("quality");
  if (["low", "balanced", "high"].includes(forced)) return forced;
  return "high";
}
// 4 GB machines report deviceMemory 4. Keep one-texel imagery (sse 1) but cap the tile cache
// and the framebuffer so the tab is not killed and forced onto a blank canvas.
const SMALL_PC = (navigator.deviceMemory || 8) <= 4;
const TILE_CACHE = SMALL_PC ? 1000 : 1800;
const QUALITY = detectQuality();
const QP = QUALITY === "low"
  ? { msaa: 2, sse: 1.5, cache: TILE_CACHE, resScale: 1 }
  : QUALITY === "balanced"
    ? { msaa: 2, sse: 1.15, cache: TILE_CACHE, resScale: 1 }
    : { msaa: 2, sse: 1.0, cache: TILE_CACHE, resScale: 1 };
// Lower-left geographic label: [start, end, name, place]. Only where the shot is verifiably on that river.
// The underwater cut starts on the Mutha just below Khadakwasla Dam (Pune) and dissolves before the camera reaches
// the Mula–Mutha confluence.
const RIVER_LABELS = [
  [6.0, 10.75, "GANGA RIVER", "Rishikesh, Uttarakhand"],
  [11.6, 18.55, "MUTHA RIVER", "Khadakwasla, Pune"], // dam, downstream reach and the underwater cut below it
  [19.0, 26.01, "MULA–MUTHA RIVER", "Pune, Maharashtra"],
];
const PERF = new URLSearchParams(window.location.search).has("perf");

export function createCinematicDirector({ container, underwaterCanvas, cutOverlay: cutEl, creditContainer, onUpdateState, onProgress }) {
  const Cesium = window.Cesium;
  if (!Cesium) throw new Error("CesiumJS failed to load");

  let currentTime = 0;
  let isPlaying = false;
  let playbackSpeed = 1.0;
  let ready = false;
  let destroyed = false;
  let lastFrame = performance.now();
  let rafId = 0;
  let lastDebugRender = 0;
  let prefetcher = null;
  // Wall-clock anchors: film time = playAnchorFilm + (now - playAnchorWall) * speed.
  let playAnchorFilm = 0;
  let playAnchorWall = performance.now();
  let filmStartWall = 0;
  let active = true;
  let lastUiUpdate = 0;
  let lastSceneIndex = -1;
  let completionSent = false;

  const urlT = new URLSearchParams(window.location.search).get("t");
  const debugAt = urlT != null ? parseFloat(urlT) : null; // ?t=12.5 freezes the film at that time (verification)
  // ?capture=1: the film renders whatever time the recorder sets (scripts/record-landing-film.mjs) and reports
  // when that frame's tiles are in. Used to bake the stored landing video.
  const captureMode = new URLSearchParams(window.location.search).has("capture");
  let captureT = 0;
  let captureSprayT = 0;
  let underwaterReady = false;

  // ---------- Cesium viewer ----------
  const viewer = new Cesium.Viewer(container, {
    baseLayer: false,
    baseLayerPicker: false, geocoder: false, homeButton: false, infoBox: false, navigationHelpButton: false,
    sceneModePicker: false, animation: false, timeline: false, fullscreenButton: false, selectionIndicator: false,
    shouldAnimate: false, scene3DOnly: true, requestRenderMode: false, creditContainer,
    // The director renders every frame itself; Cesium's own loop on top of it drew every frame twice.
    useDefaultRenderLoop: false,
    skyAtmosphere: new Cesium.SkyAtmosphere(),
    contextOptions: { webgl: { alpha: false, antialias: true, preserveDrawingBuffer: false } },
    msaaSamples: QP.msaa,
    useBrowserRecommendedResolution: false,
  });
  const scene = viewer.scene;
  const globe = scene.globe;
  scene.terrainProvider = createTerrariumTerrainProvider(Cesium);
  globe.enableLighting = true;
  globe.depthTestAgainstTerrain = true;
  globe.showGroundAtmosphere = true;
  globe.dynamicAtmosphereLighting = true;
  globe.dynamicAtmosphereLightingFromSun = true;
  globe.maximumScreenSpaceError = QP.sse;
  // Native pixels up to a framebuffer a 4 GB PC can keep. Cesium otherwise ignores devicePixelRatio
  // and the film is upscaled and soft. FXAA stays off — it smears satellite detail.
  viewer.useBrowserRecommendedResolution = false;
  if (scene.postProcessStages?.fxaa) scene.postProcessStages.fxaa.enabled = false;
  function fitResolution() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    const maxPx = SMALL_PC ? 1920 * 1080 * 1.25 * 1.25 : 2560 * 1440;
    const native = w * h * dpr * dpr;
    viewer.resolutionScale = native > maxPx ? Math.sqrt(maxPx / native) : 1;
    viewer.resize();
    if (scene.postProcessStages?.fxaa) scene.postProcessStages.fxaa.enabled = false;
  }
  fitResolution();
  globe.baseColor = Cesium.Color.fromCssColorString("#0b2a4a"); // ocean tone behind imagery while tiles load
  globe.preloadSiblings = true;
  globe.preloadAncestors = true;
  // The film updates the camera every frame, so Cesium treats the whole shot as "moving"
  // and skips tiles away from the centre. That is the soft patch in the corner.
  globe.cullRequestsWhileMoving = false;
  globe.loadingDescendantLimit = 20;
  globe.tileCacheSize = QP.cache; // keep pre-streamed tiles resident for the whole 25 s flight
  scene.highDynamicRange = false;
  scene.fog.enabled = false;
  scene.fog.density = 0;
  scene.skyAtmosphere.hueShift = 0;
  scene.skyAtmosphere.saturationShift = 0.05;
  scene.light = new Cesium.SunLight();
  const ctl = scene.screenSpaceCameraController;
  ctl.enableRotate = ctl.enableTranslate = ctl.enableZoom = ctl.enableTilt = ctl.enableLook = false;
  viewer.camera.frustum.fov = Cesium.Math.toRadians(52);
  viewer.camera.frustum.near = 2.0;

  Cesium.ArcGisMapServerImageryProvider.fromUrl("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer", {
    enablePickFeatures: false,
  }).then((p) => {
    if (destroyed) return;
    const layer = viewer.imageryLayers.addImageryProvider(p);
    layer.brightness = 1.02;
    layer.saturation = 1.05;
    if (Cesium.TextureMinificationFilter) {
      layer.minificationFilter = Cesium.TextureMinificationFilter.LINEAR;
      layer.magnificationFilter = Cesium.TextureMagnificationFilter.LINEAR;
    }
  });

  // Start fetching the project's actual lithology raster early, but add it only for its timed preview.
  // It is the same 2026 KMZ-derived raster/bounds used by the GIS lithology layer.
  const lithologyBounds = Cesium.Rectangle.fromDegrees(73.8497860332, 18.509121677, 73.9963757521, 18.5623585024);
  let lithologyObjectUrl = null;
  let lithologyWorker = null;
  const addLithologyProvider = (provider) => {
    if (destroyed) return null;
    lithologyLayer = viewer.imageryLayers.addImageryProvider(provider);
    lithologyLayer.alpha = 0;
    lithologyLayer.show = false;
    return lithologyLayer;
  };
  let lithologyProviderReady = null;
  const requestLithology = () => lithologyProviderReady ||= (async () => {
    const sourceUrl = "/data/hydrology/geology/overlay.png";
    try {
      // Keep the existing classified raster and exact bounds, but make a nearest-neighbour half-size GPU texture.
      // Its original 8192×2975 file remains untouched; the 4096px render proxy avoids a large first-use upload.
      const proxy = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./lithologyProxy.worker.js", import.meta.url), { type: "module" });
        lithologyWorker = worker;
        worker.onmessage = ({ data }) => {
          lithologyWorker = null;
          worker.terminate();
          if (data.error) reject(new Error(data.error));
          else resolve(data.blob);
        };
        worker.onerror = (event) => {
          lithologyWorker = null;
          worker.terminate();
          reject(event.error || new Error(event.message || "Lithology worker failed"));
        };
        worker.postMessage({ url: sourceUrl, width: 4096 });
      });
      lithologyObjectUrl = URL.createObjectURL(proxy);
      return addLithologyProvider(await Cesium.SingleTileImageryProvider.fromUrl(lithologyObjectUrl, { rectangle: lithologyBounds }));
    } catch (err) {
      console.warn("lithology render proxy failed; using original raster", err);
      return addLithologyProvider(await Cesium.SingleTileImageryProvider.fromUrl(sourceUrl, { rectangle: lithologyBounds }));
    }
  })().catch((err) => {
    console.warn("lithology preview unavailable", err);
    return null;
  });

  // These are existing classified flood-water samples (period 4), not fabricated flood levels or a new dataset.
  // Ground-clamped points keep buildings, roads and terrain visible and accurately communicate the sample support.
  let floodSamplesReady = null;
  const requestFloodSamples = () => floodSamplesReady ||= fetch("/data/hydrology/climate/mula-mutha-flood-water-4.json")
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(async (data) => {
      if (destroyed || !Array.isArray(data.flood)) return null;
      const points = new Cesium.PointPrimitiveCollection();
      floodSampleColor = Cesium.Color.fromCssColorString("#2f9bd6");
      const heights = await Promise.all(data.flood.map(([lon, lat]) =>
        sampleTerrariumHeight(lon, lat, 13).catch(() => null)
      ));
      for (let i = 0; i < data.flood.length; i++) {
        const [lon, lat] = data.flood[i];
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(heights[i])) continue;
        points.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, heights[i] + 1.25),
          pixelSize: 4,
          color: floodSampleColor.withAlpha(0.0),
          disableDepthTestDistance: 0,
        });
      }
      points.show = false;
      scene.primitives.add(points);
      floodSamples = points;
      return points;
    })
    .catch((err) => { console.warn("flood sample preview unavailable", err); return null; });

  viewer.camera.lookAt(Cesium.Cartesian3.fromDegrees(64, 15, 0), new Cesium.HeadingPitchRange(0, -Math.PI / 2, 26e6));

  let underwater = null;
  const requestUnderwater = () => {
    if (underwater) return underwater;
    underwater = createUnderwaterScene(underwaterCanvas);
    // The canvas is 300×150 until resized. Leaving it there stretches a tiny buffer over the full frame.
    underwater.resize(container.clientWidth, container.clientHeight);
    return underwater;
  };

  // ---------- Data: boundary, rivers, ribbons, dam ----------
  const overviewEntities = []; // glow lines + boundary, shown only while far from the ground
  const ribbons = []; // { primitive, material, profile }
  let mmRibbon = null; // Mula–Mutha main ribbon (depth / flow visualisation)
  let spray = null;
  let spill = null; // Khadakwasla spillway (visual simulation)
  let lithologyLayer = null;
  let floodSamples = null;
  let floodSampleColor = null;
  const riverIndex = {}; // name -> { coords, ... }
  let gorge = null, mutha = null, mulaMutha = null;

  // Ganga gorge reach used for close tracking: Devprayag (start of the Ganga) -> Lakshman Jhula, Rishikesh.
  const DEVPRAYAG = [78.598, 30.146];
  const LAKSHMAN_JHULA = [78.3297, 30.1262];
  const TRACK_KM = 2.6; // last ~2.6 km above Lakshman Jhula are tracked closely (about 0.5 km/s)
  // Khadakwasla Dam crest, OSM way 214776276 (waterway=dam). Spillway section placed on the central crest segment.
  const KHADAKWASLA_CREST = [[73.7683823, 18.4417618], [73.7717875, 18.4397892]];

  const nearestIdx = (coords, p) => {
    let best = 0, bd = Infinity;
    coords.forEach((c, i) => {
      const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  async function loadData() {
    const [rivJson, bnd, mmKmlText, depthProfile] = await Promise.all([
      fetch("/data/rivers/hydrorivers_india.json").then((r) => r.json()),
      fetch("/data/rivers/india_boundary_ne10m.geojson").then((r) => r.json()),
      fetch("/data/Mula-Mutha_River_10m_ch_merged.kml").then(async (r) => {
        if (!r.ok) throw new Error(`Mula-Mutha KML HTTP ${r.status}`);
        return r.text();
      }),
      fetch("/data/naditwin/depth_profile.json").then((r) => r.json()).catch(() => []),
    ]);
    const mmGeometry = parseChainageAnalysisKml(mmKmlText);
    if (!mmGeometry.centerline?.length || !mmGeometry.polygon?.length) {
      throw new Error("The surveyed Mula-Mutha KML is missing its centerline or river banks");
    }
    // Channel centre + width measured from JRC Global Surface Water across the HydroRIVERS courses
    // (scripts/refineChannelsFromJRC.py). Places the water where the real river is, at its real width.
    const channels = await fetch("/data/rivers/channels_jrc.json").then((r) => r.json()).catch(() => null);
    if (destroyed) return;
    onProgress?.("Loading boundary & river geometry…", 10);

    // India boundary (Natural Earth 10 m, India point-of-view) — main polygon + islands.
    for (const poly of bnd.geometry.coordinates) {
      overviewEntities.push(
        viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(poly[0].flat()),
            width: 1.6,
            material: Cesium.Color.WHITE.withAlpha(0.8),
            arcType: Cesium.ArcType.GEODESIC,
          },
        })
      );
    }
    // All seven rivers as glow lines for the overview phase (real HydroRIVERS courses).
    const rivers = rivJson.rivers;
    for (const [name, r] of Object.entries(rivers)) {
      riverIndex[name] = r;
      if (!RIVER_COLORS[name]) continue;
      overviewEntities.push(
        viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(r.coordinates.flat()),
            width: name === "Mula-Mutha" ? 5 : 4,
            material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.22, color: Cesium.Color.fromCssColorString(RIVER_COLORS[name]) }),
            clampToGround: true,
          },
        })
      );
    }

    onProgress?.("Sampling terrain along rivers…", 25);
    const g = rivers.Ganga.coordinates;
    const jrcG = channels?.reaches?.ganga_gorge;
    // Mutha below Khadakwasla carries little water most of the year (JRC finds water at only ~22% of sections, and
    // near the dam the nearest "water" is the reservoir), so it keeps the HydroRIVERS course, started at the dam toe.
    const jrcM = null;
    const gorgeLine = jrcG ? jrcG.coordinates : g.slice(nearestIdx(g, DEVPRAYAG), nearestIdx(g, LAKSHMAN_JHULA) + 3);
    const muthaLine = rivers.Mutha.coordinates.slice();
    const mmLine = mmGeometry.centerline.map(({ lon, lat }) => [lon, lat]);
    const mmBank = mmGeometry.polygon.map(({ lon, lat }) => [lon, lat]);

    // Spillway on the real Khadakwasla crest (visual simulation of an overflow release).
    // Gorge and Mula–Mutha terrain sampling do not depend on it, so they start now instead of after the dam mesh.
    const [ca, cb] = KHADAKWASLA_CREST;
    const lerpLL = (k) => [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k];
    const spillPromise = createSpillway(Cesium, scene, [lerpLL(0.34), lerpLL(0.66)]).catch((e) => {
      console.warn("spillway failed", e);
      return null;
    });
    const gorgePromise = conditionRiverProfile(gorgeLine, { stepM: 40, maxHalf: 40, minWidth: 40, zoom: 12, snapM: jrcG ? 0 : 450, foamSlope: [0.0012, 0.006] });
    const mmPromise = conditionRiverProfile(mmLine, { stepM: 30, maxHalf: 38, minWidth: 18, zoom: 14, snapM: 0 });

    spill = await spillPromise;
    // The Mutha surface begins where the spillway tail-water ends, so the released water visibly continues downstream.
    // HydroRIVERS routes the Mutha through the reservoir (its first vertices lie up to 2.3 km inside the lake), so keep
    // only vertices clearly downstream of the dam face.
    if (spill) {
      const [px, py] = spill.out;
      const tc = spill.toeCentre;
      const cos = Math.cos((tc.lat * Math.PI) / 180);
      // The film only renders the first 1.5 km below the dam. Keep a little extra course for the handoff/label,
      // instead of conditioning and terrain-snapping the full HydroRIVERS Mutha basin during startup.
      const downstream = [];
      let previous = null, courseM = 0;
      for (const p of muthaLine) {
        if (((p[0] - tc.lon) * 111320 * cos * px + (p[1] - tc.lat) * 110574 * py) <= 250) continue;
        if (previous) courseM += Math.hypot((p[0] - previous[0]) * 111320 * cos, (p[1] - previous[1]) * 110574);
        if (courseM > 3200) break;
        downstream.push(p);
        previous = p;
      }
      muthaLine.length = 0;
      muthaLine.push(offsetLL(tc.lon, tc.lat, px * 110, py * 110), ...downstream);
    }
    // Two Chaikin passes round off the corners of the coarse HydroRIVERS polyline (and the join to the tail-water).
    for (let pass = 0; pass < 2; pass++) {
      const sm = [muthaLine[0]];
      for (let i = 0; i < muthaLine.length - 1; i++) {
        const [a, b] = [muthaLine[i], muthaLine[i + 1]];
        sm.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      }
      sm.push(muthaLine[muthaLine.length - 1]);
      muthaLine.splice(0, muthaLine.length, ...sm);
    }
    const muthaPromise = conditionRiverProfile(muthaLine, { stepM: 40, maxHalf: 14, minWidth: 14, zoom: 12, snapM: jrcM ? 0 : 300, foamSlope: [0.002, 0.01] });
    [gorge, mutha, mulaMutha] = await Promise.all([gorgePromise, muthaPromise, mmPromise]);
    if (destroyed) return;
    // Measured JRC half-widths (resampled index-proportionally onto the conditioned profile).
    const applyHalf = (prof, halfs, lo, hi) => {
      if (!halfs) return;
      prof.half = smoothArr(prof.pts.map((_, i) => clampN(halfs[Math.round((i * (halfs.length - 1)) / Math.max(1, prof.pts.length - 1))], lo, hi)), 4);
    };
    applyHalf(gorge, jrcG?.halfWidthM, 25, 90);
    // Carve the measured channels into the displayed DEM so the water meets real banks (see registerBurnChannel).
    registerBurnChannel(gorge);
    // The Mutha keeps the natural DEM: its HydroRIVERS course is too coarse to carve without a misaligned trench.

    // Mula–Mutha: water fills to the real banks — half width measured to the surveyed KML river-boundary polygon.
    const bankSegs = toSegments([mmBank]);
    mulaMutha.half = smoothArr(
      mulaMutha.pts.map((p, i) => clampN(sideDistances(p, mulaMutha.pts, i, bankSegs, 250).mean ?? mulaMutha.half[i], 15, 160)),
      6
    );
    // Surveyed bathymetry (naditwin depth profile, chainage from the Sangam) -> per-vertex depth for the analysis view.
    if (depthProfile.length) {
      let j = 0;
      mulaMutha.depth = mulaMutha.s.map((s) => {
        while (j < depthProfile.length - 1 && depthProfile[j + 1].chainage_m <= s) j++;
        return depthProfile[j].depth_m;
      });
    }
    // Flood extent: half width to the WRD red flood lines (estimated); fallback 2.2x channel.
    registerBurnChannel(mulaMutha);

    onProgress?.("Building river surfaces…", 45);
    const addRibbon = (prof, opts) => {
      const built = createRiverPrimitive(Cesium, prof, opts);
      if (!built) return null;
      const primitive = scene.primitives.add(
        new Cesium.Primitive({
          geometryInstances: new Cesium.GeometryInstance({ geometry: built.geometry }),
          appearance: built.appearance,
          asynchronous: false,
          compressVertices: false,
        })
      );
      const r = { primitive, material: built.material, profile: prof };
      ribbons.push(r);
      return r;
    };
    addRibbon(gorge, { heightOffset: 0.15, opacity: 0.86, speed: 3.2, tint: [0.12, 0.33, 0.29] }); // jade-green upper Ganga
    // The released water continues ~650 m as a surface, then hands over to the real channel visible in the imagery
    // (the HydroRIVERS course beyond that runs beside the real Mutha).
    addRibbon(mutha, { heightOffset: 1.2, opacity: 0.8, speed: 1.8, tint: [0.1, 0.2, 0.17], fadeEnd: 650 });
    mmRibbon = addRibbon(mulaMutha, { heightOffset: 0.15, opacity: 0.95, speed: 1.6, tint: [0.09, 0.22, 0.24] });
    // Droplets & spray at real water interactions.
    spray = createWaterSpray(Cesium, scene);
    // (a) Rapids in the Ganga gorge: steepest conditioned reaches in the tracked section.
    const trackStart = gorge.s[gorge.s.length - 1] - TRACK_KM * 1000;
    const rapids = gorge.foam
      .map((f, i) => ({ f, i }))
      .filter((o) => gorge.s[o.i] > trackStart - 300 && o.f > 0.15)
      .sort((x, y) => y.f - x.f)
      .filter((o, k, arr) => arr.slice(0, k).every((q) => Math.abs(gorge.s[q.i] - gorge.s[o.i]) > 350))
      .slice(0, 9);
    // Always include the water-level shot location so splashes are in frame there.
    rapids.push({ i: gorge.s.findIndex((s) => s >= trackStart + 1400) }); // under the water-level pass
    for (const { i } of rapids) {
      if (i < 0) continue;
      const p = gorge.pts[i];
      const q = gorge.pts[Math.min(gorge.pts.length - 1, i + 2)];
      spray.addEmitter({ lon: p[0], lat: p[1], h: gorge.h[i] + 1.0, radius: gorge.half[i] * 0.7, length: 70, count: 220,
        speed: 3.2, spread: 2.0, size: 2.2, flowHeading: bearingDeg(p, q) });
    }
    // (b) Spillway: impact zone at the toe (droplets thrown up + mist).
    if (spill) {
      const { toeCentre: tc, alongCrest: [ux, uy], out: [px, py], width, downstreamBearing } = spill;
      for (let k = 0; k < 5; k++) {
        const off = (k / 4 - 0.5) * width * 0.85;
        const ll = offsetLL(tc.lon, tc.lat, ux * off + px * 6, uy * off + py * 6);
        spray.addEmitter({ lon: ll[0], lat: ll[1], h: spill.toeH + 0.5, radius: 6, length: width / 9, count: 70,
          speed: 5.5, spread: 2.5, size: 2.0, flowHeading: (downstreamBearing + 90) % 360, drift: [px * 2.0, py * 2.0] });
        spray.addEmitter({ lon: ll[0], lat: ll[1], h: spill.toeH + 1.5, radius: 9, length: width / 9, count: 14,
          speed: 2.2, spread: 1.8, size: 8, mist: true, flowHeading: (downstreamBearing + 90) % 360, drift: [px * 2, py * 2] });
      }
    }
  }

  // ---------- Camera keyframes ----------
  // v = [lon, lat, targetHeightM, headingDeg, pitchDeg, log(rangeM)]
  let camKeys = [];
  let sunKeys = []; // v = [utcHours since 2026-03-20T00:00Z]
  let pathReady = false;
  const bootT0 = performance.now();
  const bootMarks = {};
  const markBoot = (name) => { bootMarks[name] = Math.round(performance.now() - bootT0); };
  const LR = Math.log;

  async function buildKeys() {
    const keys = [];
    const push = (t, lon, lat, h, hd, pitch, range) => keys.push({ t, v: [lon, lat, h, hd, pitch, LR(range)] });
    let hd = 0;
    /** Track along a profile; range/pitch may be functions of k (0..1) for low passes and overheads. */
    /**
     * Drone-style tracking along a river profile. Position follows the centreline; heading is the direction to a
     * look-ahead point averaged over several distances and then low-pass filtered across keys, so bends turn the
     * camera gradually. Distance along the river eases in/out (smoothstep) instead of starting/stopping abruptly.
     */
    const seg = (profile, t0, t1, d0, d1, range, pitch, lookAheadM = 600, stepsPerSec = 4, ease = true) => {
      const n = Math.max(2, Math.round((t1 - t0) * stepsPerSec));
      const first = keys.length;
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const d = lerp(d0, d1, ease ? 0.5 * k + 0.5 * smooth(k) : k);
        const p = pointAt(profile, d);
        let ex = 0, ey = 0;
        for (const la of [0.5, 1, 1.5]) {
          const q = pointAt(profile, d + lookAheadM * la);
          const b = (bearingDeg([p.lon, p.lat], [q.lon, q.lat]) * Math.PI) / 180;
          ex += Math.sin(b);
          ey += Math.cos(b);
        }
        hd = unwrap(hd, (Math.atan2(ex, ey) * 180) / Math.PI);
        const r = typeof range === "function" ? range(k) : range;
        const pt = typeof pitch === "function" ? pitch(k) : pitch;
        push(t0 + (t1 - t0) * k, p.lon, p.lat, p.h, hd, pt, r);
      }
      // low-pass the heading across this segment's keys (orientation smoothed independently of position)
      const hs = keys.slice(first).map((k) => k.v[3]);
      hs.forEach((_, i) => {
        let s = 0, c = 0;
        for (let j = -2; j <= 2; j++) if (hs[i + j] !== undefined) { s += hs[i + j]; c++; }
        keys[first + i].v[3] = s / c;
      });
      hd = keys[keys.length - 1].v[3];
    };
    // Smooth bump 0..1..0 over [a, b] of k (no corners -> no abrupt zoom).
    const bump = (k, a, b) => (k <= a || k >= b ? 0 : Math.sin(((k - a) / (b - a)) * Math.PI) ** 2);

    // 0–2.8: already moving over India. No static full-Earth title hold.
    push(0.0, 73.2, 22.0, 0, 28, -58, 3.6e6);
    push(1.35, 77.6, 27.4, 0, 18, -46, 9.2e5);
    push(2.8, 79.15, 30.15, 1600, 208, -36, 2.8e5);
    // 3–6: Garhwal Himalaya, then down to Devprayag, where the Alaknanda and Bhagirathi form the Ganga
    push(4.4, 79.0, 30.55, 2500, 215 - 360, -30, 1.5e5);
    hd = 215 - 360;
    // 5.3–7.3: continuous Devprayag-to-Rishikesh valley approach. The old keys teleported ~30 km in 0.7 s
    // and dropped range from 7 km to ~200 m at t=6, causing the 7–8 s terrain stretch/LOD pop.
    const L = gorge.s[gorge.s.length - 1];
    const closeStart = Math.max(0, L - TRACK_KM * 1000);
    seg(gorge, 5.3, 7.3, 0, closeStart,
      (k) => lerp(7000, 3200, smooth(k)),
      (k) => lerp(-38, -62, smooth(k)), 900, 5);
    // 7.3–10.9: the final 2.6 km are followed at a constant camera scale and look-ahead distance.
    seg(gorge, 7.3, 10.9, closeStart, L - 150, 3200, -62, 900, 5);

    { const k = keys[keys.length - 1]; keys.push({ t: 11.0, v: k.v.slice() }); } // hold through the fade-out
    // 11–16: controlled cut (fade through black, see CUTS) from Rishikesh to Khadakwasla Dam — no 1,500 km fly-over,
    // which used to descend through un-streamed tile levels and showed blurred brown low-resolution terrain.
    if (spill) {
      const c = spill.crestCentre;
      const tc = spill.toeCentre;
      hd = unwrap(hd, spill.downstreamBearing);
      // Instant relocation right after the screen is fully black (no sweep across India requesting unseen tiles),
      // then hold so the dam view's tiles refine before the fade-in.
      keys.push({ t: 11.02, hard: true, v: [c.lon, c.lat, c.h, hd - 6, -22, LR(1100)] });
      push(11.3, c.lon, c.lat, c.h, hd - 6, -22, 1100);
      push(12.3, c.lon, c.lat, c.h, hd, -20, 900); // over the reservoir, looking downstream at the crest
      push(13.0, c.lon, c.lat, c.h, hd + 8, -26, 260); // closing on the crest
      push(13.6, tc.lon, tc.lat, spill.toeH, hd + 14, -32, 170); // tracking down the falling water to the toe
      const m0 = pointAt(mutha, 250);
      push(14.2, m0.lon, m0.lat, m0.h, hd + 6, -20, 220); // into the turbulence downstream
    }
    seg(mutha, 14.6, 16.0, 700, 1500, 230, -16, 400, 4);

    // 16–19: underwater (Three.js canvas covers Cesium); camera relocates to the Pune reach behind it
    const pS = pointAt(mulaMutha, 400);
    const pS2 = pointAt(mulaMutha, 1400);
    hd = unwrap(hd, bearingDeg([pS.lon, pS.lat], [pS2.lon, pS2.lat]));
    push(18.4, pS.lon, pS.lat, pS.h, hd, -40, 700);
    // 19–21.5: natural river tracking along the surveyed Mula–Mutha reach (surveyed depth tints the water colour)
    seg(mulaMutha, 18.9, 21.5, 400, 2200, 700, -42, 500, 4);
    // 21.5–24.7: one gentle pullback, then a stable, river-centred view for the GIS previews.
    {
      const p = pointAt(mulaMutha, 2200);
      push(22.0, p.lon, p.lat, p.h, hd, -49, 1450);
      hd = keys[keys.length - 1].v[3];
      push(24.7, p.lon, p.lat, p.h, hd + 2, -50, 1550);
      // Final landing holds the same aerial composition so the river remains identifiable behind branding.
      push(26.0, p.lon, p.lat, p.h, hd + 3, -50, 1550);
    }

    // Terrain clearance. Zoom 12 reuses tiles already fetched for the gorge; zoom 13 was a second uncached set
    // and stalled the film on the Himalaya view for ~20 s. Close keys only, two samples, yielded in small batches
    // so the opening camera keeps painting.
    const clearKey = async (k) => {
      const [lon, lat, h, hdg] = k.v;
      let pitch = k.v[4];
      let range = Math.exp(k.v[5]);
      if (range > 8000) return;
      for (let iter = 0; iter < 2; iter++) {
        const pr = (Math.abs(pitch) * Math.PI) / 180;
        const D = range * Math.cos(pr);
        const H = range * Math.sin(pr);
        const fs = [0.55, 1];
        const gs = await Promise.all(
          fs.map((f) => {
            const q = destPoint(lon, lat, (hdg + 180) % 360, D * f);
            return sampleTerrariumHeight(q[0], q[1], 12).catch(() => -1e9);
          })
        );
        const ok = fs.every((f, i) => gs[i] + Math.min(40, 8 + 0.05 * D * f) <= h + H * f);
        if (ok) break;
        if (pitch > -68) pitch -= 6;
        else range *= 1.18;
      }
      k.v[4] = pitch;
      k.v[5] = Math.log(range);
    };
    const close = keys.filter((k) => Math.exp(k.v[5]) <= 2500);
    for (let i = 0; i < close.length; i += 12) {
      await Promise.all(close.slice(i, i + 12).filter((_, j) => j % 3 === 0).map(clearKey));
    }
    // Independent per-key corrections can differ a lot between neighbours (altitude jumps); propagate the steepest
    // pitch / longest range within +-0.6 s and then average, so clearance changes ease in and out.
    const cp = keys.map((k) => k.v[4]);
    const cr = keys.map((k) => k.v[5]);
    keys.forEach((k, i) => {
      if (Math.exp(cr[i]) > 2.5e5) return;
      let p = cp[i], r = cr[i];
      keys.forEach((o, j) => {
        if (Math.abs(o.t - k.t) <= 0.6 && Math.exp(cr[j]) <= 2.5e5) {
          p = Math.min(p, cp[j] + (Math.abs(o.t - k.t) / 0.6) * 6);
          r = Math.max(r, cr[j] - (Math.abs(o.t - k.t) / 0.6) * 0.15);
        }
      });
      k.v[4] = p;
      k.v[5] = r;
    });
    camKeys = keys;

    // Sun as UTC hours on 2026-03-20; mid-morning over the Himalaya/Rishikesh, afternoon over Pune, golden hour at the end.
    sunKeys = [
      { t: 0, v: [5.0] }, { t: 3, v: [4.2] }, { t: 6, v: [3.8] }, { t: 11, v: [4.3] },
      { t: 16, v: [6.5] }, { t: 19, v: [9.5] }, { t: 22, v: [11.2] }, { t: 26, v: [12.4] },
    ];
  }

  // ---------- Labels ----------
  const _w = new Cesium.Cartesian2();
  function toScreen(lon, lat, h) {
    const p = Cesium.Cartesian3.fromDegrees(lon, lat, h);
    const occ = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, viewer.camera.positionWC);
    if (!occ.isPointVisible(p)) return null;
    const r = Cesium.SceneTransforms.worldToWindowCoordinates(scene, p, _w);
    return r ? { x: r.x, y: r.y } : null;
  }
  function fmtCoord(lat, lon) {
    return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? "E" : "W"}`;
  }
  function riverMidLabel(name, frac) {
    const r = riverIndex[name];
    if (!r) return null;
    const c = r.coordinates[Math.floor(r.coordinates.length * frac)];
    return { name, lon: c[0], lat: c[1] };
  }
  const window01 = (t, a, b, f = 0.4) => clamp01((t - a) / f) * (1 - clamp01((t - (b - f)) / f));
  function pin(out, name, lon, lat, h, opacity) {
    if (opacity <= 0.01) return;
    const sp = toScreen(lon, lat, h);
    if (sp) out.push({ name, coords: fmtCoord(lat, lon), x: sp.x, y: sp.y - 70, opacity });
  }
  function computeLabels(t) {
    const out = [];
    if (t < 3.6) {
      const fade = window01(t, 1.6, 3.6, 0.5);
      for (const d of [riverMidLabel("Ganga", 0.45), riverMidLabel("Yamuna", 0.4), riverMidLabel("Brahmaputra", 0.62),
        riverMidLabel("Narmada", 0.5), riverMidLabel("Krishna", 0.5), riverMidLabel("Godavari", 0.55), { name: "Mula–Mutha", lon: 73.86, lat: 18.53 }]) {
        if (d) pin(out, d.name, d.lon, d.lat, 0, fade);
      }
    } else if (t < 6.2) {
      pin(out, "Devprayag · Ganga begins", DEVPRAYAG[0], DEVPRAYAG[1], 470, window01(t, 4.6, 6.2));
    } else if (t < 11) {
      const p = pointAt(gorge, gorge.s[gorge.s.length - 1] - 80);
      pin(out, "Ganga · Lakshman Jhula, Rishikesh", p.lon, p.lat, p.h, window01(t, 9.9, 11.0, 0.3));
    } else if (t < 16 && spill) {
      const c = spill.crestCentre;
      pin(out, "Khadakwasla Dam · spillway (simulation)", c.lon, c.lat, c.h + 10, window01(t, 12.0, 13.8));
      const m = pointAt(mutha, 2000);
      pin(out, "Mutha River", m.lon, m.lat, m.h, window01(t, 14.6, 16.0));
    } else if (t >= 19 && t < 22) {
      const p = pointAt(mulaMutha, 120);
      pin(out, "Mula–Mutha · Sangam, Pune", p.lon, p.lat, p.h, window01(t, 19.0, 21.0));
    }
    return out;
  }

  // ---------- Frame ----------
  const baseDate = Cesium.JulianDate.fromIso8601("2026-03-20T00:00:00Z");
  const _tmpJd = new Cesium.JulianDate();
  const _target = new Cesium.Cartesian3();

  function activeSceneIndex(t) {
    for (let i = 0; i < SCENES.length; i++) if (t >= SCENES[i].start && t < SCENES[i].end) return i;
    return SCENES.length - 1;
  }

  function applyTime(t) {
    const hrs = sampleKeys(sunKeys, t)[0];
    Cesium.JulianDate.addSeconds(baseDate, hrs * 3600, _tmpJd);
    viewer.clock.currentTime = _tmpJd;

    const v = sampleKeys(camKeys, t);
    Cesium.Cartesian3.fromDegrees(v[0], v[1], v[2], Cesium.Ellipsoid.WGS84, _target);
    viewer.camera.lookAt(_target, new Cesium.HeadingPitchRange(Cesium.Math.toRadians(v[3]), Cesium.Math.toRadians(v[4]), Math.exp(v[5])));

    const rng = Math.exp(v[5]);
    // Atmosphere only on the orbital approach. River and dam shots stay clear, not hazed.
    scene.fog.enabled = rng > 8e5;
    scene.fog.density = rng > 8e5 ? 0.00004 : 0;
    globe.showGroundAtmosphere = rng > 5e5;
    overviewEntities.forEach((e) => (e.show = t < 4.6));
    const near = rng < 8e4;
    ribbons.forEach((r) => (r.primitive.show = near));

    // Spillway release ramps in as the camera arrives (simulation), stays on through the downstream tracking.
    if (spill) {
      spill.material.uniforms.u_flow = smooth(clamp01((t - 11.6) / 0.6));
      spill.primitive.show = t > 11.4 && t < 16.4;
    }
    const lithoFade = clamp01(Math.min((t - 21.88) / 0.28, (23.47 - t) / 0.24));
    if (lithologyLayer) {
      lithologyLayer.alpha = 0.82 * smooth(lithoFade);
      lithologyLayer.show = t >= 21.88 && t < 23.47;
      if (lithologyLayer.show && scene.imageryLayers.indexOf(lithologyLayer) !== scene.imageryLayers.length - 1) scene.imageryLayers.raiseToTop(lithologyLayer);
    }
    if (floodSamples) {
      const floodFade = smooth(clamp01(Math.min((t - 23.35) / 0.2, (24.7 - t) / 0.2)));
      const sampleColor = floodSampleColor.withAlpha(0.48 * floodFade);
      for (let i = 0; i < floodSamples.length; i++) floodSamples.get(i).color = sampleColor;
      floodSamples.show = t >= 23.35 && t < 24.7 && near;
    }

    // The Rishikesh → Khadakwasla jump is a hard cut between two photographs.
    // A black veil here was a plain colour covering the film.
    if (cutEl) cutEl.style.opacity = "0";

    // Underwater cut (Three.js canvas over Cesium): fade in from the Mutha surface, back out over the Pune reach.
    // Dissolve in before the globe camera is down at the water surface, where the satellite photo is magnified
    // into blurry / blocky pixels; dissolve out once the Pune reach is a sharp aerial view again.
    const uwA = Math.min(clamp01((t - 15.25) / 0.5), 1 - clamp01((t - 18.55) / 0.45));
    underwaterCanvas.style.opacity = String(uwA);
    underwaterCanvas.style.visibility = uwA > 0.002 ? "visible" : "hidden";
    if (uwA > 0.002) underwater?.render(clamp01((t - 15.75) / 3.25), t);
  }

  function frame(now) {
    if (!active || destroyed) return;
    rafId = requestAnimationFrame(frame);
    // Wall-clock timeline, but a single late frame cannot skip a stretch of the shot.
    const dt = Math.max(0, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!ready) {
      // Loading: the live globe (opening view) renders behind the loading indicator.
      scene.render();
      return;
    }

    if (captureMode) {
      currentTime = captureT;
      isPlaying = false;
    } else if (debugAt != null) {
      // Verification mode (?t=): hold the film at one instant and render sparsely so software-GL capture stays responsive.
      currentTime = debugAt;
      isPlaying = false;
      if (now - lastDebugRender < 700) return;
      lastDebugRender = now;
    } else if (isPlaying) {
      let proposed = Math.min(TOTAL_DURATION, playAnchorFilm + ((now - playAnchorWall) / 1000) * playbackSpeed);
      // Later scenes need the surveyed profiles. Hold on the moving Himalaya view, never on a blank frame.
      if (!pathReady && proposed > 2.8) {
        proposed = 2.8;
        playAnchorFilm = 2.8;
        playAnchorWall = now;
      }
      // The previous presented frame had no satellite texture. Keep the last photograph on screen
      // while the next tiles arrive, instead of filling the film with a flat colour.
      const uwOn = parseFloat(underwaterCanvas.style.opacity || "0") > 0.15;
      if (globeShown && !uwOn && !lastFrameHadPhoto && lastPhotoT > 0.15 && now - releasedAt > 4000) {
        if (!solidSince) solidSince = now;
        if (now - solidSince < 2500) {
          proposed = lastPhotoT;
          playAnchorFilm = lastPhotoT;
          playAnchorWall = now;
        } else {
          releasedAt = now;
          solidSince = 0;
        }
      }
      currentTime = proposed;
      if (currentTime >= TOTAL_DURATION) {
        isPlaying = false;
        if (!completionSent) {
          completionSent = true;
          window.dispatchEvent(new CustomEvent("rivereye-film-complete", { detail: { wallSeconds: (now - filmStartWall) / 1000 } }));
        }
      }
    }

    const tA = performance.now();
    // Begin scene-specific work shortly before its preview rather than during the opening globe.
    // Fish model + textures (~3 MB) must be ready before the 16 s cut — loading at 13.8 s left the cut without fish.
    if (currentTime >= 1 && !underwater) {
      const scene = requestUnderwater();
      scene.ready.then(() => { scene.warmup(); underwaterReady = true; }).catch((err) => console.warn("underwater scene unavailable", err));
    }
    if (currentTime >= 21.35 && !lithologyProviderReady) requestLithology();
    if (currentTime >= 22.9 && !floodSamplesReady) requestFloodSamples();
    applyTime(currentTime);
    const tB = performance.now();
    // Capture: animations follow film time (one step per recorded frame), not wall-clock.
    let sprayDt = Math.min(dt, 0.05) * (isPlaying || debugAt != null ? 1 : 0.0001);
    if (captureMode) {
      sprayDt = Math.max(0, Math.min(0.05, currentTime - captureSprayT));
      captureSprayT = currentTime;
    }
    spray?.update(sprayDt, (currentTime > 5.8 && currentTime < 11.2) || (currentTime > 11.8 && currentTime < 16.3));
    const shaderT = captureMode ? currentTime : (now / 1000) % 1000;
    if (spill) spill.material.uniforms.u_time = shaderT;
    ribbons.forEach((r) => {
      r.material.uniforms.u_time = shaderT;
    });
    const tC = performance.now();
    scene.render();
    const uwShowing = parseFloat(underwaterCanvas.style.opacity || "0") > 0.15;
    lastFrameHadPhoto = frameHasImagery() || uwShowing;
    if (!globeShown) {
      if (lastFrameHadPhoto || now - globeHiddenAt > 10000) {
        globeShown = true;
        container.style.visibility = "visible";
      }
    }
    if (lastFrameHadPhoto) {
      lastPhotoT = currentTime;
      solidSince = 0;
    }
    const tD = performance.now();
    if (PERF && tD - tA > 150) console.warn(`[perf] slow frame t=${currentTime.toFixed(2)} apply=${(tB - tA).toFixed(0)} spray+uniforms=${(tC - tB).toFixed(0)} render=${(tD - tC).toFixed(0)} ms`);

    const idx = activeSceneIndex(currentTime);
    riverAudio.setUnderwater(idx === 4);
    riverAudio.setIntensity([0.05, 0.6, 0.9, 0.95, 0.5, 0.5, 0.4][idx] ?? 0.4, idx === 0 ? 0.4 : 0.45);

    const stateSceneIndex = activeSceneIndex(currentTime);
    if (stateSceneIndex !== lastSceneIndex || now - lastUiUpdate >= 125) {
    lastSceneIndex = stateSceneIndex;
    lastUiUpdate = now;
    onUpdateState?.({
      ready: true,
      currentTime,
      totalDuration: TOTAL_DURATION,
      isPlaying,
      playbackSpeed,
      activeSceneIndex: stateSceneIndex,
      activeScene: SCENES[stateSceneIndex],
      labels: computeLabels(currentTime),
      riverLabel: RIVER_LABELS.find(([a, b]) => currentTime >= a && currentTime < b) ?? null,
      analysisPreview: currentTime >= 22 && currentTime < 23.35 ? "lithology" : currentTime >= 23.35 && currentTime < 24.7 ? "flood" : null,
    });
    }
  }

  function frameHasImagery() {
    const tiles = globe._surface && globe._surface._tilesToRender;
    if (!tiles) return true;
    if (!tiles.length) return false;
    let photos = 0;
    for (let i = 0; i < tiles.length; i++) {
      const imagery = tiles[i].data && tiles[i].data.imagery;
      if (!imagery) continue;
      for (let j = 0; j < imagery.length; j++) {
        const ready = imagery[j].readyImagery;
        if (ready && ready.texture) { photos++; break; }
      }
    }
    return photos >= 3 && photos / tiles.length >= 0.5;
  }
  let lastPhotoT = 0;
  let solidSince = 0;
  let releasedAt = 0;
  let lastFrameHadPhoto = false;
  let globeShown = false;
  let globeHiddenAt = performance.now();
  container.style.visibility = "hidden";

  function onResize() {
    fitResolution();
    underwater?.resize(container.clientWidth, container.clientHeight);
  }
  window.addEventListener("resize", onResize);

  function armPrefetch() {
    if (destroyed || camKeys.length < 2) return;
    prefetcher?.stop();
    const poses = [];
    const end = pathReady ? TOTAL_DURATION : 2.8;
    for (let t = 0; t <= end; t += 0.5) {
      const v = sampleKeys(camKeys, t);
      poses.push({ t, lon: v[0], lat: v[1], heading: v[3], pitch: v[4], range: Math.exp(v[5]) });
    }
    prefetcher = createTilePrefetcher(poses, {
      viewportH: container.clientHeight * (window.devicePixelRatio || 1) * QP.resScale,
      sse: QP.sse,
      concurrency: SMALL_PC ? 3 : 4,
    });
    prefetcher.start();
    console.info("[cine] prefetch tiles", prefetcher.progress().total);
  }

  (async () => {
    try {
      onProgress?.("Preparing real Earth…", 2);
      if (PERF) console.warn(`[perf] quality=${QUALITY}`);
      // Opening poses do not need river profiles, so the camera can move before Mula–Mutha terrain is sampled.
      camKeys = [
        { t: 0.0, v: [73.2, 22.0, 0, 28, -58, LR(3.6e6)] },
        { t: 1.35, v: [77.6, 27.4, 0, 18, -46, LR(9.2e5)] },
        { t: 2.8, v: [79.15, 30.15, 1600, 208, -36, LR(2.8e5)] },
      ];
      sunKeys = [{ t: 0, v: [5.0] }, { t: 3, v: [4.2] }, { t: 26, v: [12.4] }];
      applyTime(0);
      scene.render();
      markBoot("firstPose");
      const pipeline = (async () => {
        const tI0 = performance.now();
        await loadData();
        markBoot("data");
        if (PERF) console.warn(`[perf] loadData ${(performance.now() - tI0).toFixed(0)} ms`);
        if (destroyed) return;
        onProgress?.("Planning camera path…", 75);
        const tI1 = performance.now();
        await buildKeys();
        markBoot("keys");
        if (PERF) console.warn(`[perf] buildKeys ${(performance.now() - tI1).toFixed(0)} ms`);
        pathReady = true;
        armPrefetch();
        markBoot("pathReady");
        console.info("[cine] boot", bootMarks);
      })();
      pipeline.catch((err) => {
        // Keep the live satellite. A terrain timeout must not restart the journey title.
        console.error("RIVER.EYE path failed", err);
        onProgress?.("Satellite view ready", 80);
      });
      onResize();
      const waitUntil = (cond, capMs) =>
        new Promise((res) => {
          const t0 = performance.now();
          const chk = () => {
            if (destroyed) return res();
            cond() || performance.now() - t0 > capMs ? res() : setTimeout(chk, 80);
          };
          chk();
        });
      if (debugAt != null || captureMode) {
        await pipeline;
        applyTime(debugAt ?? 0);
        await waitUntil(() => { scene.render(); return globe.tilesLoaded; }, 15000);
      } else {
        // Stay hidden until a real satellite texture is on the globe. A terrain-only frame is the flat colour.
        await waitUntil(() => frameHasImagery(), 10000);
      }
      if (destroyed) return;
      markBoot("play");
      ready = true;
      lastFrame = performance.now();
      if (captureMode) {
        window.__filmCapture = {
          duration: TOTAL_DURATION,
          setTime(t) {
            captureT = Math.max(0, Math.min(TOTAL_DURATION, Number(t) || 0));
          },
          /**
           * Frame complete: no visible tile is waiting (high/medium load queues empty, no tile download in
           * flight) and, around the underwater cut, the fish scene is ready. globe.tilesLoaded alone never
           * turns true here: a few low-priority ancestor tiles stay queued indefinitely.
           */
          settled() {
            const needFish = captureT >= 15 && captureT < 19.1;
            if (needFish && !underwaterReady) return false;
            if (globe.tilesLoaded) return true;
            const sf = globe._surface;
            const visibleQueued = (sf?._tileLoadQueueHigh?.length ?? 0) + (sf?._tileLoadQueueMedium?.length ?? 0);
            const inFlight = Cesium.RequestScheduler?.statistics?.numberOfActiveRequests ?? 0;
            return visibleQueued === 0 && inFlight === 0;
          },
          debug() {
            const sf = globe._surface;
            return {
              tilesLoaded: globe.tilesLoaded,
              qHigh: sf?._tileLoadQueueHigh?.length, qMed: sf?._tileLoadQueueMedium?.length, qLow: sf?._tileLoadQueueLow?.length,
              render: sf?._tilesToRender?.length, photo: frameHasImagery(),
              prefetch: prefetcher?.progress?.(), inFlight: Cesium.RequestScheduler?.statistics?.numberOfActiveRequests,
            };
          },
        };
      } else if (debugAt == null) {
        filmStartWall = lastFrame;
        reanchor(0);
        isPlaying = true;
        window.dispatchEvent(new Event("rivereye-film-start"));
      }
      onProgress?.("Ready", 100);
      window.__riverEye = {
        viewer, Cesium, get t() { return currentTime; }, seek, pause, play, globe,
        restart, setActive, setQuality, getQuality: () => currentQuality,
        cameraPose: () => sampleKeys(camKeys, currentTime),
        bootMarks: () => ({ ...bootMarks, pathReady }),
        previewStatus: () => ({ lithologyReady: !!lithologyLayer?.imageryProvider, lithologyAlpha: lithologyLayer?.alpha ?? 0,
          lithologyIndex: lithologyLayer ? viewer.imageryLayers.indexOf(lithologyLayer) : -1,
          lithologySize: lithologyLayer ? [lithologyLayer.imageryProvider.tileWidth, lithologyLayer.imageryProvider.tileHeight] : null,
          lithologyLayerShown: lithologyLayer?.show ?? false,
          floodSampleCount: floodSamples?.length ?? 0, floodSamplesVisible: floodSamples?.show ?? false }),
        tilesLoaded: () => globe.tilesLoaded,
        prefetchProgress: () => prefetcher?.progress() ?? { done: 0, total: 0 },
      };
    } catch (err) {
      console.error("RIVER.EYE init failed", err);
      onProgress?.("Failed: " + (err?.message || err), -1);
    }
  })();
  rafId = requestAnimationFrame(frame);

  // ---------- Controls ----------
  function reanchor(t) {
    currentTime = Math.max(0, Math.min(TOTAL_DURATION, t));
    playAnchorFilm = currentTime;
    playAnchorWall = performance.now();
  }
  const play = () => { reanchor(currentTime); isPlaying = true; };
  const pause = () => { isPlaying = false; };
  function restart() {
    completionSent = false;
    filmStartWall = performance.now();
    playbackSpeed = 1;
    reanchor(0);
    isPlaying = true;
    setActive(true);
    window.dispatchEvent(new Event("rivereye-film-restart"));
  }
  function setActive(value) {
    active = Boolean(value);
    if (active && !rafId && !destroyed) {
      lastFrame = performance.now();
      rafId = requestAnimationFrame(frame);
    } else if (!active && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
      underwaterCanvas.style.visibility = "hidden";
    }
  }
  let currentQuality = QUALITY;
  function applyQuality(tier) {
    const profiles = {
      low: { sse: 1.5, cache: TILE_CACHE, scale: 1, msaa: 2 },
      balanced: { sse: 1.15, cache: TILE_CACHE, scale: 1, msaa: 2 },
      high: { sse: 1.0, cache: TILE_CACHE, scale: 1, msaa: 2 },
    };
    const profile = profiles[tier];
    if (!profile) return false;
    currentQuality = tier;
    globe.maximumScreenSpaceError = profile.sse;
    globe.tileCacheSize = profile.cache;
    viewer.useBrowserRecommendedResolution = false;
    if (scene.msaaSamples !== undefined) scene.msaaSamples = profile.msaa;
    fitResolution();
    if (scene.postProcessStages?.fxaa) scene.postProcessStages.fxaa.enabled = false;
    return true;
  }
  function setQuality(tier) {
    return applyQuality(tier);
  }
  function togglePlay() {
    if (currentTime >= TOTAL_DURATION) { restart(); }
    else { reanchor(currentTime); isPlaying = !isPlaying; }
    return isPlaying;
  }
  const setSpeed = (sp) => { reanchor(currentTime); playbackSpeed = sp; };
  const seek = (t) => reanchor(t);
  function jumpToScene(i) {
    const s = SCENES[Math.max(0, Math.min(SCENES.length - 1, i))];
    if (s) seek(s.start + 0.02);
  }

  return {
    play, pause, togglePlay, setSpeed, seek, jumpToScene, restart, setActive, setQuality,
    getCurrentTime: () => currentTime,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      prefetcher?.stop();
      if (lithologyObjectUrl) URL.revokeObjectURL(lithologyObjectUrl);
      window.removeEventListener("resize", onResize);
      lithologyWorker?.terminate();
      lithologyWorker = null;
      underwater?.dispose();
      if (!viewer.isDestroyed()) viewer.destroy();
    },
  };
}