# Data sources & attribution

## Coordinate system

- Input: WGS84 / EPSG:4326 (lon/lat)
- Working: EPSG:32643 (UTM Zone 43N)
- Scene: local metres = UTM − mean origin of depth + KML vertices
- Module: `src/geo/projection.js` (`projectLonLat` / `unprojectXY`)

## Authoritative inputs

| Layer | File | Notes |
|-------|------|--------|
| River corridor polygon | `public/data/Mula_MuthaAOI.kml` (same geometry as `mula_mutha_river.kml`) | Source of bank-to-bank boundary |
| Bathymetry | `public/data/mula_mutha_water_depth.csv` from `mula_mutha_water_depth.xlsx` | latitude, longitude, depth_m |
| Depth overlay (validation) | `mula_mutha_depth_2d` KMZ → `mula_mutha_depth_overlay.png` + LatLonBox | Visual check only |
| Bridges | `public/data/bridges.geojson` | OpenStreetMap ways |
| Roads / buildings / parks | `public/data/osm_*.geojson` | OpenStreetMap via `scripts/fetchOsmMapApi.py` |
| Fishing locations | `public/data/Fishing_Locations.kml` | KML placemark Points (L1–L9); fish module only |

## Fishing ecosystem

Additive feature under `src/features/fishing/`. Uses the existing EPSG:32643 local frame. Does not alter river, bathymetry, bridges, or buildings.

## OpenStreetMap

© OpenStreetMap contributors  
https://www.openstreetmap.org/copyright  

Refresh context:

```bash
python scripts/fetchOsmMapApi.py
```

## Buildings (GLB)

Footprint positions: `public/data/osm_buildings.geojson` (OSM)  
Visual assets: `public/assets/buildings/**/*.glb` (procedural kit)

Pipeline: footprint → EPSG:32643 local → classify → GLB instance (near corridor) / extruded LOD (far)

Regenerate GLB kit:

```bash
node scripts/generateBuildingAssets.mjs
```

**Rule:** OSM footprints determine WHERE; GLB assets determine HOW they look.

## Google Earth

Manual visual reference only. No Google imagery or 3D assets are embedded.
