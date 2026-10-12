import * as THREE from "three";

const LINE_COLOR = new THREE.Color("#EF4444");
const HIGHLIGHT_COLOR = new THREE.Color("#FCA5A5");
const LINE_WIDTH_PX = 1.5;
const LINE_OPACITY = 0.72;
/** Covers the flood sheet's vertex wave amplitude; depth priority comes from the eye-ward pull. */
const LIFT_M = 0.12;
const PULSE_PERIOD_M = 140.0;
const PULSE_SPEED_MPS = 45.0;

const vert = /* glsl */ `
  uniform vec2 uResolution;
  uniform float uWidthPx;
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aSide;
  attribute float aT;
  attribute float aArc;
  attribute float aReveal;
  varying float vSide;
  varying float vArc;
  varying float vReveal;

  vec3 towardCamera(vec3 v) {
    // Pull toward the eye by a distance-scaled amount so the line wins over the
    // water sheet and draped terrain without a constant NDC depth bias.
    float d = length(v);
    return v - (v / max(d, 1e-4)) * min(3.0, 0.0025 * d);
  }

  void main() {
    vec4 a = modelViewMatrix * vec4(aStart, 1.0);
    vec4 b = modelViewMatrix * vec4(aEnd, 1.0);
    a.xyz = towardCamera(a.xyz);
    b.xyz = towardCamera(b.xyz);

    float nearZ = -projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
    bool aBehind = a.z > -nearZ;
    bool bBehind = b.z > -nearZ;
    if (aBehind && bBehind) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    if (aBehind) a.xyz = mix(b.xyz, a.xyz, (-nearZ - b.z) / (a.z - b.z));
    if (bBehind) b.xyz = mix(a.xyz, b.xyz, (-nearZ - a.z) / (b.z - a.z));

    vec4 ca = projectionMatrix * a;
    vec4 cb = projectionMatrix * b;
    vec2 sa = ca.xy / ca.w * uResolution * 0.5;
    vec2 sb = cb.xy / cb.w * uResolution * 0.5;
    vec2 dir = sb - sa;
    float len = length(dir);
    dir = len > 1e-5 ? dir / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);

    vec4 c = aT < 0.5 ? ca : cb;
    float halfPx = uWidthPx * 0.5 + 1.0;
    c.xy += nrm * aSide * halfPx / (uResolution * 0.5) * c.w;
    gl_Position = c;

    vSide = aSide;
    vArc = aArc;
    vReveal = aReveal;
  }
`;

const frag = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHighlight;
  uniform float uOpacity;
  uniform float uWidthPx;
  uniform float uFrontDist;
  uniform float uSimTime;
  uniform float uPulseAmt;
  uniform float uPulsePeriod;
  uniform float uPulseSpeed;
  varying float vSide;
  varying float vArc;
  varying float vReveal;

  void main() {
    float halfW = uWidthPx * 0.5;
    float px = abs(vSide) * (halfW + 1.0);
    float coverage = 1.0 - smoothstep(halfW - 0.5, halfW + 0.5, px);

    // Identical cut to the flood water shader (same reveal values, same front, 1 px AA),
    // so the perimeter can never run ahead of or lag behind the visible water.
    float ahead = vReveal - uFrontDist;
    float aa = max(fwidth(vReveal), 1e-3);
    float reached = 1.0 - smoothstep(-0.5 * aa, 0.5 * aa, ahead);
    float alpha = coverage * reached * uOpacity;
    if (alpha < 0.004) discard;

    float phase = fract(vArc / uPulsePeriod - uSimTime * uPulseSpeed / uPulsePeriod);
    float pulse = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.08, 0.26, phase));
    float h = clamp(pulse * 0.45 * uPulseAmt, 0.0, 1.0);

    vec3 col = mix(uColor, uHighlight, h);
    gl_FragColor = vec4(col, min(1.0, alpha * (1.0 + 0.3 * h)));
  }
