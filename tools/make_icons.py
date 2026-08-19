"""Generate the extension's PNG icons (no third-party dependencies).

Draws a simple blue rounded square with a white "pause" glyph, which reads as
"take a breath" at every icon size.
"""
import struct
import zlib
from pathlib import Path

ACCENT = (47, 109, 246)
WHITE = (255, 255, 255)
SIZES = (16, 48, 128)
OUT_DIR = Path(__file__).resolve().parent.parent / "assets"


def rounded_square_pixels(size: int):
    radius = size * 0.22
    bar_w = max(1, round(size * 0.12))
    bar_h = round(size * 0.42)
    gap = max(1, round(size * 0.1))
    left = size / 2 - gap / 2 - bar_w
    right = size / 2 + gap / 2
    top = (size - bar_h) / 2

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            # Rounded-corner test against the nearest corner circle centre.
            cx = min(max(x + 0.5, radius), size - radius)
            cy = min(max(y + 0.5, radius), size - radius)
            inside = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius**2
            if not inside:
                row += bytes((0, 0, 0, 0))
                continue
            in_bar = top <= y + 0.5 <= top + bar_h and (
                left <= x + 0.5 <= left + bar_w or right <= x + 0.5 <= right + bar_w
            )
            row += bytes(WHITE if in_bar else ACCENT) + b"\xff"
        rows.append(bytes(row))
    return rows


def write_png(path: Path, size: int) -> None:
    raw = b"".join(b"\x00" + row for row in rounded_square_pixels(size))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        write_png(OUT_DIR / f"icon{size}.png", size)
        print(f"wrote assets/icon{size}.png")
