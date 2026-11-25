/**
 * Public facade for NadiTwin hydrology integration (Phase 4).
 * Prefer importing from here in UI code.
 */

export {
  applyNadiTwinQToProfileRecords,
  areSafetyBoardsUnlocked,
  getAdapterSnapshot,
  getNadiTwinAlignment,
  getNadiTwinDischargeAtChainage,
  getNadiTwinForecastAlongReach,
  getNadiTwinHydrographAtCell,
  getNadiTwinHydrographAtChainage,
  getNadiTwinLiveBundle,
  getNadiTwinSafetyBoard,
  refreshNadiTwinHydrology,
  setLocalChainageStations,
  startNadiTwinHydrologyPolling,
  stopNadiTwinHydrologyPolling,
  subscribeNadiTwinHydrology,
  unlockSafetyBoards,
} from "./naditwinHydrologyAdapter.js";

export {
  DATA_CLASS,
  DAM_RELEASES_NOTE,
  freshnessLabel,
  NADITWIN_SOURCE,
} from "./hydrologyProvenance.js";
