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
in float batchId;
out vec4 v_flow;
out vec3 v_posEC;
void main() {
  vec4 p = czm_computePosition();
  v_flow = flowInfo;
  v_posEC = (czm_modelViewRelativeToEye * p).xyz;
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`;

// Shading lives in the Material source: Cesium renames material uniforms (u_time -> u_time_N) only inside that
// source, so everything that reads them must be there too. The appearance fragment shader just calls riverShade().
const MATERIAL_SRC = `
in vec4 v_flow;
in vec3 v_posEC;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*noise(p); p=p*2.03+17.1; a*=.5; } return s; }

vec4 riverShade() {
  float s = v_flow.x;           // metres downstream
  float t = v_flow.y;           // -1..1 across channel
  float foam = v_flow.z;
  float hw = max(v_flow.w, 1.0);

  // Flow-aligned coordinates in metres. Speed rises with foam (steeper = faster).
  float speed = 1.2 + 3.5 * foam;
  vec2 uv = vec2(s - u_time * speed, t * hw);
  // Animated height field -> perturbed normal (finite differences on fbm).
  float sc = 0.35;
  float e = 0.25;
  float h0 = fbm(uv * sc + vec2(0.0, u_time * 0.05));
  float hx = fbm((uv + vec2(e, 0.0)) * sc + vec2(0.0, u_time * 0.05));
  float hy = fbm((uv + vec2(0.0, e)) * sc + vec2(0.0, u_time * 0.05));
  vec3 nTS = normalize(vec3((h0 - hx) * 3.0, (h0 - hy) * 3.0, 1.0));
  // Fade ripples out once they get smaller than a pixel (prevents sparkling aliasing from altitude).
  float aa = clamp(1.0 - length(fwidth(uv * sc)) * 1.2, 0.0, 1.0);
  nTS = normalize(mix(vec3(0.0, 0.0, 1.0), nTS, aa));

  // Use eye-space surface normal approximated from derivatives so ribbon lighting follows terrain slope.
  vec3 dx = dFdx(v_posEC), dy = dFdy(v_posEC);
  vec3 geoN = normalize(cross(dx, dy));
  if (geoN.z < 0.0) geoN = -geoN;
  vec3 T = normalize(dx - geoN * dot(geoN, dx));
  vec3 B = cross(geoN, T);
  vec3 N = normalize(T * nTS.x + B * nTS.y + geoN * nTS.z);

  vec3 V = normalize(-v_posEC);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  // Water colour: shallow, silty banks to deeper green-blue core (visual only).
  float edge = smoothstep(0.55, 1.0, abs(t));
  vec3 deep = vec3(0.05, 0.13, 0.12);
  vec3 shallow = vec3(0.20, 0.25, 0.18);
  vec3 body = mix(deep, shallow, edge);
  // Glacial / turbid mountain water is paler.
  body = mix(body, vec3(0.45, 0.62, 0.66), foam * 0.55);

  // Sky reflection + sun glint.
  vec3 sky = mix(vec3(0.42, 0.52, 0.60), vec3(0.70, 0.78, 0.84), 1.0 - ndv);
  vec3 L = normalize(czm_sunDirectionEC);
  vec3 R = reflect(-L, N);
  float spec = pow(max(dot(R, V), 0.0), 160.0) * 0.9 * aa;
  vec3 col = mix(body, sky, fres) + spec;

  // Foam: rapids (slope) + noisy streaks, stronger toward banks.
  float fn = fbm(uv * 1.3 + vec2(0.0, u_time * 0.1));
  float f = smoothstep(0.52, 0.8, fn + foam * 0.55 + edge * 0.18 * foam) * foam;
  col = mix(col, vec3(0.86, 0.91, 0.92), clamp(f, 0.0, 0.6));

  // Soft bank blend so the ribbon sits into the terrain instead of a hard rectangle edge.
  float alpha = u_opacity * (1.0 - smoothstep(0.78, 1.0, abs(t)));
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
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const cosLat = Math.cos((pts[i][1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * cosLat;
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    let best = Infinity;
    let bestK = 0;
    for (let k = -nOff; k <= nOff; k++) {
      const lon = pts[i][0] + (k * stepOff * nx) / (111320 * cosLat);
      const lat = pts[i][1] + (k * stepOff * ny) / 111320;
      const h = (await sampleTerrariumHeight(lon, lat, zoom)) + Math.abs(k) * 0.35; // mild pull toward the source line
      if (h < best) {
        best = h;
        bestK = k;
      }
    }
    offs[i] = bestK;
  }
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
export async function conditionRiverProfile(line, { stepM = 150, maxHalf = 60, zoom = 12, snapM = 0, minWidth = 4 } = {}) {
  let pts = resampleLine(line, stepM);
  if (snapM > 0) pts = await snapToThalweg(pts, snapM, zoom);
  const raw = new Array(pts.length);
  // Sample in small batches to avoid flooding the tile cache with requests.
  for (let i = 0; i < pts.length; i += 24) {
    const batch = pts.slice(i, i + 24).map((p) => sampleTerrariumHeight(p[0], p[1], zoom));
    const res = await Promise.all(batch);
    res.forEach((v, j) => (raw[i + j] = v));
  }
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
  for (let i = 0; i < h.length; i++) h[i] = Math.max(h[i], raw[i] - 1.5);
  // Sit the surface a little below the sampled terrain so it reads as set into the channel.
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + haversine(pts[i - 1], pts[i]));
  const foam = h.map((_, i) => {
    const j = Math.min(h.length - 1, i + 4);
    const i0 = Math.max(0, i - 4);
    const slope = (h[i0] - h[j]) / Math.max(1, s[j] - s[i0]);
    return Math.max(0, Math.min(1, (slope - 0.006) / 0.09)) * 0.7;
  });
  const half = s.map((d) => halfWidth(d, maxHalf, minWidth));
  return { pts, h, s, half, foam };
}

/** Create a Cesium Primitive ribbon from a conditioned profile. */
export function createRiverPrimitive(Cesium, profile, { heightOffset = 1.5, opacity = 1.0 } = {}) {
  const { pts, h, s, half, foam } = profile;
  const n = pts.length;
  if (n < 2) return null;
  const positions = new Float64Array(n * 2 * 3);
  const info = new Float32Array(n * 2 * 4);
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
    },
    indices,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positions)),
  });

  const material = new Cesium.Material({
    fabric: {
      type: "RiverEyeWater",
      uniforms: { u_time: 0.0, u_opacity: opacity },
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

