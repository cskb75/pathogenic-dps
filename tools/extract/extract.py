"""Pull organelle, mutation and plasmid data out of a Pathogenic .pck file.

    pip install zstandard
    python3 tools/extract/extract.py path/to/pathogenic.pck path/to/output

Writes to the output directory (keep it outside the repo: decompiled game
code must not be committed):

    src/...                 every game script, decompiled to readable GDScript
    organelles.json         each organelle: name, description, tags, scene values
    weapons.json            each weapon's projectile scene (base damage, speed...)
    mutations.json          each mutation: name, description, values
    plasmid_maps.json       each pathogen's plasmid tree: nodes, values, links
    translations_en.json    every English string referenced by the above

The numbers the calculator uses are then ported by hand into
src/engine/sim/behaviours.ts (see the README).
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from gdc import decompile  # noqa: E402
from gdres import parse, scene_nodes  # noqa: E402
from gdtr import Translation  # noqa: E402
from pck import read_index  # noqa: E402

TAGS = {
    0: 'EnergyGenerator', 1: 'EnergyConsumer', 2: 'Weapon', 3: 'AttackModifier', 4: 'CanBeAttackModified', 5: 'Lash',
    6: 'Internal', 7: 'External', 8: 'Any', 9: 'Active', 10: 'CanBeBulletModified', 11: 'BulletModifier', 12: 'UsesBulletWeapons',
    13: 'ShootsBullets', 14: 'Upgrade', 15: 'WeaponModifier', 16: 'UsesWeapons', 17: 'MeleeWeapon', 18: 'UsesMeleeWeapons',
    19: 'CreatesLightning', 20: 'SpawnsMinions', 21: 'Pseudopod',
}
SKIP_PROPS = re.compile(r'^(texture|material|modulate|self_modulate|position|rotation|scale|z_index|visibility_layer|metadata/|parasite_colors|color\d|rarity_textures)')


class Pack:
    def __init__(self, path):
        _, entries = read_index(path)
        self.index = {name: (off, size) for name, off, size, _ in entries}
        self.f = open(path, 'rb')

    def raw(self, name):
        off, size = self.index[name]
        self.f.seek(off)
        return self.f.read(size)

    def resource(self, res_path):
        """Loads a resource by its res:// path, following export remaps."""
        p = res_path.replace('res://', '')
        if p + '.remap' in self.index:
            p = re.search(r'path="res://([^"]+)"', self.raw(p + '.remap').decode()).group(1)
        return parse(self.raw(p))

    def names(self, prefix='', suffix=''):
        for n in self.index:
            base = n[:-len('.remap')] if n.endswith('.remap') else n
            if base.startswith(prefix) and base.endswith(suffix):
                yield base


def clean(value, ext):
    """Makes decoded values JSON-friendly, resolving external resource references to paths."""
    if hasattr(value, 'i'):
        return ext[value.i]['path']
    if hasattr(value, 'path'):
        return value.path
    if isinstance(value, bytes):
        return f'<{len(value)} bytes>'
    if isinstance(value, dict):
        return {k: clean(v, ext) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v, ext) for v in value]
    return value


def root_props(res):
    nodes = scene_nodes(res)
    return {k: clean(v, res['ext']) for k, v in nodes[0]['props'].items() if not SKIP_PROPS.match(k)} if nodes else {}


