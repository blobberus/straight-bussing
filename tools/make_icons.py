"""Generate the app icons (stdlib only). Run from the repo root: python tools/make_icons.py

Writes web/icons/icon-180.png, icon-192.png, icon-512.png (full-bleed, for iOS/any),
icon-maskable-512.png (glyph shrunk into the 80% maskable safe zone) and icon.svg.
Design: white bus front on the accent blue (docs/DESIGN.md --accent #0A84FF). Not a
university brand color on purpose (the app is unofficial).
"""
import os
import struct
import zlib

BG = (10, 132, 255)      # #0A84FF accent
FG = (255, 255, 255)
SS = 4                   # supersampling per axis (anti-aliasing)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "icons")

# Glyph in a 512x512 design space. Each part: (kind, color, params); later parts paint over earlier.
# rr = rounded rect (x0, y0, x1, y1, r); c = circle (cx, cy, r)
PARTS = [
    ("rr", FG, (160, 372, 212, 428, 14)),   # left wheel
    ("rr", FG, (300, 372, 352, 428, 14)),   # right wheel
    ("rr", FG, (128, 96, 384, 396, 56)),    # body
    ("rr", BG, (204, 118, 308, 136, 9)),    # destination sign
    ("rr", BG, (158, 156, 354, 264, 22)),   # windshield
    ("c", BG, (192, 326, 20)),              # left headlight
    ("c", BG, (320, 326, 20)),              # right headlight
]


def in_rr(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    dx = max(x0 + r - x, 0, x - (x1 - r))
    dy = max(y0 + r - y, 0, y - (y1 - r))
    return dx * dx + dy * dy <= r * r


def color_at(x, y):
    col = BG
    for kind, c, p in PARTS:
        if kind == "rr" and in_rr(x, y, *p):
            col = c
        elif kind == "c" and (x - p[0]) ** 2 + (y - p[1]) ** 2 <= p[2] ** 2:
            col = c
    return col


def render(size, scale=1.0):
    """Return raw RGB rows. scale < 1 shrinks the glyph about the center (maskable)."""
    k = 512 / size
    bbox = (128, 96, 384, 428)  # glyph bounds in design space; outside it is pure BG

    def design(px):  # pixel coord -> design coord
        return 256 + (px * k - 256) / scale

    rows = []
    n = SS * SS
    for py in range(size):
        row = bytearray(b"\x00")
        for px in range(size):
            X0, Y0 = design(px), design(py)
            X1, Y1 = design(px + 1), design(py + 1)
            if X1 < bbox[0] or X0 > bbox[2] or Y1 < bbox[1] or Y0 > bbox[3]:
                row += bytes(BG)
                continue
            r = g = b = 0
            for sy in range(SS):
                for sx in range(SS):
                    c = color_at(design(px + (sx + 0.5) / SS), design(py + (sy + 0.5) / SS))
                    r += c[0]; g += c[1]; b += c[2]
            row += bytes((round(r / n), round(g / n), round(b / n)))
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size, raw):
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def svg():
    hexc = lambda c: "#%02X%02X%02X" % c
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">', f'<rect width="512" height="512" fill="{hexc(BG)}"/>']
    for kind, c, p in PARTS:
        if kind == "rr":
            x0, y0, x1, y1, r = p
            out.append(f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="{r}" fill="{hexc(c)}"/>')
        else:
            out.append(f'<circle cx="{p[0]}" cy="{p[1]}" r="{p[2]}" fill="{hexc(c)}"/>')
    out.append("</svg>\n")
    return "".join(out)


def main():
    os.makedirs(OUT, exist_ok=True)
    for n in (180, 192, 512):
        write_png(os.path.join(OUT, f"icon-{n}.png"), n, render(n))
    # Maskable: safe zone is a centered circle of radius 40% (204.8 px at 512). Glyph corner
    # (128,96)->(384,428) reaches ~192 px from center at scale 1, so 0.8 puts it at ~154 px, well inside.
    write_png(os.path.join(OUT, "icon-maskable-512.png"), 512, render(512, scale=0.8))
    with open(os.path.join(OUT, "icon.svg"), "w", encoding="utf-8", newline="\n") as f:
        f.write(svg())
    print("wrote icons to", OUT)


if __name__ == "__main__":
    main()
