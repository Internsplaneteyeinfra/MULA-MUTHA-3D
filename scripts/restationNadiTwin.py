"""
Re-station the NadiTwin profile data onto the authoritative 10 m chainage KML.

Each NadiTwin station keeps its lon/lat; its chainage becomes the distance along the
KML chainage line at that position (projected onto the 10 m chainage polyline).
Stations upstream of 0+000 get negative chainage (the river starts before 0+000).
Other files keyed on the old stationing (depth profile, landmarks, bathymetry cloud)
are mapped through the same monotonic old->new table. Old values are kept as
`legacy_chainage_m` / `legacyChainageMeters`.

Usage:  python scripts/restationNadiTwin.py [path/to/chainage.kml]
Run once per new chainage KML; it reads the legacy value back if already migrated.
"""
import bisect
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KML = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "public/data/Mula-Mutha_River_10m_ch_merged.kml"
NT = ROOT / "public/data/naditwin"
LAT0 = 18.53
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110574.0


def xy(lon, lat):
    return lon * KX, lat * KY


def load_chainage(path):
    text = path.read_text(encoding="utf-8")
    pts = []
    for block in re.findall(r"<Placemark[\s\S]*?</Placemark>", text):
        name = re.search(r"<name>\s*(\d+)\+(\d+)\s*</name>", block)
        coord = re.search(r"<Point>[\s\S]*?<coordinates>([\s\S]*?)</coordinates>", block)
        if not name or not coord:
            continue
        lon, lat = map(float, coord.group(1).split(",")[:2])
        pts.append((int(name.group(1)) * 1000 + int(name.group(2)), lon, lat))
    pts.sort()
    return pts


def project(lon, lat, line, window=None):
    """Chainage of (lon, lat) on the polyline; extrapolates before the first / after the last point.
    `window` = (minM, maxM) restricts the search to segments overlapping that chainage range."""
    px, py = xy(lon, lat)
    best = None
    n = len(line)
    for i in range(n - 1):
        if window and (line[i + 1][0] < window[0] or line[i][0] > window[1]):
            continue
        m0, x0, y0 = line[i]
        m1, x1, y1 = line[i + 1]
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy or 1e-9
        t = ((px - x0) * dx + (py - y0) * dy) / L2
        lo = -math.inf if i == 0 else 0.0
        hi = math.inf if i == n - 2 else 1.0
        tc = min(hi, max(lo, t))
        qx, qy = x0 + tc * dx, y0 + tc * dy
        d = (px - qx) ** 2 + (py - qy) ** 2
        if best is None or d < best[0]:
            best = (d, m0 + tc * (m1 - m0))
    if best is None:  # window past the end of the line — fall back to the full line
        return project(lon, lat, line)
    return best[1], math.sqrt(best[0])


def legacy(rec, key):
    return rec.get("legacy_" + key, rec.get(key)) if key == "chainage_m" else rec.get("legacyChainageMeters", rec.get(key))


def main():
    ch = load_chainage(KML)
    line = [(m, *xy(lon, lat)) for m, lon, lat in ch]
    print(f"KML chainage: {len(ch)} points, {ch[0][0]} -> {ch[-1][0]} m")

    profile = json.loads((NT / "chainage_profile.json").read_text())
    old, new, off = [], [], []
    # 1) Anchors: stations lying on the KML chainage line (within ANCHOR_M). Where the two
    #    centerlines take different paths (e.g. the Sangam confluence) nearest-point matching is
    #    ambiguous, so those stations are placed by distance along the river between anchors.
    ANCHOR_M = 15.0
    anchors = []
    for s in profile:
        o = float(legacy(s, "chainage_m"))
        n, d = project(s["lon"], s["lat"], line)
        off.append(d)
        ok = d <= ANCHOR_M
        if ok and anchors:
            po, pn = anchors[-1]
            # Must advance, and no faster than the river itself (rejects a match on another reach).
            ok = o > po and pn < n <= pn + (o - po) * 1.6 + 20
        if ok:
            anchors.append((o, n))
    ao = [a[0] for a in anchors]
    an = [a[1] for a in anchors]

    def by_anchor(o):
        if o <= ao[0]:
            return an[0] + (o - ao[0])  # upstream of the first anchor: metre for metre (may go negative)
        if o >= ao[-1]:
            return an[-1] + (o - ao[-1])
        k = bisect.bisect_right(ao, o)
        return an[k - 1] + (o - ao[k - 1]) / (ao[k] - ao[k - 1]) * (an[k] - an[k - 1])

    for s in profile:
        o = float(legacy(s, "chainage_m"))
        old.append(o)
        new.append(by_anchor(o))
    print(f"Anchors: {len(anchors)} of {len(profile)} stations within {ANCHOR_M:.0f} m of the KML line")
    print(f"Profile stations: {len(profile)}  old {old[0]:.1f}->{old[-1]:.1f}  new {new[0]:.1f}->{new[-1]:.1f}"
          f"  max offset from KML line {max(off):.1f} m, upstream of 0+000: {sum(1 for v in new if v < 0)}")

    def remap(o):
        o = float(o)
        if o <= old[0]:
            return new[0] + (o - old[0])
        if o >= old[-1]:
            return new[-1] + (o - old[-1])
        j = bisect.bisect_right(old, o)
        a, b = j - 1, j
        span = old[b] - old[a] or 1e-9
        return new[a] + (o - old[a]) / span * (new[b] - new[a])

    r1 = lambda v: round(v, 1)
    for s, o, n in zip(profile, old, new):
        s["legacy_chainage_m"] = o
        s["chainage_m"] = r1(n)
    (NT / "chainage_profile.json").write_text(json.dumps(profile, indent=2))

    depth = json.loads((NT / "depth_profile.json").read_text())
    for s in depth:
        o = float(legacy(s, "chainage_m"))
        s["legacy_chainage_m"] = o
        s["chainage_m"] = r1(remap(o))
    (NT / "depth_profile.json").write_text(json.dumps(depth, indent=2))

    landmarks = json.loads((NT / "landmarks.json").read_text())
    for s in landmarks:
        o = float(legacy(s, "chainage_m"))
        s["legacy_chainage_m"] = o
        s["chainage_m"] = r1(remap(o))
        s["chainage_km"] = round(s["chainage_m"] / 1000, 3)
        print(f"  landmark {s['name']:<16} {o:9.1f} -> {s['chainage_m']:9.1f}")
    (NT / "landmarks.json").write_text(json.dumps(landmarks, indent=2))

    cloud = json.loads((NT / "raw_bathymetry_cloud.json").read_text())
    for cs in cloud["crossSections"]:
        o = float(cs.get("legacyChainageMeters", cs["chainageMeters"]))
        cs["legacyChainageMeters"] = o
        cs["chainageMeters"] = r1(remap(o))
        for p in cs.get("points", []):
            po = float(p.get("legacyChainageMeters", p["chainageMeters"]))
            p["legacyChainageMeters"] = po
            p["chainageMeters"] = r1(remap(po))
    for p in cloud["points"]:
        po = float(p.get("legacyChainageMeters", p["chainageMeters"]))
        p["legacyChainageMeters"] = po
        p["chainageMeters"] = r1(remap(po))
    cms = [cs["chainageMeters"] for cs in cloud["crossSections"]]
    cloud["minChainageMeters"], cloud["maxChainageMeters"] = min(cms), max(cms)
    cloud["chainageReference"] = KML.name
    (NT / "raw_bathymetry_cloud.json").write_text(json.dumps(cloud))
    print("Re-stationed: chainage_profile, depth_profile, landmarks, raw_bathymetry_cloud")


if __name__ == "__main__":
    main()
