// What each organelle does, ported from the game's scripts.
//
// Numbers come from the full release's scripts and scenes (September 2026
// build). `r` is the rarity step: 0 Common, 1 Rare, 2 Epic, 3 Legendary,
// 4 Mythic, plus each trait's bonus (Cancerous 1, Eternal 2, Ephemeral and
// Excitable 3): the game simply adds them to the rarity.

import {
  addDamage,
  announce,
  cloneAttack,
  fmt,
  forward,
  newAttack,
  spawnOnHit,
  type Attack,
  type Behaviour,
  type Ctx,
  type Item,
  type WeaponProfile,
} from './model';

const MIN_INTERVAL = 1 / 60;
/** Default weapon speed scaling: 10% faster per rarity step, down to 10% of the base cooldown. */
const scaled = (seconds: number) => (r: number) => Math.max(MIN_INTERVAL, seconds * Math.max(0.1, 1 - 0.1 * r));
const fixed = (seconds: number) => () => seconds;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const exp = (rate: number, seconds: number) => 1 - Math.exp(-Math.max(0, rate) * seconds);

function weapon(p: WeaponProfile, notes?: string): Behaviour {
  return { weapon: p, notes };
}

/** An attack and every copy split off it (splitters make copies before the weapon's own last touches). */
function eachCopy(a: Attack, fn: (x: Attack) => void) {
  fn(a);
  for (const s of a.siblings) eachCopy(s, fn);
}

/** Like shrapnel: a split arc or a bounce is assumed to find another enemy half the time. */
const STRAY_HITS = 0.5;
const splitMemo = new Map<string, number>();

/**
 * Expected bolts split off one lightning bolt `length` px long
 * (lightning_beam.gd): at every 200 px but the last, it has `chance` to split
 * off a new bolt as long as its range left from there. Each split cuts the
 * chance x0.7, and the new bolt carries on with that chance and splits too.
 */
export function expectedSplits(length: number, chance: number): number {
  const n = Math.floor(length / 200);
  if (n < 2 || chance < 1e-4) return 0;
  const key = `${Math.round(length)}|${chance.toPrecision(6)}`;
  const known = splitMemo.get(key);
  if (known !== undefined) return known;
  const step = length / n;
  // Probability of having split k times so far.
  let splits = [1];
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    const next: number[] = new Array(splits.length + 1).fill(0);
    splits.forEach((p, k) => {
      const q = Math.min(1, chance * 0.7 ** k);
      total += p * q * (1 + expectedSplits(length - i * step, chance * 0.7 ** (k + 1)));
      next[k + 1] += p * q;
      next[k] += p * (1 - q);
    });
    splits = next;
  }
  splitMemo.set(key, total);
  return total;
}

/** Extra hits on other enemies from splits, for bolts between `min` and `max` px long. */
function strayArcs(min: number, max: number, chance: number): number {
  const samples = 8;
  let sum = 0;
  for (let i = 0; i < samples; i++) sum += expectedSplits(min + ((max - min) * (i + 0.5)) / samples, chance);
  return (STRAY_HITS * sum) / samples;
}

// ---------------------------------------------------------------------------
// Weapons

