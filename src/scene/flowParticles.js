import * as THREE from "three";
import { SURFACE_Y } from "./river.js";
import { state } from "../state.js";

/**
 * Downstream flow streaks — gated by water reveal so particles only appear
 * where the flow front has already activated the river segment.
 */
export function createFlowParticles(dataset) {
  const stations = dataset.corridor.stations;
  const count = 900;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const alongT = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const t = (i + Math.random()) / count;
    const idx = Math.floor(t * (stations.length - 1));
    const st = stations[idx];
    const px = -st.flowZ;
    const pz = st.flowX;
    const lat = (Math.random() - 0.5) * st.halfWidth * 1.4;
    positions[i * 3] = st.x + px * lat;
    positions[i * 3 + 1] = SURFACE_Y + 0.25 + Math.random() * 0.7;
    positions[i * 3 + 2] = st.z + pz * lat;
    seeds[i] = Math.random();
    alongT[i] = t;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute("aAlong", new THREE.BufferAttribute(alongT, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 1 },
      uReveal: { value: 1.2 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aAlong;
      uniform float uTime;
      uniform float uSpeed;
      uniform float uReveal;
      varying float vA;
      void main(){
        // Hide particles ahead of the flow front
        float alive = step(aAlong, uReveal + 0.02);
        vec3 p = position;
        float drift = fract(aSeed + uTime * (0.04 + uSpeed * 0.06));
        p.y += sin(uTime * 1.5 + aSeed * 20.0) * 0.15;
        vA = alive * (0.2 + 0.6 * (1.0 - abs(drift * 2.0 - 1.0)));
        // Brighten near the advancing front
        float front = 1.0 - smoothstep(0.0, 0.06, abs(aAlong - uReveal));
        vA *= mix(0.75, 1.35, front * step(0.02, uReveal) * step(uReveal, 1.05));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = mix(4.2, 8.0, front) * (480.0 / -mv.z) * alive;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5 || vA < 0.01) discard;
        float a = smoothstep(0.5, 0.0, d) * vA;
        gl_FragColor = vec4(0.78, 0.95, 1.0, a * 0.92);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.name = "flowParticles";
  points.frustumCulled = false;
  points.renderOrder = 5;

  const along = stations.map((s) => ({
    x: s.x,
    z: s.z,
    fx: s.flowX,
    fz: s.flowZ,
    half: s.halfWidth,
    t: s.t,
  }));

  let reveal = 1.2;

  return {
    mesh: points,
    setReveal(r) {
      reveal = r;
      mat.uniforms.uReveal.value = r;
    },
    update(dt) {
      mat.uniforms.uTime.value = state.elapsed % 30;
      mat.uniforms.uSpeed.value = state.flowSpeed;
      mat.uniforms.uReveal.value = reveal;
      const pos = geo.attributes.position;
      const seed = geo.attributes.aSeed;
      const aAlong = geo.attributes.aAlong;
      for (let i = 0; i < count; i++) {
        // Advance along corridor; wrap within revealed portion when cinematic
        let t = (seed.getX(i) + state.elapsed * (0.014 + state.flowSpeed * 0.022)) % 1;
        if (t < 0) t += 1;
        if (reveal < 1.05) {
          // Keep streaks inside activated water
          t = t * Math.max(0.04, Math.min(1, reveal + 0.02));
        }
        aAlong.setX(i, t);
        const f = t * (along.length - 1);
        const i0 = Math.floor(f);
        const k = f - i0;
        const a = along[i0];
        const b = along[Math.min(along.length - 1, i0 + 1)];
        const x = a.x + (b.x - a.x) * k;
        const z = a.z + (b.z - a.z) * k;
        const fx = a.fx;
        const fz = a.fz;
        const px = -fz;
        const pz = fx;
        const lat = (seed.getX(i) - 0.5) * (a.half + b.half) * 0.7;
        pos.setXYZ(i, x + px * lat, SURFACE_Y + 0.28 + seed.getX(i) * 0.65, z + pz * lat);
      }
      pos.needsUpdate = true;
      aAlong.needsUpdate = true;
    },
  };
}
