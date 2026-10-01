"""What a run's seed decides: the reward pools, their weights and the rooms that draw from them.

    python3 tools/extract/seeded.py path/to/pathogenic.pck

The game turns the 8-character seed into every random choice of a run
(level_generator.gd, editor.gd, bodypart_reward.gd and friends). The app redoes
that maths in src/engine/seeded; this script collects the data it needs:

- the mutation pool in load order (globals.gd: all_mutations.tres, then the
  Amoeba's and the Nanobot's), with weights, reward drop rates and the script
  that changes a mutation's weight, if any;
- the organelle pool in load order (all_bodyparts.tres), with weights, tags,
  devil-room weights, unlocks and what the mutations' weight rules look at;
- each floor's normal room count and layout;
- the rooms that hand out organelles (bosses, shops, item rooms, special and
  secret rooms): every node that draws from the floor's reward stream, in the
  order the game creates them, with its settings;
- each pathogen's starting stamina and dodge numbers.

Writes src/data/seeded.json. Only names, numbers and settings are copied: never scripts.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from extract import Pack, clean  # noqa: E402
from gdres import parse  # noqa: E402
from gdtr import Translation  # noqa: E402
from scenes import build, walk  # noqa: E402
from uids import resolve  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ROOMS = 'res://scn/environ/rooms/'
FLOORS = ['skin', 'intestine', 'stomach', 'liver', 'lungs', 'heart', 'brain']
PLAYERS = {
    'bacterium': 'res://scn/player/player.tscn',
    'fungal-spore': 'res://scn/player/player_strafer/player_strafer.tscn',
    'helminth': 'res://scn/player/player_worm/player_worm_long.tscn',
    'diatom': 'res://scn/player/player_coop/player_coop.tscn',
    'lil-collector': 'res://scn/player/player_collector/player_collector.tscn',
    'nanobot': 'res://scn/player/player_nanobot/player_nanobot.tscn',
    'amoeba': 'res://scn/player/player_amoeba/player_amoeba.tscn',
}
# The game's defaults for the nodes that draw from the reward stream.
REWARD_DEFAULTS = {'item_type': 8, 'item_pool': [], 'mutations_possible': True, 'rarity_from': 0, 'rarity_to': 0,
                   'unique_from': [], 'choose_one': False, 'devil_reward': False}
SHOP_DEFAULTS = {'cost': 10, 'sale_possible': True, 'pay_with_blood': False, 'skip_scaling': False}
SPECIAL = ['blacksmith_room', 'challenge_room', 'dna_room_1', 'dna_room_2', 'heal_room_1', 'heal_room_2']
SECRET = ['secret_room1', 'secret_room2']


def props_of(pack, path):
    res = pack.resource(resolve(pack, path))
    return {k: clean(v, res['ext']) for k, v in res['resources'][-1]['props'].items()}


def group(pack, path):
    """A ResourceGroup's paths, in the order load_all_into loads them."""
    return [resolve(pack, p) for p in props_of(pack, path).get('paths', [])]


def script_text(pack, path):
    return pack.raw(path.replace('res://', '')).decode('utf8', 'replace') if path else ''


def class_paths(pack):
    out = {}
    for n in pack.names('scn/', '.gd'):
        m = re.search(rb'^(?:@tool\s+)?class_name\s+(\w+)', pack.raw(n), re.M)
        if m:
            out[m.group(1).decode()] = 'res://' + n
    return out


def scripts(pack, path, classes):
    """A script and the scripts it extends, nearest first."""
    out = []
    while isinstance(path, str) and path.startswith('res://') and len(out) < 24:
        out.append(path)
        m = re.search(r'^(?:@tool\s+)?(?:class_name\s+\w+\s+)?extends\s+"?([\w./:]+)"?', script_text(pack, path), re.M)
        path = None if not m else (m.group(1) if m.group(1).startswith('res://') else classes.get(m.group(1)))
    return out


def chain(pack, path, classes):
    """A script's class names and file names, up its `extends` chain."""
    names = []
    for p in scripts(pack, path, classes):
        names.append(key_of(p))
        m = re.search(r'^(?:@tool\s+)?class_name\s+(\w+)', script_text(pack, p), re.M)
        if m:
            names.append(m.group(1))
    return names


def drop_rule(pack, path, classes, base):
    """The script whose modify_drop_rate decides the weight, unless it's the base class's."""
    for p in scripts(pack, path, classes):
        if key_of(p) == base:
            return None
        if re.search(r'^func modify_drop_rate\(', script_text(pack, p), re.M):
            return key_of(p)
    return None


def const_list(src, name):
    m = re.search(name + r'\s*(?::=|=)\s*\[([^\]]*)\]', src)
    return re.findall(r'"([^"]+)"', m.group(1)) if m else []


def const_num(src, name):
    m = re.search(r'(?:const|var|@export var)\s+' + name + r'\s*(?::\s*\w+\s*)?:?=\s*([-\d.]+)', src)
    return float(m.group(1)) if m else None