const weapons: Record<string, Behaviour> = {
  // Actives: charged by Overcharge, used as soon as they're ready.
  'explosive-charge': weapon(
    { kind: 'explosion', base: 1000, damageMult: (r) => 1 + 0.6 * r, interval: fixed(1), energyCost: () => 10, stamina: 0, reach: 'area' },
    'Active: builds 1 energy per second per point of Overcharge and explodes at 10 (assumes you use it as soon as it is ready). Does not scale with level.',
  ),
  'ciliate-strike': weapon(
    { kind: 'slash', base: 250, damageMult: (r) => 1 + r, interval: fixed(1), energyCost: () => 5, stamina: 0, reach: 'line' },
    'Active: a dash attack for every 5 Overcharge-seconds (assumes you use it as soon as it is ready).',
  ),
  axopodium: weapon(
    { kind: 'slash', base: 63, interval: fixed(1), energyCost: () => 10, shots: (r) => (5 + r) * 10, stamina: 0, reach: 'single' },
    'Active: lashes the nearest enemy every 0.1s for 5s (+1s per rarity). Assumes an enemy stays in reach.',
  ),
  'chromatophore-gland': weapon(
    { kind: 'beam', base: 80, damageMult: (r) => 1 + 0.3 * r, interval: fixed(1), energyCost: () => 10, shots: (r) => (2 + r) * 10, stamina: 0, reach: 'line' },
    'Active: a beam that hits 10 times a second for 2s (+1s per rarity).',
  ),
  'chromatophore-lens': weapon(
    { kind: 'beam', base: 100, damageMult: (r) => 1 + 0.3 * r, interval: fixed(1), energyCost: () => 10, shots: (r) => (2 + r) * 10, stamina: 0, reach: 'line' },
    'Active: a beam that hits 10 times a second for 2s (+1s per rarity).',
  ),
  cryopulse: weapon(
    { kind: 'explosion', base: 40, damageMult: (r) => 1 + r, interval: fixed(1), energyCost: () => 6, stamina: 0, reach: 'area' },
    'Active: a freezing wave around you for every 6 Overcharge-seconds. The freeze is not counted.',
  ),
  pyrocyst: weapon(
    {
      kind: 'orb',
      base: 25,
      damageMult: (r) => 1 + 0.4 * r,
      interval: fixed(1),
      energyCost: () => 10,
      // 10 ticks a second for 6s (+2s per rarity); "Fireball contact" decides how many land.
      shots: (r) => (6 + 2 * r) * 10,
      aimParam: 'fireballContact',
      stamina: 0,
      reach: 'area',
      onFire(ctx, self, a) {
        // Each tick burns for the ball's damage and hits for 20% of it; then it explodes.
        const burn = a.damage;
        a.damage *= 0.2;
        a.onHitDamage *= 0.2;
        a.trace.push({ source: self.info.name, text: `hits for 20%, burns for ${fmt(burn)} per tick` });
        spawnOnHit(a, { label: 'Burn', home: 'same', perHit: 1, derive: () => newAttack({ kind: 'burn', label: 'Burn', base: burn, dotFactor: 2 }) });
        const level = 1 + (Math.max(1, ctx.param('level')) - 1) * 0.75;
        const boom = newAttack({ kind: 'explosion', label: 'Explosion', base: (400 + 200 * self.r) * level, reach: 'area', aim: ctx.param('fireballContact') });
        boom.trace.push({ source: self.info.name, text: `explodes for ${fmt(400 + 200 * self.r)}${level !== 1 ? ` x${level.toFixed(2)} (level)` : ''} and burns for ${400 + 200 * self.r}` });
        spawnOnHit(boom, { label: 'Burn', home: 'same', perHit: 1, derive: () => newAttack({ kind: 'burn', label: 'Burn', base: 400 + 200 * self.r, dotFactor: 2 }) });
        a.siblings.push(boom);
      },
    },
    'Active: a bouncing fireball. "Fireball contact" sets how much of its life it spends on your target (and whether the final explosion catches it).',
  ),
  // Zaps enemies that come near: charges itself, faster with Overcharge.
  'galvanic-sac': weapon(
    {
      kind: 'lightning',
      base: 20,
      damage: (r) => 20 + 6 * r,
      interval: fixed(1),
      rate: (ctx, r, c) => Math.min(20, (0.5 + 0.1 * r + c) / 0.25) * ctx.param('nearbyTime'),
      stamina: 0,
      reach: 'single',
      passive: true,
    },
    'Zaps an enemy touching its field for 0.25 energy; recharges 0.5 (+0.1 per rarity) energy per second plus its Overcharge. Uses "Enemies next to you".',
  ),
  kinetosome: weapon(
    {
      kind: 'slash',
      base: 255,
      damageMult: (r) => 1 + 0.6 * r,
      interval: fixed(1),
      rate: (ctx, _r, c) => ((1 + 0.5 * c) / 0.75) * ctx.param('nearbyTime'),
      stamina: 0,
      reach: 'single',
      passive: true,
    },
    'An orbiting blade that strikes an enemy it touches every 0.75s (faster with Overcharge). Uses "Enemies next to you".',
  ),
  // Pseudopods reach for the nearest enemy on their own.
  'trophic-pseudopod': {
    weapon: { kind: 'slash', base: 10, damageMult: (r, c) => (1 + 0.25 * r) * (1 + 0.15 * c), interval: fixed(1), rate: () => 2, stamina: 0, reach: 'single', passive: true },
    mito: { trigger: 'For 0.75s after each of its hits', charge: (r) => (r >= 2 ? 2 : 1), uptime: () => 1 },
    notes: 'Strikes the nearest enemy every 0.5s and Overcharges its neighbours while it keeps hitting. Assumes an enemy is always in reach.',
  },
  'kinetic-pseudopod': weapon(
    { kind: 'slash', base: 20, interval: fixed(1), rate: (_ctx, r) => 1 / Math.max(0.2, 2 - 0.2 * r), stamina: 0, reach: 'single', passive: true },
    'Knocks the nearest enemy away every 2s (-0.2s per rarity). Assumes an enemy is always in reach.',
  ),
  cryopseudopod: weapon(
    { kind: 'slash', base: 5, damageMult: (r) => 1 + r, interval: fixed(1), rate: () => 1 / 0.3, stamina: 0, reach: 'single', passive: true },
    'Freezes the nearest enemy, striking every 0.3s. The freeze is not counted.',
  ),
  'galvanic-flagellum': weapon(
    {
      kind: 'lightning',
      base: 48,
      damageMult: (r, c) => (48 + 24 * r + 48 * c) / 48,
      interval: fixed(1),
      rate: (ctx, r) => ctx.param('dodgeRateAll') * (3 + r),
      stamina: 0,
      reach: 'single',
      passive: true,
    },
    'Fires 3 arcs (+1 per rarity) at the nearest enemy each time you dodge. Uses "Dodges per second".',
  ),
  'caustic-secretor': weapon({ kind: 'bullet', base: 6.5, interval: scaled(0.105), stamina: 0.5, reach: 'single', speed: 3000 }),
  'pulsar-gland': weapon({
    kind: 'bullet',
    base: 35,
    damageMult: (r) => 1 + 0.15 * r,
    interval: fixed(1.3),
    chargeAttackSpeed: 0,
    stamina: 12,
    shots: (r, c) => 3 + r + Math.round(c * (1 + Math.ceil(r / 3))),
    reach: 'single',
    speed: 4500,
  }),
  'scatter-ejector': weapon({
    kind: 'bullet',
    base: 8,
    damageMult: (r) => 1 + 0.25 * r,
    interval: fixed(0.9),
    chargeAttackSpeed: 0,
    stamina: 3.5,
    shots: (r, c) => 10 + 3 * r + Math.round(c * (2 + Math.ceil(r / 2))),
    reach: 'single',
    aimParam: 'pelletHit',
    speed: 3500,
  }),
  'cluster-ejector': weapon({
    kind: 'bullet',
    base: 19,
    damageMult: (r) => 1 + 0.25 * r,
    interval: fixed(1.5),
    chargeAttackSpeed: 0,
    stamina: 6,
    shots: (r, c) => 5 + r + Math.round(c * (1 + Math.ceil(r / 2))),
    reach: 'single',
    aimParam: 'pelletHit',
    speed: 9000,
  }),
  'rotary-extruder': weapon(
    { kind: 'bullet', base: 9, damageMult: (r) => 1 + 0.2 * r, interval: scaled(0.04), stamina: 0.25, reach: 'single', speed: 4500, minCharge: 0.9 },
    'Only fires while holding at least 0.9 Overcharge.',
  ),
  'lateral-vent': weapon(
    { kind: 'bullet', base: 13, interval: scaled(0.09), stamina: 0.2, shots: () => 2, reach: 'single', aimParam: 'sideHit', speed: 9000 },
    'Fires sideways; the "Sideways shots on target" assumption decides how often they hit.',
  ),
  'spore-cannon': weapon({ kind: 'bullet', base: 95, interval: scaled(1.5), stamina: 8, reach: 'single', speed: 2000 }),
  'pressurized-spicule': weapon({ kind: 'bullet', base: 140, interval: scaled(2.5), stamina: 25, reach: 'single', speed: 6000 }),
  oxidator: weapon(
    {
      kind: 'bullet',
      base: 0.7,
      interval: scaled(0.03),
      stamina: 0.2,
      reach: 'line',
      speed: 2000,
      onFire(_ctx, self, a) {
        const amount = 2 + 2 * self.r;
        a.trace.push({ source: self.info.name, text: `burns for ${amount} per hit` });
        spawnOnHit(a, { label: 'Burn', home: 'same', perHit: 1, derive: () => newAttack({ kind: 'burn', label: 'Burn', base: amount, dotFactor: 2 }) });
      },
    },
    'Each flame adds 2 burn (+2 per rarity) to the enemy; burn pools and halves every second, so it deals about twice what is added.',
  ),
  'actin-whip': weapon({ kind: 'bullet', base: 4, interval: scaled(0.02), stamina: 0.1, reach: 'single', speed: 3000 }),
  'cyst-depositor': weapon({ kind: 'bullet', base: 180, interval: scaled(2), stamina: 8, reach: 'single', aimParam: 'mineHit', speed: 100 }),
  cnidocyst: weapon({ kind: 'bullet', base: 100, interval: scaled(2), stamina: 25, reach: 'line', speed: 4000 }, 'Pierces 1 enemy (+1 per rarity). Binding enemies to walls is not modeled.'),
  'galvanic-cnidocyst': weapon(
    { kind: 'bullet', base: 60, interval: scaled(1.5), stamina: 10, reach: 'line', speed: 4000 },
    'Chains two enemies so hits on one also hurt the other (70% +20% per rarity); only the harpoon itself is counted.',
  ),
  'blastocyst-mortar': weapon({ kind: 'bullet', base: 300, interval: scaled(1.7), stamina: 8, reach: 'area', speed: 2500, explodes: true }),
  'dehiscence-lobber': weapon({ kind: 'bullet', base: 280, interval: scaled(2.5), stamina: 20, reach: 'area', speed: 6000, explodes: true }),
  staurolobber: weapon(
    { kind: 'beam', base: 35, interval: scaled(3), stamina: 25, shots: () => 15, hits: (ctx) => ctx.param('stauroLasers'), reach: 'line', speed: 6000 },
    'Lands and fires 4 lasers for 1.5s, each hitting 10 times a second. "Lasers on target" sets how many of them hit your target.',
  ),
  'thermal-lance': weapon({ kind: 'beam', base: 45, interval: scaled(1), stamina: 5, reach: 'line' }),
  'galvanic-conduit': weapon(
    {
      kind: 'beam',
      base: 20,
      interval: scaled(0.3),
      stamina: 0.8,
      reach: 'line',
      randomAdvance: 0.25,
      onFire(ctx, self, a) {
        // Each bolt deals 40% to 120% of its damage at random, after bonuses, and
        // reaches 30% to 110% of 2000 px, splitting as it goes (13% chance per 200 px).
        const stray = strayArcs(600, 2200, 0.13 * ctx.lightningSplit);
        eachCopy(a, (x) => {
          x.damage *= 0.8;
          x.onHitDamage *= 0.8;
          x.extraOthers += stray;
        });
        a.trace.push({ source: self.info.name, text: 'x0.8 on average (random 0.4 to 1.2)' });
        if (stray) a.trace.push({ source: self.info.name, text: `split arcs: +${fmt(stray)} hits on other enemies per bolt` });
      },
    },
    'Each bolt comes up to 0.25s early at random. Bolts split as they fly (13% chance per 200 px); split arcs are assumed to find another enemy half the time, so they only add multi-target damage.',
  ),
  'luciferase-pump': weapon(
    {
      kind: 'beam',
      base: 8,
      interval: fixed(1),
      rate: () => 10,
      stamina: 1,
      reach: 'line',
      onFire(_ctx, self, a, c) {
        if (!c) return;
        a.damage *= 1 + 0.3 * c;
        a.onHitDamage *= 1 + 0.3 * c;
        a.trace.push({ source: self.info.name, text: `x${(1 + 0.3 * c).toFixed(2)} damage (Overcharge)` });
      },
    },
    'A held beam that hits 10 times a second and drains 10 stamina a second. Overcharge adds 30% damage per point instead of attack speed.',
  ),
  cryophore: weapon(
    { kind: 'beam', base: 2.5, interval: fixed(1), rate: () => 10, stamina: 0.25, reach: 'line' },
    'A held freezing beam that hits 10 times a second and drains 2.5 stamina a second. The freeze is not counted.',
  ),
  'mucus-emitter': weapon(
    { kind: 'orb', base: 40, interval: scaled(3.5), stamina: 20, reach: 'area', speed: 200, hits: (ctx) => Math.min(4, ctx.param('orbContact')) / 0.2 },
    'Ticks every 0.2s while touching an enemy; the "Orb contact time" assumption sets how long (it lasts 4s).',
  ),
  'lacerator-tendril': weapon({ kind: 'slash', base: 90, interval: scaled(1), stamina: 5, reach: 'area' }),
  'perforator-tendril': weapon({ kind: 'slash', base: 100, interval: scaled(1.4), stamina: 7, reach: 'area' }),
  'stinger-tendril': weapon({ kind: 'slash', base: 20, interval: scaled(0.15), stamina: 1, reach: 'area' }),
  'capsid-flail': weapon({ kind: 'slash', base: 270, interval: scaled(3), stamina: 15, reach: 'area' }),
  'tri-phase-tendril': weapon({ kind: 'slash', base: 40, interval: scaled(0.6), stamina: 5, reach: 'area', combo: true }),
  'helical-proboscis': weapon({ kind: 'slash', base: 45, interval: scaled(0.5), stamina: 5, reach: 'area', spinUp: 0.3 }),
  'gyrase-wheel': weapon({ kind: 'slash', base: 60, interval: scaled(0.4), stamina: 1.4, reach: 'area' }),
  'concussive-tendril': weapon({ kind: 'slash', base: 35, interval: scaled(0.9), stamina: 5, reach: 'area' }, 'Knocking enemies into walls is not modeled.'),
};

