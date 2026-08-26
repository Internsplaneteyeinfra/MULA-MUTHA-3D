#!/usr/bin/env python3
"""
Merge Overture / Microsoft Open Buildings into OSM buildings.geojson.

OSM footprints win on overlap (better tags + heights). Overture fills gaps
where OSM has roads but few buildings (common along Mula–Mutha).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"
OSM_PATH = OUT / "buildings.geojson"
OVERTURE_PATH = OUT / "_tmp" / "overture_buildings.geojson"
# Corridor AOI (slightly padded)
S, W, N, E = 18.512, 73.852, 18.555, 74.002
CELL = 0.00022  # ~24 m grid for near-duplicate skip
MIN_AREA_M2 = 18
MAX_AREA_M2 = 40000


def ring_centroid(ring):
    if not ring:
        return None
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def approx_area_m2(ring):
    """Shoelace in lon/lat → rough m² near Pune (~18.5°N)."""
    if not ring or len(ring) < 3:
        return 0.0
    n = len(ring)
    a = 0.0
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        a += x1 * y2 - x2 * y1
    a = abs(a) * 0.5
    lat = ring[0][1]
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(lat))
    return a * m_per_deg_lon * m_per_deg_lat


def cell_key(lon, lat):
    return (int(lon / CELL), int(lat / CELL))


def load_fc(path: Path):
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("features", [])


def osm_feature(f):
    """Normalize existing OSM feature (pass-through if already good)."""
    return f


def overture_to_feature(f, idx):
    geom = f.get("geometry") or {}
    if geom.get("type") != "Polygon":
        return None
    ring = geom.get("coordinates", [None])[0]
    if not ring or len(ring) < 4:
        return None
    lon, lat = ring_centroid(ring)
    if lon is None or not (W <= lon <= E and S <= lat <= N):
        return None
    area = approx_area_m2(ring)
    if area < MIN_AREA_M2 or area > MAX_AREA_M2:
        return None
    props = f.get("properties") or {}
    if props.get("is_underground"):
        return None
    sources = props.get("sources") or []
    dataset = "OVERTURE"
    for s in sources:
        ds = (s or {}).get("dataset") or ""
        if "Microsoft" in ds or "microsoft" in ds.lower():
            dataset = "MICROSOFT_OPEN_BUILDINGS"
            break
        if "Google" in ds or "google" in ds.lower():
            dataset = "GOOGLE_OPEN_BUILDINGS"
            break
    # Height estimate from footprint area (Pune low/mid-rise mix)
    if area < 80:
        h = 6.5
    elif area < 200:
        h = 9.0
    elif area < 500:
        h = 12.0
    elif area < 1200:
        h = 18.0
    else:
        h = 24.0
    return {
        "type": "Feature",
        "properties": {
            "osmId": f"overture-{idx}",
            "id": f"overture-{idx}",
            "building": "yes",
            "height": h,
            "height_source": "ESTIMATED_FROM_FOOTPRINT_AREA",
            "levels": None,
            "source": dataset,
            "area_m2": round(area, 1),
        },
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def main():
    osm = load_fc(OSM_PATH)
    overture = load_fc(OVERTURE_PATH)
    print(f"OSM buildings: {len(osm)}")
    print(f"Overture raw: {len(overture)}")

    # Prefer pure OSM features (drop prior overture fills if re-running)
    osm_only = [
        f
        for f in osm
        if not str((f.get("properties") or {}).get("osmId", "")).startswith("overture-")
        and not str((f.get("properties") or {}).get("source", "")).upper().startswith(
            ("MICROSOFT", "GOOGLE", "OVERTURE")
        )
    ]
    if not osm_only:
        osm_only = osm

    occupied = set()
    merged = []
    for f in osm_only:
        ring = (f.get("geometry") or {}).get("coordinates", [None])[0]
        c = ring_centroid(ring) if ring else None
        if c:
            occupied.add(cell_key(c[0], c[1]))
        props = f.setdefault("properties", {})
        props.setdefault("source", "OPENSTREETMAP")
        merged.append(osm_feature(f))

    added = 0
    skipped_overlap = 0
    skipped_filter = 0
    for i, f in enumerate(overture):
        feat = overture_to_feature(f, i)
        if not feat:
            skipped_filter += 1
            continue
        ring = feat["geometry"]["coordinates"][0]
        lon, lat = ring_centroid(ring)
        key = cell_key(lon, lat)
        # Skip if same cell or immediate neighbor already has a footprint
        i0, j0 = key
        clash = False
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                if (i0 + di, j0 + dj) in occupied:
                    clash = True
                    break
            if clash:
                break
        if clash:
            skipped_overlap += 1
            continue
        occupied.add(key)
        merged.append(feat)
        added += 1

    fc = {
        "type": "FeatureCollection",
        "name": "mula_mutha_buildings_osm_overture",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": merged,
    }
    OSM_PATH.write_text(json.dumps(fc), encoding="utf-8")
    # Keep legacy alias in sync
    legacy = OUT / "osm_buildings.geojson"
    legacy.write_text(json.dumps(fc), encoding="utf-8")
    print(f"Added Overture/MS fill: {added}")
    print(f"Skipped overlap: {skipped_overlap}, filtered: {skipped_filter}")
    print(f"Total written: {len(merged)} -> {OSM_PATH}")


if __name__ == "__main__":
    main()
