"""Extract each pathogen's plasmid tree into the calculator's data.

    python3 tools/extract/plasmids.py path/to/pathogenic.pck

Writes (app data only, never scripts):

    src/data/plasmids.json     per pathogen: every node of its plasmid tree
                               (position, links, name, description, values,
                               icon) and what it does to damage
    public/art/plasmids/*      the node icons

A node's id is "<pathogen>-<node name in lower case>", which is also how
builds refer to it. What a plasmid does is read from its script
(scn/metaprogression/plasmids/all/*.gd); EFFECTS below turns the scripts that
matter for damage into calculator effects.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from ctex import export  # noqa: E402
from extract import Pack, clean  # noqa: E402
from gdres import parse, scene_nodes  # noqa: E402
from gdtr import Translation  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MAPS = {
    'bacterium': 'plasmid_map',
    'fungal-spore': 'plasmid_map_strafer',
    'helminth': 'plasmid_map_worm',
    'diatom': 'plasmid_map_diatom',
    'lil-collector': 'plasmid_map_collector',
    'nanobot': 'plasmid_map_nanobot',
    'amoeba': 'plasmid_map_amoeba',
}
# Game pixels between slot and body centre for the half-of-body plasmids.
HALF = 0.5


def effects_for(script, v):
    """Calculator effects of a plasmid, from its script name and values."""
    zone = lambda side, **kw: {'zone': {'side': side, 'threshold': HALF, **kw}}
    return {
        'damage_plasmid': lambda: {'effects': {'damage': v['damage_mult']}},
        'damage_lower_hp_plasmid': lambda: {'effects': {'damage': v['damage_mult']}},
        'glass_cannon_plasmid': lambda: {'effects': {'damage': v['damage_mult']}},
        'auto_shoot_plasmid': lambda: {'effects': {'damage': v['damage_mult']}, 'notes': 'Auto-aim itself is not modeled.'},
        # The game counts levels passed, one per boss beaten.
        'damage_progression_plasmid': lambda: {'effects': {'perBoss': v['per_level_mult']}, 'notes': 'Uses your bosses beaten.'},
        'bottom_damage_plasmid': lambda: {'effects': zone('bottom', damage=v['damage_mult']), 'notes': 'Counts slots more than 50 game pixels behind the body centre.'},
        'bottom_melee_damage_plasmid': lambda: {'effects': zone('bottom', damage=v['damage_mult'], meleeOnly=True), 'notes': 'Counts slots more than 50 game pixels behind the body centre.'},
        'top_damage_plasmid': lambda: {'effects': zone('top', damage=v['damage_mult']), 'notes': 'Counts slots more than 50 game pixels in front of the body centre.'},
        # The file names are swapped in the game: this script boosts mitochondria on the right...
        'left_actives_plasmid': lambda: {'effects': zone('right', generatorStrength=v['overcharge_mult']), 'notes': "What the game's code does: mitochondria on the right half (more than 50 game pixels from the centre) get +40% Overcharge strength. The description promises faster actives on the left instead."},
        # ...and this one makes actives on the left charge faster.
        'right_overcharge_plasmid': lambda: {'effects': zone('left', activeCharge=v['overcharge_mult']), 'notes': "What the game's code does: actives on the left half (more than 50 game pixels from the centre) charge 40% faster. The description promises stronger mitochondria on the right instead."},
        'nanobot_damage_slot_plasmid': lambda: {'notes': 'Mark those slots as Volatile in the editor.'},
        'nanobot_energy_slot_plasmid': lambda: {'notes': 'Mark those slots as Conductive in the editor.'},
        'amoeba_energy_slot_plasmid': lambda: {'notes': 'Mark those slots as Conductive in the editor.'},
        'worm_tail_contact_damage_plasmid': lambda: {'notes': 'Tail contact damage is not counted in DPS.'},
        'worm_tail_explode_plasmid': lambda: {'notes': 'Dodge explosions are not counted in DPS.'},
        'worm_tail_reflect_plasmid': lambda: {'notes': 'Reflected bullets are not counted in DPS.'},
    }.get(script, lambda: {})()


def script_defaults(src):
    """Numeric `@export var` and `const` defaults from a script's source."""
    out = {}
    for name, val in re.findall(r'^(?:@export var|const) (\w+)\s*(?::\s*\w+)?\s*:?=\s*(-?[\d.]+)\s*$', src, re.M):
        out[name.lower()] = float(val) if '.' in val else int(val)
    return out


PERCENT = re.compile(r'mult|chance|bonus|discount|strength|per_')


