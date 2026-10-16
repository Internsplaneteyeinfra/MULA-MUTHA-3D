"""
Refine river centrelines and measure channel width from the JRC Global Surface Water occurrence map
(Pekel et al. 2016, Nature; EC JRC / Google; free use with attribution; 30 m Landsat-derived, 1984-2021).

For each reach, the HydroRIVERS course is resampled every STEP m; at each vertex a cross-section of +/-SEARCH m is
scanned on the zoom-13 occurrence tiles. The water run (occurrence above threshold) nearest the vertex gives the
channel centre and width. Centres/widths are smoothed and gaps interpolated. Output:
public/data/rivers/channels_jrc.json  -> { reach: { coordinates: [[lon,lat]...], halfWidthM: [...], source } }

Usage: python -I scripts/refineChannelsFromJRC.py
"""
import io, json, math, urllib.request
from PIL import Image

TILE = "https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png"
Z = 13
STEP = 40.0
SEARCH = 450.0
SCAN = 8.0
cache = {}


def tile(x, y):
    k = (x, y)
    if k not in cache:
        try:
            d = urllib.request.urlopen(TILE.format(z=Z, x=x, y=y), timeout=30).read()
            cache[k] = Image.open(io.BytesIO(d)).convert("RGBA")
        except Exception:
            cache[k] = None
    return cache[k]


def is_water(lon, lat):
    n = 2 ** Z
    lr = math.radians(lat)
    fx = (lon + 180) / 360 * n
    fy = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n
    t = tile(int(fx), int(fy))
    if t is None:
        return False
    r, g, b, a = t.getpixel((min(255, int((fx % 1) * 256)), min(255, int((fy % 1) * 256))))
    return a > 100  # occurrence colour ramp is transparent where water was (almost) never observed


def hav(a, b):
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dl / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


def resample(c, step):
    out = [c[0]]
    carry = 0
    for i in range(1, len(c)):
        a, b = c[i - 1], c[i]
        d = hav(a, b)
        while carry + d >= step:
            k = (step - carry) / d
            a = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
            out.append(a)
            d = hav(a, b)
            carry = 0
        carry += d
    out.append(c[-1])
    return out


def smooth(v, w):
    out = []
    for i in range(len(v)):
        s = [v[j] for j in range(max(0, i - w), min(len(v), i + w + 1)) if v[j] is not None]
        out.append(sum(s) / len(s) if s else None)
    return out


def refine(line):
    pts = resample(line, STEP)
    offs, halfs = [], []
    for i, p in enumerate(pts):
        a, b = pts[max(0, i - 2)], pts[min(len(pts) - 1, i + 2)]
        cos = math.cos(math.radians(p[1]))
        dx, dy = (b[0] - a[0]) * cos, b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        ks = [k * SCAN for k in range(-int(SEARCH / SCAN), int(SEARCH / SCAN) + 1)]
        wet = [is_water(p[0] + nx * k / (111320 * cos), p[1] + ny * k / 110574) for k in ks]
        runs, start = [], None
        for j, w in enumerate(wet + [False]):
            if w and start is None:
                start = j
            if not w and start is not None:
                runs.append((ks[start], ks[j - 1]))
                start = None
        if not runs:
            offs.append(None)
            halfs.append(None)
            continue
        # nearest run to the HydroRIVERS vertex (distance 0 if the vertex lies inside it)
        r = min(runs, key=lambda r: 0 if r[0] <= 0 <= r[1] else min(abs(r[0]), abs(r[1])))
        offs.append((r[0] + r[1]) / 2)
        halfs.append(max(12.0, (r[1] - r[0] + SCAN) / 2))
    # interpolate gaps, then smooth
    def fill(v, default):
        idx = [i for i, x in enumerate(v) if x is not None]
        if not idx:
            return [default] * len(v)
        out = v[:]
        for i in range(len(v)):
            if out[i] is None:
                lo = max([j for j in idx if j < i], default=None)
                hi = min([j for j in idx if j > i], default=None)
                if lo is None:
                    out[i] = v[hi]
                elif hi is None:
                    out[i] = v[lo]
                else:
                    out[i] = v[lo] + (v[hi] - v[lo]) * (i - lo) / (hi - lo)
        return out
    found = sum(1 for o in offs if o is not None)
    offs = smooth(fill(offs, 0.0), 4)
    halfs = smooth(fill(halfs, 30.0), 6)
    coords = []
    for i, p in enumerate(pts):
        a, b = pts[max(0, i - 2)], pts[min(len(pts) - 1, i + 2)]
        cos = math.cos(math.radians(p[1]))
        dx, dy = (b[0] - a[0]) * cos, b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        coords.append([round(p[0] + nx * offs[i] / (111320 * cos), 6), round(p[1] + ny * offs[i] / 110574, 6)])
    return coords, [round(h, 1) for h in halfs], found / len(pts), offs


def nearest(c, p):
    return min(range(len(c)), key=lambda i: (c[i][0] - p[0]) ** 2 + (c[i][1] - p[1]) ** 2)


hr = json.load(open("public/data/rivers/hydrorivers_india.json"))["rivers"]
g = hr["Ganga"]["coordinates"]
reaches = {
    "ganga_gorge": g[nearest(g, [78.598, 30.146]): nearest(g, [78.3297, 30.1262]) + 3],
    "mutha": hr["Mutha"]["coordinates"],
}
out = {
    "source": "JRC Global Surface Water occurrence 1984-2021 (Pekel et al. 2016, EC JRC/Google), zoom-13 tiles; "
              "centre and width measured across HydroRIVERS v10 courses",
    "reaches": {},
}
for name, line in reaches.items():
    coords, halfs, hit, offs = refine(line)
    shift = sorted(abs(o) for o in offs)
    print(f"{name}: {len(coords)} vertices, water found at {hit*100:.0f}% of sections, "
          f"median shift {shift[len(shift)//2]:.0f} m, p90 {shift[int(len(shift)*0.9)]:.0f} m, "
          f"median width {2*sorted(halfs)[len(halfs)//2]:.0f} m")
    out["reaches"][name] = {"coordinates": coords, "halfWidthM": halfs, "waterFoundFraction": round(hit, 3)}
json.dump(out, open("public/data/rivers/channels_jrc.json", "w"))
print("wrote public/data/rivers/channels_jrc.json")
