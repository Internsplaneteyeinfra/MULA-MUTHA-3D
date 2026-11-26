# River filling and floodplain spread

The ground, river bed, riverbanks, bridges and buildings stay at the elevations they were built with. A scenario changes the water surface and the connected flood sheet only.

The filling clock is a level-pool storage model, labelled MODELLED. It is not an engineering-verified flood study. Relative NadiTwin stage is not MSL. NadiTwin LIVE discharge is read and never written.

## What moves

- The river surface mesh rises and falls (`waterOnly`). The bed, channel banks and wall geometry are left at their built positions.
- One flood sheet is updated where the water surface is above the DTM and the cell is connected to the mapped river. Isolated single cells are dropped. Pour-point ponds can remain as the surface falls.
- The sheet is drawn over the terrain and over draped roads. Buildings, bridges and the DTM meshes are not translated.

Checked in the browser at `http://localhost:5185/` after a 600 m³/s run: terrain vertex Y, surround Y, river-bed Y, channel-bank Y and a bridge position were identical to the values taken before the run.

## Storage

For each time step:

ΔV = (Qin − Qout) Δt

Qout is Manning conveyance on the mapped wet width, scaled so that the live source discharge is the outflow at the live depth. Manning n = 0.035 and bed slope = 0.0008 are documented assumptions, not a surveyed rating.

Channel plan area is mapped wet width × reach length. Once the sheet reports a floodplain area, that area is added on the next step so a wider plain rises more slowly. Rainfall runoff is SCS-CN excess (qDirect) added once. Millimetres of rain are not added to stage. Scenario discharge is stored separately from the LIVE series.

Playback compresses the selected duration into about 36 seconds at 1×, with 5×, 10× and 30×.

## Browser runs

Chainage about 8+790. HUD source discharge stayed **10.3 m³/s** (upstream 9.2, outlet 11.0) while the scenario was 600 and 400 m³/s. Source stage stayed **531.62 m** relative, river bed **530.08 m**.

| Run | Result |
| --- | --- |
| Discharge only, scenario 600 m³/s, 1 hour, 30× | Rise **+0.72 m**. Modelled outflow about **102 m³/s**. Floodplain **0.618 km²**. Left **1680 m**, right **458 m**. Sheet visible. |
| Same, then scenario returned to 10 m³/s for another 1 hour | Rise eased **0.72 → 0.61 m**. The plain did not empty in one hour. |
| Reset | Rise **0**. Water surface back at **9.40**. Flood sheet hidden. Spread cards **N/A**. |
| Rainfall only, 80 mm in 2 h, 30×, then the filling clock | Runoff reached **251.8 m³/s** (SCS excess, not millimetres on stage). Rise about **+1.00 m**. |
| Both, scenario 400 m³/s plus that runoff, 6 h at 10× | Combined inflow **610.6 m³/s** (400 + 210.6). Source card stayed **10.3 m³/s**. Rise **+2.38 m**. Floodplain **0.784 km²**. River volume and floodplain volume both shown as MODELLED. |

A later 6-hour, 600 m³/s run reached about **+2.27 m**, floodplain **0.774 km²**, with the same left/right maximums. Of the wet floodplain samples, 120 were within 80 m of the mapped water edge, 18 were between 80 and 250 m, and 98 were beyond 250 m. The 1680 m and 458 m figures are the farthest connected samples beyond the mapped wet edge, not a distance from the centreline. They are MODELLED. They are not a surveyed flood boundary.

The 2D overview shows that water as a blue sheet on the channel and on low ground and roads beside the banks. High ground and building blocks stay dry. Reset returns the channel to the live surface and clears the sheet.

## Screenshots

`scratch/screenshots/river-filling-flood-spread/`

- `01-panel-live.png` — hydrology panel on LIVE discharge
- `02-discharge-1h.png` — 600 m³/s after 1 hour, water surface up in the channel
- `03-recession.png` — discharge returned to LIVE, level still falling
- `04-reset.png` — reset
- `05-rainfall.png` — rainfall runoff
- `06-combined.png` — rainfall plus scenario discharge, response cards
- `07-aerial-discharge.png` — 2D view of the connected blue sheet
- `08-aerial-reset.png` — 2D view after reset, spread cards N/A
- `09-left-spread.png` — oblique view of high ground that stays dry

## Limits

Bank elevations are the DTM at the mapped water edge, not a surveyed embankment line. Cross-sections are the mapped wet width, not a surveyed section. Outflow is not the published outlet series; that series is displayed and left unchanged. Flood area, volume and spread are a level-pool comparison with the DTM. Do not treat them as a design flood extent.
