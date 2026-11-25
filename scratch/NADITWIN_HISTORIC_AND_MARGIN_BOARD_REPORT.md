# NADITWIN_HISTORIC_AND_MARGIN_BOARD_REPORT

**Date:** 2026-11-25  
**App:** http://localhost:5185/  
**Result:** PASS

## Summary

Added HISTORIC date/time/step controls and a NadiTwin-style Margin Board without changing LIVE behaviour. All three charts (Discharge → Stage → Hydrograph) synchronize to `/api/state?at=` and hydrograph cursor when HISTORIC is active.

## LIVE preserved

- LIVE button, requests, axes, legends, expand, stretch/station, refresh/cache for LIVE remain on the existing path.
- Historic controls stay hidden in LIVE.
- Verified: LIVE active, historic controls hidden, graph order unchanged.

## HISTORIC controls

Header (when HISTORIC):

`[ LIVE ] [ HISTORIC ] [ DATE ] [ TIME ] [ Simulation clock ] [ − ] [ STEP 1 h ] [ + ]`

- Coverage from `/api/timerange` (`epoch_date` … `today_date` / `today_hour`).
- Local IST wall clock (`+05:30`); API `at=` ISO with offset.
- Step ±1 h (NadiTwin `hour_index` resolution).
- Unavailable spatial snapshots show explicit messages (no LIVE reuse).

## Graph sync

| Graph | Historic source | Behaviour |
|-------|-----------------|-----------|
| Discharge | `/api/state?at=` → `q_station` | Full-reach profile at selected time; no LIVE Q overlay; +24/+72 spatial medians N/A historically |
| Stage | `/api/state?at=` → `wse` + meta bed/crest | Historical WSE; bed/thresholds from meta geometry |
| Hydrograph | `/api/hydrograph` hours/year | Series unchanged; **SELECTED** cursor at historic time |

Bug fixed: `fetchNadiTwinState` previously used a fixed cache key `"state"`, so LIVE responses poisoned HISTORIC. Cache key now includes `at`.

## Margin Board

- Button in Charts header opens overlay (graphs remain underneath when closed).
- **By location** → 7 cards from `/api/margins_locations`.
- **Every 1 km** → `/api/margins_chainage?step_km=1` (17 cards).
- HISTORIC uses `?at=`; does not show LIVE margins under a historic clock.
- Labelled **MODELLED / PROVISIONAL**; Phase 8 safety boards remain **LOCKED**.

Seven stretches (source names):

1. Sangam → Bund Garden  
2. Bund Garden → Dhanori  
3. Dhanori → Wadgaon Sheri  
4. Wadgaon Sheri → Hadapsar  
5. Hadapsar → Mundhwa  
6. Mundhwa → Kharadi  
7. Kharadi → Manjari  

## Capability inventory

See `scratch/naditwin_historic_endpoint_inventory.json`.

Notable: spatial historic via `at=` works; historic spatial rain and historic +24/+72 spatial Q medians are not published.

## Validation

`scratch/naditwin_historic_snapshot_validation.json` — all checks PASS  
`scratch/naditwin_margin_board_mapping.json` — field/view mapping

## Screenshots

`scratch/screenshots/naditwin-historic-margin-board/`

1. `01-live-unchanged.jpg`  
2. `02-historic-controls.jpg`  
3. `03-historic-timestamp-selected.jpg`  
4. `04-historic-discharge.jpg`  
5. `05-historic-stage.jpg`  
6. `06-historic-hydrograph.jpg`  
7. `07-historic-step-next.jpg`  
8. `08-margin-board-open.jpg`  
9. `09-seven-location-cards.jpg`  
10. `10-margin-board-1km.jpg`  
11. `11-margin-board-closed.jpg`  
12. `12-margin-board-historic.jpg`  

## Files

- `src/services/hydrology/naditwinHistoricService.js` (new)
- `src/services/hydrology/naditwinApi.js` (cache keys for `at`)
- `src/ui/components/hydroIntelThreeGraphs.js` (historic series + cursor)
- `src/ui/components/hydroIntelPanel.js` (controls + Margin Board button)
- `src/ui/components/hydroIntelMarginBoard.js` (new overlay)
