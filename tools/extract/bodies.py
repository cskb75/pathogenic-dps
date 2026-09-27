"""Extract each pathogen's body plans (starting body and evolutions).

    python3 tools/extract/bodies.py path/to/pathogenic.pck path/to/output

Writes to the output directory:

    bodies.json        every class: its evolution tiers, and for each body its
                       slots (position, kind, special type, mirror), the
                       connections between them, and its outline
    bodies/<key>.webp  each body's sprite (drawn at sprite.x, sprite.y)

Coordinates are game pixels with y pointing down (toward the tail).

Slot rules, from scn/player/bodyparts/slot.gd:
- `connect_to` lists the slots a slot is connected to (connections go both ways).
- A slot with `mirror` gets a twin at (-x, y) named "<name>Mirror". The twin
  always holds a copy of the same organelle, and connects to the same slots
  (or to `mirror_connect_to` when `mirror_connect_to_same` is off).
- slot_damage / slot_energy / slot_turret scenes are Volatile / Conductive /
  Omni slots built into the body.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from ctex import export  # noqa: E402
from extract import Pack, clean  # noqa: E402
from gdc import decompile  # noqa: E402
from gdres import parse, scene_nodes  # noqa: E402
from gdtr import Translation  # noqa: E402

# Playable classes: id -> starting body scene (see get_parasite_scene in scn/globals.gd).
CLASSES = {
    'bacterium': 'res://scn/player/player.tscn',
    'fungal-spore': 'res://scn/player/player_strafer/player_strafer.tscn',
    'helminth': 'res://scn/player/player_worm/player_worm_long.tscn',
}
SPECIAL = {'slot_damage.tscn': 'volatile', 'slot_energy.tscn': 'conductive', 'slot_turret.tscn': 'omni'}


def slot_name(ref):
    return ref.split('/')[-1] if isinstance(ref, str) else None


def read_body(pack, scene_path, key, out_dir):
    res = pack.resource(scene_path)
    ext = res['ext']
    locals_ = {r['path']: r for r in res['resources'] if r.get('path', '').startswith('local://')}
    nodes = scene_nodes(res)
    root = nodes[0]['props']
    body = {'scene': scene_path, 'maxHp': clean(root.get('max_hp'), ext), 'slots': [], 'links': []}

    # Sprite and outline
    soft = next((n for n in nodes if n['name'] == 'SoftBody2D'), None)
    poly = next((n for n in nodes if n['name'] == 'EditorPoly'), None)
    if soft:
        sp = soft['props']
        tex = locals_.get(clean(sp.get('texture'), ext))
        diffuse = clean(tex['props'].get('diffuse_texture'), ext) if tex else None
        if diffuse:
            fmt, data, (w, h) = export(pack, diffuse)
            os.makedirs(os.path.join(out_dir, 'bodies'), exist_ok=True)
            with open(os.path.join(out_dir, 'bodies', f'{key}.{fmt}'), 'wb') as f:
                f.write(data)
            x, y = sp.get('position', [0, 0])
            body['sprite'] = {'file': f'bodies/{key}.{fmt}', 'source': diffuse, 'x': x, 'y': y, 'w': w, 'h': h}
        if poly and 'polygon' in poly['props']:
            pts = poly['props']['polygon']
            n = len(pts) - int(sp.get('internal_vertex_count', 0))
            px, py = poly['props'].get('position', [0, 0])
            body['outline'] = [[round(p[0] + px, 1), round(p[1] + py, 1)] for p in pts[:n]]

    # The body's centre: the bone named by center_body_path, else the bone
    # closest to the average bone position (Cell._get_center_body). Effects
    # that care about "left half" or "top half" measure from here.
    if soft:
        sx, sy = soft['props'].get('position', [0, 0])
        soft_i = nodes.index(soft)
        bones = {n['name']: (n['props'].get('position', [0, 0])[0] + sx, n['props'].get('position', [0, 0])[1] + sy)
                 for n in nodes if n['parent'] == soft_i and n.get('type') == 'RigidBody2D'}
        named = clean(root.get('center_body_path'), ext)
        named = named.split('/')[-1] if isinstance(named, str) else None
        if named in bones:
            cx, cy = bones[named]
        elif bones:
            mx = sum(b[0] for b in bones.values()) / len(bones)
            my = sum(b[1] for b in bones.values()) / len(bones)
            cx, cy = min(bones.values(), key=lambda b: (b[0] - mx) ** 2 + (b[1] - my) ** 2)
        else:
            cx, cy = 0.0, 0.0
        body['center'] = [round(cx, 1), round(cy, 1)]

    # Slots
    by_name = {}
    for n in nodes:
        inst = clean(n['instance'], ext) if n.get('instance') else None
        if not (isinstance(inst, str) and re.search(r'/slot(_\w+)?\.tscn$', inst)):
            continue
        p = n['props']
        slot = {
            'id': n['name'],
            'internal': bool(p.get('internal', False)),
            'special': SPECIAL.get(inst.split('/')[-1]),
            'x': round(p.get('position', [0, 0])[0], 1),
            'y': round(p.get('position', [0, 0])[1], 1),
            'rotation': round(p.get('rotation', 0.0), 4),
        }
        links = [slot_name(r) for r in clean(p.get('connect_to', []), ext)]
        by_name[slot['id']] = slot
        body['slots'].append(slot)
        body['links'] += [[slot['id'], t] for t in links if t]
        if p.get('mirror'):
            twin = {**slot, 'id': slot['id'] + 'Mirror', 'x': -slot['x'], 'rotation': round(-(slot['rotation'] - 3.14159265 / 2) + 3.14159265 / 2, 4), 'mirrorOf': slot['id']}
            same = p.get('mirror_connect_to_same', True)
            twin_links = links if same else [slot_name(r) for r in clean(p.get('mirror_connect_to', []), ext)]
            body['slots'].append(twin)
            body['links'] += [[twin['id'], t] for t in twin_links if t]

    # Connections go both ways: keep each pair once.
    seen, links = set(), []
    for a, b in body['links']:
        k = tuple(sorted((a, b)))
        if k not in seen and a != b:
            seen.add(k)
            links.append(list(k))
    body['links'] = links
    return body


def evolution_tiers(pack, scene_path):
    """Reads get_evolutions() from the class script: a list of tiers, each a list of evolution resources."""
    res = pack.resource(scene_path)
    script = clean(scene_nodes(res)[0]['props'].get('script'), res['ext'])
    src = decompile(pack.raw(script.replace('res://', '').replace('.gd', '.gdc')))
    m = re.search(r'func get_evolutions\(\):\s*return \[(.*?)\n    \]', src, re.S)
    if not m:
        return []
    return [re.findall(r"'(res://[^']+\.tres)'", t) for t in re.split(r'\],\s*\[', m.group(1))]


def main(pck_path, out_dir):
    pack = Pack(pck_path)
    tr_name = next(n for n in pack.index if n.endswith('.en.translation') and not n.startswith('addons/'))
    t = Translation(parse(pack.raw(tr_name))['resources'][-1]['props'])
    out = {'classes': [], 'bodies': {}}
    for cid, base in CLASSES.items():
        key = f'{cid}-start'
        out['bodies'][key] = {**read_body(pack, base, key, out_dir), 'name': 'Starting body', 'tier': 0}
        tiers = []
        for i, tier in enumerate(evolution_tiers(pack, base)):
            keys = []
            for evo in tier:
                props = pack.resource(evo)['resources'][-1]['props']
                scene = clean(props.get('player_scene'), pack.resource(evo)['ext'])
                name = t.get(props.get('ui_name', '')) or props.get('ui_name')
                ekey = f"{cid}-{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')}"
                desc = t.get(props['description']) if props.get('description') else None
                out['bodies'][ekey] = {
                    **read_body(pack, scene, ekey, out_dir),
                    'name': name,
                    'tier': i + 1,
                    'bonusDamage': props.get('bonus_damage', 0.0),
                    'bonusHp': props.get('bonus_hp', 0),
                    **({'description': desc} if desc else {}),
                }
                keys.append(ekey)
            tiers.append(keys)
        out['classes'].append({'id': cid, 'start': key, 'tiers': tiers})
        print(f'{cid}: {sum(len(x) for x in tiers)} evolutions in {len(tiers)} tiers')
    with open(os.path.join(out_dir, 'bodies.json'), 'w') as f:
        json.dump(out, f, indent=1)
    print(f'wrote {out_dir}/bodies.json')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
