"""Resolve Godot resource UIDs ("uid://...") to res:// paths.

Godot 4 keeps every resource's UID in .godot/uid_cache.bin: a count, then per
entry a 64-bit id, a 32-bit length and the UTF-8 path. A "uid://" text is the
id in base 34 (ResourceUID::text_to_id): the letters a-y are 0-24 and the
digits 0-8 are 25-33, because its char_count is 'z' - 'a' and it adds '9' - '0'.
So neither z nor 9 appears. The id is masked to 63 bits.
"""
import struct

CHARS = 25  # the letters a..y
BASE = 25 + 9


def text_to_id(text: str) -> int:
    value = 0
    for ch in text.removeprefix('uid://'):
        value = value * BASE + (ord(ch) - ord('a') if ch.isalpha() else ord(ch) - ord('0') + CHARS)
    return value & 0x7FFFFFFFFFFFFFFF


def uid_map(pack) -> dict:
    """{id: "res://..."} for every resource in the pack."""
    data = pack.raw('.godot/uid_cache.bin')
    (count,) = struct.unpack_from('<I', data, 0)
    pos = 4
    out = {}
    for _ in range(count):
        uid, length = struct.unpack_from('<QI', data, pos)
        pos += 12
        out[uid] = data[pos:pos + length].decode('utf-8').rstrip('\0')
        pos += length
    return out


_cache: dict = {}


def resolve(pack, ref: str) -> str:
    """A res:// path for a path or a uid:// reference."""
    if not ref.startswith('uid://'):
        return ref
    if not _cache:
        _cache.update(uid_map(pack))
    return _cache.get(text_to_id(ref), ref)
