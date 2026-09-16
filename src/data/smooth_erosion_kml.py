#!/usr/bin/env python3
"""
smooth_erosion_kml.py
=====================

Pixel-smoothing of a classified raster GroundOverlay KMZ -> smooth KML output.

Built for the Mula-Mutha "Bank Erosion Hotspot (2016-2026)" KMZ, which is a
GEE-exported categorical raster (scale=30 m, EPSG:4326) baked into a PNG
GroundOverlay and nearest-neighbour upsampled x4. The result is a hard
pixel staircase plus salt-and-pepper speckle.

What this does
--------------
1.  Unpacks the KMZ, parses the <LatLonBox> georeference and the palette.
2.  Auto-detects the nearest-neighbour upsample factor and collapses the PNG
    back to its TRUE native grid (515 x 99). All smoothing happens here, at
    the real data resolution -- smoothing the upsampled pixels would just be
    blurring an artefact.
3.  Smooths the AOI outline with a signed-distance-field (SDF) resample, so
    the corridor edge becomes a smooth curve instead of a staircase, with the
    zero-crossing pinned to the original pixel edges (area-preserving).
4.  Smooths the CLASS boundaries with one-hot probability resampling +
    Gaussian + argmax. This is the correct way to smooth a categorical
    raster: every output pixel still receives exactly one class, so there are
    no gaps, no overlaps, and no invented intermediate classes (which is what
    you get if you naively blur the RGB image).
5.  Emits two products:
      a) VECTOR KML  -- smooth polygons (Chaikin corner-cutting +
         Douglas-Peucker), fully self-contained, sharp at any zoom level.
         Classes are vectorised as NESTED ordinal masks (label >= k) and
         stacked by draw order, which makes sliver-free topology structural
         rather than something to clean up afterwards.
      b) RASTER KML/KMZ -- a drop-in replacement GroundOverlay rendered at
         8x native with an anti-aliased alpha edge, for users who want the
         original look, just smooth.

Usage
-----
    python3 smooth_erosion_kml.py input.kmz -o outdir
    python3 smooth_erosion_kml.py input.kmz -o outdir --sigma 1.0 --supersample 8

Author: built for PlanetEye Infra-AI / River Eye
"""

from __future__ import annotations

import argparse
import logging
import math
import os
import shutil
import sys
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image
from shapely.geometry import Polygon
from shapely.ops import unary_union

LOG = logging.getLogger("smooth")

KML_NS = "http://www.opengis.net/kml/2.2"

# ----------------------------------------------------------------------------
# Class palette. Order IS the ordinal ranking (hotspot = n periods with erosion)
# ----------------------------------------------------------------------------
CLASSES: List[Tuple[int, str, Tuple[int, int, int]]] = [
    (0, "No Erosion",        (144, 238, 144)),
    (1, "Low Erosion",       (255, 255,   0)),
    (2, "Moderate Erosion",  (255, 165,   0)),
    (3, "High Erosion",      (255,   0,   0)),
    (4, "Very High Erosion", (139,   0,   0)),
]
NODATA = -1

# Per-class fill opacity in the vector KML (0-255)
FILL_ALPHA = {0: 0x8C, 1: 0xC8, 2: 0xDC, 3: 0xE6, 4: 0xF0}

EARTH_R = 6378137.0


# ============================================================================
# Geo helpers
# ============================================================================
@dataclass
class LatLonBox:
    north: float
    south: float
    east: float
    west: float
    rotation: float = 0.0

    @property
    def lon_span(self) -> float:
        return self.east - self.west

    @property
    def lat_span(self) -> float:
        return self.north - self.south

    @property
    def mid_lat(self) -> float:
        return 0.5 * (self.north + self.south)


def deg_per_px(box: LatLonBox, w: int, h: int) -> Tuple[float, float]:
    return box.lon_span / w, box.lat_span / h


def metres_per_deg(lat: float) -> Tuple[float, float]:
    """Local metres per degree of longitude / latitude."""
    lat_r = math.radians(lat)
    m_lon = (math.pi / 180.0) * EARTH_R * math.cos(lat_r)
    m_lat = (math.pi / 180.0) * EARTH_R  # spherical approximation, fine at this scale
    return m_lon, m_lat


