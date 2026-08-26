#!/usr/bin/env python3
"""Fetch OSM buildings for the east corridor (lon > ~73.90) via Map API and merge."""
from __future__ import annotations

import json
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "data"
# East of current building coverage
S, W, N, E = 18.515, 73.895, 18.553, 73.999
STEP_LON, STEP_LAT = 0.035, 0.018


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
        url, headers={"User-Agent": "mula-mutha-cinematic/east-buildings/1.0"}
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def parse_height(tags):
    h = None
    if tags.get("height"):
        try:
            h = float(str(tags["height"]).lower().replace("m", "").strip())
        except ValueError:
            h = None
    src = "OSM_HEIGHT"
    if h is None and tags.get("building:levels"):
        try:
            h = float(tags["building:levels"]) * 3.1
            src = "ESTIMATED_FROM_BUILDING_LEVELS"
        except ValueError:
            h = None
    if h is None or h <= 1:
        return 8.5, "DEFAULT_ESTIMATE"
    return h, src


def load_features(name):
    p = OUT / name
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8")).get("features", [])


def mid_lon(f):
    try:
        return f["geometry"]["coordinates"][0][0][0]
    except Exception:
        return 0.0


def main():
    nodes = {}
    ways = {}
    tile_list = list(tiles(S, W, N, E))
    print(f"Fetching {len(tile_list)} east tiles…")
    ok = 0
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
                    wid = el.attrib["id"]
                    tags = {}
                    refs = []
                    for c in el:
                        if c.tag == "nd":
                            refs.append(c.attrib["ref"])
                        elif c.tag == "tag":
                            tags[c.attrib["k"]] = c.attrib["v"]
                    ways[wid] = {"nodes": refs, "tags": tags}
            ok += 1
            print(f"  tile {i+1}/{len(tile_list)} ok nodes={len(nodes)} ways={len(ways)}")
        except Exception as ex:
            print(f"  tile {i+1}/{len(tile_list)} FAIL {ex}")

    print(f"Tiles ok: {ok}/{len(tile_list)}")

    new_buildings = []
    for wid, way in ways.items():
        tags = way["tags"]
        if "building" not in tags:
            continue
        coords = [nodes[r] for r in way["nodes"] if r in nodes]
        if len(coords) < 3:
            continue
        ring = list(coords)
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        if len(ring) < 4:
            continue
        h, src = parse_height(tags)
        osm_id = int(wid)
        new_buildings.append(
            {
                "type": "Feature",
                "properties": {
                    "osmId": osm_id,
                    "building": tags.get("building"),
                    "name": tags.get("name"),
                    "heightM": h,
                    "id": f"osm_building_{osm_id}",
                    "source": "OPENSTREETMAP",
                    "height_source": src,
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        )

    print(f"New east buildings from OSM: {len(new_buildings)}")

    existing = load_features("buildings.geojson") or load_features("osm_buildings.geojson")
    by_id = {}
    for f in existing:
        oid = f.get("properties", {}).get("osmId")
        if oid is None:
            continue
        p = dict(f["properties"])
        p.setdefault("height_source", "DEFAULT_ESTIMATE")
        p.setdefault("id", f"osm_building_{oid}")
        p.setdefault("source", "OPENSTREETMAP")
        p.setdefault("heightM", 8.5)
        nf = dict(f)
        nf["properties"] = p
        by_id[int(oid)] = nf

    added = 0
    for f in new_buildings:
        oid = int(f["properties"]["osmId"])
        if oid not in by_id:
            by_id[oid] = f
            added += 1

    merged = list(by_id.values())
    merged.sort(key=mid_lon)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "buildings.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": merged}, ensure_ascii=False),
        encoding="utf-8",
    )
    legacy = []
    for f in merged:
        p = f["properties"]
        legacy.append(
            {
                "type": "Feature",
                "properties": {
                    "osmId": p.get("osmId"),
                    "building": p.get("building"),
                    "name": p.get("name"),
                    "heightM": p.get("heightM", 8.5),
                },
                "geometry": f["geometry"],
            }
        )
    (OUT / "osm_buildings.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": legacy}, ensure_ascii=False),
        encoding="utf-8",
    )

    west = e90 = e93 = 0
    for f in merged:
        lon = mid_lon(f)
        if lon > 73.93:
            e93 += 1
        elif lon > 73.90:
            e90 += 1
        else:
            west += 1

    print("=== MERGE DONE ===")
    print(f"total={len(merged)} added={added}")
    print(f"west<73.90={west} | 73.90-73.93={e90} | east>73.93={e93}")


if __name__ == "__main__":
    main()
