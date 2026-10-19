/**
 * Terrain-conforming river surfaces built from real centerlines (OSM waterway relations / local KML centerline).
 *
 * Geometry pipeline (per river):
 *  1. Resample the centerline to ~step metres.
 *  2. Sample the same Terrarium DEM that drives the Cesium terrain at each vertex.
 *  3. Hydrologically condition the profile: smooth, then force it to be non-increasing downstream
 *     (a river can't run uphill; raw 30 m DEM noise otherwise produces bumpy ribbons).
 *  4. Extrude a ribbon left/right of the centerline. Width is a *stylised* function of distance from source
 *     (narrow mountain stream -> wide lowland river) — it is NOT measured channel width.
 *  5. Shade with a custom GLSL appearance: scrolling procedural normals, sky/sun reflection (fresnel),
 *     depth-style colour across the channel, and foam where the conditioned bed slope is steep.
 *
 * Nothing here claims to be measured flow, depth or velocity; shading is purely visual.
 */
import { sampleTerrariumHeight } from "./TerrariumTerrainProvider.js";

const VERT = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec4 flowInfo;   // x: metres along channel, y: across (-1..1), z: foam 0..1, w: half width (m)
in float baseHalf;  // normal (non-flood) channel half width at this vertex, m (0 = whole ribbon)
in float depthM;    // surveyed depth at this vertex, m (0 = unknown)
in float batchId;
out vec4 v_flow;
out vec3 v_posEC;
out float v_baseHalf;
out float v_depth;
out vec3 v_upEC;
void main() {
  vec4 p = czm_computePosition();
  // Geocentric up at this vertex (sphere approximation, < 0.2 deg from the ellipsoid normal) in eye coordinates.
  v_upEC = czm_normal * normalize(position3DHigh + position3DLow);
  v_flow = flowInfo;
  v_baseHalf = baseHalf;
  v_depth = depthM;
  v_posEC = (czm_modelViewRelativeToEye * p).xyz;
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`;

// Shading lives in the Material source: Cesium renames material uniforms (u_time -> u_time_N) only inside that
// source, so everything that reads them must be there too. The appearance fragment shader just calls riverShade().
const MATERIAL_SRC = `
in vec4 v_flow;
in vec3 v_posEC;
in float v_baseHalf;
in float v_depth;
in vec3 v_upEC;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*noise(p); p=p*2.03+17.1; a*=.5; } return s; }

