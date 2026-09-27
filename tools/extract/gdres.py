"""Reader for Godot 4 binary resources (.res / .scn, magic RSRC)."""
import struct, sys, json

class ExtRef:
    def __init__(s, i): s.i = i
    def __repr__(s): return f'ExtRef({s.i})'
class SubRef:
    def __init__(s, path): s.path = path
    def __repr__(s): return f'SubRef({s.path})'

class Reader:
    def __init__(s, data):
        s.d = data; s.p = 0
    def u32(s): v = struct.unpack_from('<I', s.d, s.p)[0]; s.p += 4; return v
    def i32(s): v = struct.unpack_from('<i', s.d, s.p)[0]; s.p += 4; return v
    def u64(s): v = struct.unpack_from('<Q', s.d, s.p)[0]; s.p += 8; return v
    def i64(s): v = struct.unpack_from('<q', s.d, s.p)[0]; s.p += 8; return v
    def f32(s): v = struct.unpack_from('<f', s.d, s.p)[0]; s.p += 4; return v
    def f64(s): v = struct.unpack_from('<d', s.d, s.p)[0]; s.p += 8; return v
    def raw(s, n): v = s.d[s.p:s.p + n]; s.p += n; return v
    def ustr(s):
        n = s.u32()
        b = s.raw(n)
        return b.rstrip(b'\0').decode('utf-8', 'replace')

def parse(data):
    r = Reader(data)
    magic = r.raw(4)
    if magic != b'RSRC':
        raise ValueError(f'unsupported magic {magic!r}')
    big, real64 = r.u32(), r.u32()
    major, minor, fmt = r.u32(), r.u32(), r.u32()
    rtype = r.ustr()
    r.u64()  # import metadata offset
    flags = r.u32()
    if flags & 2: r.u64()  # uid
    script_class = r.ustr() if flags & 8 else None
    real_double = bool(flags & 4)
    for _ in range(11): r.u32()
    strings = [r.ustr() for _ in range(r.u32())]
    ext = []
    for _ in range(r.u32()):
        t = r.ustr(); path = r.ustr()
        if flags & 2: r.u64()
        ext.append({'type': t, 'path': path})
    internal = [(r.ustr(), r.u64()) for _ in range(r.u32())]

    def getstr():
        i = r.u32()
        if i & 0x80000000:
            return r.raw(i & 0x7FFFFFFF).rstrip(b'\0').decode('utf-8', 'replace')
        return strings[i]

    def real():
        return r.f64() if real_double else r.f32()

    def variant():
        t = r.u32()
        if t == 1: return None
        if t == 2: return bool(r.u32())
        if t == 3: return r.i32()
        if t == 40: return r.i64()
        if t == 4: return r.f32()
        if t == 41: return r.f64()
        if t in (5, 44): return r.ustr()
        if t == 10: return [real(), real()]
        if t == 45: return [r.i32(), r.i32()]
        if t == 11: return [real() for _ in range(4)]
        if t == 46: return [r.i32() for _ in range(4)]
        if t == 12: return [real() for _ in range(3)]
        if t == 47: return [r.i32() for _ in range(3)]
        if t == 50: return [real() for _ in range(4)]
        if t == 51: return [r.i32() for _ in range(4)]
        if t == 13: return [real() for _ in range(4)]
        if t == 14: return [real() for _ in range(4)]
        if t == 15: return [real() for _ in range(6)]
        if t == 16: return [real() for _ in range(9)]
        if t == 17: return [real() for _ in range(12)]
        if t == 18: return [real() for _ in range(6)]
        if t == 52: return [real() for _ in range(16)]
        if t == 20: return [r.f32() for _ in range(4)]
        if t == 22:
            # uint16 name_count, uint16 subname_count (bit 15 = absolute)
            nc = struct.unpack_from('<H', r.d, r.p)[0]; sc = struct.unpack_from('<H', r.d, r.p + 2)[0]; r.p += 4
            absolute = bool(sc & 0x8000); sc &= 0x7FFF
            parts = [getstr() for _ in range(nc)]
            subs = [getstr() for _ in range(sc)]
            return ('/' if absolute else '') + '/'.join(parts) + (':' + ':'.join(subs) if subs else '')
        if t == 23: return ('RID', r.u32())
        if t == 24:
            kind = r.u32()
            if kind == 0: return None
            if kind == 2: return SubRef(internal[r.u32()][0])  # internal resource by index
            if kind == 1:
                typ = r.ustr(); path = r.ustr(); return {'ext_type': typ, 'ext_path': path}
            if kind == 3: return ExtRef(r.u32())
            raise ValueError(f'object kind {kind}')
        if t in (42, 43): return None
        if t == 26:
            n = r.u32() & 0x7FFFFFFF
            out = {}
            for _ in range(n):
                k = variant(); v = variant()
                out[json.dumps(k, default=str) if not isinstance(k, (str, int, float)) else k] = v
            return out
        if t == 30:
            n = r.u32() & 0x7FFFFFFF
            return [variant() for _ in range(n)]
        if t == 31:
            n = r.u32(); b = r.raw(n); r.p += (4 - n % 4) % 4; return bytes(b)
        if t == 32: n = r.u32(); return [r.i32() for _ in range(n)]
        if t == 48: n = r.u32(); return [r.i64() for _ in range(n)]
        if t == 33: n = r.u32(); return [r.f32() for _ in range(n)]
        if t == 49: n = r.u32(); return [r.f64() for _ in range(n)]
        if t == 34: n = r.u32(); return [r.ustr() for _ in range(n)]
        if t == 35: n = r.u32(); return [[real() for _ in range(3)] for _ in range(n)]
        if t == 36: n = r.u32(); return [[r.f32() for _ in range(4)] for _ in range(n)]
        if t == 37: n = r.u32(); return [[real() for _ in range(2)] for _ in range(n)]
        if t == 53: n = r.u32(); return [[real() for _ in range(4)] for _ in range(n)]
        raise ValueError(f'variant type {t} at {r.p - 4}')

    resources = []
    for path, off in internal:
        r.p = off
        typ = r.ustr()
        props = {}
        for _ in range(r.u32()):
            name = strings[r.u32()]
            props[name] = variant()
        resources.append({'path': path, 'type': typ, 'props': props})
    return {'type': rtype, 'script_class': script_class, 'version': (major, minor, fmt), 'ext': ext, 'resources': resources}

def scene_nodes(res):
    """Decode a PackedScene's _bundled data into a list of nodes with properties."""
    b = res['resources'][-1]['props']['_bundled']
    names, variants, nodes = b['names'], b['variants'], b['nodes']
    NAME_MASK = (1 << 18) - 1
    out = []; i = 0
    for _ in range(b['node_count']):
        parent, owner, typ, name, inst, nprops = nodes[i:i + 6]; i += 6
        props = {}
        for _ in range(nprops):
            nm, val = nodes[i], nodes[i + 1]; i += 2
            props[names[nm & NAME_MASK]] = variants[val]
        ngroups = nodes[i]; i += 1
        groups = [names[g] for g in nodes[i:i + ngroups]]; i += ngroups
        out.append({
            'parent': parent,
            'type': names[typ] if 0 <= typ < len(names) else None,
            'name': names[name & NAME_MASK],
            'instance': variants[inst & 0x7FFFFFFF] if inst not in (-1, 0x7FFFFFFF) and inst >= 0 else None,
            'props': props, 'groups': groups,
        })
    return out

if __name__ == '__main__':
    d = parse(open(sys.argv[1], 'rb').read())
    print(json.dumps(d, indent=1, default=str)[:20000])
