"""Extract how each organelle looks on the body, and the empty slot sprites.

    python3 tools/extract/organelle_art.py path/to/pathogenic.pck

Writes:

    src/data/organelle_art.json    per organelle, the layers the game draws at
                                   its slot, and each slot type's sprites, in
                                   editor units (100 game pixels = 1)
    public/art/body-parts/*.webp   the textures those layers use

Each organelle's scene (scn/player/bodyparts/<internal|external>/<id>.tscn) is
read for the sprites and textured lines it draws at rest. Coordinates are in the
slot's own frame: +x points out of the body along the slot's facing, which is how
Slot.attach_bodypart places a bodypart (at the slot, unrotated).

- Textured Line2Ds (weapons, pseudopods, flagella) are straight at rest (see
  reset_line in gun.gd). With LINE_TEXTURE_STRETCH the texture spans the whole
  line, box caps included: `width` across, from the first point minus half the
  width to the last point plus half the width.
- The plain Flagellum is an untextured line with a width curve, tinted per
  pathogen (normal_lash.gd); it is written out as a polygon.
- Internal organelles draw a sprite, plus a pattern the game masks to the body.
- `rarity` lists textures that replace the main layer's at higher rarities
  (Bodypart.rarity_textures); every other organelle gets a rarity outline.
  Like the game (Bodypart.update_rarity_texture), only the main node is
  outlined: its Sprite, else its Line2D, else its Hair2. `outline` is the
  radius of scn/shaders/outline_*.tres (3 texels, 6 for internal organelles),
  in the published texture's pixels.
- `motion` says how the organelle moves at rest in the game's organelle editor
  (the screen this app recreates), with the values its scripts use:
    gun       every weapon (gun.gd): the aim sways by sin(t * speed) / 5 rad
              and the line eases toward it, bending along its length. The
              Chemoreceptor Antenna does the same with its own constants.
    tentacle  pseudopods (scn/cells/tentacle.gd): the first segment wobbles and
              the rest straighten after it, so a wave runs down the tentacle.
    lash      flagella (lash.gd): the connector piece flutters, and the body
              (a Hair, scn/cells/hair.gd) trails behind it.
    pulse     internal organelles: an autoplayed AnimationPlayer scales the
              Visual node (the sprite, not the masked pattern).
  Animated Line2D layers carry `chain` (their points, spacing, caps, width) so
  the app can bend them.
- `link` is what the editor's connection arrows need: the organelle's tags
  (from its .tres), which decide what it connects to (Bodypart.can_connect_to),
  and the HDR colour of the arrows it sends (Bodypart.get_connection_color).
"""
import io
import json
import math
import os
import re
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from ctex import export  # noqa: E402
from extract import TAGS, Pack, clean  # noqa: E402
from gdres import scene_nodes  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ART = os.path.join(REPO, 'public', 'art', 'body-parts')
SCALE = 100.0
# Textures are stored at up to this many texels per game pixel they're drawn at
# (the body view never zooms past about 1 screen pixel per game pixel).
MAX_DENSITY = 2.0
RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic']
# Script defaults (their @export values); scenes override them per organelle.
GUN = {'segment_length': 10.0, 'num_segments': 20, 'stiffness': 0.7}  # gun.gd
TENTACLE = {'segment_length': 25.0, 'num_segments': 12, 'fluidity': 0.9, 'straighten_force': 0.5, 'spring_stiffness': 1.5,
            'wobble_amount': 10.0, 'wobble_speed': 3.0, 'min_stretch': 0.5, 'max_stretch': 12.0}  # scn/cells/tentacle.gd
HAIR = {'segment_length': 5.0, 'num_segments': 5, 'stiffness': 0.5, 'fluidity': 0.9, 'sway_angle': math.radians(10)}  # scn/cells/hair.gd
# chemoreceptor_antenna.gd's constants: its line rebuilds itself, and rests like a gun.
ANTENNA = {'segment_length': 8.0, 'num_segments': 17, 'stiffness': 0.8, 'amp': 0.18}
# Slot scenes: a plain slot, and the special slots that grafts and built-in slots
# turn a slot into (the same names as bodies.py's SPECIAL).
SLOT_SCENES = {
    'plain': 'res://scn/player/bodyparts/slot.tscn',
    'volatile': 'res://scn/player/bodyparts/slot_damage.tscn',
    'conductive': 'res://scn/player/bodyparts/slot_energy.tscn',
    'omni': 'res://scn/player/bodyparts/slot_turret.tscn',
}


