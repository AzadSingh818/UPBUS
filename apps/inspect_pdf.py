from pypdf import PdfReader
import os

pdf_path = r"C:\Users\Azad Singh\.gemini\antigravity-ide\brain\d5d2fdd0-9c6b-457e-a02a-fb7a8cca8c9c\scratch\bus_stations.pdf"

try:
    reader = PdfReader(pdf_path)
    print(f"Total pages: {len(reader.pages)}")
    
    # Extract text from the first page
    first_page_text = reader.pages[0].extract_text()
    print("\n--- FIRST PAGE TEXT PREVIEW ---")
    print(first_page_text[:1500])
    
except Exception as e:
    print(f"Error reading PDF: {e}")
