# Mula–Mutha pollution hotspots

The hotspot toggle, ranked markers, panel, chainage sync and weather BOD/COD now run on the Mula–Mutha twin. They use this project's BOD/COD pixel grid and the three JalNetra class overlays. Mandovi files were only read. They were not modified and their measurements were not copied.

## What was wired

The Mula–Mutha app has no `src/eye` tree. The same behaviour is in the files the running app actually loads:

- `scripts/analyze-mula-mutha-pollution-hotspots.mjs`
- `public/data/mula_mutha/pollution_hotspots.json`
- `src/scene/pollutionHotspotLayer.js`
- `src/ui/components/pollutionHotspotPanel.js`
- Hotspot button in `src/ui/components/navigationControls.js`
- Open/close handling in `src/ui/overlay.js`
- `ensurePollutionHotspots`, `setPollutionHotspotsVisible`, `focusPollutionHotspot`, `getPollutionHotspots` on the scene
- BOD/COD pin in `src/ui/components/weatherWidget.js`

Garbage arrows, pollution rasters, hydrology, rainfall and the flood sheet are unchanged.

## Data

Inventory: `scratch/mula_mutha_pollution_data_inventory.json`.

| Source | Class | Used as |
|---|---|---|
| `public/data/main_bod_cod_pixels.json` (1,212 points inside the study bounds) | OBSERVED | BOD and COD, mg/L |
| `src/jalnetra kml/eutrophication_trophic_class.kml` | CLASSIFIED | trophic class |
| `src/jalnetra kml/Nitrogen mulamutha.kml` | CLASSIFIED | risk class, not mg N/L |
| `src/jalnetra kml/coliform_ecoli_class.kml` | CLASSIFIED | relative class, not a CFU count |
| Chlorophyll-a raster, nitrogen mg/L, counted CFU | UNAVAILABLE | left null |

The KML files do not carry a laboratory timestamp. The panel shows the observation date as N/A. The overlay meta file date is 2026-11-11 and is stored only as `sourceUpdated`.

## Score

Weights are the Mandovi weights: BOD 0.30, eutrophication 0.25, nitrogen risk 0.20, coliform 0.25. The composite is the weighted mean of the layers present in a 0.008° cell, plus the existing multi-layer bonus (up to 0.14) and thickness bonus (up to 0.10), capped at 1. TSS is not included.

A cell is kept when at least two layers are present, or when one layer is both extreme (composite ≥ 0.85) and thick (≥ 8 pixels). That produced 26 candidates. The JSON keeps the top 12.

The original formula still reaches 1.00 on these cells: class severities are already 0.7–1.0, and the multi-layer and thickness bonuses are added before the cap. That raw value is kept as `rawComposite`. Rank uses an uncapped underlying score (same weights, BOD term `bod/10 + cod/30` with no dataset-max division). The number on the pin and in the list is `calibratedComposite`, which rescales that underlying score across the 12 published hotspots from 0.15 to 1. Measured BOD and COD are unchanged. High is yellow (`#FBC02D`). Rank 1 is the highest organic load: BOD 26.42 mg/L, COD 57.29 mg/L.

## Browser check at http://localhost:5185/

Checked in Chrome with no page errors from the hotspot code.

1. The right toolbar has one Hotspot button.
2. The JSON loads. 12 markers are added to `pollutionHotspotLayer`.
3. Turning it on opens **MULA–MUTHA POLLUTION HOTSPOTS** and flies toward rank 1.
4. The ranked list shows chainage, Extreme, and 1.00. Missing observation date is N/A.
5. After the opening 3D camera move, rank 1 settles the chainage readout on 2+620. Weather reads BOD 12.76 and COD 29.85, titled `SOURCE OBSERVATION`. The live JalNetra viewer returned no `viewer_id`, so the live reading was not available and was not invented.
6. Choosing rank 2 moves the chainage readout to 9+560, highlights that row, and changes weather to BOD 14.89 and COD 34.12 at the red marker for CH 9+560.
7. Turning Hotspot off hides the panel and the markers.

Screenshots: `scratch/screenshots/mula-mutha-pollution-hotspots/` (`01-hotspot-off.png`, `02-hotspot-on.png`, `03-panel.png`, `04-rank-2.png`, `05-hotspot-off-again.png`).

The Mandovi application was not run and was not edited. Its hotspot code is in a separate project.
