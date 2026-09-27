# Game data extraction

Scripts for reading Pathogenic's Godot 4 export (`.pck`) so organelle numbers can be checked against the game files. **Their output (decompiled game code, extracted data) must never be committed**: keep it outside the repo.

```sh
pip install zstandard
python3 tools/extract/extract.py path/to/pathogenic.pck /tmp/pathogenic-out
```

| Script | What it does |
| --- | --- |
| `pck.py` | Lists and extracts files from a `.pck` (Godot 4, unencrypted). |
| `gdres.py` | Reads binary resources and scenes (`.res`, `.scn`), including a scene's node properties. |
| `gdc.py` | Turns compiled GDScript (`.gdc`, binary tokens v100/101) back into readable source. |
| `gdtr.py` | Reads the game's translation file (hashed keys, smaz-compressed text). Downloads the smaz codebook from PyPI on first use. |
| `extract.py` | Runs all of the above and writes decompiled scripts plus JSON tables of organelles, weapons, mutations, plasmid maps and English strings. |

The calculator's numbers are then ported by hand into `src/engine/sim/behaviours.ts`: each organelle's script is the reference for its entry.

Things to look at in the output:

- `src/scn/player/bodyparts/bodypart.gd`: connections, Overcharge (`charge`), chaining (`_extend_chain`).
- `src/scn/player/bodyparts/{external,internal}/*.gd`: each organelle's formulas (`get_damage_mult`, `modify_attack`, ...).
- `src/scn/player/bodyparts/external/gun.gd`: weapon damage/attack speed and how modifiers are applied.
- `weapons.json`: projectile base damage per weapon (`base_damage`), speed, lifetime, pierces.
- `plasmid_maps.json`: each pathogen's plasmid tree (nodes, their values and links).