def polygon_area_m2(ring_lonlat: np.ndarray, mid_lat: float) -> float:
    """Planar area of a lon/lat ring using a local equirectangular projection."""
    m_lon, m_lat = metres_per_deg(mid_lat)
    x = ring_lonlat[:, 0] * m_lon
    y = ring_lonlat[:, 1] * m_lat
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


# ============================================================================
# 1. Input: unpack + parse
# ============================================================================
def _localname(tag: str) -> str:
    return tag.split("}")[-1]


def _find_text(elem: ET.Element, name: str) -> Optional[str]:
    for e in elem.iter():
        if _localname(e.tag) == name and e.text:
            return e.text.strip()
    return None


def read_kmz(kmz_path: str, workdir: str) -> Tuple[np.ndarray, LatLonBox, Dict[str, str], Optional[str]]:
    """Extract the KMZ and return (overlay RGBA, LatLonBox, doc metadata, legend path)."""
    ext = os.path.join(workdir, "_unpacked")
    if os.path.isdir(ext):
        shutil.rmtree(ext)
    os.makedirs(ext, exist_ok=True)

    with zipfile.ZipFile(kmz_path) as zf:
        zf.extractall(ext)

    kml_files = [
        os.path.join(dp, f)
        for dp, _, fs in os.walk(ext)
        for f in fs
        if f.lower().endswith(".kml")
    ]
    if not kml_files:
        raise RuntimeError("No .kml found inside the KMZ")
    kml_path = kml_files[0]
    LOG.info("KML document: %s", os.path.relpath(kml_path, ext))

    tree = ET.parse(kml_path)
    root = tree.getroot()

    ground = None
    for e in root.iter():
        if _localname(e.tag) == "GroundOverlay":
            ground = e
            break
    if ground is None:
        raise RuntimeError("No <GroundOverlay> in the KML -- this tool expects a raster overlay")

    llb_elem = None
    for e in ground.iter():
        if _localname(e.tag) == "LatLonBox":
            llb_elem = e
            break
    if llb_elem is None:
        raise RuntimeError("GroundOverlay has no <LatLonBox>")

    box = LatLonBox(
        north=float(_find_text(llb_elem, "north")),
        south=float(_find_text(llb_elem, "south")),
        east=float(_find_text(llb_elem, "east")),
        west=float(_find_text(llb_elem, "west")),
        rotation=float(_find_text(llb_elem, "rotation") or 0.0),
    )
    if abs(box.rotation) > 1e-9:
        raise RuntimeError("Rotated GroundOverlays are not supported")

    href = _find_text(ground, "href")
    img_path = os.path.join(os.path.dirname(kml_path), href)
    if not os.path.isfile(img_path):
        raise RuntimeError(f"Overlay image not found: {href}")

    arr = np.array(Image.open(img_path).convert("RGBA"))

    meta = {
        "name": _find_text(ground, "name") or "Overlay",
        "description": _find_text(ground, "description") or "",
        "doc_name": _find_text(root, "name") or "Document",
    }

    legend = None
    for dp, _, fs in os.walk(ext):
        for f in fs:
            if "legend" in f.lower() and f.lower().endswith((".png", ".jpg")):
                legend = os.path.join(dp, f)
    return arr, box, meta, legend