def u(v):
    return round(v / SCALE, 4)


# 2D affine transforms as (a, b, c, d, e, f): x' = a*x + c*y + e, y' = b*x + d*y + f.
def mat(pos=(0, 0), rot=0.0, scale=(1, 1)):
    cs, sn = math.cos(rot), math.sin(rot)
    return (cs * scale[0], sn * scale[0], -sn * scale[1], cs * scale[1], pos[0], pos[1])


def mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f)


def apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def is_translation(m):
    return abs(m[0] - 1) < 1e-4 and abs(m[3] - 1) < 1e-4 and abs(m[1]) < 1e-4 and abs(m[2]) < 1e-4


def curve_sampler(curve):
    """Godot's Curve.sample: cubic Bezier between points, using their tangents."""
    data = curve['_data']
    pts = [(data[i][0], data[i][1], data[i + 1], data[i + 2]) for i in range(0, len(data), 5)]

    def sample(t):
        if t <= pts[0][0]:
            return pts[0][1]
        for (x0, y0, _, rt), (x1, y1, lt, _) in zip(pts, pts[1:]):
            if t <= x1:
                d = x1 - x0
                s = (t - x0) / d if d else 0
                c0, c1 = y0 + rt * d / 3, y1 - lt * d / 3
                return (1 - s) ** 3 * y0 + 3 * (1 - s) ** 2 * s * c0 + 3 * (1 - s) * s ** 2 * c1 + s ** 3 * y1
        return pts[-1][1]

    return sample


class Scene:
    """A scene's nodes, with instanced sub-scenes' root properties merged in."""

    def __init__(self, pack, path):
        res = pack.resource(path)
        self.ext = res['ext']
        self.local = {r['path']: r for r in res['resources']}
        self.nodes = scene_nodes(res)
        for n in self.nodes:
            n['props'] = {k: self.resolve(v) for k, v in n['props'].items()}
            inst = clean(n['instance'], self.ext) if n.get('instance') is not None else None
            if isinstance(inst, str) and inst.endswith('.tscn'):
                base = Scene(pack, inst)
                root = base.nodes[0]
                n['type'] = n['type'] or root['type']
                n['props'] = {**root['props'], **n['props']}

    def resolve(self, v):
        v = clean(v, self.ext)
        if isinstance(v, str) and v in self.local:
            r = self.local[v]
            return {'_type': r['type'], **{k: self.resolve(x) for k, x in r['props'].items()}}
        return v

    def world(self, i):
        """Transform of node i in the scene root's frame (the root's own transform is
        ignored: attach_bodypart resets it), and whether it is visible."""
        m, visible = (1, 0, 0, 1, 0, 0), True
        while i > 0:
            p = self.nodes[i]['props']
            if p.get('visible') is False:
                visible = False
            m = mul(mat(p.get('position', (0, 0)), p.get('rotation', 0.0), p.get('scale', (1, 1))), m)
            i = self.nodes[i]['parent']
        return m, visible

    def z(self, i):
        z = 0
        while i > 0:
            z += self.nodes[i]['props'].get('z_index', 0)
            i = self.nodes[i]['parent']
        return z


def texture_path(tex):
    if isinstance(tex, dict):
        return tex.get('diffuse_texture')
    return tex if isinstance(tex, str) else None


