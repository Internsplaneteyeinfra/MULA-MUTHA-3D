#!/usr/bin/env python3
"""Extract base64 GroundOverlays from src/data vegetation KMLs into public/data."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "data"
OUT = ROOT / "public" / "data" / "hydrology" / "vegetation"
OUT.mkdir(parents=True, exist_ok=True)

LAYERS = [
    ("vegetation_type.kml", "vegetation_type_overlay.png", "vegetation_type"),
    ("vegetation_health.kml", "vegetation_health_overlay.png", "vegetation_health"),
]


def extract_one(src_name: str, png_name: str, key: str) -> dict | None:
    src = SRC / src_name
    if not src.exists():
        print(f"skip missing {src}")
        return None
    text = src.read_text(encoding="utf-8", errors="replace")
    go = re.search(
        r"<(?:\w+:)?GroundOverlay[\s\S]*?</(?:\w+:)?GroundOverlay>",
        text,
        re.I,
    )
    if not go:
        print(f"no GroundOverlay in {src_name}")
        return None
    chunk = go.group(0)

    def num(tag: str) -> float:
        m = re.search(rf"<(?:\w+:)?{tag}>\s*([-\d.]+)\s*</(?:\w+:)?{tag}>", chunk, re.I)
        if not m:
            raise ValueError(f"missing {tag}")
        return float(m.group(1))

    bounds = {
        "north": num("north"),
        "south": num("south"),
        "east": num("east"),
        "west": num("west"),
    }
    href = re.search(
        r"<(?:\w+:)?href>\s*([\s\S]*?)</(?:\w+:)?href>",
        chunk,
        re.I,
    )
    if not href:
        print(f"no href in {src_name}")
        return None
    raw = href.group(1).strip()
    m = re.match(r"data:image/(png|jpeg|jpg);base64,(.+)$", raw, re.I | re.S)
    if not m:
        print(f"href is not base64 image in {src_name}")
        return None
    data = base64.b64decode(re.sub(r"\s+", "", m.group(2)))
    out_png = OUT / png_name
    out_png.write_bytes(data)
    # Keep a lightweight source pointer (not the multi-MB base64 KML)
    meta = {
        "id": key,
        "source": f"src/data/{src_name}",
        "overlay": f"/data/hydrology/vegetation/{png_name}",
        "bounds": bounds,
        "bytes": len(data),
    }
    (OUT / f"{key}_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"ok {key}: {out_png.relative_to(ROOT)} ({len(data)//1024} KB) bounds={bounds}")
    return meta


def main() -> int:
    metas = []
    for src_name, png_name, key in LAYERS:
        m = extract_one(src_name, png_name, key)
        if m:
            metas.append(m)
    # Prefer type overlay as the vegetation extent raster companion.
    summary = {"layers": metas}
    (OUT / "overlays_index.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    # Refresh meta.json used by the app when present
    if metas:
        type_meta = next((m for m in metas if m["id"] == "vegetation_type"), metas[0])
        app_meta = {
            "source": type_meta["source"],
            "overlay": type_meta["overlay"],
            "bounds": type_meta["bounds"],
            "layers": metas,
        }
        (OUT / "meta.json").write_text(json.dumps(app_meta, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
