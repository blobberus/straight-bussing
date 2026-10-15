"""Make the web app icons from the owner's icon. Run from the repo root: python tools/make_icons.py (needs Pillow:
pip install pillow).

Source: straight-bussing-icon-LARGE.png at the repo root (owner, 2026-10-15: a white bird on a bus on teal, square,
1000 x 1000). To change the icon, replace that file (square, at least 512 px, opaque) and run this again; the iPhone
app's icon is made from the same file by ios/scripts/make_icon.py on every CI build.

Writes web/icons/: icon-180.png (Home Screen on iPhone), icon-192.png and icon-512.png (full-bleed, purpose "any"),
icon-maskable-512.png (the picture at 80% on the source's own background color, so Android's round or squircle mask
never cuts it) and icon-32.png (browser tab). All opaque RGB, resampled with Lanczos.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "straight-bussing-icon-LARGE.png")
OUT = os.path.join(ROOT, "web", "icons")
SIZES = {"icon-32.png": 32, "icon-180.png": 180, "icon-192.png": 192, "icon-512.png": 512}
MASKABLE = 0.8   # the maskable safe zone: a circle of 40% radius, the picture fits inside at 80%


def load(path=SRC):
    from PIL import Image
    im = Image.open(path)
    if im.width != im.height or im.width < 512:
        raise SystemExit(f"{os.path.basename(path)} must be square and at least 512 px (is {im.width} x {im.height})")
    im = im.convert("RGBA")
    bg = Image.new("RGBA", im.size, im.getpixel((0, 0))[:3] + (255,))   # any transparency onto its own corner color
    return Image.alpha_composite(bg, im).convert("RGB")


def render(im, size, scale=1.0):
    from PIL import Image
    if scale >= 1:
        return im.resize((size, size), Image.LANCZOS)
    out = Image.new("RGB", (size, size), im.getpixel((0, 0)))
    inner = round(size * scale)
    out.paste(im.resize((inner, inner), Image.LANCZOS), ((size - inner) // 2, (size - inner) // 2))
    return out


def main():
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("Pillow is needed: pip install pillow", file=sys.stderr)
        return 2
    im = load()
    os.makedirs(OUT, exist_ok=True)
    for name, size in SIZES.items():
        render(im, size).save(os.path.join(OUT, name), "PNG", optimize=True)
    render(im, 512, MASKABLE).save(os.path.join(OUT, "icon-maskable-512.png"), "PNG", optimize=True)
    print("wrote", ", ".join(list(SIZES) + ["icon-maskable-512.png"]), "in web/icons from", os.path.basename(SRC))
    return 0


if __name__ == "__main__":
    sys.exit(main())
