from pypdf import PdfReader
import re
import json

pdf_path = r"C:\Users\Azad Singh\.gemini\antigravity-ide\brain\d5d2fdd0-9c6b-457e-a02a-fb7a8cca8c9c\scratch\bus_stations.pdf"
output_json_path = r"C:\Users\Azad Singh\.gemini\antigravity-ide\brain\d5d2fdd0-9c6b-457e-a02a-fb7a8cca8c9c\scratch\bus_stations.json"

reader = PdfReader(pdf_path)
stations = []
errors = []

for page_idx, page in enumerate(reader.pages):
    text = page.extract_text()
    for line in text.split('\n'):
        line = line.strip()
        if not re.match(r'^\d+\s+', line):
            continue
            
        # Parse line
        words = line.split()
        if len(words) < 4:
            errors.append((page_idx + 1, line, "Too few words"))
            continue
            
        serial_no = int(words[0])
        
        # Check if category is "SUPER A" (two words) or single letter (A, B, C, D)
        if words[-2] == "SUPER" and words[-1] == "A":
            category = "SUPER A"
            district = words[-3]
            name_words = words[1:-3]
        else:
            category = words[-1]
            district = words[-2]
            name_words = words[1:-2]
            
        station_name = " ".join(name_words)
        
        # Verify fields
        if not station_name or not district or len(category) > 7:
            errors.append((page_idx + 1, line, "Validation failed"))
            continue
            
        stations.append({
            "serial_no": serial_no,
            "name": station_name,
            "district": district,
            "category": category,
            "page": page_idx + 1
        })

print(f"Total stations parsed: {len(stations)}")
print(f"Total parsing errors: {len(errors)}")

if errors:
    print("Errors:")
    for err in errors[:10]:
        print(f"Page {err[0]}: '{err[1]}' -> {err[2]}")

# Save to JSON
with open(output_json_path, 'w', encoding='utf-8') as f:
    json.dump(stations, f, indent=2, ensure_ascii=False)
print(f"Saved to {output_json_path}")
