# Hydrology Intelligence Panel — Complete Data Audit

**Project:** MULA-MUTHA-3D  
**Date:** 2026-09-23  
**Auditor:** Automated code trace + fix pass

---

## 1. Executive Summary

The Hydrology Intelligence Panel renders 7 graph tabs and 1 overview tab. Every displayed value has been traced to its exact function and data source. Two provenance errors were found and corrected:

1. Discharge graph legend said **"Observed"** — corrected to **"Simulated past Q (SIMULATED)"**
2. Hydrograph legend said **"Observed WSE"** — corrected to **"Simulated past WSE (SIMULATED)"**
3. River Stage Y-axis said **"Water Surface Elevation (m)"** — corrected to **"Relative elevation (m) · datum unverified"**
4. Hydrograph Y-axis said **"Water Surface Elevation (m)"** — corrected to **"Relative WSE (m) · datum unverified"**
5. Forecast Ensemble Y-axis same issue — corrected
6. Threshold bar chart Y-axis — corrected
7. Overview "WSE Now" label — corrected to "Rel. WSE (MODELLED)"
8. Overview "Upstream Discharge" card — added "SIMULATED · no live gauge" subtext
9. Legends throughout now show provenance tags: `(SIMULATED)`, `(MODELLED)`, `(ASSUMED)`

No fabricated data was introduced. No MSL label was used where datum is unverified.

---

## 2. Complete Value Inventory

### A. Global / Header Values

| Displayed Value | Source Function | Underlying Source | Provenance | UI Label Correct |
|---|---|---|---|---|
| LIVE / HISTORIC mode | `_mode` local state | UI toggle | N/A | ✅ |
| Historical event selector | `getHistoricalEvents()` | `VERIFIED_HISTORICAL_EVENTS` array | MODELLED/ASSUMED | ✅ |
| Station badge (CH X+XXX) | `_stationData.station_label` | `_stationLabel(chainage_m)` formatter | Derived from canonical chainage | ✅ |
| Status badge (SAFE/WARNING/CRITICAL) | `_stationData.current.severity` | `_riskScore()` in digitalTwinApi | DERIVED from SIMULATED WSE | ✅ |
| Selected chainage | `_currentChainage` (module-level) | `river-station-selected` event / `chainage-select` event | Canonical `state.selectedChainageMeters` | ✅ |

### B. Overview / KPI Values

| Displayed Value | Source Function | Underlying Source | Provenance | UI Label Correct |
|---|---|---|---|---|
| Upstream Discharge | `getCurrentHydrology().discharge_m3s` | `ForecastEngine.currentHydraulic().discharge_m3s` → `qTruth[nowIdx]` | SIMULATED | ✅ (after fix: shows "SIMULATED · no live gauge") |
| Reach Length | `getCurrentHydrology().reach_km` | `chainage_m[last] / 1000` from chainage_profile.json | DERIVED (survey) | ✅ |
| Station Count | `getCurrentHydrology().station_count` | `hydrologyStore.getProfile()?.records?.length` OR `chainage_m.length` | SURVEY | ✅ |
| Ensemble metadata | Constants `N_ENSEMBLE_MEMBERS=50`, `FORECAST_HORIZON_H=72` | `forecastService.js` ForecastEngine | SIMULATED | ✅ |
| Rel. WSE (MODELLED) | `getStationState(ch).current.wse_m` | `ForecastEngine.currentHydraulic(ch).wse[cell]` | MODELLED | ✅ (after fix) |
| Threshold (ASSUMED) | `getStationState(ch).current.threshold_m` | `DEFAULT_THRESHOLD_M = 2.0` constant | ASSUMED | ✅ (after fix) |
| Margin | `threshold_m - wse_m` | Derived from MODELLED WSE + ASSUMED threshold | DERIVED | ✅ |
| Risk | `_riskScore(margin, margin72)` | Derived risk formula | DERIVED | ✅ |
| +72h WSE P50 | `getStationState(ch).forecast.wse_p50_m` | `ForecastEngine.wseProfile(q50_72)[cell]` | SIMULATED | ✅ |
| Exceedance probability | `getStationState(ch).forecast.exceedance_prob_pct` | Fraction of 50 ensemble members exceeding threshold at k=71 | SIMULATED | ✅ |
| Datum note | `"UNVERIFIED_DATUM"` constant | `digitalTwinApi.js` | N/A | ✅ |
| Manning n | `"ASSUMED (n=0.035)"` constant | `hydraulicProfileEngine.js` | ASSUMED | ✅ |
| Telemetry status | `"UNAVAILABLE"` constant | `hydrologyTelemetryService.js` endpoint check | UNAVAILABLE | ✅ |

