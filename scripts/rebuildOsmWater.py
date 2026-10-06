#!/usr/bin/env python3
"""Fetch live OSM water polygons for the Mula-Mutha LULC bounds."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data" / "osm_water.geojson"

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

# LULC 2026 LatLonBox (WGS84)
SOUTH, WEST, NORTH, EAST = 18.509203857291638, 73.84988078051396, 18.56235850242967, 73.9963853971848

QUERY = f"""
[out:json][timeout:180];
(
  way["natural"="water"]({SOUTH},{WEST},{NORTH},{EAST});
  way["waterway"="riverbank"]({SOUTH},{WEST},{NORTH},{EAST});
  way["water"="river"]({SOUTH},{WEST},{NORTH},{EAST});
  way["water"="reservoir"]({SOUTH},{WEST},{NORTH},{EAST});
  way["water"="canal"]({SOUTH},{WEST},{NORTH},{EAST});
  way["landuse"="reservoir"]({SOUTH},{WEST},{NORTH},{EAST});
  way["natural"="wetland"]({SOUTH},{WEST},{NORTH},{EAST});
  rel["natural"="water"]({SOUTH},{WEST},{NORTH},{EAST});
  rel["waterway"="riverbank"]({SOUTH},{WEST},{NORTH},{EAST});
  rel["type"="multipolygon"]["natural"="water"]({SOUTH},{WEST},{NORTH},{EAST});
  rel["type"="multipolygon"]["waterway"="riverbank"]({SOUTH},{WEST},{NORTH},{EAST});
);
out geom;
"""


def fetch(query: str) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for url in MIRRORS:
        try:
            print("overpass", url, flush=True)
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "rivereye-osm-water/1.0"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
            print("  failed:", e, flush=True)
    raise RuntimeError(f"Overpass unavailable: {last}")


def ring_from_geom(geom):
    ring = []
    for n in geom or []:
        lon, lat = n.get("lon"), n.get("lat")
        if lon is None or lat is None:
            continue
        ring.append([lon, lat])
    if len(ring) >= 3 and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring if len(ring) >= 4 else None


def centroid(ring):
    xs = [p[0] for p in ring[:-1]]
    ys = [p[1] for p in ring[:-1]]
    return sum(ys) / len(ys), sum(xs) / len(xs)


def in_extent(lat, lon):
    return SOUTH <= lat <= NORTH and WEST <= lon <= EAST


def main():
    data = fetch(QUERY)
    feats = []
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        kind = tags.get("natural") or tags.get("waterway") or tags.get("water") or tags.get("landuse") or "water"
        if el["type"] == "way":
            ring = ring_from_geom(el.get("geometry"))
            if not ring:
                continue
            lat, lon = centroid(ring)
            if not in_extent(lat, lon):
                continue
            feats.append({
                "type": "Feature",
                "properties": {
                    "osmId": el["id"],
                    "id": f"w{el['id']}",
                    "kind": kind,
                    "name": tags.get("name"),
                    "source": "OPENSTREETMAP",
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            })
        elif el["type"] == "relation":
            for i, mem in enumerate(el.get("members") or []):
                if mem.get("role") not in (None, "", "outer"):
                    continue
                ring = ring_from_geom(mem.get("geometry"))
                if not ring:
                    continue
                lat, lon = centroid(ring)
                if not in_extent(lat, lon):
                    continue
                feats.append({
                    "type": "Feature",
                    "properties": {
                        "osmId": f"r{el['id']}",
                        "id": f"r{el['id']}_{i}",
                        "kind": kind,
                        "name": tags.get("name"),
                        "source": "OPENSTREETMAP",
                    },
                    "geometry": {"type": "Polygon", "coordinates": [ring]},
                })
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), encoding="utf-8")
    print("wrote", OUT, "features", len(feats), "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
