import * as THREE from "three";

/** Muted Pune urban plaster / concrete palette (sRGB hex) — visible variation. */
export const PUNE_PALETTE = [
  "#e8dcc8", // warm cream
  "#ddd0bc", // pale beige
  "#cfc4b4", // light grey-beige
  "#d4c4a8", // muted brown
  "#e6d8c8", // soft peach
  "#c8d0d8", // faded blue-grey
  "#d8e0d0", // muted green-grey
  "#f0e8dc", // warm white
  "#dcc8b0", // sandstone
  "#c8b8a8", // dusty taupe
  "#e0d4c4", // light plaster
  "#b8c8c0", // soft pastel green
];

const STYLE = {
  house: 0,
  row: 1,
  apartment_low: 2,
  apartment_mid: 3,
  apartment_high: 4,
  commercial: 5,
  warehouse: 6,
};

/**
 * Shared PBR facade materials (one per style) with procedural windows / weathering.
 * Safe for InstancedMesh + instanceColor.
 */
const cache = new Map();

export function getBuildingMaterial(styleClass) {
  const key = styleClass || "house";
  if (cache.has(key)) return cache.get(key);

  const preset = materialPreset(key);
  const mat = new THREE.MeshStandardMaterial({
    color: "#ece6dc",
    roughness: preset.roughness,
    metalness: preset.metalness,
    envMapIntensity: 0.55,
  });
  mat.name = `facade_${key}`;
  mat.userData.styleId = STYLE[key] ?? 0;
  mat.userData.floorsHint = preset.floorsHint;
  mat.userData.winScale = preset.winScale;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStyleId = { value: mat.userData.styleId };
    shader.uniforms.uWinScale = { value: mat.userData.winScale };
    shader.uniforms.uFloorsHint = { value: mat.userData.floorsHint };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vBldgLocal;
        varying vec3 vBldgNormal;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        vBldgNormal = objectNormal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vBldgLocal = position;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uStyleId;
        uniform float uWinScale;
        uniform float uFloorsHint;
        varying vec3 vBldgLocal;
        varying vec3 vBldgNormal;

        float hash21(vec2 p){
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise2(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 nAbs = abs(normalize(vBldgNormal));
          float isRoof = step(0.72, nAbs.y);
          float isWall = 1.0 - isRoof;

          // Object-space facade axes (scale-stable on prototype)
          float wallU = (nAbs.x > nAbs.z) ? vBldgLocal.z : vBldgLocal.x;
          float wallV = vBldgLocal.y;

          float floorH = max(2.6, 3.05);
          float floors = max(1.0, uFloorsHint);
          float winW = mix(2.4, 3.2, step(3.5, uStyleId)) * uWinScale;
          float winH = 1.35;

          float fx = fract(wallU / winW);
          float fy = fract((wallV - 0.9) / floorH);
          float inWinX = step(0.18, fx) * step(fx, 0.82);
          float inWinY = step(0.28, fy) * step(fy, 0.78);
          float windowMask = inWinX * inWinY * isWall * step(1.1, wallV);

          // Balcony band for apartments
          float balcony = 0.0;
          if (uStyleId >= 2.0 && uStyleId <= 4.0) {
            float by = fract((wallV - 0.4) / floorH);
            balcony = smoothstep(0.08, 0.14, by) * (1.0 - smoothstep(0.18, 0.26, by)) * isWall;
          }

          // Commercial ground-floor glazing
          float shop = 0.0;
          if (uStyleId >= 5.0 && uStyleId < 6.0) {
            shop = step(wallV, 3.2) * step(0.4, wallV) * isWall * 0.85;
          }

          // Warehouse vertical panels / corrugation cue
          float panel = 0.0;
          if (uStyleId >= 6.0) {
            panel = 0.08 * sin(wallU * 2.8) * isWall;
          }

          vec3 glass = vec3(0.42, 0.52, 0.58);
          vec3 darkGlass = vec3(0.32, 0.40, 0.46);
          float glassPick = hash21(floor(vec2(wallU / winW, wallV / floorH)));
          vec3 winCol = mix(glass, darkGlass, step(0.55, glassPick));

          diffuseColor.rgb = mix(diffuseColor.rgb, winCol, windowMask * 0.72);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.92, balcony * 0.4);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(winCol, diffuseColor.rgb, 0.45), shop);

          // Concrete / plaster micro-noise
          float n = noise2(vec2(wallU, wallV) * 0.35);
          diffuseColor.rgb *= mix(1.02, 1.08, n);

          // Base dirt + roof edge weathering (keep light)
          float dirt = smoothstep(0.0, 2.2, 2.2 - wallV) * 0.05 * isWall;
          float roofDirt = isRoof * (0.03 + 0.04 * noise2(vBldgLocal.xz * 0.4));
          diffuseColor.rgb *= (1.0 - dirt - roofDirt);

          // Edge darkening
          float edge = pow(1.0 - abs(dot(normalize(vBldgNormal), vec3(0.0, 1.0, 0.0))), 1.4);
          diffuseColor.rgb *= mix(1.0, 0.96, edge * isWall * 0.25);

          diffuseColor.rgb += panel * 0.35;

          // Roof tone — light concrete / terracotta
          if (isRoof > 0.5) {
            if (uStyleId >= 6.0) {
              float corr = 0.5 + 0.5 * sin(vBldgLocal.x * 6.0);
              diffuseColor.rgb = mix(vec3(0.72, 0.73, 0.74), vec3(0.80, 0.81, 0.82), corr);
            } else {
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.78, 0.72), 0.45);
            }
          }
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        {
          vec3 nAbs = abs(normalize(vBldgNormal));
          float isRoof = step(0.72, nAbs.y);
          float wallU = (nAbs.x > nAbs.z) ? vBldgLocal.z : vBldgLocal.x;
          float wallV = vBldgLocal.y;
          float floorH = 3.05;
          float winW = 2.8 * uWinScale;
          float fx = fract(wallU / winW);
          float fy = fract((wallV - 0.9) / floorH);
          float windowMask = step(0.18, fx) * step(fx, 0.82) * step(0.28, fy) * step(fy, 0.78)
            * (1.0 - isRoof) * step(1.1, wallV);
          roughnessFactor = mix(roughnessFactor, 0.18, windowMask * 0.85);
          roughnessFactor = mix(roughnessFactor, 0.78, isRoof * 0.4);
        }`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
        {
          vec3 nAbs = abs(normalize(vBldgNormal));
          float isRoof = step(0.72, nAbs.y);
          float wallU = (nAbs.x > nAbs.z) ? vBldgLocal.z : vBldgLocal.x;
          float wallV = vBldgLocal.y;
          float floorH = 3.05;
          float winW = 2.8 * uWinScale;
          float fx = fract(wallU / winW);
          float fy = fract((wallV - 0.9) / floorH);
          float windowMask = step(0.18, fx) * step(fx, 0.82) * step(0.28, fy) * step(fy, 0.78)
            * (1.0 - isRoof) * step(1.1, wallV);
          metalnessFactor = mix(metalnessFactor, 0.45, windowMask * 0.7);
          if (uStyleId >= 6.0) metalnessFactor = mix(metalnessFactor, 0.35, isRoof * 0.5);
        }`,
      );
  };

  mat.customProgramCacheKey = () => `pune_facade_${key}_v3`;
  cache.set(key, mat);
  return mat;
}

