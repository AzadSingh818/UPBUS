import json
import urllib.request
import urllib.parse
import time
import os

input_json_path = r"C:\Users\Azad Singh\.gemini\antigravity-ide\brain\d5d2fdd0-9c6b-457e-a02a-fb7a8cca8c9c\scratch\bus_stations.json"
output_json_path = r"C:\Users\Azad Singh\.gemini\antigravity-ide\brain\d5d2fdd0-9c6b-457e-a02a-fb7a8cca8c9c\scratch\bus_stations_geocoded.json"

# Load parsed stations
with open(input_json_path, 'r', encoding='utf-8') as f:
    stations = json.load(f)

# Load existing progress if any
geocoded_stations = []
if os.path.exists(output_json_path):
    try:
        with open(output_json_path, 'r', encoding='utf-8') as f:
            geocoded_stations = json.load(f)
        print(f"Loaded {len(geocoded_stations)} already geocoded stations.")
    except Exception as e:
        print(f"Could not load existing file: {e}")

geocoded_names = {s["name"]: s for s in geocoded_stations}

# Cache for district centers
district_centers = {}

def fetch_coordinates(query_str):
    try:
        url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(query_str)}&format=json&limit=1"
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'UPBus-Live-Tracker-Seeding (azadsingh818@gmail.com)'}
        )
        time.sleep(1.2) # Nominatim policy: max 1 request per second
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            if data:
                return float(data[0]["lat"]), float(data[0]["lon"]), data[0].get("display_name", "")
    except Exception as e:
        print(f"Error querying Nominatim for '{query_str}': {e}")
    return None

total = len(stations)
start_time = time.time()

for idx, s in enumerate(stations):
    name = s["name"]
    district = s["district"]
    
    # Skip if already geocoded
    if name in geocoded_names:
        continue
        
    print(f"[{idx+1}/{total}] Geocoding: {name} (District: {district})...")
    
    coords = None
    # Attempt 1: Just Name (Most likely to succeed first for towns)
    coords = fetch_coordinates(f"{name}, {district}, Uttar Pradesh, India")
    
    # Attempt 2: Bus Stand
    if not coords:
      coords = fetch_coordinates(f"{name} Bus Stand, {district}, Uttar Pradesh, India")
        
    # Attempt 3: Bus Station
    if not coords:
      coords = fetch_coordinates(f"{name} Bus Station, {district}, Uttar Pradesh, India")
        
    if coords:
        lat, lon, display_name = coords
        print(f"  Found: {lat}, {lon} ({display_name[:50]}...)")
        s["latitude"] = lat
        s["longitude"] = lon
        s["geocoded_status"] = "exact"
    else:
        # Fallback: District center
        print(f"  Exact location not found. Falling back to District Center: {district}")
        if district in district_centers:
            lat, lon = district_centers[district]
        else:
            dist_coords = fetch_coordinates(f"{district}, Uttar Pradesh, India")
            if dist_coords:
                lat, lon, _ = dist_coords
                district_centers[district] = (lat, lon)
            else:
                # Absolute fallback if even district fails (center of UP)
                lat, lon = 26.8467, 80.9462 # Lucknow
                district_centers[district] = (lat, lon)
        s["latitude"] = lat
        s["longitude"] = lon
        s["geocoded_status"] = "district_fallback"
        
    geocoded_stations.append(s)
    geocoded_names[name] = s
    
    # Save progress after each iteration
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(geocoded_stations, f, indent=2, ensure_ascii=False)

print(f"Geocoding finished in {time.time() - start_time:.2f} seconds.")
