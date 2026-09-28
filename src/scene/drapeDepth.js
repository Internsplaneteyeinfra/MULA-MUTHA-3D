/**
 * Terrain-draped overlay depth handling.
 *
 * Draped KML / KMZ overlays sit on the DTM and must be hidden by the OSM layers
 * above it (bridges, buildings, trees). They depth-test normally, but their
 * depth is pulled toward the camera by a few metres so coarse drape grids do
 * not sink into the terrain between vertices. Only depth is changed — the
 * projected screen position is untouched.
 */

export const DRAPE_DEPTH_PULL_M = 2.5;

/** Above every draped overlay's renderOrder, so roads draw after them. */
export const OSM_ROADS_RENDER_ORDER = 60;

/**
 * @param {import("three").Material} material
 * @param {number} [pullM]
 * @returns {import("three").Material}
 */
export function applyDrapeDepth(material, pullM = DRAPE_DEPTH_PULL_M) {
  material.depthTest = true;
  material.depthWrite = false;
  const pull = Number(pullM).toFixed(3);
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      /\}\s*$/,
      `  {
    vec4 drapeView = inverse(projectionMatrix) * gl_Position;
    drapeView /= drapeView.w;
    drapeView.z = min(drapeView.z + ${pull}, drapeView.z * 0.5);
    vec4 drapeClip = projectionMatrix * drapeView;
    gl_Position.z = (drapeClip.z / drapeClip.w) * gl_Position.w;
  }
}
`,
    );
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ""}|drape${pull}`;
  material.needsUpdate = true;
  return material;
}