function materialPreset(cls) {
  switch (cls) {
    case "apartment_high":
      return { roughness: 0.72, metalness: 0.06, floorsHint: 12, winScale: 0.95 };
    case "apartment_mid":
      return { roughness: 0.76, metalness: 0.05, floorsHint: 7, winScale: 1.0 };
    case "apartment_low":
      return { roughness: 0.8, metalness: 0.04, floorsHint: 4, winScale: 1.05 };
    case "commercial":
      return { roughness: 0.62, metalness: 0.12, floorsHint: 4, winScale: 0.85 };
    case "warehouse":
      return { roughness: 0.88, metalness: 0.18, floorsHint: 2, winScale: 1.4 };
    case "row":
      return { roughness: 0.82, metalness: 0.04, floorsHint: 3, winScale: 1.1 };
    default:
      return { roughness: 0.86, metalness: 0.03, floorsHint: 2, winScale: 1.15 };
  }
}

/** Deterministic plaster color from building id / seed. */
export function paletteColor(seed) {
  const i = Math.abs(Math.floor(seed)) % PUNE_PALETTE.length;
  return new THREE.Color(PUNE_PALETTE[i]);
}

/** Neighborhood-clustered palette — nearby buildings share related hues (ArcGIS-style coherence). */
export function neighborhoodPaletteColor(seed, x, z) {
  const cellX = Math.floor((x || 0) / 85);
  const cellZ = Math.floor((z || 0) / 85);
  const neighborhood = Math.abs(cellX * 73856093 ^ cellZ * 19349663) + Math.abs(Math.floor(seed));
  const base = paletteColor(neighborhood);
  const jitter = ((Math.abs(Math.floor(seed)) % 5) - 2) * 0.012;
  base.offsetHSL(jitter * 0.3, 0, jitter);
  return base;
}

