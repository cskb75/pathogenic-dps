# pathogenic-dps

A build planner and DPS calculator for [Pathogenic](https://store.steampowered.com/app/3808690/Pathogenic/). Build a pathogen the way you would in game, and see what every organelle contributes, where each number comes from, and how the pieces interact.

Only the **Nanobot** is supported so far.

> **The item data is placeholder.** The mechanics are modelled for real, but every number in `src/data` is a guess until someone checks it against the in-game tooltips. The app shows a banner while any entry is still marked `placeholder: true`.

## What it does

- **Shape editor.** Attach square and triangle modules to the Nanobot's core. Each module has an internal slot in its centre and an external slot on every free edge. Placement decides the connections:
  - a module's centre connects to the external slots on its own edges
  - the centres of two modules that share an edge connect to each other
- **Equip organelles** with rarity (Common → Mythic), traits (Cancerous, Eternal, Excitable), and slot grafts (Volatile, Conductive, Omni).
- **Interactions:**
  - Infusers reach only organelles directly connected to them. Attack, projectile and weapon infusers each have their own targets.
  - Supports that boost infusers make those infusers' effects stronger.
  - Mitochondria Overcharge whatever they connect to.
  - Upgrades, parameters (such as Armor), and conditions (such as "target is burning") feed into all of the above.
- **DPS breakdown.** For every source you can see base stats, each modifier and where it came from, and the final numbers, both normally and while Overcharged. That makes it easy to check against the game.
- **Share links** encode the whole build in the URL. Your current build is also saved in the browser.

## How damage is calculated

Every stat is:

```
final = (base + flat bonuses) × (1 + sum of % bonuses) × product of × multipliers
```

This follows the in-game convention that **+** bonuses add together and **×** bonuses multiply.

- **Crits** are averaged: `damage × (1 + critChance × (critMultiplier − 1))`.
- **Damage over time (e.g. Burn):**
  - damage per second per stack = `(dpsFlat + dpsFromHit × hit damage) × potency`
  - average stacks = `min(maxStacks, applications per second × duration)`
  - For refresh-only statuses (`maxStacks: 1`), the stack count is the share of time the status is up.
- **Overcharge:**
  - Each mitochondrion has an uptime: the share of the fight its trigger is active, set per build.
  - An organelle connected to several mitochondria is Overcharged `1 − Π(1 − uptime)` of the time.
  - Its average charge count while Overcharged is the sum of `uptime × charges` over its mitochondria, divided by that combined uptime.
  - Its DPS is the uptime-weighted average of its normal and Overcharged DPS.
  - Overcharge Strength scales the size of the Overcharge effect.
- **Excitable organelles** (and ones like the Rotary Extruder) do nothing while not Overcharged.
- **Multi-target DPS:**
  - pierce hits `1 + pierce` enemies
  - forks add extra enemies
  - area attacks hit every enemy in range

## Adding or correcting game data

All game content lives in `src/data`, typed by `src/engine/types.ts`:

| File | Contents |
| --- | --- |
| `organelles.ts` | Every organelle: slot type, category, attack stats, effects on others, Overcharge line |
| `nanobot.ts` | Nanobot piece types and upgrades |
| `index.ts` | Rarities, traits, grafts, status effects, conditions, parameters, constants |
| `helpers.ts` | Shorthands: `pct('damage', 0.25)` is "+25% damage", `mul('damage', 1.5)` is "×1.5 damage", `flat('critChance', 0.1)` is "+10% crit chance" |

Any number can differ by rarity: write a list ordered Common, Rare, Epic, Legendary, Mythic, e.g. `damage: [10, 13, 17, 22, 30]`. A shorter list repeats its last value.

Here's an attack infuser that gives connected attacks +25% damage, and is 1.5× as strong while Overcharged:

```ts
{
  id: 'my-infuser',
  name: 'My Infuser',
  slot: 'internal',
  category: 'infuser',
  description: '+25% damage to attacks from connected organelles.',
  grants: [{ scope: 'connected', to: ATTACKS, modifiers: [pct('damage', [0.25, 0.3, 0.35, 0.45, 0.6])] }],
  overcharge: { description: 'x1.5 potency while Overcharged.', modifiers: [mul('potency', 1.5)] },
}
```

Once an entry matches the game, remove `placeholder: true`. `npm test` checks the data for broken references (unknown status, condition or parameter ids, duplicate ids) and runs every organelle through the calculator at every rarity.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # engine, data and state tests
npm run build      # typecheck + production build into dist/
```

The code is split into three parts:

- `src/engine`: framework-free geometry, slot graph and DPS engine
- `src/state`: build editing and save/share
- `src/ui`: React components

## Deploying

`.github/workflows/deploy.yml` runs the tests on every pull request. On every push to `main` it also deploys to GitHub Pages. To turn deployment on, go to **Settings → Pages** in the repository and set **Source** to **GitHub Actions**. The site is then served at `https://<owner>.github.io/pathogenic-dps/`.

---

Fan-made tool, not affiliated with Aberrant Labs or Slug Disco.
