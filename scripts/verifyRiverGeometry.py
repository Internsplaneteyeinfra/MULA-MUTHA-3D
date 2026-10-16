"""
Independent sanity check of the river centerlines used by the cinematic.
For each river, measures the minimum distance (km) from the line to well-known riverside places.
Usage: python -I scripts/verifyRiverGeometry.py
"""
import json, math

def dist_km(p, q):
    la1, la2 = math.radians(p[1]), math.radians(q[1])
    dl = math.radians(q[0] - p[0]); dp = la2 - la1
    h = math.sin(dp/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dl/2)**2
    return 2*6371*math.asin(math.sqrt(h))

def min_dist(line, pt):
    # dense enough lines (~100 m spacing) -> vertex distance is adequate
    return min(dist_km(c, pt) for c in line)

CHECKS = {
    "Ganga": [("Gangotri town", 78.9398, 30.9946), ("Rishikesh", 78.2676, 30.0869), ("Prayagraj Sangam", 81.8846, 25.4246),
              ("Varanasi ghats", 83.0130, 25.3080), ("Patna", 85.1376, 25.6200)],
    "Yamuna": [("Yamunotri", 78.4600, 31.0140), ("Delhi ITO", 77.2500, 28.6290), ("Agra Taj Mahal", 78.0421, 27.1751)],
    "Brahmaputra": [("Dibrugarh", 94.9120, 27.4800), ("Guwahati", 91.7460, 26.1900)],
    "Narmada": [("Jabalpur Bhedaghat", 79.8000, 23.1300), ("Omkareshwar", 76.1500, 22.2450), ("Bharuch", 72.9800, 21.7000)],
    "Krishna": [("Mahabaleshwar", 73.6552, 17.9236), ("Sangli", 74.5600, 16.8500), ("Vijayawada Prakasam barrage", 80.6040, 16.5060)],
    "Godavari": [("Trimbakeshwar", 73.5305, 19.9325), ("Nashik Ramkund", 73.7920, 20.0069), ("Rajahmundry", 81.7800, 17.0000)],
    "Mula-Mutha": [("Pune Sangam (Mula–Mutha confluence)", 73.8640, 18.5290), ("Bund Garden", 73.8800, 18.5370)],
}

hr = json.load(open("public/data/rivers/hydrorivers_india.json"))["rivers"]
mm = json.load(open("public/data/river.geojson"))
kml = next(f for f in mm["features"] if f.get("id") == "kml_river_centerline")["geometry"]["coordinates"]

print(f"{'river':12s} {'place':38s} {'HydroRIVERS km':>14s}")
for r, pts in CHECKS.items():
    for name, lon, lat in pts:
        print(f"{r:12s} {name:38s} {min_dist(hr[r]['coordinates'], (lon, lat)):14.2f}")

# Mula-Mutha: HydroRIVERS vs surveyed KML centerline (Pune reach)
d = [min_dist(hr["Mula-Mutha"]["coordinates"], c) for c in kml[::10]]
d.sort()
print(f"\nMula–Mutha KML centerline vs HydroRIVERS: median {d[len(d)//2]:.2f} km, p90 {d[int(len(d)*0.9)]:.2f} km, max {d[-1]:.2f} km")
for k, v in hr.items():
    c = v["coordinates"]
    L = sum(dist_km(c[i-1], c[i]) for i in range(1, len(c)))
    print(f"{k:12s} traced length {L:7.0f} km  start {c[0]}  end {c[-1]}")
