"""
Build real river centerlines for the RIVER.EYE cinematic from HydroRIVERS v10 (HydroSHEDS, Asia).
Each river is traced downstream from a documented source coordinate by following HydroRIVERS' NEXT_DOWN
topology, so no tributary connections are invented. Output: public/data/rivers/hydrorivers_india.json

Usage: python -I scripts/buildRiverCenterlines.py <HydroRIVERS_v10_as.shp>
"""
import json, math, sys, shapefile  # pyshp

SRC = sys.argv[1]
OUT = "public/data/rivers/hydrorivers_india.json"

# name -> (source lon, lat, description). Coordinates are the widely documented river sources.
SOURCES = {
    "Ganga":       (79.0787, 30.9226, "Gaumukh (Gangotri glacier) -> Bhagirathi -> Ganga"),
    "Yamuna":      (78.4597, 31.0138, "Yamunotri -> confluence with Ganga at Prayagraj"),
    "Brahmaputra": (88.8800, 29.2500, "Yarlung Tsangpo near Shigatse (anchor, traced upstream by largest catchment) -> Brahmaputra"),
    "Krishna":     (73.6552, 17.9236, "Mahabaleshwar"),
    "Narmada":     (80.3800, 22.6000, "Mandla (anchor, traced upstream by largest catchment toward Amarkantak) -> Gulf of Khambhat"),
    "Godavari":    (73.5305, 19.9325, "Trimbakeshwar (Nashik)"),
    "Mula-Mutha":  (73.5000, 18.5100, "Mula headwaters (Mulshi) -> Sangam (Pune) -> Bhima"),
    "Mutha":       (73.7760, 18.4450, "Below Khadakwasla Dam -> joins the Mula at the Pune Sangam"),
}

def d2(a, b):
    dx = (a[0]-b[0])*math.cos(math.radians(a[1])); dy = a[1]-b[1]
    return dx*dx+dy*dy

r = shapefile.Reader(SRC)
fields = [f[0] for f in r.fields[1:]]
ix = {n: i for i, n in enumerate(fields)}
print("fields", fields, "records", len(r))
segs = {}
# bbox filter India + Tibet headwaters + Bangladesh
for sr in r.iterShapeRecords():
    rec = sr.record
    pts = sr.shape.points
    if not pts: continue
    lon, lat = pts[0]
    if not (66 <= lon <= 98 and 6 <= lat <= 37): continue
    segs[rec[ix["HYRIV_ID"]]] = dict(id=rec[ix["HYRIV_ID"]], nd=rec[ix["NEXT_DOWN"]], q=rec[ix["DIS_AV_CMS"]],
                                      up=rec[ix["UPLAND_SKM"]], pts=pts)
print("segments in bbox", len(segs))

# spatial lookup by coarse grid over segment vertices
grid = {}
for s in segs.values():
    for p in s["pts"]:
        grid.setdefault((int(p[0]*20), int(p[1]*20)), []).append((s["id"], p))
def nearest(lon, lat, minq=0.0):
    best = None
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            for sid, p in grid.get((int(lon*20)+dx, int(lat*20)+dy), []):
                if segs[sid]["q"] < minq: continue
                dd = d2(p, (lon, lat))
                if best is None or dd < best[0]: best = (dd, sid)
    return best

MINQ = {"Brahmaputra": 200.0, "Narmada": 20.0}
UPSTREAM = {"Brahmaputra", "Narmada"}
prev = {}
for s_ in segs.values():
    if s_["nd"]: prev.setdefault(s_["nd"], []).append(s_["id"])
# stop the Mula-Mutha trace after it reaches the Bhima (keeps the featured reach, avoids tracing to the Krishna)
STOP_LON = {"Mula-Mutha": 74.45}

out = {"source": "HydroRIVERS v10 (Lehner & Grill 2013), HydroSHEDS, https://www.hydrosheds.org", "rivers": {}}
used = {}
for name, (lon, lat, desc) in SOURCES.items():
    b = nearest(lon, lat, minq=MINQ.get(name, 0.0))
    if not b: print("NO SEGMENT near", name); continue
    cur = b[1]; line = []; q = []; seen = []
    if name in UPSTREAM:
        while prev.get(cur):
            cur = max(prev[cur], key=lambda i: segs[i]["up"])
    print(name, "start seg", cur, "dist_deg", math.sqrt(b[0]))
    while cur and cur in segs:
        if cur in used and used[cur] != name:   # reached another traced river (e.g. Yamuna -> Ganga)
            print("  joins", used[cur], "at seg", cur); line.append(segs[cur]["pts"][0]); q.append(segs[cur]["q"]); break
        used[cur] = name
        s = segs[cur]
        if name in STOP_LON and s["pts"][0][0] > STOP_LON[name]: break
        pts = s["pts"] if not line else s["pts"][1:]
        line.extend(pts); q.extend([s["q"]]*len(pts)); seen.append(cur)
        cur = s["nd"]
    # simplify slightly (drop points closer than ~100 m)
    keep = [0]
    for i in range(1, len(line)):
        if d2(line[i], line[keep[-1]]) > (0.0009)**2 or i == len(line)-1: keep.append(i)
    out["rivers"][name] = {
        "description": desc, "segments": len(seen),
        "coordinates": [[round(line[i][0], 5), round(line[i][1], 5)] for i in keep],
        "dischargeCms": [round(q[i], 2) for i in keep],
    }
    L = sum(math.sqrt(d2(line[i], line[i-1]))*111.2 for i in range(1, len(line)))
    print("  points", len(keep), "approx length km", round(L), "end", line[-1])
json.dump(out, open(OUT, "w"))
print("wrote", OUT)