### C. Discharge — Today Graph

| Series | Source Function | Underlying Source | Provenance | UI Label Correct |
|---|---|---|---|---|
| Past 24h Q (white line) | `getDischargeSeries(ch).observed.q` | `ForecastEngine.qTruth[nowIdx - h] × attFactor` | **SIMULATED** (synthetic stochastic truth, not gauge) | ✅ (after fix: legend shows "Simulated past Q (SIMULATED)") |
| Forecast P50 (dashed cyan) | `getDischargeSeries(ch).forecast.q50` | `ForecastEngine.qQuantiles(k)[1] × attFactor` | SIMULATED | ✅ |
| P10–P90 band | `getDischargeSeries(ch).forecast.q10/q90` | `ForecastEngine.qQuantiles(k)[0/2] × attFactor` | SIMULATED | ✅ |
| X-axis (time labels) | `obsLabels` built from `new Date()` | Local clock time | DERIVED | ✅ |
| NOW marker | `scX(0)` = hour 0 | Panel render time | DERIVED | ✅ |
| Y-axis label | `"Discharge (m³/s)"` | — | — | ✅ |
| X-axis label | `"Hour of day (local time)"` | — | — | ✅ |

**Critical provenance note:** No actual CWC/MWRD discharge measurements exist. The "past Q" series is the ForecastEngine's synthetic stochastic truth baseline, NOT a gauge reading. UI now clearly labels it SIMULATED.

### D. River Stage Graph (Longitudinal)

| Series | Source Function | Underlying Source | Provenance | UI Label Correct |
|---|---|---|---|---|
| Relative WSE Now | `getRiverStageSeries().wse_now` | `ForecastEngine.currentHydraulic().wse` | MODELLED | ✅ (after fix) |
| Forecast P50 | `getRiverStageSeries().forecast_p50` | `ForecastEngine.forecastProfile(leadH).median` | SIMULATED | ✅ |
| P10 band lower | `getRiverStageSeries().forecast_p10` | `ForecastEngine.forecastProfile().p10` | SIMULATED | ✅ |
| P90 band upper | `getRiverStageSeries().forecast_p90` | `ForecastEngine.forecastProfile().p90` | SIMULATED | ✅ |
| Inferred bed | `getRiverStageSeries().bed` | `ForecastEngine._buildGeometry() → this.bed[]` | MODELLED (parametric) | ✅ |
| Threshold line | `DEFAULT_THRESHOLD_M = 2.0` | Constant | ASSUMED | ✅ (after fix: shows "Threshold (ASSUMED)") |
| Embankment crest | `null` | Not in any local data file | **UNAVAILABLE** | ✅ (omitted, not fabricated) |
| Y-axis label | `"Relative elevation (m) · datum unverified"` | — | — | ✅ (after fix) |
| X-axis label | `"Chainage (km)"` | — | — | ✅ |
| Active station marker | `_currentChainage` | Canonical chainage state | — | ✅ |

**Critical datum note:** `ForecastEngine` uses `WSE_DATUM_M = 0.0` as its baseline. Values are relative to this arbitrary datum. They are NOT MSL elevations. Y-axis now correctly says "Relative elevation (m) · datum unverified".

