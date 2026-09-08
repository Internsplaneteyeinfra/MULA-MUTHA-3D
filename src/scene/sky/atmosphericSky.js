import * as THREE from "three";
import { state } from "../../state.js";
import { DEFAULT_SKY_PRESET, getSkyPreset, SKY_PRESETS } from "./skyPresets.js";

/**
 * Premium cinematic sky — single GPU sky-dome shader + optional soft cloud-shadow plane.
 * No volumetric raymarching. Designed for Overview daylight; hidden in true 2D GIS mode.
 */

const SKY_VERT = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(world.xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Keep sky at far plane
    gl_Position.z = gl_Position.w;
  }
`;

const SKY_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vWorldDir;

  uniform float uTime;
  uniform float uCloudDensity;
  uniform float uCloudSpeed;
  uniform float uAnimStrength;
  uniform float uAtmosphere;
  uniform float uHorizonHaze;
  uniform float uQuality; // 0 low · 1 medium · 2 high
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uSunDir;
  uniform float uSunWarmth;

  // Compact value noise + fbm (GPU-friendly, seamless enough for sky)
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.02 + vec2(17.1, 9.3);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float h = dir.y; // -1..1, zenith = 1

    // Slow atmospheric breathing (daylight-safe)
    float breath = sin(uTime * 0.015) * 0.5 + 0.5;
    float anim = breath * uAnimStrength * 0.08;

    vec3 top = uTop * (1.0 + anim * 0.04);
    vec3 mid = uMid * (1.0 + anim * 0.03);
    vec3 hor = mix(uHorizon, uHaze, 0.25 + anim * 0.5);

    // Multi-stop atmospheric gradient
    float t0 = smoothstep(-0.05, 0.12, h);
    float t1 = smoothstep(0.08, 0.42, h);
    float t2 = smoothstep(0.35, 0.92, h);
    vec3 col = mix(hor, mid, t0);
    col = mix(col, mid, t1);
    col = mix(col, top, t2);

    // Soft sun glow near horizon / sun direction (not a hard disc)
    float sunAmt = pow(max(0.0, dot(dir, normalize(uSunDir))), 8.0);
    sunAmt *= smoothstep(-0.05, 0.35, h);
    vec3 sunGlow = mix(vec3(1.0, 0.92, 0.78), vec3(1.0, 0.75, 0.45), uSunWarmth);
    col += sunGlow * sunAmt * (0.18 + uSunWarmth * 0.22);

    // Horizon atmospheric haze (blue-white, low opacity blend)
    float hazeBand = (1.0 - smoothstep(0.0, 0.38 + uHorizonHaze * 0.2, max(h, 0.0)));
    hazeBand *= uHorizonHaze * uAtmosphere;
    float hazeNoise = 1.0;
    if (uQuality > 0.5) {
      vec2 hz = dir.xz * 2.5 + vec2(uTime * 0.004 * uCloudSpeed, uTime * 0.0025);
      hazeNoise = 0.85 + 0.15 * noise(hz);
    }
    col = mix(col, uHaze, hazeBand * 0.55 * hazeNoise);

    // Procedural cloud layers (parallax via different speeds / scales)
    float cloudMask = 0.0;
    if (uQuality > 0.1 && uCloudDensity > 0.02 && h > -0.02) {
      float elev = smoothstep(-0.02, 0.55, h);
      // Project onto sky dome UV
      vec2 base = dir.xz / max(0.15, dir.y + 0.35);

      float spd = uCloudSpeed * 0.012; // ~90–180s feel when speed ~0.3–0.5
      // Layer 1 — large soft clouds (slow)
      vec2 uv1 = base * 1.15 + vec2(uTime * spd * 0.55, uTime * spd * 0.22);
      float c1 = fbm(uv1);
      c1 = smoothstep(0.48 - uCloudDensity * 0.22, 0.72, c1);

      float c2 = 0.0;
      float c3 = 0.0;
      if (uQuality > 0.5) {
        // Layer 2 — higher thin clouds (slightly faster)
        vec2 uv2 = base * 2.4 + vec2(-uTime * spd * 0.95, uTime * spd * 0.4);
        c2 = fbm(uv2 + 3.7);
        c2 = smoothstep(0.55 - uCloudDensity * 0.15, 0.78, c2) * 0.65;
      }
      if (uQuality > 1.5) {
        // Layer 3 — distant haze streaks
        vec2 uv3 = base * 0.7 + vec2(uTime * spd * 0.28, -uTime * spd * 0.18);
        c3 = fbm(uv3 + 11.0);
        c3 = smoothstep(0.5, 0.8, c3) * 0.35;
      }

      cloudMask = clamp(c1 * 0.85 + c2 + c3, 0.0, 1.0) * elev * uCloudDensity;
      // Soft white-blue cloud colour; darker underlit on flood weather via mid mix
      vec3 cloudCol = mix(vec3(0.92, 0.95, 0.98), mix(uMid, uHaze, 0.5), 0.22);
      col = mix(col, cloudCol, cloudMask * 0.72);
    }

    // Mild desaturation near horizon for depth
    float grey = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(grey), (1.0 - smoothstep(0.0, 0.5, h)) * 0.08 * uAtmosphere);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const SHADOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHADOW_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uDensity;
  uniform float uOpacity;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = (vUv - 0.5) * 4.0;
    float t = uTime * uSpeed * 0.01;
    float n = fbm(uv * 1.2 + vec2(t * 0.55, t * 0.28));
    float mask = smoothstep(0.45 - uDensity * 0.2, 0.78, n);
    // Soft edges, very low opacity — no flicker
    float a = mask * uOpacity * uDensity;
    a *= smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
    a *= smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
    gl_FragColor = vec4(0.18, 0.2, 0.24, a);
  }
`;

