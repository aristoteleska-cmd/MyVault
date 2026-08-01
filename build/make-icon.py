#!/usr/bin/env python3
"""
Generates the MyVault application icon (build/icon.ico + build/icon.png).

Written with only the Python standard library so the icon can be regenerated on
any machine without installing an imaging toolkit. Run it from the repo root:

    python build/make-icon.py

Shapes are drawn with 4x4 supersampling, which is what keeps the ring smooth at
16x16 in the Windows taskbar.
"""

import binascii
import math
import os
import struct
import zlib

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

BLUE = (47, 95, 219)        # --accent from the app's light theme
BLUE_DEEP = (33, 68, 158)
WHITE = (255, 255, 255)

SIZES = [16, 24, 32, 48, 64, 128, 256]


def rounded_rect_coverage(x, y, size, radius):
    """1.0 inside the rounded square, 0.0 outside."""
    inset = size * 0.035
    left, top = inset, inset
    right, bottom = size - inset, size - inset

    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    if left <= x <= right and top <= y <= bottom:
        if math.hypot(x - cx, y - cy) <= radius:
            return 1.0
        return 0.0
    return 0.0


def draw_pixel(x, y, size):
    """Returns straight (non-premultiplied) RGBA for one sample point."""
    s = size / 256.0
    cx = cy = size / 2.0

    if not rounded_rect_coverage(x, y, size, 56 * s):
        return (0, 0, 0, 0)

    # Subtle vertical shade so the tile does not look flat.
    t = y / size
    base = tuple(round(BLUE[i] + (BLUE_DEEP[i] - BLUE[i]) * t) for i in range(3))

    dx, dy = x - cx, y - cy
    dist = math.hypot(dx, dy)

    # Dial ring
    if 62 * s <= dist <= 78 * s:
        return WHITE + (255,)

    # Centre hub
    if dist <= 20 * s:
        return WHITE + (255,)

    # Four spokes at the compass points
    if 86 * s <= dist <= 106 * s:
        half = 7 * s
        if abs(dx) <= half or abs(dy) <= half:
            return WHITE + (255,)

    return base + (255,)


def render(size, samples=4):
    """Supersampled RGBA buffer, row-major."""
    pixels = []
    step = 1.0 / samples
    offset = step / 2.0
    for py in range(size):
        row = []
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(samples):
                for sx in range(samples):
                    x = px + offset + sx * step
                    y = py + offset + sy * step
                    pr, pg, pb, pa = draw_pixel(x, y, size)
                    weight = pa / 255.0
                    r += pr * weight
                    g += pg * weight
                    b += pb * weight
                    a += pa
            total = samples * samples
            alpha = a / total
            if alpha <= 0:
                row.append((0, 0, 0, 0))
            else:
                # Un-weight the colour so edges keep their hue instead of
                # fading toward black.
                scale = total * (alpha / 255.0)
                row.append((
                    min(255, round(r / scale)),
                    min(255, round(g / scale)),
                    min(255, round(b / scale)),
                    round(alpha),
                ))
        pixels.append(row)
    return pixels


def write_png(pixels):
    height = len(pixels)
    width = len(pixels[0])

    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type: none
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', binascii.crc32(body) & 0xFFFFFFFF)

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )


def write_bmp_entry(pixels):
    """A 32-bit BGRA DIB with the AND mask Windows still expects."""
    height = len(pixels)
    width = len(pixels[0])

    header = struct.pack(
        '<IiiHHIIiiII',
        40, width, height * 2, 1, 32, 0, width * height * 4, 0, 0, 0, 0,
    )

    colour = bytearray()
    for row in reversed(pixels):  # DIBs are stored bottom-up
        for r, g, b, a in row:
            colour += bytes((b, g, r, a))

    # 1bpp AND mask, rows padded to 4 bytes.
    mask_row_bytes = ((width + 31) // 32) * 4
    mask = bytearray()
    for row in reversed(pixels):
        bits = bytearray(mask_row_bytes)
        for x, (_, _, _, a) in enumerate(row):
            if a == 0:
                bits[x // 8] |= 0x80 >> (x % 8)
        mask += bits

    return header + bytes(colour) + bytes(mask)


def write_ico(path, images):
    """images: list of (size, payload_bytes, is_png)."""
    count = len(images)
    out = bytearray(struct.pack('<HHH', 0, 1, count))
    offset = 6 + 16 * count

    for size, payload, _is_png in images:
        dim = 0 if size >= 256 else size
        out += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(payload), offset)
        offset += len(payload)

    for _size, payload, _is_png in images:
        out += payload

    with open(path, 'wb') as handle:
        handle.write(bytes(out))


def main():
    images = []
    for size in SIZES:
        pixels = render(size)
        if size >= 256:
            images.append((size, write_png(pixels), True))
        else:
            images.append((size, write_bmp_entry(pixels), False))
        print(f'  rendered {size}x{size}')

    ico_path = os.path.join(OUT_DIR, 'icon.ico')
    write_ico(ico_path, images)
    print(f'wrote {ico_path} ({os.path.getsize(ico_path)} bytes)')

    png_path = os.path.join(OUT_DIR, 'icon.png')
    with open(png_path, 'wb') as handle:
        handle.write(write_png(render(512)))
    print(f'wrote {png_path} ({os.path.getsize(png_path)} bytes)')


if __name__ == '__main__':
    main()