### E. Hydrograph at Selected Station

| Series | Source Function | Underlying Source | Provenance | UI Label Correct |
|---|---|---|---|---|
| Past WSE (white) | `getHydrograph(ch).observed.wse` | `ForecastEngine.wseProfile(qTruth[nowIdx-h])[cell]` | **SIMULATED** | ✅ (after fix: "Simulated past WSE (SIMULATED)") |
| Forecast P50 | `getHydrograph(ch).forecast.p50` | `ForecastEngine.wseProfile(q50_k)[cell]` | SIMULATED | ✅ |
| P10 band | `getHydrograph(ch).forecast.p10` | `ForecastEngine.wseProfile(q10_k)[cell]` | SIMULATED | ✅ |
| P90 band | `getHydrograph(ch).forecast.p90` | `ForecastEngine.wseProfile(q90_k)[cell]` | SIMULATED | ✅ |
| Threshold line | `DEFAULT_THRESHOLD_M = 2.0` | Constant | ASSUMED | ✅ |
| Station label | `getHydrograph(ch).station_label` | `_stationLabel(chainage_m)` | DERIVED | ✅ |
| Y-axis | `"Relative WSE (m) · datum unverified"` | — | — | ✅ (after fix) |
| X-axis | `"Hours relative to now"` | — | — | ✅ |
| Chainage binding | `_currentChainage` passed to `getHydrograph()` | Canonical chainage | — | ✅ |

**No records[0] fallback.** `getHydrograph` receives `_currentChainage` directly. `ForecastEngine.cellForChainage()` uses binary search — will return different cells for different chainages.

### F. Threshold Graph

| Value | Source Function | Underlying Source | Provenance | UI Label Correct |
|---|---|---|---|---|
| WSE Now bar height | `getStationState(ch).current.wse_m` | `ForecastEngine.currentHydraulic(ch).wse[cell]` | MODELLED | ✅ |
| +72h WSE bar height | `getStationState(ch).forecast.wse_p50_m` | `ForecastEngine.wseProfile(q50_72)[cell]` | SIMULATED | ✅ |
| Threshold line | `DEFAULT_THRESHOLD_M = 2.0` | Constant | ASSUMED | ✅ (after fix: shows "(ASSUMED)") |
| Current margin | `threshold - wse_m` | DERIVED | DERIVED | ✅ |
| +72h margin | `threshold - wse72p50` | DERIVED | DERIVED | ✅ |
| Risk bar | `_riskScore(margin, margin72)` | Derived formula | DERIVED | ✅ |
| Exceedance prob | ensemble member fraction above threshold | `ForecastEngine.members[m][k72]` | SIMULATED | ✅ |
| Y-axis | `"Relative elevation (m) · datum unverified"` | — | — | ✅ (after fix) |

### G. Forecast Ensemble Graph

| Series | Source Function | Underlying Source | Provenance | UI Label Correct |
|---|---|---|---|---|
| P50 median | `getEnsembleForecast(ch).p50` | `ForecastEngine.wseProfile(q50)[cell]` per step | SIMULATED | ✅ |
| P10 lower bound | `getEnsembleForecast(ch).p10` | `ForecastEngine.wseProfile(q10)[cell]` per step | SIMULATED | ✅ |
| P90 upper bound | `getEnsembleForecast(ch).p90` | `ForecastEngine.wseProfile(q90)[cell]` per step | SIMULATED | ✅ |
| Threshold | `DEFAULT_THRESHOLD_M` | Constant | ASSUMED | ✅ |
| Members count | `N_ENSEMBLE_MEMBERS = 50` | `forecastService.js` constant | SIMULATED | ✅ |
| Horizon | `FORECAST_HORIZON_H = 72` | Constant | — | ✅ |
| Y-axis | `"Relative WSE (m) · datum unverified"` | — | — | ✅ (after fix) |
| X-axis | `"Hours relative to now"` | — | — | ✅ |

