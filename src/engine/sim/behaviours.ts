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
      onFire(_ctx, self, a) {
        // Each bolt deals 40% to 120% of its damage at random, after bonuses.
        a.damage *= 0.8;
        a.onHitDamage *= 0.8;
        a.trace.push({ source: self.info.name, text: 'x0.8 on average (random 0.4 to 1.2)' });
      },
    },
    'Each bolt comes up to 0.25s early at random. Arcs that split off to other enemies are not counted.',
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
    notes: 'Arcs go to a different enemy, so this is multi-target only.',
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
  // Effects with nothing to model for damage (or that depend on where things are).
  elastosome: { notes: 'Bounces only add hits on other enemies; not modeled.' },
  extensor: { notes: 'Range only; not modeled.' },
  magnetosome: { notes: 'Pulls projectiles; not modeled.' },
  resilinoplast: { notes: 'Reflected enemy shots depend on enemy fire; not modeled.' },
  toxisome: { notes: 'Toxic trails depend on positioning; not modeled.' },
  'galvanic-weave': { notes: 'Arcs between attacks depend on positioning; not modeled.' },
  'sympathetic-detonator': { notes: 'Explodes attacks when you dash; not modeled.' },
  'golgi-apparatus': { notes: 'Delivering melee strikes through projectiles is not modeled yet.' },
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
  'apex-nidus': later('Minions follow their own AI (attack timing, chasing), which the calculator does not simulate.'),
  'mitotic-nidus': later('Minions follow their own AI, which the calculator does not simulate.'),
  'sentry-nidus': later('Minions follow their own AI, which the calculator does not simulate.'),
  'swarm-nidus': later('Minions follow their own AI, which the calculator does not simulate.'),
  nidublast: later('Shoots minions, which follow their own AI.'),
  'bacteriophage-launcher': later('Shoots multiplying minions, which follow their own AI.'),
  'symbiotic-pseudopod': later('Gives the nearest minion +200% damage (+50% per rarity); minions are not simulated yet.'),
  pyroflagellum: later('Leaves burning puddles (7, +3 per rarity) where you dodge: depends on where enemies walk.'),
  'toxic-flagellum': later('Leaves toxic puddles (5, +2 per rarity) as you move: depends on where enemies walk.'),
  cryoflagellum: later('Freezes enemies near your tail when you dodge (20, +10 per rarity damage): depends on positioning.'),
  'ballistic-flagellum': later('Fires bursts backwards while sprinting: depends on where enemies are.'),
  operculum: later('Active: a shield that reflects enemy shots for 80 (x rarity) damage: depends on enemy fire.'),
  'galvanic-node': later('Active: drops beacons that arc to each other and to you: depends on enemies crossing the arcs.'),
  'projectile-surge': later('Active: fires a ring of 30 (+8 per rarity) shots from each connected weapon: how many hit depends on positioning.'),
  'conal-burst': later('Active: fires 10 (+4 per rarity) shots from each connected weapon in a cone; not modeled yet.'),
  'necrolytic-igniter': later('Active: explodes nearby corpses for 200 (+100 per rarity): depends on kills.'),
};

export const behaviours: Record<string, Behaviour> = { ...weapons, ...infusers, ...weaponInfusers, ...mitochondria, ...others };

export const EMPTY_BEHAVIOUR: Behaviour = {};

export function behaviourFor(id: string): Behaviour {
  return behaviours[id] ?? EMPTY_BEHAVIOUR;
}

/** True when the calculator knows what the organelle does to damage. */
export function isModeled(id: string): boolean {
  const b = behaviours[id];
  return !!b && !!(b.weapon || b.mito || b.modifyAttack || b.modifyGun || b.staminaRefund || b.chargeCluster || b.conduit || b.noDps);
}

export type { Attack, Ctx, Item };
