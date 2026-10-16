import * as THREE from "three";
import { state } from "../state.js";
import { DEFAULT_WATER_PRESET, WATER_PRESETS } from "./water/waterPresets.js";

const PIER_MAX = 16;

/**
 * Continuous river-wave field on corridor params (aAlong, aAcross).
 * Phase uses station/across — NOT world·aFlow — so curves stay seamless
 * (world·flow is discontinuous when flow direction changes per station).
 */
const WAVE_GLSL = /* glsl */ `
  float riverWaveHeight(float along, float across, float t) {
    float pSpd = uPrimaryWaveSpeed * (0.55 + uFlowSpeed * 0.6);
    float sSpd = uSecondaryWaveSpeed * (0.5 + uFlowSpeed * 0.7);
    float rSpd = uRippleSpeed * (0.45 + uFlowSpeed * 0.55);

    // along is ~0..1 — keep wavelengths long vs corridor station spacing (~20m)
    float s = along * 52.0;
    float c = (across - 0.5) * 8.0;

    // Layer 1 — primary swell (long, slow, downstream)
    float primary =
        sin(s * 0.45 - t * pSpd * 2.2) * 0.55
      + sin(s * 0.28 + c * 0.06 - t * pSpd * 1.4 + 1.6) * 0.45;
    primary *= uPrimaryWaveAmplitude;

    // Layer 2 — directional river waves
    float secondary =
        sin(s * 0.85 - t * sSpd * 3.4) * 0.5
      + sin(s * 1.25 - t * sSpd * 4.8 + 0.9) * 0.32
      + sin(s * 1.7 + c * 0.22 - t * sSpd * 2.6 + 2.2) * 0.22
      + sin(c * 0.7 + t * sSpd * 0.4) * 0.12;
    secondary *= uSecondaryWaveAmplitude * uFlowStrength;

    // Layer 3 — small continuous ripples
    float rip = 0.0;
    if (uQuality > 0.5) {
      rip =
          sin(s * 2.6 - t * rSpd * 6.0) * cos(c * 1.6 + t * rSpd * 1.0) * 0.55
        + sin(s * 3.8 + c * 1.1 - t * rSpd * 7.2 + 1.2) * 0.45;
      if (uQuality > 1.5) {
        rip += sin(s * 5.2 - t * rSpd * 8.8 + c * 1.8) * 0.28;
      }
      rip *= uRippleAmplitude;
    }

    return primary + secondary + rip;
  }

  vec2 riverWaveSlope(float along, float across, float t) {
    float pSpd = uPrimaryWaveSpeed * (0.55 + uFlowSpeed * 0.6);
    float sSpd = uSecondaryWaveSpeed * (0.5 + uFlowSpeed * 0.7);
    float rSpd = uRippleSpeed * (0.45 + uFlowSpeed * 0.55);
    float s = along * 52.0;
    float c = (across - 0.5) * 8.0;
    float dsda = 52.0;
    float dcdc = 8.0;

    float dS =
        cos(s * 0.45 - t * pSpd * 2.2) * 0.45 * 0.55 * uPrimaryWaveAmplitude
      + cos(s * 0.28 + c * 0.06 - t * pSpd * 1.4 + 1.6) * 0.28 * 0.45 * uPrimaryWaveAmplitude
      + cos(s * 0.85 - t * sSpd * 3.4) * 0.85 * 0.5 * uSecondaryWaveAmplitude * uFlowStrength
      + cos(s * 1.25 - t * sSpd * 4.8 + 0.9) * 1.25 * 0.32 * uSecondaryWaveAmplitude * uFlowStrength
      + cos(s * 1.7 + c * 0.22 - t * sSpd * 2.6 + 2.2) * 1.7 * 0.22 * uSecondaryWaveAmplitude * uFlowStrength;

    float dC =
        cos(s * 0.28 + c * 0.06 - t * pSpd * 1.4 + 1.6) * 0.06 * 0.45 * uPrimaryWaveAmplitude
      + cos(s * 1.7 + c * 0.22 - t * sSpd * 2.6 + 2.2) * 0.22 * 0.22 * uSecondaryWaveAmplitude * uFlowStrength
      + cos(c * 0.7 + t * sSpd * 0.4) * 0.7 * 0.12 * uSecondaryWaveAmplitude * uFlowStrength;

    if (uQuality > 0.5) {
      float a1 = s * 2.6 - t * rSpd * 6.0;
      float c1 = c * 1.6 + t * rSpd * 1.0;
      dS += cos(a1) * 2.6 * cos(c1) * 0.55 * uRippleAmplitude;
      dC += sin(a1) * (-sin(c1) * 1.6) * 0.55 * uRippleAmplitude;
      float a2 = s * 3.8 + c * 1.1 - t * rSpd * 7.2 + 1.2;
      dS += cos(a2) * 3.8 * 0.45 * uRippleAmplitude;
      dC += cos(a2) * 1.1 * 0.45 * uRippleAmplitude;
      if (uQuality > 1.5) {
        float a3 = s * 5.2 - t * rSpd * 8.8 + c * 1.8;
        dS += cos(a3) * 5.2 * 0.28 * uRippleAmplitude;
        dC += cos(a3) * 1.8 * 0.28 * uRippleAmplitude;
      }
    }

    return vec2(dS * dsda, dC * dcdc);
  }
`;

