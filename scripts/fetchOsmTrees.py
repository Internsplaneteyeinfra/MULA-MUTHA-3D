#!/usr/bin/env python3
"""Fetch OSM natural=tree (+ tree_row samples) via Map API for the full river corridor."""
from __future__ import annotations

import json
import math
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "data"
# Full Mula–Mutha corridor (matches KML + ~600 m buffer)
S, W, N, E = 18.515, 73.849, 18.553, 73.999
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
        url, headers={"User-Agent": "mula-mutha-cinematic/osm-trees/1.0"}
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def resolve_tree_height(tags: dict, seed: int = 0) -> tuple[float, str]:
    for key, src in (("height", "OSM_TREE_HEIGHT"), ("est_height", "OSM_EST_HEIGHT")):
        raw = tags.get(key)
        if raw is None:
            continue
        try:
            h = float(str(raw).lower().replace("m", "").strip())
            if h > 0.5:
                return h, src
        except ValueError:
            pass
    base = 7.5 + ((seed % 17) - 8) * 0.35
    return max(4.0, min(18.0, base)), "VISUAL_ESTIMATE"


def sample_line(coords, spacing_m=8.0):
    """Sample points along lon/lat line ~every spacing_m meters."""
    if len(coords) < 2:
        return []
    out = [coords[0]]
    carry = 0.0
    for i in range(1, len(coords)):
        lon0, lat0 = coords[i - 1]
        lon1, lat1 = coords[i]
        # rough meters
        dx = (lon1 - lon0) * 111320 * math.cos(math.radians((lat0 + lat1) * 0.5))
        dy = (lat1 - lat0) * 110540
        seg = math.hypot(dx, dy)
        if seg < 1e-3:
            continue
        t = spacing_m - carry
        while t < seg:
            k = t / seg
            out.append((lon0 + (lon1 - lon0) * k, lat0 + (lat1 - lat0) * k))
            t += spacing_m
        carry = (carry + seg) % spacing_m
    if out[-1] != coords[-1]:
        out.append(coords[-1])
    return out


def main():
    nodes = {}
    ways = {}
    tile_list = list(tiles(S, W, N, E))
    print(f"Fetching {len(tile_list)} corridor tiles for trees…")
    ok = 0
    for i, (s, w, n, e) in enumerate(tile_list):
        try:
            raw = fetch_bbox(s, w, n, e)
            root = ET.fromstring(raw)
            for el in root:
                if el.tag == "node":
                    tags = {c.attrib["k"]: c.attrib["v"] for c in el if c.tag == "tag"}
                    nodes[el.attrib["id"]] = {
                        "lon": float(el.attrib["lon"]),
                        "lat": float(el.attrib["lat"]),
                        "tags": tags,
                    }
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

    trees = []
    tree_rows = []
    seen = set()

    # Individual tree nodes
    for nid, node in nodes.items():
        tags = node["tags"]
        if tags.get("natural") != "tree":
            continue
        th, tsrc = resolve_tree_height(tags, int(nid) if str(nid).isdigit() else 0)
        oid = int(nid) if str(nid).isdigit() else nid
        key = ("node", oid)
        if key in seen:
            continue
        seen.add(key)
        trees.append(
            {
                "type": "Feature",
                "properties": {
                    "osmId": oid,
                    "id": f"osm_tree_{oid}",
                    "natural": "tree",
                    "tree_height": th,
                    "height_source": tsrc,
                    "genus": tags.get("genus"),
                    "species": tags.get("species"),
                    "circumference": tags.get("circumference"),
                    "diameter_crown": tags.get("diameter_crown"),
                    "source": "OPENSTREETMAP",
                },
                "geometry": {"type": "Point", "coordinates": [node["lon"], node["lat"]]},
            }
        )

    # Tree rows → line + sampled points
    for wid, way in ways.items():
        tags = way["tags"]
        if tags.get("natural") != "tree_row":
            continue
        coords = []
        for r in way["nodes"]:
            if r in nodes:
                coords.append((nodes[r]["lon"], nodes[r]["lat"]))
        if len(coords) < 2:
            continue
        oid = int(wid)
        tree_rows.append(
            {
                "type": "Feature",
                "properties": {
                    "osmId": oid,
                    "id": f"osm_tree_row_{oid}",
                    "natural": "tree_row",
                    "source": "OPENSTREETMAP",
                },
                "geometry": {"type": "LineString", "coordinates": [[c[0], c[1]] for c in coords]},
            }
        )
        samples = sample_line(coords, spacing_m=8.0)
        for i, (lon, lat) in enumerate(samples):
            th, tsrc = resolve_tree_height(tags, oid + i)
            sid = f"{oid}_{i}"
            key = ("row", sid)
            if key in seen:
                continue
            seen.add(key)
            trees.append(
                {
                    "type": "Feature",
                    "properties": {
                        "osmId": f"row_{sid}",
                        "id": f"osm_tree_row_{sid}",
                        "natural": "tree",
                        "from_tree_row": True,
                        "tree_height": th,
                        "height_source": tsrc,
                        "genus": tags.get("genus"),
                        "species": tags.get("species"),
                        "source": "OPENSTREETMAP",
                    },
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                }
            )

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "trees.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": trees}, ensure_ascii=False),
        encoding="utf-8",
    )
    (OUT / "tree_rows.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": tree_rows}, ensure_ascii=False),
        encoding="utf-8",
    )

    def lon_of(f):
        return f["geometry"]["coordinates"][0]

    west = e90 = e93 = 0
    for f in trees:
        lon = lon_of(f)
        if lon > 73.93:
            e93 += 1
        elif lon > 73.90:
            e90 += 1
        else:
            west += 1

    print("=== TREES DONE ===")
    print(f"trees={len(trees)} tree_rows={len(tree_rows)}")
    print(f"west<73.90={west} | 73.90-73.93={e90} | east>73.93={e93}")


if __name__ == "__main__":
    main()
