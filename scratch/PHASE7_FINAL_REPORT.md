# PLANET.EYE AI — River.EYE Phase 7 Final Report

**River:** Mula–Mutha  
**App:** http://localhost:5185/  
**Verified:** 2026-11-25 (Playwright `scratch/verify_phase7.mjs` → `PASS phase7`)

---

## 1. Files created

| File | Role |
|------|------|
| `src/services/hydrology/hydrologyQuality.js` | Quality classes, freshness limits, measurement wrapper, P10–P90 interval validation |
| `src/services/hydrology/forecastValidationEngine.js` | Forecast archive + observation pairing + MAE/RMSE/Bias/MAPE/coverage by lead bucket |
| `src/services/hydrology/hydrologyCanonicalState.js` | Single normalized LIVE / FORECAST / HISTORICAL state for all consumers |
| `scratch/phase7_historical_inventory.json` | Historical dataset inventory (7.1) |
| `scratch/phase7_safety_readiness.json` | Safety unlock readiness audit (7.7) |
| `scratch/verify_phase7.mjs` | Browser + unit verification |
| `scratch/screenshots/phase7/*` | Screenshots + JSON logs |
| `scratch/PHASE7_FINAL_REPORT.md` | This report |

## 2. Files modified

| File | Change |
|------|--------|
| `src/ui/components/hydrologyVizHud.js` | Canonical merge into HUD cards; `window.__MM_CANONICAL__`; freshness / quality / safety lock |
| `src/ui/components/weatherWidget.js` | Prefers canonical NadiTwin discharge over ForecastEngine |
| `src/services/hydrology/digitalTwinApi.js` | NadiTwin LIVE for current Q; chart provenance corrected (MODELLED / CLASS_DEFAULT; no “live gauge”) |
| `src/ui/components/hydroIntelPanel.js` | Secondary charts: honest HISTORICAL·MODELLED / FORECAST·MODELLED labels; safety LOCKED |
| `src/ui/components/thresholdGraph.js` | Provenance MODELLED · NOT LIVE (no LIVE WSE claim) |
| `src/services/hydrology/hydrologyProvenance.js` | Expanded DATA_CLASS set |
| `src/services/forecastService.js` | Forecast profile source string no longer claims live gauge |
| GIS / HUD CSS (as needed) | Compact quality indicators on existing dark-glass HUD |

## 3. Historical datasets discovered

See `scratch/phase7_historical_inventory.json`. Summary:

| Dataset | Spatial | Temporal | Class |
|---------|---------|----------|-------|
| NadiTwin `/api/hydrograph` | Single 10 m cell per request | ~hourly, rolling past + forecast | MODELLED historical (not gauge OBSERVED) |
| NadiTwin `/api/state` + `/api/live` | Full reach 10 m | Current only | LIVE modelled feed |
| NadiTwin `/api/forecast/profile` | Full reach 10 m | Lead 1–72 h | FORECAST |
| Open-Meteo GloFAS | Grid (~0.05°), not chainage | Daily archive | MODELLED |
| River.EYE verified events | Reach-level estimates | 3 discrete events | Bulletin estimates — separate from NadiTwin |
| Survey bathymetry / depth KML | ~10 m profile | Static survey | OBSERVED / SURVEYED |

**Conclusion:** Full-reach historical spatial series at 10 m is **unavailable**. Station hydrograph history is available as **modelled**, not gauge OBSERVED. Missing spatial history remains **N/A** (not synthesized).

## 4. Forecast validation methodology

1. Archive NadiTwin forecast snapshots (`issueTime`, `lead_h`, `chainage_m`/`cell`, `p10`/`p50`/`p90`) in localStorage.
2. When observations become available, match pairs where:
   - Same chainage/station
   - Observation timestamp within ±45 min of forecast **valid time**
   - Observation is not substituted from another lead or the “latest forecast”
3. Metrics (only on matched pairs): MAE, RMSE, Bias, MAPE (where denom > 0), P10–P90 coverage, by lead buckets 0–6 / 6–24 / 24–48 / 48–72 h.
4. Insufficient-data gate: need **≥ 8** matched pairs before reporting skill metrics.

## 5. Validation sample counts