/**
 * Calm cinematic river surface — multi-layer GPU sine waves.
 * Replaces value-noise/fbm (rectangular patches) and world·flow phase (curve seams).
 */
const vert = /* glsl */ `
  uniform float uTime;
  uniform float uAnimEnabled;
  uniform float uOverallSpeed;
  uniform float uPrimaryWaveSpeed;
  uniform float uPrimaryWaveAmplitude;
  uniform float uSecondaryWaveSpeed;
  uniform float uSecondaryWaveAmplitude;
  uniform float uRippleSpeed;
  uniform float uRippleAmplitude;
  uniform float uFlowSpeed;
  uniform float uFlowStrength;
  uniform float uQuality;

  attribute float aDepth;
  attribute float aAlong;
  attribute float aAcross;
  attribute vec2 aFlow;
  attribute float aNarrow;
  attribute float aEdgeDist;
  attribute float aRiverDist;

  varying float vDepth;
  varying float vAlong;
  varying float vAcross;
  varying float vNarrow;
  varying vec2  vFlow;
  varying vec3  vWorld;
  varying vec2  vXZ;
  varying float vWave;
  varying float vEdgeDist;
  varying float vRiverDist;

  ${WAVE_GLSL}

  void main(){
    vDepth = aDepth;
    vAlong = aAlong;
    vAcross = aAcross;
    vNarrow = aNarrow;
    vFlow = normalize(aFlow + vec2(1e-5));
    vEdgeDist = aEdgeDist;
    vRiverDist = aRiverDist;
    vXZ = position.xz;

    float t = uTime * max(0.15, uOverallSpeed);
    float edge = abs(aAcross * 2.0 - 1.0);
    float bankFade = mix(1.0, 0.22, smoothstep(0.72, 0.98, edge));
    float anim = step(0.5, uAnimEnabled);

    float narrowBoost = 1.0 + aNarrow * 0.12;
    float wave = riverWaveHeight(aAlong, aAcross, t) * bankFade * narrowBoost * anim;
    vWave = wave;

    vec3 pos = position;
    pos.y += wave;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform float uAnimEnabled;
  uniform float uOverallSpeed;
  uniform float uPrimaryWaveSpeed;
  uniform float uPrimaryWaveAmplitude;
  uniform float uSecondaryWaveSpeed;
  uniform float uSecondaryWaveAmplitude;
  uniform float uRippleSpeed;
  uniform float uRippleAmplitude;
  uniform float uFlowSpeed;
  uniform float uFlowStrength;
  uniform float uShowDepth;
  uniform float uCutaway;
  uniform float uMinDepth;
  uniform float uMaxDepth;
  uniform float uShowFlowVis;
  uniform float uOpacity;
  uniform float uReveal;
  uniform float uRevealSoft;
  uniform float uReflectionStrength;
  uniform float uWaveHighlight;
  uniform float uQuality;
  uniform vec3  uLightDir;
  uniform vec3  uSkyColor;
  uniform vec3  uC0;
  uniform vec3  uC1;
  uniform vec3  uC2;
  uniform vec3  uC3;
  uniform vec4  uPiers[16];
  uniform float uPierCount;
  uniform float uIsFlood;
  uniform float uFloodProgressDist;
  uniform float uFrontLine;
  uniform vec3  uFrontColor;

  uniform float uSiltMode;
  uniform vec2  uSiltP0;
  uniform vec2  uSiltP1;
  uniform vec2  uSiltP2;
  uniform vec2  uSiltP3;

  varying float vDepth;
  varying float vAlong;
  varying float vAcross;
  varying float vNarrow;
  varying vec2  vFlow;
  varying vec3  vWorld;
  varying vec2  vXZ;
  varying float vWave;
  varying float vEdgeDist;
  varying float vRiverDist;

  ${WAVE_GLSL}

  // Continuous depth tint: Normalized to available range.
  // Smooth single gradient (no piecewise knees) → no visible colour bands.
  // Natural deep dark blue palette around #063568, #07558D, and #087FAF
  // with smooth depth-based blending (no flat turquoise sheet).
  vec3 depthColor(float d){
    if (uIsFlood > 0.5) {
      float t = clamp((d - uMinDepth) / max(0.001, uMaxDepth - uMinDepth), 0.0, 1.0);
      float te = smoothstep(0.0, 1.0, t);
      // Hazard red flood sheet — no bright coral rim (that read as a hard border).
      vec3 c = mix(uC1, uC2, smoothstep(0.0, 0.45, te));
      c = mix(c, uC3, smoothstep(0.40, 1.0, te));
      return c;
    }

    float t = clamp((d - uMinDepth) / max(0.001, uMaxDepth - uMinDepth), 0.0, 1.0);
    float te = smoothstep(0.0, 1.0, t);

    // Natural deep dark blue river water: #087FAF (shallow) -> #07558D (mid) -> #063568 (deep)
    vec3 c = mix(uC0, uC1, smoothstep(0.0, 0.35, te));
    c = mix(c, uC2, smoothstep(0.25, 0.70, te));
    c = mix(c, uC3, smoothstep(0.55, 1.0, te));

    // Gentle bank lightening so the shoreline blends seamlessly into terrain
    float edgeAmt = abs(vAcross * 2.0 - 1.0);
    c = mix(c, uC0, smoothstep(0.85, 1.0, edgeAmt) * 0.25);

    return c;
  }

  void main(){
    if (vDepth < 0.0) discard;
    float depthT = clamp((vDepth - uMinDepth) / max(0.001, uMaxDepth - uMinDepth), 0.0, 1.0);
    depthT = smoothstep(0.0, 1.0, pow(depthT, 0.78));
    vec2 fdir = vFlow;
    float t = uTime * max(0.15, uOverallSpeed);
    float anim = step(0.5, uAnimEnabled);
    float flow = t * (0.22 + uFlowSpeed * 0.48) * max(0.35, uFlowStrength);

    // Analytical normals from sine slopes (corridor → world via aFlow).
    // Gentle boost: high factors exaggerate every sine crest into visible stripes.
    vec2 slope = riverWaveSlope(vAlong, vAcross, t) * anim;
    vec2 perp = vec2(-fdir.y, fdir.x);
    float nBoost = 0.85 + uWaveHighlight * 0.75 + uPrimaryWaveAmplitude * 3.0;
    vec3 N = normalize(vec3(
      -(slope.x * fdir.x + slope.y * perp.x) * nBoost * 0.01,
      1.0,
      -(slope.x * fdir.y + slope.y * perp.y) * nBoost * 0.01
    ));

    vec3 col = depthColor(vDepth);
    vec3 baseCol = col;

    // Broad, very soft luminance drift downstream — wavelengths are far longer
    // than the mesh spacing and the amplitude is tiny, so the surface reads as
    // calm moving water instead of bright cyan stripes.
    // Flood sheets skip this entirely: on their flat, shallow surface even a
    // faint sine reads as horizontal banding.
    float s = vAlong * 48.0;
    float c = (vAcross - 0.5) * 6.0;
    float streak =
        sin(s * 0.55 - flow * 1.7) * 0.6
      + sin(s * 0.92 - flow * 2.6 + 1.2) * 0.3
      + sin(s * 1.4 + c * 0.18 - flow * 2.1 + 2.0) * 0.1;
    float lightBand = pow(0.5 + 0.5 * streak, 2.4);
    float crest = 0.5 + 0.5 * sin(s * 0.7 - flow * 2.2 + sin(s * 0.31 + c * 0.4) * 1.7);
    float sparkle = pow(max(crest, 0.0), 6.0) * anim * step(1.5, uQuality);

    // Dynamic wave ripples, flow and highlights for both river and floodwater
    if (uIsFlood > 0.5) {
      // Dynamic moving wave highlights in warm crest tint on red floodwater
      float floodWaveHighlight = clamp(vWave * 4.5, 0.0, 0.15) * uWaveHighlight;
      col += vec3(1.0, 0.45, 0.45) * (lightBand * 0.12 * anim + floodWaveHighlight);
      col += vec3(1.0, 0.7, 0.7) * sparkle * 0.08;
    } else {
      col += vec3(0.22, 0.34, 0.42) * lightBand * 0.055 * anim;
      col += vec3(0.65, 0.82, 0.9) * sparkle * 0.035;
      col += vec3(0.08, 0.14, 0.2) * clamp(vWave * 2.5, 0.0, 0.06) * uWaveHighlight;
    }

    float edge = abs(vAcross * 2.0 - 1.0);
    float foam = smoothstep(0.9, 1.0, edge) * (1.0 - depthT) * 0.05
               + vNarrow * 0.012 * (0.5 + 0.5 * sin(s * 1.2 - flow));

    float wake = 0.0;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= uPierCount) break;
      vec2 dlt = vXZ - uPiers[i].xy;
      float d = length(dlt);
      float rad = max(5.0, uPiers[i].z);
      float near = exp(-d * d / (rad * rad * 3.2));
      float behind = max(0.0, -dot(normalize(dlt + vec2(1e-4)), fdir));
      wake += near * (0.3 + behind * 0.85);
    }
    foam += wake * 0.1;

    float soft = max(0.02, uRevealSoft);
    float revealMask = 1.0 - smoothstep(uReveal - soft, uReveal + soft * 0.35, vAlong);
    float front = exp(-pow((vAlong - uReveal) / max(0.02, soft * 1.4), 2.0));
    front *= step(0.01, uReveal) * step(uReveal, 1.08);
    foam += front * 0.18;
    col = mix(col, vec3(0.82, 0.92, 0.95), foam * 0.08);

    // Fresnel sky reflection + sunlight highlights — glossy water with depth
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uLightDir);
    vec3 H = normalize(L + V);
    float fresnel = mix(0.04, 0.26, pow(1.0 - max(dot(N, V), 0.0), 2.6));
    fresnel *= uReflectionStrength * mix(1.0, 0.85, uIsFlood);
    float glitter = 0.20 + 0.80 * lightBand * anim;
    float spec = pow(max(dot(N, H), 0.0), 160.0) * 0.30 * uWaveHighlight * glitter
               + pow(max(dot(N, H), 0.0), 28.0) * 0.04 * uReflectionStrength * glitter;
    spec = min(spec, 0.38);
    col = mix(baseCol, col, 0.95);
    vec3 skyRefl = mix(uSkyColor, vec3(1.0, 0.84, 0.84), uIsFlood);
    col = col * (1.0 - fresnel * 0.18) + skyRefl * fresnel * 0.35 + vec3(0.95, 0.98, 1.0) * spec;

    // -----------------------------------------------------------
    // DEPTH-BASED UNDERWATER TRANSMISSION
    // -----------------------------------------------------------
    // Shallow water stays partially transparent so the submerged terrain reads
    // through it with vibrant tint; the deep channel turns naturally opaque.
    float depthM = max(vDepth, 0.0);
    float absorb = 1.0 - exp(-depthM * 1.5);
    float volumeAlpha = mix(0.45, 0.98, absorb);
    float alpha = max(volumeAlpha * uOpacity, mix(0.45, 0.98, depthT));

    // Surface reflections stay visible over the transparent shallows
    float surfaceFeatures = clamp(fresnel * 2.2 + spec * 4.0 + foam * 2.0 + sparkle * 2.0, 0.0, 1.0);
    alpha = max(alpha, surfaceFeatures * mix(0.85, 0.65, uIsFlood));

    // Soft shoreline: fade the outer band smoothly into the banks
    alpha *= 1.0 - smoothstep(0.93, 1.0, edge);

    alpha = mix(alpha, mix(0.12, 0.32, depthT) * uOpacity, uCutaway);
    alpha *= mix(0.08, 1.0, revealMask);
    alpha *= mix(1.0, 0.92, clamp(wake * 0.35, 0.0, 1.0));

    // From below the surface the sheet is a back face — keep river water as blue, not a window onto green DTM.
    // Flood water must NEVER be overridden with blue water tint.
    if (!gl_FrontFacing && uSiltMode < 0.5 && uIsFlood < 0.5) {
      col = mix(col, vec3(0.16, 0.42, 0.5), 0.72);
      alpha = max(alpha, mix(0.70, 0.92, depthT));
    }

    // API flood: FILL the extent with flowing water (not an empty outline).
    if (uIsFlood > 0.5) {
      // Solid fill inside the polygon — only a tiny soft tip at the shoreline
      alpha = clamp(mix(0.58, 0.86, depthT) * uOpacity, 0.50, 0.90);
      alpha *= mix(0.82, 1.0, smoothstep(0.0, 4.0, vEdgeDist));
      float ahead = vRiverDist - uFloodProgressDist;
      float aa = max(fwidth(vRiverDist), 1e-3);
      // Growing wet front from river → banks (water flows outward into flood lines)
      float wet = 1.0 - smoothstep(-0.8 * aa, 1.5 * aa, ahead);
      if (wet < 0.002) discard;
      alpha *= mix(0.75, 1.0, smoothstep(0.0, 12.0, -ahead));
      // No hard rim stroke
      float frontPx = -ahead / aa;
      float frontLine = (1.0 - smoothstep(1.5, 5.0, frontPx)) * uFrontLine;
      col = mix(col, uFrontColor, frontLine * 0.25);
      alpha *= wet;
    }

    // SILT ANALYSIS MODE OVERRIDE
    if (uSiltMode > 0.5) {
      vec2 p = vWorld.xz;
      vec2 poly[4];
      poly[0] = uSiltP0;
      poly[1] = uSiltP1;
      poly[2] = uSiltP2;
      poly[3] = uSiltP3;
      
      bool inside = false;
      int j = 3;
      for (int i = 0; i < 4; i++) {
        if (((poly[i].y > p.y) != (poly[j].y > p.y)) &&
            (p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)) {
          inside = !inside;
        }
        j = i;
      }
      
      if (inside) {
        alpha = min(alpha, 0.05);
        col = mix(col, vec3(0.10, 0.16, 0.18), 0.04);
      } else {
        // More subtle transparency outside the polygon so the river remains present but subdued
        alpha = min(alpha, 0.65);
      }
    }

    gl_FragColor = vec4(col, alpha);
  }
`;