// ---------------------------------------------------------------------------
// Attack infusers and other attack modifiers

const infusers: Record<string, Behaviour> = {
  oxysome: {
    modifyAttack(ctx, self, a, _chain, times) {
      const c = ctx.charge(self);
      addDamage(a, (0.25 + 0.15 * self.r + c * (0.4 + 0.1 * self.r)) * times, self.info.name);
    },
  },
  'starved-oxysome': {
    modifyAttack(ctx, self, a, _chain, times) {
      const c = ctx.charge(self);
      addDamage(a, (-0.4 + 0.1 * self.r + c * (1.6 + 0.2 * self.r)) * times, self.info.name);
    },
  },
  phagosome: {
    notes: 'Gains 0.5% per kill made with its attacks (+0.25% per rarity per Overcharge); "Phagosome kills" sets how many so far.',
    modifyAttack(ctx, self, a, _chain, times) {
      const perKill = 0.005 + ctx.charge(self) * (0.0025 + 0.0025 * self.r);
      addDamage(a, (-0.2 + 0.1 * self.r + ctx.param('phagosomeKills') * perKill) * times, self.info.name);
    },
  },
  'autolytic-oxysome': {
    notes: 'Gains 10% (+3% per rarity, doubled per Overcharge) each time you recycle an organelle; "Organelles recycled" sets how many.',
    modifyAttack(ctx, self, a, _chain, times) {
      const per = (0.1 + 0.03 * self.r) * (1 + ctx.charge(self));
      addDamage(a, (-0.2 + 0.05 * self.r + ctx.param('recycled') * per) * times, self.info.name);
    },
  },
  phagolysosome: {
    notes: 'Gains 40% (+10% per rarity) for each organelle it eats in the editor; "Organelles eaten" sets how many.',
    modifyAttack(ctx, self, a, _chain, times) {
      addDamage(a, ctx.param('eaten') * (0.4 + 0.1 * self.r) * times, self.info.name);
    },
  },
  'dorsal-lysosome': {
    notes: 'Backstabs happen at the "Backstab chance" assumption. Chainable: passes backstabbing attacks on.',
    modifyAttack(ctx, self, a, chain, times) {
      const p = ctx.param('backstabChance');
      const c = ctx.charge(self);
      const share = (1 + 0.5 * self.r + c * (1 + 0.1 * self.r)) * p * times;
      a.onHitDamage += a.base * share;
      a.trace.push({ source: self.info.name, text: `+${pct(1 + 0.5 * self.r + c * (1 + 0.1 * self.r))} of base on backstabs (${pct(p)} of hits)` });
      forward(ctx, a, chain, self, times * p);
    },
  },
  'perforin-infuser': {
    notes: 'Projectiles pierce; adds its bonus on every enemy hit, so on a single target it counts once.',
    modifyAttack(ctx, self, a, chain, times) {
      const c = ctx.charge(self);
      const share = (0.4 + 0.2 * self.r + c * (0.4 + 0.1 * self.r)) * times;
      a.reach = a.reach === 'single' ? 'line' : a.reach;
      a.onHitDamage += a.base * share;
      a.trace.push({ source: self.info.name, text: `pierces; +${pct(share)} of base damage on hit` });
      forward(ctx, a, chain, self, times);
    },
  },
  'sinoatrial-node': {
    notes: '"Beat sync" sets how well you hit the beat of the music.',
    modifyAttack(ctx, self, a, chain, times) {
      const c = ctx.charge(self);
      const sync = ctx.param('beatSync');
      // Closeness to the beat is uniform when not trying; the bonus follows closeness^(2/(1+charge)).
      const expPow = (1 + c) / (3 + c);
      const closeness = sync + (1 - sync) * expPow;
      // remap(closeness, 0, 1, min -1, max 2 + 0.7r)
      const mult = -1 + (3 + 0.7 * self.r) * closeness;
      addDamage(a, mult * times, self.info.name);
      forward(ctx, a, chain, self, times * (sync + (1 - sync) * 0.08));
    },
  },
  turgosome: {
    notes: 'Grows 50% (+15% per rarity) per second without attacking, up to 5s. Assumes it only sees this weapon; ignores pseudopods and zappers.',
    modifyAttack(ctx, self, a, chain, times) {
      if (chain[0]?.behaviour.weapon?.passive) return;
      const t = Math.min(5, ctx.gun?.interval ?? 5);
      addDamage(a, (-0.3 + 0.05 * self.r + (0.5 + 0.15 * self.r) * t) * times, self.info.name);
      if (t >= 5) forward(ctx, a, chain, self, times);
    },
  },
  katanosome: {
    deferred: true,
    notes: 'A 10% chance (+10% per Overcharge) to multiply the whole attack by 2 (+1 per rarity). Critical attacks carry on down the chain.',
    modifyAttack(ctx, self, a, chain, times) {
      const p = Math.min(1, 0.1 + 0.1 * ctx.charge(self));
      const m = 2 + self.r;
      const expected = 1 + p * (m - 1) * times;
      a.damage *= expected;
      a.onHitDamage *= expected;
      a.trace.push({ source: self.info.name, text: `${pct(p)} chance of x${m}: x${expected.toFixed(2)} on average` });
      forward(ctx, a, chain, self, times * p);
    },
  },
  pyrosome: {
    notes: 'Burn pools on the enemy and halves every second, so each application deals about twice its amount. Bonuses only touch the burn once, when it starts.',
    modifyAttack(ctx, self, a, _chain, times) {
      const amount = 4 + 3 * self.r + 4 * ctx.charge(self);
      spawnOnHit(a, {
        label: `Burn (${self.info.name})`,
        home: 'same',
        perHit: times,
        derive: () => {
          const burn = newAttack({ kind: 'burn', label: 'Burn', base: amount, dotFactor: 2 });
          burn.trace.push({ source: self.info.name, text: `${fmt(amount)} burn per application, halving each second` });
          return burn;
        },
      });
    },
  },
  peroxisome: {
    notes: 'Every hit (or miss) explodes for 200% (+50% per rarity) of the attack\'s damage, catching the enemy that was hit. Mutations don\'t add to the explosion.',
    modifyAttack(ctx, self, a, chain, times) {
      const m = 2 + 0.5 * self.r + ctx.charge(self) * (1 + 0.25 * self.r);
      spawnOnHit(a, {
        label: `Explosion (${self.info.name})`,
        home: 'same',
        perHit: times,
        derive: (p) => {
          const e = newAttack({ kind: 'explosion', label: 'Explosion', base: p.base * m, reach: 'area' });
          e.damage = (p.damage + p.onHitDamage) * m;
          e.trace.push({ source: self.info.name, text: `x${m.toFixed(2)} of the attack's damage` });
          forward(ctx, e, chain, self, 1);
          return e;
        },
      });
    },
  },
  echosome: {
    notes: 'Splash never hits the enemy that was struck, so it only adds multi-target damage.',
    modifyAttack(ctx, self, a, chain, times) {
      const m = 0.35 + 0.15 * self.r;
      spawnOnHit(a, {
        label: `Splash (${self.info.name})`,
        home: 'others',
        perHit: times,
        derive: (p) => {
          const s = newAttack({ kind: 'splash', label: 'Splash', base: p.base * m, reach: 'area' });
          s.damage = (p.damage + p.onHitDamage) * m;
          forward(ctx, s, chain, self, 1);
          announce(ctx, s, self);
          return s;
        },
      });
    },
  },
  opisthoblast: {
    notes: 'Each hit sends a cone onward from the enemy at 80% (+30% per rarity) of the attack\'s damage; it skips the enemy that was hit, so it only adds multi-target damage.',
    modifyAttack(ctx, self, a, chain, times) {
      const m = 0.8 + 0.3 * self.r;
      spawnOnHit(a, {
        label: `Cone (${self.info.name})`,
        home: 'others',
        perHit: times,
        derive: (p) => {
          const s = newAttack({ kind: 'splash', label: 'Cone', base: p.base * m, reach: 'area', melee: true });
          s.damage = (p.damage + p.onHitDamage) * m;
          forward(ctx, s, chain, self, 1);
          announce(ctx, s, self);
          return s;
        },
      });
    },
  },
  'lateral-emitter': {
    notes: 'Each hit fires two lasers out to the sides at 100% (+30% per rarity) of the attack\'s base damage; they skip the enemy that was hit, so they only add multi-target damage.',
    modifyAttack(ctx, self, a, chain, times) {
      const m = 1 + 0.3 * self.r + 0.4 * ctx.charge(self);
      spawnOnHit(a, {
        label: `Side lasers (${self.info.name})`,
        home: 'others',
        perHit: times * 2,
        derive: (p) => {
          const l = newAttack({ kind: 'beam', label: 'Side laser', base: p.base * m, reach: 'line' });
          forward(ctx, l, chain, self, 1);
          announce(ctx, l, self);
          return l;
        },
      });
    },
  },
  vortisome: {
    notes: 'A 10% chance (+5% per rarity) per attack to leave a pulling field that hits for 40% (+15% per rarity) of the attack\'s damage.',
    modifyAttack(ctx, self, a, chain, times) {
      const chance = 0.1 + 0.05 * self.r;
      const m = 0.4 + 0.15 * self.r;
      spawnOnHit(a, {
        label: `Pull field (${self.info.name})`,
        home: 'same',
        perHit: times * chance,
        derive: (p) => {
          const f = newAttack({ kind: 'splash', label: 'Pull field', base: p.base * m, reach: 'area' });
          f.damage = (p.damage + p.onHitDamage) * m;
          forward(ctx, f, chain, self, 1);
          announce(ctx, f, self);
          return f;
        },
      });
    },
  },
  ruptusome: {
    notes: 'Shrapnel flies away from the struck enemy, so it only adds multi-target damage; each shard is assumed to find another enemy half the time.',
    modifyAttack(ctx, self, a, chain, times) {
      const c = ctx.charge(self);
      const half = Math.floor(self.r / 2);
      const m = 0.5 + 0.2 * self.r - 0.2 * half + c * (0.3 + 0.1 * self.r);
      const n = 2 + half;
      spawnOnHit(a, {
        label: `Shrapnel (${self.info.name})`,
        home: 'others',
        perHit: times * n * 0.5,
        derive: (p) => {
          const s = newAttack({ kind: 'shrapnel', label: 'Shrapnel', base: p.base * m });
          s.damage = (p.damage + p.onHitDamage) * m;
          s.bullet = true;
          forward(ctx, s, chain, self, 1);
          announce(ctx, s, self);
          return s;
        },
      });
    },
  },
  'galvanic-infuser': {
    notes:
      'Arcs go to a different enemy, so this is multi-target only. Arcs split as they fly; their length comes from "Distance to target" (the gap to the next enemy).',
    modifyAttack(ctx, self, a, chain, times) {
      const c = ctx.charge(self);
      const chance = Math.min(1, 0.2 + 0.05 * self.r + 0.3 * c);
      const m = 0.5 + 0.1 * self.r;
      spawnOnHit(a, {
        label: `Arc (${self.info.name})`,
        home: 'others',
        perHit: times * chance,
        derive: (p) => {
          const l = newAttack({ kind: 'lightning', label: 'Arc', base: p.base * m });
          l.damage = (p.damage + p.onHitDamage) * m;
          // Aimed at the next enemy (up to 1500 px), reaching 1 to 2 times as far.
          const gap = Math.min(1500, Math.max(0, ctx.param('targetDistance')));
          l.extraOthers = strayArcs(gap, 2 * gap, 0.13 * ctx.lightningSplit);
          forward(ctx, l, chain, self, 1);
          announce(ctx, l, self);
          return l;
        },
      });
    },
  },
  bifurcator: {
    deferred: true,
    notes: 'Both halves fly off at an angle; "Angled shots on target" sets how often they still hit. One half carries on down the chain.',
    modifyAttack(ctx, self, a, chain, times) {
      const m = 0.95 + 0.1 * self.r;
      a.damage *= m;
      a.onHitDamage *= m;
      a.angled = true;
      a.trace.push({ source: self.info.name, text: `split in two, x${m.toFixed(2)} damage each` });
      const copy = cloneAttack(a);
      copy.copies = a.copies * times;
      a.siblings.push(copy);
      forward(ctx, copy, chain, self, 1);
    },
  },
  triosome: {
    deferred: true,
    notes: 'Adds two side shots; "Angled shots on target" sets how often they hit. Both side shots carry on down the chain.',
    modifyAttack(ctx, self, a, chain, times) {
      const c = ctx.charge(self);
      const m = 0.25 + 0.1 * self.r + 0.25 * c;
      const copy = cloneAttack(a);
      copy.damage = a.damage * m;
      copy.onHitDamage = a.onHitDamage * m;
      copy.copies = a.copies * 2 * times;
      copy.angled = true;
      copy.trace.push({ source: self.info.name, text: `side shot, x${m.toFixed(2)} damage` });
      a.siblings.push(copy);
      forward(ctx, copy, chain, self, 1);
    },
  },
  chronosome: {
    notes: 'Ticks while a projectile travels; travel time comes from "Distance to target".',
    modifyAttack(ctx, self, a, chain, times) {
      if (!a.speed) return;
      const c = ctx.charge(self);
      const wait = Math.max(0.1, (0.5 - 0.05 * self.r) * 0.7 ** c);
      const ticks = Math.floor(ctx.param('targetDistance') / a.speed / wait);
      if (ticks <= 0) return;
      addDamage(a, (0.25 + 0.1 * self.r) * ticks * times, `${self.info.name} (${ticks} tick${ticks > 1 ? 's' : ''})`);
      forward(ctx, a, chain, self, times * ticks);
    },
  },
  cryosome: {
    notes: 'Freezing deals no damage; chainable on the attacks that freeze (6% +5% per Overcharge).',
    modifyAttack(ctx, self, a, chain, times) {
      const c = ctx.charge(self);
      forward(ctx, a, chain, self, times * Math.min(1, 0.06 + c * (0.05 + 0.01 * self.r)));
    },
  },
  attractor: {
    notes: 'Homing projectiles: split and angled shots land on the target.',
    modifyAttack(_ctx, self, a) {
      if (a.kind !== 'bullet' && a.kind !== 'beam') return;
      a.homing = true;
      a.trace.push({ source: self.info.name, text: 'homing' });
    },
  },
  vesicle: {
    conduit: true,
    notes: 'Passes attacks, weapon effects and Overcharge on to everything connected to it. From Rare up it may trigger each modifier twice.',
    modifyAttack(ctx, self, a, chain, times) {
      forward(ctx, a, chain, self, times * (1 + 0.2 * self.r));
    },
    modifyGun(ctx, self, gun, times) {
      for (const n of ctx.neighbours(self)) {
        if (n.behaviour.weaponModifier && n.behaviour.modifyGun && ctx.works(n)) {
          const before = gun.trace.length;
          n.behaviour.modifyGun(ctx, n, gun, times);
          if (gun.trace.length > before) ctx.link(n, self, 'gun');
        }
      }
    },
  },
  elastosome: {
    notes:
      'Bullets and beams bounce 1 more time (+1 per rarity and per full point of Overcharge). Each bounce is assumed to find another enemy half the time, so it only adds multi-target damage; the infusers it passes bounces on to are not counted again.',
    modifyAttack(ctx, self, a) {
      // Only projectiles with bounces (bullets and beams); once per attack.
      if (!a.bullet && a.kind !== 'beam' && a.kind !== 'lightning') return;
      const bounces = 1 + self.r + Math.floor(ctx.charge(self) + 1e-9);
      a.extraOthers += bounces * STRAY_HITS;
      a.trace.push({ source: self.info.name, text: `${bounces} bounce${bounces === 1 ? '' : 's'}: +${fmt(bounces * STRAY_HITS)} hits on other enemies` });
    },
  },
  'golgi-apparatus': {
    weaponModifier: true,
    golgi: { damage: (r) => -0.1 + 0.2 * r },
    notes:
      "Connected melee weapons stop attacking on their own: each attack that reaches it (from anything else) makes one strike where it hits or misses, as often as the melee weapon's cooldown allows, for -10% (+20% per rarity) of base damage more. Its Overcharge speeds that weapon up by 30% (+10% per rarity) per point. Strikes from attacks that miss your target are not counted.",
    modifyGun(ctx, self, gun, times) {
      if (gun.weapon?.info.subtype !== 'melee') return;
      const bonus = (0.3 + 0.1 * self.r) * ctx.charge(self) * times;
      if (!bonus) return;
      gun.bonus += bonus;
      gun.trace.push({ source: self.info.name, text: `+${pct(bonus)} attack speed (Overcharge)` });
    },
    modifyAttack(ctx, self, a, chain, times) {
      const from = chain[chain.length - 1];
      if (!ctx.gun || !(ctx.gun.interval > 0) || (from?.info.category === 'weapon' && from.info.subtype === 'melee')) return;
      ctx.trigger(self, (times * a.copies) / ctx.gun.interval, a.aim);
    },
  },
  resilinoplast: {
    weapon: {
      kind: 'bullet',
      base: 50,
      damageMult: (r) => 1 + r,
      interval: fixed(1),
      // Melee strikes through it send the enemy shots they cut back where they came from.
      rate: (ctx, _r, _c, self) => (ctx.neighbours(self).some((n) => n.info.category === 'weapon' && n.info.subtype === 'melee') ? ctx.param('slashRate') : 0),
      stamina: 0,
      reach: 'single',
      passive: true,
    },
    notes:
      'Connected melee weapons send the enemy shots they cut back at the shooter as 50 damage (x rarity +1) shots, at "Shots slashed per second". Its chance to give your own bullets a reflecting field depends on enemy fire and is not counted.',
  },
  // Effects with nothing to model for damage (or that depend on where things are).
  extensor: { notes: 'Range only; not modeled.' },
  magnetosome: { notes: 'Pulls projectiles; not modeled.' },
  toxisome: {
    notes:
      'Attacks drop toxic puddles (3 +1 per rarity) along their path every 0.2-0.6s, and slashes on each hit: how many your target walks through depends on where it goes; not modeled.',
  },
  'galvanic-weave': {
    notes: 'Every 0.1-3s each woven attack arcs to three other woven attacks: whether an arc crosses an enemy depends on where your attacks are; not modeled.',
  },
  'sympathetic-detonator': {
    notes: 'When you dash, attacks still flying explode (80% +30% per rarity of their damage) instead of hitting: depends on what they are near; not modeled.',
  },
  'opsonin-arc': { notes: 'Boosts attacks that pass through its rotating arc: depends on positioning; not modeled.' },
  gyrosome: { notes: 'Makes projectiles orbit you and pierce: extra hits depend on positioning; not modeled.' },
  apoptosome: { notes: 'Enemies it kills explode for 800 (+400 per rarity): depends on kills; not modeled.' },
};

