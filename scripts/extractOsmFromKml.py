#!/usr/bin/env python3
"""
KML-master OSM extraction for mula-mutha-cinematic.

1. Parse & validate KML (lon,lat order — never swapped)
2. Build buffered corridor / bbox around the FULL river
3. Query Overpass for buildings, roads, trees, vegetation, bridges, water
4. Write GeoJSON datasets + feature_metadata.json with height_source labels

Usage:
  python scripts/extractOsmFromKml.py
  python scripts/extractOsmFromKml.py --kml public/data/Mula_Mutha_Chainage_Analysis.kml --buffer 500
"""

from __future__ import annotations

import argparse
import json
import math
import re
import urllib.parse
import urllib.request
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"
DEFAULT_KML = OUT / "Mula_Mutha_Chainage_Analysis.kml"
DEFAULT_BUFFER_M = 500

MIRRORS = [
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]

NS = {"kml": "http://www.opengis.net/kml/2.2"}

ROAD_W = {
    "motorway": 14,
    "trunk": 12,
    "primary": 10,
    "secondary": 8,
    "tertiary": 7,
    "residential": 5.5,
    "unclassified": 5,
    "service": 3.5,
    "footway": 2.2,
    "path": 2.0,
    "cycleway": 2.5,
    "living_street": 5,
}


# ─── KML parse / validate ───────────────────────────────────────────────────


