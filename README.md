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
- **Mirrored slots.** In a bilateral body, an organelle in a side slot is copied to the matching slot on the other side. Either side can be edited, dragged from or dropped on; each keeps its own slot type.
- **Evolutions** go step by step, as in a run: the picker opens at levels 2, 6 and 10 (`editor.gd`). Each level you settle, including a Skip, shrinks to one line you can reopen, and the next shows what the game can offer there. The evolution you have lists guaranteed next evolutions, which the game always shows first (marked "Always offered"), even from another tier. The rest of its 3 cards are drawn at random from that level's pool, plus Skip. Organelles keep their slot when you evolve, as long as the new body has a slot with the same name. An evolution's damage, HP and stamina bonuses stay with you after you evolve again.
- **Built-in special slots** act like grafts.
- **"Left half" and "bottom half".** Effects such as Chirality or Dorsal Dominance are measured from the body's centre, as the game does.
- **Nanobot modules** are 102.4 game pixels a side. An edge slot connects to its own module's centre and to each neighbouring module's centre, unless it faces away from it; the body's centre is the average of the module centres.
- **Amoeba blobs** follow the game's placement rules: a blob off the middle line is mirrored, and a new slot connects to up to 3 nearby slots (externals only to internals, never across the middle or across another connection; slots with 3 connections are skipped unless closest). A build stores the placements and replays them. The body is drawn the way the game bakes it (`blob_composer.gd`): each blob is a soft gradient, and the body is wherever they add up past a threshold. So a lone blob fills about a third of its radius, and grown blobs merge into lobes.
- **Plasmid trees** are laid out as in the game. You own a connected group of nodes starting from the root.
- **Physics ticks.** Weapons check their cooldown 60 times a second, so a 0.105s cooldown really fires every 7 ticks (0.117s).

## Where the numbers come from

- **Organelle behaviour** is ported from the full game's scripts and scenes (`scn/player/bodyparts`). This covers damage formulas, rarity scaling, attack speed, Overcharge, chaining, stamina, burn, actives, pseudopods and minions.
- **Traits** add rarity steps (Cancerous 1, Eternal 2, Ephemeral 3, Excitable 3); Excitable organelles only work at 0.9 Overcharge or more.
- **Mutations** are ported from `scn/player/mutations/all`, **plasmids** from each pathogen's plasmid map (`tools/extract/plasmids.py`).
- **A game bug:** Sinistral Metabolism and Dextral Conduction do each other's jobs in the game's code (Sinistral Metabolism strengthens mitochondria on the right; Dextral Conduction speeds up actives on the left). The calculator follows the code and says so on each node.
- **Art.** Organelle and mutation icons come from pathogenic.wiki. Body sprites, plasmid icons, the Nanobot/Amoeba textures and the UI art (menu frames, organelle type frames and icons, the plasmid menu) come from the game files. It's all the game creators' art.
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
   - Lightning bolts split as they fly (13% chance every 200 px, more with Galvanic Arborization), and Elastosome bullets bounce. Like shrapnel, each split arc or bounce is assumed to find another enemy half the time, so they only add multi-target DPS.
   - Golgi Apparatus: its connected melee weapons stop attacking on their own. Each other attack that reaches it makes one of them strike where it lands, as often as the melee weapon's cooldown allows.
5. **Overcharge.**
   - Each mitochondrion gives Overcharge while its trigger is active. Its uptime is estimated from your fight assumptions, or you can set it.
   - The calculator evaluates every on/off combination of your mitochondria and averages them by uptime.
   - Conductive slots and other Overcharge strength bonuses add together.
   - Actives fill up from their Overcharge; Metabolic Refinement and Autonomic Discharge make them charge faster, and Basal Metabolism gives them 0.3 Overcharge of their own.
6. **Stamina.**
   - Every weapon attack costs stamina, and stamina does not regenerate while you keep firing.
   - When it runs out you wait about 1.5 s to refill. Sustained DPS includes these pauses.
   - Only attacks you fire yourself (weapons and held beams) stop. Minions, passive attacks such as pseudopods, and actives keep going, as in the game: `gun.gd` checks stamina only when you press attack.
   - The same weapons can't fire while you sprint (hold dodge), if you set a sprinting time.