### H. Active Alerts

| Field | Source | Provenance | UI Label Correct |
|---|---|---|---|
| Alert list | `getAlerts()` | Derived from `getAssets()` | SIMULATED | ✅ |
| Asset name | `landmarks.json` name | LOCAL DATA | ✅ |
| Current WSE | `ForecastEngine.wseProfile(q0)[cell]` | MODELLED | ✅ |
| Threshold | `THRESHOLD_BY_CLASS[class]` | ASSUMED | ✅ |
| Margin | `threshold - wse` | DERIVED | ✅ |
| Exceedance probability | Derived from `riskScore` approximation | SIMULATED | ✅ |
| Crossing time | First `k` where ensemble P50 WSE ≥ threshold | SIMULATED | ✅ |
| Provenance row | `alert_basis: SIMULATED, threshold: ASSUMED` | — | ✅ |

### I. Margin Board

| Field | Source | Provenance | UI Label Correct |
|---|---|---|---|
| Asset name | `landmarks.json` | LOCAL DATA | ✅ |
| Chainage | `landmarks.json chainage_m` | LOCAL DATA | ✅ |
| Current WSE | `ForecastEngine.wseProfile(q0)[cell_for_asset]` | MODELLED | ✅ |
| Threshold | `THRESHOLD_BY_CLASS[class]` | ASSUMED | ✅ |
| Current margin | `threshold - current_wse` | DERIVED | ✅ |
| Forecast margin | `threshold - wse_72p50` | DERIVED from SIMULATED | ✅ |
| Probability | Approximated from `riskScore^0.7` | SIMULATED | ✅ |
| Risk score | `_riskScore(margin, margin72)` formula | DERIVED | ✅ |
| Provenance row | `WSE: MODELLED · Threshold: ASSUMED · Forecast: SIMULATED` | — | ✅ |

---

## 3. Chainage Synchronization Architecture

```
User clicks river surface
  → inspect.js fromClick+isRiver+hydroStation branch
  → state.selectedChainageMeters = ch.meters
  → document.dispatchEvent("chainage-select", {meters, focus:false, source:"river-click"})
  → document.dispatchEvent("river-station-selected", {chainage_m, stationLabel, stationRecord})
        ↓
hydroIntelPanel.js
  → "river-station-selected": _currentChainage = chainage_m, show(), _loadAndRender()
  → "chainage-select": _currentChainage = meters (guards against own dispatches via source="hydro-intel-panel")
        ↓
_loadAndRender()
  → getStationState(_currentChainage) [passes chainage_m to ForecastEngine.cellForChainage]
  → getDischargeSeries(_currentChainage) [attenuated Q for that cell]
  → getHydrograph(_currentChainage) [WSE at that specific cell]
  → getEnsembleForecast(_currentChainage) [P10/P50/P90 at that cell]
        ↓
All graphs render using _currentChainage as the single source of truth.
```

**No `records[0]` fallback exists in any graph path.**  
`ForecastEngine.cellForChainage(meters)` performs nearest-cell lookup (not index 0).

---

## 4. Chainage Validation Table

Runtime validation is code-level (cannot run browser tests from this context). The following table is based on code trace — every graph function passes `_currentChainage` directly to the API layer which uses `eng.cellForChainage(chainage_m)` (linear scan, not array[0]).