function qualityToFloat(q) {
  if (q === "low") return 0;
  if (q === "medium") return 1;
  return 2;
}

function resolveSkyQuality() {
  const sq = state.skyQuality;
  if (sq === "low" || sq === "medium" || sq === "high") return sq;
  return "high";
}

/**
 * @param {{
 *   scene: THREE.Scene,
 *   sun: THREE.DirectionalLight,
 *   hemi: THREE.HemisphereLight,
 *   fill: THREE.DirectionalLight,
 *   renderer: THREE.WebGLRenderer,
 *   bounds?: { cx: number, cz: number, spanX?: number, spanZ?: number },
 * }} opts
 */
export function createAtmosphericSky(opts) {
  const { scene, sun, hemi, fill, renderer, bounds } = opts;
  const cx = bounds?.cx ?? 0;
  const cz = bounds?.cz ?? 0;
  const span = Math.max(bounds?.spanX || 8000, bounds?.spanZ || 8000);

  const group = new THREE.Group();
  group.name = "atmosphericSky";

  const preset = getSkyPreset(state.skyPreset || DEFAULT_SKY_PRESET);
  const sunDir = new THREE.Vector3();

  const uniforms = {
    uTime: { value: 0 },
    uCloudDensity: { value: state.skyCloudDensity ?? preset.cloudDensity },
    uCloudSpeed: { value: state.skyCloudSpeed ?? 0.35 },
    uAnimStrength: { value: state.skyAnimStrength ?? preset.animStrength },
    uAtmosphere: { value: state.skyAtmosphere ?? preset.atmosphere },
    uHorizonHaze: { value: state.skyHorizonHaze ?? preset.horizonHaze },
    uQuality: { value: qualityToFloat(resolveSkyQuality()) },
    uTop: { value: new THREE.Color(preset.top) },
    uMid: { value: new THREE.Color(preset.mid) },
    uHorizon: { value: new THREE.Color(preset.horizon) },
    uHaze: { value: new THREE.Color(preset.haze) },
    uSunDir: { value: new THREE.Vector3(-0.4, 0.85, 0.25).normalize() },
    uSunWarmth: { value: preset.sunWarmth },
  };

  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    uniforms,
  });

  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(42000, 32, 20), skyMat);
  skyMesh.name = "cinematicSkyDome";
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -100;
  group.add(skyMesh);

  // Soft projected cloud shadow (HIGH only) — one plane, shared shader
  const shadowMat = new THREE.ShaderMaterial({
    vertexShader: SHADOW_VERT,
    fragmentShader: SHADOW_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    fog: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 0.35 },
      uDensity: { value: 0.42 },
      uOpacity: { value: 0.12 },
    },
  });
  const shadowSize = Math.max(14000, span * 2.2);
  const shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(shadowSize, shadowSize, 1, 1),
    shadowMat,
  );
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.set(cx, 42, cz);
  shadowMesh.name = "cloudShadowPlane";
  shadowMesh.renderOrder = 2;
  shadowMesh.visible = false;
  group.add(shadowMesh);

  scene.add(group);

  // Base sun orbit (very slow daylight drift — not day/night)
  const baseAzimuth = -0.55;
  const baseElevation = 1.05;
  let enabled = state.skyEnabled !== false;
  let lastPreset = state.skyPreset || DEFAULT_SKY_PRESET;

  function applyLightingFromPreset(p) {
    const sunMul = state.skySunIntensity ?? 1;
    hemi.color.set(p.hemiSky);
    hemi.groundColor.set(p.hemiGround);
    hemi.intensity = (p.hemiIntensity ?? 0.95) * (0.85 + (state.skyAtmosphere ?? 0.55) * 0.25);
    sun.color.set(p.sunColor);
    sun.intensity = (p.sunIntensity ?? 1.4) * sunMul;
    fill.intensity = p.fillIntensity ?? 0.32;
    fill.color.set(p.sunWarmth > 0.35 ? "#e8c8a0" : "#b4c4d4");
    if (renderer) {
      const baseExp = p.exposure ?? 1.18;
      renderer.toneMappingExposure = baseExp;
    }
  }

  function applyPreset(name) {
    const key = SKY_PRESETS[name] ? name : DEFAULT_SKY_PRESET;
    const p = getSkyPreset(key);
    state.skyPreset = key;
    lastPreset = key;
    state.skyCloudDensity = p.cloudDensity;
    state.skyAnimStrength = p.animStrength;
    state.skyAtmosphere = p.atmosphere;
    state.skyHorizonHaze = p.horizonHaze;
    uniforms.uTop.value.set(p.top);
    uniforms.uMid.value.set(p.mid);
    uniforms.uHorizon.value.set(p.horizon);
    uniforms.uHaze.value.set(p.haze);
    uniforms.uSunWarmth.value = p.sunWarmth;
    applyLightingFromPreset(p);
    syncFromState();
  }

  function syncFromState() {
    enabled = state.skyEnabled !== false;
    group.visible = enabled;
    const p = getSkyPreset(state.skyPreset || DEFAULT_SKY_PRESET);
    const q = resolveSkyQuality();
    uniforms.uQuality.value = qualityToFloat(q);
    uniforms.uCloudDensity.value = state.skyCloudDensity ?? p.cloudDensity;
    uniforms.uCloudSpeed.value = Math.max(0.05, state.skyCloudSpeed ?? 0.35);
    uniforms.uAnimStrength.value = state.skyAnimStrength ?? p.animStrength;
    uniforms.uAtmosphere.value = state.skyAtmosphere ?? p.atmosphere;
    uniforms.uHorizonHaze.value = state.skyHorizonHaze ?? p.horizonHaze;
    applyLightingFromPreset(p);

    const wantShadows =
      enabled &&
      state.skyCloudShadows !== false &&
      q === "high" &&
      (state.skyCloudDensity ?? p.cloudDensity) > 0.15;
    shadowMesh.visible = wantShadows;
    shadowMat.uniforms.uSpeed.value = uniforms.uCloudSpeed.value;
    shadowMat.uniforms.uDensity.value = uniforms.uCloudDensity.value;
    shadowMat.uniforms.uOpacity.value = THREE.MathUtils.clamp(
      0.06 + (state.skyCloudDensity ?? 0.4) * 0.1,
      0.04,
      0.16,
    );

    // Low: gradient only — zero cloud density in shader
    if (q === "low") {
      uniforms.uCloudDensity.value *= 0.25;
      shadowMesh.visible = false;
    } else if (q === "medium") {
      shadowMesh.visible = false;
    }
  }

  function setVisible(on) {
    group.visible = !!on && enabled;
    if (!on) shadowMesh.visible = false;
  }

  function update(dt, camera) {
    if (!enabled || !group.visible) return;
    const t = state.elapsed || 0;
    uniforms.uTime.value = t;
    shadowMat.uniforms.uTime.value = t;

    // Extremely slow sun drift (full swing ~20+ minutes) — daylight only
    const drift = t * 0.00035 * (state.skySunDrift ?? 0.25);
    const az = baseAzimuth + Math.sin(drift) * 0.35;
    const el = baseElevation + Math.cos(drift * 0.7) * 0.08;
    const dist = 4200;
    const sx = Math.cos(el) * Math.sin(az) * dist;
    const sy = Math.sin(el) * dist;
    const sz = Math.cos(el) * Math.cos(az) * dist;
    sun.position.set(sx, Math.max(1800, sy), sz);
    sunDir.copy(sun.position).normalize();
    uniforms.uSunDir.value.copy(sunDir);

    // Keep sky centred on camera so large overview never clips
    if (camera) {
      skyMesh.position.copy(camera.position);
      shadowMesh.position.x = camera.position.x;
      shadowMesh.position.z = camera.position.z;
    }

    // Sync if preset changed externally
    if (state.skyPreset && state.skyPreset !== lastPreset) {
      applyPreset(state.skyPreset);
    }
  }

  // Initialise
  applyPreset(state.skyPreset || DEFAULT_SKY_PRESET);
  syncFromState();

  return {
    group,
    skyMesh,
    shadowMesh,
    update,
    syncFromState,
    applyPreset,
    setVisible,
    setEnabled(on) {
      state.skyEnabled = !!on;
      enabled = !!on;
      syncFromState();
      if (!enabled) {
        if (!scene.background) scene.background = new THREE.Color("#6a7e5c");
        else if (scene.background.isColor) scene.background.set("#6a7e5c");
      } else {
        scene.background = null;
      }
    },
  };
}