7. **Attacks that depend on where things are** use a fight assumption each:
   - Projectile Surge and Conal Burst fire every connected weapon 30 or 10 times per use (more with rarity), through the weapon's infusers and then their own. "Surge shots on target" and "Cone shots on target" set how many can reach your target; homing shots always can. A ring or cone reaches the other enemies as often as your target.
   - Galvanic Node beacons arc to you and to each other 5 times a second; "Beacon arcs through target" sets how many arcs cross it.
   - Pyroflagellum and Toxic Flagellum puddles use "Puddle contact". The Cryoflagellum's blast uses "Enemies next to you", and the Ballistic Flagellum "Backward shots on target" and "Time sprinting". All use "Dodges per second".
   - Resilinoplast sends shots your melee weapons cut back at the shooter ("Shots slashed per second").

Left out on purpose, because they depend on the situation too much to guess:
- Freezes deal no damage themselves. Cryolysis (+50% on frozen enemies) counts only if you set "Target frozen".
- Nidal Degranulation counts only if you set "Hits taken per minion".
- Pyrogenesis adds nothing: every burn is already counted in full, as if the enemy lives until it burns out.
- Toxisome puddles, Galvanic Weave arcs between your attacks, and Sympathetic Detonator explosions depend on where your attacks and enemies are.

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

Things that depend on how you play are **fight assumptions**:
- how often angled shots or backstabs land
- how far away the target is
- how often you kill, get hit, dodge, sprint or pick things up
- how many surge, cone, beacon, puddle and backward shots reach the target
- how long the target stays frozen
- the level (explosions scale with it)
- how long minions spend fighting, how long spawned ones survive and how often they get hit

### Simple and Detailed mode

The switch at the top of the results picks how fight assumptions are set. The mode is saved with the build, so a share link opens in the same mode.

- **Simple** (the default for new builds) has nothing to fill in. DPS shows as a range between two fixed sets of assumptions (`src/engine/simple.ts`). Both assume you play perfectly: every aimed shot lands and stamina never runs out.
  - **Worst case:** nothing situational helps. Every mitochondrion is off, so there's no Overcharge. Kills, hits, dodges, blocks, slashes and pickups trigger nothing, and targets are never frozen. Shots that go sideways, backwards, all around you or at random hit as often as the Detailed defaults say.
  - **Best case:** everything maxed. Every mitochondrion is always on, and every other assumption sits at the top of its range, even past what the game quite allows. That means 3 dodges a second despite the 1.2s cooldown, and every sideways, all-around and arcing shot through one target. Treat it as a ceiling to compare builds by, not a number to expect.
- **Detailed** uses your own values in the Fight assumptions panel. Switching to Simple keeps them saved.

Run state (HP, cores, level, bosses, kills, recycled and eaten organelles) is yours in both modes. Builds from before there were modes open in Detailed.

**What each organelle would do.** With a slot selected, the organelle list shows how much each organelle that fits would change single-target DPS there, as the worst- to best-case change in Simple mode. It uses the rarity of the organelle already in the slot, or Common. Tick "Most DPS first" to sort by it. The numbers fill in a few at a time, since each is a full calculation.

## Seeded runs

Every run has an 8-character seed, shown in the game's pause menu ("ABCD 3467"). The seed decides almost every random choice in the run. The **Seeded run** panel asks for it when you start a run. It then shows what the seed offers at each step and asks what you took, because that changes what comes next. The run is saved in your browser, apart from the build.

What the panel works out, the way the game's code does (`src/engine/seeded`):

