import pandas as pd
import json
import math
import sys
from scipy.spatial import KDTree
import numpy as np

# Coordinates to approximate meters for lateral offset (rough spherical Earth approximation)
def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0)**2 + \
        math.cos(phi1) * math.cos(phi2) * \
        math.sin(delta_lambda / 2.0)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def calculate_bearing(lat1, lon1, lat2, lon2):
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)
    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - \
        math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    return math.degrees(math.atan2(y, x))

def main():
    print("Loading chainage profile...")
    with open('public/data/naditwin/chainage_profile.json', 'r') as f:
        chainage_data = json.load(f)
    
    # chainage_data is array of {chainage_m, lat, lon}
    # build kdtree for fast lookup
    stations = []
    for c in chainage_data:
        # Check structure
        if isinstance(c, dict) and 'lat' in c and 'lon' in c:
            stations.append([c['lat'], c['lon'], c.get('chainage_m', c.get('chainage', 0))])
        elif isinstance(c, dict) and 'latitude' in c and 'longitude' in c:
            stations.append([c['latitude'], c['longitude'], c.get('chainage_m', c.get('chainage', 0))])
    
    if not stations:
        # Fallback to depth_profile.json if chainage_profile is different
        with open('public/data/naditwin/depth_profile.json', 'r') as f:
            depth_data = json.load(f)
            for d in depth_data:
                stations.append([d['lat'], d['lon'], d['chainage_m']])
    
    stations = sorted(stations, key=lambda x: x[2]) # sort by chainage
    coords = np.array([[s[0], s[1]] for s in stations])
    tree = KDTree(coords)

    print("Loading raw bathymetry observations...")
    df = pd.read_excel('public/data/naditwin/mula_mutha_water_depth.xlsx', sheet_name='Water Depth Points')
    
    results = []
    failed = 0
    cross_sections = {}
    
    for i, row in df.iterrows():
        lat = row['Latitude']
        lon = row['Longitude']
        depth = row['Depth (m)']
        
        if pd.isna(lat) or pd.isna(lon) or pd.isna(depth):
            failed += 1
            continue
            
        # find nearest station
        dist, idx = tree.query([lat, lon])
        station_lat = stations[idx][0]
        station_lon = stations[idx][1]
        chainage = stations[idx][2]
        
        # calculate lateral offset using cross track distance or simple bearing diff
        # For simplicity, calculate bearing of the river segment
        if idx < len(stations) - 1:
            next_lat, next_lon = stations[idx+1][0], stations[idx+1][1]
        elif idx > 0:
            next_lat, next_lon = station_lat, station_lon
            station_lat, station_lon = stations[idx-1][0], stations[idx-1][1]
        else:
            next_lat, next_lon = station_lat, station_lon
            
        river_bearing = calculate_bearing(station_lat, station_lon, next_lat, next_lon)
        point_bearing = calculate_bearing(station_lat, station_lon, lat, lon)
        
        dist_m = haversine(station_lat, station_lon, lat, lon)
        angle_diff = math.radians(point_bearing - river_bearing)
        
        # Signed lateral offset (right is positive, left is negative, depending on angle)
        lateral_offset = dist_m * math.sin(angle_diff)
        
        pt = {
            "id": i,
            "latitude": lat,
            "longitude": lon,
            "chainageMeters": float(chainage),
            "lateralOffsetMeters": float(lateral_offset),
            "depthM": float(depth)
        }
        results.append(pt)
        
        ch_key = str(chainage)
        if ch_key not in cross_sections:
            cross_sections[ch_key] = {
                "chainageMeters": float(chainage),
                "points": []
            }
        cross_sections[ch_key]["points"].append(pt)

    cs_list = sorted(list(cross_sections.values()), key=lambda x: x['chainageMeters'])
    
    output = {
        "source": "mula_mutha_water_depth.xlsx",
        "sourcePointCount": len(df),
        "validPointCount": len(results),
        "failedProjectionCount": failed,
        "crs": "WGS84",
        "projection": "EPSG:32643 (implicit relative)",
        "provenance": "OBSERVED",
        "minChainageMeters": min(r['chainageMeters'] for r in results),
        "maxChainageMeters": max(r['chainageMeters'] for r in results),
        "minLateralOffsetMeters": min(r['lateralOffsetMeters'] for r in results),
        "maxLateralOffsetMeters": max(r['lateralOffsetMeters'] for r in results),
        "minDepthM": min(r['depthM'] for r in results),
        "maxDepthM": max(r['depthM'] for r in results),
        "crossSectionCount": len(cs_list),
        "crossSections": cs_list,
        "points": results
    }
    
    with open('public/data/naditwin/raw_bathymetry_cloud.json', 'w') as f:
        json.dump(output, f)
        
    print(f"Generated raw_bathymetry_cloud.json with {len(results)} valid points across {len(cs_list)} cross-sections.")

if __name__ == "__main__":
    main()
