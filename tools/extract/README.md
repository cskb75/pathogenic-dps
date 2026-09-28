# Game data extraction

Scripts for reading Pathogenic's Godot 4 export (`.pck`) so organelle numbers can be checked against the game files. They handle the demo (compiled `.gdc` scripts) and the full release (plain `.gd` scripts, pck format 4). **Decompiled scripts and the raw JSON dumps must never be committed**: keep that output outside the repo. Only `app_data.py`, `plasmids.py` and `wiki_icons.py` write into the repo, and only app data: body plan geometry, plasmid trees and art.

```sh
pip install zstandard pillow
python3 tools/extract/extract.py path/to/pathogenic.pck /tmp/pathogenic-out
```

| Script | What it does |
| --- | --- |
| `pck.py` | Lists and extracts files from a `.pck` (Godot 4, unencrypted). |
| `gdres.py` | Reads binary resources and scenes (`.res`, `.scn`), including a scene's node properties. |
| `gdc.py` | Turns compiled GDScript (`.gdc`, binary tokens v100/101) back into readable source. |
| `gdtr.py` | Reads the game's translation file (hashed keys, smaz-compressed text). Downloads the smaz codebook from PyPI on first use. |
| `ctex.py` | Unwraps compressed textures (`.ctex`) into the PNG or WebP stored inside. |
| `extract.py` | Runs all of the above and writes decompiled scripts plus JSON tables of organelles, weapons, mutations, plasmid maps and English strings. |
| `bodies.py` | Extracts each pathogen's body plans: starting body and evolutions (slots, connections, mirroring, special slots, outline, centre bone) and their sprites. |
| `app_data.py` | Turns `bodies.py`'s output into `src/data/bodies.json` and `public/art/bodies`. |
| `plasmids.py` | Writes every pathogen's plasmid tree (positions, links, text, icons, damage effects) to `src/data/plasmids.json` and `public/art/plasmids`. |
| `wiki_icons.py` | Downloads organelle, mutation and plasmid icons from pathogenic.wiki into `public/art`. |

To refresh the body plans and plasmid trees after a game update:

```sh
python3 tools/extract/bodies.py path/to/pathogenic.pck /tmp/pathogenic-bodies
python3 tools/extract/app_data.py /tmp/pathogenic-bodies
python3 tools/extract/plasmids.py path/to/pathogenic.pck
```

The Nanobot and the Amoeba have no fixed body plans: their rules live in `src/engine/body.ts` and `src/engine/amoeba.ts`.

The calculator's numbers are then ported by hand into `src/engine/sim/behaviours.ts`: each organelle's script is the reference for its entry.

Things to look at in the output:

- `src/scn/player/bodyparts/bodypart.gd`: connections, Overcharge (`charge`), chaining (`_extend_chain`).
- `src/scn/player/bodyparts/{external,internal}/*.gd`: each organelle's formulas (`get_damage_mult`, `modify_attack`, ...).
- `src/scn/player/bodyparts/external/gun.gd`: weapon damage/attack speed and how modifiers are applied.
- `weapons.json`: projectile base damage per weapon (`base_damage`), speed, lifetime, pierces.
- `plasmid_maps.json`: each pathogen's plasmid tree (nodes, their values and links).