// ---------------------------------------------------------------------------
// Weapon infusers (attack speed, stamina, charging)

const weaponInfusers: Record<string, Behaviour> = {
  'resonant-cavity': {
    weaponModifier: true,
    notes: '+1.5% attack speed (+0.5% per rarity) per hit, up to 40 hits (+12 per rarity); misses take stacks away. "Resonant stacks" sets how close to max you stay; chainable at max.',
    modifyGun(ctx, self, gun, times) {
      const stacks = ctx.param('resonantStacks') * (40 + 12 * self.r);
      const bonus = (0.015 + 0.005 * self.r) * stacks * times;
      gun.bonus += bonus;
      gun.trace.push({ source: self.info.name, text: `+${pct(bonus)} attack speed` });
    },
    modifyAttack(ctx, self, a, chain, times) {
      if (ctx.param('resonantStacks') >= 1) forward(ctx, a, chain, self, times);
    },
  },
  photoreceptor: {
    weaponModifier: true,
    notes: 'Aims and fires connected weapons at enemies in range for free (refunding their stamina). Auto-aim itself is not modeled.',
    modifyGun(ctx, self, gun, times) {
      const bonus = (0.5 + 0.1 * self.r) * ctx.charge(self) * times;
      if (bonus) {
        gun.bonus += bonus;
        gun.trace.push({ source: self.info.name, text: `+${pct(bonus)} attack speed (Overcharge)` });
      }
      const m = (1 / 0.9 ** (self.r + 1)) ** times;
      gun.mult *= m;
      gun.trace.push({ source: self.info.name, text: `x${m.toFixed(2)} attack speed` });
    },
    modifyAttack(ctx, _self, _a, chain) {
      ctx.refund(chain[0]);
    },
  },
  'glycogen-synthesizer': {
    weaponModifier: true,
    notes: 'Refunds the stamina of weapons whose attacks reach it, and restores 20 (+20 per rarity) stamina a second per Overcharge.',
    staminaRefund: (r, c) => (20 + 20 * r) * c,
    modifyAttack(ctx, _self, _a, chain) {
      ctx.refund(chain[0]);
    },
  },
  'exocytotic-chamber': {
    weaponModifier: true,
    notes:
      "Connected weapons charge instead of firing: after 2s (faster with Overcharge) they release a cluster worth 140% of their damage for that time. Flat damage from the weapon's own infusers is replaced; this organelle's neighbours add theirs.",
    chargeCluster: { maxTime: 2, mult: 1.4, speedPerCharge: 0.5, burst: (r) => 1 + 0.4 * r },
  },
};

