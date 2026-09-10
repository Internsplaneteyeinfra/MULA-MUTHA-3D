# NadiTwin — Multi-River (Mula-Mutha + Mithi)

One dashboard, one server, a **River** dropdown to switch between the
two reaches. Everything below documents exactly what changed from the
two separate single-river builds, and what's real vs synthetic in each.

## Setup & run

The app itself (`run.py`, `naditwin/engine.py`, `naditwin/server.py`)
uses **only the Python standard library** — nothing to install to just
run the dashboard:

```
python3 run.py
```
Opens `http://localhost:8080` automatically. Options:
```
python3 run.py --port 9000                    # different port
python3 run.py --seed 7                       # different synthetic monsoon
python3 run.py --no-browser                   # don't auto-open a browser tab
python3 run.py --gauge data/your_gauge.csv    # plug in a real discharge/stage CSV
```
Use the **River** dropdown (top bar) to switch between Mula-Mutha and
Mithi — every chart/board/map reloads for whichever river is selected.

### If you want to re-run the dev-tool scripts

Only needed if you re-extract geometry from a new/updated KML, or
re-interpolate a new depth survey — **not needed to just run the app**.
These need a few extra packages (`requirements.txt` in this folder):

```
pip install -r requirements.txt
# or, if that's blocked by your system Python:
pip install -r requirements.txt --break-system-packages

python3 extract_centerline_mula_mutha.py
python3 reverse_and_tag_landmarks_mula_mutha.py
python3 build_depth_profile_mula_mutha.py

python3 extract_centerline_mithi.py
python3 tag_mithi_landmarks.py
```
Each writes its output straight into `naditwin/rivers/<river>/`, so the
app picks up the new files the next time you run `python3 run.py`.


## What changed vs the two separate builds

- `naditwin/engine.py` — rewritten around a `RiverData` class that
  loads one river's pre-computed JSON from
  `naditwin/rivers/<key>/(chainage_profile.json, reach_polygon.json,
  landmarks.json, [depth_profile.json])`, and a `TwinEngine` that takes
  a `RiverData` instead of hardcoded module-level paths. `RIVER_CONFIGS`
  lists the two rivers; add a third by dropping its JSON files in a new
  `naditwin/rivers/<key>/` folder and adding one line to that dict.
- `naditwin/server.py` — every endpoint now reads an optional
  `?river=<name>` query param and dispatches to that river's `TwinEngine`
  (one instance per river, built once at startup). `/api/rivers` lists
  both.
- `naditwin/static/dashboard.html`:
  - **Removed the internal asset IDs from every displayed label**
    (margin-board cards, map popups, hydrograph dropdown) — you now see
    just the locality name (e.g. "Sangam", "Kalina") instead of
    "EMB-1 — Sangam — embankment (illustrative)". The ID still exists
    internally (`asset.id`, e.g. `"A1"`) so the app can look assets up,
    it's just not shown anywhere.
  - **Removed the "— embankment / habitation / bridge / infrastructure
    (illustrative)" suffix** from asset names — engine.py now sets
    `asset["name"]` to the plain locality name only (see
    `_build_assets()` in engine.py).
  - **Removed the "undefined" text in Active alerts** — the alert
    template used to print `${a.confidence_note}`, a field the engine
    stopped returning a few edits ago; the template still referenced
    it, so it rendered the literal word "undefined". That line is
    deleted now.
  - Header subtitle and the "Reach location" heading are now filled in
    from `/api/meta`'s `river` field after each river switch, instead
    of being hardcoded to "Mula-Mutha ... Sangam → Manjari".

## What's REAL vs SYNTHETIC, per river

| Layer | Mula-Mutha | Mithi |
|---|---|---|
| Centerline, chainage, width | ✅ real (your KML) | ✅ real (your KML) |
| Locality names + positions | ✅ real (snapped to real chainage) | ✅ real (snapped to real chainage) |
| Bed **relief** (relative depth shape) | ✅ real (your 11,580-point depth survey) | ❌ synthetic toy formula (no depth survey supplied for Mithi) |
| Absolute elevation datum / downstream slope | ❌ synthetic (no DEM) | ❌ synthetic (no DEM) |
| Embankment / bank crest height | ❌ synthetic (no structural survey) | ❌ synthetic (no structural survey) |
| Discharge (Q), stage, hydrograph, forecasts, margins, alerts | ❌ synthetic (no gauge/sensor feed) | ❌ synthetic (no gauge/sensor feed) |

Same limitations as before: I still can't fetch a DEM or gauge feed
myself in this sandbox (no internet access). Upload a Copernicus
GLO-30 `.tif` for either/both rivers, or an hourly gauge/discharge CSV
(`python3 run.py --gauge data/your_file.csv` — note: currently applies
to whichever river's engine you pass it to; ask if you want per-river
`--gauge-mula-mutha` / `--gauge-mithi` flags instead), and I'll wire
them in the same way as documented in the earlier single-river READMEs.

## Layout

```
run.py                                  launcher
requirements.txt                        deps for dev-tool scripts only (app itself needs none)
data/
  mula_mutha_river.kml                  your source KML (real)
  mula_mutha_water_depth.xlsx           your source depth survey (real)
  mithi_river.kml                       your source KML (real)
naditwin/
  engine.py                             multi-river engine (RiverData + TwinEngine)
  server.py                             stdlib HTTP server, ?river= routing
  static/dashboard.html                 dashboard (river dropdown wired to backend)
  rivers/
    mula_mutha/
      chainage_profile.json             real, from KML
      chainage_profile_original.json    un-reversed backup
      reach_polygon.json                real, from KML
      landmarks.json                    real localities, snapped
      depth_profile.json                real, from depth survey
    mithi/
      chainage_profile.json             real, from KML
      reach_polygon.json                real, from KML
      landmarks.json                    real localities, snapped
extract_centerline_mula_mutha.py        dev tool: KML -> chainage/width (Mula-Mutha)
extract_centerline_mithi.py             dev tool: KML -> chainage/width (Mithi)
reverse_and_tag_landmarks_mula_mutha.py dev tool: flip chainage + snap localities (Mula-Mutha)
tag_mithi_landmarks.py                  dev tool: snap localities (Mithi)
build_depth_profile_mula_mutha.py       dev tool: depth survey -> per-station depth (Mula-Mutha)
```

Dev-tool scripts need `shapely`, `pyproj`, `scipy`, `networkx`, `pandas`,
`openpyxl` to re-run. `run.py` / `naditwin/engine.py` / `naditwin/server.py`
themselves only need the pre-computed JSON files (already generated,
already in this zip) and the Python standard library.

## API

`/api/rivers`, `/api/meta?river=`, `/api/state?river=`,
`/api/forecast/profile?lead=&river=`, `/api/hydrograph?cell=&river=`,
`/api/margins?river=`, `/api/alerts?river=`, `/api/scorecard?river=`,
`POST /api/advance?hours=&river=`. `river` is optional everywhere except
`/api/rivers`; omitting it uses Mula-Mutha (the first-listed river).
