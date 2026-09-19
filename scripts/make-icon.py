#!/usr/bin/env python3
"""Generate the YT Grab app icon.

Draws an original mark — a downward play triangle resting on a tray bar,
i.e. "play, saved to disk" — on a rounded squircle in the app's palette.
Renders at 4x and downsamples for clean edges, then packs the sizes macOS
wants into build/icon.icns (plus build/icon.png for other platforms).

Run:  python3 scripts/make-icon.py
"""

import struct
import zlib
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

S = 4                      # supersampling factor
BASE = 1024                # final master size
CANVAS = BASE * S

BG_TOP = (39, 43, 52)      # #272b34
BG_BOTTOM = (18, 20, 24)   # #121418
ACCENT = (224, 72, 60)     # #e0483c — the app's accent red
TRAY = (232, 234, 237)     # #e8eaed — the app's text colour


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def vertical_gradient(size, top, bottom):
    grad = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        grad.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return grad.resize((size, size), Image.BICUBIC)


def build_master():
    # macOS Big Sur icons sit inside the canvas with transparent margin.
    margin = round(CANVAS * 0.094)
    box = CANVAS - margin * 2
    radius = round(box * 0.2237)   # Apple's squircle-ish corner ratio

    icon = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

    plate = vertical_gradient(box, BG_TOP, BG_BOTTOM).convert("RGBA")
    plate.putalpha(rounded_mask(box, radius))

    # Hairline top highlight so the plate reads as a lit surface.
    gloss = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    ImageDraw.Draw(gloss).rounded_rectangle(
        [0, 0, box - 1, box - 1], radius=radius, outline=(255, 255, 255, 26), width=max(1, S * 2)
    )
    plate.alpha_composite(gloss)
    icon.alpha_composite(plate, (margin, margin))

    d = ImageDraw.Draw(icon)
    cx = CANVAS // 2

    # Downward play triangle — "play" turned into "download".
    tri_w = round(box * 0.46)
    tri_h = round(box * 0.34)
    tri_top = margin + round(box * 0.235)
    d.polygon(
        [
            (cx - tri_w // 2, tri_top),
            (cx + tri_w // 2, tri_top),
            (cx, tri_top + tri_h),
        ],
        fill=ACCENT,
    )

    # Tray bar it lands on.
    bar_w = round(box * 0.46)
    bar_h = round(box * 0.072)
    bar_top = tri_top + tri_h + round(box * 0.085)
    d.rounded_rectangle(
        [cx - bar_w // 2, bar_top, cx + bar_w // 2, bar_top + bar_h],
        radius=bar_h // 2,
        fill=TRAY,
    )

    return icon.resize((BASE, BASE), Image.LANCZOS)


def png_bytes(img, size):
    buf = BytesIO()
    img.resize((size, size), Image.LANCZOS).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# (icns type, pixel size) — 1x and 2x variants share sizes by design.
ICNS_ENTRIES = [
    (b"icp4", 16),
    (b"icp5", 32),
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic07", 128),
    (b"ic13", 256),
    (b"ic08", 256),
    (b"ic14", 512),
    (b"ic09", 512),
    (b"ic10", 1024),
]


def write_icns(master, path):
    chunks = b"".join(
        kind + struct.pack(">I", len(data) + 8) + data
        for kind, size in ICNS_ENTRIES
        for data in (png_bytes(master, size),)
    )
    path.write_bytes(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


def main():
    BUILD.mkdir(exist_ok=True)
    master = build_master()
    master.save(BUILD / "icon.png", format="PNG", optimize=True)
    write_icns(master, BUILD / "icon.icns")
    print(f"wrote {BUILD / 'icon.png'} ({BASE}x{BASE})")
    print(f"wrote {BUILD / 'icon.icns'} ({len(ICNS_ENTRIES)} sizes)")


if __name__ == "__main__":
    main()
