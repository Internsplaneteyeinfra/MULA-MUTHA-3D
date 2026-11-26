# Mula–Mutha complete hotspot UI

The Pollution Hotspot view now follows the compact reference: the 3D river stays the main view, the selected site has a yellow/red marker and a small floating card, and one bottom bar carries the measurements. The header, right toolbar, chainage ruler, scores, and hotspot JSON were left as they are.

## Modified files

- `src/ui/components/pollutionHotspotPanel.js` — bottom bar with previous/next. The large left ranked list is no longer shown.
- `src/styles/gis-ui.css` — bar size, colour, and type. It sits above the chainage ruler.
- `src/scene/pollutionHotspotLayer.js` — selected marker colours and the compact floating card. Rank, score, and measured values are unchanged.
- `src/styles/hydrology-simulation.css` — removed the rule that hid the hydrology shortcut while the old left panel was open.

## What the screen shows

- Header, weather, discharge, and the centre chainage control use the existing bindings.
- Selected marker: outer ring `#FFD600`, middle ring `#E53935`, pin `#FFD600`. Other sites stay smaller and use their severity colour, without a card.
- Floating card, only on the selected site: rank and severity, chainage, BOD and COD. Dark fill, thin red border, pointer toward the pin.
- Bottom bar, one row, about 108–112 px, cyan border `#16D9E8`, background `#071923`. It shows rank, site count, previous/next, BOD, COD, eutrophication, nitrogen risk, coliform risk, and source. Chainage is not repeated there.
- Source is `LIVE OBSERVED` only when the JalNetra image is live. Saved cell peaks are `SOURCE OBSERVATION`. A missing class is `N/A`. No observation date is printed on the bar.
- Previous and next walk all 12 sites, move the camera, and sync chainage. Closing Hotspot hides the bar and the markers.

## Browser check — http://localhost:5185/

| Check | Result |
|---|---|
| Rank 1 | CH 11+310, Extreme, BOD 29.21 mg/L, COD 63.11 mg/L, Hypereutrophic, High nitrogen risk, High coliform, LIVE OBSERVED |
| Marker | One card visible. Outer `#ffd600`, middle `#e53935`, pin `#ffd600` |
| Chainage in the bottom bar | None. HUD and ruler show 11+310 |
| Next through all 12 | 16+390, 0+690, 9+010, 8+110, 7+200, 9+560, 8+930, 2+620, 3+460, 2+060, 10+500, then back to 11+310 |
| Rank 2 coliform | N/A. That cell has no coliform class |
| Bar vs ruler | 18 px gap at 1600×900 and 1920×1080. 22 px at 1366×768 |
| Hotspot off | Bar hidden, markers hidden |
| Page errors | None |

Before the live JalNetra image arrives, rank 1 shows the saved cell peaks (BOD 26.42, COD 57.29) labelled SOURCE OBSERVATION. Those numbers are the published hotspot values, not invented readings.

## Screenshots

`scratch/screenshots/mula-mutha-complete-hotspot-ui/`

- `01-full-1600.png` — settled rank 1
- `02-bottom-panel.png` — bottom bar
- `03-rank-2.png` — next site
- `04-hotspot-off.png` — Hotspot closed
- `05-1366.png` — 1366×768
- `06-1920.png` — 1920×1080

## Limitations

- River Data and the small hydrology shortcut stay on the left. They are existing twin controls, not part of the hotspot bar.
- If Hotspot is opened while the opening camera move is still running, the chainage HUD can remain on the intro station until that move ends or the next/previous button is used.
- The floating card is a scene sprite, so it scales with the camera. It stays attached to the selected marker.
