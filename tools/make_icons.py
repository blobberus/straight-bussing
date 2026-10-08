"""Generate PNG app icons (stdlib only). Run: python tools/make_icons.py"""
import struct, zlib, os
def png(size, path):
    s = size / 512
    def px(x, y):
        X, Y = x / s, y / s
        if 96 <= X <= 416 and 120 <= Y <= 350:
            if 128 <= X <= 384 and 152 <= Y <= 248: return (128, 0, 0)
            if 128 <= X <= 384 and 276 <= Y <= 300: return (128, 0, 0)
            return (255, 255, 255)
        for cx in (170, 342):
            if (X - cx) ** 2 + (Y - 390) ** 2 <= 34 ** 2: return (255, 255, 255)
        return (128, 0, 0)
    raw = b"".join(b"\x00" + b"".join(bytes(px(x, y)) for x in range(size)) for y in range(size))
    def ch(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw, 9)) + ch(b"IEND", b""))
os.makedirs("web/icons", exist_ok=True)
for n in (180, 192, 512): png(n, f"web/icons/icon-{n}.png")
