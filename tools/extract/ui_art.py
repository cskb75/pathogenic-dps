"""Copy the game's UI art (frames, category icons, plasmid tree art) into public/art/ui.

    python3 tools/extract/ui_art.py path/to/pathogenic.pck

The app's theme (src/ui/tokens.css) uses these files for its panel and button
frames, the category-coloured organelle cards and the plasmid tree, so the
calculator looks like the game's own menus. Textures are copied as stored in
the .pck (WebP); only the large backdrop is scaled down and re-encoded.
"""
import io
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from ctex import export  # noqa: E402
from extract import Pack  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# Published name -> source texture in the game.
FILES = {
    # Menu frames (9-patch: 25px corners). The pause menu uses these for its buttons.
    'frame': 'gfx/9patch_menuButtons.png',
    'frame-focus': 'gfx/9patch_menuButtons_focused.png',
    'frame-glow': 'gfx/9patch_menuButtons_focused2.png',
    'frame-rounded': 'gfx/9patch_menuButtons_rounded.png',
    'frame-rounded-focus': 'gfx/9patch_menuButtons_rounded_focused.png',
    # Organelle tooltips: one frame per organelle type (see scn/ui/tooltips/tooltip.gd).
    'card-weapons': 'gfx/ui/tooltip_weapons.png',
    'card-actives': 'gfx/ui/tooltip_actives.png',
    'card-modifiers': 'gfx/ui/tooltip_modifiers.png',
    'card-mitochondria': 'gfx/ui/tooltip_mitochondria.png',
    'card-lashes': 'gfx/ui/tooltip_modifiers_lashes.png',
    'card-dna': 'gfx/ui/tooltip_dna.png',
    # ...and the type icon shown on each tooltip.
    'type-weapons': 'gfx/ui/tooltip_weapons_icon.png',
    'type-melee': 'gfx/ui/tooltip_melee_icon.png',
    'type-actives': 'gfx/ui/tooltip_actives_icon.png',
    'type-actives-external': 'gfx/ui/tooltip_actives_external_icon.png',
    'type-modifiers': 'gfx/ui/tooltip_modifiers_icon.png',
    'type-mitochondria': 'gfx/ui/tooltip_mitochondria_icon.png',
    'type-mitochondria-external': 'gfx/ui/tooltip_mitochondria_external_icon.png',
    'type-lashes': 'gfx/ui/tooltip_lashes_icon.png',
    'type-support': 'gfx/ui/tooltip_support_icon.png',
    'type-support-external': 'gfx/ui/tooltip_support_external_icon.png',
    'type-dna': 'gfx/ui/tooltip_dna_icon.png',
    # Plasmid menu: node frames (scn/metaprogression/plasmids/plasmid_bg.gd), the
    # DNA strands between nodes (plasmid_connection.gd) and the menu's backdrop.
    'plasmid-locked': 'gfx/ui/plasmid_menu/skill_frame_locked.png',
    'plasmid-available': 'gfx/ui/plasmid_menu/skill_frame_unlocked.png',
    'plasmid-owned': 'gfx/ui/plasmid_menu/skill_frame_unlocked_orange.png',
    'dna-gray': 'gfx/ui/plasmid_menu/gray_dna_pattern.png',
    'dna-blue': 'gfx/ui/plasmid_menu/blue_dna_pattern.png',
    'dna-yellow': 'gfx/ui/plasmid_menu/yellow_dna_pattern.png',
    'plasmid-backdrop': 'gfx/ui/plasmid_menu/plasmids_menu_2_base.png',
}

# Files to scale down to this width: the backdrop is 1354px wide (660 KB as stored)
# and the type icons, shown at about 24px, are 175px wide.
MAX_WIDTH = {'plasmid-backdrop': 900, **{name: 70 for name in FILES if name.startswith('type-')}}


def main(pck_path):
    pack = Pack(pck_path)
    out_dir = os.path.join(REPO, 'public', 'art', 'ui')
    os.makedirs(out_dir, exist_ok=True)
    for name, src in FILES.items():
        fmt, data, (w, h) = export(pack, 'res://' + src)
        if name in MAX_WIDTH and w > MAX_WIDTH[name]:
            im = Image.open(io.BytesIO(data))
            w, h = MAX_WIDTH[name], round(h * MAX_WIDTH[name] / w)
            buf = io.BytesIO()
            im.resize((w, h), Image.LANCZOS).save(buf, 'WEBP', quality=80, method=6)
            fmt, data = 'webp', buf.getvalue()
        with open(os.path.join(out_dir, f'{name}.{fmt}'), 'wb') as f:
            f.write(data)
        print(f'{name}.{fmt}  {w}x{h}  {len(data) // 1024} KB')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