class Textures:
    """Exports textures once each, scaled down to what the body view needs."""

    def __init__(self, pack):
        self.pack = pack
        self.done = {}
        self.sizes = {}

    def size(self, path):
        if path not in self.sizes:
            _, data, _ = export(self.pack, path)
            self.sizes[path] = Image.open(io.BytesIO(data)).size
        return self.sizes[path]

    def publish(self, path, drawn_width):
        """Writes the texture and returns its URL path under public/."""
        name = re.sub(r'[^a-z0-9]+', '-', os.path.splitext(path.split('/')[-1])[0].lower()).strip('-')
        if path.startswith('res://gfx/player/bodyparts/internal/patterns/'):
            name = 'pattern-' + name
        key = (name, path)
        prev = self.done.get(name)
        assert prev is None or prev[0] == path, f'two textures named {name}: {prev[0]}, {path}'
        width = max(drawn_width, prev[1] if prev else 0)
        self.done[name] = (path, width)
        return f'art/body-parts/{name}.webp', key

    def write(self):
        os.makedirs(ART, exist_ok=True)
        for f in os.listdir(ART):
            os.remove(os.path.join(ART, f))
        total = 0
        scales = {}
        for name, (path, drawn) in sorted(self.done.items()):
            fmt, data, (w, h) = export(self.pack, path)
            target = math.ceil(drawn * MAX_DENSITY)
            scales[name] = min(1.0, target / w)
            if fmt != 'webp' or w > target:
                im = Image.open(io.BytesIO(data)).convert('RGBA')
                if w > target:
                    im = im.resize((target, max(1, round(h * target / w))), Image.LANCZOS)
                buf = io.BytesIO()
                im.save(buf, 'WEBP', quality=85, method=6)
                data = buf.getvalue()
            with open(os.path.join(ART, f'{name}.webp'), 'wb') as f:
                f.write(data)
            total += len(data)
        print(f'wrote {len(self.done)} textures ({total // 1024} KB) to {ART}')
        return scales


def rect_layer(src, m, x, y, w, h, extra=None):
    """An image drawn over the rect (x, y, w, h) in its node's frame, placed by m."""
    layer = {'src': src}
    if is_translation(m):
        layer.update(x=u(x + m[4]), y=u(y + m[5]), w=u(w), h=u(h))
    else:
        layer.update(x=u(x), y=u(y), w=u(w), h=u(h), m=[round(v, 4) for v in m[:4]] + [u(m[4]), u(m[5])])
    layer.update(extra or {})
    return layer


def line_layer(scene, i, textures, warn):
    n = scene.nodes[i]
    p = n['props']
    m, _ = scene.world(i)
    pts = p.get('points') or []
    if len(pts) < 2:
        return None
    if any(abs(q[1] - pts[0][1]) > 0.01 for q in pts):
        warn(f'{n["name"]}: line is not straight')
    width = p.get('width', 10.0)
    begin = p.get('begin_cap_mode', 0)
    end = p.get('end_cap_mode', 0)
    x0, x1, y = pts[0][0], pts[-1][0], pts[0][1]
    tex = texture_path(p.get('texture'))
    if not tex and str(p.get('script', '')).endswith('/hair.gd'):
        begin = end = 2  # hair.gd gives untextured hairs round caps
    if not tex:
        # An untextured line with a width curve: the plain Flagellum.
        sample = curve_sampler(p['width_curve']) if p.get('width_curve') else (lambda t: 1.0)
        steps = 24
        top, bottom = [], []
        for k in range(steps + 1):
            t = k / steps
            x = x0 + (x1 - x0) * t
            hw = width * sample(t) / 2
            top.append((x, y - hw))
            bottom.append((x, y + hw))

        def cap(x, hw, start, mode):
            """Points around an end, clockwise from angle `start` (round or box caps)."""
            if mode == 2:
                return [(x + hw * math.cos(start + a * math.pi / 8), y + hw * math.sin(start + a * math.pi / 8)) for a in range(1, 8)]
            if mode == 1:
                sx = math.cos(start + math.pi / 2)
                return [(x + sx * hw, y - hw if sx > 0 else y + hw), (x + sx * hw, y + hw if sx > 0 else y - hw)]
            return []

        outline = top + cap(x1, width * sample(1) / 2, -math.pi / 2, end) + bottom[::-1] + cap(x0, width * sample(0) / 2, math.pi / 2, begin)
        poly = [apply(m, *q) for q in outline]
        layer = {'points': [[u(a), u(b)] for a, b in poly], 'fill': 'parasite'}
        layer['chain'] = chain_info(m, pts, width, begin, end)
        # Width at each point, so the app can rebuild the outline when the line bends.
        layer['chain']['widths'] = [round(sample(k / (len(pts) - 1)), 3) for k in range(len(pts))]
        return layer
    tw, th = textures.size(tex)
    left = x0 - (width / 2 if begin else 0)
    right = x1 + (width / 2 if end else 0)
    src, _ = textures.publish(tex, max(right - left, width * tw / th))
    extra = {}
    if p.get('width_curve'):
        warn(f'{n["name"]}: textured line has a width curve (drawn at full width)')
    if p.get('texture_mode', 0) == 1:
        # LINE_TEXTURE_TILE: one copy of the texture every width * aspect pixels.
        extra['tile'] = u(width * tw / th)
    elif p.get('texture_mode', 0) != 2:
        warn(f'{n["name"]}: texture mode {p.get("texture_mode", 0)}')
    extra['chain'] = chain_info(m, pts, width, begin, end)
    return rect_layer(src, m, left, y - width / 2, right - left, width, extra)