def key_of(path):
    return path.split('/')[-1].rsplit('.', 1)[0]


def draws(pack, scene):
    """Every node in a room that draws from the floor's reward stream, in the order the game draws."""
    root = build(pack, scene)
    out = []
    for phase, node in walk(root):
        script = node.script.split('/')[-1]
        path = node.path_from(root)
        p = node.props
        if phase == 'enter' and script == 'bodypart_reward.gd':
            o = {**REWARD_DEFAULTS, **{k: p[k] for k in REWARD_DEFAULTS if k in p}}
            # NodePaths are relative to the reward itself.
            unique = [t.path_from(root) for t in (node.find(u) for u in o['unique_from']) if t is not None]
            out.append({
                'kind': 'pick', 'path': path, 'itemType': o['item_type'],
                'pool': [{'key': key_of(i), 'mutation': '/mutations/' in i} for i in o['item_pool']] or None,
                'mutations': o['mutations_possible'], 'rarity': [o['rarity_from'], o['rarity_to']],
                'unique': unique, 'chooseOne': o['choose_one'], 'devil': o['devil_reward'],
            })
        elif phase == 'ready' and script == 'shop_item.gd':
            o = {**SHOP_DEFAULTS, **{k: p[k] for k in SHOP_DEFAULTS if k in p}}
            contents = [c.script.split('/')[-1][:-3] for c in node.children if c.script and not c.script.endswith('pickup_area.gd')]
            out.append({'kind': 'shop', 'path': path, 'cost': o['cost'], 'sale': o['sale_possible'], 'blood': o['pay_with_blood'],
                        'skipScaling': o['skip_scaling'], 'contents': contents})
        elif phase == 'ready' and script == 'bodypart_reward_3_choice.gd':
            out.append({'kind': 'choice', 'path': path, 'shown': [bool(c.props.get('visible', True)) for c in node.children],
                        'money': bool(p.get('spawn_money_reward', False))})
        elif phase == 'ready' and script == 'reward.gd':
            out.append({'kind': 'drop', 'path': path})
    return out