def format_text(text, values):
    def fill(m):
        key = m.group(1)
        if key not in values:
            # Some descriptions name their value differently from the script (damage_mult vs per_level_mult).
            kind = next((k for k in ('mult', 'chance', 'bonus', 'discount', 'per') if k in key), None)
            alike = [k for k in values if kind and kind in k]
            if len(alike) != 1:
                return m.group(0)
            key = alike[0]
        v = values[key]
        if m.group(2):
            # "{damage_mult}x": shown as a multiplier.
            return f'{round(1 + v, 2):g}×'
        if isinstance(v, float) and PERCENT.search(key):
            return f'{round(v * 100, 2):g}'
        return str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)
    text = re.sub(r'\(Currently[^)]*\)', '', text)
    text = text.replace('{heart} HP', 'HP').replace('{heart}', 'HP')
    text = re.sub(r'\{(\w+)\}(×)?', fill, text)
    text = text.replace('{hr}', '. ').replace('\n', '. ')
    text = re.sub(r'\[/?(b|i|center|font_size[^\]]*|color[^\]]*|img[^\]]*)\]', '', text)
    text = re.sub(r'res://\S+', '', text)
    text = re.sub(r'\{/?\w+\}', '', text)
    text = re.sub(r'([+-]) (\d)', r'\1\2', text)
    text = re.sub(r'\s+([.,])', r'\1', re.sub(r'\s{2,}', ' ', text)).strip()
    text = text.replace('. .', '.')
    return text if text.endswith('.') else text + '.'


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def main(pck_path):
    pack = Pack(pck_path)
    en = [n for n in pack.index if n.endswith('.en.translation') and not n.startswith(('addons/', 'mod_example/'))]
    t = Translation(parse(pack.raw(max(en, key=lambda n: pack.index[n][1])))['resources'][-1]['props'])
    art_dir = os.path.join(REPO, 'public', 'art', 'plasmids')
    os.makedirs(art_dir, exist_ok=True)
    icons = {}

    def icon(texture):
        if not isinstance(texture, str):
            return None
        if texture not in icons:
            fmt, data, _ = export(pack, texture)
            name = slug(os.path.splitext(os.path.basename(texture))[0]) + '.' + fmt
            with open(os.path.join(art_dir, name), 'wb') as f:
                f.write(data)
            icons[texture] = 'art/plasmids/' + name
        return icons[texture]

    def mutation_info(path):
        res = pack.resource(path)
        props = {k: clean(v, res['ext']) for k, v in res['resources'][-1]['props'].items()}
        name = t.get(props.get('ui_name', '')) or props.get('ui_name', '')
        desc = t.get(props.get('description', '')) or ''
        values = script_defaults(pack.raw(props['script'].replace('res://', '')).decode()) if isinstance(props.get('script'), str) else {}
        values.update({k: v for k, v in props.items() if isinstance(v, (int, float)) and not isinstance(v, bool)})
        return name, format_text(desc, values)

    out = {}
    for cid, scene in MAPS.items():
        res = pack.resource(f'res://scn/metaprogression/plasmids/{scene}.tscn')
        ext = res['ext']
        nodes = scene_nodes(res)
        entries = []
        for i, n in enumerate(nodes):
            if n['parent'] != 0 or not n.get('instance'):
                continue
            inst = clean(n['instance'], ext)
            if not inst.startswith('res://scn/metaprogression/plasmids/all/'):
                continue
            pres = pack.resource(inst)
            pnodes = scene_nodes(pres)
            root = {k: clean(v, pres['ext']) for k, v in pnodes[0]['props'].items()}
            script = os.path.basename(root.get('script', ''))[:-3]
            src = pack.raw(root['script'].replace('res://', '')).decode() if root.get('script') else ''
            base_script = re.search(r'extends "?res://[^"]*/(\w+)\.gd', src)
            values = {**script_defaults(src)}
            values.update({k: v for k, v in root.items() if isinstance(v, (int, float)) and not isinstance(v, bool)})
            over = {k: clean(v, ext) for k, v in n['props'].items()}
            values.update({k: v for k, v in over.items() if isinstance(v, (int, float)) and not isinstance(v, bool)})
            texture = next((clean(c['props'].get('texture'), ext) for c in nodes if c['parent'] == i and 'texture' in c['props']), None)
            if texture is None:
                texture = next((clean(c['props'].get('texture'), pres['ext']) for c in pnodes[1:] if 'texture' in c['props']), None)
            name = t.get(over.get('ui_name') or root.get('ui_name', '')) or over.get('ui_name') or root.get('ui_name', '')
            desc = t.get(over.get('description') or root.get('description', '')) or ''
            entry = {'id': f"{cid}-{n['name'].lower()}", 'name': name, 'description': '', 'x': round(over.get('position', [0, 0])[0]), 'y': round(over.get('position', [0, 0])[1])}
            mutation = over.get('mutation_res') or root.get('mutation_res')
            if isinstance(mutation, str):
                mname, mdesc = mutation_info(mutation)
                entry['name'] = f'Start with {mname}'
                entry['description'] = f'Start with {mname}: {mdesc}'
                entry['mutation'] = slug(mname)
            elif script == 'starting_plasmid':
                entry['name'] = 'Start'
                entry['description'] = 'The root of the tree: always owned.'
                entry['root'] = True
            elif script.startswith('loadout_limit'):
                scene_kind = os.path.basename(inst).split('_')[2]
                kind = {'weapon': 'weapon', 'lashes': 'flagellum', 'mitochondria': 'mitochondrion', 'internals': 'internal organelle'}.get(scene_kind, 'organelle')
                entry['description'] = f'Raises the starting {kind} loadout limit by 1.'
            else:
                entry['description'] = format_text(desc, values) if desc else name + '.'
                entry.update(effects_for(script if not base_script else script, values))
            ic = icon(texture)
            if ic:
                entry['icon'] = ic
            entry['links'] = [f"{cid}-{os.path.basename(clean(c['props']['to'], ext)).lower()}" for c in nodes if c['parent'] == i and 'to' in c['props']]
            entries.append(entry)
        out[cid] = entries
        print(f'{cid}: {len(entries)} nodes')
    with open(os.path.join(REPO, 'src', 'data', 'plasmids.json'), 'w') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'{len(icons)} icons in {art_dir}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
