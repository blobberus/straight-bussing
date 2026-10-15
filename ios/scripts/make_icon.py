#!/usr/bin/env python3
"""Make the App Store icon (1024x1024, opaque PNG) from the owner's icon, straight-bussing-icon-LARGE.png at the repo
root (2026-10-15: a white bird on a bus on teal), so the iPhone app uses the same icon as the web app without a second
copy in git (tools/make_icons.py makes the web sizes from the same file). Apple wants no transparency: any is put on
the picture's own corner color. Usage: python3 ios/scripts/make_icon.py [out.png]
Exit code 2 when Pillow is missing (ios/scripts/bootstrap.sh then falls back to `sips` upscaling icon-512.png).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "straight-bussing-icon-LARGE.png")
OUT = os.path.join(ROOT, "ios", "App", "Resources", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-1024.png")
SIZE = 1024


def main():
    try:
        from PIL import Image
    except ImportError:
        print("Pillow not installed", file=sys.stderr)
        return 2
    out = sys.argv[1] if len(sys.argv) > 1 else OUT
    im = Image.open(SRC).convert("RGBA")
    if im.width != im.height:
        print(f"{os.path.basename(SRC)} must be square (is {im.width} x {im.height})", file=sys.stderr)
        return 1
    bg = Image.new("RGBA", im.size, im.getpixel((0, 0))[:3] + (255,))
    im = Image.alpha_composite(bg, im).convert("RGB")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.resize((SIZE, SIZE), Image.LANCZOS).save(out, "PNG")
    print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
