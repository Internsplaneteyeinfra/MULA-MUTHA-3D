/**
 * RIVER.EYE cinematic director — 25.0 s, single CesiumJS renderer for everything above water.
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
 *  Timeline: 0–4 Earth→India · 4–8 Himalaya · 8–12 Ganga source · 12–18 Godavari (Nashik) + Mula–Mutha (Pune)
 *            18–21 underwater · 21–25 river landscape + branding.
 */
import { riverAudio } from "./audio/AudioSynthesizer.js";
import { createTerrariumTerrainProvider, sampleTerrariumHeight } from "./cesium/TerrariumTerrainProvider.js";
import { conditionRiverProfile, createRiverPrimitive } from "./cesium/RiverRibbons.js";
import { createUnderwaterScene } from "./scenes/UnderwaterFishScene.js";

export const SCENES = [
  { id: "earth_to_india", number: "01", name: "Real Earth to India", subName: "Satellite imagery on a WGS84 globe", start: 0, end: 4, color: "#06b6d4" },
  { id: "himalayas", number: "02", name: "Himalayan Terrain", subName: "SRTM/NASADEM elevation, Gangotri region", start: 4, end: 8, color: "#38bdf8" },
  { id: "river_source", number: "03", name: "River Source", subName: "Ganga from Gaumukh (HydroRIVERS course)", start: 8, end: 12, color: "#10b981" },
  { id: "major_rivers", number: "04", name: "Major Indian Rivers", subName: "Godavari at Nashik · Mula–Mutha at Pune", start: 12, end: 18, color: "#84cc16" },
  { id: "underwater_life", number: "05", name: "Underwater Life", subName: "Freshwater fish, illustrative", start: 18, end: 21, color: "#f97316" },
  { id: "final_landing", number: "06", name: "River Intelligence & Final Landing", subName: "See the river. Understand the flow. Protect the future.", start: 21, end: 25, color: "#eab308" },
];
export const TOTAL_DURATION = 25.0;

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
  const dt = k2.t - k1.t;
  const u = (t - k1.t) / dt;
  const u2 = u * u, u3 = u2 * u;
  return k1.v.map((_, c) => {
    const m1 = ((k2.v[c] - k0.v[c]) / Math.max(1e-6, k2.t - k0.t)) * dt;
    const m2 = ((k3.v[c] - k1.v[c]) / Math.max(1e-6, k3.t - k1.t)) * dt;
    return (2 * u3 - 3 * u2 + 1) * k1.v[c] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * k2.v[c] + (u3 - u2) * m2;
  });
}

