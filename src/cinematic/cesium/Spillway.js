/**
 * Spillway overflow (VISUAL SIMULATION) on a real dam crest.
 *
 * Geometry: a sheet of falling water laid along a section of the OSM dam crest, following an ogee-style profile from
 * the crest down the downstream face to the toe, then a turbulent tail-water pool that runs out downstream.
 * Crest/toe heights and the downstream side are measured from the DEM at runtime, so the sheet sits on the real dam.
 * Nothing here implies the real dam is releasing water; the HUD labels the sequence as a simulation.
 */
import { sampleTerrariumHeight, registerBurnChannel } from "./TerrariumTerrainProvider.js";

const VERT = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 spillInfo;   // x: across crest (m), y: 0 crest .. 1 toe .. 2 end of tail-water, z: local slope 0..1
in float batchId;
out vec3 v_spill;
out vec3 v_posEC;
void main() {
  vec4 p = czm_computePosition();
  v_spill = spillInfo;
  v_posEC = (czm_modelViewRelativeToEye * p).xyz;
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`;

const MATERIAL_SRC = `
in vec3 v_spill;
in vec3 v_posEC;
float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float nz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hsh(i),hsh(i+vec2(1,0)),f.x), mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),f.x), f.y); }
float fb(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*nz(p); p=p*2.07+11.3; a*=.5; } return s; }

vec4 spillShade() {
  float x = v_spill.x;            // metres across the crest
  float y = v_spill.y;            // 0 crest -> 1 toe -> 2 tail-water end
  float flowOn = u_flow;          // 0..1 gate opening (animated)
  float t = u_time;

  vec3 dx = dFdx(v_posEC), dy = dFdy(v_posEC);
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, v_posEC) > 0.0) N = -N;
  vec3 V = normalize(-v_posEC);
  vec3 L = normalize(czm_sunDirectionEC);

  vec3 col;
  float alpha;
  // Soft lateral edges (no hard rectangle): feather over ~6 m on the face, ~20 m in the tail-water.
  if (y <= 1.0) {
    // Falling sheet: glassy, dark-green lip at the crest, breaking into white aerated water as it accelerates.
    float fall = y * y * 6.0 + y * 1.5;
    // Vertical striations of the nappe, ~4 m apart so they stay resolvable from a few hundred metres.
    float streak = fb(vec2(x * 0.26, fall * 2.2 - t * 3.2));
    float fine = nz(vec2(x * 3.5, fall * 14.0 - t * 12.0));
    // Over the crest the nappe is a clear, glassy continuation of the reservoir (its colour, with fast downward
    // streaks); it breaks into white aerated water only in the lower part of the fall.
    float aer = smoothstep(0.52, 0.9, y);
    vec3 lip = vec3(0.04, 0.2, 0.16) + vec3(0.08, 0.11, 0.1) * pow(1.0 - abs(dot(N, V)), 3.0) + streak * vec3(0.12, 0.16, 0.14);
    vec3 white = mix(vec3(0.48, 0.60, 0.62), vec3(0.86, 0.91, 0.91), smoothstep(0.3, 0.8, streak * 0.72 + fine * 0.28));
    col = mix(lip, white, clamp(aer * (0.55 + 0.28 * streak), 0.0, 0.82));
    col *= 0.7 + 0.3 * max(dot(N, L), 0.0);
    col += pow(max(dot(reflect(-L, N), V), 0.0), 80.0) * 0.6 * (1.0 - aer);
    float edge = smoothstep(0.0, 6.0, x) * smoothstep(0.0, 6.0, u_width - x);
    // Before the crest this is reservoir water accelerating toward the lip: nearly transparent, only glints.
    float approach = smoothstep(0.02, 0.3, y);
    alpha = flowOn * edge * approach * mix(0.52, 0.82, aer);
  } else {
    // Tail-water: fine boiling foam right at the impact, thinning into streaks that are carried downstream.
    float d = y - 1.0;
    vec2 q = vec2(x * 0.55, d * 30.0 - t * 2.2);
    float boil = fb(q + vec2(sin(t * 0.9 + x * 0.05) * 0.8, 0.0));
    float boil2 = fb(q * 2.4 - vec2(0.0, t * 1.6));
    float density = 1.0 - smoothstep(0.0, 0.55, d);
    float foam = smoothstep(0.45 - 0.35 * density, 0.75, boil * 0.6 + boil2 * 0.4) * (0.35 + 0.65 * density);
    vec3 water = vec3(0.06, 0.15, 0.14);
    col = mix(water, vec3(0.82, 0.88, 0.88), clamp(foam * 0.9, 0.0, 0.86));
    col *= 0.65 + 0.35 * max(dot(N, L), 0.0);
    float edge = smoothstep(0.0, 18.0, x) * smoothstep(0.0, 18.0, u_width - x);
    alpha = flowOn * edge * (1.0 - smoothstep(0.55, 1.0, d)) * mix(0.75, 0.97, foam);
  }
  return vec4(col, clamp(alpha, 0.0, 1.0));
}

