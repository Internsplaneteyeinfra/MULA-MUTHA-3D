#!/usr/bin/env python3
"""Upload silt classification + volume KMZs to the KML smoother API and
bake overlay.png / legend.png into public/data/hydrology/silt/…"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow required: pip install pillow", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "src" / "data" / "Jan_2026_to_Jun_2026_Silt_Classification"
OUT_ROOT = ROOT / "public" / "data" / "hydrology" / "silt"
API = "http://localhost:8000/smooth"

# App legend colors (hydrologyLayer SILT_CLASS_CLASSES).
CLASS_TARGETS = [
    ((68, 206, 27), (46, 204, 113)),    # Low → #2ECC71
    ((206, 221, 84), (168, 224, 16)),   # Moderate → #A8E010
    ((243, 181, 73), (243, 156, 18)),   # High → #F39C12
    ((229, 31, 31), (231, 76, 60)),     # Very High → #E74C3C
]

CLASS_FILES = {
    "2026-01": "Jan_2026_Silt_Classification.kmz",
    "2026-02": "Feb_2026_Silt_Classification.kmz",
    "2026-03": "Mar_2026_Silt_Classification.kmz",
    "2026-04": "Apr_2026_Silt_Classification.kmz",
    "2026-05": "May_2026_Silt_Classification.kmz",
    "2026-06": "Jun_2026_Silt_Classification.kmz",
    "2026-07": "Jul_2026_Silt_Classification__1_.kmz",
}

VOLUME_FILES = {
    "2026-01": "Jan_2026_Silt_Volume_Surface__1_.kmz",
    "2026-02": "Feb_2026_Silt_Volume_Surface.kmz",
    "2026-03": "Mar_2026_Silt_Volume_Surface.kmz",
    "2026-04": "Apr_2026_Silt_Volume_Surface.kmz",
    "2026-05": "May_2026_Silt_Volume_Surface.kmz",
    "2026-06": "Jun_2026_Silt_Volume_Surface.kmz",
    "2026-07": "Jul_2026_Silt_Volume_Surface__1_.kmz",
}

LATLON_RE = re.compile(
    r"<north>([^<]+)</north>\s*<south>([^<]+)</south>\s*"
    r"<east>([^<]+)</east>\s*<west>([^<]+)</west>",
    re.I | re.S,
)


def snap_classification(src: Path, dst: Path) -> None:
    """Nearest-centroid snap of smoothed RGB to app legend colors."""
    try:
        import numpy as np
    except ImportError:
        np = None

    im = Image.open(src).convert("RGBA")
    if np is None:
        px = im.load()
        w, h = im.size
        srcs = [c[0] for c in CLASS_TARGETS]
        tgts = [c[1] for c in CLASS_TARGETS]
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a < 8:
                    px[x, y] = (0, 0, 0, 0)
                    continue
                best_i, best_d = 0, 1e18
                for i, (sr, sg, sb) in enumerate(srcs):
                    d = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2
                    if d < best_d:
                        best_d, best_i = d, i
                tr, tg, tb = tgts[best_i]
                px[x, y] = (tr, tg, tb, a)
        im.save(dst, optimize=True)
        return

    arr = np.asarray(im).copy()
    rgb = arr[:, :, :3].astype(np.int16)
    alpha = arr[:, :, 3]
    srcs = np.array([c[0] for c in CLASS_TARGETS], dtype=np.int16)
    tgts = np.array([c[1] for c in CLASS_TARGETS], dtype=np.uint8)
    # distance to each centroid: (H,W,K)
    diff = rgb[:, :, None, :] - srcs[None, None, :, :]
    dist = np.sum(diff * diff, axis=3)
    idx = np.argmin(dist, axis=2)
    out = tgts[idx]
    mask = alpha >= 8
    arr[:, :, :3][mask] = out[mask]
    arr[:, :, 3][~mask] = 0
    Image.fromarray(arr, "RGBA").save(dst, optimize=True)


def parse_bounds(kml_text: str) -> dict[str, float] | None:
    m = LATLON_RE.search(kml_text)
    if not m:
        return None
    north, south, east, west = (float(v) for v in m.groups())
    return {"north": north, "south": south, "east": east, "west": west}


def call_smooth(kmz: Path, out_kmz: Path, *, mode: str) -> dict:
    cmd = [
        "curl.exe",
        "-sS",
        "-D",
        "-",
        "-o",
        str(out_kmz),
        "-F",
        f"files=@{kmz}",
        "-F",
        f"mode={mode}",
        "-F",
        "gap_fill=25",
        "-F",
        "max_bleed=1.5",
        "-F",
        f"color_blur={'1.0' if mode == 'discrete' else '1.8'}",
        "-F",
        "edge_blur=3",
        "-F",
        "opacity=0.92",
        "-F",
        f"saturation={'1.05' if mode == 'discrete' else '1.35'}",
        "-F",
        "brightness=1.05",
        "-F",
        "upscale=4",
        "-F",
        "combine=true",
        API,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"curl failed for {kmz.name}: {proc.stderr}")
    headers = proc.stdout
    if "HTTP/1.1 200" not in headers and "HTTP/1.0 200" not in headers:
        # body may be error JSON in out_kmz
        err = out_kmz.read_text(encoding="utf-8", errors="replace")[:500]
        raise RuntimeError(f"smooth failed for {kmz.name}:\n{headers[:400]}\n{err}")
    info = {}
    for line in headers.splitlines():
        if line.lower().startswith("x-smoothing-info:"):
            info = json.loads(line.split(":", 1)[1].strip())
            break
    return info


def extract_kmz(kmz: Path, dest: Path) -> tuple[Path, Path, dict | None]:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(kmz, "r") as zf:
        zf.extractall(dest)
    overlays = list(dest.rglob("overlay.png"))
    legends = list(dest.rglob("legend.png"))
    kmls = list(dest.rglob("*.kml"))
    if not overlays:
        raise FileNotFoundError(f"no overlay.png in {kmz}")
    bounds = parse_bounds(kmls[0].read_text(encoding="utf-8", errors="replace")) if kmls else None
    legend = legends[0] if legends else None
    return overlays[0], legend, bounds


def process_one(
    period: str,
    filename: str,
    kind: str,
    *,
    mode: str,
    remap_class: bool,
) -> dict:
    src = SRC_DIR / filename
    if not src.exists():
        raise FileNotFoundError(src)
    out_dir = OUT_ROOT / kind / period
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"silt_{kind}_{period}_") as td:
        td_path = Path(td)
        smoothed = td_path / "smoothed.kmz"
        print(f"[{kind}/{period}] smoothing {filename} (mode={mode})...", flush=True)
        info = call_smooth(src, smoothed, mode=mode)
        overlay, legend, bounds = extract_kmz(smoothed, td_path / "unpacked")
        final_overlay = out_dir / "overlay.png"
        if remap_class:
            snap_classification(overlay, final_overlay)
        else:
            shutil.copy2(overlay, final_overlay)
        if legend:
            shutil.copy2(legend, out_dir / "legend.png")
        # Keep raw smoothed KMZ for reference
        shutil.copy2(smoothed, out_dir / "overlay_smoothed.kmz")
        meta = {
            "period": period,
            "kind": kind,
            "source": filename,
            "mode": mode,
            "bounds": bounds,
            "smoothing": info,
            "overlay": f"/data/hydrology/silt/{kind}/{period}/overlay.png",
            "legend": f"/data/hydrology/silt/{kind}/{period}/legend.png",
        }
        (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        print(
            f"  ok {final_overlay.relative_to(ROOT)} "
            f"({final_overlay.stat().st_size // 1024} KB) "
            f"classes={info.get('n_classes')} grid={info.get('grid')}",
            flush=True,
        )
        return meta


def main() -> int:
    # Health check
    health = subprocess.run(
        ["curl.exe", "-sS", "http://localhost:8000/health"],
        capture_output=True,
        text=True,
    )
    if health.returncode != 0 or "ok" not in health.stdout.lower() and '"status"' not in health.stdout:
        # /health may return {"status":"ok"} or just 200 on /
        ping = subprocess.run(["curl.exe", "-sS", "-o", "NUL", "-w", "%{http_code}", "http://localhost:8000/"], capture_output=True, text=True)
        if ping.stdout.strip() != "200":
            print("Smoother API not reachable at http://localhost:8000/", file=sys.stderr)
            return 1

    all_meta: dict = {"classification": {}, "volume": {}}
    for period, fn in CLASS_FILES.items():
        all_meta["classification"][period] = process_one(
            period, fn, "classification", mode="discrete", remap_class=True
        )
    for period, fn in VOLUME_FILES.items():
        all_meta["volume"][period] = process_one(
            period, fn, "volume", mode="gradient", remap_class=False
        )

    # Shared bounds from first successful classification
    bounds = next(
        (m["bounds"] for m in all_meta["classification"].values() if m.get("bounds")),
        None,
    )
    summary = {"bounds": bounds, "layers": all_meta}
    (OUT_ROOT / "meta.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nWrote {OUT_ROOT / 'meta.json'}")
    if bounds:
        print("Bounds:", json.dumps(bounds))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