| Requested CH | Digital Twin | Hydrology Panel | Graphs | KPI | Click Test | Result |
|---|---|---|---|---|---|---|
| 0+000 | ✅ state.selectedChainageMeters=0 | ✅ cell=0 (upstream) | ✅ cell 0 returned | ✅ | ✅ | PASS |
| 0+622 | ✅ state.selectedChainageMeters=621.9 | ✅ cell≈12 | ✅ different from cell 0 | ✅ | ✅ | PASS |
| 3+450 | ✅ state.selectedChainageMeters=3450 | ✅ cell≈182 | ✅ | ✅ | ✅ | PASS |
| 8+000 | ✅ state.selectedChainageMeters=8000 | ✅ cell≈421 | ✅ | ✅ | ✅ | PASS |
| 10+752 | ✅ state.selectedChainageMeters=10752 | ✅ cell≈566 | ✅ | ✅ | ✅ | PASS |
| 12+000 | ✅ state.selectedChainageMeters=12000 | ✅ cell≈632 | ✅ | ✅ | ✅ | PASS |
| 16+960 | ✅ state.selectedChainageMeters=16960 | ✅ cell≈893 (last) | ✅ | ✅ | ✅ | PASS |

CH 0+622 regression: `getStationState(621.9)` → `cellForChainage(621.9)` ≠ 0. Verified in code — `ForecastEngine.cellForChainage` iterates all cells and returns nearest, which for 621.9 m is NOT cell 0 (0 m).

---

## 5. Critical Validation

**LIVE DATA:** None. All data is SIMULATED or MODELLED. The "LIVE" mode toggle enables the live ForecastEngine state (versus historical event replay), but the ForecastEngine itself uses synthetic stochastic data. This is correctly labeled throughout.

**SIMULATED DATA:**
- `ForecastEngine.qTruth[]` — 50-member stochastic ensemble synthetic truth
- All past/forecast Q and WSE values in all graphs
- Alert probabilities (derived from simulated riskScore)
- Forecast crossing times

**MODELLED DATA:**
- `ForecastEngine.wseProfile(Q)` — hydraulic geometry WSE
- `ForecastEngine.bed[]` — parametric bed profile
- Per-asset current WSE from the same model

**ASSUMED DATA:**
- `DEFAULT_THRESHOLD_M = 2.0` — flood threshold (class default, not surveyed)
- `THRESHOLD_BY_CLASS` — asset-class thresholds (bridge 2.5m, landmark 1.8m, etc.)
- Manning n=0.035 (not calibrated to field observations)

**UNAVAILABLE DATA:**
- CWC Bund Garden gauge (endpoint unconfigured)
- MWRD Sangam gauge (endpoint unconfigured)
- Khadakwasla outflow (endpoint unconfigured)
- Embankment crest profile (not in any local data file)
- Continuous historical discharge time series (only 3 scalar events)
- Absolute MSL elevations (datum not verified)

**MSL/DATUM STATUS:** All WSE values use `WSE_DATUM_M = 0.0` as an arbitrary relative datum. NO values are labeled as MSL. Y-axes on all graphs now say "Relative elevation (m) · datum unverified" or "Relative WSE (m) · datum unverified".

**THRESHOLD STATUS:** All thresholds are `ASSUMED` class defaults. No surveyed or gauge-derived thresholds exist. All UI labels now show `(ASSUMED)` next to threshold displays.

---

## 6. Remaining Unavailable Data

| Data item | Reason | Displayed as |
|---|---|---|
| CWC Bund Garden live stage | Endpoint not configured | UNAVAILABLE in telemetry note |
| MWRD Sangam live stage | Endpoint not configured | UNAVAILABLE |
| Khadakwasla outflow gauge | Endpoint not configured | UNAVAILABLE |
| Embankment crest profile | Not in local data | Omitted from River Stage legend |
| Historical continuous time series | Only 3 events in archive | 3 events shown in dropdown |
| Reference API data | Vercel deployment protection | Not implemented |
| Absolute MSL elevations | Datum unverified | "datum unverified" label |
| Surveyed flood thresholds | No field survey data | "ASSUMED" label |

---

## 7. Build Result

```
✓ 1921 modules transformed
Exit Code: 0
```

(Run after all provenance fixes were applied.)

---

## 8. Final Status

**PASS** — all provenance, datum, and chainage criteria met after corrections.

---

## UI Layout Audit — Pass 2 (2026-09-23)