# ============================================================================
# 2. Native grid recovery + label decoding
# ============================================================================
def detect_upsample_factor(arr: np.ndarray, max_f: int = 32) -> int:
    """Largest f such that the image is exactly f-x nearest-neighbour upsampled."""
    h, w = arr.shape[:2]
    best = 1
    for f in range(2, max_f + 1):
        if h % f or w % f:
            continue
        blocks = arr.reshape(h // f, f, w // f, f, arr.shape[2])
        if np.array_equal(blocks, np.broadcast_to(blocks[:, :1, :, :1, :], blocks.shape)):
            best = f
    return best


def rgba_to_labels(arr: np.ndarray, alpha_thresh: int = 128) -> np.ndarray:
    """Nearest-palette decode of the RGBA overlay into an int label grid."""
    rgb = arr[..., :3].astype(np.int32)
    best_d = None
    best_k = None
    for k, _, colour in CLASSES:
        d = ((rgb - np.array(colour, np.int32)) ** 2).sum(-1)
        if best_d is None:
            best_d, best_k = d, np.full(rgb.shape[:2], k, np.int16)
        else:
            upd = d < best_d
            best_d = np.where(upd, d, best_d)
            best_k = np.where(upd, np.int16(k), best_k)
    lab = best_k.astype(np.int16)
    lab[arr[..., 3] < alpha_thresh] = NODATA
    return lab


def nearest_fill(lab: np.ndarray) -> np.ndarray:
    """Flood NODATA with the nearest valid class, so blurring doesn't bleed at the AOI edge."""
    valid = (lab != NODATA).astype(np.uint8)
    if valid.all():
        return lab.copy()
    # distanceTransform's label output gives the nearest non-zero pixel id
    _, labels = cv2.distanceTransformWithLabels(
        1 - valid, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL
    )
    ys, xs = np.nonzero(valid)
    lut = np.zeros(labels.max() + 1, np.int16)
    # labelType=PIXEL numbers the zero-pixels (i.e. the valid ones) from 1 in raster order
    lut[1: len(ys) + 1] = lab[ys, xs]
    out = lab.copy()
    out[lab == NODATA] = lut[labels[lab == NODATA]]
    return out


# ============================================================================
# 3. Smoothing
# ============================================================================
def smooth_aoi_mask(mask: np.ndarray, S: int, sigma_native: float) -> Tuple[np.ndarray, np.ndarray]:
    """
    Smooth the AOI outline via a signed distance field.

    Returns (boolean mask at S-x resolution, the upsampled SDF in native-pixel
    units -- used to build an anti-aliased alpha channel).
    """
    m = mask.astype(np.uint8)
    d_in = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    d_out = cv2.distanceTransform(1 - m, cv2.DIST_L2, 5)
    sdf = d_in - d_out  # >0 inside; zero-crossing sits on the original pixel edge

    h, w = mask.shape
    sdf_hi = cv2.resize(sdf, (w * S, h * S), interpolation=cv2.INTER_CUBIC)
    if sigma_native > 0:
        sdf_hi = cv2.GaussianBlur(sdf_hi, (0, 0), sigmaX=sigma_native * S, sigmaY=sigma_native * S)
    return sdf_hi > 0.0, sdf_hi


def calibrate_gains(
    pm: np.ndarray,
    target: np.ndarray,
    iters: int = 80,
    damping: float = 0.35,
    tol: float = 0.005,
) -> np.ndarray:
    """
    Fit per-class multiplicative gains so that argmax(gain * prob) reproduces the
    ORIGINAL class areas.

    Why this is needed: a plain blur-then-argmax is biased towards whichever class
    is locally dominant. On a narrow river corridor where "No Erosion" outnumbers
    the hotspot classes ~6:1, that silently erases most of the actual signal. The
    gains restore an unbiased decision boundary, so smoothing only *moves* class
    edges, it never deletes classes.

    Iterative proportional fitting; converges in a few dozen passes.
    """
    K = pm.shape[0]
    gain = np.ones(K, np.float64)
    for _ in range(iters):
        idx = np.argmax(pm * gain[:, None], axis=0)
        cur = np.bincount(idx, minlength=K).astype(np.float64)
        rel = np.abs(cur - target) / np.maximum(target, 1.0)
        if rel.max() < tol:
            break
        gain *= (target / np.maximum(cur, 1.0)) ** damping
        gain /= gain.max()
    return gain


def smooth_labels(
    lab_native: np.ndarray,
    S: int,
    sigma_native: float,
    preserve_area: bool = True,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Categorical smoothing: one-hot -> bicubic upsample -> Gaussian -> calibrated argmax.

    Guarantees a valid partition (exactly one class per pixel), so class
    boundaries move but never tear, overlap, or interpolate into fake classes.

    Returns (labels at S-x resolution, SDF, fitted per-class gains).
    """
    mask = lab_native != NODATA
    filled = nearest_fill(lab_native)

    h, w = lab_native.shape
    present = [k for k, _, _ in CLASSES if (lab_native == k).any()]
    prob = np.zeros((len(present), h * S, w * S), np.float32)

    for i, k in enumerate(present):
        oh = (filled == k).astype(np.float32)
        up = cv2.resize(oh, (w * S, h * S), interpolation=cv2.INTER_CUBIC)
        if sigma_native > 0:
            up = cv2.GaussianBlur(up, (0, 0), sigmaX=sigma_native * S, sigmaY=sigma_native * S)
        prob[i] = up

    mask_hi, sdf_hi = smooth_aoi_mask(mask, S, sigma_native)

    gain = np.ones(len(present), np.float64)
    if preserve_area and len(present) > 1:
        pm = prob[:, mask_hi]  # only AOI interior participates in the fit
        counts = np.array([(lab_native == k).sum() for k in present], np.float64)
        target = counts / counts.sum() * pm.shape[1]
        gain = calibrate_gains(pm, target)

    idx = np.argmax(prob * gain[:, None, None].astype(np.float32), axis=0)
    lut = np.array(present, np.int16)
    lab_hi = lut[idx]
    lab_hi[~mask_hi] = NODATA
    return lab_hi, sdf_hi, gain


# ============================================================================
# 4. Raster rendering
# ============================================================================
def render_rgba(lab_hi: np.ndarray, sdf_hi: np.ndarray, S: int) -> np.ndarray:
    """Paint the smoothed labels with an anti-aliased ~1px alpha ramp at the AOI edge."""
    h, w = lab_hi.shape
    out = np.zeros((h, w, 4), np.uint8)
    for k, _, colour in CLASSES:
        sel = lab_hi == k
        if sel.any():
            out[sel, :3] = colour
    alpha = np.clip(sdf_hi * S + 0.5, 0.0, 1.0)  # ramp spans ~1 high-res pixel
    out[..., 3] = (alpha * 255).astype(np.uint8)
    out[lab_hi == NODATA, 3] = np.minimum(out[lab_hi == NODATA, 3], 0)
    return out


# ============================================================================
# 5. Vectorisation
# ============================================================================
def chaikin(ring: np.ndarray, iters: int = 3) -> np.ndarray:
    """Chaikin corner-cutting on a closed ring. Each pass quarters every corner."""
    pts = ring
    for _ in range(iters):
        if len(pts) < 4:
            break
        nxt = np.roll(pts, -1, axis=0)
        q = 0.75 * pts + 0.25 * nxt
        r = 0.25 * pts + 0.75 * nxt
        out = np.empty((len(pts) * 2, 2), np.float64)
        out[0::2] = q
        out[1::2] = r
        pts = out
    return pts


def ring_to_polygon(ring_px: np.ndarray, simplify_px: float, chaikin_iters: int) -> Optional[Polygon]:
    if len(ring_px) < 3:
        return None
    sm = chaikin(ring_px.astype(np.float64), chaikin_iters)
    poly = Polygon(sm)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if simplify_px > 0:
        poly = poly.simplify(simplify_px, preserve_topology=True)
    if poly.is_empty or poly.area <= 0:
        return None
    return poly


def fit_area_buffer(geom, target_px2: float, lo: float = -3.0, hi: float = 6.0, iters: int = 40):
    """
    Find the uniform buffer distance (in high-res pixels) that makes the polygon
    area match the raster area, and return the buffered geometry.

    Contour tracing follows pixel CENTRES and Chaikin corner-cutting shaves convex
    corners, so raw vector output is systematically smaller than the raster it came
    from -- badly so for small blobs (a 1-pixel hotspot loses ~25% of its area).
    A single scalar offset per layer, solved by bisection, puts the numbers back in
    agreement so the vector KML and the raster KML report the same hectares.
    """
    if geom.is_empty or target_px2 <= 0:
        return geom
    if geom.area >= target_px2:
        lo = min(lo, -6.0)
    best = geom
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        try:
            cand = geom.buffer(mid, quad_segs=8, join_style=1)
        except Exception:
            break
        if cand.is_empty:
            lo = mid
            continue
        best = cand
        if abs(cand.area - target_px2) / target_px2 < 1e-4:
            break
        if cand.area < target_px2:
            lo = mid
        else:
            hi = mid
    return best


def vectorise_nested(
    lab_hi: np.ndarray,
    S: int,
    min_area_native_px: float,
    simplify_px: float,
    chaikin_iters: int,
) -> Dict[int, "object"]:
    """
    Vectorise ordinal classes as NESTED masks: class k -> region(label >= k).

    Because each layer fully contains the next, stacking them by draw order
    reproduces the classification exactly with zero slivers and zero gaps --
    no post-hoc topology cleaning needed.
    """
    valid = lab_hi != NODATA
    present = sorted({int(v) for v in np.unique(lab_hi) if v != NODATA})
    min_area_px = min_area_native_px * (S ** 2)

    layers: Dict[int, object] = {}
    for k in present:
        mask = (valid & (lab_hi >= k)).astype(np.uint8)
        if not mask.any():
            continue
        contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        if hierarchy is None:
            continue
        hierarchy = hierarchy[0]

        outers: List[Polygon] = []
        holes_for: Dict[int, List[Polygon]] = {}
        for i, cnt in enumerate(contours):
            ring = cnt[:, 0, :]  # (N,2) in (x,y) pixel coords
            parent = hierarchy[i][3]
            poly = ring_to_polygon(ring, simplify_px, chaikin_iters)
            if poly is None or poly.area < min_area_px:
                continue
            if parent == -1:
                outers.append(poly)
                holes_for[len(outers) - 1] = []
            else:
                holes_for.setdefault(len(outers) - 1, []).append(poly)

        built: List[Polygon] = []
        for i, o in enumerate(outers):
            hs = holes_for.get(i, [])
            g = o
            for hpoly in hs:
                g = g.difference(hpoly)
            if not g.is_empty:
                built.append(g)
        if built:
            layers[k] = unary_union(built)
    return layers


def px_to_lonlat(poly, box: LatLonBox, w_hi: int, h_hi: int):
    """Map high-res pixel coords (centre-referenced) to lon/lat."""
    dlon = box.lon_span / w_hi
    dlat = box.lat_span / h_hi

    def tf(coords):
        c = np.asarray(coords, np.float64)
        lon = box.west + (c[:, 0] + 0.5) * dlon
        lat = box.north - (c[:, 1] + 0.5) * dlat
        return np.column_stack([lon, lat])

    from shapely.geometry import MultiPolygon

    def conv(p: Polygon) -> Polygon:
        ext = tf(p.exterior.coords)
        ints = [tf(r.coords) for r in p.interiors]
        return Polygon(ext, ints)

    if poly.geom_type == "Polygon":
        return conv(poly)
    return MultiPolygon([conv(p) for p in poly.geoms])


# ============================================================================
# 6. KML writers
# ============================================================================
def _abgr(rgb: Tuple[int, int, int], alpha: int) -> str:
    r, g, b = rgb
    return f"{alpha:02x}{b:02x}{g:02x}{r:02x}"


def _esc(s: str) -> str:
    return (
        s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )


def _ring_kml(ring: np.ndarray, precision: int = 6) -> str:
    return " ".join(f"{lon:.{precision}f},{lat:.{precision}f},0" for lon, lat in ring)


def write_vector_kml(
    path: str,
    layers_geo: Dict[int, object],
    meta: Dict[str, str],
    box: LatLonBox,
    stats: Dict[int, float],
    precision: int = 6,
) -> None:
    names = {k: n for k, n, _ in CLASSES}
    colours = {k: c for k, _, c in CLASSES}

    parts: List[str] = []
    parts.append('<?xml version="1.0" encoding="UTF-8"?>')
    parts.append(f'<kml xmlns="{KML_NS}">')
    parts.append("<Document>")
    parts.append(f"  <name>{_esc(meta['doc_name'])} - Smoothed (vector)</name>")
    parts.append(
        "  <description><![CDATA["
        f"{meta['description']}<br/><br/>"
        "<b>Pixel-smoothed vector rendition.</b> The source 30 m categorical raster was "
        "smoothed with one-hot probability resampling + argmax and vectorised as nested "
        "ordinal regions, then boundaries were rounded with Chaikin corner-cutting. "
        "Layers are stacked lowest-class-first, so the visible colour at any point is the "
        "highest hotspot class present there."
        "]]></description>"
    )
    parts.append("  <open>1</open>")

    for k in sorted(layers_geo):
        rgb = colours[k]
        parts.append(f'  <Style id="cls{k}">')
        parts.append(
            f"    <LineStyle><color>{_abgr(rgb, 0xFF)}</color><width>1.1</width></LineStyle>"
        )
        parts.append(
            f"    <PolyStyle><color>{_abgr(rgb, FILL_ALPHA[k])}</color><fill>1</fill><outline>1</outline></PolyStyle>"
        )
        parts.append("  </Style>")

    from shapely.geometry import MultiPolygon

    for k in sorted(layers_geo):
        geom = layers_geo[k]
        polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
        area_ha = stats.get(k, 0.0) / 10_000.0
        parts.append("  <Folder>")
        parts.append(f"    <name>{k} - {_esc(names[k])}</name>")
        parts.append("    <open>0</open>")
        parts.append("    <Placemark>")
        parts.append(f"      <name>{k} - {_esc(names[k])}</name>")
        parts.append(f"      <styleUrl>#cls{k}</styleUrl>")
        parts.append("      <ExtendedData>")
        parts.append(f'        <Data name="hotspot_class"><value>{k}</value></Data>')
        parts.append(f'        <Data name="class_name"><value>{_esc(names[k])}</value></Data>')
        parts.append(f'        <Data name="area_ha"><value>{area_ha:.2f}</value></Data>')
        parts.append(f'        <Data name="n_parts"><value>{len(polys)}</value></Data>')
        parts.append("      </ExtendedData>")
        parts.append("      <MultiGeometry>")
        for p in polys:
            parts.append("        <Polygon>")
            parts.append("          <tessellate>1</tessellate>")
            parts.append("          <altitudeMode>clampToGround</altitudeMode>")
            parts.append("          <outerBoundaryIs><LinearRing><coordinates>")
            parts.append("            " + _ring_kml(np.asarray(p.exterior.coords), precision))
            parts.append("          </coordinates></LinearRing></outerBoundaryIs>")
            for r in p.interiors:
                parts.append("          <innerBoundaryIs><LinearRing><coordinates>")
                parts.append("            " + _ring_kml(np.asarray(r.coords), precision))
                parts.append("          </coordinates></LinearRing></innerBoundaryIs>")
            parts.append("        </Polygon>")
        parts.append("      </MultiGeometry>")
        parts.append("    </Placemark>")
        parts.append("  </Folder>")

    parts.append("</Document>")
    parts.append("</kml>")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))


def write_overlay_kml(path: str, png_rel: str, legend_rel: Optional[str], meta: Dict[str, str], box: LatLonBox) -> None:
    p: List[str] = []
    p.append('<?xml version="1.0" encoding="UTF-8"?>')
    p.append(f'<kml xmlns="{KML_NS}">')
    p.append("<Document>")
    p.append(f"  <name>{_esc(meta['doc_name'])} - Smoothed (raster)</name>")
    p.append(f"  <description><![CDATA[{meta['description']}<br/><br/><b>Pixel-smoothed raster overlay.</b>]]></description>")
    if legend_rel:
        p.append("  <ScreenOverlay>")
        p.append("    <name>Legend</name>")
        p.append(f"    <Icon><href>{legend_rel}</href></Icon>")
        p.append('    <overlayXY x="0" y="1" xunits="fraction" yunits="fraction"/>')
        p.append('    <screenXY x="0.01" y="0.99" xunits="fraction" yunits="fraction"/>')
        p.append('    <rotationXY x="0" y="0" xunits="fraction" yunits="fraction"/>')
        p.append('    <size x="0" y="0" xunits="fraction" yunits="fraction"/>')
        p.append("  </ScreenOverlay>")
    p.append("  <GroundOverlay>")
    p.append(f"    <name>{_esc(meta['name'])} - smoothed</name>")
    p.append("    <drawOrder>1</drawOrder>")
    p.append(f"    <Icon><href>{png_rel}</href><viewBoundScale>0.75</viewBoundScale></Icon>")
    p.append("    <LatLonBox>")
    p.append(f"      <north>{box.north!r}</north><south>{box.south!r}</south>")
    p.append(f"      <east>{box.east!r}</east><west>{box.west!r}</west>")
    p.append("      <rotation>0</rotation>")
    p.append("    </LatLonBox>")
    p.append("  </GroundOverlay>")
    p.append("</Document>")
    p.append("</kml>")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(p))


# ============================================================================
# Main
# ============================================================================
def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Pixel-smooth a classified GroundOverlay KMZ and write KML.")
    ap.add_argument("kmz", help="input .kmz (or .kml alongside its files/ dir)")
    ap.add_argument("-o", "--outdir", default="out", help="output directory")
    ap.add_argument("--supersample", type=int, default=8, help="output resolution multiplier over the NATIVE grid")
    ap.add_argument("--sigma", type=float, default=0.75,
                    help="Gaussian sigma in NATIVE pixels. 0.5=light, 0.75=balanced, 1.2=heavy")
    ap.add_argument("--no-preserve-area", action="store_true",
                    help="disable per-class area calibration (faster, but minority classes get eroded)")
    ap.add_argument("--chaikin", type=int, default=3, help="Chaikin corner-cutting passes")
    ap.add_argument("--simplify-m", type=float, default=3.0, help="Douglas-Peucker tolerance (metres)")
    ap.add_argument("--min-area-px", type=float, default=0.25,
                    help="drop vector parts smaller than this many NATIVE pixels")
    ap.add_argument("--precision", type=int, default=6, help="coordinate decimal places in the KML")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)-7s %(message)s",
    )

    os.makedirs(args.outdir, exist_ok=True)
    work = os.path.join(args.outdir, "_work")
    os.makedirs(work, exist_ok=True)

    # -- 1. read ------------------------------------------------------------
    arr, box, meta, legend = read_kmz(args.kmz, work)
    H, W = arr.shape[:2]
    LOG.info("Overlay          : %d x %d RGBA", W, H)
    LOG.info("LatLonBox        : N %.6f  S %.6f  E %.6f  W %.6f", box.north, box.south, box.east, box.west)

    # -- 2. native grid -----------------------------------------------------
    f = detect_upsample_factor(arr)
    if f > 1:
        native = arr[::f, ::f]
        LOG.info("Native grid      : %d x %d  (detected %dx NN upsample -- collapsed)", native.shape[1], native.shape[0], f)
    else:
        native = arr
        LOG.info("Native grid      : %d x %d  (no upsampling detected)", W, H)

    lab = rgba_to_labels(native)
    nh, nw = lab.shape
    dlon, dlat = deg_per_px(box, nw, nh)
    m_lon, m_lat = metres_per_deg(box.mid_lat)
    px_m = 0.5 * (dlon * m_lon + dlat * m_lat)
    LOG.info("Native pixel     : %.3e deg  ~ %.1f m", dlon, px_m)

    counts_before = {k: int((lab == k).sum()) for k, _, _ in CLASSES}
    LOG.info("Class pixels in  : %s", {k: v for k, v in counts_before.items() if v})

    # -- 3. smooth ----------------------------------------------------------
    S = args.supersample
    LOG.info("Smoothing        : supersample %dx, sigma %.2f native px (%.1f m), preserve-area=%s",
             S, args.sigma, args.sigma * px_m, not args.no_preserve_area)
    lab_hi, sdf_hi, gain = smooth_labels(lab, S, args.sigma, preserve_area=not args.no_preserve_area)
    hh, hw = lab_hi.shape

    aoi_before = int((lab != NODATA).sum())
    aoi_after = float((lab_hi != NODATA).sum()) / (S ** 2)
    LOG.info("AOI footprint    : %.1f -> %.1f native px  (%+.2f%%)",
             aoi_before, aoi_after, 100.0 * (aoi_after - aoi_before) / aoi_before)

    counts_after = {k: float((lab_hi == k).sum()) / (S ** 2) for k, _, _ in CLASSES}
    LOG.info("Class areas (native-px equivalent, %.0f m pixel):", px_m)
    for k, name, _ in CLASSES:
        if counts_before[k] or counts_after[k]:
            b, a = counts_before[k], counts_after[k]
            d = 100.0 * (a - b) / b if b else float("nan")
            LOG.info("   %d %-18s %8.1f -> %8.1f  (%+6.2f%%)   %8.2f ha", k, name, b, a, d,
                     a * px_m * px_m / 1e4)

    # -- 4. raster product --------------------------------------------------
    rgba_hi = render_rgba(lab_hi, sdf_hi, S)
    rdir = os.path.join(args.outdir, "raster_files")
    os.makedirs(rdir, exist_ok=True)
    png_path = os.path.join(rdir, "overlay_smoothed.png")
    Image.fromarray(rgba_hi).save(png_path, optimize=True)
    legend_rel = None
    if legend:
        shutil.copy(legend, os.path.join(rdir, "legend.png"))
        legend_rel = "raster_files/legend.png"
    LOG.info("Raster out       : %d x %d  (%.0f kB)", hw, hh, os.path.getsize(png_path) / 1024)

    base = os.path.splitext(os.path.basename(args.kmz))[0]
    ov_kml = os.path.join(args.outdir, f"{base}_smoothed_overlay.kml")
    write_overlay_kml(ov_kml, "raster_files/overlay_smoothed.png", legend_rel, meta, box)

    ov_kmz = os.path.join(args.outdir, f"{base}_smoothed_overlay.kmz")
    with zipfile.ZipFile(ov_kmz, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(ov_kml, "doc.kml")
        zf.write(png_path, "raster_files/overlay_smoothed.png")
        if legend_rel:
            zf.write(os.path.join(rdir, "legend.png"), "raster_files/legend.png")

    # -- 5. vector product --------------------------------------------------
    simplify_px = args.simplify_m / (px_m / S)
    LOG.info("Vectorising      : chaikin %d, simplify %.1f m (%.2f hi-px), min part %.2f native px",
             args.chaikin, args.simplify_m, simplify_px, args.min_area_px)
    layers = vectorise_nested(lab_hi, S, args.min_area_px, simplify_px, args.chaikin)

    # Match each vector layer's area to the raster it came from, then re-impose
    # nesting so nothing escapes the AOI outline.
    valid_hi = lab_hi != NODATA
    for k in sorted(layers):
        target = float((valid_hi & (lab_hi >= k)).sum())
        raw = layers[k].area
        layers[k] = fit_area_buffer(layers[k], target)
        LOG.debug("   layer %d area fit: %.0f -> %.0f hi-px (target %.0f)", k, raw, layers[k].area, target)
    if 0 in layers:
        for k in sorted(layers):
            if k > 0:
                layers[k] = layers[k].intersection(layers[0])

    layers_geo: Dict[int, object] = {}
    stats: Dict[int, float] = {}
    from shapely.geometry import MultiPolygon

    for k, g in layers.items():
        if g.is_empty:
            continue
        if g.geom_type == "GeometryCollection":
            g = unary_union([p for p in g.geoms if p.geom_type in ("Polygon", "MultiPolygon")])
            layers[k] = g
        gg = px_to_lonlat(g, box, hw, hh)
        layers_geo[k] = gg
        polys = list(gg.geoms) if isinstance(gg, MultiPolygon) else [gg]
        a = 0.0
        for p in polys:
            a += polygon_area_m2(np.asarray(p.exterior.coords), box.mid_lat)
            for r in p.interiors:
                a -= polygon_area_m2(np.asarray(r.coords), box.mid_lat)
        stats[k] = a
        LOG.info("   class %d: %4d part(s), %8.2f ha (cumulative, >= class %d)", k, len(polys), a / 1e4, k)

    vec_kml = os.path.join(args.outdir, f"{base}_smoothed.kml")
    write_vector_kml(vec_kml, layers_geo, meta, box, stats, args.precision)
    LOG.info("Vector out       : %s (%.0f kB)", os.path.basename(vec_kml), os.path.getsize(vec_kml) / 1024)

    shutil.rmtree(work, ignore_errors=True)
    LOG.info("Done -> %s", os.path.abspath(args.outdir))
    return 0


if __name__ == "__main__":
    sys.exit(main())