| Item | Count |
|------|------:|
| Archived forecast snapshots (verify seed) | 1 |
| Matched forecast–observation pairs | **0** |
| Minimum required for metrics | 8 |

## 6. Forecast accuracy metrics

**Not reported.** Sample size inadequate (`pairs = 0`). No MAE/RMSE/Bias/MAPE/coverage claimed. Engine correctly returns insufficient-data state.

## 7. Data-quality rules implemented

Classifications: `OBSERVED`, `LIVE`, `STALE`, `MODELLED`, `FORECAST`, `DERIVED`, `INTERPOLATED`, `UNAVAILABLE`.

- Per-source freshness windows (e.g. NadiTwin LIVE ~20 min; survey static; forecast lead-based).
- Missing value / missing timestamp → UNAVAILABLE (never coerced to 0).
- Invalid units, duplicate timestamps, invalid/unordered chainage flagged.
- `P10 > P90` → interval invalid (not displayed as valid uncertainty).
- API failure → retain last verified value with explicit **STALE** + original timestamp.
- Outlet Q kept distinct from selected-chainage Q.
- ForecastEngine **cannot** overwrite NadiTwin LIVE in canonical state.

## 8. Legacy charts corrected

| Chart / surface | Was | Now |
|-----------------|-----|-----|
| Discharge “today” | Implied live gauge | HISTORICAL·MODELLED + FORECAST·MODELLED (ForecastEngine) |
| Station hydrograph | “Live gauge data” | MODELLED synthetic past; CLASS_DEFAULT threshold |
| River stage profile | Datum/threshold “VERIFIED” | RELATIVE·UNVERIFIED / CLASS_DEFAULT |
| Threshold modal | WSE “LIVE” | MODELLED · NOT LIVE |
| Alerts / margin board | VERIFIED thresholds | CLASS_DEFAULT; Safety LOCKED |
| Primary UX | Unchanged 3D twin + HUD | Analytical charts remain secondary |

NadiTwin LIVE remains authority for operational discharge in HUD / weather / 3D inspect.

## 9. Safety readiness report

Status: **LOCKED — do not unlock**

| Requirement | Result |
|-------------|--------|
| NadiTwin vertical datum | UNVERIFIED (relative, not MSL) |
| River.EYE terrain datum | UNVERIFIED |
| Bank crest elevation source | MISSING |
| Bank crest vertical datum | MISSING |
| Cross-section survey | REQUIRES SURVEY |
| Chainage alignment | VERIFIED |
| Datum transformation | MISSING |
| Danger threshold calculation | UNVERIFIED (class defaults) |

Recommendation: unlock only after independent verification of datum, crest, and thresholds. Do not auto-transform relative WSE → MSL.

## 10. Browser test results

`PW_CHANNEL=chrome node scratch/verify_phase7.mjs` → **PASS phase7**

| Check | Result |
|-------|--------|
| LIVE outlet vs selected chainage | Distinct (e.g. outlet ~11.1; CH 0+000 ~9.2; CH 16+790 ~11.1) |
| Forecast P50 / P10–P90 | Present; invalid interval rejected |
| Freshness / quality | Quality service LIVE; canonical may show STALE after poll age |
| Safety locked | `true` |
| Threshold / intel modals | Hidden (not primary) |
| Weather Q | Consistent with mid-reach (~10.4 at 8+790) |
| Chainages tested | 0+000, 8+790, 8+820, 16+790 |
| Screenshots | `scratch/screenshots/phase7/ch-*.png`, `hud-overview.png`, `forecast-lead24.png`, `depth-mode.png` |

## 11. Remaining limitations

- No gauge OBSERVED archive connected → forecast verification cannot yet produce skill scores.
- Full-reach historical spatial Q/stage at 10 m unavailable.
- Secondary analytical charts still use ForecastEngine synthetics — correctly labelled MODELLED, not LIVE.
- Safety thresholds remain class defaults; boards stay locked.
- Relative WSE ≠ MSL; no verified transform.
- Dam releases (e.g. Khadakwasla) not modelled by NadiTwin/GloFAS.

---

**Phase 7 acceptance:** Hydrological values consistent via canonical state; forecasts distinct from observations; historical classified; verification gated on real pairs; stale/unavailable handled; legacy chart mislabels corrected; provenance traceable; safety locked; 3D Digital Twin intact and browser-verified.