function qualityToFloat(q) {
  if (q === "low") return 0;
  if (q === "high") return 2;
  return 1;
}

export function createWaterMaterial(dataset) {
  const preset = WATER_PRESETS[state.waterPreset || DEFAULT_WATER_PRESET] || WATER_PRESETS.calmRealistic;
  const piers = Array.from({ length: PIER_MAX }, () => new THREE.Vector4());
  
  const isFlood = !!dataset?.isFlood;
  // Natural deep dark blue river palette: #087FAF -> #07558D -> #063568
  // Flood inundation palette: radiant hazard red within valid API extent
  const c0 = isFlood ? new THREE.Color("#FF4444") : new THREE.Color("#087FAF"); // Shallow fringe
  const c1 = isFlood ? new THREE.Color("#E53935") : new THREE.Color("#07558D"); // Shallow/mid
  const c2 = isFlood ? new THREE.Color("#C62828") : new THREE.Color("#06477B"); // Mid/deep
  const c3 = isFlood ? new THREE.Color("#8E0000") : new THREE.Color("#063568"); // Deep channel

  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    clipping: true,
    // DoubleSide: corridor winding can flip with CRS local-frame changes;
    // translucent water must stay visible from overview / 2D / 3D.
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uTime: { value: 0 },
      uAnimEnabled: { value: preset.waterAnimEnabled !== false ? 1 : 0 },
      uOverallSpeed: { value: preset.waterOverallSpeed ?? 0.55 },
      uPrimaryWaveSpeed: { value: preset.primaryWaveSpeed ?? 0.035 },
      uPrimaryWaveAmplitude: { value: preset.primaryWaveAmplitude ?? 0.06 },
      uSecondaryWaveSpeed: { value: preset.secondaryWaveSpeed ?? 0.05 },
      uSecondaryWaveAmplitude: { value: preset.secondaryWaveAmplitude ?? 0.035 },
      uRippleSpeed: { value: preset.rippleSpeed ?? 0.07 },
      uRippleAmplitude: { value: preset.rippleAmplitude ?? 0.015 },
      uFlowSpeed: { value: preset.flowSpeed ?? state.flowSpeed },
      uFlowStrength: { value: preset.flowStrength ?? 0.85 },
      uShowDepth: { value: 1 },
      uCutaway: { value: 0 },
      uShowFlowVis: { value: state.flowVisibility ?? 0.55 },
      uOpacity: { value: preset.waterOpacity ?? state.waterOpacity ?? 0.82 },
      uReveal: { value: 1.2 },
      uRevealSoft: { value: 0.045 },
      uReflectionStrength: { value: preset.reflectionStrength ?? 0.65 },
      uWaveHighlight: { value: preset.waveHighlight ?? 0.75 },
      uQuality: { value: qualityToFloat(state.waterQuality || "high") },
      uSiltMode: { value: 0 },
      uSiltP0: { value: new THREE.Vector2() },
      uSiltP1: { value: new THREE.Vector2() },
      uSiltP2: { value: new THREE.Vector2() },
      uSiltP3: { value: new THREE.Vector2() },
      // Use the actual survey range so measured differences remain visible.
      uMinDepth: { value: Number.isFinite(dataset.minDepth) ? dataset.minDepth : 0.5 },
      uMaxDepth: { value: Number.isFinite(dataset.maxDepth) ? dataset.maxDepth : 2.0 },
      uLightDir: { value: new THREE.Vector3(-0.42, 0.8, 0.3).normalize() },
      uSkyColor: { value: new THREE.Color("#a8c8dc") },
      uC0: { value: c0 },
      uC1: { value: c1 },
      uC2: { value: c2 },
      uC3: { value: c3 },
      uPiers: { value: piers },
      uPierCount: { value: 0 },
      uIsFlood: { value: dataset.isFlood ? 1.0 : 0.0 },
      uFloodProgressDist: { value: 10000.0 },
      uFrontLine: { value: 0 },
      uFrontColor: { value: new THREE.Color("#FF3030") },
    },
  });
}

