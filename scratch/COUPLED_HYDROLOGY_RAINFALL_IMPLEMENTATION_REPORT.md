# Coupled hydrology and rainfall

One scenario drives the existing river sheet. Rainfall runoff and a discharge or stage adjustment are added together. NadiTwin LIVE values are only read.

## What is coupled

- Source discharge and relative stage come from the NadiTwin live bundle at the selected chainage. They are not written back.
- Rainfall still uses the existing SCS-CN and unit-hydrograph engine. Only the excess runoff (`qDirect`) is added to source discharge. Rainfall millimetres are not added to stage. If the storm is at or below initial abstraction, runoff stays 0.
- A discharge adjustment and a water-level adjustment are scenario deltas. Combined discharge is source + runoff + discharge delta. The sheet rise is the Manning depth change from source discharge to that combined discharge, plus the water-level adjustment.
- The same `setHydrologySimulationRise` path moves the existing water mesh. No second river mesh and no separate rainfall water layer.
- Floodplain area and buildings stay UNAVAILABLE. There is no floodplain hydraulic surface to intersect. Affected length, when the corridor geometry exists, uses the existing lumped channel span and is marked APPROXIMATED. It is not a flood extent.
- Relative stage is labelled relative, not MSL.
- LIVE charts, safety boards, and the NadiTwin store are unchanged.

## Controls

- The left Rainfall Simulation panel keeps rainfall amount, duration, intensity, start, pause, resume, reset, speed, and the response graph.
- Discharge and stage adjustments are not on that panel.
- The existing compact toolbar (discharge / stage / hydrograph and H-D-W) has one added water button. It opens and closes the Hydrology panel. Closing the panel does not stop the simulation.
- While rainfall is open, the forecast playback buttons stay hidden and the hydrology button remains available.
- Reset scenario stops rainfall playback, clears both adjustments, and returns the sheet rise to 0. Source LIVE discharge is left as it was.

## Browser check at localhost:5185

Chainage about 8+790.

| Check | Result |
|---|---|
| Hydrology button opens the panel | Source stage 531.62 m, chainage discharge 10.3 m³/s, datum marked relative |
| Raise water level twice | Sheet rise +0.10 m, status HYDROLOGY ACTIVE |
| Increase discharge once | Scenario +5 m³/s, combined 15.3 m³/s, sheet rise +0.21 m |
| Rainfall started with that adjustment | Status COUPLED SIMULATION ACTIVE, phase RAINING, runoff 0.0 m³/s at that instant |
| Rainfall panel | No discharge or stage adjustment buttons |
| Floodplain area | UNAVAILABLE |
| Reset scenario | Rise 0, adjustments 0, combined discharge back to 10.3 m³/s, status READY |
| Live hydraulic summary | 9.198 m³/s before the scenario and 9.198 m³/s after reset |

Runoff was still 0 m³/s in the short coupled sample because excess is routed through the existing unit hydrograph, and a storm at or below initial abstraction produces no excess. Combined discharge stayed source plus the scenario delta, so that rain was not added on top of NadiTwin twice.

## Screenshots

`scratch/screenshots/coupled-hydrology-rainfall/`

- `01-hydrology-panel.png` — toolbar button and hydrology panel at live values
- `02-hydrology-stage-up.png` — water-level increase
- `03-hydrology-discharge-up.png` — discharge increase
- `04-coupled-running.png` — rainfall running together with the discharge and stage scenario; river sheet raised
- `05-reset.png` — scenario cleared, source discharge and stage restored