def chain_info(m, pts, width, begin, end):
    """A straight Line2D's points, for bending it: origin, count, spacing, caps (0 none, 1 box, 2 round)."""
    ox, oy = apply(m, pts[0][0], pts[0][1])
    return {'x': u(ox), 'y': u(oy), 'n': len(pts), 'seg': u((pts[-1][0] - pts[0][0]) / (len(pts) - 1)), 'width': u(width), 'caps': [begin, end]}


def sprite_layer(scene, i, textures, warn):
    p = scene.nodes[i]['props']
    tex = texture_path(p.get('texture'))
    if not tex:
        return None
    m, _ = scene.world(i)
    tw, th = textures.size(tex)
    if p.get('hframes', 1) != 1 or p.get('vframes', 1) != 1 or p.get('region_enabled'):
        warn(f'{scene.nodes[i]["name"]}: sprite sheet')
    ox, oy = p.get('offset', (0, 0))
    x, y = (ox - tw / 2, oy - th / 2) if p.get('centered', True) else (ox, oy)
    if p.get('flip_h') or p.get('flip_v'):
        m = mul(m, mat(scale=(-1 if p.get('flip_h') else 1, -1 if p.get('flip_v') else 1)))
    drawn = tw * math.hypot(m[0], m[1])
    src, _ = textures.publish(tex, drawn)
    return rect_layer(src, m, x, y, tw, th)


def class_paths(pack):
    """class_name -> script path, for following `extends Gun` and the like."""
    out = {}
    for n in pack.names('scn/', '.gd'):
        m = re.search(rb'^(?:@tool\s+)?class_name\s+(\w+)', pack.raw(n), re.M)
        if m:
            out[m.group(1).decode()] = 'res://' + n
    return out


def script_chain(pack, path, classes):
    """A script and the scripts it extends, as file names (gun.gd, bodypart.gd...)."""
    chain = []
    while isinstance(path, str) and path.startswith('res://') and len(chain) < 12:
        chain.append(path.split('/')[-1])
        src = pack.raw(path.replace('res://', '')).decode('utf8', 'replace')
        m = re.search(r'^(?:class_name\s+\w+\s+)?extends\s+"?([\w./:]+)"?', src, re.M)
        path = None if not m else (m.group(1) if m.group(1).startswith('res://') else classes.get(m.group(1)))
    return chain


def pulse_of(scene):
    """The autoplayed animation that scales the Visual node, if any (the internal organelles' 'wiggle')."""
    for n in scene.nodes:
        if n['type'] != 'AnimationPlayer' or not n['props'].get('autoplay'):
            continue
        lib = n['props'].get('libraries/') or {}
        anim = scene.local.get((lib.get('_data') or {}).get(n['props']['autoplay']))
        if not anim:
            continue
        a = {k: scene.resolve(v) for k, v in anim['props'].items()}
        for t in range(8):
            if a.get(f'tracks/{t}/path') == 'Visual:scale':
                keys = a[f'tracks/{t}/keys']
                return {'dur': round(a.get('length', 1.0), 3), 'times': [round(x, 3) for x in keys['times']], 'scales': [round(v[0], 3) for v in keys['values']]}
    return None


# bodypart.gd: the connection colour when a scene doesn't set one.
UNSET_CONNECTION_COLOR = (3.5, 1.5, 0.8)


def tooltip_type_color(tags, ui_name):
    """Bodypart.get_tooltip_type_color."""
    has = set(tags)
    if 'MeleeWeapon' in has or 'ShootsBullets' in has or ('Weapon' in has and ui_name != 'o_conduit_name'):
        return (0.131, 0.287, 0.183)
    if 'Active' in has:
        return (0.345, 0.156, 0.386)
    if has & {'AttackModifier', 'BulletModifier'}:
        return (0.063, 0.271, 0.361)
    if 'EnergyGenerator' in has:
        return (0.432, 0.221, 0.0)
    if 'WeaponModifier' in has:
        return (0.063, 0.271, 0.361)
    return (0.115, 0.279, 0.275)


