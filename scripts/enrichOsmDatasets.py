#!/usr/bin/env python3
"""
Offline enrich: convert existing osm_*.geojson into the KML-pipeline outputs
with height_source labels (no Overpass required).

Usage:
  python scripts/enrichOsmDatasets.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"


def parse_h(raw):
    if raw is None:
        return None
    try:
        return float(str(raw).lower().replace("m", "").strip())
    except ValueError:
        return None


def resolve_building(props):
    h = parse_h(props.get("heightM") or props.get("height"))
    if h and h > 1 and abs(h - 8.5) > 0.15:
        # treat non-default as OSM/estimated height already present
        if props.get("height_source"):
            return h, props["height_source"]
        return h, "OSM_HEIGHT"
    levels = props.get("levels") or props.get("building:levels")
    if levels is not None:
        try:
            return float(levels) * 3.1, "ESTIMATED_FROM_BUILDING_LEVELS"
        except ValueError:
            pass
    if h and h > 1:
        return h, props.get("height_source") or "DEFAULT_ESTIMATE"
    return 8.5, "DEFAULT_ESTIMATE"


def load_fc(name):
    p = OUT / name
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8")).get("features", [])


def write_fc(name, feats):
    (OUT / name).write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"  {name}: {len(feats)}")


def main():
    buildings_in = load_fc("osm_buildings.geojson")
    roads_in = load_fc("osm_roads.geojson")
    green_in = load_fc("osm_green.geojson")
    bridges_in = load_fc("bridges.geojson")
    trees_in = load_fc("trees.geojson")

    buildings = []
    meta = []
    for f in buildings_in:
        p = dict(f.get("properties") or {})
        h, src = resolve_building(p)
        p.update(
            {
                "id": f"osm_building_{p.get('osmId')}",
                "source": "OPENSTREETMAP",
                "heightM": h,
                "height_source": src,
            }
        )
        buildings.append({"type": "Feature", "properties": p, "geometry": f["geometry"]})
        meta.append(
            {
                "id": p["id"],
                "source": "OPENSTREETMAP",
                "osmId": p.get("osmId"),
                "geometry_type": "POLYGON",
                "height": h,
                "height_source": src,
            }
        )

    roads = []
    for f in roads_in:
        p = dict(f.get("properties") or {})
        p.update({"id": f"osm_road_{p.get('osmId')}", "source": "OPENSTREETMAP"})
        roads.append({"type": "Feature", "properties": p, "geometry": f["geometry"]})

    vegetation = []
    for f in green_in:
        p = dict(f.get("properties") or {})
        p.update({"id": f"osm_vegetation_{p.get('osmId')}", "source": "OPENSTREETMAP"})
        vegetation.append({"type": "Feature", "properties": p, "geometry": f["geometry"]})

    write_fc("buildings.geojson", buildings)
    write_fc("roads.geojson", roads)
    write_fc("vegetation.geojson", vegetation)
    if not trees_in:
        write_fc("trees.geojson", [])
        write_fc("tree_rows.geojson", [])
    else:
        write_fc("trees.geojson", trees_in)
    write_fc("water_features.geojson", [])

    # Keep bridges as-is (already used by runtime)
    print(f"  bridges.geojson: {len(bridges_in)} (unchanged)")

    (OUT / "feature_metadata.json").write_text(
        json.dumps(
            {
                "generated_by": "enrichOsmDatasets.py",
                "note": "Enriched from existing osm_*.geojson (Overpass offline). Re-run extractOsmFromKml.py when network allows for trees/full tags.",
                "counts": {
                    "buildings": len(buildings),
                    "roads": len(roads),
                    "vegetation": len(vegetation),
                    "bridges": len(bridges_in),
                    "trees": len(trees_in),
                },
                "features": meta[:5000],
                "attribution": "OpenStreetMap © contributors",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print("  feature_metadata.json written")
    print("Done.")


if __name__ == "__main__":
    main()
