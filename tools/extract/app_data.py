"""Turn extracted game data into the calculator's data files.

    python3 tools/extract/app_data.py path/to/output

Reads bodies.json (from bodies.py) in the output directory and writes:

    src/data/bodies.json     body plans in editor units (100 game pixels = 1),
                             centred on the body's centre bone
    public/art/bodies/*      body sprites

Only positions, connections, outlines and sprites are copied: never scripts.
"""
import json
import os
import shutil
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCALE = 100.0


def u(v):
    return round(v / SCALE, 3)


def main(out_dir):
    src = json.load(open(os.path.join(out_dir, 'bodies.json')))
    art = os.path.join(REPO, 'public', 'art', 'bodies')
    os.makedirs(art, exist_ok=True)
    bodies = {}
    for key, b in src['bodies'].items():
        cx, cy = b.get('center', [0, 0])
        plan = {
            'id': key,
            'name': b['name'],
            'tier': b['tier'],
            'slots': [
                {
                    'id': s['id'],
                    'kind': 'internal' if s['internal'] else 'external',
                    **({'special': s['special']} if s['special'] else {}),
                    'x': u(s['x'] - cx),
                    'y': u(s['y'] - cy),
                    'r': round(s['rotation'], 3),
                    **({'mirrorOf': s['mirrorOf']} if s.get('mirrorOf') else {}),
                }
                for s in b['slots']
            ],
            'links': b['links'],
            'outline': [[u(x - cx), u(y - cy)] for x, y in b.get('outline', [])],
        }
        if b.get('bonusDamage'):
            plan['bonusDamage'] = b['bonusDamage']
        if b.get('bonusHp'):
            plan['bonusHp'] = b['bonusHp']
        if b.get('description'):
            plan['description'] = b['description']
        if b.get('sprite'):
            sp = b['sprite']
            shutil.copy(os.path.join(out_dir, sp['file']), os.path.join(art, os.path.basename(sp['file'])))
            plan['sprite'] = {'src': 'art/' + sp['file'], 'x': u(sp['x'] - cx), 'y': u(sp['y'] - cy), 'w': u(sp['w']), 'h': u(sp['h'])}
        bodies[key] = plan
    out = {'classes': src['classes'], 'bodies': bodies}
    with open(os.path.join(REPO, 'src', 'data', 'bodies.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
        f.write('\n')
    print(f'wrote {len(bodies)} body plans to src/data/bodies.json and {art}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
