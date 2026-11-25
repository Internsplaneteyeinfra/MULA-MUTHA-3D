# FINAL_THREE_GRAPH_LAYOUT_REPORT

**Date:** 2026-11-25  
**URL:** http://localhost:5185/  
**Result:** PASS

## Final sequence

```
DISCHARGE PROFILE
        ↓
RIVER STAGE PROFILE
        ↓
HYDROGRAPH
```

Exactly three full-width stacked cards. **Rating Curve is not shown** in this dashboard.

## Graph inventory

| # | DOM id | Title | Axes | Source |
|---|--------|-------|------|--------|
| 1 | `#hip-g-discharge` | Discharge at every chainage (10 m) | Chainage (km+m) × Discharge (m³/s); optional Rain (mm/h) | `getLiveDischargeProfileSeries` → `/api/state` `q_station` + forecast `q_median_station` +24h/+72h; rain only if `/api/discharge_profile` publishes `rain_now_mmh` |
| 2 | `#hip-g-stage` | River stage (water level) | Chainage × Level (m WSE) | Existing `getRiverStageSeries` (stage, bed, watch/warning/danger, crest) |
| 3 | `#hip-g-hydro` | Hydrograph (discharge + river stage + rainfall) | Local time × stage / Q / rain | Existing NadiTwin hydrograph + hist selector beside title |

## Layout & expand

- Vertical full-width stack (no two-column layout).
- Normal heights @ 1920×1080: Discharge **265 px**, Stage **265 px**, Hydro **320 px** (width **1840 px**).
- Each card has expand; expanded ~644–679 px.
- **Back to all 3 graphs** + **Exit fullscreen** retained.
- Expand uses cached payloads (no duplicate polling). Hist change still reloads hydro only.

## Controls preserved

LIVE / HISTORIC · stretch · station · chainage · live datetime coverage · last fetch · 72 h forecast horizon.

Stretch L1 sync verified (`CH 1+730`); hist `7d` in expanded hydro kept station `CH 8+790`.

## Data rules

- Discharge profile uses chainage-wise NadiTwin Q — **not** rating-curve data.
- No fabricated values; optional series omitted when NadiTwin does not publish them.
- Physical 3D mesh / Phase 7–8 provenance untouched.

## Test checks (all PASS)

| Check | Result |
|-------|--------|
| Order Discharge → Stage → Hydro | PASS |
| No `#hip-g-rating` / no “Rating curve” title | PASS |
| Full width | PASS |
| Independent expand (all three) | PASS |
| Hist selector in expanded Hydro | PASS |
| Station / stretch sync | PASS |
| Exit fullscreen | PASS |

Metrics: `scratch/final_three_graph_sequence_metrics.json`

## Screenshots

`scratch/screenshots/final-three-graph-sequence/`

1. `01-normal-discharge-stage-hydro.jpg`
2. `02-discharge-expanded.jpg`
3. `03-stage-expanded.jpg`
4. `04-hydro-expanded-hist-7d.jpg`
5. `05-exit-fullscreen.jpg`
6. `06-stretch-L1-sync.jpg`

## Files touched

- `src/ui/components/hydroIntelThreeGraphs.js` — sequence, discharge chart, rating removed
- `src/ui/components/hydroIntelPanel.js` — expand CSS + copy
- `src/services/hydrology/naditwinChartSeries.js` — +24h/+72h + optional segment rain on discharge profile
- `scratch/capture_final_three_graph_sequence.mjs`
