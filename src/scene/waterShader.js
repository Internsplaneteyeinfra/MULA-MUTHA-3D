import * as THREE from "three";
import { state } from "../state.js";

const PIER_MAX = 16;

/**
 * Same water look as geospatial-mula-mutha (localhost:5175).
 * Continuous flow along corridor tangents — no TIN tile seams.
 * Extra: cutaway transparency + pier wakes for the cinematic scene.
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

    float flow = mod(uTime, 30.0) * (0.4 + uFlowSpeed * 1.1);
    vec2 fdir = vFlow;
    vec2 perp = vec2(-fdir.y, fdir.x);
    float uA = dot(position.xz, fdir);
    float uC = dot(position.xz, perp);

    float swell = noise(vec2(uA*0.006 - mod(uTime,30.0)*0.04, uC*0.01)) * 0.22;
    float wave  = noise(vec2(uA*0.025 - flow, uC*0.03)) * 0.12;
    float rip   = noise(vec2(uA*0.09 - flow*2.2, uC*0.12)) * 0.04;
    float edge  = abs(aAcross*2.0 - 1.0);
    float turb  = noise(vec2(uA*0.05 - flow*1.3, uC*0.08 + mod(uTime,30.0)*0.15))
                * 0.08 * (aNarrow*0.5 + edge*0.25);

    vec3 pos = position;
    // Keep displacement small — large vertex waves cause patchy / broken look
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
    for(int i=0;i<4;i++){ v+=a*noise(p); p=r*p*2.03; a*=0.5; }
    return v;
  }

  vec3 depthColor(float d){
    float t = clamp((d - uMinDepth) / max(0.001, uMaxDepth - uMinDepth), 0.0, 1.0);
    vec3 c = mix(uC0, uC1, smoothstep(0.0, 0.4, t));
    c = mix(c, uC2, smoothstep(0.35, 0.75, t));
    c = mix(c, uC3, smoothstep(0.7, 1.0, t));
    return c;
  }

  void main(){
    float depthT = clamp((vDepth - uMinDepth) / max(0.001, uMaxDepth - uMinDepth), 0.0, 1.0);
    vec2 fdir = vFlow;
    vec2 perp = vec2(-fdir.y, fdir.x);
    float uA = dot(vXZ, fdir);
    float uC = dot(vXZ, perp);
    float flow = mod(uTime, 30.0) * (0.4 + uFlowSpeed * 1.1) * mix(1.15, 0.55, depthT);

    float eps = 2.0;
    vec2 q = vec2(uA, uC);
    vec2 qX = q + vec2(eps, 0.0);
    vec2 qZ = q + vec2(0.0, eps);
    float h0 = fbm(q*0.012 + vec2(-mod(uTime,30.0)*0.035, 0.0))*0.9
             + noise(q*0.04 + vec2(-flow, 0.0))*0.45
             + noise(q*0.14 + vec2(-flow*2.4, mod(uTime,30.0)*0.08))*0.18;
    float hx = fbm(qX*0.012 + vec2(-mod(uTime,30.0)*0.035, 0.0))*0.9
             + noise(qX*0.04 + vec2(-flow, 0.0))*0.45
             + noise(qX*0.14 + vec2(-flow*2.4, mod(uTime,30.0)*0.08))*0.18;
    float hz = fbm(qZ*0.012 + vec2(-mod(uTime,30.0)*0.035, 0.0))*0.9
             + noise(qZ*0.04 + vec2(-flow, 0.0))*0.45
             + noise(qZ*0.14 + vec2(-flow*2.4, mod(uTime,30.0)*0.08))*0.18;
    float du = (hx-h0)/eps;
    float dv = (hz-h0)/eps;
    vec3 N = normalize(vec3(
      -(du*fdir.x + dv*perp.x)*14.0,
      1.0,
      -(du*fdir.y + dv*perp.y)*14.0
    ));

    vec3 col = depthColor(mix(vDepth, (uMinDepth+uMaxDepth)*0.5, 1.0 - uShowDepth));
    col *= mix(1.05, 0.88, depthT);

    float streak = pow(abs(sin(uA*0.095 - flow*3.6 + fbm(vec2(uA*0.02,uC*0.03))*1.5)), 3.2);
    streak *= mix(0.7, 0.28, depthT) * (1.0 - abs(vAcross*2.0-1.0)*0.28) * uShowFlowVis;
    col += vec3(0.62, 0.86, 0.96) * streak * 0.55;

    float streak2 = pow(abs(sin(uA*0.22 - flow*5.5 + 1.7)), 6.0);
    streak2 *= mix(0.35, 0.12, depthT) * uShowFlowVis;
    col += vec3(0.75, 0.92, 1.0) * streak2 * 0.28;

    float particles = pow(noise(vec2(uA*0.18 - flow*5.5, uC*0.14)), 6.5);
    col += vec3(0.78, 0.94, 1.0) * particles * uShowFlowVis * 0.85;

    float edge = abs(vAcross*2.0 - 1.0);
    float foam = smoothstep(0.72, 0.98, edge) * (1.0 - depthT) * 0.35
               + vNarrow * 0.15 * noise(vec2(uA*0.08 - flow, uC*0.1));

    float wake = 0.0;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= uPierCount) break;
      vec2 dlt = vXZ - uPiers[i].xy;
      float d = length(dlt);
      float rad = max(5.0, uPiers[i].z);
      float near = exp(-d*d / (rad*rad*3.0));
      float behind = max(0.0, -dot(normalize(dlt + vec2(1e-4)), fdir));
      wake += near * (0.4 + behind * 1.1);
    }
    foam += wake * 0.35;

    // Progressive longitudinal reveal along corridor centerline (aAlong / vAlong)
    float soft = max(0.02, uRevealSoft);
    float revealMask = 1.0 - smoothstep(uReveal - soft, uReveal + soft * 0.35, vAlong);
    float front = exp(-pow((vAlong - uReveal) / max(0.02, soft * 1.4), 2.0));
    front *= step(0.01, uReveal) * step(uReveal, 1.08);
    foam += front * 0.72;
    col += vec3(0.82, 0.94, 1.0) * front * 0.65;

    col = mix(col, vec3(0.85, 0.93, 0.96), foam * 0.35);

    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uLightDir);
    vec3 H = normalize(L + V);
    float fresnel = mix(0.05, 0.42, pow(1.0 - max(dot(N,V),0.0), 3.2));
    float spec = pow(max(dot(N,H),0.0), 90.0)*0.85 + pow(max(dot(N,H),0.0), 14.0)*0.18;
    col = col*(1.0 - fresnel*0.35) + uSkyColor*fresnel*0.3 + vec3(1.0,0.97,0.9)*spec;

    // Fuller Indian-river look: opaque mid-channel, clearer only at shallow edges
    float alpha = mix(uOpacity * 0.88, min(0.94, uOpacity + 0.12), smoothstep(0.08, 0.75, depthT));
    alpha *= mix(0.92, 1.0, 1.0 - smoothstep(0.9, 1.0, edge));
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
      uShowFlowVis: { value: 1 },
      uOpacity: { value: state.waterOpacity },
      uReveal: { value: 1.2 },
      uRevealSoft: { value: 0.045 },
      uMinDepth: { value: dataset.minDepth },
      uMaxDepth: { value: dataset.maxDepth },
      uLightDir: { value: new THREE.Vector3(-0.42, 0.8, 0.3).normalize() },
      uSkyColor: { value: new THREE.Color("#A8C8D6") },
      uC0: { value: new THREE.Color("#5A9A8C") },
      uC1: { value: new THREE.Color("#2E7A88") },
      uC2: { value: new THREE.Color("#185A6C") },
      uC3: { value: new THREE.Color("#0C3A4C") },
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
