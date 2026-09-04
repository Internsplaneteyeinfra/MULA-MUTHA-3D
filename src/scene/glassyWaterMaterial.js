import * as THREE from "three";

/**
 * Shared cinematic glassy water material for KML depth / drainage polygons.
 * Geography stays in mesh positions; only uniforms animate each frame.
 */
export function createGlassyWaterMaterial(opts = {}) {
  const mode = opts.mode === "data" ? 1 : 0;
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: opts.opacity ?? 0.72 },
      uFlowSpeed: { value: opts.flowSpeed ?? 0.45 },
      uFresnelStrength: { value: opts.fresnel ?? 0.55 },
      uDepthIntensity: { value: opts.depthIntensity ?? 0.85 },
      uReveal: { value: 1 },
      uMode: { value: mode }, // 0 cinematic · 1 data analysis
      uMinDepth: { value: opts.minDepth ?? 1.5 },
      uMaxDepth: { value: opts.maxDepth ?? 2.0 },
      uHighlight: { value: 0 },
      uColorCyan: { value: new THREE.Color("#7ef0ff") },
      uColorBlue: { value: new THREE.Color("#3aa0e8") },
      uColorDeep: { value: new THREE.Color("#1a4a9a") },
      uColorViolet: { value: new THREE.Color("#5a3ab8") },
      uSky: { value: new THREE.Color("#c8e4f8") },
    },
    vertexShader: /* glsl */ `
      attribute float aDepth;
      attribute float aOpacity;
      varying float vDepth;
      varying float vOpacity;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec2 vXZ;

      void main() {
        vDepth = aDepth;
        vOpacity = aOpacity;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vXZ = world.xz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform float uFlowSpeed;
      uniform float uFresnelStrength;
      uniform float uDepthIntensity;
      uniform float uReveal;
      uniform float uMode;
      uniform float uMinDepth;
      uniform float uMaxDepth;
      uniform float uHighlight;
      uniform vec3 uColorCyan;
      uniform vec3 uColorBlue;
      uniform vec3 uColorDeep;
      uniform vec3 uColorViolet;
      uniform vec3 uSky;

      varying float vDepth;
      varying float vOpacity;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec2 vXZ;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p = r * p * 2.05;
          a *= 0.5;
        }
        return v;
      }

      vec3 depthBase(float d) {
        float t = clamp((d - uMinDepth) / max(0.001, uMaxDepth - uMinDepth), 0.0, 1.0);
        t = mix(t, smoothstep(0.0, 1.0, t), uDepthIntensity);
        vec3 c = mix(uColorCyan, uColorBlue, smoothstep(0.0, 0.4, t));
        c = mix(c, uColorDeep, smoothstep(0.3, 0.75, t));
        c = mix(c, uColorViolet, smoothstep(0.65, 1.0, t));
        return c;
      }

      void main() {
        float depthT = clamp((vDepth - uMinDepth) / max(0.001, uMaxDepth - uMinDepth), 0.0, 1.0);
        vec3 base = depthBase(vDepth);

        // Subtle flow-aligned noise (→ → →), not aggressive waves
        float flow = uTime * (0.12 + uFlowSpeed * 0.35);
        vec2 flowUv = vec2(vXZ.x * 0.018 - flow, vXZ.y * 0.014);
        float n = fbm(flowUv);
        float n2 = fbm(flowUv * 1.7 + vec2(0.0, flow * 0.4));

        // Animated soft gradient wash over depth colors
        float wash = mix(n, n2, 0.45);
        vec3 glassTint = mix(uColorCyan, uColorViolet, wash);
        float cineBlend = mix(0.22, 0.06, uMode);
        vec3 col = mix(base, mix(base, glassTint, 0.55), cineBlend);

        // Gentle luminance shimmer
        col *= mix(0.94, 1.06, wash * mix(1.0, 0.35, uMode));

        // Fake refraction / normal wobble via noise derivatives
        float eps = 0.8;
        float hx = fbm(flowUv + vec2(eps * 0.018, 0.0));
        float hz = fbm(flowUv + vec2(0.0, eps * 0.014));
        vec3 N = normalize(vNormalW + vec3((hx - n) * 0.35, 0.0, (hz - n) * 0.35) * mix(1.0, 0.25, uMode));

        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = max(dot(N, V), 0.0);
        float fresnel = pow(1.0 - ndv, 2.6) * uFresnelStrength * mix(1.0, 0.4, uMode);
        col = mix(col, uSky, fresnel * 0.45);
        col += vec3(0.55, 0.85, 1.0) * fresnel * 0.28;

        // Soft edge glow (cyan)
        float rim = pow(1.0 - ndv, 3.5);
        col += uColorCyan * rim * mix(0.18, 0.06, uMode);

        // Selection highlight
        col = mix(col, mix(col, vec3(0.9, 0.98, 1.0), 0.45), uHighlight);

        float alpha = uOpacity * mix(0.55, 1.0, vOpacity) * mix(0.82, 0.95, depthT);
        alpha *= mix(0.88, 1.0, fresnel);
        // Data mode: slightly more opaque for analysis
        alpha = mix(alpha, min(0.92, alpha + 0.12), uMode);
        alpha *= smoothstep(0.0, 0.15, uReveal) * uReveal;

        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function setGlassyMode(material, mode) {
  if (!material?.uniforms?.uMode) return;
  material.uniforms.uMode.value = mode === "data" ? 1 : 0;
}
