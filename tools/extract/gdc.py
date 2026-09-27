"""Turn Godot 4 binary-token GDScript (.gdc, tokenizer v100/101) back into readable source."""
import struct, sys, zstandard

TOKENS = [
    'EMPTY', 'ANNOTATION', 'IDENTIFIER', 'LITERAL',
    '<', '<=', '>', '>=', '==', '!=',
    'and', 'or', 'not', '&&', '||', '!',
    '&', '|', '~', '^', '<<', '>>',
    '+', '-', '*', '**', '/', '%',
    '=', '+=', '-=', '*=', '**=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=',
    'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'pass', 'return', 'match', 'when',
    'as', 'assert', 'await', 'breakpoint', 'class', 'class_name', 'const', 'enum', 'extends', 'func', 'in', 'is',
    'namespace', 'preload', 'self', 'signal', 'static', 'super', 'trait', 'var', 'void', 'yield',
    '[', ']', '{', '}', '(', ')', ',', ';', '.', '..', '...', ':', '$', '->', '_',
    'NEWLINE', 'INDENT', 'DEDENT',
    'PI', 'TAU', 'INF', 'NAN',
    'VCS_CONFLICT_MARKER', '`', '?',
    'ERROR', 'EOF',
]

def u32(b, p): return struct.unpack_from('<I', b, p)[0]

def decode_variant(b, p):
    """Godot marshalls.cpp variant encoding. Returns (value, new_pos)."""
    header = u32(b, p); p += 4
    t = header & 0xFF; f64 = bool(header & (1 << 16))
    if t == 0: return None, p
    if t == 1: return bool(u32(b, p)), p + 4
    if t == 2:
        if f64: return struct.unpack_from('<q', b, p)[0], p + 8
        return struct.unpack_from('<i', b, p)[0], p + 4
    if t == 3:
        if f64: return struct.unpack_from('<d', b, p)[0], p + 8
        return struct.unpack_from('<f', b, p)[0], p + 4
    if t in (4, 21):
        n = u32(b, p); p += 4
        s = b[p:p + n].decode('utf-8', 'replace'); p += n + ((4 - n % 4) % 4)
        return ('&' if t == 21 else '') + repr(s), p
    if t in (5, 6):
        fmt = '<dd' if (f64 and t == 5) else ('<ii' if t == 6 else '<ff')
        size = struct.calcsize(fmt)
        return 'Vector2%s%s' % ('i' if t == 6 else '', struct.unpack_from(fmt, b, p)), p + size
    if t in (9, 10):
        fmt = '<ddd' if (f64 and t == 9) else ('<iii' if t == 10 else '<fff')
        size = struct.calcsize(fmt)
        return 'Vector3%s' % (struct.unpack_from(fmt, b, p),), p + size
    if t == 20:
        return 'Color%s' % (struct.unpack_from('<ffff', b, p),), p + 16
    if t == 22:
        # NodePath: new format has bit 31 set on name count
        n = u32(b, p); p += 4
        if n & 0x80000000:
            sub = u32(b, p); p += 4; flags = u32(b, p); p += 4
            n &= 0x7FFFFFFF; total = n + sub
            parts = []
            for _ in range(total):
                ln = u32(b, p); p += 4; parts.append(b[p:p + ln].decode()); p += ln + ((4 - ln % 4) % 4)
            return 'NodePath(%r)' % '/'.join(parts), p
        s = b[p:p + n].decode(); p += n + ((4 - n % 4) % 4)
        return 'NodePath(%r)' % s, p
    if t == 27:
        n = u32(b, p) & 0x7FFFFFFF; p += 4; items = []
        for _ in range(n):
            k, p = decode_variant(b, p); v, p = decode_variant(b, p); items.append(f'{k}: {v}')
        return '{' + ', '.join(items) + '}', p
    if t == 28:
        n = u32(b, p) & 0x7FFFFFFF; p += 4; items = []
        for _ in range(n):
            v, p = decode_variant(b, p); items.append(str(v))
        return '[' + ', '.join(items) + ']', p
    raise ValueError(f'constant type {t}')

def decompile(data):
    assert data[:4] == b'GDSC', data[:4]
    version, dsize = struct.unpack_from('<II', data, 4)
    body = zstandard.ZstdDecompressor().decompress(data[12:], max_output_size=dsize) if dsize else data[12:]
    ident_count, const_count, line_count = u32(body, 0), u32(body, 4), u32(body, 8)
    token_count = u32(body, 12)
    p = 16
    idents = []
    for _ in range(ident_count):
        n = u32(body, p); p += 4
        chars = [chr(u32(bytes(x ^ 0xB6 for x in body[p + 4 * j:p + 4 * j + 4]), 0)) for j in range(n)]
        p += 4 * n; idents.append(''.join(chars))
    consts = []
    for _ in range(const_count):
        v, p = decode_variant(body, p); consts.append(v)
    lines, cols = {}, {}
    for _ in range(line_count):
        lines[u32(body, p)] = u32(body, p + 4); p += 8
    for _ in range(line_count):
        cols[u32(body, p)] = u32(body, p + 4); p += 8
    toks = []
    for i in range(token_count):
        if body[p] & 0x80:
            word = u32(body, p); p += 8
            typ, idx = word & 0x7F, word >> 8
        else:
            typ, idx = body[p], 0; p += 5
        name = TOKENS[typ] if typ < len(TOKENS) else f'<T{typ}>'
        if name in ('IDENTIFIER', 'ANNOTATION'): tok = idents[idx]
        elif name == 'LITERAL': tok = consts[idx]
        else: tok = name
        toks.append((i, name, tok))
    return render(toks, lines, cols)

NO_SPACE_BEFORE = {')', ']', '}', ',', ':', '.', '('}
NO_SPACE_AFTER = {'(', '[', '{', '.', '$', '%', '@'}

def render(toks, lines, cols):
    out = []; cur = []; col = 1; prev = None
    def flush():
        if cur: out.append('    ' * max(0, (col - 1) // 4) + ''.join(cur))
    for i, name, tok in toks:
        if name in ('NEWLINE', 'INDENT', 'DEDENT', 'EOF', 'EMPTY'):
            continue
        if i in lines and cur and (i in cols):
            flush(); cur = []; prev = None
        if i in cols and not cur:
            col = cols[i]
        text = str(tok)
        if prev is not None and text not in NO_SPACE_BEFORE and prev not in NO_SPACE_AFTER:
            cur.append(' ')
        if text == '(' and prev not in (None,) and prev not in NO_SPACE_AFTER and (prev[-1:].isalnum() or prev[-1:] in ('_', ')', ']')):
            pass
        elif text == '(' and prev is not None and prev not in NO_SPACE_AFTER:
            cur.append(' ')
        cur.append(text); prev = text
    flush()
    return '\n'.join(out)

if __name__ == '__main__':
    print(decompile(open(sys.argv[1], 'rb').read()))