// ---------------------------------------------------------------------------
// Mitochondria and other Overcharge sources

const halfStep = (r: number) => Math.floor(r / 2);
const odd = (r: number) => r % 2;

const mitochondria: Record<string, Behaviour> = {
  'entrant-mitochondrion': {
    mito: {
      trigger: 'At the start of each room',
      charge: () => 1,
      duration: (r) => 15 + 5 * r,
      uptime: (ctx, r) => Math.min(1, (15 + 5 * r) / ctx.param('roomLength')),
    },
  },
  'berserk-mitochondrion': {
    mito: {
      trigger: 'After each kill',
      charge: (r) => 1 + halfStep(r),
      duration: (r) => 3 + 2 * odd(r),
      uptime: (ctx, r) => exp(ctx.param('killRate'), 3 + 2 * odd(r)),
    },
  },
  'vengeful-mitochondrion': {
    mito: {
      trigger: 'After you take a hit',
      charge: (r) => 2 + halfStep(r),
      duration: (r) => 7 + 3 * odd(r),
      uptime: (ctx, r) => exp(ctx.param('hitsTakenRate'), 7 + 3 * odd(r)),
    },
  },
  'elusive-mitochondrion': {
    mito: {
      trigger: 'After dodging through an enemy projectile',
      charge: (r) => 1 + halfStep(r),
      duration: (r) => 5 + 3 * odd(r),
      uptime: (ctx, r) => exp(ctx.param('dodgeRate'), 5 + 3 * odd(r)),
    },
  },
  'metabolic-mitochondrion': {
    mito: {
      trigger: 'After taking a pickup',
      charge: () => 1,
      duration: (r) => 3 + 2 * r,
      uptime: (ctx, r) => exp(ctx.param('pickupRate'), 3 + 2 * r),
    },
  },
  'pristine-mitochondrion': {
    mito: {
      trigger: 'After finishing a room without losing HP',
      charge: (r) => 1 + halfStep(r),
      duration: (r) => 40 + 20 * odd(r),
      uptime: (ctx, r) => ctx.param('perfectRooms') * Math.min(1, (40 + 20 * odd(r)) / ctx.param('roomLength')),
    },
  },
  glycocalyx: {
    notes: 'Its rotating arc blocks enemy shots; each block Overcharges its neighbours.',
    mito: {
      trigger: 'After its arc blocks an enemy projectile',
      charge: () => 1,
      duration: (r) => 3 + 0.5 * r,
      uptime: (ctx, r) => exp(ctx.param('blockRate'), 3 + 0.5 * r),
    },
  },
  'ablative-mitochondrion': {
    mito: {
      trigger: 'After slashing an enemy projectile',
      charge: () => 1,
      duration: (r) => 2 + r,
      uptime: (ctx, r) => exp(ctx.param('slashRate'), 2 + r),
    },
  },
  'recuperative-mitochondrion': {
    notes: 'Each hit of a connected attack adds charge, which drains over 1s (+0.8s per rarity); it stays full while you keep hitting several times a second.',
    mito: { trigger: 'While connected attacks keep hitting', charge: () => 1, uptime: () => 0.8 },
  },
  'autophagic-mitochondrion': {
    notes: 'You choose when to use it, at the cost of 1 HP: set its uptime by hand.',
    mito: {
      trigger: 'When you activate it (costs 1 HP)',
      charge: (r) => 2 + halfStep(r),
      duration: (r) => 6 + 2 * odd(r),
      uptime: () => 0,
    },
  },
  vacuole: {
    notes: 'Stores Overcharge it receives and releases it as 1 Overcharge for 5s at 70% (+5% per rarity) efficiency: set its uptime by hand.',
    mito: { trigger: 'When you release stored Overcharge', charge: () => 1, duration: () => 5, uptime: () => 0 },
  },
};

