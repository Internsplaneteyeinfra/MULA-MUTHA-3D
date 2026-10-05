#!/usr/bin/env python3
"""
Rebuild public/data/buildings.geojson and roads.geojson from live OpenStreetMap
for the project extent. Geometry is copied from OSM nodes unchanged (WGS84).

Buildings: every building way + building multipolygon relation (outer rings).
Gap-fill footprints already in the file (Google / Microsoft / Overture) are kept
only where they do not overlap an OSM footprint.
Roads: every highway way except non-built / indoor classes.

Usage: python scripts/rebuildOsmBuildingsRoads.py
"""
from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

ROAD_W = {
    "motorway": 14, "trunk": 12, "primary": 10, "secondary": 8.5, "tertiary": 7,
    "motorway_link": 7, "trunk_link": 7, "primary_link": 6.5, "secondary_link": 6, "tertiary_link": 5.5,
    "residential": 5.5, "unclassified": 5, "living_street": 5, "road": 5, "service": 3.5,
    "track": 3, "pedestrian": 3, "cycleway": 2.2, "footway": 2, "path": 1.6, "steps": 2,
}
SKIP_HIGHWAY = {"proposed", "construction", "abandoned", "disused", "platform", "corridor",
                "elevator", "bus_stop", "razed", "no", "via_ferrata"}


def fetch(query: str) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for url in MIRRORS:
        try:
            print("overpass", url, flush=True)
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "rivereye-osm-rebuild/1.0"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read())
        except Exception as e:  # try next mirror
            last = e
            print("  failed:", e, flush=True)
    raise RuntimeError(f"Overpass unavailable: {last}")


def load_fc(name: str):
    p = OUT / name
    return json.loads(p.read_text(encoding="utf-8")).get("features", []) if p.exists() else []


def bbox_of(feats, pad=0.0):
    xs, ys = [], []
    for f in feats:
        g = f["geometry"]
        pts = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"]
        for p in pts:
            xs.append(p[0]); ys.append(p[1])
    return min(ys) - pad, min(xs) - pad, max(ys) + pad, max(xs) + pad


def parse_m(v):
    if v is None:
        return None
    try:
        return float(str(v).lower().replace("m", "").strip().split(";")[0])
    except ValueError:
        return None


def building_props(oid, tags, osm_type="way"):
    h = parse_m(tags.get("height"))
    levels = parse_m(tags.get("building:levels"))
    if h and h > 1:
        height, src = h, "OSM_HEIGHT"
    elif levels and levels > 0:
        height, src = levels * 3.1, "ESTIMATED_FROM_BUILDING_LEVELS"
    else:
        height, src = 8.5, "DEFAULT_ESTIMATE"
    key = oid if osm_type == "way" else f"r{oid}"
    return {
        "osmId": key,
        "id": f"osm_building_{key}",
        "osm_type": osm_type,
        "building": tags.get("building"),
        "name": tags.get("name"),
        "levels": tags.get("building:levels"),
        "heightM": round(height, 2),
        "height_source": src,
        "amenity": tags.get("amenity"),
        "addr_street": tags.get("addr:street"),
        "addr_housenumber": tags.get("addr:housenumber"),
        "source": "OPENSTREETMAP",
    }


def closed(coords):
    if len(coords) >= 3 and coords[0] != coords[-1]:
        coords = coords + [coords[0]]
    return coords


def assemble_rings(segments):
    """Join relation member ways (lists of [lon,lat]) into closed rings."""
    segs = [s[:] for s in segments if len(s) >= 2]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[::-1][1:]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append(ring)
    return rings


def point_in(pt, ring):
    x, y = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]; xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-15) + xi:
            inside = not inside
        j = i
    return inside


def centroid(ring):
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


BUILDING_EXTENT = (18.511365, 73.8516319, 18.5553915, 74.0020193)
ROAD_EXTENT = (18.51337, 73.84927, 18.58059, 73.99866)


def inside(extent, lon, lat):
    s, w, n, e = extent
    return s <= lat <= n and w <= lon <= e


