# NadiTwin Complete Chart Integration Report

**Project:** PLANET.EYE AI — MULA–MUTHA  
**Date:** 2026-11-25  
**Entry:** Digital Twin button → Charts (`showAnalyticalCharts`)

## Summary

| Item | Count / status |
|------|----------------|
| Chart-relevant endpoints inventoried | **15** |
| Charts tabs in Digital Twin | **15** |
| Synthetic / fabricated series | **None** |
| Safety boards | **LOCKED** |
| 3D water mesh changes | **None** |
| Screenshots | **Skipped (disk ENOSPC)** |

## Inventory

Full detail: `scratch/naditwin_chart_inventory.json`  
API → UI map: `scratch/naditwin_chart_api_mapping.json`  
Validation: `scratch/naditwin_chart_validation.json`

### Integrated graphs

| Category | Tab | Endpoint(s) | Type |
|----------|-----|-------------|------|
| LIVE | Q PROFILE | `/api/state`, `/api/discharge_profile`, `/api/forecast/profile` | Profile |
| LIVE | DEPTH | `/api/state` (+ meta bed) | Profile |
| LIVE | RIVER STAGE | `/api/state`, `/api/forecast/profile`, `/api/meta` | Profile + levels |
| HISTORICAL | DISCHARGE | `/api/hydrograph` | Line + band |
| HISTORICAL | HYDROGRAPH | `/api/hydrograph` | Line + band |
| HISTORICAL | ANNUAL | `/api/hydrograph?year=` | Line |
| RAINFALL | RAINFALL | `/api/hydrograph` rain | Bars |
| FORECAST | TODAY | `/api/today` | Line + band |
| FORECAST | FORECAST | hydrograph / forecast profile | Band |
| HYDRAULIC | RATING | `/api/rating` | XY |
| HYDRAULIC | THRESHOLD | hydrograph levels | Status |
| HYDRAULIC | MARGINS | `/api/margins_chainage` | Profile (display-only) |
| HYDRAULIC | ALERTS | `/api/alerts`, `/api/alerts_chainage` | Table |
| META | SCORECARD | `/api/scorecard` | Table |
| META | OVERVIEW | state/live + catalogue | Cards |

### Not integrated as charts (by design)

| Endpoint | Reason |
|----------|--------|
| `/api/stations.csv` / `.xlsx` | File exports, not graphs |
| `POST /api/rebuild_river` | Admin mutation |
| `POST /api/upload_localities` | Admin mutation |
| Cross-section geometry API | **Not in NadiTwin catalogue** |

## Architecture

- `naditwinApi.js` — added rating, today, timerange, scorecard, locations, alerts, hydrograph year
- `naditwinChartSeries.js` — series builders (no synthetic fill)
- `hydroIntelExtraCharts.js` — SVG renderers
- `hydroIntelPanel.js` — tabs + 60s soft refresh while Charts open

## Provenance rules preserved

- NadiTwin past series labelled **HISTORICAL · MODELLED** (not gauge OBSERVED)
- Forecast labelled **FORECAST · MODELLED**
- Relative WSE **not MSL**
- Margins **display-only**; safety boards **LOCKED**
- Missing values stay missing (not zero-filled)

## Chainage sync

Station dropdown / river click updates `_currentChainage` → all chainage-aware tabs refetch via cell = `round(m / 10)`.

## Browser verification

- API probes via `/naditwin-api` proxy: **PASS** (see validation JSON)
- UI: open `http://localhost:5185/` → Digital Twin → walk tabs with a selected chainage
- Screenshots folder `scratch/screenshots/naditwin-charts/`: not written (disk full)

## Remaining issues

1. Host disk at/near **0 bytes free** — blocked screenshot capture and some writes mid-run.
2. `/api/alerts_chainage` returned **0** rows at probe time (valid empty state).
3. Annual hydrograph is heavier; uses downsampling for SVG performance.
4. Margin chart is informational only — does not unlock safety boards.

## How to verify manually

1. Free disk space if Vite fails to serve.
2. `npm run dev` → `http://localhost:5185/`
3. Click **3D Digital Twin** (Charts open directly).
4. Select a station (e.g. CH 8+820).
5. Confirm each new tab: Q PROFILE, DEPTH, RAINFALL, TODAY, ANNUAL, RATING, MARGINS, SCORECARD.