// ---------------------------------------------------------------------------
// Minions
//
// Minions follow behaviour trees (scn/player/minions/*.tscn). Their attacks go
// through the organelle that spawned them: it sets the damage, its connected
// infusers modify it and mutations add their share of the projectile's own
// base damage. The calculator turns each minion's attack pattern into a rate
// and assumes it spends "Minion engagement" of the fight attacking. Minions
// spawned by actives stay until the room ends or they die: on average
// min("Minion lifetime", half a room) seconds.

const engaged = (ctx: Ctx) => ctx.param('minionEngagement');
const spawnedLife = (ctx: Ctx) => Math.min(ctx.param('minionLifetime'), ctx.param('roomLength') / 2);

const minions: Record<string, Behaviour> = {
  'apex-nidus': weapon(
    {
      kind: 'slash',
      // The heavy minion's slash: 70 base damage in the game files, set to 50 (+20 per rarity).
      base: 70,
      damage: (r) => 50 + 20 * r,
      interval: fixed(1),
      // A slash every 1.5s in reach, and a charge ending in another slash every 5s.
      rate: (ctx) => (1 / 1.5 + 1 / 5) * engaged(ctx),
      stamina: 0,
      reach: 'area',
      minions: () => 1,
      onFire(_ctx, self, a) {
        // Bumping into enemies also hurts them (15 +5 per rarity, at most every 0.8s); assumed half as often.
        const touch = newAttack({ kind: 'slash', label: 'Contact', base: 15 + 5 * self.r, copies: 0.5 / 0.8 / (1 / 1.5 + 1 / 5) });
        touch.trace.push({ source: self.info.name, text: 'contact damage, about every 1.6s while fighting' });
        a.siblings.push(touch);
      },
    },
    'One heavy minion that slashes every 1.5s and charges every 5s; it comes back each room. Uses "Minion engagement".',
  ),
  'sentry-nidus': weapon(
    {
      kind: 'bullet',
      base: 95,
      damage: (r) => 80 + 50 * r,
      interval: fixed(1),
      energyCost: () => 10,
      // Each sentry fires a shell a second for as long as it lives.
      hits: (ctx) => spawnedLife(ctx) * engaged(ctx),
      stamina: 0,
      reach: 'single',
      speed: 2000,
      minions: (ctx, _r, rate) => rate * spawnedLife(ctx),
    },
    'Active: places a spinning sentry for every 10 Overcharge-seconds; each fires a shell a second. Uses "Minion lifetime" and "Minion engagement".',
  ),
  'swarm-nidus': weapon(
    {
      kind: 'bullet',
      base: 6.5,
      damage: (r) => 9 + 5 * r,
      interval: fixed(1),
      energyCost: () => 4,
      // Volleys of 9 shots over 0.9s, then a 0.1-1.5s pause: about 5.3 shots a second.
      hits: (ctx) => spawnedLife(ctx) * (9 / 1.7) * engaged(ctx),
      stamina: 0,
      reach: 'single',
      minions: (ctx, _r, rate) => rate * spawnedLife(ctx),
    },
    'Active: spawns a fast-shooting minion for every 4 Overcharge-seconds. Uses "Minion lifetime" and "Minion engagement".',
  ),
  nidublast: weapon(
    {
      kind: 'slash',
      base: 20,
      interval: scaled(4),
      stamina: 20,
      // Each minion lives 5s and slashes every 0.15s when it reaches an enemy.
      hits: (ctx) => (5 / 0.15) * engaged(ctx),
      reach: 'single',
      minions: (_ctx, _r, rate) => rate * 5,
    },
    'Fires a minion that lives 5s, slashing every 0.15s. Its infusers apply to every slash. Uses "Minion engagement".',
  ),
  'bacteriophage-launcher': weapon(
    {
      kind: 'slash',
      base: 20,
      damage: (r) => (8 + r) * (1 + 0.4 * r),
      interval: scaled(3),
      stamina: 25,
      hits: (ctx) => (3 / 0.15) * engaged(ctx),
      reach: 'single',
      minions: (_ctx, _r, rate) => rate * 3,
    },
    'Fires a phage that lives 3s, slashing every 0.15s. Infected enemies that die release more phages (not counted). Uses "Minion engagement".',
  ),
  'mitotic-nidus': {
    // Its "weapon" is whatever it's connected to; the calculator fires those for it.
    weapon: { kind: 'bullet', base: 0, interval: fixed(1), rate: () => 0, stamina: 0, reach: 'single', minions: () => 1 },
    minionGunner: (r) => 0.4 + 0.1 * r,
    notes: 'A minion that fires each connected weapon at 40% (+10% per rarity) of its speed, without stamina. Both organelles\' infusers apply. Uses "Minion engagement".',
  },
  'symbiotic-pseudopod': {
    minionSupport: (r) => 2 + 0.5 * r,
    notes: 'Gives the nearest minion +200% damage (+50% per rarity); spread over all your minions. Its own infusers on the buffed minion are not counted.',
  },
};

