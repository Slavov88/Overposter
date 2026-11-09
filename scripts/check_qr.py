"""Decode the sample's vector QR from the compiled PDF."""
import json
import sys
from pathlib import Path
import cv2
import numpy as np
import pymupdf

pdf_path, config_path = map(Path, sys.argv[1:3])
config = json.loads(config_path.read_text(encoding="utf-8"))
expected = config["paperUrl"]
if expected.startswith("10."):
    expected = "https://doi.org/" + expected
with pymupdf.open(pdf_path) as document:
    if document.page_count != 1:
        raise SystemExit("Expected a one-page poster")
    pixmap = document[0].get_pixmap(alpha=False)
    pixels = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(
        pixmap.height, pixmap.width, pixmap.n
    )
    decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(pixels)
if decoded != expected:
    raise SystemExit(f"QR payload mismatch: expected {expected!r}, got {decoded!r}")
print(f"QR decoded: {decoded}")
