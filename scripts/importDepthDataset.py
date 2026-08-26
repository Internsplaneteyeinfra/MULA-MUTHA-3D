import csv
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

XLSX = Path(r"c:\Users\Sahil.Rajankar\Downloads\mula_mutha_water_depth.xlsx")
KMZ = Path(r"c:\Users\Sahil.Rajankar\Downloads\mula_mutha_depth_2d.kmz")
OUT = Path(r"c:\Users\Sahil.Rajankar\Desktop\Shweta\Shweta_River\mula-mutha-cinematic\public\data")
OUT.mkdir(parents=True, exist_ok=True)


def col_letter(cell_ref):
    return re.sub(r"\d+", "", cell_ref)


def xlsx_to_csv():
    with zipfile.ZipFile(XLSX) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            for si in root.findall("m:si", ns):
                texts = [t.text or "" for t in si.findall(".//m:t", ns)]
                shared.append("".join(texts))
        sheet_name = next(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))
        root = ET.fromstring(z.read(sheet_name))
        ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        print("sheets", [n for n in z.namelist() if n.startswith("xl/worksheets")])
        rows = []
        for row in root.findall("m:sheetData/m:row", ns):
            cells = {}
            for c in row.findall("m:c", ns):
                ref = c.get("r")
                letter = col_letter(ref)
                t = c.get("t")
                v = c.find("m:v", ns)
                if v is None or v.text is None:
                    continue
                val = v.text
                if t == "s":
                    val = shared[int(val)]
                cells[letter] = val
            if cells:
                rows.append(cells)
    header = rows[0]
    keys = sorted(header.keys(), key=lambda k: (len(k), k))
    print("first5", rows[:5])
    print("n rows", len(rows))
    # Headerless export: A=lat, B=lon, C=depth
    a0 = float(rows[0].get("A", "0"))
    b0 = float(rows[0].get("B", "0"))
    start = 0
    if not (10 < a0 < 30 and 70 < b0 < 80):
        start = 1
        print("using header row", rows[0])
    out_csv = OUT / "mula_mutha_water_depth.csv"
    n = 0
    depths = []
    lats = []
    lons = []
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["latitude", "longitude", "depth_m"])
        for row in rows[start:]:
            try:
                lat = float(row["A"])
                lon = float(row["B"])
                depth = float(row["C"])
            except (KeyError, ValueError, TypeError):
                continue
            if depth <= 0:
                continue
            w.writerow([f"{lat:.8f}", f"{lon:.8f}", f"{depth:.8f}"])
            n += 1
            depths.append(depth)
            lats.append(lat)
            lons.append(lon)
    print("points", n)
    print("depth", min(depths), max(depths))
    print("lat", min(lats), max(lats))
    print("lon", min(lons), max(lons))
    slats = sorted(set(round(x, 8) for x in lats))
    if len(slats) > 2:
        dlat = sorted(slats[i + 1] - slats[i] for i in range(min(20, len(slats) - 1)))
        print("unique lats", len(slats), "sample dlat", dlat[:5])
    return n


def extract_kmz():
    dest = OUT / "kmz_overlay"
    dest.mkdir(exist_ok=True)
    with zipfile.ZipFile(KMZ) as z:
        print("kmz files", z.namelist())
        z.extractall(dest)
    kmls = list(dest.rglob("*.kml"))
    print("kmls", kmls)
    for kml in kmls:
        text = kml.read_text(encoding="utf-8", errors="ignore")
        print("---", kml.name, "len", len(text))
        print(text[:2500])
        for tag in ["north", "south", "east", "west", "href", "GroundOverlay", "LatLonBox"]:
            if tag.lower() in text.lower():
                print("has", tag)


if __name__ == "__main__":
    xlsx_to_csv()
    extract_kmz()