czm_material czm_getMaterial(czm_materialInput materialInput) { return czm_getDefaultMaterial(materialInput); }
`;

const FRAG = `
void main() { out_FragColor = spillShade(); }
`;

const lerpN = (a, b, t) => a + (b - a) * t;

function offsetLL(lon, lat, eastM, northM) {
  const cos = Math.cos((lat * Math.PI) / 180);
  return [lon + eastM / (111320 * cos), lat + northM / 110574];
}

/**
 * @param crest  [[lon,lat],[lon,lat]] endpoints of the spillway section on the dam crest
 * Returns { primitive, material, crestH, toeH, downstreamUnit:[e,n], centre:{lon,lat,h}, toeCentre:{lon,lat,h} }
 */
export async function createSpillway(Cesium, scene, crest, { tailLengthM = 110, faceLengthM = 40 } = {}) {
  const [a, b] = crest;
  const cos = Math.cos((a[1] * Math.PI) / 180);
  const ex = (b[0] - a[0]) * 111320 * cos;
  const ny = (b[1] - a[1]) * 110574;
  const width = Math.hypot(ex, ny);
  const ux = ex / width, uy = ny / width; // along crest (east, north)
  let px = -uy, py = ux; // perpendicular
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  // Which side is downstream? The side whose DEM is lower 120 m away (the reservoir side is the high water surface).
  const side1 = offsetLL(mid[0], mid[1], px * 120, py * 120);
  const side2 = offsetLL(mid[0], mid[1], -px * 120, -py * 120);
  const [h1, h2] = await Promise.all([sampleTerrariumHeight(...side1, 14), sampleTerrariumHeight(...side2, 14)]);
  if (h2 < h1) {
    px = -px;
    py = -py;
  }
  // Crest height: highest DEM sample along the crest section; toe: DEM just beyond the downstream face.
  const crestSamples = await Promise.all(
    [0.1, 0.3, 0.5, 0.7, 0.9].map((k) => sampleTerrariumHeight(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, 14))
  );
  // Water can't stand above the reservoir: the overflow sheet starts at the reservoir surface (flat DEM upstream)
  // and passes the crest with ~0.6 m of head. The dam top itself (DEM ridge) is the structure, not the water.
  const resLL = offsetLL(mid[0], mid[1], -px * 150, -py * 150);
  const reservoirH = await sampleTerrariumHeight(resLL[0], resLL[1], 14);
  const crestH = Math.min(Math.max(...crestSamples), reservoirH + 0.6);
  const toeLL = offsetLL(mid[0], mid[1], px * (faceLengthM + 15), py * (faceLengthM + 15));
  const toeH = Math.min(await sampleTerrariumHeight(toeLL[0], toeLL[1], 14), crestH - 8) + 0.8;

  const COLS = 48;
  const FACE_ROWS = 28;
  const TAIL_ROWS = 16;
  const rows = FACE_ROWS + TAIL_ROWS + 1;
  const pos = new Float64Array(COLS * rows * 3);
  const info = new Float32Array(COLS * rows * 3);
  const tmp = new Cesium.Cartesian3();
  let k = 0;
  for (let r = 0; r < rows; r++) {
    let outM, h, y;
    if (r <= FACE_ROWS) {
      const u = r / FACE_ROWS;
      // Starts 12 m inside the reservoir (drawdown toward the crest), then an ogee-like fall to the toe.
      outM = -12 + (faceLengthM + 12) * (0.25 * u + 0.75 * Math.pow(u, 1.35));
      const fall = u < 0.2 ? 0.0 : Math.pow((u - 0.2) / 0.8, 1.6);
      h = u < 0.2 ? lerpN(reservoirH + 0.25, crestH, u / 0.2) : crestH - (crestH - toeH) * fall;
      y = u;
    } else {
      const u = (r - FACE_ROWS) / TAIL_ROWS;
      outM = faceLengthM + tailLengthM * u;
      h = toeH + 0.3;
      y = 1 + u;
    }
    for (let c = 0; c < COLS; c++) {
      const across = (c / (COLS - 1)) * width;
      // Tail-water widens slightly as it spreads.
      const spread = r > FACE_ROWS ? 1 + 0.25 * ((r - FACE_ROWS) / TAIL_ROWS) : 1;
      const acrossC = (across - width / 2) * spread;
      const ll = offsetLL(mid[0], mid[1], ux * acrossC + px * outM, uy * acrossC + py * outM);
      Cesium.Cartesian3.fromDegrees(ll[0], ll[1], h, Cesium.Ellipsoid.WGS84, tmp);
      pos[k * 3] = tmp.x;
      pos[k * 3 + 1] = tmp.y;
      pos[k * 3 + 2] = tmp.z;
      info[k * 3] = across;
      info[k * 3 + 1] = y;
      info[k * 3 + 2] = 0;
      k++;
    }
  }
  // Carve the spillway opening into the displayed DEM along the sheet's centreline (a spillway is a notch below the
  // dam top), so the falling water is never cut by the coarse terrain mesh of the narrow dam ridge.
  const notch = { pts: [], half: [], h: [] };
  for (let r = 0; r < rows; r++) {
    const c = Math.floor(COLS / 2);
    const k0 = r * COLS + c;
    const carto = Cesium.Cartographic.fromCartesian(new Cesium.Cartesian3(pos[k0 * 3], pos[k0 * 3 + 1], pos[k0 * 3 + 2]));
    notch.pts.push([Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)]);
    notch.half.push((width / 2) * (r > FACE_ROWS ? 1 + 0.25 * ((r - FACE_ROWS) / TAIL_ROWS) : 1));
    notch.h.push(carto.height - 0.4);
  }
  registerBurnChannel(notch);

  const idx = [];
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < COLS - 1; c++) {
      const i0 = r * COLS + c;
      idx.push(i0, i0 + 1, i0 + COLS, i0 + 1, i0 + COLS + 1, i0 + COLS);
    }
  const geometry = new Cesium.Geometry({
    attributes: {
      position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: pos }),
      spillInfo: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: info }),
    },
    indices: new Uint32Array(idx),
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(pos)),
  });
  const material = new Cesium.Material({
    fabric: {
      type: "RiverEyeSpillway",
      uniforms: { u_time: 0.0, u_flow: 0.0, u_width: width },
      // Uniforms must be referenced in the material source to be declared (Cesium renames them there).
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
  const primitive = scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      appearance,
      asynchronous: false,
      compressVertices: false,
    })
  );
  const toeC = offsetLL(mid[0], mid[1], px * faceLengthM, py * faceLengthM);
  const downstreamBearing = ((Math.atan2(px, py) * 180) / Math.PI + 360) % 360;
  return {
    primitive,
    material,
    width,
    crestH,
    toeH,
    downstreamBearing,
    crestCentre: { lon: mid[0], lat: mid[1], h: crestH },
    toeCentre: { lon: toeC[0], lat: toeC[1], h: toeH },
    alongCrest: [ux, uy],
    out: [px, py],
  };
}
