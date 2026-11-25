# NadiTwin Exact Three-Graph Parity Report

**Date:** 2026-11-25  
**Reference:** https://naditwin-production.up.railway.app/?river=Mula-Mutha  
**Digital Twin Charts:** `http://localhost:5185/` → Digital Twin → Charts  
**Proxy:** `/naditwin-api` → Railway NadiTwin  

---

## Requirement summary

Charts presentation shows **only** these three NadiTwin analytical graphs:

1. **River stage (water level)** — longitudinal profile  
2. **Hydrograph (discharge + river stage + rainfall)** — station time series  
3. **Rating curve (stage ↔ discharge)** — log-Q curve  

No additional Charts tabs/sections in this view. Backend endpoints and 3D Digital Twin elsewhere are preserved.

---

## Endpoint mapping

See `scratch/naditwin_three_graph_endpoint_mapping.json`.

| Graph | NadiTwin endpoints | DT consumer |
|---|---|---|
| River stage profile | `/api/state`, `/api/live`, `/api/meta`, `/api/forecast/profile` | `getRiverStageSeries()` |
| Hydrograph | `/api/hydrograph?cell=&hours=` or `year=` | `getNadiTwinHydrographAtChainage` / `fetchNadiTwinHydrographYear` → `normalizeHydrograph` |
| Rating curve | `/api/rating?cell=` | `getRatingCurveSeries()` |
| History coverage | `/api/timerange` | `getTimerangeMeta()` → hist dropdown |

**Chainage:** selected meters → NadiTwin `cell` via `mapLocalChainageToCell` (10 m step). Example CH 8+790 → cell 879.

---

## Historical controls (NadiTwin parity)

Dropdown options:

- Past 72 hours + 72 h forecast (`hours=72`)  
- Past 7 days + 72 h forecast (`hours=168`)  
- Past 30 days + 72 h forecast (`hours=720`)  
- Past 90 days + 72 h forecast (`hours=2160`)  
- Past 1 year + 72 h forecast (`hours=8760`)  
- All available history (`hours` ≈ full timerange span)  
- Individual calendar years from `epoch_date`…`today_date` (`year=YYYY`)  
- Current year labelled as “to latest + forecast”

Coverage from live `/api/timerange` (verified 2026-11-25):

- `epoch_date`: **2021-01-01**  
- `today_date`: **2026-11-25**  

No invented ranges. Unavailable lookbacks disabled when coverage is insufficient.

---

## Graph implementation notes

### 1. River stage profile

- Series: WSE now, bed, watch, warning, danger, crest (NadiTwin legend wording).  
- X: chainage km+m labels. Y: Level (m WSE), relative datum.  
- Values from LIVE state / meta — not ForecastEngine.  
- Selected chainage marker shown.

### 2. Hydrograph

- Title matches NadiTwin: *Hydrograph (discharge + river stage + rainfall)*.  
- Left Y: stage (relative m). Right Y: discharge (m³/s). Rain as bars from top.  
- Observed stage/Q/rain + forecast median/P10–P90 + forecast Q; NOW boundary.  
- Threshold lines from `levels` on the payload.  
- X: local-time ticks from API ISO timestamps (not fabricated).  
- Nulls stay null (not coerced to 0).

### 3. Rating curve

- Title: *Rating curve (stage ↔ discharge)*.  
- X: log₁₀ discharge. Y: relative stage.  
- Curve from `/api/rating` `q`/`stage` arrays.  
- Horizontal watch/warning/danger/crest.  
- Current operating point (`now`) and forecast peak (`peak72`) when supplied.

---

## Numerical comparison (API vs DT source)

See `scratch/naditwin_three_graph_comparison.json`.

Sample at cell **879** (CH 8+790), `hours=72`:

| Field | NadiTwin API (via proxy) | Expected DT |
|---|---|---|
| Observed points | 72 | 72 |
| Forecast points | 72 | 72 |
| Rating points | 70 | 70 |
| `now.q` / `now.stage` | ~10.13 / -7.923 | same JSON |
| Levels watch/warning/danger/crest | -5.91 / -4.91 / -4.21 / -3.41 | same |
| Synthetic fill | none | none |
| ForecastEngine substitution | none | none |

**Parity rule:** value differences must be **0** versus the proxied JSON (display rounding of ticks/tooltips only). The DT does not recalculate discharge, thresholds, or rating curves.

---

## UI changes

- Removed multi-category / multi-tab Charts catalogue from this presentation.  
- Single scrollable stack of the three graphs.  
- CURRENT / HISTORIC + NadiTwin history dropdown + station select retained.  
- Coverage strip shows earliest–latest, selected period, source, classification, update time.  
- Live soft-refresh (60s) only in CURRENT mode.

---

## Screenshots

Directory: `scratch/screenshots/naditwin-three-graph-parity/`  

Capture side-by-side:

1. NadiTwin river stage vs DT river stage  
2. NadiTwin hydrograph vs DT hydrograph (same cell + hours)  
3. NadiTwin rating vs DT rating  
4. History dropdown open  

*(Populate manually if automated capture is disk-limited.)*

---

## Remaining caveats

1. NadiTwin dashboard Chart.js may fail offline in the reference tab; APIs remain authoritative.  
2. Long lookbacks are **downsampled by NadiTwin** (`step_h` increases) — DT shows returned points, not denser invent fills.  
3. Longitudinal stage profile still downsamples for SVG performance but **force-includes** the selected chainage cell (no silent 8+790→neighbour snap for the marker).  
4. Dead legacy tab renderers remain in `hydroIntelPanel.js` / `hydroIntelExtraCharts.js` but are **not** mounted in this Charts view.

---

## Files

- `src/ui/components/hydroIntelThreeGraphs.js` *(new)*  
- `src/ui/components/hydroIntelHistRange.js` *(NadiTwin presets + years)*  
- `src/ui/components/hydroIntelPanel.js` *(three-graph-only presentation)*  
- `src/services/hydrology/hydrologyNormalizer.js` *(forecast_rain)*  
- `scratch/naditwin_three_graph_endpoint_mapping.json`  
- `scratch/naditwin_three_graph_comparison.json`  
- `scratch/NADITWIN_EXACT_THREE_GRAPH_PARITY_REPORT.md`