const _shallowScratch = new THREE.Color();
const _deepScratch = new THREE.Color();
const _midScratch = new THREE.Color();

/** Push current state / preset into material uniforms (call each frame or on UI change). */
export function syncWaterMaterial(material) {
  if (!material?.uniforms) return;
  const u = material.uniforms;
  const preset = WATER_PRESETS[state.waterPreset] || null;
  const isFlood = (u.uIsFlood?.value ?? 0) > 0.5;

  const num = (key, fallback) => {
    const v = state[key];
    return v != null ? v : fallback;
  };

  u.uAnimEnabled.value = state.waterAnimEnabled !== false ? 1 : 0;
  u.uOverallSpeed.value = num("waterOverallSpeed", preset?.waterOverallSpeed ?? 0.55);

  u.uPrimaryWaveSpeed.value = num("primaryWaveSpeed", preset?.primaryWaveSpeed ?? 0.035);
  u.uPrimaryWaveAmplitude.value = num("primaryWaveAmplitude", preset?.primaryWaveAmplitude ?? 0.06);
  u.uSecondaryWaveSpeed.value = num("secondaryWaveSpeed", preset?.secondaryWaveSpeed ?? 0.05);
  u.uSecondaryWaveAmplitude.value = num(
    "secondaryWaveAmplitude",
    preset?.secondaryWaveAmplitude ?? 0.035,
  );
  u.uRippleSpeed.value = num("rippleSpeed", preset?.rippleSpeed ?? 0.07);
  u.uRippleAmplitude.value = num("rippleAmplitude", preset?.rippleAmplitude ?? 0.015);
  u.uFlowSpeed.value = num("flowSpeed", preset?.flowSpeed ?? 0.45);
  u.uFlowStrength.value = num("flowStrength", preset?.flowStrength ?? 0.85);
  u.uShowFlowVis.value = state.flowVisibility ?? 0.55;
  u.uQuality.value = qualityToFloat(state.waterQuality || "high");

  // Flood sheet: keep flowing water motion + filled body (not a static outline).
  if (isFlood) {
    u.uAnimEnabled.value = 1.0;
    u.uOverallSpeed.value = Math.max(u.uOverallSpeed.value, 0.95);
    u.uFlowSpeed.value = Math.max(u.uFlowSpeed.value, 0.85);
    u.uFlowStrength.value = Math.max(u.uFlowStrength.value, 1.05);
    u.uPrimaryWaveAmplitude.value = Math.max(u.uPrimaryWaveAmplitude.value, 0.12);
    u.uSecondaryWaveAmplitude.value = Math.max(u.uSecondaryWaveAmplitude.value, 0.08);
    u.uRippleAmplitude.value = Math.max(u.uRippleAmplitude.value, 0.04);
    u.uWaveHighlight.value = Math.max(u.uWaveHighlight?.value ?? 0, 0.9);
    return;
  }

  u.uOpacity.value = num("waterOpacity", preset?.waterOpacity ?? 0.82);
  u.uReflectionStrength.value = num("reflectionStrength", preset?.reflectionStrength ?? 0.65);
  u.uWaveHighlight.value = num("waveHighlight", preset?.waveHighlight ?? 0.75);

  const shallowHex = state.shallowWaterColor || preset?.shallowColor || "#087FAF";
  const deepHex = state.deepWaterColor || preset?.deepColor || "#063568";
  _shallowScratch.set(shallowHex);
  _deepScratch.set(deepHex);
  u.uC0.value.copy(_shallowScratch);
  u.uC1.value.copy(_midScratch.copy(_shallowScratch).lerp(_deepScratch, 0.35));
  u.uC2.value.copy(_midScratch.copy(_shallowScratch).lerp(_deepScratch, 0.70));
  u.uC3.value.copy(_deepScratch);
}

