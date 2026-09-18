#!/usr/bin/env python3
"""Build hydrology vegetation_extent GeoJSON + KML from public/data/vegetation.geojson."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "data" / "vegetation.geojson"
OUT_DIR = ROOT / "public" / "data" / "hydrology" / "vegetation"

CLASS_MAP = {
    "wood": ("Trees", "#2d6a4f"),
    "forest": ("Trees", "#2d6a4f"),
    "scrub": ("Shrub / Scrub", "#52b788"),
    "grass": ("Grass / Herbaceous", "#95d5b2"),
    "park": ("Mixed / Diverse", "#74c69d"),
}


def classify(props: dict) -> tuple[str, str]:
    natural = (props.get("natural") or "").lower()
    landuse = (props.get("landuse") or "").lower()
    leisure = (props.get("leisure") or "").lower()
    for key in (natural, landuse, leisure):
        if key in CLASS_MAP:
            return CLASS_MAP[key]
    return ("Mixed / Diverse", "#74c69d")


def abgr(hexc: str, a: str = "c8") -> str:
    h = hexc.lstrip("#")
    return f"{a}{h[4:6]}{h[2:4]}{h[0:2]}"


def ring_coords(geom: dict | None) -> list:
    if not geom:
        return []
    if geom.get("type") == "Polygon":
        return [geom["coordinates"][0]]
    if geom.get("type") == "MultiPolygon":
        return [p[0] for p in geom["coordinates"]]
    return []


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    data = json.loads(SRC.read_text(encoding="utf-8"))
    features = []
    counts: dict[str, int] = {}
    for f in data.get("features") or []:
        props = dict(f.get("properties") or {})
        label, color = classify(props)
        counts[label] = counts.get(label, 0) + 1
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "layer": "vegetation_extent",
                    "class": label,
                    "class_label": label,
                    "name": props.get("name") or label,
                    "description": props.get("source") or "OPENSTREETMAP",
                    "color": color,
                    "osmId": props.get("osmId"),
                    "source": "vegetation.geojson",
                },
                "geometry": f.get("geometry"),
            }
        )

    gj = {
        "type": "FeatureCollection",
        "name": "Mula-Mutha Vegetation Extent",
        "features": features,
    }
    (OUT_DIR / "vegetation_extent.geojson").write_text(json.dumps(gj), encoding="utf-8")

    styles = {v[0]: (f"s_{v[0].replace(' / ', '_').replace(' ', '_')}", v[1]) for v in CLASS_MAP.values()}
    kml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
        "<name>Mula-Mutha Vegetation Extent</name>",
    ]
    for label, (sid, color) in styles.items():
        kml.append(
            f'<Style id="{sid}"><LineStyle><color>{abgr(color, "ff")}</color><width>1</width></LineStyle>'
            f"<PolyStyle><color>{abgr(color)}</color></PolyStyle></Style>"
        )

    for f in features:
        label = f["properties"]["class_label"]
        sid = styles[label][0]
        name = (
            str(f["properties"].get("name") or label)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
        )
        for ring in ring_coords(f.get("geometry")):
            if not ring or len(ring) < 3:
                continue
            coords = " ".join(f"{c[0]},{c[1]},0" for c in ring)
            kml.append(
                f"<Placemark><name>{name}</name><styleUrl>#{sid}</styleUrl>"
                f'<ExtendedData><Data name="class"><value>{label}</value></Data></ExtendedData>'
                f"<Polygon><outerBoundaryIs><LinearRing><coordinates>{coords}</coordinates>"
                f"</LinearRing></outerBoundaryIs></Polygon></Placemark>"
            )
    kml.append("</Document></kml>")
    (OUT_DIR / "vegetation_extent.kml").write_text("\n".join(kml), encoding="utf-8")

    meta = {
        "source": "public/data/vegetation.geojson",
        "features": len(features),
        "classes": counts,
        "geojson": "/data/hydrology/vegetation/vegetation_extent.geojson",
        "kml": "/data/hydrology/vegetation/vegetation_extent.kml",
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
