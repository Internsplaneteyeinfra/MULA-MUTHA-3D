# Mula–Mutha terrain flood simulation

MODELLED. Not an engineering-verified flood extent. Relative stage is not MSL.

## What was wrong

The river mesh and the flood sheet were raised by the real stage difference in scene metres. The DTM is stored as `(elevation − local water surface) × 3.2`, so a 1 m bank is drawn 3.2 m above the river. The water could look higher in the channel and still sit below every floodplain cell.

The flood fill also marked every low cell within 28 m of the bank as already wet. That could wet ground that was not connected to the channel. The sheet was polygon-offset into the terrain, so even a built inundation mesh could disappear under the DTM.

## What changed

The existing `floodInundation` mesh is still the only floodplain surface. The river mesh is unchanged in structure. The DTM, buildings, roads and bridges are not moved.

- A hydrology or rainfall stage rise of `h` metres is drawn as `h × 3.2` scene metres on both the river surface and the flood sheet, so they meet the exaggerated terrain. The numbers on the panels stay in real metres.
- Flooding starts only inside the mapped channel. It then steps to a neighbouring cell only when that cell’s ground is below the water surface. A ridge or embankment stops the water. Isolated low ground is left dry.
- The original river surface still covers the channel. The flood mesh draws the bank fringe and the connected floodplain, and it is offset toward the camera so it is not buried in the DTM.
- Flooded area is the sum of wet floodplain cells. Volume is real depth `(scene depth ÷ 3.2) × cell area`. Left and right spread are the furthest wet cells on each side of the mapped water edge.
- The Layers flood-stage slider and the JalNetra API flood are not rescaled.

## Modes

- Discharge only: scenario discharge, rainfall runoff stays 0.
- Rainfall only: runoff comes from the existing rainfall clock (SCS-CN). It is not added again on top of a second rainfall term.
- Both: combined discharge is scenario discharge plus that one runoff term. Millimetres are not added to m³/s.

The rainfall model still uses the existing assumed catchment: 150 km², CN 70, lag 2 h. Those inputs are labelled assumed in the rainfall service. They were not replaced with a new invented basin. If the rainfall simulation is not running, rainfall mode has no runoff sample and runoff stays 0.

Manning `n = 0.035` and slope `0.0008` remain assumptions in the storage clock. Outflow is that conveyance scaled to the live source discharge. NadiTwin LIVE is read only.

## DTM

FABDEM elevations are converted with the local water-surface grid and `TERRAIN_VERTICAL_EXAG = 3.2`. The flood grid is about 18 m, capped near 120,000 nodes, rebuilt only when the drawn water level moves by more than about 4 cm. The terrain mesh itself is not rebuilt.

## Not verified in this pass

A live 3D playback screenshot was not captured here. The scene still has to be checked on the running app: discharge only, rainfall only, both, pause, resume, and reset. High ground should stay dry, and the blue sheet should stop at a ridge instead of crossing it.

## Remaining limits

This is a level pool on the scene DTM, not a 2D shallow-water model. It does not route water down roads as a separate network, and it does not remove building footprints from the sheet. Where the ground under a building is below the water surface and connected to the river, the water surface passes through the building base. Spread, area and volume are modelled quantities, not a verified flood prediction.