// ---------------------------------------------------------------------------
// Everything else: no effect on damage, or not modeled yet (and why).

const none = (notes: string): Behaviour => ({ noDps: true, notes });
const later = (notes: string): Behaviour => ({ notes });

const others: Record<string, Behaviour> = {
  flagellum: none('Movement only.'),
  'chitin-shield': none('Blocks incoming attacks.'),
  'cryptobiotic-core': none('Prevents death once.'),
  endospore: none('Adds max HP.'),
  mutagen: none('Creates DNA pickups.'),
  opulentor: none('Creates core pickups.'),
  ossificator: none('Creates armor pickups.'),
  refiner: none('Upgrades organelles.'),
  regenerator: none('Heals.'),
  'iridophore-membrane': none('Invulnerability.'),
  'sequence-scrambler': none('Rerolls rewards.'),
  'chemoreceptor-antenna': none('Finds secrets.'),
  operculum: later('Active: a shield that reflects enemy shots for 80 (x rarity) damage: depends on enemy fire.'),
  'necrolytic-igniter': later('Active: explodes nearby corpses for 200 (+100 per rarity): depends on kills.'),
};

// ---------------------------------------------------------------------------
// Flagella that attack, and actives that fire your weapons for you
//
// These depend on where enemies are, so each has a fight assumption.