def main(pck_path):
    pack = Pack(pck_path)
    en = [n for n in pack.index if n.endswith('.en.translation') and not n.startswith(('addons/', 'mod_example/'))]
    tr = Translation(parse(pack.raw(max(en, key=lambda n: pack.index[n][1])))['resources'][-1]['props'])

    def name(key):
        # Some names carry BBCode effects ([matrix]...[/matrix]) and are shouted in capitals.
        text = re.sub(r'\[/?\w+[^\]]*\]', '', tr.get(key) or key) if isinstance(key, str) else None
        return text.title() if text and text.isupper() else text
    classes = class_paths(pack)

    mutations = []
    for lst in ['res://scn/player/mutations/all_mutations.tres', 'res://scn/player/player_amoeba/evolutions/all_amoeba_evolutions.tres',
                'res://scn/player/player_nanobot/mutations/all_nanobot_mutations.tres']:
        for path in group(pack, lst):
            p = props_of(pack, path)
            mutations.append({
                'key': key_of(path), 'name': name(p.get('ui_name')), 'weight': p.get('random_weight', 1.0),
                'reward': p.get('reward_drop_rate', 0.0), 'unlock': bool(p.get('unlock')),
                'rule': drop_rule(pack, p.get('script'), classes, 'mutation'),
            })

    rules_src = {k: script_text(pack, f'res://scn/player/mutations/all/{k}.gd') for k in
                 ['cryolysis_mutation', 'pyrogenesis_mutation', 'hormesis_mutation', 'dodge_invul_mutation', 'dodge_cd_mutation', 'stamina_mutation']}
    burn_scenes = const_list(rules_src['pyrogenesis_mutation'], 'burn_scene_paths')
    freeze_ids = const_list(rules_src['cryolysis_mutation'], 'FREEZE_BODYPART_IDS')
    synergy_ids = const_list(rules_src['hormesis_mutation'], 'SYNERGY_BODYPARTS')
    player_src = script_text(pack, 'res://scn/player/player.gd')

    organelles = []
    for path in group(pack, 'res://scn/player/bodyparts/all_bodyparts.tres'):
        p = props_of(pack, path)
        src = script_text(pack, p.get('script'))
        key = key_of(path)
        scene = path[:-5] + '.tscn'
        root_script = None
        try:
            root_script = build(pack, scene).script or None
        except Exception:  # noqa: BLE001 - improvements have no scene of their own
            pass
        kinds = set(chain(pack, root_script, classes)) if root_script else set()
        rule = drop_rule(pack, p.get('script'), classes, 'bodypart_resource')
        organelles.append({
            'key': key, 'name': name(p.get('ui_name')), 'weight': p.get('random_weight', 1.0), 'tags': p.get('tags', []),
            'devil': p.get('devil_drop_chance', 0.0), 'noPrefixes': bool(p.get('no_prefixes')), 'excitable': bool(p.get('supports_excitable')),
            'onlyCommon': bool(p.get('can_only_be_common')), 'unlock': bool(p.get('unlock')),
            'needsEnergy': 0 in (p.get('needs_connection_warning') or []),
            'active': 'ActiveBodypart' in kinds, 'lash': 'Lash' in kinds,
            'tentacle': 'ParasiteTentacleBase' in kinds or 'SymbioticPseudopod' in kinds,
            'burn': scene in burn_scenes, 'freeze': key in freeze_ids, 'hormesis': key in synergy_ids,
            **({'rule': rule} if rule else {}),
            **({'boost': const_num(src, 'MELEE_DROP_BOOST')} if rule == 'range_extender_resource' else {}),
        })

    floors = []
    for i, f in enumerate(FLOORS):
        p = props_of(pack, f'res://scn/environ/levels/level_config_{f}.tres')
        pool = [r for r in group(pack, p['room_pool'])]
        bosses = []
        for r in pool:
            rp = props_of(pack, r)
            if rp.get('type', 0) != 1 or (rp.get('allowed_levels') and i + 1 not in rp['allowed_levels']):
                continue
            bosses.append({'key': key_of(r), 'draws': draws(pack, r[:-5] + '.tscn')})
        normal = [len(draws(pack, r[:-5] + '.tscn')) for r in pool if props_of(pack, r).get('type', 0) == 0]
        layout = key_of(p['script']).replace('level_config', '').strip('_') or 'standard'
        floors.append({
            'level': i + 1, 'key': f, 'name': name(p.get('ui_name')), 'rooms': p['room_num'], 'layout': layout,
            'roomDraws': sorted(set(normal)), 'start': len(draws(pack, resolve(pack, p['start_room'])[:-5] + '.tscn')), 'bosses': bosses,
            **({'tiers': p.get('tier_sizes', [3, 3, 3, 3, 3, 3]), 'hub': [key_of(r) for r in p.get('hub1_room_pool', [])]} if layout == 'heart' else {}),
        })

    def room(key, folder='special'):
        path = f'{ROOMS}{folder}/{key}.tres'
        p = props_of(pack, path)
        return {'key': key, 'weight': p.get('random_weight', 1.0), 'draws': draws(pack, path[:-5] + '.tscn')}

    item_rooms = [room(k) for k in ['item_room', 'item_room_1_item', 'item_room_2_item']]
    players = {}
    for cid, scene in PLAYERS.items():
        root = build(pack, scene)
        kinds = set(chain(pack, root.script, classes))
        players[cid] = {
            'kind': next((k for k in ['PlayerNanobot', 'PlayerAmoeba', 'PlayerStrafer'] if k in kinds), 'Player'),
            'maxStamina': root.props.get('max_stamina', const_num(player_src, 'max_stamina')),
            'dodgeCd': root.props.get('dodge_cd', const_num(player_src, 'dodge_cd')),
            'dodgeInvul': root.props.get('dodge_invulnerability', const_num(player_src, 'dodge_invulnerability')),
        }

    br = script_text(pack, 'res://scn/environ/pickups/bodypart_reward.gd')
    out = {
        'alphabet': re.search(r'seed_alphabet\s*(?::=|=)\s*"([^"]+)"', script_text(pack, 'res://scn/globals.gd')).group(1),
        'mutations': mutations,
        'organelles': organelles,
        'players': players,
        'floors': floors,
        'shop': room('shop')['draws'],
        'heartShop': room('heart_shop', 'heart')['draws'],
        'itemRooms': item_rooms,
        'special': [room(k) for k in SPECIAL],
        'secret': [room(k) for k in SECRET],
        'rules': {
            'prefixChance': const_num(br, 'PREFIX_CHANCE'),
            'maxDodgeUptime': const_num(player_src, 'MAX_DODGE_INVUL_UPTIME'),
            'invulAdd': const_num(rules_src['dodge_invul_mutation'], 'INVUL_ADD'),
            'cdMult': const_num(rules_src['dodge_cd_mutation'], 'CD_MULT'),
            'staminaAdd': float(re.search(r'max_stamina\s*\+=\s*([\d.]+)', rules_src['stamina_mutation']).group(1)),
            'shopDiscount': const_num(script_text(pack, 'res://scn/player/mutations/all/shop_discount_mutation.gd'), 'discount'),
            'betterDrops': const_num(script_text(pack, 'res://scn/player/mutations/all/better_drops_mutation.gd'), 'chance'),
            'betterDropsPlasmid': const_num(script_text(pack, 'res://scn/metaprogression/plasmids/all/better_drops_plasmid.gd'), 'chance'),
            'betterDropsPerFloor': const_num(script_text(pack, 'res://scn/metaprogression/plasmids/all/better_drops_progression_plasmid.gd'), 'per_level_chance'),
        },
    }
    dest = os.path.join(REPO, 'src', 'data', 'seeded.json')
    with open(dest, 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print('wrote', dest, len(mutations), 'mutations', len(organelles), 'organelles')


if __name__ == '__main__':
    main(sys.argv[1])
