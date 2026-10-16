"""Make the web app icons from the owner's icon. Run from the repo root: python tools/make_icons.py (needs Pillow:
pip install pillow).

Source: straight-bussing-icon-LARGE.png at the repo root (owner, 2026-10-15: a white bird on a bus on teal, square,
1000 x 1000). To change the icon, replace that file (square, at least 512 px, opaque) and run this again; the iPhone
app's icon is made from the same file by ios/scripts/make_icon.py on every CI build.

Rounded corners (owner 2026-10-15: "round the corners of the image slightly like an app"): the icons a system shows
as they are get the iPhone's continuous-corner shape (a superellipse, transparent outside): icon-32.png (browser tab),
icon-192.png / icon-512.png (purpose "any": desktop installs) and straight-bussing-icon-rounded.png at the repo root
(full size, for the poster). The ones a system rounds itself stay square and opaque, or the corners would be doubled
or turn black: icon-180.png (iPhone Home Screen), icon-maskable-512.png (Android: the picture at 80% on its own teal,
inside the mask's safe zone) and the App Store icon (Apple wants it square, no transparency). Lanczos resampling.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "straight-bussing-icon-LARGE.png")
ROUNDED = os.path.join(ROOT, "straight-bussing-icon-rounded.png")
OUT = os.path.join(ROOT, "web", "icons")
SQUARE = {"icon-180.png": 180}                                     # iOS rounds the Home Screen icon itself
ROUND = {"icon-32.png": 32, "icon-192.png": 192, "icon-512.png": 512}   # shown as drawn
MASKABLE = 0.8   # the maskable safe zone: a circle of 40% radius, the picture fits inside at 80%
SQUIRCLE_N = 5.0  # |x|^n + |y|^n <= 1: close to the iPhone's continuous corners (n = 2 would be a circle)
SS = 4            # supersampling of the corner mask (smooth edges)


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


def squircle_mask(size, n=SQUIRCLE_N):
    """An L mask of the app-icon shape, supersampled then reduced (anti-aliased edge)."""
    from PIL import Image
    big = size * SS
    half = (big - 1) / 2
    rows = []
    for y in range(big):
        v = abs((y - half) / half) ** n
        # |x| limit on this row: (1 - |y|^n)^(1/n), as a pixel span around the center
        w = (1 - v) ** (1 / n) * half if v < 1 else -1
        lo, hi = half - w, half + w
        rows.append(bytes(255 if lo <= x <= hi else 0 for x in range(big)))
    return Image.frombytes("L", (big, big), b"".join(rows)).resize((size, size), Image.LANCZOS)


def rounded(im, size):
    out = render(im, size).convert("RGBA")
    out.putalpha(squircle_mask(size))
    return out


def main():
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("Pillow is needed: pip install pillow", file=sys.stderr)
        return 2
    im = load()
    os.makedirs(OUT, exist_ok=True)
    for name, size in SQUARE.items():
        render(im, size).save(os.path.join(OUT, name), "PNG", optimize=True)
    for name, size in ROUND.items():
        rounded(im, size).save(os.path.join(OUT, name), "PNG", optimize=True)
    render(im, 512, MASKABLE).save(os.path.join(OUT, "icon-maskable-512.png"), "PNG", optimize=True)
    rounded(im, im.width).save(ROUNDED, "PNG", optimize=True)
    print("wrote", ", ".join(list(SQUARE) + list(ROUND) + ["icon-maskable-512.png"]), "in web/icons and",
          os.path.basename(ROUNDED), "from", os.path.basename(SRC))
    return 0


if __name__ == "__main__":
    sys.exit(main())