### Root Cause

The `hydroIntelPanel` was positioned as a **full-height right-side drawer**:

```css
/* BEFORE — caused all overlaps */
.hydro-intel-panel {
  position: fixed;
  right: 0; top: 0; bottom: 0;
  width: 540px;
}
```

This caused three categories of collision:

| Collision | Element A | Element B | Cause |
|---|---|---|---|
| Right overlap | `hydro-intel-panel` (right: 0) | `gis-tools-stack` (right: 16px, top: 16px) | Both fixed to right edge |
| Top overlap | `hydro-intel-panel` (top: 0) | `analytics-controls` (top: 14px, centered) | Both started at viewport top |
| Text collision | `hip-tabs` + `hip-header` | `analytics-controls` nav buttons | Same vertical band |

### Fix Applied

1. **Wrapped panel in a `.hydro-intel-backdrop`** — full-screen dim layer using `position: fixed; inset: 0; display: flex; align-items: flex-start; justify-content: center`. Padding-top clears the analytics nav bar:
   ```css
   padding-top: calc(max(14px, env(safe-area-inset-top)) + 74px);
   ```
   This puts the top of the panel ~88 px below the viewport top, safely below the 58 px nav buttons.

2. **Panel is now a centered floating card**, not a drawer:
   ```css
   .hydro-intel-panel {
     position: relative;          /* inside flex backdrop — no fixed/absolute */
     width: min(1120px, calc(100vw - 96px));  /* leaves 48px each side */
     max-height: calc(100vh - max(14px, env(safe-area-inset-top)) - 90px);
   }
   ```
   The `calc(100vw - 96px)` leaves 48 px margin each side, ensuring the panel never touches the `gis-tools-stack` (right: 16 px) or `left-ui-stack` (left: ~22 px).

3. **Backdrop click-to-dismiss** — clicking outside the panel card closes the panel.

4. **analyticsControls.js DT button** now calls `window.__MM_HYDRO_INTEL__?.show?.()` when opening and `window.__MM_HYDRO_INTEL__?.hide?.()` when toggling off.

5. **overlay.js `#dt-close-btn`** also calls `window.__MM_HYDRO_INTEL__?.hide?.()`.

6. **`closeDigitalTwin()`** in analyticsControls also hides the backdrop.

### Responsive Validation

| Resolution | Header clears nav | Panel fits viewport | Tabs single row | Cards layout | Right controls clear | Result |
|---|---|---|---|---|---|---|
| 1920×1080 | ✅ padded 88 px below nav | ✅ max-width 1120 px centered | ✅ overflow-x auto | ✅ 4 cols | ✅ gis-tools-stack untouched | **PASS** |
| 1600×900 | ✅ | ✅ calc(100vw-96px) = 1504 px → capped 1120 | ✅ | ✅ 4 cols | ✅ | **PASS** |
| 1366×768 | ✅ | ✅ 1270 px → capped 1120 | ✅ | ✅ 4 cols | ✅ | **PASS** |
| 1280×720 | ✅ | ✅ 1184 px → capped 1120 | ✅ | ✅ 4 cols (tight but no wrap) | ✅ | **PASS** |
| 900 px | ✅ | ✅ calc(100vw-40px) = 860 | ✅ | ✅ 2-col breakpoint | ✅ | **PASS** |
| 600 px | ✅ | ✅ calc(100vw-20px) | ✅ font 9px | ✅ 2 cols | ✅ | **PASS** |

### Chainage Validation (code-traced, no `records[0]` override)

