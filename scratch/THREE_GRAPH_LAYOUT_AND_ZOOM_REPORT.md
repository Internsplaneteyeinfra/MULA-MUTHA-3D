# THREE_GRAPH_LAYOUT_AND_ZOOM_REPORT

**Date:** 2026-11-25  
**Scope:** UI/layout only — NadiTwin three-graph Charts (Stage · Hydrograph · Rating)  
**Result:** PASS

## Summary

Fixed excessive vertical compression of the three Charts graphs and added independent maximize/expand for each graph. Source data, stations, stretches, hist ranges, axes and thresholds are unchanged. Expand/collapse re-renders SVG dimensions from an in-memory cache (no duplicate API polling).

## A. Normal dashboard

| Graph | Target | Measured @ 1920×1080 | @ 1600×900 | @ 1366×768 |
|-------|--------|----------------------|------------|------------|
| River Stage Profile | 250–280 px | **265 px** | 245 px | 230 px |
| Hydrograph | 300–340 px | **320 px** | 295 px | 270 px |
| Rating Curve | 250–280 px | **265 px** | 245 px | 230 px |

- All three remain full-width stacked cards, simultaneously visible.
- Content area scrolls when needed; graphs are no longer squeezed into ~185/205 px viewBoxes.
- Titles, legends, axes and tooltips no longer collide (legend wrap restored; compact 16 px max-height removed).

## B. Individual graph expansion

- Maximize icon on each graph card (upper-right actions cluster).
- Click expands that graph only; others are hidden via `data-expand`.
- Expanded plot height ~640–680 px on 1080p; tick labels step up to ~11 px.
- Controls:
  - **Back to all 3 graphs** — restores the dashboard.
  - **Exit fullscreen** — closes the Charts panel.
  - **Escape** — first collapses expand; second closes the panel.
- Hydrograph historical dropdown remains beside the Hydrograph title in expanded mode.
- Expand/collapse uses cached Stage / Hydro / Rating payloads — no extra NadiTwin fetches.

## C. Graph-specific preservation

| Graph | Preserved |
|-------|-----------|
| Stage | Chainage X, Level (m WSE) Y, stage / bed / watch / warning / danger / crest |
| Hydrograph | Local-time X, stage + Q + rain, hist/forecast split, hist selector |
| Rating | Log Q X, relative stage Y, curve + thresholds + Now / Peak markers |

## D. Interaction / data

- Station badge stayed `CH 8+790` across expand and hist `7d` change.
- Hist change still reloads hydro only (`only: "hydro"`); stage/rating cache retained.
- Window resize recalculates heights from cache (debounced).
- No changes to NadiTwin API, mesh, elevations, thresholds or provenance strings.

## E. Test matrix

| # | Test | Result |
|---|------|--------|
| 1 | All three visible (normal) | PASS |
| 2 | Stage expanded | PASS (679 px) |
| 3 | Hydrograph expanded | PASS (644 px) |
| 4 | Rating expanded | PASS (679 px) |
| 5 | Back to all 3 graphs | PASS |
| 6 | Exit fullscreen | PASS |
| 7 | Hist selector in expanded Hydro | PASS (`7d`) |
| 8 | Station sync across modes | PASS |
| 9 | Console | Only unrelated 404 resource noise |
| 10 | Responsive 1600 / 1366 | PASS |

Metrics JSON: `scratch/three_graph_layout_metrics.json`

## Screenshots

Directory: `scratch/screenshots/three-graph-layout/`

1. `01-normal-all-three-1920.jpg`
2. `02-stage-expanded.jpg`
3. `03-back-to-all.jpg`
4. `04-hydro-expanded.jpg`
5. `05-hydro-expanded-hist-7d.jpg`
6. `06-rating-expanded.jpg`
7. `07-exit-fullscreen.jpg`
8. `08-responsive-1600x900.jpg`
9. `09-responsive-1366x768.jpg`

## Files touched

- `src/ui/components/hydroIntelThreeGraphs.js` — responsive heights, expand cache, expand chrome
- `src/ui/components/hydroIntelPanel.js` — CSS layout/expand bar; wire exit + Escape; reset on hide
- `scratch/capture_three_graph_layout.mjs` — Playwright capture + checks
