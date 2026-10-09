#!/usr/bin/env python3
"""Render the App Store icon (1024x1024, opaque PNG) from web/icons/icon.svg, so the iPhone app uses the same
icon as the web app without a second copy in git. The SVG only uses <rect> (with rx) and <circle>, which this
renders with Pillow at 4x and downsamples. Usage: python3 ios/scripts/make_icon.py [out.png]
Exit code 2 when Pillow is missing (ios/scripts/bootstrap.sh then falls back to `sips` upscaling icon-512.png).
"""
import os
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SVG = os.path.join(ROOT, "web", "icons", "icon.svg")
OUT = os.path.join(ROOT, "ios", "App", "Resources", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-1024.png")
SIZE, SS = 1024, 4


def main():
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("Pillow not installed", file=sys.stderr)
        return 2
    out = sys.argv[1] if len(sys.argv) > 1 else OUT
    root = ET.parse(SVG).getroot()
    vb = [float(v) for v in root.get("viewBox", "0 0 512 512").split()]
    k = SIZE * SS / vb[2]
    img = Image.new("RGB", (SIZE * SS, SIZE * SS), "white")
    d = ImageDraw.Draw(img)
    for el in root:
        tag = el.tag.split("}")[-1]
        fill = el.get("fill", "#000000")
        if tag == "rect":
            x, y = float(el.get("x", 0)) * k, float(el.get("y", 0)) * k
            w, h = float(el.get("width")) * k, float(el.get("height")) * k
            rx = float(el.get("rx", 0)) * k
            d.rounded_rectangle([x, y, x + w, y + h], radius=rx, fill=fill)
        elif tag == "circle":
            cx, cy, r = (float(el.get(a)) * k for a in ("cx", "cy", "r"))
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.resize((SIZE, SIZE), Image.LANCZOS).save(out, "PNG")
    print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