function bearingDeg(a, b) {
  const la1 = (a[1] * Math.PI) / 180, la2 = (b[1] * Math.PI) / 180, dl = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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

export function createCinematicDirector({ container, underwaterCanvas, creditContainer, onUpdateState, onProgress }) {
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

  const urlT = new URLSearchParams(window.location.search).get("t");
  const debugAt = urlT != null ? parseFloat(urlT) : null; // ?t=12.5 freezes the film at that time (verification)

  // ---------- Cesium viewer ----------
  const viewer = new Cesium.Viewer(container, {
    baseLayer: false,
    baseLayerPicker: false, geocoder: false, homeButton: false, infoBox: false, navigationHelpButton: false,
    sceneModePicker: false, animation: false, timeline: false, fullscreenButton: false, selectionIndicator: false,
    shouldAnimate: false, scene3DOnly: true, requestRenderMode: false, creditContainer,
    skyAtmosphere: new Cesium.SkyAtmosphere(),
    contextOptions: { webgl: { alpha: false, preserveDrawingBuffer: true } },
    msaaSamples: 4,
  });
  const scene = viewer.scene;
  const globe = scene.globe;
  scene.terrainProvider = createTerrariumTerrainProvider(Cesium);
  globe.enableLighting = true;
  globe.depthTestAgainstTerrain = true;
  globe.showGroundAtmosphere = true;
  globe.dynamicAtmosphereLighting = true;
  globe.dynamicAtmosphereLightingFromSun = true;
  globe.maximumScreenSpaceError = 1.6;
  globe.baseColor = Cesium.Color.fromCssColorString("#0b2a4a"); // ocean tone behind imagery while tiles load
  globe.preloadSiblings = true;
  scene.highDynamicRange = false;
  scene.fog.enabled = true;
  scene.fog.density = 0.00018;
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
  });

  const underwater = createUnderwaterScene(underwaterCanvas);

  // ---------- Data: boundary, rivers, ribbons ----------
  const overviewEntities = []; // glow lines + boundary, shown only while far from the ground
  const ribbons = []; // { primitive, material }
  const riverIndex = {}; // name -> { coords, ... }
  let godavari = null, ganga = null, mulaMutha = null;
  const keyLabels = []; // world anchors for labels

  async function loadData() {
    const [rivJson, bnd, mm] = await Promise.all([
      fetch("/data/rivers/hydrorivers_india.json").then((r) => r.json()),
      fetch("/data/rivers/india_boundary_ne10m.geojson").then((r) => r.json()),
      fetch("/data/river.geojson").then((r) => r.json()),
    ]);
    if (destroyed) return;
    onProgress?.("Loading boundary & river geometry…", 10);

    // India boundary (Natural Earth 10 m, India point-of-view) — main polygon + islands.
    for (const poly of bnd.geometry.coordinates) {
      const flat = poly[0].flat();
      overviewEntities.push(
        viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(flat),
            width: 1.6,
            material: Cesium.Color.WHITE.withAlpha(0.8),
            clampToGround: false,
            arcType: Cesium.ArcType.GEODESIC,
          },
        })
      );
    }

    // All seven rivers as glow lines for the overview phase (real HydroRIVERS courses; Mula–Mutha from KML+HydroRIVERS).
    const rivers = rivJson.rivers;
    for (const [name, r] of Object.entries(rivers)) {
      riverIndex[name] = r;
      const flat = r.coordinates.flat();
      overviewEntities.push(
        viewer.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(flat),
            width: name === "Mula-Mutha" ? 5 : 4,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.22,
              color: Cesium.Color.fromCssColorString(RIVER_COLORS[name]),
            }),
            clampToGround: true,
          },
        })
      );
    }

    // Featured reaches -> terrain-conforming ribbons.
    onProgress?.("Sampling terrain along rivers…", 30);
    const cut = (coords, km) => {
      let acc = 0;
      const out = [coords[0]];
      for (let i = 1; i < coords.length; i++) {
        const dx = (coords[i][0] - coords[i - 1][0]) * Math.cos((coords[i][1] * Math.PI) / 180) * 111.32;
        const dy = (coords[i][1] - coords[i - 1][1]) * 110.57;
        acc += Math.hypot(dx, dy);
        out.push(coords[i]);
        if (acc > km) break;
      }
      return out;
    };
    const mmLine = mm.features.find((f) => f.id === "kml_river_centerline").geometry.coordinates.map((c) => [c[0], c[1]]);

    [ganga, godavari, mulaMutha] = await Promise.all([
      conditionRiverProfile(cut(rivers.Ganga.coordinates, 60), { stepM: 120, maxHalf: 22, zoom: 13, snapM: 700 }),
      conditionRiverProfile(cut(rivers.Godavari.coordinates, 85), { stepM: 120, maxHalf: 80, zoom: 13, snapM: 500 }),
      conditionRiverProfile(mmLine, { stepM: 40, maxHalf: 38, zoom: 13, snapM: 0, minWidth: 18 }),
    ]);
    if (destroyed) return;
    onProgress?.("Building river surfaces…", 60);
    // HydroRIVERS courses come from a ~500 m DEM and can sit tens–hundreds of metres off the channel visible in the
    // imagery, so those ribbons are drawn as a translucent overlay (the imagery's real river stays visible).
    // The Mula–Mutha reach uses the surveyed KML centerline and is drawn opaque.
    for (const [prof, opacity, lift] of [[ganga, 0.5, 4], [godavari, 0.55, 4], [mulaMutha, 0.95, 1.2]]) {
      const built = createRiverPrimitive(Cesium, prof, { heightOffset: lift, opacity });
      if (!built) continue;
      const primitive = new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({ geometry: built.geometry }),
        appearance: built.appearance,
        asynchronous: false,
        compressVertices: false,
      });
      scene.primitives.add(primitive);
      ribbons.push({ primitive, material: built.material, profile: prof });
    }
  }

  // ---------- Camera keyframes ----------
  // v = [lon, lat, targetHeightM, headingDeg, pitchDeg, log(rangeM)]
  let camKeys = [];
  let sunKeys = []; // v = [utcHours since 2026-03-20T00:00Z]
  const LR = Math.log;

  async function buildKeys() {
    const keys = [];
    const push = (t, lon, lat, h, hd, pitch, range) => keys.push({ t, v: [lon, lat, h, hd, pitch, LR(range)] });

    // S0: deep space -> India overview
    push(0.0, 62, 14, 0, 0, -90, 26e6);
    push(1.6, 72, 19, 0, 0, -88, 9.0e6);
    push(4.0, 80.0, 22.5, 0, 2, -58, 3.4e6);

    // S1: Himalaya approach (Gangotri / Gaumukh)
    push(5.4, 79.3, 29.9, 1500, 10, -42, 5.2e5);
    push(6.9, 79.15, 30.75, 3500, 18, -26, 7.0e4);
    // S2: follow the Ganga from Gaumukh downstream
    let hd = 18;
    const seg = (profile, t0, t1, d0, d1, range, pitch, lookAheadM = 2500, hOff = 0, extra = 0) => {
      const n = Math.max(2, Math.round((t1 - t0) * 3));
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const d = lerp(d0, d1, k);
        const p = pointAt(profile, d);
        const q = pointAt(profile, d + lookAheadM);
        hd = unwrap(hd, bearingDeg([p.lon, p.lat], [q.lon, q.lat]));
        push(t0 + (t1 - t0) * k, p.lon, p.lat, p.h + hOff, hd, pitch, range);
      }
    };
    // 8.0 ... 12.0 : Ganga source reach (~14 km traversed, camera low over the stream)
    {
      const p0 = pointAt(ganga, 0);
      const q0 = pointAt(ganga, 2500);
      hd = unwrap(hd, bearingDeg([p0.lon, p0.lat], [q0.lon, q0.lat]));
      push(8.0, p0.lon, p0.lat, p0.h, hd, -24, 5200);
      seg(ganga, 8.6, 12.0, 600, 16000, 1700, -17, 1800, 0);
    }

    // S3a: Godavari from Trimbakeshwar toward Nashik
    seg(godavari, 12.6, 14.4, 0, 38000, 2400, -20, 3500, 0);
    // transit to Pune: rise -> descend (explicit keys keep a smooth, fast arc)
    push(15.1, 74.1, 19.6, 600, 150, -52, 2.2e5);
    // S3b: Mula–Mutha through Pune (flows west->east from Sangam)
    seg(mulaMutha, 15.9, 17.8, 0, 14500, 1400, -18, 900, 0);
    hd = keys[keys.length - 1].v[3];

    // S4: dip toward the water surface for the cut (water level here ≈ profile height)
    {
      const p = pointAt(mulaMutha, 14500);
      const qv = pointAt(mulaMutha, 15500);
      const h2 = unwrap(hd, bearingDeg([p.lon, p.lat], [qv.lon, qv.lat]));
      push(18.5, p.lon, p.lat, p.h, h2, -6, 55);
      push(21.0, p.lon, p.lat, p.h, h2 + 20, -3, 45);
    }
    // S5: pull up over the Pune reach (golden hour), orbiting slowly
    {
      const p = pointAt(mulaMutha, 7000);
      push(22.2, p.lon, p.lat, p.h, 80, -30, 2600);
      push(25.0, p.lon, p.lat, p.h, 112, -36, 7500);
    }
    // Terrain clearance: for every low key, steepen the pitch (and if needed lengthen the range) until the camera and
    // the whole line of sight to the target stay above the DEM. Prevents the camera ending up inside valley walls.
    // All keys are checked in parallel on zoom-10 tiles (~150 m cells): enough for clearance, fast to load.
    await Promise.all(
      keys.map(async (k) => {
        const [lon, lat, h, hdg] = k.v;
        let pitch = k.v[4];
        let range = Math.exp(k.v[5]);
        if (range > 2.5e5) return;
        for (let iter = 0; iter < 14; iter++) {
          const pr = (Math.abs(pitch) * Math.PI) / 180;
          const D = range * Math.cos(pr);
          const H = range * Math.sin(pr);
          const fs = [];
          for (let f = 0.15; f <= 1.0001; f += 0.085) fs.push(f);
          const gs = await Promise.all(
            fs.map((f) => {
              const q = destPoint(lon, lat, (hdg + 180) % 360, D * f);
              return sampleTerrariumHeight(q[0], q[1], 10).catch(() => -1e9);
            })
          );
          const ok = fs.every((f, i) => gs[i] + 60 + 0.08 * D * f <= h + H * f);
          if (ok) break;
          if (pitch > -72) pitch -= 5;
          else range *= 1.2;
        }
        k.v[4] = pitch;
        k.v[5] = Math.log(range);
      })
    );
    camKeys = keys;

    // Sun: time of day as UTC hours on 2026-03-20 (equinox: sun ~ overhead the equator, good global light).
    // 05:30 UTC = 11:00 IST (India lit, terminator visible at the edges); Himalaya 02:45 UTC = early morning;
    // Final 12:15 UTC = 17:45 IST golden hour over Pune.
    sunKeys = [
      { t: 0, v: [5.0] }, { t: 4, v: [4.2] }, { t: 6, v: [2.9] }, { t: 11, v: [3.1] },
      { t: 14, v: [4.0] }, { t: 17, v: [6.0] }, { t: 21, v: [11.2] }, { t: 25, v: [12.6] },
    ];
  }

  // ---------- Labels ----------
  const _w = new Cesium.Cartesian2();
  function toScreen(lon, lat, h) {
    const p = Cesium.Cartesian3.fromDegrees(lon, lat, h);
    // hide if on far side of globe
    const camPos = viewer.camera.positionWC;
    const occ = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, camPos);
    if (!occ.isPointVisible(p)) return null;
    const r = Cesium.SceneTransforms.worldToWindowCoordinates(scene, p, _w);
    if (!r) return null;
    return { x: r.x, y: r.y };
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
  function computeLabels(t) {
    const out = [];
    if (t < 6.2) {
      const fade = t < 3.0 ? clamp01((t - 2.4) / 0.6) : 1 - clamp01((t - 5.4) / 0.8);
      if (fade > 0.01) {
        const defs = [
          riverMidLabel("Ganga", 0.45), riverMidLabel("Yamuna", 0.4), riverMidLabel("Brahmaputra", 0.62),
          riverMidLabel("Narmada", 0.5), riverMidLabel("Krishna", 0.5), riverMidLabel("Godavari", 0.55),
        ];
        defs.push({ name: "Mula–Mutha", lon: 73.86, lat: 18.53 });
        for (const d of defs) {
          if (!d) continue;
          const sp = toScreen(d.lon, d.lat, 0);
          if (sp) out.push({ name: d.name, coords: fmtCoord(d.lat, d.lon), x: sp.x, y: sp.y, opacity: fade });
        }
      }
    } else if (t >= 8.3 && t < 11.7) {
      const p = pointAt(ganga, 0);
      const sp = toScreen(p.lon, p.lat, p.h);
      if (sp) out.push({ name: "Ganga · Gaumukh", coords: fmtCoord(p.lat, p.lon), x: sp.x, y: sp.y - 70, opacity: 1 - clamp01((t - 11) / 0.7) });
    } else if (t >= 12.6 && t < 14.9) {
      const p = pointAt(godavari, 34000);
      const sp = toScreen(p.lon, p.lat, p.h);
      if (sp) out.push({ name: "Godavari · Nashik", coords: fmtCoord(p.lat, p.lon), x: sp.x, y: sp.y - 70, opacity: clamp01((t - 12.8) / 0.5) * (1 - clamp01((t - 14.3) / 0.6)) });
    } else if (t >= 15.8 && t < 18.2) {
      const p = pointAt(mulaMutha, 3200);
      const sp = toScreen(p.lon, p.lat, p.h);
      if (sp) out.push({ name: "Mula–Mutha · Pune", coords: fmtCoord(p.lat, p.lon), x: sp.x, y: sp.y - 70, opacity: clamp01((t - 16.0) / 0.5) * (1 - clamp01((t - 17.6) / 0.6)) });
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
    // sun
    const hrs = sampleKeys(sunKeys, t)[0];
    Cesium.JulianDate.addSeconds(baseDate, hrs * 3600, _tmpJd);
    viewer.clock.currentTime = _tmpJd;

    // camera
    const v = sampleKeys(camKeys, t);
    Cesium.Cartesian3.fromDegrees(v[0], v[1], v[2], Cesium.Ellipsoid.WGS84, _target);
    viewer.camera.lookAt(_target, new Cesium.HeadingPitchRange(Cesium.Math.toRadians(v[3]), Cesium.Math.toRadians(v[4]), Math.exp(v[5])));

    // detail toggles by altitude: glow overview lines vanish when close, ribbons only when near
    const rng = Math.exp(v[5]);
    const showOverview = t < 7.6;
    overviewEntities.forEach((e) => (e.show = showOverview));
    const near = rng < 6e4 || t >= 8;
    ribbons.forEach((r) => (r.primitive.show = near));

    // underwater cross-fade (Three.js canvas over Cesium)
    const uwIn = clamp01((t - 18.35) / 0.55);
    const uwOut = 1 - clamp01((t - 20.45) / 0.55);
    const uwA = Math.min(uwIn, uwOut);
    underwaterCanvas.style.opacity = String(uwA);
    underwaterCanvas.style.visibility = uwA > 0.002 ? "visible" : "hidden";
    if (uwA > 0.002) underwater.render(clamp01((t - 18.2) / 3.0), t);
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0.0005, (now - lastFrame) / 1000));
    lastFrame = now;
    if (!ready) return;

    if (debugAt != null) {
      // Verification mode (?t=): hold the film at one instant and render sparsely so software-GL capture stays responsive.
      currentTime = debugAt;
      isPlaying = false;
      if (now - lastDebugRender < 700) return;
      lastDebugRender = now;
    } else if (isPlaying) {
      currentTime += dt * playbackSpeed;
      if (currentTime >= TOTAL_DURATION) {
        currentTime = TOTAL_DURATION;
        isPlaying = false;
        window.dispatchEvent(new Event("rivereye-film-complete"));
      }
    }

    applyTime(currentTime);
    ribbons.forEach((r) => {
      r.material.uniforms.u_time = (now / 1000) % 1000;
    });
    scene.render();

    const idx = activeSceneIndex(currentTime);
    if (idx === 4) riverAudio.setUnderwater(true);
    else riverAudio.setUnderwater(false);
    riverAudio.setIntensity(idx === 0 ? 0.05 : idx <= 2 ? 0.85 : idx === 3 ? 0.7 : idx === 4 ? 0.5 : 0.4, idx === 0 ? 0.4 : 0.45);

    onUpdateState?.({
      ready: true,
      currentTime,
      totalDuration: TOTAL_DURATION,
      isPlaying,
      playbackSpeed,
      activeSceneIndex: idx,
      activeScene: SCENES[idx],
      labels: computeLabels(currentTime),
    });
  }

  function onResize() {
    underwater.resize(container.clientWidth, container.clientHeight);
  }
  window.addEventListener("resize", onResize);

  (async () => {
    try {
      onProgress?.("Preparing real Earth…", 2);
      await loadData();
      if (destroyed) return;
      onProgress?.("Planning camera path…", 75);
      await buildKeys();
      await underwater.ready;
      if (destroyed) return;
      onResize();
      // Warm the tile cache for the opening frame
      applyTime(0);
      onProgress?.("Streaming imagery & terrain…", 85);
      const t0 = performance.now();
      await new Promise((res) => {
        const chk = () => (globe.tilesLoaded || performance.now() - t0 > 15000 ? res() : setTimeout(chk, 120));
        chk();
      });
      ready = true;
      isPlaying = debugAt == null;
      lastFrame = performance.now();
      onProgress?.("Ready", 100);
      window.__riverEye = { viewer, Cesium, get t() { return currentTime; }, seek, globe, tilesLoaded: () => globe.tilesLoaded };
    } catch (err) {
      console.error("RIVER.EYE init failed", err);
      onProgress?.("Failed: " + (err?.message || err), -1);
    }
  })();
  rafId = requestAnimationFrame(frame);

  // ---------- Controls ----------
  const play = () => { isPlaying = true; };
  const pause = () => { isPlaying = false; };
  function togglePlay() {
    if (currentTime >= TOTAL_DURATION) { currentTime = 0; isPlaying = true; }
    else isPlaying = !isPlaying;
    return isPlaying;
  }
  const setSpeed = (s) => { playbackSpeed = s; };
  const seek = (t) => { currentTime = Math.max(0, Math.min(TOTAL_DURATION, t)); };
  function jumpToScene(i) {
    const s = SCENES[Math.max(0, Math.min(SCENES.length - 1, i))];
    if (s) seek(s.start + 0.02);
  }

  return {
    play, pause, togglePlay, setSpeed, seek, jumpToScene,
    getCurrentTime: () => currentTime,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      underwater.dispose();
      if (!viewer.isDestroyed()) viewer.destroy();
    },
  };
}