/** player.gd: dodges make you invulnerable for 0.3s; the Pyroflagellum drops a puddle every 0.05s for twice that. */
const PYRO_PUDDLES = Math.round((0.3 * 2) / 0.05);

const positional: Record<string, Behaviour> = {
  pyroflagellum: weapon(
    {
      kind: 'burn',
      base: 7,
      damageMult: (r, c) => (7 + 3 * r + 7 * c) / 7,
      interval: fixed(1),
      // Each puddle lasts 2.5s and burns whoever stands in it once a second.
      rate: (ctx) => ctx.param('dodgeRateAll') * PYRO_PUDDLES * 2.5 * ctx.param('puddleContact'),
      stamina: 0,
      reach: 'area',
      passive: true,
      onFire(_ctx, _self, a) {
        // Burn pools and halves every second, dealing about twice what is added.
        a.dotFactor = 2;
      },
    },
    'Each dodge leaves 12 burning puddles behind you. Each lasts 2.5s and adds 7 burn (+3 per rarity, +7 per Overcharge) to enemies in it once a second; burn deals about twice what is added. Uses "Dodges per second" and "Puddle contact".',
  ),
  'toxic-flagellum': weapon(
    {
      kind: 'splash',
      base: 5,
      damageMult: (r) => (5 + 2 * r) / 5,
      interval: fixed(1),
      // A puddle every 0.3s lasting 3s (+50% per Overcharge), hitting whoever stands in it every 0.5s.
      rate: (ctx, _r, c) => (1 / 0.3) * 3 * (1 + 0.5 * c) * 2 * ctx.param('puddleContact'),
      stamina: 0,
      reach: 'area',
      passive: true,
    },
    'Leaves a toxic puddle every 0.3s. Each lasts 3s (+50% per Overcharge) and hits enemies in it for 5 (+2 per rarity) every 0.5s. Uses "Puddle contact"; puddles grow 50% per rarity, which makes contact easier.',
  ),
  cryoflagellum: weapon(
    {
      kind: 'slash',
      base: 20,
      damageMult: (r) => (20 + 10 * r) / 20,
      interval: fixed(1),
      rate: (ctx) => ctx.param('dodgeRateAll') * ctx.param('nearbyTime'),
      stamina: 0,
      reach: 'area',
      passive: true,
    },
    'Each dodge blasts enemies around your tail for 20 (+10 per rarity) and freezes them (the freeze is not counted). Uses "Dodges per second", and "Enemies next to you" for how often one is caught.',
  ),
  'ballistic-flagellum': weapon(
    {
      kind: 'bullet',
      base: 19,
      damageMult: (r) => (1 + 0.4 * r) * 1.625,
      interval: fixed(1),
      rate: (ctx, r, c) => {
        const every = Math.max(0.02, ((0.1 / 1.5) * Math.max(0.1, 1 - 0.1 * r)) / (1 + 0.3 * c));
        const dodges = ctx.param('dodgeRateAll');
        // A burst of 10 on every dodge, then a stream for at least 0.3s and as long as you sprint.
        const stream = Math.ceil(0.3 / every - 1e-9);
        const sprinting = Math.max(0, ctx.param('sprintTime') - dodges * 0.3);
        return dodges * (10 + stream) + sprinting / every;
      },
      aimParam: 'backHit',
      stamina: 0,
      reach: 'single',
      speed: 7500,
      passive: true,
    },
    'Fires 10 shots behind you on every dodge, then one every 0.067s (10% faster per rarity, 30% per Overcharge) for at least 0.3s and for as long as you sprint. Uses "Dodges per second", "Time sprinting" and "Backward shots on target".',
  ),
  'galvanic-node': weapon(
    {
      kind: 'lightning',
      base: 40,
      damageMult: (r) => (40 + 20 * r) / 40,
      interval: fixed(1),
      energyCost: () => 5,
      // Each beacon arcs to you and to every other beacon 5 times a second while it lives.
      hits: (ctx, r, rate) => {
        const life = 15 + 5 * r;
        return life * 5 * (1 + rate * life) * ctx.param('arcHit');
      },
      stamina: 0,
      reach: 'line',
      passive: true,
    },
    'Active: plants a beacon for every 5 Overcharge-seconds. Each lives 15s (+5s per rarity) and arcs to you and to every other beacon 5 times a second, for 40 (+20 per rarity). "Beacon arcs through target" sets how many arcs cross your target.',
  ),
  'projectile-surge': {
    weapon: { kind: 'bullet', base: 0, interval: fixed(1), energyCost: () => 20, stamina: 0, reach: 'single' },
    volley: { shots: (r) => 30 + 8 * r, aimParam: 'surgeHit' },
    notes:
      'Active: for every 20 Overcharge-seconds, fires each connected weapon 30 times (+8 per rarity) in a ring around you, through its infusers and this organelle\'s. "Surge shots on target" sets how many can reach your target (homing ones always can).',
  },
  'conal-burst': {
    weapon: { kind: 'bullet', base: 0, interval: fixed(1), energyCost: () => 12, stamina: 0, reach: 'single' },
    volley: { shots: (r) => 10 + 4 * r, aimParam: 'coneHit' },
    notes:
      'Active: for every 12 Overcharge-seconds, fires each connected weapon 10 times (+4 per rarity) in a 45° cone toward your aim, through its infusers and this organelle\'s. "Cone shots on target" sets how many can reach your target (homing ones always can).',
  },
};

export const behaviours: Record<string, Behaviour> = { ...weapons, ...infusers, ...weaponInfusers, ...mitochondria, ...minions, ...positional, ...others };

export const EMPTY_BEHAVIOUR: Behaviour = {};

export function behaviourFor(id: string): Behaviour {
  return behaviours[id] ?? EMPTY_BEHAVIOUR;
}

/** True when the calculator knows what the organelle does to damage. */
export function isModeled(id: string): boolean {
  const b = behaviours[id];
  return !!b && !!(b.weapon || b.mito || b.modifyAttack || b.modifyGun || b.staminaRefund || b.chargeCluster || b.minionGunner || b.minionSupport || b.volley || b.golgi || b.conduit || b.noDps);
}

export type { Attack, Ctx, Item };
