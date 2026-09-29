"""Each pathogen as the character select shows it, for the app's pathogen carousel.

    python3 tools/extract/specimens.py path/to/pathogenic.pck

The character select (scn/ui/start_menus/player_selection.tscn) puts every
pathogen's player scene in a glass tube (tube.tscn), sized by the tube's
player_scale and lit from below in its own colour. The scene shows the starting
body with the hairs attached to it (scn/cells/hair.tscn under ToAttach: the
Bacterium's eyes, cilia and tails, the Fungal Spore's bristles, the Helminth's
feelers), swaying the way hair.gd moves them.

Writes:

    src/data/specimens.json      per class: player_scale, the tube light's colour and
                                 its hairs, in editor units (100 game pixels) relative
                                 to the body's centre bone like src/data/bodies.json
    public/art/specimens/*.webp  the textured hairs' textures

Only positions, sizes, colours and textures are copied: never scripts.
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
from bodies import CLASSES, read_body  # noqa: E402
from ctex import export  # noqa: E402
from extract import Pack, clean  # noqa: E402
from gdres import scene_nodes  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCALE = 100.0
SCENES = {
    **{cid: scene for cid, (scene, _config) in CLASSES.items()},
    'nanobot': 'res://scn/player/player_nanobot/player_nanobot.tscn',
    'amoeba': 'res://scn/player/player_amoeba/player_amoeba.tscn',
}
# hair.gd's defaults, and Line2D's.
HAIR = {'segment_length': 5.0, 'num_segments': 5, 'stiffness': 0.5, 'fluidity': 0.9, 'sway_angle': 0.17453292, 'width': 10.0}
LINE_CAP = {0: 0, 1: 1, 2: 2}


def u(v):
    return round(v / SCALE, 4)


def hex_color(c):
    """Line2D colours are HDR (the game's glow brightens them): clip to what a screen shows."""
    return '#' + ''.join(f'{round(min(1.0, max(0.0, v)) * 255):02x}' for v in c[:3])


def bezier(a, b, c, d, t):
    s = 1 - t
    return a * s ** 3 + 3 * b * s * s * t + 3 * c * s * t * t + d * t ** 3


def sample_curve(curve, x):
    """Godot's Curve.sample: a cubic Bezier between neighbouring points, control points a third of the way along."""
    data = curve['_data']
    pts = [(data[i][0], data[i][1], data[i + 1], data[i + 2]) for i in range(0, len(data), 5)]
    if x <= pts[0][0]:
        return pts[0][1]
    for (ax, ay, _al, ar), (bx, by, bl, _br) in zip(pts, pts[1:]):
        if x <= bx:
            d = bx - ax
            if d <= 1e-9:
                return by
            t = (x - ax) / d
            return bezier(ay, ay + d / 3 * ar, by - d / 3 * bl, by, t)
    return pts[-1][1]


def hairs(pack, res, center, art_dir):
    ext = res['ext']
    locals_ = {r['path']: r for r in res['resources'] if r.get('path', '').startswith('local://')}
    nodes = scene_nodes(res)
    attach = next((i for i, n in enumerate(nodes) if n['name'] == 'ToAttach'), None)
    out = []
    for n in nodes:
        inst = clean(n['instance'], ext) if n.get('instance') else None
        if n['parent'] != attach or not (isinstance(inst, str) and inst.endswith('/cells/hair.tscn')):
            continue
        p = {**HAIR, **n['props']}
        if p.get('visible') is False:
            continue
        k = (p.get('scale') or [1.0, 1.0])[0]
        count = int(p['num_segments'])
        x, y = p.get('position', [0.0, 0.0])
        hair = {
            'x': u(x - center[0]),
            'y': u(y - center[1]),
            'rot': round(p.get('rotation', 0.0), 4),
            'n': count,
            'seg': u(p['segment_length'] * k),
            'width': u(p['width'] * k),
            'stiffness': round(p['stiffness'], 3),
            'fluidity': round(p['fluidity'], 3),
            'sway': round(p['sway_angle'], 4),
        }
        curve = locals_.get(clean(p.get('width_curve'), ext))
        if curve:
            hair['widths'] = [round(sample_curve(curve['props'], i / max(1, count - 1)), 3) for i in range(count)]
        tex = locals_.get(clean(p.get('texture'), ext))
        diffuse = clean(tex['props'].get('diffuse_texture'), ext) if tex else None
        if diffuse:
            fmt, data, _size = export(pack, diffuse)
            name = os.path.basename(diffuse).rsplit('.', 1)[0].replace('_', '-') + '.' + fmt
            with open(os.path.join(art_dir, name), 'wb') as f:
                f.write(data)
            hair['src'] = f'art/specimens/{name}'
            # Textured lines keep the scene's caps (Line2D.LINE_CAP_BOX in hair.tscn).
            hair['caps'] = [LINE_CAP[p.get('begin_cap_mode', 1)], LINE_CAP[p.get('end_cap_mode', 1)]]
        else:
            # hair.gd rounds an untextured hair's ends.
            hair['color'] = hex_color(p.get('default_color', [1.0, 1.0, 1.0, 1.0]))
        if p.get('show_behind_parent'):
            hair['behind'] = True
        out.append(hair)
    return out


def tubes(pack):
    """player_scale and light colour for each class, from the character select's tubes."""
    res = pack.resource('res://scn/ui/start_menus/player_selection.tscn')
    ext = res['ext']
    nodes = scene_nodes(res)
    by_scene = {scene: cid for cid, scene in SCENES.items()}
    out = {}
    for i, n in enumerate(nodes):
        scene = clean(n['props'].get('player_scene'), ext)
        if scene not in by_scene:
            continue
        light = next((c for c in nodes if c['parent'] == i and c['name'] == 'PointLight2D'), None)
        color = light and light['props'].get('color')
        out[by_scene[scene]] = {'scale': round(n['props'].get('player_scale', 1.0), 3), **({'light': hex_color(color)} if color else {})}
    return out


def main(pck_path):
    pack = Pack(pck_path)
    art_dir = os.path.join(REPO, 'public', 'art', 'specimens')
    os.makedirs(art_dir, exist_ok=True)
    out = {}
    tube = tubes(pack)
    with tempfile.TemporaryDirectory() as tmp:
        for cid, scene in SCENES.items():
            res = pack.resource(scene)
            # Only the evolving classes' bodies are in bodies.json, centred on their centre bone.
            center = read_body(pack, scene, cid, tmp).get('center', [0.0, 0.0]) if cid in CLASSES else [0.0, 0.0]
            out[cid] = {**tube.get(cid, {'scale': 1.0}), 'hairs': hairs(pack, res, center, art_dir)}
            print(f"{cid}: scale {out[cid]['scale']}, {len(out[cid]['hairs'])} hairs")
    path = os.path.join(REPO, 'src', 'data', 'specimens.json')
    with open(path, 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print(f'wrote {path}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
