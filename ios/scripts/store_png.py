#!/usr/bin/env python3
"""Make the App Store screenshot set upload-ready: App Store Connect rejects PNGs with an alpha channel, so every
PNG in <dir> is flattened to RGB in place, and its size is checked against the 6.9-inch display class
(1320 x 2868, 1290 x 2796 or 1260 x 2736 portrait). Writes <dir>/sizes.json for the gallery page.
Usage: python3 ios/scripts/store_png.py preview/store"""
import json
import os
import sys

from PIL import Image

OK_SIZES = {(1320, 2868), (1290, 2796), (1260, 2736)}


def main():
    d = sys.argv[1]
    sizes = {}
    bad = 0
    for f in sorted(os.listdir(d)):
        if not f.endswith(".png"):
            continue
        p = os.path.join(d, f)
        im = Image.open(p)
        if im.mode != "RGB":
            if "A" in im.getbands():
                bg = Image.new("RGB", im.size, (252, 252, 253))
                bg.paste(im, mask=im.getchannel("A"))
                im = bg
            else:
                im = im.convert("RGB")
            im.save(p, optimize=True)
        sizes[f] = list(im.size)
        ok = tuple(im.size) in OK_SIZES
        bad += 0 if ok else 1
        print(f"{f}: {im.size[0]} x {im.size[1]} {'ok' if ok else 'NOT a 6.9-inch size'}")
    with open(os.path.join(d, "sizes.json"), "w", encoding="utf-8") as fh:
        json.dump(sizes, fh, indent=1)
    if bad:
        print(f"warning: {bad} screenshot(s) are not a 6.9-inch App Store size", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
