from pypdf import PdfReader
import re

pdf_path = r"C:\Users\Azad Singh\Delta\.. (corrected absolute path)"
# We'll use the correct absolute path
pdf_path = r"C:\Users\Azad Singh\.gemini\antigravity-ide\brain\d5d2fdd0-9c6b-457e-a02a-fb7a8cca8c9c\scratch\bus_stations.pdf"

reader = PdfReader(pdf_path)
all_lines = []

for page_idx, page in enumerate(reader.pages):
    text = page.extract_text()
    for line in text.split('\n'):
        line = line.strip()
        if re.match(r'^\d+\s+', line):
            all_lines.append((page_idx + 1, line))

print(f"Total lines matched: {len(all_lines)}")
print("Sample matches:")
for page_num, line in all_lines[:100]:
    print(f"Page {page_num}: {line}")
