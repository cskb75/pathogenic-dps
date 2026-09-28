# pathogenic-dps

A build planner and DPS calculator for [Pathogenic](https://store.steampowered.com/app/3808690/Pathogenic/). Build a pathogen the way you would in game, and see what every organelle contributes, how attacks travel through your organelle chains, and where each number comes from.

## Pathogens

| Pathogen | Body |
| --- | --- |
| Bacterium | Fixed layout, 20 evolutions in 3 tiers, mirrored side slots |
| Helminth | Fixed layout, 17 evolutions in 3 tiers, mirrored side slots |
| Fungal Spore | Fixed layout, 18 evolutions in 3 tiers, built-in Omni/Volatile/Conductive slots |
| Diatom | Fixed layout, 9 evolutions in 3 tiers |
| Lil Collector | Fixed layout, 9 evolutions in 3 tiers |
| Nanobot | Square and triangle modules you attach yourself |
| Amoeba | Blobs you grow where you like, each with a new slot |

All body plans, evolutions, plasmid trees and numbers come from the full game's files (September 2026 build). The game also has an unfinished Protozoan (no evolutions, placeholder plasmid tree), which isn't included.

Things that work the way the game does:
- **Mirrored slots.** In a bilateral body, an organelle in a side slot is copied to the matching slot on the other side.
- **Evolutions.** Organelles keep their slot when you evolve, as long as the new body has a slot with the same name. An evolution's damage, HP and stamina bonuses stay with you after you evolve again.
- **Built-in special slots** act like grafts.
- **"Left half" and "bottom half".** Effects such as Chirality or Dorsal Dominance are measured from the body's centre, as the game does.
- **Nanobot modules** are 102.4 game pixels a side. An edge slot connects to its own module's centre and to each neighbouring module's centre, unless it faces away from it; the body's centre is the average of the module centres.
- **Amoeba blobs** follow the game's placement rules: a blob off the middle line is mirrored, and a new slot connects to up to 3 nearby slots (externals only to internals, never across the middle or across another connection; slots with 3 connections are skipped unless closest). A build stores the placements and replays them.
- **Plasmid trees** are laid out as in the game. You own a connected group of nodes starting from the root.
- **Physics ticks.** Weapons check their cooldown 60 times a second, so a 0.105s cooldown really fires every 7 ticks (0.117s).

## Where the numbers come from

- **Organelle behaviour** is ported from the full game's scripts and scenes (`scn/player/bodyparts`). This covers damage formulas, rarity scaling, attack speed, Overcharge, chaining, stamina, burn, actives, pseudopods and minions.
- **Traits** add rarity steps (Cancerous 1, Eternal 2, Ephemeral 3, Excitable 3); Excitable organelles only work at 0.9 Overcharge or more.
- **Mutations** are ported from `scn/player/mutations/all`, **plasmids** from each pathogen's plasmid map (`tools/extract/plasmids.py`).
- **A game bug:** Sinistral Metabolism and Dextral Conduction do each other's jobs in the game's code (Sinistral Metabolism strengthens mitochondria on the right; Dextral Conduction speeds up actives on the left). The calculator follows the code and says so on each node.
- **Art.** Organelle and mutation icons come from pathogenic.wiki. Body sprites, plasmid icons and the Nanobot/Amoeba textures come from the game files. It's all the game creators' art.
- **Slot grafts cover slot upgrades.** Mark a slot as Volatile, Conductive or Omni in the editor for anything that converts slots, such as Volatile Assembly or the receptor mutations.

Actives count as firing whenever they have charged up from Overcharge (you use them as soon as they're ready). Organelles that never deal damage (healing, cores, armor) are labelled that way. A few can't be modeled without simulating positions, such as trails, orbiting arcs, corpse explosions and the ring and cone actives. They can still be placed; the app says why for each one and leaves it out of the total.

### Minions

Minions follow behaviour trees in the game (`scn/player/minions`). The calculator turns each one's attack pattern into a rate:

| Organelle | Minion | Attacks |
| --- | --- | --- |
| Apex Nidus | One heavy minion, back each room | Slash 50 (+20/rarity) every 1.5s, a charge every 5s, contact 15 (+5/rarity) |
| Mitotic Nidus | One gunner, back each room | Fires each connected weapon at 40% (+10%/rarity) speed, no stamina |
| Sentry Nidus | A sentry per 10 Overcharge-seconds | Shell 80 (+50/rarity) every second |
| Swarm Nidus | A shooter per 4 Overcharge-seconds | 9-shot volleys, 9 (+5/rarity) per shot |
| Nidublast | A minion per shot, lives 5s | Slash 20 x rarity every 0.15s |
| Bacteriophage Launcher | A phage per shot, lives 3s | Slash 8 (+1/rarity) x rarity every 0.15s |

Generalisations: each minion spends **Minion engagement** of the fight attacking (default 60%). Minions from actives last **Minion lifetime** seconds (default 20) or until the room ends, so on average min(lifetime, half a room). Minion attacks get the spawning organelle's infusers, mutations and its slot's graft, like the game. Symbiotic Pseudopod's buff (+200%, +50% per rarity) goes to one minion at a time, so it's spread over all your minions.

## How damage is calculated

It follows the game's attack flow:

1. **A weapon creates an attack.**
   - Base damage times rarity, usually `1 + 0.4 × rarity`.
   - Fires every `interval × (1 − 0.1 × rarity)` seconds, divided by attack speed bonuses, rounded up to whole physics ticks (1/60s).
2. **Every organelle connected to the weapon modifies it.**
   - Most bonuses add a share of *base* damage, so they all stack additively. That covers Oxysome, Volatile slots, and damage mutations and plasmids.
   - Splitters (Bifurcator, Triosome) act last, because in game they wait a frame.
3. **Chainable organelles pass the attack on** to *their* connections, and nothing is visited twice.
   - A Vesicle passes everything on, and from Rare up it has a chance to trigger each modifier twice.
4. **On-hit effects spawn more attacks.**
   - Burn pools on the enemy and halves every second, so each application deals about 2× its amount. Modifiers and mutations only touch the pool when it starts, so they're left out.
   - Peroxisome explosions land on the enemy that was hit too.
   - Splash, shrapnel and arcs only reach *other* enemies, so they count toward multi-target DPS.
5. **Overcharge.**
   - Each mitochondrion gives Overcharge while its trigger is active. Its uptime is estimated from your fight assumptions, or you can set it.
   - The calculator evaluates every on/off combination of your mitochondria and averages them by uptime.
   - Conductive slots and other Overcharge strength bonuses add together.
   - Actives fill up from their Overcharge; Metabolic Refinement and Autonomic Discharge make them charge faster, and Basal Metabolism gives them 0.3 Overcharge of their own.
6. **Stamina.**
   - Every weapon attack costs stamina, and stamina does not regenerate while you keep firing.
   - When it runs out you wait about 1.5 s to refill. Sustained DPS includes these pauses.

**This run** holds what changes during a run:
- the mutations you've picked (DNA upgrades), with a counter for picking one more than once
- your plasmids, picked on the pathogen's plasmid tree (plasmids that start you with a mutation count as a stack of it)
- how many cores you hold (Argentic Coating)
- your current HP (Adrenaline)
- how many bosses you've beaten (Virulent Adaptation)
- kills, recycled and eaten organelles for the organelles that grow with them

Run effects follow the game's mutation scripts:
- Chirality uses each weapon's side of the body. The top of the editor is the front.
- Respiratory Burst counts mitochondria in each Overcharge state.
- Starvation Reflex assumes half your stamina is missing on average while firing.

Things that depend on how you play are **fight assumptions** in the settings panel:
- how often angled shots or backstabs land
- how far away the target is
- how often you kill, get hit or pick things up
- the level (explosions scale with it)
- how long minions spend fighting and how long spawned ones survive

## Updating the numbers

Organelle behaviour lives in `src/engine/sim/behaviours.ts`, one entry per organelle, written to mirror its game script (e.g. `0.25 + 0.15 * r` for Oxysome's damage bonus). When new game files or tooltips show different numbers, change the formula there. The test suite (`src/engine/calc.test.ts`) checks the calculator against hand-worked examples of the game's formulas.

`src/data/organelles.ts` is the organelle catalogue (with each organelle's name in the game files), `src/data/mutations.ts` the mutations, `src/data/nanobot.ts` and `src/data/amoeba.ts` the two free-form bodies. `src/data/index.ts` holds rarities, traits, grafts and the fight assumptions. Mutation and plasmid effects are described as data (`RunEffects` in `src/engine/types.ts`). `src/engine/run.ts` turns them into bonuses.

`src/data/bodies.json` (the body plans) and the sprites in `public/art/bodies` are generated by `tools/extract/bodies.py` and `app_data.py`; `src/data/plasmids.json` and `public/art/plasmids` by `tools/extract/plasmids.py`. The organelle and mutation icons come from `tools/extract/wiki_icons.py`. `tools/extract` also has the scripts that read the game's files (`.pck`) to check numbers against them; see its README. Never commit decompiled scripts.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # engine, data and state tests
npm run build      # typecheck + production build into dist/
```

The code is split into three parts:

- `src/engine`: framework-free geometry, slot graph and DPS engine, with organelle behaviour in `src/engine/sim`
- `src/state`: build editing and save/share
- `src/ui`: React components

## Deploying

`.github/workflows/deploy.yml` runs the tests on every pull request. On every push to `main` it also deploys to GitHub Pages.

---

Fan-made tool, not affiliated with Aberrant Labs or Slug Disco.
