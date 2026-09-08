import * as THREE from "three";

/**
 * Procedural dry-riverbed sediment + gravel shader (GPU noise, no texture atlas).
 * Applied to the existing river.bed mesh in dry / partial modes.
 */

const VERT = /* glsl */ `
  attribute float aDepth;
  attribute float aAcross;
  attribute float aAlong;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vDepth;
  varying float vAcross;
  varying float vAlong;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vDepth = aDepth;
    vAcross = aAcross;
    vAlong = aAlong;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vDepth;
  varying float vAcross;
  varying float vAlong;

  uniform float uGravel;
  uniform float uSand;
  uniform float uRough;
  uniform float uWetness;   // 0 dry · higher = darker wet sediment (partial)
  uniform float uFlowBoost; // centre-channel gravel emphasis
  uniform float uDetail;    // 0 far · 1 close (LOD)
  uniform vec3 uSunDir;
  uniform float uSeed;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21) + uSeed);
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
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.05 + 17.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    float bank = abs(vAcross * 2.0 - 1.0); // 0 centre, 1 edge
    float flow = 1.0 - bank;               // historical thalweg
    flow = pow(flow, 1.15);

    vec2 xz = vWorld.xz * 0.08;
    float n1 = fbm(xz + vAlong * 3.0);
    float n2 = fbm(xz * 2.7 + 9.1);
    float n3 = noise(xz * 14.0);

    // Soft sediment palette (Indian seasonal riverbed)
    vec3 sand = vec3(0.78, 0.70, 0.52);       // warm beige
    vec3 sediment = vec3(0.58, 0.48, 0.36);   // light brown
    vec3 wetSed = vec3(0.38, 0.32, 0.26);     // dark wet
    vec3 gravel = vec3(0.52, 0.50, 0.46);     // grey gravel
    vec3 erosion = vec3(0.42, 0.36, 0.30);    // darker erosion

    // Base blend
    float sandMask = smoothstep(0.35, 0.85, n1) * (0.35 + bank * 0.65) * uSand;
    float gravelMask = (0.25 + flow * 0.55 * uFlowBoost + n2 * 0.35) * uGravel;
    gravelMask = clamp(gravelMask * (1.0 - sandMask * 0.5), 0.0, 1.0);
    float wetMask = (flow * 0.55 + n2 * 0.25) * uWetness;
    float erosMask = smoothstep(0.55, 0.9, n1) * flow * 0.45;

    vec3 col = sediment;
    col = mix(col, sand, clamp(sandMask, 0.0, 0.85));
    col = mix(col, gravel, clamp(gravelMask, 0.0, 0.8));
    col = mix(col, wetSed, clamp(wetMask, 0.0, 0.7));
    col = mix(col, erosion, clamp(erosMask, 0.0, 0.5));

    // Fine gravel speckles — visible close, blends away far
    float speck = smoothstep(0.55, 0.85, n3);
    col = mix(col, gravel * 0.92, speck * 0.22 * uGravel * uDetail);

    // Micro variation (no tiling)
    col *= 0.92 + 0.12 * n2;

    // Soft lighting
    vec3 N = normalize(vN);
    float ndl = max(0.2, dot(N, normalize(uSunDir)));
    float rough = mix(0.78, 0.96, uRough);
    // Wet patches slightly more reflective
    float spec = pow(ndl, mix(4.0, 18.0, uWetness * flow)) * (0.04 + uWetness * 0.08);
    col = col * (0.45 + 0.55 * ndl) + vec3(spec);

    // Depth cue: deeper thalweg a touch darker
    float dT = clamp((vDepth - 0.5) / 1.6, 0.0, 1.0);
    col *= 1.0 - dT * 0.12 * flow;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createRiverbedMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    lights: false,
    fog: true,
    toneMapped: true,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
    uniforms: {
      uGravel: { value: 0.7 },
      uSand: { value: 0.55 },
      uRough: { value: 0.85 },
      uWetness: { value: 0 },
      uFlowBoost: { value: 1 },
      uDetail: { value: 1 },
      uSunDir: { value: new THREE.Vector3(-0.4, 0.85, 0.25).normalize() },
      uSeed: { value: 0.17 },
      // fog uniforms injected by Three when fog:true on ShaderMaterial in r15x+
    },
  });
}

export function syncRiverbedMaterial(mat, state, sunDir) {
  if (!mat?.uniforms) return;
  const u = mat.uniforms;
  u.uGravel.value = state.riverbedGravelDensity ?? 0.7;
  u.uSand.value = state.riverbedSandCoverage ?? 0.55;
  u.uRough.value = state.riverbedRoughness ?? 0.85;
  u.uWetness.value = state.riverCondition === "partial" ? 0.55 : 0.08;
  u.uFlowBoost.value = 1;
  u.uSeed.value = ((state.riverbedSeed ?? 42) % 1000) / 1000;
  if (sunDir) u.uSunDir.value.copy(sunDir);
}
