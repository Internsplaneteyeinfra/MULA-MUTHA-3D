"""Fetch OSM context via the official map API (no Overpass)."""
import json
import math
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path("public/data")
# Tight corridor around river
S, W, N, E = 18.5205, 73.8545, 18.5475, 73.9940

ROAD_W = {
    "motorway": 14, "trunk": 12, "primary": 10, "secondary": 8,
    "tertiary": 7, "residential": 5.5, "unclassified": 5, "service": 3.5,
}


def tiles(s, w, n, e, step_lon=0.04, step_lat=0.02):
    lon = w
    while lon < e:
        lat = s
        lon2 = min(e, lon + step_lon)
        while lat < n:
            lat2 = min(n, lat + step_lat)
            yield lat, lon, lat2, lon2
            lat = lat2
        lon = lon2


def fetch_bbox(s, w, n, e):
    url = f"https://api.openstreetmap.org/api/0.6/map?bbox={w},{s},{e},{n}"
    print("GET", url)
    req = urllib.request.Request(url, headers={"User-Agent": "mula-mutha-cinematic/1.0"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read()


def parse_osm(xml_bytes, nodes, ways):
    root = ET.fromstring(xml_bytes)
    for el in root:
        if el.tag == "node":
            nodes[el.attrib["id"]] = (float(el.attrib["lon"]), float(el.attrib["lat"]))
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


def main():
    nodes = {}
    ways = {}
    for i, (s, w, n, e) in enumerate(tiles(S, W, N, E)):
        try:
            raw = fetch_bbox(s, w, n, e)
            parse_osm(raw, nodes, ways)
            print(f"tile {i} ok nodes={len(nodes)} ways={len(ways)}")
        except Exception as exc:
            print(f"tile {i} fail", exc)

    roads, buildings, green = [], [], []
    for wid, way in ways.items():
        tags = way["tags"]
        coords = [nodes[r] for r in way["nodes"] if r in nodes]
        if len(coords) < 2:
            continue
        if "highway" in tags and tags["highway"] in ROAD_W:
            roads.append({
                "type": "Feature",
                "properties": {
                    "osmId": int(wid),
                    "highway": tags.get("highway"),
                    "name": tags.get("name"),
                    "widthM": ROAD_W.get(tags["highway"], 5),
                },
                "geometry": {"type": "LineString", "coordinates": coords},
            })
        elif "building" in tags:
            ring = list(coords)
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            if len(ring) < 4:
                continue
            levels = tags.get("building:levels")
            height = tags.get("height")
            h = None
            if height:
                try:
                    h = float(str(height).replace("m", "").strip())
                except ValueError:
                    h = None
            if h is None and levels:
                try:
                    h = float(levels) * 3.1
                except ValueError:
                    h = None
            buildings.append({
                "type": "Feature",
                "properties": {
                    "osmId": int(wid),
                    "building": tags.get("building"),
                    "name": tags.get("name"),
                    "heightM": h if h and h > 1 else 8.5,
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            })
        elif tags.get("leisure") == "park" or tags.get("landuse") in {
            "grass", "forest", "meadow", "orchard", "village_green"
        } or tags.get("natural") in {"wood", "scrub"}:
            ring = list(coords)
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            if len(ring) < 4:
                continue
            green.append({
                "type": "Feature",
                "properties": {
                    "osmId": int(wid),
                    "leisure": tags.get("leisure"),
                    "landuse": tags.get("landuse"),
                    "natural": tags.get("natural"),
                    "name": tags.get("name"),
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            })

    buildings = buildings[:4500]
    OUT.mkdir(parents=True, exist_ok=True)
    for name, feats in [
        ("osm_roads.geojson", roads),
        ("osm_buildings.geojson", buildings),
        ("osm_green.geojson", green),
    ]:
        (OUT / name).write_text(
            json.dumps({"type": "FeatureCollection", "features": feats}),
            encoding="utf-8",
        )
        print(name, len(feats))


if __name__ == "__main__":
    main()
