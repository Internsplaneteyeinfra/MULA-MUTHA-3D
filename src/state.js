export const state = {
  playing: false,
  pathT: 0,
  pathDuration: 140,
  journeyT: 0,
  journeyDuration: 140,
  flowSpeed: 0.55,
  flowVisibility: 0,
  waterOpacity: 0.88,
  /** Metres above normal river surface (SURFACE_Y) — bathtub flood stage. */
  floodRiseM: 0,
  showRiverBanks: false,
  depthExaggeration: 2,
  showWater: true,
  showBathymetry: true,
  showVegetation: true,
  showUrban: true,
  showBridges: true,
  showBridgeNames: false,
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
  showLayers: true,
  inspectMode: false,
  showValidation: false,
  showWaterDebug: false,
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
};
