export const state = {
  playing: false,
  pathT: 0,
  pathDuration: 140,
  journeyT: 0,
  journeyDuration: 140,
  flowSpeed: 0.45,
  flowVisibility: 0.55,
  waterOpacity: 0.48,


/** River state */
  riverEnabled: true,

  riverMode: "flowing",

  animateWater: true,


  /** Calm cinematic river waves (from Alembic motion intent → GPU on KML mesh). */
  waterAnimEnabled: true,
  waterPreset: "calmRealistic",
  waterQuality: "high",
  waterOverallSpeed: 0.55,
  primaryWaveAmplitude: 0.06,
  primaryWaveSpeed: 0.035,
  secondaryWaveAmplitude: 0.035,
  secondaryWaveSpeed: 0.05,
  rippleAmplitude: 0.015,
  rippleSpeed: 0.07,
  flowStrength: 0.85,
  reflectionStrength: 0.58,
  waveHighlight: 0.78,
  shallowWaterColor: "#4fc8eb",
  deepWaterColor: "#07529d",
  showWaterDebug: false,
  /** Metres above normal river surface (SURFACE_Y) — illustrative bathtub only. */
  floodRiseM: 0,
  /** Saved bathtub stage while MODE A (API flood) is active. */
  savedFloodRiseM: null,
  /**
   * Dual flood modes (mutually exclusive surfaces):
   * - "illustrative" → floodLayer.js (bathtub)
   * - "api" → apiFloodLayer.js (JalNetra)
   */
  floodMode: "illustrative",
  /** Top Flood Simulation toolbar visibility (toggled from Flood map control). */
  showFloodBar: false,
  /** JalNetra API flood simulation state (MODE A). */
  apiFlood: {
    status: "idle", // idle|loading|running|ready|complete|empty|error
    result: null,
    scenes: [],
    currentScene: 0,
    currentDate: null,
    isPlaying: false,
    progress: 0,
    error: null,
    errorDetails: null,
    message: "",
    showLayer: true,
  },
  /** @deprecated prefer state.apiFlood.status */
  showFloodSimulation: true,
  showFloodDepthViz: false,
  /** @deprecated prefer state.apiFlood.status */
  floodSimStatus: "idle",
  floodSimMessage: "",
  floodSimInfo: null,
  showRiverBanks: false,
  depthExaggeration: 2,
  showWater: true,
  showBathymetry: true,
  showVegetation: true,
  /** JalNetra Vegetation Type API layer status: idle|loading|ready|empty|error */
  vegetationStatus: "idle",
  vegetationMessage: "",
  showUrban: true,
  showBridges: true,
  showBridgeNames: false,
  /** Terrain / DTM is always on — not a Layers toggle. */
  showTerrain: true,
  /** Google Earth KML polygon + centerline (driven by Map Reference Grid). */
  showKmlSkeleton: false,
  /** Combined Layers control: KML Skeleton + Coordinate Grid. */
  showMapReferenceGrid: false,
  /** OSM waterways KML — Layers → Small channels. Also drives nalla water animation. */
  showDrainage: false,
  /** Mirrored from showDrainage for internal sync; not a separate UI toggle. */
  showNallaFlow: false,
  /** Internal speed — default looks correct; optional slider only. */
  nallaFlowSpeed: 0.65,
  /** Jul 2026 depth-class polygons (1.5–2.0 m) — Layers → Depth zones (glassy). */
  showDepthZones: false,
  /** Raw Excel/CSV survey points — removed from Layers UI; kept off. */
  showRawSurveyPoints: false,
  /** Glassy depth-zone animation on when layer is visible. */
  glassyAnimatedFlow: true,
  glassyFlowSpeed: 0.45,
  glassyWaterOpacity: 0.72,
  /** "cinematic" | "data" */
  glassyVizMode: "cinematic",
  /** One-shot reveal when enabling depth zones. */
  glassyRevealActive: false,
  selectedDepthZoneId: null,
  showOsmTrees: true,
  showOsmRoads: true,
  showOsmBuildings: true,
  showOsmAlignment: false,
  showLayers: false,
  showSettings: false,
  inspectMode: false,
  showValidation: false,
  showFish: true,
  /** Developer-only; production default off — enable via debugFlags / localStorage. */
  showFishDebug: false,
  showChainage: true,
  /** Show chainage text on every marker (Layers → Chainage toolkit). */
  showChainageLabels: false,
  /** "station" = 0+000 style · "meters" = 12400 m */
  chainageLabelMode: "station",
  /** Selected chainage meters (click highlight). */
  selectedChainageMeters: null,
  /** True while hovering the selected chainage (suppresses water-depth tip). */
  chainageTipActive: false,
  cinematicActive: false,
  cinematicPaused: false,
  cinematicProgress: 0,
  cinematicPhase: "idle",
  cinematicFishBoost: false,
  cinematicJumpCue: false,
  cinematicUnderwater: false,
  cinematicFishScene: false,
  cinematicJumpSequence: false,
  cinematicJumpBudget: 0,
  cinematicFishingPointFocus: null,
  cinematicBridgeFocus: null,
  cinematicInfo: null,
  showCoordinateGrid: false,
  cameraMode: "overview",
  visualMode: "landscape",
  elapsed: 0,
  hover: null,

  // ── Sky & Atmosphere (Overview cinematic sky) ──
  skyEnabled: true,
  skyPreset: "calmRealistic",
  skyCloudDensity: 0.42,
  /** 0.2–0.55 ≈ very slow cinematic (full cycle ~90–180s at mid values). */
  skyCloudSpeed: 0.32,
  skyAnimStrength: 0.28,
  skySunIntensity: 1.0,
  skyAtmosphere: 0.55,
  skyHorizonHaze: 0.48,
  skyCloudShadows: true,
  /** Minimal daylight sun drift (not day/night). */
  skySunDrift: 0.22,
  /** "low" | "medium" | "high" — sky shader / cloud / shadow detail. */
  skyQuality: "high",
};
