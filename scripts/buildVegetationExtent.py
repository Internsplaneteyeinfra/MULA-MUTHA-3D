#!/usr/bin/env python3
"""Build vegetation_extent GeoJSON (+ cleaned KML) from Mula–Mutha Vegetation Type KML."""

from __future__ import annotations

import json
import re
import shutil
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "data" / "hydrology" / "vegetation"

# Prefer bundled copy; fall back to Shweta_River-2.0 Sources.
CANDIDATES = [
    OUT_DIR / "vegetation_type_study_area.kml",
    ROOT / "public" / "data" / "vegetation_type_study_area.kml",
    Path(r"C:\Users\Sahil.Rajankar\Desktop\Shweta\Shweta_River-2.0\src\Sources\62862d940cba4d3ba7a0f5610cde1290.kml"),
]

# KML PolyStyle ABGR → legend
CLASS_COLORS = {
    "Non-Vegetation": "#A9A9A9",
    "Trees": "#228B22",
    "Shrub / Scrub": "#9ACD32",
    "Grass / Herbaceous": "#90EE90",
    "Mixed / Diverse": "#8A2BE2",
}


def abgr_to_hex(abgr: str) -> str | None:
    s = re.sub(r"[^0-9A-Fa-f]", "", abgr or "")
    if len(s) != 8:
        return None
    r, g, b = s[6:8], s[4:6], s[2:4]
    return f"#{r}{g}{b}".upper()


def normalize_class(name: str) -> str:
    n = re.sub(r"^\W+", "", str(name or "")).strip()
    n = re.sub(r"\s+\d+$", "", n).strip()
    for label in CLASS_COLORS:
        if n.lower() == label.lower() or n.lower().startswith(label.lower()):
            return label
    return n or "Unknown"


def parse_coords(blob: str) -> list[list[float]]:
    ring: list[list[float]] = []
    for tok in re.split(r"\s+", blob.strip()):
        if not tok:
            continue
        parts = tok.split(",")
        if len(parts) < 2:
            continue
        try:
            lon, lat = float(parts[0]), float(parts[1])
        except ValueError:
            continue
        ring.append([lon, lat])
    return ring


def parse_kml(text: str) -> list[dict]:
    # Style id → hex
    styles: dict[str, str] = {}
    for m in re.finditer(r'<Style\s+id="([^"]+)"[\s\S]*?</Style>', text, re.I):
        cm = re.search(
            r"<PolyStyle[\s\S]*?<color>\s*([0-9A-Fa-f]{8})\s*</color>",
            m.group(0),
            re.I,
        )
        if cm:
            hx = abgr_to_hex(cm.group(1))
            if hx:
                styles[m.group(1)] = hx

    features: list[dict] = []
    for i, pm in enumerate(re.finditer(r"<Placemark[\s\S]*?</Placemark>", text, re.I)):
        content = pm.group(0)
        name_m = re.search(r"<name>\s*([^<]*)\s*</name>", content, re.I)
        name = (name_m.group(1) if name_m else "").strip()
        style_m = re.search(r"<styleUrl>\s*#?([^<\s]+)\s*</styleUrl>", content, re.I)
        style_id = (style_m.group(1) if style_m else "").strip()
        outer = re.search(
            r"<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)</coordinates>",
            content,
            re.I,
        )
        if not outer:
            continue
        ring = parse_coords(outer.group(1))
        if len(ring) < 3:
            continue
        # close ring
        if ring[0] != ring[-1]:
            ring = ring + [ring[0]]
        label = normalize_class(name)
        color = CLASS_COLORS.get(label) or styles.get(style_id) or "#74c69d"
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "layer": "vegetation_extent",
                    "class": label,
                    "class_label": label,
                    "name": name or label,
                    "description": "Mula-Mutha Vegetation Type - Study Area",
                    "color": color,
                    "source": "vegetation_type_study_area.kml",
                },
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        )
    return features


def abgr(hexc: str, a: str = "c8") -> str:
    h = hexc.lstrip("#")
    return f"{a}{h[4:6]}{h[2:4]}{h[0:2]}"


def write_kml(features: list[dict], path: Path) -> None:
    styles = {
        label: (f"s_{label.replace(' / ', '_').replace(' ', '_').replace('-', '_')}", color)
        for label, color in CLASS_COLORS.items()
    }
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
        "<name>Mula-Mutha Vegetation Extent</name>",
    ]
    for label, (sid, color) in styles.items():
        lines.append(
            f'<Style id="{sid}"><LineStyle><color>{abgr(color, "ff")}</color><width>1</width></LineStyle>'
            f"<PolyStyle><color>{abgr(color)}</color></PolyStyle></Style>"
        )
    for f in features:
        label = f["properties"]["class_label"]
        sid = styles.get(label, styles["Mixed / Diverse"])[0]
        name = (
            str(f["properties"].get("name") or label)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
        )
        ring = f["geometry"]["coordinates"][0]
        coords = " ".join(f"{c[0]},{c[1]},0" for c in ring)
        lines.append(
            f"<Placemark><name>{name}</name><styleUrl>#{sid}</styleUrl>"
            f'<ExtendedData><Data name="class"><value>{label}</value></Data></ExtendedData>'
            f"<Polygon><outerBoundaryIs><LinearRing><coordinates>{coords}</coordinates>"
            f"</LinearRing></outerBoundaryIs></Polygon></Placemark>"
        )
    lines.append("</Document></kml>")
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    src = next((p for p in CANDIDATES if p.is_file()), None)
    if not src:
        print("ERROR: vegetation type KML not found in:")
        for p in CANDIDATES:
            print(f"  - {p}")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bundled = OUT_DIR / "vegetation_type_study_area.kml"
    if src.resolve() != bundled.resolve():
        shutil.copy2(src, bundled)
        print(f"copied source -> {bundled}")

    text = bundled.read_text(encoding="utf-8", errors="replace")
    features = parse_kml(text)
    if not features:
        print("ERROR: no polygon features parsed")
        return 1

    counts = Counter(f["properties"]["class_label"] for f in features)
    gj = {
        "type": "FeatureCollection",
        "name": "Mula-Mutha Vegetation Extent",
        "features": features,
    }
    (OUT_DIR / "vegetation_extent.geojson").write_text(json.dumps(gj), encoding="utf-8")
    write_kml(features, OUT_DIR / "vegetation_extent.kml")

    meta = {
        "source": "vegetation_type_study_area.kml",
        "sourceTitle": "Mula-Mutha Vegetation Type - Study Area",
        "features": len(features),
        "classes": dict(counts),
        "geojson": "/data/hydrology/vegetation/vegetation_extent.geojson",
        "kml": "/data/hydrology/vegetation/vegetation_extent.kml",
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"wrote {len(features)} features -> {OUT_DIR}")
    for k, v in sorted(counts.items()):
        print(f"  {v:3d}  {k}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