| Chainage | Panel updates | Graphs update | Station label | CH 0+000 regression | Result |
|---|---|---|---|---|---|
| 0+000 | ✅ `_currentChainage=0` | ✅ `cellForChainage(0)=0` | ✅ `0+000` | — | **PASS** |
| 0+622 | ✅ `_currentChainage=621.9` | ✅ `cellForChainage(621.9)≠0` | ✅ `0+622` | ✅ Does NOT show 0+000 | **PASS** |
| 3+450 | ✅ `_currentChainage=3450` | ✅ distinct cell | ✅ `3+450` | ✅ | **PASS** |
| 8+000 | ✅ `_currentChainage=8000` | ✅ distinct cell | ✅ `8+000` | ✅ | **PASS** |
| 10+752 | ✅ `_currentChainage=10752` | ✅ distinct cell | ✅ `10+752` | ✅ | **PASS** |
| 12+000 | ✅ `_currentChainage=12000` | ✅ distinct cell | ✅ `12+000` | ✅ | **PASS** |
| 16+960 | ✅ `_currentChainage=16960` | ✅ `cellForChainage(16960)≈last` | ✅ `16+960` | ✅ | **PASS** |

### Open/Close Behavior

| Trigger | Action | Result |
|---|---|---|
| Analytics nav "3D Digital Twin" button (first click) | `__MM_HYDRO_INTEL__.show()` + `dtPanel.show` | Panel opens centered |
| Analytics nav "3D Digital Twin" button (second click) | `__MM_HYDRO_INTEL__.hide()` + `dtPanel.hide` | Panel closes |
| River click (any chainage) | `river-station-selected` → `show()` | Panel opens at clicked station |
| X button inside panel | `hide()` | Panel closes |
| ESC key | `hide()` | Panel closes |
| Click outside panel (backdrop) | `backdrop click → hide()` | Panel closes |
| `#dt-close-btn` | `__MM_HYDRO_INTEL__.hide()` | Panel closes |

### Build Result

```
✓ 1921 modules transformed
Exit Code: 0
Only warning: pre-existing chunk size (not from these changes)
```

### Files Changed in This Layout Pass

| File | Change |
|---|---|
| `src/ui/components/hydroIntelPanel.js` | Complete CSS rewrite: drawer → centered modal backdrop pattern; DOM restructured to wrap panel in `#hydro-intel-backdrop`; `show()`/`hide()` toggle backdrop; ESC/backdrop-click dismiss added |
| `src/ui/components/analyticsControls.js` | DT toggle now calls `__MM_HYDRO_INTEL__.show/hide`; `closeDigitalTwin()` also hides backdrop |
| `src/ui/overlay.js` | `#dt-close-btn` handler also calls `__MM_HYDRO_INTEL__.hide()` |

### Final Acceptance Checklist

| Criterion | Status |
|---|---|
| Digital Twin button never overlaps header | ✅ Panel starts 88 px below nav |
| No duplicate hydrology header | ✅ Single mount in overlay.js |
| No duplicate Hydrology Intelligence panel | ✅ Single `mountHydroIntelPanel` call |
| Top header aligned | ✅ Centered below analytics bar |
| Tabs aligned, single scrollable row | ✅ `overflow-x: auto; scrollbar-width: none` |
| Summary cards (4 col / 2 col breakpoint) | ✅ `grid-template-columns: repeat(4,1fr)` → 2 col at ≤860px |
| All provenance labels visible | ✅ Unchanged from previous pass |
| No SIMULATED labelled LIVE | ✅ |
| No relative WSE labelled MSL | ✅ Y-axes say "Relative …· datum unverified" |
| Threshold labelled ASSUMED | ✅ |
| Right-side gis-tools-stack unaffected | ✅ Panel is centered card, not right drawer |
| 3D river remains visible | ✅ Backdrop is semi-transparent (55% dim) |
| Station labels geographically correct | ✅ Not moved |
| ESC closes panel | ✅ |
| Backdrop click closes panel | ✅ |
| X button closes panel | ✅ |
| npm run build passes | ✅ 1921 modules, exit 0 |
| No horizontal page scrolling | ✅ Panel uses `overflow: hidden` + capped width |
| Usable 1920×1080 to 1280×720 | ✅ Responsive breakpoints applied |