export function applyWaterPreset(name) {
  const p = WATER_PRESETS[name];
  if (!p) return;
  state.waterPreset = name;
  state.waterAnimEnabled = p.waterAnimEnabled !== false;
  state.waterOverallSpeed = p.waterOverallSpeed;
  state.primaryWaveAmplitude = p.primaryWaveAmplitude;
  state.primaryWaveSpeed = p.primaryWaveSpeed;
  state.secondaryWaveAmplitude = p.secondaryWaveAmplitude;
  state.secondaryWaveSpeed = p.secondaryWaveSpeed;
  state.rippleAmplitude = p.rippleAmplitude;
  state.rippleSpeed = p.rippleSpeed;
  state.flowSpeed = p.flowSpeed;
  state.flowStrength = p.flowStrength;
  state.waterOpacity = p.waterOpacity;
  state.reflectionStrength = p.reflectionStrength;
  state.waveHighlight = p.waveHighlight;
  state.shallowWaterColor = p.shallowColor;
  state.deepWaterColor = p.deepColor;
}

export function fillPierUniforms(material, dataset) {
  const arr = material.uniforms.uPiers.value;
  let n = 0;
  for (const g of dataset.bridges || []) {
    const pierTs = g.lengthM > 80 ? [0.28, 0.5, 0.72] : [0.33, 0.67];
    for (const t of pierTs) {
      if (n >= PIER_MAX) break;
      const x = g.start.x + (g.end.x - g.start.x) * t;
      const z = g.start.z + (g.end.z - g.start.z) * t;
      arr[n].set(x, z, Math.max(6, g.widthM * 0.55), 0);
      n++;
    }
  }
  material.uniforms.uPierCount.value = n;
}

