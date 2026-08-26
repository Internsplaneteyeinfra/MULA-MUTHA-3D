# Geospatial data pipeline (KML-master)

## Authoritative input

The uploaded / bundled **KML** is the master spatial reference for the river.

- Coordinate order: **longitude, latitude, altitude**
- Runtime primary file: `public/data/Mula_Mutha_Chainage_Analysis.kml`
- Coordinates are **never silently moved**; discontinuities are reported

Projection: WGS84 → **EPSG:32643** (UTM 43N) → local frame with `flipX` (shared origin).

## Extract OSM from KML corridor

```bash
# Default 500 m buffer around the full KML river bbox
npm run extract:osm

# Wider city context
python scripts/extractOsmFromKml.py --buffer 800

# Validate KML only (no Overpass)
npm run extract:osm:validate

# Offline: enrich existing osm_*.geojson → buildings/roads/vegetation + height_source
npm run enrich:osm
```

If Overpass mirrors are blocked on your network, use `enrich:osm` after any successful prior fetch, then retry `extract:osm` later for trees / full tags.

Outputs in `public/data/`:

| File | Contents |
|------|----------|
| `river.geojson` | KML boundary + centerline + chainage |
| `buildings.geojson` | OSM building footprints + `height_source` |
| `roads.geojson` | OSM highways |
| `trees.geojson` | OSM `natural=tree` (+ tree_row samples) |
| `tree_rows.geojson` | OSM tree rows |
| `vegetation.geojson` | parks / forest / grass / scrub |
| `bridges.geojson` | bridge-tagged highways |
| `water_features.geojson` | supporting OSM water (does **not** replace KML river) |
| `feature_metadata.json` | IDs, tags, heights, sources |
| `kml_validation.json` | bbox, jumps, issues |
| `osm_*.geojson` | legacy aliases for the current runtime loaders |

## Height policy

| Priority | Buildings | Trees |
|----------|-----------|-------|
| 1 | OSM `height` → `OSM_HEIGHT` | OSM `height` → `OSM_TREE_HEIGHT` |
| 2 | `building:levels` × 3.1 → `ESTIMATED_FROM_BUILDING_LEVELS` | `est_height` → `OSM_EST_HEIGHT` |
| 3 | type / default → `DEFAULT_ESTIMATE` | visual estimate → `VISUAL_ESTIMATE` |

Estimated values are labelled and must not be presented as surveyed measurements.

## Runtime

`src/geo/load.js` loads the KML corridor, validates geometry, then loads OSM context into one shared frame and runs an alignment check (median building distance to the river). Large offsets are logged; features are not auto-shifted.

### Debug layers (UI → Layers)

- River / Bathymetry / Terrain / Bridges / Buildings / Roads / Trees
- Projection Validation
- OSM Alignment overlay

Inspect mode: click near a building or tree to show OSM ID, height, and `height_source`.

## Attribution

OpenStreetMap © contributors.
