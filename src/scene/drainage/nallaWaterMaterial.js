import * as THREE from "three";

/**
 * Shared continuous water / drainage-pipe material for nalla ribbons.
 * Joining Streams mode: smooth dark-blue engineered channel (reference look).
 * Default mode: brighter cyan flow ribbons.
 */
export function createNallaWaterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    uniforms: {
      uTime: { value: 0 },
      uFlowSpeed: { value: 0.65 },
      uOpacity: { value: 0.9 },
      uReveal: { value: 0 },
      uActive: { value: 0 },
      /** 1 = Joining Streams smooth dark-blue pipe */
      uJoiningStyle: { value: 0 },
      uSelectedBoost: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vAlong;
      varying float vAcross;
      varying vec3 vNormalW;

      void main() {
        vUv = uv;
        vAlong = uv.x;
        vAcross = uv.y;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFlowSpeed;
      uniform float uOpacity;
      uniform float uReveal;
      uniform float uActive;
      uniform float uJoiningStyle;
      uniform float uSelectedBoost;

      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vAlong;
      varying float vAcross;
      varying vec3 vNormalW;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          if (uJoiningStyle > 0.5 && i >= 2) break;
          v += a * noise(p);
          p *= 2.07;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        if (uActive < 0.5) discard;

        float soft = 0.08;
        float fill = 1.0 - smoothstep(uReveal, uReveal + soft, vAlong);
        if (fill < 0.02) discard;

        float spd = max(0.35, uFlowSpeed);
        float styleSlow = mix(1.0, 0.5, uJoiningStyle);
        float tSlow = uTime * (0.22 * spd * styleSlow);
        float tFast = uTime * (0.62 * spd * styleSlow);

        float alongSlow = fract(vAlong * 6.0 - tSlow);
        float alongFast = fract(vAlong * 10.0 - tFast);
        float across = vAcross;

        vec2 uvSlow = vec2(vAlong * 5.5 - tSlow, across * 2.2);
        vec2 uvFast = vec2(vAlong * 9.0 - tFast * 1.15, across * 3.0 + tSlow * 0.15);

        float nSlow = fbm(uvSlow);
        float nFast = fbm(uvFast + vec2(nSlow * 0.35, 0.0));

        float streakA = smoothstep(0.55, 0.92, sin(alongFast * 6.2831853) * 0.5 + 0.5 + nFast * 0.25);
        float streakB = smoothstep(0.62, 0.95, sin((alongSlow + 0.33) * 6.2831853) * 0.5 + 0.5);
        float streak = max(streakA * 0.85, streakB * 0.45);

        float edge = abs(across * 2.0 - 1.0);

        // Default cyan ribbons
        vec3 deepA = vec3(0.10, 0.34, 0.58);
        vec3 midA = vec3(0.22, 0.55, 0.78);
        vec3 cyanA = vec3(0.55, 0.90, 1.0);

        // Joining Streams: smooth professional dark-blue channel (reference)
        // ~#0a3d6e → #1a6aad, not neon
        vec3 deepB = vec3(0.04, 0.16, 0.34);
        vec3 midB = vec3(0.10, 0.36, 0.62);
        vec3 cyanB = vec3(0.28, 0.62, 0.92);
        vec3 deep = mix(deepA, deepB, uJoiningStyle);
        vec3 mid = mix(midA, midB, uJoiningStyle);
        vec3 cyan = mix(cyanA, cyanB, uJoiningStyle);
        vec3 foam = mix(vec3(0.85, 0.95, 1.0), vec3(0.75, 0.88, 1.0), uJoiningStyle);

        vec3 col = mix(deep, mid, smoothstep(0.0, 0.55, edge) * 0.7 + nSlow * mix(0.35, 0.12, uJoiningStyle));
        col = mix(col, cyan, smoothstep(0.55, 0.92, edge) * mix(0.4, 0.28, uJoiningStyle));
        col += cyan * streak * (0.55 - edge * 0.25) * mix(1.0, 0.18, uJoiningStyle);
        col += foam * streakA * (0.22 - edge * 0.12) * mix(1.0, 0.12, uJoiningStyle);
        col *= mix(0.88, 1.12, nSlow * mix(1.0, 0.35, uJoiningStyle));

        // Soft specular (glossy pipe) in Joining Streams
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 N = normalize(vNormalW);
        float ndv = abs(dot(N, V));
        float fres = pow(1.0 - ndv, 2.2);
        float spec = pow(max(ndv, 0.0), mix(8.0, 28.0, uJoiningStyle));
        col += cyan * fres * mix(0.2, 0.32, uJoiningStyle);
        col += vec3(0.55, 0.75, 1.0) * spec * mix(0.05, 0.22, uJoiningStyle);

        // Selected: brighter readable navy, still not neon
        col = mix(col, col * vec3(1.15, 1.25, 1.4) + vec3(0.05, 0.12, 0.28), uSelectedBoost * 0.65);

        float wave = sin((across + nSlow) * 12.0 + uTime * spd * 1.8) * 0.5 + 0.5;
        col += cyan * wave * mix(0.06, 0.02, uJoiningStyle) * (1.0 - edge);

        float mouth = smoothstep(0.78, 1.0, vAlong);
        col = mix(col, mix(col, cyan, mix(0.4, 0.22, uJoiningStyle)), mouth * 0.35);

        float alpha = uOpacity * fill;
        // Joining: ~0.82–0.90 body so white chevrons read inside
        alpha *= mix(0.98, mix(0.82, 0.9, edge), uJoiningStyle);
        alpha *= mix(1.0, 0.92, mouth);
        alpha *= mix(0.85, 1.0, fres * 0.4 + 0.6);
        alpha = mix(alpha, min(0.96, alpha + 0.08), uSelectedBoost);

        // Subtle white ❯❯❯ banding along joining pipes (flow cue under mesh arrows)
        if (uJoiningStyle > 0.5) {
          float chevSpeed = uTime * (0.5 * spd);
          float chevCell = fract(vAlong * 12.0 - chevSpeed);
          float acrossC = abs(across * 2.0 - 1.0);
          float tip = smoothstep(0.5, 0.06, chevCell);
          float arms = smoothstep(0.5, 0.0, abs(acrossC - chevCell * 0.75));
          float chev = tip * arms * smoothstep(0.72, 0.12, acrossC);
          col = mix(col, vec3(0.95, 0.98, 1.0), chev * (0.45 + uSelectedBoost * 0.2));
          alpha = mix(alpha, min(0.97, alpha + 0.06), chev * 0.4);
        }

        gl_FragColor = vec4(col, clamp(alpha, 0.0, mix(0.94, 0.92, uJoiningStyle)));
      }
    `,
  });
}