`;

/**
 * Outer perimeter of the triangulated flood surface: every edge used by exactly
 * one triangle. Holes and disconnected regions come out as their own loops;
 * interior edges never qualify. Edges lying on the sampling grid border are the
 * crop window, not the flood, so they are dropped.
 *
 * @param {{ positions: Float32Array, indices: number[], reveal: Float32Array,
 *   isGridBorder: (x: number, z: number) => boolean }} src
 */
export function createFloodBoundaryLine({ positions, indices, reveal, isGridBorder }) {
  const undirected = new Map();
  const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      if (a === b) continue;
      const kk = key(a, b);
      const e = undirected.get(kk);
      if (e) e.count += 1;
      else undirected.set(kk, { a, b, count: 1 });
    }
  }

  const next = new Map();
  const edges = [];
  for (const e of undirected.values()) {
    if (e.count !== 1) continue;
    const ax = positions[e.a * 3];
    const az = positions[e.a * 3 + 2];
    const bx = positions[e.b * 3];
    const bz = positions[e.b * 3 + 2];
    if (isGridBorder(ax, az) && isGridBorder(bx, bz)) continue;
    // Triangle winding is consistent, so a→b keeps every loop oriented the same way.
    if (!next.has(e.a)) next.set(e.a, []);
    next.get(e.a).push(e.b);
    edges.push(e);
  }

  const segs = [];
  const used = new Set();
  for (const e of edges) {
    if (used.has(`${e.a}>${e.b}`)) continue;
    let cur = e.a;
    let arc = 0;
    while (true) {
      const outs = next.get(cur);
      if (!outs) break;
      const to = outs.find((n) => !used.has(`${cur}>${n}`));
      if (to === undefined) break;
      used.add(`${cur}>${to}`);
      const dx = positions[to * 3] - positions[cur * 3];
      const dz = positions[to * 3 + 2] - positions[cur * 3 + 2];
      const len = Math.hypot(dx, dz);
      segs.push(cur, to, arc, arc + len);
      arc += len;
      cur = to;
    }
  }

  const segCount = segs.length / 4;
  if (!segCount) return null;

  const vCount = segCount * 4;
  const aStart = new Float32Array(vCount * 3);
  const aEnd = new Float32Array(vCount * 3);
  const aSide = new Float32Array(vCount);
  const aT = new Float32Array(vCount);
  const aArc = new Float32Array(vCount);
  const aReveal = new Float32Array(vCount);
  const index = new Uint32Array(segCount * 6);
  const corners = [
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 1],
  ];

  for (let s = 0; s < segCount; s++) {
    const ia = segs[s * 4];
    const ib = segs[s * 4 + 1];
    for (let c = 0; c < 4; c++) {
      const v = s * 4 + c;
      const [t, side] = corners[c];
      aStart[v * 3] = positions[ia * 3];
      aStart[v * 3 + 1] = positions[ia * 3 + 1] + LIFT_M;
      aStart[v * 3 + 2] = positions[ia * 3 + 2];
      aEnd[v * 3] = positions[ib * 3];
      aEnd[v * 3 + 1] = positions[ib * 3 + 1] + LIFT_M;
      aEnd[v * 3 + 2] = positions[ib * 3 + 2];
      aSide[v] = side;
      aT[v] = t;
      aArc[v] = t ? segs[s * 4 + 3] : segs[s * 4 + 2];
      aReveal[v] = t ? reveal[ib] : reveal[ia];
    }
    const b = s * 4;
    index.set([b, b + 2, b + 1, b + 1, b + 2, b + 3], s * 6);
  }

  const geo = new THREE.BufferGeometry();
  // `position` only feeds bounding volumes; the shader builds the ribbon from aStart/aEnd.
  geo.setAttribute("position", new THREE.BufferAttribute(aStart, 3));
  geo.setAttribute("aStart", new THREE.BufferAttribute(aStart, 3));
  geo.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 3));
  geo.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
  geo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
  geo.setAttribute("aArc", new THREE.BufferAttribute(aArc, 1));
  geo.setAttribute("aReveal", new THREE.BufferAttribute(aReveal, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1920, 1080) },
      uWidthPx: { value: LINE_WIDTH_PX },
      uColor: { value: LINE_COLOR.clone() },
      uHighlight: { value: HIGHLIGHT_COLOR.clone() },
      uOpacity: { value: LINE_OPACITY },
      uFrontDist: { value: 0 },
      uSimTime: { value: 0 },
      uPulseAmt: { value: 0 },
      uPulsePeriod: { value: PULSE_PERIOD_M },
      uPulseSpeed: { value: PULSE_SPEED_MPS },
    },
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "apiFloodBoundary";
  mesh.renderOrder = 13;
  mesh.frustumCulled = false;
  const size = new THREE.Vector2();
  mesh.onBeforeRender = (renderer) => {
    renderer.getSize(size);
    material.uniforms.uResolution.value.copy(size);
  };

  /**
   * @param {number} frontDist same flood-front distance the water shader uses
   * @param {number} simTime flood simulation clock (seconds)
   * @param {number} progress 0..1
   */
  mesh.userData.sync = (frontDist, simTime, progress) => {
    const u = material.uniforms;
    u.uFrontDist.value = frontDist;
    u.uSimTime.value = simTime;
    u.uPulseAmt.value = 1 - THREE.MathUtils.smoothstep(progress, 0.96, 1.0);
  };
  mesh.userData.segmentCount = segCount;
  return mesh;
}
