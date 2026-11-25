# NadiTwin Layout & Station Parity Report

**Date:** 2026-11-25  
**App:** http://localhost:5185/  
**Ref:** https://naditwin-production.up.railway.app/?river=Mula-Mutha

## Verdict

**PASS** — Compact three-graph Charts layout matches NadiTwin Mula–Mutha navigation and data. At 1920×1080 all three graphs are fully visible together (content overflow = 0). API values for locations, timerange, and hydrograph cell 840 match live NadiTwin.

## Layout

| Graph | Fixed SVG height | Axes |
|---|---|---|
| River stage | 185 px | Chainage (km+m) × Level (m WSE) |
| Hydrograph | 205 px | Local time × stage / Q / rain |
| Rating | 185 px | log Q × stage |

- Order: Stage → Hydrograph → Rating  
- No chart tabs  
- Hist selector inline beside Hydrograph title (`#hip-hydro-hist`)  
- LIVE meta strip: twin date/hour/`now_iso`, API fetch time, data window, forecast 72 h, browser clock labeled separately  

## Navigation

- Stretch: ALL + L1…L7 from `/api/locations` (`naditwin_location_mapping.json`)  
- Station: landmarks.json filtered by stretch bounds  
- Chainage: secondary `#hip-chainage-input`  
- Stretch/station/chainage sync all three graphs + 3D focus  
- Hist change reloads hydro only  

## API spot check (live)

| Check | NadiTwin | DT |
|---|---|---|
| locations count | 7 | 7 |
| today_date | 2026-11-25 | 2026-11-25 |
| today_hour | 10 | 10 |
| hydro 840 n_obs / n_fc | 72 / 72 | 72 / 72 |
| last obs stage / Q | -7.574 / 10.08 | -7.574 / 10.08 |

UI checks: 3 sections, hist beside hydro, live meta, 8 stretch options, 12 hist options, chainage input.

## Screenshots

`scratch/screenshots/naditwin-layout-parity/`

- `01-full-dashboard-1920.jpg` — all three graphs  
- `02-live-datetime.jpg`  
- `03-historic-selector-beside-hydro.jpg`  
- `04-all-locations-menu.jpg`  
- `05-stretch-L1.jpg`  
- `06-station-bund-garden.jpg`  
- `07-naditwin-reference.jpg`  
- `responsive-1600x900.jpg` / `responsive-1366x768.jpg`  

## Artifacts

- `scratch/naditwin_location_mapping.json`  
- `scratch/naditwin_date_range_mapping.json`  
- `scratch/naditwin_three_graph_layout_validation.json`  
- `scratch/verify_layout_station_parity.mjs`  

## Safeguards

Provenance labels retained; null ≠ 0; no synthetic data; no mesh/elevation edits; no extra graphs.
