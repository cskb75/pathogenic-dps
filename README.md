# pathogenic-dps

A build planner and DPS calculator for [Pathogenic](https://store.steampowered.com/app/3808690/Pathogenic/). Build a pathogen the way you would in game, and see what every organelle contributes, how attacks travel through your organelle chains, and where each number comes from.

Only the **Nanobot** is supported so far.

## Where the numbers come from

- **Organelle behaviour** is ported from the game's own scripts in the free demo build (itch.io, January 2026). This covers damage formulas, rarity scaling, attack speed, Overcharge, chaining, stamina and burn.
- **Official patch notes** (Steam, up to the August 7, 2026 balance patch) override demo values wherever they give an exact new number. Each organelle's notes in the app say when that happened, or where a demo value is known to be out of date.
- **The organelle list** (all 120, with slot, category and in-game description) comes from the pathogenic.wiki database. Infuser types come from the wiki.gg Organelles page.
- **Mutations and plasmids.** The lists and descriptions come from the pathogenic.wiki mutation and plasmid databases. Damage formulas are ported from the demo's mutation scripts where the mutation exists there. Otherwise they come from the current in-game description. Each mutation says which in the app.
- **The Nanobot itself isn't in the demo.** Its body layout comes from player descriptions: square and triangle modules, each with an internal slot in the centre and external slots on free edges. Its plasmids come from the wiki. The plasmid tree's layout isn't known yet, so you pick plasmids from a list. Traits aren't in the demo either. Per the wiki, they're treated as "+N stat boost", which means N extra rarity steps.
- **Slot grafts cover slot upgrades.** Mark a slot as Volatile, Conductive or Omni in the editor for anything that converts slots, such as Volatile Assembly or the receptor mutations.

Organelles the calculator can't model yet (actives, minions, most positional effects) can still be placed. The app labels them and leaves them out of the total.

## How damage is calculated

It follows the game's attack flow:

1. **A weapon creates an attack.**
   - Base damage times rarity, usually `1 + 0.4 × rarity`.
   - Fires every `interval × (1 − 0.1 × rarity)` seconds.
2. **Every organelle connected to the weapon modifies it.**
   - Most bonuses add a share of *base* damage, so they all stack additively. That covers Oxysome, Volatile slots, and damage mutations and plasmids.
   - Splitters (Bifurcator, Triosome) act last, because in game they wait a frame.
3. **Chainable organelles pass the attack on** to *their* connections, and nothing is visited twice.
   - Some pass a derived attack instead: Pyrosome passes the burn, so an Oxysome connected to a Pyrosome boosts the burn.
   - A Vesicle passes everything on, and from Rare up it has a chance to trigger each modifier twice.
4. **On-hit effects spawn more attacks.**
   - Burn pools on the enemy and halves every second, so each application deals about 2× its amount.
   - Splash, shrapnel and arcs only reach *other* enemies, so they count toward multi-target DPS.
5. **Overcharge.**
   - Each mitochondrion gives Overcharge while its trigger is active. Its uptime is estimated from your fight assumptions, or you can set it.
   - The calculator evaluates every on/off combination of your mitochondria and averages them by uptime.
   - Conductive slots and other Overcharge strength bonuses add together (August 2026 patch).
6. **Stamina.**
   - Every weapon attack costs stamina, and stamina does not regenerate while you keep firing.
   - When it runs out you wait about 1.5 s to refill. Sustained DPS includes these pauses.

**This run** holds what changes during a run:
- the mutations you've picked (DNA upgrades), with a counter for picking one more than once
- your plasmids (plasmids that start you with a mutation count as a stack of it)
- how many cores you hold (Argentic Coating)
- your current HP (Adrenaline)
- how many bosses you've beaten (Virulent Adaptation)

Run effects follow the demo's mutation scripts:
- Chirality uses each weapon's side of the body. The top of the editor is the front.
- Respiratory Burst counts mitochondria in each Overcharge state.
- Starvation Reflex assumes half your stamina is missing on average while firing.

Things that depend on how you play are **fight assumptions** in the settings panel:
- how often angled shots or backstabs land
- how far away the target is
- how often you kill, get hit or pick things up
- the level (explosions scale with it)

## Updating the numbers

Organelle behaviour lives in `src/engine/sim/behaviours.ts`, one entry per organelle, written to mirror its game script (e.g. `0.25 + 0.15 * r` for Oxysome's damage bonus). When new game files or tooltips show different numbers, change the formula there. The test suite (`src/engine/calc.test.ts`) checks the calculator against hand-worked examples of the game's formulas.

`src/data/organelles.ts` is the organelle catalogue, `src/data/mutations.ts` the mutations, and `src/data/nanobot.ts` the Nanobot's modules and plasmids. `src/data/index.ts` holds rarities, traits, grafts and the fight assumptions. Mutation and plasmid effects are described as data (`RunEffects` in `src/engine/types.ts`). `src/engine/run.ts` turns them into bonuses.

`tools/extract` has the scripts that read the game's files (`.pck`) to check numbers against them; see its README. Never commit their output.

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
