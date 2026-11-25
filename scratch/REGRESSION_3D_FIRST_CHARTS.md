# Regression: 3D-first hydrology + secondary Charts

**Result:** PASS  
**When:** 2026-11-25T06:24:09.401Z

## Files inspected
- `src/ui/components/hydrologyVizHud.js`
- `src/ui/components/hydroIntelPanel.js`
- `src/ui/components/thresholdGraph.js`
- `src/ui/overlay.js`

## Files modified
- Application / UI source: **none** (architecture already matches requirements)
- Test harness only: `scratch/verify_3d_first_charts.mjs` (added)

## Tests
| # | Check | Result |
|---|-------|--------|
| 1 | Initial load 3D twin | PASS |
| 2 | HUD open, Charts btn, no chart modal cover | PASS |
| 3 | Station select does not auto-open charts | PASS |
| 4 | Charts button opens analytical panel | PASS |
| 5 | Hydrograph / Discharge / Stage / Forecast tabs | PASS |
| 6 | Chainage sync 3D ↔ charts | PASS |
| 7 | Close Charts → 3D | PASS |
| 8 | No duplicate panels | PASS |
| 9 | Flood/Rain UI independent | PASS |
| 10 | Phase 7 provenance intact | PASS |

## Screenshots
`scratch/screenshots/regression-3d-charts/`

Captured earlier in the same session (final PASS used `SKIP_SCREENSHOTS=1` after disk cleanup):

- `01-default-3d.png` — default 3D Digital Twin
- `02-hud-open.png` — Hydrology HUD + Charts button
- `03-station-select-3d.png` — station select without chart modal
- `04-charts-open.png` — Charts panel open over 3D
- `05-tab-hydro.png` / `05-tab-discharge.png` / `05-tab-stage.png` / `05-tab-forecast.png`
- `07-after-close.png` — back to 3D after close

## Console errors (first 40)
```
Failed to load resource: the server responded with a status of 404 ()
```
(non-blocking)

## Remaining issues
- None blocking.
- C: drive was at 0 free bytes mid-run; cleared caches/old PNGs before final PASS.
