# HISTORIC VISUALIZATION CORRECTION REPORT

**Project:** MULA-MUTHA-3D / RIVER.EYE  
**Date:** 2026-11-25  
**Scope:** Historic Charts presentation only — LIVE mode, 3D river, water mesh, Phase 7–8 safeguards untouched.

## Verdict

Historic mode now behaves as a historical analytics surface: validated `at=` snapshots (no silent LIVE acceptance), honest status labels, prominent IST selection metadata, SELECTED TIME hydrograph cursor, and compact unavailable panels when full-reach spatial series are missing. LIVE path remains isolated.

Validation: `scratch/historic_visualization_correction_validation.json` → **pass: true**

Screenshots: `scratch/screenshots/historic-visualization-correction/`

---

## 1. Root cause — “API returned LIVE”

| Factor | Finding |
|--------|---------|
| Requested date/time | ISO with offset, e.g. `2024-07-15T06:00:00+05:30` |
| Encoding bug | Unencoded `+` in query strings is decoded as a **space** → `…T06:00:00 05:30` |
| Upstream behaviour | Malformed `at` is ignored → `/api/state` returns **`live: true`** (current twin) |
| Cache keys | Fixed earlier: LIVE = `state`, historic = `state:at:<iso>` (no cross-poisoning) |
| Adapter | Must reject `live: true` for historic snapshots |

**Fix:**

1. Proxy (`scripts/naditwinApiMiddleware.mjs`): repair `at` when `+` became space; re-encode with `encodeURIComponent` before upstream.
2. `fetchHistoricStateSnapshot`: **always reject** `live === true`; require timestamp within 2 h of request; never treat LIVE as HISTORICAL; keep LIVE cache key independent.

Verified after fix:

- Encoded & raw-plus `at=` → `live: false`, `at: 2024-07-15T00:30:00Z`, Q≈485.5 at CH 8+400  
- LIVE without `at` → `live: true`, current timestamp (unchanged)

---

## 2. Empty graph panels → compact availability UI

When full-reach historic spatial Q/WSE is unavailable:

- No empty chart SVG shell
- Compact panel (~100–130 px) with reason, detail, and optional **station** sample from hydrograph (never LIVE spatial)
- Hydrograph receives primary height (`resolveChartHeights({ compactSpatial: true })`)

When spatial **is** available (current monsoon example 2024-07-15 06:00 IST):

- Full Discharge + Stage profiles render from `/api/state?at=`
- Sequence remains: **1 Discharge → 2 Stage → 3 Hydrograph**

---

## 3. Historic Hydrograph as primary time series

- Historical stage, discharge, rainfall (when present)
- Forecast median / P10–P90 only when series exist
- Watch / warning / danger only when level provenance is present
- Prominent **SELECTED TIME** vertical marker + IST label
- Tooltip / hover includes exact timestamp (IST wall)
- Date/time / step updates marker + refetch; stretch/station/timezone preserved
- No fabricated fill curves

---

## 4. Header & status honesty

| Item | Behaviour |
|------|-----------|
| LIVE / HISTORIC / date / time / step | Unchanged controls; historic clock visually emphasized |
| Selected IST | Coverage strip + meta strip |
| API timestamp | Shown separately from browser clock |
| Coverage / source / class | Historic meta: coverage, NadiTwin source, classification |
| Last historic fetch | Shown in meta strip |
| Status badge | **MODELLED · PROVISIONAL** (historic); LIVE uses MODELLED / PROVISIONAL / UNVERIFIED — **SAFE removed** |
| Phase 8 | Safety boards remain **LOCKED**; modelled values unchanged |

---

## 5. Files touched

| File | Change |
|------|--------|
| `scripts/naditwinApiMiddleware.mjs` | Repair/re-encode `at` |
| `src/services/hydrology/naditwinHistoricService.js` | Strict LIVE rejection; station sample helper |
| `src/ui/components/hydroIntelThreeGraphs.js` | Compact avail panels; hydro priority; SELECTED TIME; historic meta |
| `src/ui/components/hydroIntelPanel.js` | Status labels; historic coverage strip; CSS |
| `scratch/capture_historic_visualization_correction.mjs` | Automated checks + screenshots |

**Not modified:** LIVE series builders, 3D river, water mesh, Phase 7–8 lock logic.

---

## 6. Test matrix

| Test | Result |
|------|--------|
| Historic date selection | PASS |
| Historic time selection | PASS |
| Previous/next step | PASS (`stepUpdates`) |
| API mode validation (`live:false` + ts match) | PASS |
| Historical station / spatial data | PASS (full-reach OK for 2024-07-15) |
| Historical Hydrograph + SELECTED TIME | PASS |
| Forecast separation (no false median when absent) | PASS |
| Switch back to LIVE | PASS (`liveRestored`, no compact class) |
| LIVE charts still SVG + order Discharge→Stage→Hydro | PASS |
| Viewports 1920×1080 / 1600×900 / 1366×768 | Captured |

---

## 7. Screenshots

| File | Content |
|------|---------|
| `01-live-baseline-unchanged.jpg` | LIVE before historic |
| `02-historic-overview-1920.jpg` | Historic full stack @ 1920×1080 |
| `03-discharge-panel.jpg` | Historic discharge profile |
| `04-stage-panel.jpg` | Historic stage profile |
| `05-hydrograph-primary.jpg` | Hydrograph + SELECTED TIME |
| `06-historic-step-next.jpg` | After +1 h step |
| `07-back-to-live.jpg` | LIVE restored |
| `08-historic-1600x900.jpg` | Responsive |
| `09-historic-1366x768.jpg` | Responsive |

---

## 8. Residual notes

- Spatial `+24h` / `+72h` Q and spatial rain remain unpublished for arbitrary historic `at` — shown honestly, not fabricated.
- Compact unavailable panels activate only when the historic snapshot is rejected/empty; with correct `at=` encoding they are the exception path.
- NadiTwin responses may still include `mode: "live"` on historic snapshots; classification uses **`live` boolean + timestamp match**, not the `mode` string.
