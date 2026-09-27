"""Look up strings in a Godot 4 OptimizedTranslation resource.

Keys are stored only as hashes, and values are smaz-compressed. To read a
string you need its key (e.g. "o_gun_name", found in organelle resources).

The smaz codebook is read from the `smaz` source package on PyPI, downloaded
on first use into ~/.cache/pathogenic-extract.
"""
import os
import re
import subprocess
import sys
import tarfile

CACHE = os.path.expanduser('~/.cache/pathogenic-extract')


def _smaz_source() -> str:
    os.makedirs(CACHE, exist_ok=True)
    tgz = os.path.join(CACHE, 'smaz-1.0.tar.gz')
    if not os.path.exists(tgz):
        subprocess.run(
            [sys.executable, '-m', 'pip', 'download', '--no-deps', '--no-binary', ':all:', 'smaz==1.0', '-d', CACHE],
            check=True,
        )
    with tarfile.open(tgz) as t:
        return t.extractfile('smaz-1.0/smaz.c').read().decode('latin-1')


def _codebook():
    src = _smaz_source()
    body = src[src.index('Smaz_rcb'):]
    body = body[body.index('{') + 1: body.index('};')]
    return [bytes(s, 'latin-1').decode('unicode_escape').encode('latin-1') for s in re.findall(r'"((?:[^"\\]|\\.)*)"', body)]


_RCB = None


def smaz_decompress(data: bytes) -> bytes:
    global _RCB
    if _RCB is None:
        _RCB = _codebook()
    out = bytearray()
    i = 0
    while i < len(data):
        c = data[i]
        if c == 254:
            out += data[i + 1:i + 2]
            i += 2
        elif c == 255:
            n = data[i + 1] + 1
            out += data[i + 2:i + 2 + n]
            i += 2 + n
        else:
            out += _RCB[c]
            i += 1
    return bytes(out)


def _hash(d: int, s: bytes) -> int:
    if d == 0:
        d = 0x1000193
    for ch in s:
        d = ((d * 0x1000193) & 0xFFFFFFFF) ^ ch
    return d


class Translation:
    """Wraps the properties of an OptimizedTranslation resource (see gdres.parse)."""

    def __init__(self, props):
        self.ht = [x & 0xFFFFFFFF for x in props['hash_table']]
        self.bt = [x & 0xFFFFFFFF for x in props['bucket_table']]
        self.s = props['strings']

    def get(self, key: str):
        k = key.encode()
        p = self.ht[_hash(0, k) % len(self.ht)]
        if p == 0xFFFFFFFF:
            return None
        size, func = self.bt[p], self.bt[p + 1]
        h2 = _hash(func, k)
        for i in range(size):
            key_h, off, comp, uncomp = self.bt[p + 2 + 4 * i: p + 6 + 4 * i]
            if key_h == h2:
                chunk = self.s[off:off + comp]
                text = chunk if comp == uncomp else smaz_decompress(chunk)[:uncomp]
                return text.decode('utf-8', 'replace').rstrip('\x00')
        return None