def main(pck_path, out):
    pack = Pack(pck_path)
    os.makedirs(out, exist_ok=True)
    keys = set()

    # Scripts: the demo ships compiled tokens (.gdc), the full game plain source (.gd)
    count = 0
    for n in pack.index:
        if n.startswith('addons/') or not n.endswith(('.gdc', '.gd')):
            continue
        path = os.path.join(out, 'src', n[:-4] + '.gd' if n.endswith('.gdc') else n)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write(decompile(pack.raw(n)) if n.endswith('.gdc') else pack.raw(n).decode())
        count += 1
    print(f'wrote {count} scripts')

    # Organelles: resource (name, tags) + scene root values
    organelles, weapons = [], {}
    for tres in sorted(pack.names('scn/player/bodyparts/', '.tres')):
        if tres.count('/') != 4:
            continue
        res = pack.resource('res://' + tres)['resources'][-1]['props']
        scene = tres[:-5] + '.tscn'
        values = root_props(pack.resource('res://' + scene)) if scene in set(pack.names(scene)) else {}
        for k in ('ui_name', 'description', 'flavor_text'):
            if res.get(k):
                keys.add(res[k])
        for k, v in values.items():
            if k.endswith('_text') and isinstance(v, str):
                keys.add(v)
        iid = os.path.basename(tres)[:-5]
        organelles.append({
            'id': iid,
            'kind': tres.split('/')[-2],
            'ui_name': res.get('ui_name'),
            'description': res.get('description'),
            'tags': [TAGS.get(t, t) for t in res.get('tags', [])],
            'disabled': res.get('disabled', False),
            'values': values,
        })
        bullet = values.get('bullet_scene')
        if isinstance(bullet, str):
            try:
                bres = pack.resource(bullet)
                weapons[iid] = {n['name']: {k: clean(v, bres['ext']) for k, v in n['props'].items() if not SKIP_PROPS.match(k)} for n in scene_nodes(bres)}
            except Exception as e:  # minions and odd scenes
                weapons[iid] = {'error': str(e)}
    print(f'{len(organelles)} organelles, {len(weapons)} weapon projectiles')

    # Mutations
    mutations = []
    for tres in sorted(pack.names('scn/player/mutations/all/', '.tres')):
        props = pack.resource('res://' + tres)['resources'][-1]['props']
        for k in ('ui_name', 'description'):
            if props.get(k):
                keys.add(props[k])
        mutations.append({'id': os.path.basename(tres)[:-5], **{k: clean(v, []) for k, v in props.items() if k != 'script' and not SKIP_PROPS.match(k)}})
    print(f'{len(mutations)} mutations')

    # Plasmid maps: nodes, their values, and links between them
    maps = {}
    for scene in sorted(pack.names('scn/metaprogression/plasmids/plasmid_map', '.tscn')):
        res = pack.resource('res://' + scene)
        nodes = scene_nodes(res)
        entries = []
        for i, n in enumerate(nodes):
            if n['parent'] != 0 or not n['instance']:
                continue
            inst = clean(n['instance'], res['ext'])
            props = {k: clean(v, res['ext']) for k, v in n['props'].items() if not SKIP_PROPS.match(k) or k == 'position'}
            links = [clean(c['props'].get('to'), res['ext']) for c in nodes if c['parent'] == i and 'to' in c['props']]
            entries.append({'name': n['name'], 'plasmid': inst, 'values': props, 'links': links})
        maps[os.path.basename(scene)[:-5]] = entries
    for scene in sorted(pack.names('scn/metaprogression/plasmids/all/', '.tscn')):
        for k, v in root_props(pack.resource('res://' + scene)).items():
            if k in ('ui_name', 'description') and isinstance(v, str):
                keys.add(v)
    print(f'{len(maps)} plasmid maps')

    # English strings for every key seen
    en = [n for n in pack.index if n.endswith('.en.translation') and not n.startswith(('addons/', 'mod_example/'))]
    tr_name = max(en, key=lambda n: pack.index[n][1])  # the game's own table is the biggest
    t = Translation(parse(pack.raw(tr_name))['resources'][-1]['props'])
    strings = {k: t.get(k) for k in sorted(keys) if isinstance(k, str) and k}
    print(f'{sum(1 for v in strings.values() if v)} of {len(strings)} strings translated')

    for name, data in [('organelles', organelles), ('weapons', weapons), ('mutations', mutations), ('plasmid_maps', maps), ('translations_en', strings)]:
        with open(os.path.join(out, f'{name}.json'), 'w') as f:
            json.dump(data, f, indent=1, default=str)
    print(f'wrote {out}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