def connection_link(pack, scene_path, root):
    """The organelle's tags and its arrows' colour (Bodypart.get_connection_color)."""
    res = pack.resource(scene_path[:-len('.tscn')] + '.tres')['resources'][-1]['props']
    tags = [TAGS.get(t, t) for t in res.get('tags', [])]
    color = tuple(root.get('connection_color') or UNSET_CONNECTION_COLOR)[:3]
    if all(abs(a - b) < 1e-4 for a, b in zip(color, UNSET_CONNECTION_COLOR)):
        if 'EnergyGenerator' in tags:
            color = UNSET_CONNECTION_COLOR
        elif {'MeleeWeapon', 'ShootsBullets', 'Weapon'} & set(tags):
            color = (1.0, 3.0, 0.8)
        else:
            # The tooltip's type colour, scaled up to the unset colour's peak.
            base = tooltip_type_color(tags, res.get('ui_name'))
            color = tuple(c * max(UNSET_CONNECTION_COLOR) / max(base) for c in base)
    return {'color': [round(c, 4) for c in color], 'tags': sorted(t for t in tags if isinstance(t, str))}


def organelle_layers(pack, scene_path, textures, warn, classes):
    scene = Scene(pack, scene_path)
    root = scene.nodes[0]['props']
    layers, main = [], None
    for i, n in enumerate(scene.nodes):
        if i == 0 or n['type'] not in ('Line2D', 'Sprite2D'):
            continue
        _, visible = scene.world(i)
        if not visible or n['name'] == 'MaskedGlow':
            continue
        layer = line_layer(scene, i, textures, warn) if n['type'] == 'Line2D' else sprite_layer(scene, i, textures, warn)
        if not layer:
            continue
        if n['name'] == 'Masked':
            layer['masked'] = True  # the game shows this pattern only inside the body
        mod = n['props'].get('modulate') or n['props'].get('self_modulate')
        if mod and mod[3] < 0.99:
            layer['opacity'] = round(mod[3], 3)
        layers.append((scene.z(i), i, n['name'], layer))
    layers.sort(key=lambda t: (t[0], t[1]))
    # The node that rarity_textures (and the rarity outline) apply to: see
    # Bodypart.update_rarity_texture.
    for want in ('Sprite', 'Line2D', 'Hair2'):
        main = next((l for _, _, name, l in layers if name == want), None)
        if main:
            break
    if main is not None and main.get('src'):
        # The outline shaders' radius, in the game's texels (converted when textures are written).
        main['outline'] = 6 if '/internal/' in scene_path else 3
    out = {'layers': [l for *_, l in layers]}
    motion = organelle_motion(pack, scene, layers, classes, warn)
    if motion:
        out['motion'] = motion
    rarity = [texture_path(t) or t for t in root.get('rarity_textures') or []]
    if rarity and main is not None:
        out['rarity'] = {}
        for k, tex in enumerate(rarity[1:], start=1):
            out['rarity'][RARITIES[k]] = textures.publish(tex, main['w'] * SCALE)[0]
        main['main'] = True
    if not out['layers']:
        warn('nothing drawn')
    colors = root.get('parasite_colors')
    if colors:
        out['colors'] = [[round(c, 4) for c in col[:3]] for col in colors]
    out['link'] = connection_link(pack, scene_path, root)
    return out


