"""Try multiple Overpass endpoints with a compact bbox query."""
import json
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path("public/data")
BBOX = (18.5205, 73.8545, 18.5475, 73.9940)  # s,w,n,e — tight river corridor

MIRRORS = [
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

ROAD_W = {
    "motorway": 14, "trunk": 12, "primary": 10, "secondary": 8,
    "tertiary": 7, "residential": 5.5, "unclassified": 5, "service": 3.5,
}


def fetch_query(q: str) -> dict:
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for url in MIRRORS:
        try:
            print("try", url)
            req = urllib.request.Request(
                url, data=body, headers={"User-Agent": "mula-mutha-cinematic/1.0"}
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read()
                print("ok", url, len(raw))
                return json.loads(raw)
        except Exception as e:
            last = e
            print("fail", url, e)
    raise RuntimeError(last)


def to_features(j: dict):
    nodes = {}
    ways = []
    for el in j.get("elements", []):
        if el["type"] == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])
        elif el["type"] == "way":
            ways.append(el)

    roads, buildings, green = [], [], []
    seen = set()
    for way in ways:
        if way["id"] in seen:
            continue
        seen.add(way["id"])
        tags = way.get("tags") or {}
        coords = [nodes[i] for i in way.get("nodes", []) if i in nodes]
        if len(coords) < 2:
            continue
        if "highway" in tags:
            roads.append({
                "type": "Feature",
                "properties": {
                    "osmId": way["id"],
                    "highway": tags.get("highway"),
                    "name": tags.get("name"),
                    "widthM": ROAD_W.get(tags.get("highway"), 5),
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
                    "osmId": way["id"],
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
                    "osmId": way["id"],
                    "leisure": tags.get("leisure"),
                    "landuse": tags.get("landuse"),
                    "natural": tags.get("natural"),
                    "name": tags.get("name"),
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            })
    return roads, buildings[:4500], green


def main():
    s, w, n, e = BBOX
    q = f"""[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]({s},{w},{n},{e});
  way["building"]({s},{w},{n},{e});
  way["leisure"="park"]({s},{w},{n},{e});
  way["landuse"~"^(grass|forest|meadow|orchard|village_green)$"]({s},{w},{n},{e});
  way["natural"~"^(wood|scrub)$"]({s},{w},{n},{e});
);
out body;
>;
out skel qt;
"""
    j = fetch_query(q)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "osm_raw.json").write_text(json.dumps(j), encoding="utf-8")
    roads, buildings, green = to_features(j)
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