- **Level-up cards** (`editor.gd`): each level's four cards and their order, from `hash(seed + "mut" + level)`.
  - **Rerolls** count across the run and never show the cards they replace.
  - Cards for "Gain a random weapon" and the like name the organelle they give, which also comes from the seed.
  - If the game shows something else (your body in the app differs from the game's), "Not what the game shows?" lists the next ones in line.
- **Evolutions** at levels 2, 6 and 10 aren't seeded: the game shuffles them with its unseeded random generator. The panel lists the ones that can show up, guaranteed ones first, and asks which you took.
- **Each floor's rewards** come from one stream of numbers, `hash(seed + "rewards" + floor)`. Rooms take numbers in the order the floor is built: one for every normal room, then the boss, the shop and the two item rooms, then any special and secret room. So the panel shows:
  - the boss's three organelles, and whether a perfect fight opens a devil room;
  - the shop's three organelles (an internal one, a weapon, then anything) with prices and sales. Prices grow with the floor and drop with Osmotic Bargaining. Rerolls are 4, 8, 12... cores and never bring back what was there;
  - each item room's three organelles, of which a room shows the first one, two or all three;
  - the special room you found (Challenge, DNA or Blacksmith), the secret room's two choices, and the Brain's sixteen legendary room drops;
  - the Heart's shop, which comes after its six rows of rooms.
- **Rarity and prefixes** are rolled from each reward's own number: prefixes at 3% each, then upgrades from Adaptive Pressure plasmids and Better Drops. Everything on the Brain is legendary.
- **Weights follow your build.** Organelles you already have are 25% more likely. Some mutations need something first: Overcharge ones need an active organelle, Cryolysis a freezing one, and so on. Fungal Spores never get the slot conversions. Some organelles must be unlocked, as must prefixes and devil rooms. That's in your save, which the seed can't see, so tick what you've unlocked.
- **The shop is stocked when its floor is made**, so it follows your build as it was then. Press "I'm on the …" when you reach a floor. Boss and item room rewards are rolled when they appear, so they follow your build as it is now.

Taking an organelle puts it in your hand in the body editor, to drop on a slot. Mutations, evolutions, the floor and bosses beaten update the build directly.

Not covered: challenges that change drop rates, the Heart's map rewards, the Heart boss's position in the stream, and drops from normal rooms other than the Brain's. The panel can't know which room a drop came from. If the boss, shop and item rooms are all off, the floor probably had a room more or fewer than usual; the + and − buttons shift everything after the normal rooms.

## Updating the numbers

Organelle behaviour lives in `src/engine/sim/behaviours.ts`, one entry per organelle, written to mirror its game script (e.g. `0.25 + 0.15 * r` for Oxysome's damage bonus). When new game files or tooltips show different numbers, change the formula there. The test suite (`src/engine/calc.test.ts`) checks the calculator against hand-worked examples of the game's formulas.

`src/data/organelles.ts` is the organelle catalogue (with each organelle's name in the game files), `src/data/mutations.ts` the mutations, `src/data/nanobot.ts` and `src/data/amoeba.ts` the two free-form bodies. `src/data/index.ts` holds rarities, traits, grafts and the fight assumptions. Mutation and plasmid effects are described as data (`RunEffects` in `src/engine/types.ts`). `src/engine/run.ts` turns them into bonuses.

`src/data/bodies.json` (the body plans) and the sprites in `public/art/bodies` are generated by `tools/extract/bodies.py` and `app_data.py`; `src/data/plasmids.json` and `public/art/plasmids` by `tools/extract/plasmids.py`; `src/data/specimens.json` and `public/art/specimens` (the pathogen carousel's hairs) by `tools/extract/specimens.py`; `src/data/seeded.json` (reward pools, weights and the rooms that hand out rewards, for seeded runs) by `tools/extract/seeded.py`. The organelle and mutation icons come from `tools/extract/wiki_icons.py`, the UI art in `public/art/ui` from `tools/extract/ui_art.py`. `tools/extract` also has the scripts that read the game's files (`.pck`) to check numbers against them; see its README. Never commit decompiled scripts.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # engine, data and state tests
npm run build      # typecheck + production build into dist/
```

The code is split into three parts:

- `src/engine`: framework-free geometry, slot graph and DPS engine, with organelle behaviour in `src/engine/sim` and seeded runs in `src/engine/seeded` (the Godot engine's hash and random number generator, ported bit for bit)
- `src/state`: build editing and save/share, and the seeded run log
- `src/ui`: React components

### Look and feel

The app is styled after the game's own menus, so it reads as Pathogenic rather than a generic web app. `src/ui/tokens.css` holds the design tokens, each traced to where it comes from in the game files:

- **Palette:** the pause menu's navy frames and thin light frame lines, with the plasmid menu's glows (cyan for what you can take next, orange for what you own).
- **Colours:** rarity colours and organelle type colours come from `bodypart.gd`.
- **Fonts:** Exo 2 for text, Teko for titles, VT323 for readouts.

The art the styles use is in `public/art/ui`, copied from the game by `tools/extract/ui_art.py`:

- the 9-patch menu frames, used for panels and buttons
- the tooltip frame and icon for each organelle type
- the plasmid menu's node frames, DNA-strand links and backdrop
- the character select's glass tubes, arrows and lab backdrop, for the pathogen carousel

**The pathogen carousel** at the top is the game's character select flattened into a row (`src/ui/ClassPicker.tsx`). Each pathogen floats in one of the game's specimen tubes, lit from below in its tube's colour, bobbing slowly as in `tube.gd`. As in the game, the tube shows the starting body without slots, with the hairs its scene attaches: the Bacterium's eyes, cilia and tails, the Fungal Spore's and Lil Collector's bristles, the Helminth's feelers. They sway the way `hair.gd` moves them (`src/ui/Specimen.tsx`). The chosen pathogen stands in the middle and the rest wrap around it. Arrows, ←/→, a swipe or a click on another tube switches. The tubes are shorter than the game's: the glass keeps its rims and its straight middle shrinks. Pathogens are drawn up to 1.4× the game's size where the tube has room.

The body editor draws organelles the way the game does, from `src/data/organelle_art.json` and `public/art/body-parts` (written by `tools/extract/organelle_art.py`):

- **Bodies** are dark, as the game's organelle editor shows them: the body's material is lit under the world's darkening, so it shows at about 0.115 of its texture's brightness in linear light, nearly black inside a dim rim. Measured from in-game screenshots of the Amoeba and the Bacterium, which agree. Organelles, and the patterns internal ones spread through the body, aren't darkened.
- **External organelles** stick straight out of their slot, along the slot's facing. Each is the texture its scene draws at rest, at the game's size, with its round end on the slot. Flagella are a connector plus a body; the plain Flagellum is a tapered line in your pathogen's colour, brighter with rarity.
- **Internal organelles** show their sprite on the slot and tint the body around it with their pattern.
- **Rarity:** above Common, an outline in the rarity's colour, drawn like the game's outline shader. Only the node the game outlines gets one: the sprite, weapon line or flagellum body, but not pseudopods. The outline is baked once per texture, so it costs nothing per frame.
- **Empty slots** are the game's slot sprites: a disc inside the body, a teardrop pointing out for external slots.
- **Framing:** the view zooms out to fit every organelle, like the game's camera. Slot rings keep a readable size on screen.

- **Connections** are the game's editor connections: curves that leave external slots heading into the body. Each is a pinched gold line with a bright band sliding along it, bright where the organelles at both ends work together (`Bodypart.can_connect_to`, from each organelle's tags).
- **Arrows** show only for the organelle you point at, hold or have selected, like the game's editor (`update_arrow_lines` in `editor.gd`, ported in `src/ui/links.ts`): what reaches it along chains (fainter past the first step) and what it reaches directly, turned to point at weapons. Each arrow is in the colour of the organelle it comes from (`get_connection_color`, an HDR colour: a bright core and a glow of its hue).

**Editing works like the game's organelle editor** (`editor.gd`, with the logic in `src/state/held.ts`):

- **Drag** an organelle from the list onto a slot, or from one slot to another. On a touch screen, or with a click, pick it up and then tap or click a slot.
- While you hold one, it follows the pointer and snaps to the nearest slot it fits, previewed there (and on the mirrored twin). Slots it doesn't fit dim, and the label by the pointer says what letting go will do. The view stays still until you let go.
- **Swap:** dropping on another organelle swaps them. The other one goes where yours came from if it fits there; otherwise it's now in your hand, as in the game.
- **Remove** by dropping on the Remove zone. Letting go anywhere else, or pressing Esc, puts it back.
- Clicking a slot still selects it, to set its organelle's rarity and traits or graft the slot.

**Animation** follows what the game's organelle editor shows at rest, ported from the scripts that do it (`src/ui/motion.ts`, with each organelle's values extracted into `organelle_art.json`):

- **Weapons** sway their aim about ±11° on a 5–9 s cycle, bending along their length (`gun.gd`). The Chemoreceptor Antenna does the same.
- **Pseudopods** wobble at the base, and a wave runs down the tentacle (`tentacle.gd`).
- **Flagella** flutter about ±14°, with the body trailing behind (`lash.gd`, `hair.gd`).
- **Internal organelles** pulse to 110% twice a second (each scene's autoplayed "wiggle").

The Animate switch turns it off, in the body view and the pathogen carousel (remembered in the browser), and it stays off when the system asks for reduced motion. The game's lighting is left out apart from the bodies' darkness, and so is animation in combat (aiming, recoil). Everywhere else (the picker, the slot panel, the results) organelles keep their wiki icons.

Components pick an organelle's type (weapon, active, modifier, energy or lash) with `CATEGORY_TYPE` in `src/ui/format.ts`. The theme is dark only, like the game.

## Deploying

`.github/workflows/deploy.yml` runs the tests on every pull request. On every push to `main` it also deploys to GitHub Pages.

---

Fan-made tool, not affiliated with Aberrant Labs or Slug Disco.