/** Debug snapshot for water system (dev only). */
export function getWaterDebugInfo(material, dataset) {
  const u = material?.uniforms || {};
  return {
    abcSource: "Untitled 2.abc",
    abcObject: "Plane__Copy / Plane__CopyShape",
    abcAnimationDetected: true,
    abcNote: "Square sim plane with mesh-cache; motion applied to KML river mesh via GPU",
    waveModel: "multi-layer sine on aAlong/aAcross (no value-noise, no world·flow phase)",
    riverTriangles: dataset?.bathymetry?.indices?.length
      ? Math.floor(dataset.bathymetry.indices.length / 3)
      : null,
    flowSpeed: u.uFlowSpeed?.value,
    overallSpeed: u.uOverallSpeed?.value,
    primaryWaveSpeed: u.uPrimaryWaveSpeed?.value,
    secondaryWaveSpeed: u.uSecondaryWaveSpeed?.value,
    rippleSpeed: u.uRippleSpeed?.value,
    quality: state.waterQuality,
    preset: state.waterPreset,
  };
}

export function setWaterSiltMode(material, active, points) {
  if (!material?.uniforms) return;
  if (!material.uniforms.uSiltMode) {
    // If uniforms are missing (e.g. hot reload where material was created before the uniform was added),
    // inject them dynamically to prevent crashing and allow testing.
    material.uniforms.uSiltMode = { value: 0 };
    material.uniforms.uSiltP0 = { value: new THREE.Vector2() };
    material.uniforms.uSiltP1 = { value: new THREE.Vector2() };
    material.uniforms.uSiltP2 = { value: new THREE.Vector2() };
    material.uniforms.uSiltP3 = { value: new THREE.Vector2() };
    material.needsUpdate = true;
  }
  
  material.uniforms.uSiltMode.value = active ? 1 : 0;
  if (active && points && points.length >= 4) {
    material.uniforms.uSiltP0.value.set(points[0].x, points[0].z);
    material.uniforms.uSiltP1.value.set(points[1].x, points[1].z);
    material.uniforms.uSiltP2.value.set(points[2].x, points[2].z);
    material.uniforms.uSiltP3.value.set(points[3].x, points[3].z);
  }
}