def organelle_motion(pack, scene, layers, classes, warn):
    """How the organelle moves at rest in the game's organelle editor (see the module docstring)."""
    index = {}
    for k, (_, i, name, _) in enumerate(layers):
        index.setdefault(name, k)
    node = {n['name']: n for n in scene.nodes}
    chain = script_chain(pack, scene.nodes[0]['props'].get('script'), classes)
    num = lambda v: round(v, 4)  # noqa: E731
    tentacle = next((n for n in scene.nodes if str(n['props'].get('script', '')).endswith('/tentacle.gd')), None)
    if tentacle and tentacle['name'] in index:
        t = {**TENTACLE, **{k: v for k, v in tentacle['props'].items() if k in TENTACLE}}
        return {'kind': 'tentacle', 'layer': index[tentacle['name']], 'n': int(t['num_segments']), 'seg': u(t['segment_length']),
                'fluidity': num(t['fluidity']), 'straighten': num(t['straighten_force']), 'spring': num(t['spring_stiffness']),
                'wobble': num(math.radians(t['wobble_amount'])), 'speed': num(t['wobble_speed']), 'stretch': [num(t['min_stretch']), num(t['max_stretch'])]}
    if 'lash.gd' in chain and 'Hair' in index and 'Hair2' in index:
        h = {**HAIR, **{k: v for k, v in node['Hair2']['props'].items() if k in HAIR}}
        ox, oy = node['Hair2']['props'].get('position', (0, 0))
        return {'kind': 'lash', 'hair': index['Hair'], 'body': index['Hair2'], 'origin': [u(ox), u(oy)], 'n': int(h['num_segments']),
                'seg': u(h['segment_length']), 'stiffness': num(h['stiffness']), 'fluidity': num(h['fluidity']), 'sway': num(h['sway_angle'])}
    if 'gun.gd' in chain and 'Line2D' in index:
        g = {**GUN, **{k: v for k, v in scene.nodes[0]['props'].items() if k in GUN}}
        points = layers[index['Line2D']][3]['chain']['n']
        if points != g['num_segments']:
            warn(f'line has {points} points, gun.gd moves {g["num_segments"]}')
        return {'kind': 'gun', 'layer': index['Line2D'], 'n': min(points, int(g['num_segments'])), 'seg': u(g['segment_length']),
                'stiffness': num(g['stiffness']), 'amp': 0.2}
    if 'chemoreceptor_antenna.gd' in chain and 'Line2D' in index:
        return {'kind': 'gun', 'layer': index['Line2D'], 'n': ANTENNA['num_segments'], 'seg': u(ANTENNA['segment_length']),
                'stiffness': ANTENNA['stiffness'], 'amp': ANTENNA['amp']}
    pulse = pulse_of(scene)
    if pulse:
        # Only what's under the Visual node pulses: the sprite, not the masked pattern.
        visual = next((i for i, n in enumerate(scene.nodes) if n['name'] == 'Visual' and n['parent'] == 0), None)
        def under_visual(i):
            while i > 0:
                if i == visual:
                    return True
                i = scene.nodes[i]['parent']
            return False
        moving = [k for k, (_, i, _, _) in enumerate(layers) if under_visual(i)]
        if moving:
            return {'kind': 'pulse', 'layers': moving, **pulse}
    return None


def slot_sprites(pack, textures):
    """Each slot type's sprites, internal and external. A plain slot is an olive disc
    inside and a salmon teardrop outside; Volatile, Conductive and Omni slots have
    their own."""
    out = {}
    for name, path in SLOT_SCENES.items():
        scene = Scene(pack, path)
        out[name] = {}
        for i, n in enumerate(scene.nodes):
            kind = {'CircleInternal': 'internal', 'CircleExternal': 'external'}.get(n['name'])
            if not kind:
                continue
            layer = sprite_layer(scene, i, textures, print)
            mod = n['props'].get('modulate')
            if mod:
                layer['opacity'] = round(mod[3], 3)
            out[name][kind] = layer
    return out


def organelles():
    src = open(os.path.join(REPO, 'src', 'data', 'organelles.ts')).read()
    return re.findall(r'id: "([^"]+)".*?slot: \'(\w+)\'.*?gameId: \'(\w+)\'', src)


def main(pck_path):
    pack = Pack(pck_path)
    textures = Textures(pack)
    out = {'slots': slot_sprites(pack, textures), 'organelles': {}}
    classes = class_paths(pack)
    for oid, slot, gid in organelles():
        path = f'res://scn/player/bodyparts/{slot}/{gid}.tscn'
        warn = lambda msg, oid=oid: print(f'  {oid}: {msg}')  # noqa: E731
        if path.replace('res://', '') + '.remap' not in pack.index and path.replace('res://', '') not in pack.index:
            warn(f'no scene at {path}')
            continue
        out['organelles'][oid] = organelle_layers(pack, path, textures, warn, classes)
    scales = textures.write()
    for o in out['organelles'].values():
        for layer in o['layers']:
            if 'outline' in layer:
                name = layer['src'].split('/')[-1].rsplit('.', 1)[0]
                layer['outline'] = round(layer['outline'] * scales[name], 2)
    with open(os.path.join(REPO, 'src', 'data', 'organelle_art.json'), 'w') as f:
        json.dump(out, f, indent=1)
    print(f'wrote {len(out["organelles"])} organelles to src/data/organelle_art.json')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
