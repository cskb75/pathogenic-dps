"""Decode Godot 4 compressed textures (.ctex, "GST2").

Textures imported as "Lossless" (the default for 2D art) store a PNG or WebP
file inside a small header, so decoding is just unwrapping it. VRAM-compressed
textures (S3TC, ETC2...) aren't supported.
"""
import re
import struct

FORMATS = {1: 'png', 2: 'webp'}


def decode(data: bytes):
    """Returns (extension, image bytes, (width, height)) for the full-size image."""
    if data[:4] != b'GST2':
        raise ValueError('not a GST2 texture')
    # 36-byte header (magic, version, size, flags, mipmap limit, reserved), then the image.
    data_format, w, h, _mipmaps, _fmt, size = struct.unpack_from('<IHHIII', data, 36)
    if data_format not in FORMATS:
        raise ValueError(f'unsupported texture data format {data_format} (VRAM compressed?)')
    return FORMATS[data_format], data[56:56 + size], (w, h)


def import_path(pack, res_path: str) -> str:
    """Finds the .ctex a source image (res://...png) was imported to."""
    p = res_path.replace('res://', '')
    imp = pack.raw(p + '.import').decode()
    return re.search(r'path="res://([^"]+\.ctex)"', imp).group(1)


def export(pack, res_path: str):
    """Returns (extension, image bytes, (width, height)) for a source image such as res://gfx/foo.png."""
    return decode(pack.raw(import_path(pack, res_path)))
