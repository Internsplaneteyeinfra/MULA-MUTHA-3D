#!/usr/bin/env python3
"""Fetch OSM park/forest/vegetation polygons for the east corridor and merge."""
from __future__ import annotations

import json
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "data"
S, W, N, E = 18.515, 73.895, 18.553, 73.999
STEP_LON, STEP_LAT = 0.035, 0.018

GREEN_LANDUSE = {"forest", "grass", "orchard", "meadow", "village_green"}
GREEN_NATURAL = {"wood", "scrub", "heath"}


def tiles(s, w, n, e):
    lon = w
    while lon < e:
        lon2 = min(e, lon + STEP_LON)
        lat = s
        while lat < n:
            lat2 = min(n, lat + STEP_LAT)
            yield lat, lon, lat2, lon2
            lat = lat2
        lon = lon2


def fetch_bbox(s, w, n, e):
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={w},{s},{e},{n}"
    req = urllib.request.Request(
        url, headers={"User-Agent": "mula-mutha-cinematic/osm-veg/1.0"}
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def mid_lon(f):
    try:
        g = f["geometry"]
        if g["type"] == "Polygon":
            return g["coordinates"][0][0][0]
        return g["coordinates"][0][0]
    except Exception:
        return 0.0


def main():
    nodes = {}
    ways = {}
    tile_list = list(tiles(S, W, N, E))
    print(f"Fetching {len(tile_list)} east tiles for vegetation…")
    for i, (s, w, n, e) in enumerate(tile_list):
        try:
            raw = fetch_bbox(s, w, n, e)
            root = ET.fromstring(raw)
            for el in root:
                if el.tag == "node":
                    nodes[el.attrib["id"]] = (
                        float(el.attrib["lon"]),
                        float(el.attrib["lat"]),
                    )
                elif el.tag == "way":
                    tags = {}
                    refs = []
                    for c in el:
                        if c.tag == "nd":
                            refs.append(c.attrib["ref"])
                        elif c.tag == "tag":
                            tags[c.attrib["k"]] = c.attrib["v"]
                    ways[el.attrib["id"]] = {"nodes": refs, "tags": tags}
            print(f"  tile {i+1}/{len(tile_list)} ok")
        except Exception as ex:
            print(f"  tile {i+1}/{len(tile_list)} FAIL {ex}")

    new_green = []
    for wid, way in ways.items():
        tags = way["tags"]
        is_green = (
            tags.get("leisure") == "park"
            or tags.get("landuse") in GREEN_LANDUSE
            or tags.get("natural") in GREEN_NATURAL
        )
        if not is_green:
            continue
        coords = [nodes[r] for r in way["nodes"] if r in nodes]
        if len(coords) < 3:
            continue
        ring = list(coords)
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        if len(ring) < 4:
            continue
        oid = int(wid)
        new_green.append(
            {
                "type": "Feature",
                "properties": {
                    "osmId": oid,
                    "id": f"osm_green_{oid}",
                    "leisure": tags.get("leisure"),
                    "landuse": tags.get("landuse"),
                    "natural": tags.get("natural"),
                    "name": tags.get("name"),
                    "source": "OPENSTREETMAP",
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        )

    existing_path = OUT / "vegetation.geojson"
    existing = []
    if existing_path.exists():
        existing = json.loads(existing_path.read_text(encoding="utf-8")).get("features", [])
    by_id = {}
    for f in existing:
        oid = f.get("properties", {}).get("osmId")
        if oid is not None:
            by_id[int(oid)] = f
    added = 0
    for f in new_green:
        oid = int(f["properties"]["osmId"])
        if oid not in by_id:
            by_id[oid] = f
            added += 1
    merged = list(by_id.values())
    merged.sort(key=mid_lon)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "vegetation.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": merged}, ensure_ascii=False),
        encoding="utf-8",
    )
    (OUT / "osm_green.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": merged}, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"=== VEGETATION DONE === total={len(merged)} added={added} new_from_east={len(new_green)}")


if __name__ == "__main__":
    main()
