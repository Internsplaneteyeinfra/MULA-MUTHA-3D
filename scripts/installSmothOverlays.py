#!/usr/bin/env python3
"""Install smoothed GroundOverlay KMZs from src/data/Smoth kmls into public/data/hydrology."""

from __future__ import annotations

import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "src" / "data" / "Smoth kmls"
HYDRO = ROOT / "public" / "data" / "hydrology"
ASSETS = ROOT / "src" / "assets" / "hydrology"

# Prefer non-duplicate bank erosion kmz
LAYERS = [
    {
        "id": "geology",
        "kmz": "Lithology.kmz",
        "out_dir": HYDRO / "geology",
        "max_edge": 8192,
        "source": "Smoth kmls/Lithology.kmz",
    },
    {
        "id": "bank_erosion",
        "kmz": "bank_erosion_hotspot_smoothed.kmz",
        "out_dir": HYDRO / "bank_erosion",
        "max_edge": 8192,
        "source": "Smoth kmls/bank_erosion_hotspot_smoothed.kmz",
        "also_assets": True,
    },
    {
        "id": "water_quality_ndci",
        "kmz": "NDCI_smoothed.kmz",
        "out_dir": HYDRO / "water_quality" / "ndci",
        "max_edge": 8192,
        "source": "Smoth kmls/NDCI_smoothed.kmz",
    },
    {
        "id": "water_quality_tss",
        "kmz": "TSS_smoothed.kmz",
        "out_dir": HYDRO / "water_quality" / "tss",
        "max_edge": 8192,
        "source": "Smoth kmls/TSS_smoothed.kmz",
    },
    {
        "id": "salinity",
        "kmz": "salinity_smoothed.kmz",
        "out_dir": HYDRO / "water_quality" / "salinity",
        "max_edge": 8192,
        "source": "Smoth kmls/salinity_smoothed.kmz",
    },
]


def parse_latlon_box(kml: str) -> dict[str, float]:
    def num(tag: str) -> float:
        m = re.search(rf"<{tag}>\s*([-\d.]+)\s*</{tag}>", kml, re.I)
        if not m:
            raise ValueError(f"missing LatLonBox/{tag}")
        return float(m.group(1))

    return {
        "north": num("north"),
        "south": num("south"),
        "east": num("east"),
        "west": num("west"),
    }


def save_resized(src: Path, dest: Path, max_edge: int) -> tuple[int, int]:
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    scale = min(1.0, max_edge / max(w, h))
    if scale < 1.0:
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, format="PNG", optimize=True)
    return im.size


def install_one(spec: dict) -> dict:
    kmz_path = SRC_DIR / spec["kmz"]
    if not kmz_path.is_file():
        raise FileNotFoundError(kmz_path)

    tmp = ROOT / "tmp" / f"install_{spec['id']}"
    if tmp.exists():
        shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(kmz_path, "r") as zf:
        zf.extractall(tmp)

    # Find doc.kml / overlay / legend anywhere in the unzip tree
    kml_path = next(tmp.rglob("*.kml"))
    overlay_src = next(tmp.rglob("overlay.png"))
    legend_src = next(tmp.rglob("legend.png"), None)
    kml_text = kml_path.read_text(encoding="utf-8", errors="replace")
    bounds = parse_latlon_box(kml_text)

    out = Path(spec["out_dir"])
    out.mkdir(parents=True, exist_ok=True)
    ow, oh = save_resized(overlay_src, out / "overlay.png", int(spec["max_edge"]))
    if legend_src and legend_src.is_file():
        shutil.copy2(legend_src, out / "legend.png")

    # Keep a local copy of the smoothed KMZ for reference (optional)
    shutil.copy2(kmz_path, out / Path(spec["kmz"]).name)

    meta = {
        "id": spec["id"],
        "source": spec["source"],
        "sourceKmz": spec["kmz"],
        "bounds": bounds,
        "overlayWidth": ow,
        "overlayHeight": oh,
        "overlayUrl": f"/data/hydrology/{out.relative_to(HYDRO).as_posix()}/overlay.png",
        "legendUrl": f"/data/hydrology/{out.relative_to(HYDRO).as_posix()}/legend.png",
        "smoothed": True,
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    if spec.get("also_assets"):
        ASSETS.mkdir(parents=True, exist_ok=True)
        shutil.copy2(out / "overlay.png", ASSETS / "bank_erosion_overlay.png")
        if (out / "legend.png").is_file():
            shutil.copy2(out / "legend.png", ASSETS / "bank_erosion_legend.png")

    return meta


def main() -> int:
    if not SRC_DIR.is_dir():
        print(f"ERROR: missing {SRC_DIR}")
        return 1
    wanted = set(sys.argv[1:]) if len(sys.argv) > 1 else None
    results = []
    for spec in LAYERS:
        if wanted and spec["id"] not in wanted and Path(spec["kmz"]).stem not in wanted:
            continue
        print(f"installing {spec['id']} from {spec['kmz']} ...")
        meta = install_one(spec)
        results.append(meta)
        print(
            f"  ok bounds=N{meta['bounds']['north']:.4f} "
            f"overlay={meta['overlayWidth']}x{meta['overlayHeight']}"
        )
    if not results:
        print("ERROR: no layers installed (check ids / kmz names)")
        return 1
    print(f"done {len(results)} layers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
