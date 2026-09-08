import * as THREE from "three";

/**
 * Shared continuous water material for nalla ribbons.
 * Flow loops forever via fract() on uTime-driven UVs — not a one-shot tween.
 */
export function createNallaWaterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Respect building / terrain depth so channels go under structures
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    uniforms: {
      uTime: { value: 0 },
      uFlowSpeed: { value: 0.65 },
      uOpacity: { value: 0.9 },
      uReveal: { value: 0 },
      uActive: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vAlong;
      varying float vAcross;

      void main() {
        vUv = uv;
        // TubeGeometry: uv.x = along path (0 upstream → 1 downstream), uv.y = around tube
        vAlong = uv.x;
        vAcross = uv.y;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFlowSpeed;
      uniform float uOpacity;
      uniform float uReveal;
      uniform float uActive;

      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vAlong;
      varying float vAcross;

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
          v += a * noise(p);
          p *= 2.07;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        if (uActive < 0.5) discard;

        // Reveal upstream → downstream: show where vAlong <= uReveal (was inverted before)
        float soft = 0.08;
        float fill = 1.0 - smoothstep(uReveal, uReveal + soft, vAlong);
        if (fill < 0.02) discard;

        float spd = max(0.35, uFlowSpeed);
        // Layer 1 — slow body distortion (loops via continuous time)
        float tSlow = uTime * (0.22 * spd);
        // Layer 2 — faster surface highlights / streaks
        float tFast = uTime * (0.62 * spd);

        // Along-channel flow: fract keeps pattern looping forever
        float alongSlow = fract(vAlong * 6.0 - tSlow);
        float alongFast = fract(vAlong * 10.0 - tFast);
        float across = vAcross;

        vec2 uvSlow = vec2(vAlong * 5.5 - tSlow, across * 2.2);
        vec2 uvFast = vec2(vAlong * 9.0 - tFast * 1.15, across * 3.0 + tSlow * 0.15);

        float nSlow = fbm(uvSlow);
        float nFast = fbm(uvFast + vec2(nSlow * 0.35, 0.0));

        // Directional streaks traveling downstream (visibly move within ~1s)
        float streakA = smoothstep(0.55, 0.92, sin(alongFast * 6.2831853) * 0.5 + 0.5 + nFast * 0.25);
        float streakB = smoothstep(0.62, 0.95, sin((alongSlow + 0.33) * 6.2831853) * 0.5 + 0.5);
        float streak = max(streakA * 0.85, streakB * 0.45);

        float edge = abs(across * 2.0 - 1.0);
        vec3 deep = vec3(0.10, 0.34, 0.58);
        vec3 mid = vec3(0.22, 0.55, 0.78);
        vec3 cyan = vec3(0.55, 0.90, 1.0);
        vec3 foam = vec3(0.85, 0.95, 1.0);

        vec3 col = mix(deep, mid, smoothstep(0.0, 0.5, edge) * 0.65 + nSlow * 0.35);
        col = mix(col, cyan, smoothstep(0.55, 0.92, edge) * 0.4);
        // Moving highlights (primary “water is flowing” cue)
        col += cyan * streak * (0.55 - edge * 0.25);
        col += foam * streakA * (0.22 - edge * 0.12);
        col *= mix(0.88, 1.12, nSlow);

        // Soft wave shimmer across width
        float wave = sin((across + nSlow) * 12.0 + uTime * spd * 1.8) * 0.5 + 0.5;
        col += cyan * wave * 0.06 * (1.0 - edge);

        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = abs(dot(normalize(vec3(0.0, 1.0, 0.0)), V));
        float fres = pow(1.0 - ndv, 2.4);
        col += cyan * fres * 0.2;

        // Mouth: slightly brighter where nalla meets river — still keeps flowing
        float mouth = smoothstep(0.78, 1.0, vAlong);
        col = mix(col, mix(col, cyan, 0.4), mouth * 0.4);

        float alpha = uOpacity * fill;
        alpha *= mix(0.98, 0.58, edge);
        alpha *= mix(1.0, 0.85, mouth);
        alpha *= mix(0.8, 1.0, fres * 0.45 + 0.55);
        // Pulse alpha slightly with streaks so motion reads even at distance
        alpha *= mix(0.92, 1.0, streak * 0.5);

        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.94));
      }
    `,
  });
}
