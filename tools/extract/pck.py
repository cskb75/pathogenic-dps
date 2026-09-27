"""Minimal Godot 4 .pck reader: list and extract files."""
import struct, sys, os
def read_index(path):
    f = open(path, 'rb')
    magic = f.read(4); assert magic == b'GDPC', magic
    fmt, major, minor, patch, flags = struct.unpack('<5I', f.read(20))
    file_base = struct.unpack('<Q', f.read(8))[0]
    dir_offset = None
    if fmt >= 3:
        dir_offset = struct.unpack('<Q', f.read(8))[0]
    f.read(16 * 4)
    if dir_offset:
        f.seek(dir_offset)
    if flags & 1:
        raise SystemExit('encrypted directory')
    count = struct.unpack('<I', f.read(4))[0]
    entries = []
    for _ in range(count):
        n = struct.unpack('<I', f.read(4))[0]
        name = f.read(n).rstrip(b'\0').decode()
        off, size = struct.unpack('<QQ', f.read(16)); f.read(16)
        fflags = struct.unpack('<I', f.read(4))[0] if fmt >= 2 else 0
        if fmt >= 2 and (flags & 2): off += file_base
        entries.append((name, off, size, fflags))
    return (fmt, major, minor, patch, flags), entries
if __name__ == '__main__':
    hdr, entries = read_index(sys.argv[1])
    print('header', hdr, 'files', len(entries))
    if len(sys.argv) > 2 and sys.argv[2] == 'extract':
        out = sys.argv[3]; pat = sys.argv[4] if len(sys.argv) > 4 else ''
        f = open(sys.argv[1], 'rb')
        for name, off, size, fl in entries:
            if pat not in name: continue
            p = os.path.join(out, name.replace('res://', ''))
            os.makedirs(os.path.dirname(p), exist_ok=True)
            f.seek(off); open(p, 'wb').write(f.read(size))
    else:
        from collections import Counter
        print(Counter(os.path.splitext(e[0])[1] for e in entries).most_common(25))
        print('encrypted files:', sum(1 for e in entries if e[3] & 1))
