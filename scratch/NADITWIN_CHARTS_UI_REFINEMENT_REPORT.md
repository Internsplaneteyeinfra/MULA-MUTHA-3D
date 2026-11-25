# NadiTwin Charts UI Refinement Report

**Date:** 2026-11-25  
**App:** `http://localhost:5185/`  
**Scope:** Digital Twin → Charts panel only (Phases 1–8 preserved)

---

## Historical data coverage discovered

| Field | Value | Source |
|---|---|---|
| Earliest | `2021-01-01` | `/api/timerange` → `epoch_date` |
| Latest | `2026-11-25` | `/api/timerange` → `today_date` |
| Twin clock | `today_hour` from timerange / today | LIVE twin time |
| 24h hydrograph | 24 points, hourly | `/api/hydrograph?hours=24` |
| 7d | 168 points | `hours=168` |
| 30d | 720 points | `hours=720` |
| 90d | API returns downsampled (~1080 pts) | `hours=2160` |
| 1y | Downsampled (~1460 pts) | `hours=8760` |
| All history | `2021-01-01` → ~today, `step_h≈35` | `hours=100000` |
| Annual year | e.g. 2025 → 1460 pts (6h step) | `/api/hydrograph?year=` |

**Classification:** all historical hydrograph series are **HISTORICAL · MODELLED** (not gauge OBSERVED).

---

## Removed / replaced history options

**Before:** only three hard-coded lookbacks (`24h`, `72h`, `168h`) with no coverage summary and no custom range.

**Reference problem:** long NadiTwin-style lists of individual years + “past N days + 72h forecast” combinations.

**Now (primary dropdown):**

- Last 24 hours
- Last 7 days
- Last 30 days
- Last 90 days
- Last 1 year
- All available history
- Custom date range

Individual years are **not** listed in the primary dropdown. Specific years/periods use **Custom date range** (clamped to timerange coverage) or the **ANNUAL** chart (`year=`).

Unavailable presets are disabled when coverage cannot support them.

---

## New historical selection behaviour

1. HISTORIC mode reveals the preset dropdown.
2. Coverage strip shows earliest–latest, selected period, source, classification, last update.
3. Custom range: From/To date inputs + Apply; clamped to `/api/timerange`.
4. Lookback hours drive hydrograph / discharge / rainfall — **no fabricated fills**.
5. Forecast remains visually separate (NOW marker, distinct series styles).
6. Live 60s refresh **skips** HISTORIC mode and non-live tabs.

---

## Chart categories implemented

| Category | Tabs |
|---|---|
| OVERVIEW | SUMMARY |
| LIVE | TODAY, Q PROFILE, STAGE, DEPTH |
| HISTORICAL | HYDROGRAPH, DISCHARGE, ANNUAL |
| FORECAST | ENSEMBLE, TODAY |
| HYDRAULICS | RATING, THRESHOLD, MARGINS, ALERTS |
| RAINFALL | RAIN |
| VALIDATION | SCORECARD |

All previous NadiTwin-backed charts remain reachable.

---

## Scorecard improvements

- Responsive KPI cards (4 / 3 / 2 / 1 columns).
- RMSE, hits, misses, false alarms, ensemble, evaluation period, validation status.
- **INSUFFICIENT OBSERVATION DATA** when pair proxy is zero — zero RMSE is not treated as skill.
- Hindcast / modelled provenance retained; source text wraps.

---

## Graphs fixed

- Consistent chart min-heights; full-bleed dark canvas.
- `svgPath` / `svgBand` skip nulls (gaps, no fake zero cliffs).
- `r2(null)` no longer becomes `0`.
- Rainfall honors historic lookback + NOW marker.
- Hydrograph titles state past window + classification.

---

## Graphs unavailable / limited by API

| Item | Status |
|---|---|
| Gauge OBSERVED pairs in scorecard | Not exposed by NadiTwin scorecard payload |
| Dual-axis Stage+Q annual | Stage/Rain tooltip-only (units differ) |
| Cross-section in Charts tabs | Via Profile Analysis measure tools |
| Long-range hours | Server downsamples (`step_h` grows) |

---

## API and provenance verification

| Endpoint | Used for | Class |
|---|---|---|
| `/api/timerange` | Coverage strip | META |
| `/api/today` | TODAY | LIVE/FORECAST · MODELLED |
| `/api/hydrograph` | Hydro / discharge / rain / annual | HISTORICAL · MODELLED + FORECAST |
| `/api/scorecard` | VALIDATION | HINDCAST · MODELLED |
| `/api/live`, `/api/state`, profiles | LIVE tabs | LIVE · MODELLED |

Proxy: `/naditwin-api` unchanged. No duplicate pollers.

---

## Remaining issues

1. Scorecard lacks explicit `observation_pairs` — UI uses conservative insufficiency rule.
2. Long custom ranges inherit NadiTwin downsampling — consider showing `step_h` in provenance.
3. Automated screenshots may be limited by disk space on this workstation.
4. FORECAST and LIVE both expose TODAY — intentional under category nav.

---

## Files touched

- `src/ui/components/hydroIntelHistRange.js` (new)
- `src/ui/components/hydroIntelPanel.js`
- `src/ui/components/hydroIntelExtraCharts.js`
- `src/services/hydrology/naditwinChartSeries.js` (null-safe `r2`)
- `scratch/NADITWIN_CHARTS_UI_REFINEMENT_REPORT.md`