def local(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def parse_coord_token(tok: str) -> dict | None:
    parts = tok.strip().split(",")
    if len(parts) < 2:
        return None
    try:
        lon = float(parts[0])
        lat = float(parts[1])
        alt = float(parts[2]) if len(parts) > 2 and parts[2] else 0.0
    except ValueError:
        return None
    if not math.isfinite(lon) or not math.isfinite(lat):
        return None
    return {"lon": lon, "lat": lat, "alt": alt}


def parse_coordinates_text(raw: str) -> list[dict]:
    return [p for tok in raw.split() if (p := parse_coord_token(tok))]


def parse_kml(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    # Strip default xmlns so ElementTree matching is simpler
    text_ns = re.sub(r'\sxmlns="[^"]+"', "", text, count=1)
    root = ET.fromstring(text_ns)

    polygons: list[dict] = []
    lines: list[dict] = []
    points: list[dict] = []
    placemarks: list[dict] = []

    for pm in root.iter("Placemark"):
        name_el = pm.find("name")
        name = (name_el.text or "").strip() if name_el is not None else ""
        desc_el = pm.find("description")
        desc = (desc_el.text or "").strip() if desc_el is not None else ""

        for poly in pm.iter("Polygon"):
            for coords_el in poly.iter("coordinates"):
                pts = parse_coordinates_text(coords_el.text or "")
                if len(pts) >= 4:
                    polygons.append({"name": name, "points": pts})
                    placemarks.append({"name": name, "type": "Polygon", "n": len(pts)})

        for ls in pm.iter("LineString"):
            for coords_el in ls.iter("coordinates"):
                pts = parse_coordinates_text(coords_el.text or "")
                if len(pts) >= 2:
                    lines.append({"name": name, "points": pts})
                    placemarks.append({"name": name, "type": "LineString", "n": len(pts)})

        for pt in pm.iter("Point"):
            for coords_el in pt.iter("coordinates"):
                pts = parse_coordinates_text(coords_el.text or "")
                if pts:
                    points.append({"name": name, "point": pts[0], "description": desc})
                    placemarks.append({"name": name, "type": "Point", "n": 1})

    # Also catch MultiGeometry children already covered by iter above
    return {
        "path": str(path),
        "polygons": polygons,
        "lines": lines,
        "points": points,
        "placemarks": placemarks,
        "raw_bytes": len(text),
    }


def haversine_m(a: dict, b: dict) -> float:
    r = 6371000.0
    p1 = math.radians(a["lat"])
    p2 = math.radians(b["lat"])
    dphi = math.radians(b["lat"] - a["lat"])
    dl = math.radians(b["lon"] - a["lon"])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def validate_kml(parsed: dict) -> dict:
    all_pts: list[dict] = []
    for poly in parsed["polygons"]:
        all_pts.extend(poly["points"])
    for line in parsed["lines"]:
        all_pts.extend(line["points"])
    for p in parsed["points"]:
        all_pts.append(p["point"])

    issues: list[str] = []
    if not all_pts:
        issues.append("No coordinates found in KML")
        return {
            "ok": False,
            "issues": issues,
            "bbox": None,
            "point_count": 0,
            "duplicates": 0,
            "jumps": [],
        }

    lons = [p["lon"] for p in all_pts]
    lats = [p["lat"] for p in all_pts]
    bbox = {
        "minLon": min(lons),
        "maxLon": max(lons),
        "minLat": min(lats),
        "maxLat": max(lats),
    }

    # Coordinate order sanity: India / Pune region ≈ lon 73–74, lat 18–19
    swapped_hint = 0
    for p in all_pts[:50]:
        if 17 < p["lon"] < 20 and 72 < p["lat"] < 75:
            swapped_hint += 1
    if swapped_hint > 10:
        issues.append(
            "SUSPICIOUS: many points look like lat,lon swapped "
            "(values resemble Pune lat in lon field). KML must be lon,lat,alt."
        )

    # Out of India-ish range
    for p in all_pts:
        if not (60 <= p["lon"] <= 100 and 5 <= p["lat"] <= 40):
            issues.append(
                f"Coordinate outside expected South-Asia range: lon={p['lon']}, lat={p['lat']}"
            )
            break

    # Duplicates
    seen = set()
    dup = 0
    for p in all_pts:
        key = (round(p["lon"], 7), round(p["lat"], 7))
        if key in seen:
            dup += 1
        else:
            seen.add(key)

    # Discontinuities on longest line (centerline candidate)
    jumps = []
    longest = max(parsed["lines"], key=lambda L: len(L["points"]), default=None)
    if longest and len(longest["points"]) >= 3:
        for i in range(1, len(longest["points"])):
            d = haversine_m(longest["points"][i - 1], longest["points"][i])
            if d > 250:  # >250 m between consecutive centerline verts
                jumps.append(
                    {
                        "index": i,
                        "distance_m": round(d, 1),
                        "from": longest["points"][i - 1],
                        "to": longest["points"][i],
                        "line_name": longest.get("name"),
                    }
                )
        if jumps:
            issues.append(
                f"Reported {len(jumps)} large centerline jump(s) (>250 m) — "
                "coordinates NOT silently moved; inspect KML."
            )

    # Prefer named centerline
    centerline = None
    for line in parsed["lines"]:
        if "centerline" in (line.get("name") or "").lower():
            centerline = line
            break
    if centerline is None:
        centerline = longest

    river_poly = parsed["polygons"][0] if parsed["polygons"] else None

    # Chainage points N+MMM
    chainage = []
    for p in parsed["points"]:
        m = re.match(r"^(\d+)\+(\d+)$", p.get("name") or "")
        if not m:
            continue
        km, meters = int(m.group(1)), int(m.group(2))
        chainage.append(
            {
                "label": f"{km}+{str(meters).zfill(3)}",
                "meters": km * 1000 + meters,
                "lon": p["point"]["lon"],
                "lat": p["point"]["lat"],
            }
        )
    chainage.sort(key=lambda c: c["meters"])

    return {
        "ok": len([i for i in issues if i.startswith("SUSPICIOUS")]) == 0 and bool(all_pts),
        "issues": issues,
        "bbox": bbox,
        "point_count": len(all_pts),
        "duplicates": dup,
        "jumps": jumps,
        "centerline": centerline,
        "river_polygon": river_poly,
        "chainage": chainage,
        "placemark_count": len(parsed["placemarks"]),
    }


def buffer_bbox(bbox: dict, buffer_m: float) -> tuple[float, float, float, float]:
    """Return south, west, north, east for Overpass."""
    mid_lat = (bbox["minLat"] + bbox["maxLat"]) / 2
    dlat = buffer_m / 111_320.0
    dlon = buffer_m / (111_320.0 * max(0.2, math.cos(math.radians(mid_lat))))
    s = bbox["minLat"] - dlat
    n = bbox["maxLat"] + dlat
    w = bbox["minLon"] - dlon
    e = bbox["maxLon"] + dlon
    return s, w, n, e


# ─── Height resolution ──────────────────────────────────────────────────────


def parse_height_tag(raw) -> float | None:
    if raw is None:
        return None
    try:
        return float(str(raw).lower().replace("m", "").replace(" ", "").strip())
    except ValueError:
        return None


def resolve_building_height(tags: dict) -> tuple[float, str]:
    h = parse_height_tag(tags.get("height"))
    if h and h > 1:
        return h, "OSM_HEIGHT"
    levels = tags.get("building:levels")
    if levels is not None:
        try:
            return float(levels) * 3.1, "ESTIMATED_FROM_BUILDING_LEVELS"
        except ValueError:
            pass
    btype = (tags.get("building") or "yes").lower()
    defaults = {
        "house": 7.0,
        "detached": 7.0,
        "apartments": 15.0,
        "residential": 9.0,
        "commercial": 10.0,
        "retail": 8.0,
        "industrial": 9.0,
        "warehouse": 9.0,
        "school": 10.0,
        "yes": 8.5,
    }
    return defaults.get(btype, 8.5), "DEFAULT_ESTIMATE"


def resolve_tree_height(tags: dict, seed: int = 0) -> tuple[float, str]:
    h = parse_height_tag(tags.get("height"))
    if h and h > 0.5:
        return h, "OSM_TREE_HEIGHT"
    h = parse_height_tag(tags.get("est_height"))
    if h and h > 0.5:
        return h, "OSM_EST_HEIGHT"
    # Controlled variation when missing — not surveyed
    base = 7.5 + ((seed % 17) - 8) * 0.35
    return max(4.0, min(18.0, base)), "VISUAL_ESTIMATE"


# ─── Overpass ────────────────────────────────────────────────────────────────


def fetch_overpass(query: str) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for url in MIRRORS:
        try:
            print("  Overpass:", url)
            req = urllib.request.Request(
                url,
                data=body,
                headers={"User-Agent": "mula-mutha-cinematic/osm-extract/1.0"},
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read()
                print(f"  ok {len(raw):,} bytes")
                return json.loads(raw)
        except Exception as e:
            last = e
            print("  fail", e)
    raise RuntimeError(f"All Overpass mirrors failed: {last}")


def build_query(s: float, w: float, n: float, e: float) -> str:
    return f"""[out:json][timeout:180];
(
  way["building"]({s},{w},{n},{e});
  relation["building"]({s},{w},{n},{e});
  way["highway"]({s},{w},{n},{e});
  way["bridge"]({s},{w},{n},{e});
  way["highway"]["bridge"]({s},{w},{n},{e});
  node["natural"="tree"]({s},{w},{n},{e});
  way["natural"="tree_row"]({s},{w},{n},{e});
  way["natural"~"^(wood|scrub|heath)$"]({s},{w},{n},{e});
  way["landuse"~"^(forest|grass|orchard|meadow|village_green)$"]({s},{w},{n},{e});
  way["leisure"="park"]({s},{w},{n},{e});
  way["waterway"]({s},{w},{n},{e});
  way["natural"="water"]({s},{w},{n},{e});
  relation["natural"="water"]({s},{w},{n},{e});
);
out body;
>;
out skel qt;
"""


def index_elements(j: dict):
    nodes = {}
    ways = []
    relations = []
    for el in j.get("elements", []):
        t = el.get("type")
        if t == "node":
            nodes[el["id"]] = el
        elif t == "way":
            ways.append(el)
        elif t == "relation":
            relations.append(el)
    return nodes, ways, relations


def way_coords(way, nodes) -> list[list[float]]:
    coords = []
    for nid in way.get("nodes", []):
        n = nodes.get(nid)
        if n and "lon" in n and "lat" in n:
            coords.append([n["lon"], n["lat"]])
    return coords


def close_ring(coords: list) -> list:
    if len(coords) < 3:
        return coords
    if coords[0] != coords[-1]:
        return coords + [coords[0]]
    return coords


def feature(fid, props, geom):
    return {
        "type": "Feature",
        "id": fid,
        "properties": props,
        "geometry": geom,
    }


def convert_osm(j: dict, corridor_meta: dict) -> dict:
    nodes, ways, relations = index_elements(j)
    buildings, roads, trees, tree_rows, vegetation, bridges, water = (
        [],
        [],
        [],
        [],
        [],
        [],
        [],
    )
    metadata = []
    seen_ways = set()

    for way in ways:
        wid = way["id"]
        if wid in seen_ways:
            continue
        seen_ways.add(wid)
        tags = way.get("tags") or {}
        coords = way_coords(way, nodes)
        if len(coords) < 2:
            continue

        # Bridges (highway + bridge tag)
        if tags.get("bridge") and tags.get("bridge") != "no" and "highway" in tags:
            props = {
                "id": f"osm_bridge_{wid}",
                "source": "OPENSTREETMAP",
                "osmId": wid,
                "name": tags.get("name"),
                "highway": tags.get("highway"),
                "bridge": tags.get("bridge"),
                "layer": tags.get("layer"),
                "widthM": ROAD_W.get(tags.get("highway"), 8),
                "tags": tags,
            }
            bridges.append(
                feature(
                    props["id"],
                    props,
                    {"type": "LineString", "coordinates": coords},
                )
            )
            metadata.append(meta_entry(props, "LINESTRING", coords))

        if "highway" in tags:
            hw = tags["highway"]
            width = parse_height_tag(tags.get("width")) or ROAD_W.get(hw, 5)
            lanes = tags.get("lanes")
            if lanes and not tags.get("width"):
                try:
                    width = max(width, float(lanes) * 3.2)
                except ValueError:
                    pass
            props = {
                "id": f"osm_road_{wid}",
                "source": "OPENSTREETMAP",
                "osmId": wid,
                "highway": hw,
                "name": tags.get("name"),
                "widthM": width,
                "lanes": lanes,
                "bridge": tags.get("bridge"),
                "tunnel": tags.get("tunnel"),
                "tags": tags,
            }
            roads.append(
                feature(props["id"], props, {"type": "LineString", "coordinates": coords})
            )
            metadata.append(meta_entry(props, "LINESTRING", coords))

        if "building" in tags:
            ring = close_ring(coords)
            if len(ring) < 4:
                continue
            h, src = resolve_building_height(tags)
            props = {
                "id": f"osm_building_{wid}",
                "source": "OPENSTREETMAP",
                "osmId": wid,
                "building": tags.get("building"),
                "name": tags.get("name"),
                "heightM": h,
                "height_source": src,
                "levels": tags.get("building:levels"),
                "roof_height": tags.get("roof:height"),
                "material": tags.get("building:material") or tags.get("material"),
                "addr_street": tags.get("addr:street"),
                "addr_housenumber": tags.get("addr:housenumber"),
                "tags": tags,
            }
            buildings.append(
                feature(props["id"], props, {"type": "Polygon", "coordinates": [ring]})
            )
            metadata.append(meta_entry(props, "POLYGON", ring, height=h, height_source=src))

        if tags.get("natural") == "tree_row":
            props = {
                "id": f"osm_tree_row_{wid}",
                "source": "OPENSTREETMAP",
                "osmId": wid,
                "natural": "tree_row",
                "tags": tags,
            }
            tree_rows.append(
                feature(props["id"], props, {"type": "LineString", "coordinates": coords})
            )
            # Sample trees along row (~8 m spacing)
            for i, c in enumerate(sample_along(coords, 8.0)):
                th, tsrc = resolve_tree_height(tags, wid + i)
                tprops = {
                    "id": f"osm_tree_row_{wid}_{i}",
                    "source": "OPENSTREETMAP",
                    "osmId": wid,
                    "natural": "tree",
                    "from_tree_row": True,
                    "tree_height": th,
                    "height_source": tsrc,
                    "genus": tags.get("genus"),
                    "species": tags.get("species"),
                }
                trees.append(
                    feature(
                        tprops["id"],
                        tprops,
                        {"type": "Point", "coordinates": [c[0], c[1]]},
                    )
                )
                metadata.append(
                    meta_entry(tprops, "POINT", [c], height=th, height_source=tsrc)
                )

        if (
            tags.get("natural") in {"wood", "scrub", "heath"}
            or tags.get("landuse") in {"forest", "grass", "orchard", "meadow", "village_green"}
            or tags.get("leisure") == "park"
        ):
            ring = close_ring(coords)
            if len(ring) < 4:
                continue
            props = {
                "id": f"osm_vegetation_{wid}",
                "source": "OPENSTREETMAP",
                "osmId": wid,
                "natural": tags.get("natural"),
                "landuse": tags.get("landuse"),
                "leisure": tags.get("leisure"),
                "name": tags.get("name"),
                "tags": tags,
            }
            vegetation.append(
                feature(props["id"], props, {"type": "Polygon", "coordinates": [ring]})
            )
            metadata.append(meta_entry(props, "POLYGON", ring))

        if "waterway" in tags or tags.get("natural") == "water":
            geom_type = "Polygon" if tags.get("natural") == "water" and len(coords) >= 4 else "LineString"
            gcoords = [close_ring(coords)] if geom_type == "Polygon" else coords
            props = {
                "id": f"osm_water_{wid}",
                "source": "OPENSTREETMAP",
                "osmId": wid,
                "waterway": tags.get("waterway"),
                "natural": tags.get("natural"),
                "name": tags.get("name"),
                "note": "Supporting OSM water — KML remains authoritative river",
                "tags": tags,
            }
            water.append(
                feature(
                    props["id"],
                    props,
                    {"type": geom_type, "coordinates": gcoords},
                )
            )
            metadata.append(meta_entry(props, geom_type, coords))

    # Individual trees (nodes)
    for nid, n in nodes.items():
        tags = n.get("tags") or {}
        if tags.get("natural") != "tree":
            continue
        if "lon" not in n:
            continue
        th, tsrc = resolve_tree_height(tags, nid)
        props = {
            "id": f"osm_tree_{nid}",
            "source": "OPENSTREETMAP",
            "osmId": nid,
            "natural": "tree",
            "tree_height": th,
            "height_source": tsrc,
            "genus": tags.get("genus"),
            "species": tags.get("species"),
            "circumference": tags.get("circumference"),
            "diameter_crown": tags.get("diameter_crown"),
            "tags": tags,
        }
        trees.append(
            feature(
                props["id"],
                props,
                {"type": "Point", "coordinates": [n["lon"], n["lat"]]},
            )
        )
        metadata.append(
            meta_entry(
                props,
                "POINT",
                [[n["lon"], n["lat"]]],
                height=th,
                height_source=tsrc,
            )
        )

    return {
        "buildings": buildings,
        "roads": roads,
        "trees": trees,
        "tree_rows": tree_rows,
        "vegetation": vegetation,
        "bridges": bridges,
        "water_features": water,
        "metadata": metadata,
        "corridor": corridor_meta,
    }


def meta_entry(props, geom_type, coords, height=None, height_source=None):
    entry = {
        "id": props.get("id"),
        "source": props.get("source", "OPENSTREETMAP"),
        "osmId": props.get("osmId"),
        "geometry_type": geom_type,
        "original_coordinates": coords[:8] if isinstance(coords, list) else coords,
        "tags": props.get("tags"),
    }
    if height is not None:
        entry["height"] = height
        entry["height_source"] = height_source
    return entry


def sample_along(coords: list, spacing_m: float) -> list:
    if len(coords) < 2:
        return coords
    out = [coords[0]]
    acc = 0.0
    for i in range(1, len(coords)):
        a = {"lon": coords[i - 1][0], "lat": coords[i - 1][1]}
        b = {"lon": coords[i][0], "lat": coords[i][1]}
        seg = haversine_m(a, b)
        if seg < 1e-3:
            continue
        acc += seg
        while acc >= spacing_m:
            t = 1.0 - (acc - spacing_m) / seg
            out.append(
                [
                    coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
                    coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
                ]
            )
            acc -= spacing_m
    return out


def fc(features):
    return {"type": "FeatureCollection", "features": features}


def write_json(path: Path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    print(f"  wrote {path.name} ({len(obj.get('features', obj) if isinstance(obj, dict) else obj)})")


def river_geojson(validation: dict) -> dict:
    feats = []
    poly = validation.get("river_polygon")
    if poly:
        ring = [[p["lon"], p["lat"]] for p in poly["points"]]
        if ring and ring[0] != ring[-1]:
            ring.append(ring[0])
        feats.append(
            feature(
                "kml_river_boundary",
                {
                    "id": "kml_river_boundary",
                    "source": "KML",
                    "name": poly.get("name") or "River Boundary",
                    "authoritative": True,
                },
                {"type": "Polygon", "coordinates": [ring]},
            )
        )
    cl = validation.get("centerline")
    if cl:
        line = [[p["lon"], p["lat"]] for p in cl["points"]]
        feats.append(
            feature(
                "kml_river_centerline",
                {
                    "id": "kml_river_centerline",
                    "source": "KML",
                    "name": cl.get("name") or "River Centerline",
                    "authoritative": True,
                },
                {"type": "LineString", "coordinates": line},
            )
        )
    for c in validation.get("chainage") or []:
        feats.append(
            feature(
                f"kml_chainage_{c['label']}",
                {
                    "id": f"kml_chainage_{c['label']}",
                    "source": "KML",
                    "chainage": c["label"],
                    "meters": c["meters"],
                },
                {"type": "Point", "coordinates": [c["lon"], c["lat"]]},
            )
        )
    return fc(feats)


def bridges_legacy(bridges_feats: list) -> dict:
    """Compat shape for existing loadOsmBridges (expects LineString + properties)."""
    out = []
    for f in bridges_feats:
        p = f["properties"]
        coords = f["geometry"]["coordinates"]
        out.append(
            {
                "type": "Feature",
                "properties": {
                    "osmId": p.get("osmId"),
                    "name": p.get("name") or f"Bridge {p.get('osmId')}",
                    "highway": p.get("highway"),
                    "widthM": p.get("widthM", 10),
                },
                "geometry": {"type": "LineString", "coordinates": coords},
            }
        )
    return fc(out)


def buildings_legacy(buildings: list) -> dict:
    out = []
    for f in buildings:
        p = f["properties"]
        out.append(
            {
                "type": "Feature",
                "properties": {
                    "osmId": p.get("osmId"),
                    "building": p.get("building"),
                    "name": p.get("name"),
                    "heightM": p.get("heightM"),
                    "height_source": p.get("height_source"),
                    "levels": p.get("levels"),
                    "material": p.get("material"),
                },
                "geometry": f["geometry"],
            }
        )
    return fc(out)


def roads_legacy(roads: list) -> dict:
    out = []
    for f in roads:
        p = f["properties"]
        out.append(
            {
                "type": "Feature",
                "properties": {
                    "osmId": p.get("osmId"),
                    "highway": p.get("highway"),
                    "name": p.get("name"),
                    "widthM": p.get("widthM"),
                },
                "geometry": f["geometry"],
            }
        )
    return fc(out)


def green_legacy(vegetation: list) -> dict:
    out = []
    for f in vegetation:
        p = f["properties"]
        out.append(
            {
                "type": "Feature",
                "properties": {
                    "osmId": p.get("osmId"),
                    "leisure": p.get("leisure"),
                    "landuse": p.get("landuse"),
                    "natural": p.get("natural"),
                    "name": p.get("name"),
                },
                "geometry": f["geometry"],
            }
        )
    return fc(out)


def main():
    ap = argparse.ArgumentParser(description="KML-master OSM corridor extraction")
    ap.add_argument("--kml", type=Path, default=DEFAULT_KML)
    ap.add_argument("--buffer", type=float, default=DEFAULT_BUFFER_M, help="Corridor buffer meters")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--skip-fetch", action="store_true", help="Validate KML + write river only")
    args = ap.parse_args()

    print("=== STEP 1: Parse & validate KML ===")
    if not args.kml.exists():
        raise SystemExit(f"KML not found: {args.kml}")
    parsed = parse_kml(args.kml)
    validation = validate_kml(parsed)
    print("  points:", validation["point_count"])
    print("  bbox:", validation["bbox"])
    print("  duplicates:", validation["duplicates"])
    print("  placemarks:", validation["placemark_count"])
    print("  chainage:", len(validation.get("chainage") or []))
    for issue in validation["issues"]:
        print("  ISSUE:", issue)
    if not validation["bbox"]:
        raise SystemExit("Cannot continue without valid KML bbox")

    print(f"=== STEP 2: Corridor buffer {args.buffer} m ===")
    s, w, n, e = buffer_bbox(validation["bbox"], args.buffer)
    print(f"  Overpass bbox S,W,N,E = {s:.6f},{w:.6f},{n:.6f},{e:.6f}")

    args.out.mkdir(parents=True, exist_ok=True)
    write_json(args.out / "river.geojson", river_geojson(validation))
    write_json(
        args.out / "kml_validation.json",
        {
            "ok": validation["ok"],
            "issues": validation["issues"],
            "bbox": validation["bbox"],
            "duplicates": validation["duplicates"],
            "jumps": validation["jumps"],
            "buffer_m": args.buffer,
            "extraction_bbox": {"south": s, "west": w, "north": n, "east": e},
            "kml": str(args.kml),
            "coordinate_order": "longitude, latitude, altitude",
            "note": "KML geometry is authoritative; coordinates were not moved.",
        },
    )

    if args.skip_fetch:
        print("Skipped OSM fetch (--skip-fetch)")
        return

    print("=== STEP 3: Download OSM features ===")
    q = build_query(s, w, n, e)
    osm = fetch_overpass(q)
    (args.out / "osm_raw.json").write_text(json.dumps(osm), encoding="utf-8")

    corridor_meta = {
        "buffer_m": args.buffer,
        "bbox_kml": validation["bbox"],
        "bbox_extract": {"south": s, "west": w, "north": n, "east": e},
        "kml": str(args.kml.name),
    }
    converted = convert_osm(osm, corridor_meta)

    print("=== STEP 4–9: Write datasets ===")
    write_json(args.out / "buildings.geojson", fc(converted["buildings"]))
    write_json(args.out / "roads.geojson", fc(converted["roads"]))
    write_json(args.out / "trees.geojson", fc(converted["trees"]))
    write_json(args.out / "tree_rows.geojson", fc(converted["tree_rows"]))
    write_json(args.out / "vegetation.geojson", fc(converted["vegetation"]))
    write_json(args.out / "bridges.geojson", bridges_legacy(converted["bridges"]))
    write_json(args.out / "water_features.geojson", fc(converted["water_features"]))
    write_json(
        args.out / "feature_metadata.json",
        {
            "generated_by": "extractOsmFromKml.py",
            "corridor": corridor_meta,
            "counts": {
                "buildings": len(converted["buildings"]),
                "roads": len(converted["roads"]),
                "trees": len(converted["trees"]),
                "tree_rows": len(converted["tree_rows"]),
                "vegetation": len(converted["vegetation"]),
                "bridges": len(converted["bridges"]),
                "water_features": len(converted["water_features"]),
            },
            "features": converted["metadata"],
            "height_policy": {
                "buildings": "height > levels*3.1 > type default; height_source labelled",
                "trees": "height > est_height > visual estimate; never claimed as surveyed",
            },
            "attribution": "OpenStreetMap © contributors",
        },
    )

    # Backward-compatible aliases used by current runtime loaders
    write_json(args.out / "osm_buildings.geojson", buildings_legacy(converted["buildings"]))
    write_json(args.out / "osm_roads.geojson", roads_legacy(converted["roads"]))
    write_json(args.out / "osm_green.geojson", green_legacy(converted["vegetation"]))

    print("=== DONE ===")
    summary = dict(converted["corridor"])
    summary["counts"] = {
        "buildings": len(converted["buildings"]),
        "roads": len(converted["roads"]),
        "trees": len(converted["trees"]),
        "vegetation": len(converted["vegetation"]),
        "bridges": len(converted["bridges"]),
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