// Uniforms (declared by the Material): u_time, u_opacity, u_level (0..1 flood spread; 1 = full ribbon),
// u_turbid (0 clear .. 1 muddy flood water), u_speed (visual flow speed m/s), u_tint.
float g_lod = 0.0; // 0 = full detail .. 1 = only the broad swell (set per fragment from screen-space derivatives)
float heightField(vec2 p, float t) {
  // Isotropic wave field travelling downstream: a broad advected swell plus two short-crested wave trains at
  // +/-18 deg to the current and a fine ripple layer. No along-stream stretching (that produced parallel stripes);
  // finer layers fade out before they alias.
  const vec2 d1 = vec2(0.951, 0.309);
  const vec2 d2 = vec2(0.951, -0.309);
  float a = fbm(p * 0.045 + vec2(-t * 0.22, 0.0));
  float b = noise(vec2(dot(p, d1), dot(p, vec2(-d1.y, d1.x))) * 0.42 - vec2(t * 1.05, 0.0));
  float c = noise(vec2(dot(p, d2), dot(p, vec2(-d2.y, d2.x))) * 0.47 - vec2(t * 0.95, 0.0) + 7.3);
  float d = noise(p * 1.5 - vec2(t * 2.2, 0.0) + 3.7);
  float wbc = 0.3 * (1.0 - smoothstep(0.3, 0.9, g_lod));
  float wd = 0.04 * (1.0 - smoothstep(0.05, 0.3, g_lod));
  return (a * 0.55 + (b + c) * wbc + d * wd) / (0.55 + 2.0 * wbc + wd);
}
vec4 riverShade() {
  float s = v_flow.x;           // metres downstream
  float t = v_flow.y;           // -1..1 across channel
  float foam = v_flow.z;        // 0 calm .. 0.7 steep rapids
  float hw = max(v_flow.w, 1.0);
  float acrossM = t * hw;       // metres from centreline

  // Flood: the visible water edge spreads from the normal channel out to the full ribbon width as u_level -> 1.
  float baseM = v_baseHalf > 0.5 ? min(v_baseHalf, hw) : hw;
  float edgeM = mix(baseM, hw, clamp(u_level, 0.0, 1.0));
  float rel = abs(acrossM) / max(edgeM, 1.0);
  float inWater = 1.0 - smoothstep(1.0 - max(8.0, edgeM * 0.28) / max(edgeM, 1.0), 1.0, rel);
  if (inWater < 0.003) discard;

  // Flow is fastest mid-channel (parabolic profile) and faster on steep reaches.
  float speed = u_speed * (0.45 + 0.55 * max(1.0 - rel * rel, 0.0)) * (1.0 + 1.5 * foam);
  float tt = u_time * speed / max(u_speed, 0.01);
  vec2 uv = vec2(s - u_time * speed, acrossM);

  g_lod = clamp(length(fwidth(uv)) * 0.3, 0.0, 1.0);
  float e = 0.5;
  float h0 = heightField(uv, tt);
  float hx = heightField(uv + vec2(e, 0.0), tt);
  float hy = heightField(uv + vec2(0.0, e), tt);
  float aa = 1.0 - smoothstep(0.6, 1.6, g_lod);
  vec3 nTS = normalize(vec3((h0 - hx) * 1.8 * aa, (h0 - hy) * 1.8 * aa, 1.0));

  // Smooth geocentric "up" from the vertex shader (no per-triangle derivative normals -> no seams along mesh edges).
  vec3 up = normalize(v_upEC);
  vec3 T = normalize(cross(up, abs(up.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  vec3 B = cross(up, T);
  vec3 N = normalize(T * nTS.x + B * nTS.y + up * nTS.z);

  vec3 V = normalize(-v_posEC);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  // Water body: per-river deep colour, lighter/siltier toward the banks, slow drifting sediment patches.
  float edge = smoothstep(0.45, 1.0, rel);
  vec3 deep = u_tint;
  vec3 shallow = mix(u_tint, vec3(0.30, 0.32, 0.24), 0.55) + 0.05;
  // Where surveyed depth exists (Mula–Mutha), deeper water is darker and shallows lighter; elsewhere the
  // bank-distance gradient stands in for depth.
  float shallowness = v_depth > 0.0 ? max(edge, 1.0 - smoothstep(0.6, 3.0, v_depth)) : edge;
  vec3 body = mix(deep, shallow, shallowness);
  float sed = fbm(vec2(s * 0.012 - u_time * speed * 0.012, acrossM * 0.03));
  body *= 0.9 + 0.2 * sed;
  body = mix(body, vec3(0.36, 0.50, 0.52), foam * 0.45);                 // aerated water on rapids
  vec3 mud = mix(vec3(0.31, 0.24, 0.15), vec3(0.42, 0.33, 0.21), edge) * (0.9 + 0.2 * sed);
  body = mix(body, mud, u_turbid);
  // Light scattering through thin wave crests.
  body += vec3(0.02, 0.035, 0.03) * smoothstep(0.5, 0.75, h0) * aa * (1.0 - u_turbid * 0.6);

  // Environment reflection: horizon haze to zenith blue, picked by how far the reflected ray points upward.
  vec3 Rv = reflect(-V, N);
  float upness = clamp(dot(Rv, up), 0.0, 1.0);
  vec3 sky = mix(vec3(0.66, 0.71, 0.73), vec3(0.33, 0.47, 0.63), pow(upness, 0.6));
  vec3 L = normalize(czm_sunDirectionEC);
  float sunUp = clamp(dot(L, up) * 4.0, 0.0, 1.0);
  float glint = pow(max(dot(reflect(-L, N), V), 0.0), 110.0) * 0.44 * aa * sunUp;     // soft moving sun flecks
  float sheen = pow(max(dot(reflect(-L, N), V), 0.0), 12.0) * 0.065 * sunUp;          // broad reflected sunlight
  // Lift calm water slightly so the Pune reach remains legible in the final aerial; highlights stay restrained.
  vec3 col = mix(body, sky, clamp(0.11 + fres * 0.74, 0.0, 1.0)) + (glint + sheen) * vec3(1.0, 0.96, 0.88);

  // Foam only where water is actually broken: steep rapids (foam > 0) and their edges. Soft patches, never lines.
  float fn = fbm(uv * 0.5 + vec2(-tt * 0.5, 0.0));
  float rapids = smoothstep(0.62, 0.88, fn + foam * 0.4) * foam;
  float bankPatch = smoothstep(0.8, 1.0, rel) * foam * smoothstep(0.5, 0.78, noise(uv * 0.25));
  col = mix(col, vec3(0.82, 0.87, 0.87), clamp((rapids + bankPatch * 0.28) * aa, 0.0, 0.55));

  // Optional fade-out along the channel (u_fadeEnd metres downstream), e.g. where a coarse course stops being reliable.
  float alpha = u_opacity * inWater * (1.0 - smoothstep(u_fadeEnd - 250.0, u_fadeEnd, s));
  return vec4(col, clamp(alpha, 0.0, 1.0));
}

czm_material czm_getMaterial(czm_materialInput materialInput) { return czm_getDefaultMaterial(materialInput); }
`;

const FRAG = `
void main() {
  out_FragColor = riverShade();
}
`;

function haversine(a, b) {
  const R = 6371008.8;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Resample polyline to roughly constant spacing (metres). */
export function resampleLine(coords, stepM) {
  const out = [coords[0]];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    let a = coords[i - 1];
    const b = coords[i];
    let d = haversine(a, b);
    while (carry + d >= stepM) {
      const k = (stepM - carry) / d;
      const p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      out.push(p);
      a = p;
      d = haversine(a, b);
      carry = 0;
    }
    carry += d;
  }
  const last = coords[coords.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Stylised channel half-width (m) as a function of distance from source and a river's size class. */
function halfWidth(distM, maxHalf, minHalf = 4) {
  const k = 1 - Math.exp(-distM / 60000);
  return minHalf + (maxHalf - minHalf) * k;
}

/**
 * HydroRIVERS centerlines come from a ~500 m DEM, so they can sit up to a few hundred metres off the channel visible
 * in the (finer) elevation tiles. Nudge each vertex sideways (within maxOff metres) to the lowest nearby DEM cell
 * (the thalweg), then smooth the offsets along the line so the course stays continuous.
 */
async function snapToThalweg(pts, maxOff, zoom) {
  const n = pts.length;
  const offs = new Float32Array(n);
  const stepOff = 40;
  const nOff = Math.round(maxOff / stepOff);
  // Sample every candidate offset for every vertex concurrently (tile fetches overlap instead of queueing).
  await Promise.all(
    pts.map(async (pt, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const cosLat = Math.cos((pt[1] * Math.PI) / 180);
      const dx = (b[0] - a[0]) * cosLat;
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const ks = [];
      for (let k = -nOff; k <= nOff; k++) ks.push(k);
      const hs = await Promise.all(
        ks.map((k) =>
          sampleTerrariumHeight(pt[0] + (k * stepOff * nx) / (111320 * cosLat), pt[1] + (k * stepOff * ny) / 111320, zoom)
        )
      );
      let best = Infinity;
      ks.forEach((k, j) => {
        if (!Number.isFinite(hs[j])) return;
        const h = hs[j] + Math.abs(k) * 0.35; // mild pull toward the source line
        if (h < best) {
          best = h;
          offs[i] = k;
        }
      });
    })
  );
  // smooth offsets (window +/-8 vertices)
  const sm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let c = 0;
    for (let k = -8; k <= 8; k++) {
      const v = offs[i + k];
      if (v !== undefined) {
        sum += v;
        c++;
      }
    }
    sm[i] = sum / c;
  }
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const cosLat = Math.cos((p[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * cosLat;
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] + (sm[i] * stepOff * (-dy / len)) / (111320 * cosLat), p[1] + (sm[i] * stepOff * (dx / len)) / 111320];
  });
}

/**
 * Build conditioned ribbon vertices for one river line.
 * Returns { lon[], lat[], h[], s[], half[], foam[] } with h in metres above the ellipsoid (≈ DEM, EGM96 offset ignored).
 */
export async function conditionRiverProfile(line, { stepM = 150, maxHalf = 60, zoom = 12, snapM = 0, minWidth = 4, foamSlope = [0.006, 0.096] } = {}) {
  let pts = resampleLine(line, stepM);
  if (snapM > 0) pts = await snapToThalweg(pts, snapM, zoom);
  const raw = await Promise.all(pts.map((p) => sampleTerrariumHeight(p[0], p[1], zoom)));
  // One slow tile must not reject the whole river. Fill gaps from the nearest sampled height.
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < raw.length; j++) {
      if (Number.isFinite(raw[j])) continue;
      const left = raw.slice(0, j).findLast((v) => Number.isFinite(v));
      const right = raw.slice(j + 1).find((v) => Number.isFinite(v));
      raw[j] = Number.isFinite(left) ? left : right;
    }
  }
  if (raw.some((v) => !Number.isFinite(v))) throw new Error("terrain sampling failed for an entire river profile");
  // Moving-average smoothing (window ~ 1.5 km), then enforce downstream monotonic decrease.
  const win = Math.max(2, Math.round(1500 / stepM));
  const sm = raw.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = -win; k <= win; k++) {
      const v = raw[i + k];
      if (v !== undefined) {
        s += v;
        c++;
      }
    }
    return s / c;
  });
  const h = sm.slice();
  for (let i = 1; i < h.length; i++) h[i] = Math.min(h[i], h[i - 1]);
  // Where the DEM at the centreline sits above the conditioned water line (trees, bridges, buildings and SRTM noise
  // in narrow channels), follow the DEM instead so the surface is not buried by the rendered terrain.
  // Sit the surface a little below the sampled terrain so it reads as set into the channel.
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + haversine(pts[i - 1], pts[i]));
  const foam = h.map((_, i) => {
    const j = Math.min(h.length - 1, i + 4);
    const i0 = Math.max(0, i - 4);
    const slope = (h[i0] - h[j]) / Math.max(1, s[j] - s[i0]);
    return Math.max(0, Math.min(1, (slope - foamSlope[0]) / (foamSlope[1] - foamSlope[0]))) * 0.7;
  });
  const half = s.map((d) => halfWidth(d, maxHalf, minWidth));
  return { pts, h, s, half, foam };
}

/** Create a Cesium Primitive ribbon from a conditioned profile. */
export function createRiverPrimitive(Cesium, profile, { heightOffset = 1.5, opacity = 1.0, speed = 2.5, tint = [0.035, 0.11, 0.1], fadeEnd = 1e9 } = {}) {
  tint = new Cesium.Cartesian3(...tint);
  const { pts, h, s, half, foam } = profile;
  const n = pts.length;
  if (n < 2) return null;
  const positions = new Float64Array(n * 2 * 3);
  const info = new Float32Array(n * 2 * 4);
  const base = new Float32Array(n * 2);
  const depthA = new Float32Array(n * 2);
  const ell = Cesium.Ellipsoid.WGS84;
  const tmp = new Cesium.Cartesian3();
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    // Local east/north tangent -> left normal.
    const cosLat = Math.cos((pts[i][1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * cosLat;
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len; // left normal (east comp)
    const ny = dx / len; // (north comp)
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? -1 : 1;
      const mPerDegLat = 111320;
      const mPerDegLon = 111320 * cosLat;
      const lon = pts[i][0] + (sg * nx * half[i]) / mPerDegLon;
      const lat = pts[i][1] + (sg * ny * half[i]) / mPerDegLat;
      Cesium.Cartesian3.fromDegrees(lon, lat, h[i] + heightOffset, ell, tmp);
      const o = (i * 2 + side) * 3;
      positions[o] = tmp.x;
      positions[o + 1] = tmp.y;
      positions[o + 2] = tmp.z;
      const q = (i * 2 + side) * 4;
      info[q] = s[i];
      info[q + 1] = sg;
      info[q + 2] = foam[i];
      info[q + 3] = half[i];
      base[i * 2 + side] = profile.baseHalf ? profile.baseHalf[i] : 0;
      depthA[i * 2 + side] = profile.depth ? profile.depth[i] : 0;
    }
  }
  const indices = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const o = i * 6;
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], o);
  }
  const geometry = new Cesium.Geometry({
    attributes: {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positions,
      }),
      flowInfo: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 4,
        values: info,
      }),
      baseHalf: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 1,
        values: base,
      }),
      depthM: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 1,
        values: depthA,
      }),
    },
    indices,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positions)),
  });

  const material = new Cesium.Material({
    fabric: {
      type: "RiverEyeWater",
      uniforms: { u_time: 0.0, u_opacity: opacity, u_level: 1.0, u_turbid: 0.0, u_speed: speed, u_tint: tint, u_fadeEnd: fadeEnd },
      source: MATERIAL_SRC,
    },
    translucent: true,
  });
  const appearance = new Cesium.Appearance({
    material,
    translucent: true,
    closed: false,
    renderState: {
      depthTest: { enabled: true },
      depthMask: false,
      blending: Cesium.BlendingState.ALPHA_BLEND,
      cull: { enabled: false },
    },
    vertexShaderSource: VERT,
    fragmentShaderSource: FRAG,
  });
  return { geometry, appearance, material };
}