def main():
    old_b = load_fc("buildings.geojson")
    S = min(BUILDING_EXTENT[0], ROAD_EXTENT[0])
    W = min(BUILDING_EXTENT[1], ROAD_EXTENT[1])
    N = max(BUILDING_EXTENT[2], ROAD_EXTENT[2])
    E = max(BUILDING_EXTENT[3], ROAD_EXTENT[3])
    print(f"buildings extent {BUILDING_EXTENT}\nroads extent {ROAD_EXTENT}")

    live = fetch(f"""[out:json][timeout:280];
(
  way["building"]({S},{W},{N},{E});
  relation["building"]({S},{W},{N},{E});
  way["highway"]({S},{W},{N},{E});
);
out geom;""")

    buildings, roads = [], []
    osm_rings = []
    for el in live["elements"]:
        tags = el.get("tags") or {}
        if el["type"] == "way" and "building" in tags:
            coords = closed([[p["lon"], p["lat"]] for p in el.get("geometry", []) if p])
            if len(coords) < 4 or not inside(BUILDING_EXTENT, *centroid(coords)):
                continue
            buildings.append({"type": "Feature", "properties": building_props(el["id"], tags),
                              "geometry": {"type": "Polygon", "coordinates": [coords]}})
            osm_rings.append(coords)
        elif el["type"] == "relation" and "building" in tags:
            outers = [[[p["lon"], p["lat"]] for p in m.get("geometry", []) if p]
                      for m in el.get("members", []) if m.get("type") == "way" and m.get("role") in ("outer", "")]
            for k, ring in enumerate(assemble_rings(outers)):
                if not inside(BUILDING_EXTENT, *centroid(ring)):
                    continue
                props = building_props(el["id"], tags, "relation")
                if k:
                    props["osmId"] = f"{props['osmId']}_{k}"
                    props["id"] = f"osm_building_{props['osmId']}"
                buildings.append({"type": "Feature", "properties": props,
                                  "geometry": {"type": "Polygon", "coordinates": [ring]}})
                osm_rings.append(ring)
        elif el["type"] == "way" and "highway" in tags:
            hw = tags.get("highway")
            if hw in SKIP_HIGHWAY or tags.get("area") == "yes":
                continue
            coords = [[p["lon"], p["lat"]] for p in el.get("geometry", []) if p]
            if len(coords) < 2 or not any(inside(ROAD_EXTENT, lon, lat) for lon, lat in coords):
                continue
            roads.append({"type": "Feature", "properties": {
                "osmId": el["id"],
                "id": f"osm_road_{el['id']}",
                "highway": hw,
                "name": tags.get("name"),
                "widthM": parse_m(tags.get("width")) or ROAD_W.get(hw, 5),
                "bridge": tags.get("bridge"),
                "tunnel": tags.get("tunnel"),
                "layer": tags.get("layer"),
                "oneway": tags.get("oneway"),
                "source": "OPENSTREETMAP",
            }, "geometry": {"type": "LineString", "coordinates": coords}})

    # Gap-fill footprints survive only where no OSM footprint covers them.
    CELL = 0.0005
    grid = {}
    for idx, ring in enumerate(osm_rings):
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        for gx in range(int(min(xs) / CELL), int(max(xs) / CELL) + 1):
            for gy in range(int(min(ys) / CELL), int(max(ys) / CELL) + 1):
                grid.setdefault((gx, gy), []).append(idx)
    kept_fill = dropped_fill = 0
    for f in old_b:
        src = str(f["properties"].get("source", "")).upper()
        if src == "OPENSTREETMAP":
            continue
        ring = f["geometry"]["coordinates"][0]
        c = centroid(ring)
        cands = grid.get((int(c[0] / CELL), int(c[1] / CELL)), [])
        clash = any(point_in(c, osm_rings[i]) or point_in(centroid(osm_rings[i]), ring) for i in cands)
        if clash:
            dropped_fill += 1
            continue
        kept_fill += 1
        buildings.append(f)

    for name, feats in (("buildings.geojson", buildings), ("roads.geojson", roads)):
        (OUT / name).write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False),
                                encoding="utf-8")
    osm_count = sum(1 for f in buildings if f["properties"].get("source") == "OPENSTREETMAP")
    print(f"buildings.geojson: {len(buildings)} ({osm_count} OSM, {kept_fill} gap-fill kept, {dropped_fill} gap-fill dropped as duplicates)")
    print(f"roads.geojson: {len(roads)}")


if __name__ == "__main__":
    main()
