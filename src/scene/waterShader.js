import * as THREE from "three";
import { state } from "../state.js";

const PIER_MAX = 16;

/**
 * Smooth, realistic river surface — gentle flow along corridor tangents.
 * Soft depth tint (not extreme), calm ripples, continuous look.
 */
const vert = /* glsl */ `
  uniform float uTime;
  uniform float uFlowSpeed;

  attribute float aDepth;
  attribute float aAlong;
  attribute float aAcross;
  attribute vec2 aFlow;
  attribute float aNarrow;

  varying float vDepth;
  varying float vAlong;
  varying float vAcross;
  varying float vNarrow;
  varying vec2  vFlow;
  varying vec3  vWorld;
  varying vec2  vXZ;

  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){
    vec2 i=floor(p); vec2 f=fract(p);
    vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),
               mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
  }

  void main(){
    vDepth = aDepth;
    vAlong = aAlong;
    vAcross = aAcross;
    vNarrow = aNarrow;
    vFlow = normalize(aFlow + vec2(1e-5));
    vXZ = position.xz;

    float flow = mod(uTime, 40.0) * (0.28 + uFlowSpeed * 0.55);
    vec2 fdir = vFlow;
    vec2 perp = vec2(-fdir.y, fdir.x);
    float uA = dot(position.xz, fdir);
    float uC = dot(position.xz, perp);

    // Long, gentle swells — smooth river motion, not choppy
    float swell = noise(vec2(uA*0.0035 - mod(uTime,40.0)*0.018, uC*0.006)) * 0.07;
    float wave  = noise(vec2(uA*0.014 - flow*0.55, uC*0.018)) * 0.028;
    float rip   = noise(vec2(uA*0.05 - flow*1.1, uC*0.06)) * 0.01;
    float edge  = abs(aAcross*2.0 - 1.0);
    float turb  = noise(vec2(uA*0.03 - flow*0.7, uC*0.05))
                * 0.015 * (aNarrow*0.4 + edge*0.2);

    vec3 pos = position;
    pos.y += swell + wave + rip + turb;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uShowDepth;
  uniform float uCutaway;
  uniform float uMinDepth;
  uniform float uMaxDepth;
  uniform float uShowFlowVis;
  uniform float uOpacity;
  uniform float uReveal;
  uniform float uRevealSoft;
  uniform vec3  uLightDir;
  uniform vec3  uSkyColor;
  uniform vec3  uC0;
  uniform vec3  uC1;
  uniform vec3  uC2;
  uniform vec3  uC3;
  uniform vec4  uPiers[16];
  uniform float uPierCount;

  varying float vDepth;
  varying float vAlong;
  varying float vAcross;
  varying float vNarrow;
  varying vec2  vFlow;
  varying vec3  vWorld;
  varying vec2  vXZ;

  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){
    vec2 i=floor(p); vec2 f=fract(p);
    vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),
               mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
  }
  float fbm(vec2 p){
    float v=0.0; float a=0.5;
    mat2 r=mat2(0.8,0.6,-0.6,0.8);
    for(int i=0;i<3;i++){ v+=a*noise(p); p=r*p*1.9; a*=0.5; }
    return v;
  }

  vec3 depthColor(float d){
    // Soft, close blues — readable depth without harsh patches
    float t = clamp((d - uMinDepth) / max(0.001, uMaxDepth - uMinDepth), 0.0, 1.0);
    t = smoothstep(0.0, 1.0, t);
    vec3 c = mix(uC0, uC1, smoothstep(0.0, 0.45, t));
    c = mix(c, uC2, smoothstep(0.35, 0.8, t));
    c = mix(c, uC3, smoothstep(0.7, 1.0, t));
    return c;
  }

  void main(){
    float depthT = clamp((vDepth - uMinDepth) / max(0.001, uMaxDepth - uMinDepth), 0.0, 1.0);
    vec2 fdir = vFlow;
    vec2 perp = vec2(-fdir.y, fdir.x);
    float uA = dot(vXZ, fdir);
    float uC = dot(vXZ, perp);
    // Slow, even flow drift along the river
    float flow = mod(uTime, 40.0) * (0.22 + uFlowSpeed * 0.5);

    float eps = 3.5;
    vec2 q = vec2(uA, uC);
    // Flow-stretched noise → smooth streaks, not blotchy swirls
    vec2 flowUv = vec2(uA * 0.008 - flow * 0.35, uC * 0.022);
    float h0 = fbm(flowUv) * 0.7
             + noise(vec2(uA*0.028 - flow*0.6, uC*0.04)) * 0.3;
    float hx = fbm(flowUv + vec2(eps*0.008, 0.0)) * 0.7
             + noise(vec2((uA+eps)*0.028 - flow*0.6, uC*0.04)) * 0.3;
    float hz = fbm(flowUv + vec2(0.0, eps*0.022)) * 0.7
             + noise(vec2(uA*0.028 - flow*0.6, (uC+eps)*0.04)) * 0.3;
    float du = (hx-h0)/eps;
    float dv = (hz-h0)/eps;
    vec3 N = normalize(vec3(
      -(du*fdir.x + dv*perp.x)*4.2,
      1.0,
      -(du*fdir.y + dv*perp.y)*4.2
    ));

    vec3 col = depthColor(mix(vDepth, (uMinDepth+uMaxDepth)*0.5, 1.0 - uShowDepth));
    vec3 baseCol = col;
    // Mild depth darkening only
    col *= mix(1.02, 0.88, depthT);

    // Soft flow highlight — thin continuous shimmer along current
    float streak = noise(vec2(uA*0.045 - flow*0.9, uC*0.09));
    streak = smoothstep(0.55, 0.78, streak) * 0.06 * (1.0 - depthT * 0.4);
    col += vec3(0.12, 0.16, 0.18) * streak;

    float edge = abs(vAcross*2.0 - 1.0);
    float foam = smoothstep(0.85, 0.995, edge) * (1.0 - depthT) * 0.08
               + vNarrow * 0.025 * noise(vec2(uA*0.06 - flow, uC*0.08));

    float wake = 0.0;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= uPierCount) break;
      vec2 dlt = vXZ - uPiers[i].xy;
      float d = length(dlt);
      float rad = max(5.0, uPiers[i].z);
      float near = exp(-d*d / (rad*rad*3.2));
      float behind = max(0.0, -dot(normalize(dlt + vec2(1e-4)), fdir));
      wake += near * (0.35 + behind * 0.9);
    }
    foam += wake * 0.12;

    float soft = max(0.02, uRevealSoft);
    float revealMask = 1.0 - smoothstep(uReveal - soft, uReveal + soft * 0.35, vAlong);
    float front = exp(-pow((vAlong - uReveal) / max(0.02, soft * 1.4), 2.0));
    front *= step(0.01, uReveal) * step(uReveal, 1.08);
    foam += front * 0.35;
    col = mix(col, vec3(0.78, 0.88, 0.94), foam * 0.07);

    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uLightDir);
    vec3 H = normalize(L + V);
    float fresnel = mix(0.04, 0.2, pow(1.0 - max(dot(N,V),0.0), 2.8));
    float spec = pow(max(dot(N,H),0.0), 72.0)*0.14 + pow(max(dot(N,H),0.0), 16.0)*0.04;
    col = mix(baseCol, col, 0.92);
    col = col*(1.0 - fresnel*0.14) + uSkyColor*fresnel*0.14 + vec3(0.9, 0.95, 1.0)*spec;

    // Even body of water — slight clarity at shallow edges only
    float alpha = mix(uOpacity * 0.9, min(0.94, uOpacity + 0.06), smoothstep(0.15, 0.85, depthT));
    alpha *= mix(0.94, 1.0, 1.0 - smoothstep(0.92, 1.0, edge));
    alpha = mix(alpha, mix(0.2, 0.45, depthT) * uOpacity, uCutaway);
    alpha *= mix(0.08, 1.0, revealMask);

    gl_FragColor = vec4(col, alpha);
  }
`;

export function createWaterMaterial(dataset) {
  const piers = Array.from({ length: PIER_MAX }, () => new THREE.Vector4());
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uFlowSpeed: { value: state.flowSpeed },
      uShowDepth: { value: 1 },
      uCutaway: { value: 0 },
      uShowFlowVis: { value: 0 },
      uOpacity: { value: state.waterOpacity },
      uReveal: { value: 1.2 },
      uRevealSoft: { value: 0.045 },
      uMinDepth: { value: dataset.minDepth },
      uMaxDepth: { value: dataset.maxDepth },
      uLightDir: { value: new THREE.Vector3(-0.42, 0.8, 0.3).normalize() },
      uSkyColor: { value: new THREE.Color("#a8c8dc") },
      // Soft river blues — close range, natural
      uC0: { value: new THREE.Color("#7eb8d8") },
      uC1: { value: new THREE.Color("#5a9ec8") },
      uC2: { value: new THREE.Color("#3a7eae") },
      uC3: { value: new THREE.Color("#245a88") },
      uPiers: { value: piers },
      uPierCount: { value: 0 },
    },
  });
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