export function styleClassFromClassification(classification) {
  return classification?.class || "house";
}

/** Distant LOD: cheaper standard material, muted variation via vertex colors. */
export function getFarLodMaterial() {
  if (cache.has("__far")) return cache.get("__far");
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.04,
  });
  mat.name = "facade_far";
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vFarLocal;
        varying vec3 vFarN;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        vFarN = objectNormal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vFarLocal = position;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vFarLocal;
        varying vec3 vFarN;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 nAbs = abs(normalize(vFarN));
          float isWall = 1.0 - step(0.72, nAbs.y);
          float u = (nAbs.x > nAbs.z) ? vFarLocal.z : vFarLocal.x;
          float v = vFarLocal.y;
          float fx = fract(u / 3.4);
          float fy = fract(v / 3.2);
          float win = step(0.2, fx) * step(fx, 0.8) * step(0.3, fy) * step(fy, 0.75) * isWall * step(2.0, v);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.24, 0.28), win * 0.75);
          diffuseColor.rgb *= mix(1.0, 0.9, smoothstep(0.0, 3.0, 3.0 - v) * isWall * 0.5);
        }`,
      );
  };
  mat.customProgramCacheKey = () => "pune_facade_far";
  cache.set("__far", mat);
  return mat;
}

/** Mid-distance footprint extrusions — vertex colors, simplified windows. */
export function getMidLodMaterial() {
  if (cache.has("__mid")) return cache.get("__mid");
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.05,
  });
  mat.name = "facade_mid";
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vMidL;\nvarying vec3 vMidN;`)
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>\nvMidN = objectNormal;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvMidL = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vMidL;\nvarying vec3 vMidN;`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 nAbs = abs(normalize(vMidN));
          float isRoof = step(0.62, nAbs.y);
          float isWall = 1.0 - isRoof;
          float u = (nAbs.x > nAbs.z) ? vMidL.z : vMidL.x;
          float v = vMidL.y;
          float win = step(0.22, fract(u/3.2)) * step(fract(u/3.2), 0.78) * step(0.32, fract(v/3.0)) * step(fract(v/3.0), 0.72) * isWall * step(2.5, v);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.28, 0.32), win * 0.55);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.82, isRoof * 0.45);
          diffuseColor.rgb *= mix(1.0, 0.88, isWall * 0.35);
        }`,
      );
  };
  mat.customProgramCacheKey = () => "pune_facade_mid";
  cache.set("__mid", mat);
  return mat;
}
