import urllib.request
import os

url = "https://upsrtc.up.gov.in/site/writereaddata/siteContent/202306131412297723CATEGORYWISE-BUS-STN.pdf"
output_dir = r"C:\Users\Azad Singh\.gemini\antigravity-ide\brain\d5d2fdd0-9c6b-457e-a02a-fb7a8cca8c9c\scratch"
os.makedirs(output_dir, exist_ok=True)
output_path = os.path.join(output_dir, "bus_stations.pdf")

try:
    print(f"Downloading from {url}...")
    req = urllib.request.Request(
        url, 
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    )
    with urllib.request.urlopen(req) as response:
        with open(output_path, 'wb') as out_file:
            out_file.write(response.read())
    print(f"Downloaded successfully to {output_path}")
    print(f"File size: {os.path.getsize(output_path)} bytes")
except Exception as e:
    print(f"Error downloading: {e}")
