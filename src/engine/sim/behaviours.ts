// What each organelle does, ported from the game's scripts.
//
// Numbers come from the Pathogenic demo build (January 2026). Where an
// official patch note since then gives an exact new value, that value is
// used instead and marked "patch". `r` is the rarity step: 0 Common,
// 1 Rare, 2 Epic, 3 Legendary, 4 Mythic (plus trait tiers). The demo stops at
// Legendary; Mythic follows the same formulas.

import {
  addDamage,
  announce,
  cloneAttack,
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
/** Default weapon speed scaling: 10% faster per rarity step. */
const scaled = (seconds: number) => (r: number) => Math.max(MIN_INTERVAL, seconds * (1 - 0.1 * r));
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
  // Zaps enemies that come near: charges itself, faster with Overcharge.
  'galvanic-sac': weapon(
    {
      kind: 'lightning',
      base: 20,
      damage: (r) => 25 + 10 * r,
      interval: fixed(1),
      rate: (ctx, r, c) => Math.min(20, (0.5 + 0.1 * r + c) / 0.25) * ctx.param('nearbyTime'),
      stamina: 0,
      reach: 'single',
    },
    'Zaps an enemy touching its field for 0.25 energy; recharges 0.5 (+0.1 per rarity) energy per second plus its Overcharge. Uses "Enemies next to you".',
  ),
  'caustic-secretor': weapon({ kind: 'bullet', base: 6, interval: scaled(0.1), stamina: 0.5, reach: 'single', speed: 3000 }),
  'pulsar-gland': weapon({
    kind: 'bullet',
    base: 30,
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
    stamina: 5,
    shots: (r, c) => 5 + r + Math.round(c * (1 + Math.ceil(r / 2))),
    reach: 'single',
    aimParam: 'pelletHit',
    speed: 9000,
  }),
  'rotary-extruder': weapon(
    { kind: 'bullet', base: 8, damageMult: (r) => 1 + 0.2 * r, interval: scaled(0.04), stamina: 0.9, reach: 'single', speed: 4500, minCharge: 0.97 },
    'Only fires while holding at least ~1 Overcharge.',
  ),
  'lateral-vent': weapon(
    { kind: 'bullet', base: 6, interval: scaled(0.07), stamina: 0.5, shots: () => 2, reach: 'single', aimParam: 'sideHit', speed: 3000 },
    'Fires sideways; the "Sideways shots on target" assumption decides how often they hit.',
  ),
  'spore-cannon': weapon({ kind: 'bullet', base: 90, interval: scaled(1.5), stamina: 8, reach: 'single', speed: 2000 }),
  'pressurized-spicule': weapon({ kind: 'bullet', base: 140, interval: scaled(2.5), stamina: 25, reach: 'single', speed: 6000 }),
  oxidator: weapon(
    { kind: 'bullet', base: 2.5, interval: scaled(0.03), stamina: 0.2, reach: 'line', speed: 2000 },
    'Burn-on-hit was added after the demo (June 2026 patch, amount not published) and is not included.',
  ),
  'cyst-depositor': weapon({ kind: 'bullet', base: 160, interval: scaled(2), stamina: 15, reach: 'single', aimParam: 'mineHit', speed: 100 }),
  cnidocyst: weapon({ kind: 'bullet', base: 50, interval: scaled(2), stamina: 25, reach: 'line', speed: 4000 }, 'Binding enemies to walls is not modeled.'),
  'galvanic-cnidocyst': weapon(
    { kind: 'bullet', base: 30, interval: scaled(2), stamina: 30, reach: 'line', speed: 4000 },
    'Damage sharing between linked enemies is not modeled.',
  ),
  'blastocyst-mortar': weapon(
    { kind: 'bullet', base: 200, interval: scaled(1.7), stamina: 8, reach: 'area', speed: 2500, explodes: true },
    'Explosion damage uses the demo value (200); patches raised it to 280 then 300, so this undercounts.',
  ),
  'dehiscence-lobber': weapon(
    { kind: 'bullet', base: 150, interval: scaled(2.5), stamina: 20, reach: 'area', speed: 6000, explodes: true },
    'Explosion damage uses the demo value (150); patches raised it to 250 then 280, so this undercounts.',
  ),
  'thermal-lance': weapon({ kind: 'beam', base: 45, interval: scaled(1), stamina: 5, reach: 'line' }),
  'galvanic-conduit': weapon(
    { kind: 'beam', base: 20, interval: scaled(0.3), stamina: 0.8, reach: 'line', extraDelay: 0.125 },
    'Arcs that split off to other enemies are not counted.',
  ),
  'mucus-emitter': weapon(
    { kind: 'orb', base: 50, interval: scaled(3.5), stamina: 20, reach: 'area', speed: 200, hits: (ctx) => ctx.param('orbContact') / 0.2 },
    'Ticks every 0.2s while touching an enemy; the "Orb contact time" assumption sets how long.',
  ),
  'lacerator-tendril': weapon({ kind: 'slash', base: 70, interval: scaled(1), stamina: 5, reach: 'area' }),
  'perforator-tendril': weapon({ kind: 'slash', base: 100, interval: scaled(1.4), stamina: 7, reach: 'area' }),
  'stinger-tendril': weapon({ kind: 'slash', base: 20, interval: scaled(0.15), stamina: 2, reach: 'area' }),
  'capsid-flail': weapon({ kind: 'slash', base: 250, interval: scaled(3), stamina: 15, reach: 'area' }),
  'tri-phase-tendril': weapon({ kind: 'slash', base: 30, interval: scaled(0.6), stamina: 6, reach: 'area', combo: true }),
  'helical-proboscis': weapon({ kind: 'slash', base: 40, interval: scaled(0.5), stamina: 5, reach: 'area', spinUp: 0.3 }),
  'gyrase-wheel': weapon(
    { kind: 'slash', base: 30, interval: scaled(0.4), stamina: 1.4, reach: 'area' },
    'Stamina cost from the August 2026 patch (1.4); damage from the demo (raised since, amount not published).',
  ),
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
      addDamage(a, (-0.7 + 0.15 * self.r + c * (1.7 + 0.2 * self.r)) * times, self.info.name);
    },
  },
  phagosome: {
    notes: 'Base damage from the January 2026 patch (-20%). Kill stacks use the "Phagosome kills" assumption at 0.5% each.',
    modifyAttack(ctx, self, a, _chain, times) {
      addDamage(a, (-0.2 + 0.05 * self.r + ctx.param('phagosomeKills') * 0.005) * times, self.info.name);
    },
  },
  'dorsal-lysosome': {
    notes: 'Backstabs happen at the "Backstab chance" assumption. Chainable: passes backstabbing attacks on.',
    modifyAttack(ctx, self, a, chain, times) {
      const p = ctx.param('backstabChance');
      const c = ctx.charge(self);
      const share = (1 + 0.5 * self.r + c * (1 + 0.1 * self.r)) * p * times;
      a.onHitDamage += a.base * share;
      a.trace.push({ source: self.info.name, text: `+${pct((1 + 0.5 * self.r + c * (1 + 0.1 * self.r)))} of base on backstabs (${pct(p)} of hits)` });
      forward(ctx, a, chain, self, times * p);
    },
  },
  'perforin-infuser': {
    notes: 'Formerly Chitin Infuser. Adds its bonus on every enemy hit; on a single target that is the first hit.',
    modifyAttack(ctx, self, a, chain, times) {
      const c = ctx.charge(self);
      const share = (0.2 + 0.2 * self.r) * (1 + c) * times;
      a.reach = a.reach === 'single' ? 'line' : a.reach;
      a.onHitDamage += a.base * share;
      a.trace.push({ source: self.info.name, text: `pierces; +${pct(share)} of base damage on hit` });
      forward(ctx, a, chain, self, times);
    },
  },
  'sinoatrial-node': {
    notes: 'Max bonus from the April 2026 patch (2.0 + 0.7 per rarity). "Beat sync" sets how well you hit the beat.',
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
    notes: 'Damage per second not attacking from the April 2026 patch (0.5 + 0.15 per rarity). Assumes continuous attacking.',
    modifyAttack(ctx, self, a, chain, times) {
      const t = Math.min(5, ctx.gun?.interval ?? 5);
      addDamage(a, (-0.3 + 0.05 * self.r + (0.5 + 0.15 * self.r) * t) * times, self.info.name);
      if (t >= 5) forward(ctx, a, chain, self, times);
    },
  },
  pyrosome: {
    notes: 'Burn pools on the enemy and halves every second, so each application deals about twice its amount. Chainable: modifiers affect the burn.',
    modifyAttack(ctx, self, a, chain, times) {
      const c = ctx.charge(self);
      const amount = 5 + 3 * self.r + c * (4 + 2 * self.r);
      spawnOnHit(a, {
        label: `Burn (${self.info.name})`,
        home: 'same',
        perHit: times,
        derive: () => {
          const burn = newAttack({ kind: 'burn', label: 'Burn', base: amount, dotFactor: 2 });
          burn.trace.push({ source: self.info.name, text: `${amount.toFixed(0)} burn per application, halving each second` });
          forward(ctx, burn, chain, self, 1);
          return burn;
        },
      });
    },
  },
  echosome: {
    notes: 'Splash never hits the enemy that was struck, so it only adds multi-target damage.',
    modifyAttack(ctx, self, a, chain, times) {
      const m = 0.4 + 0.15 * self.r;
      spawnOnHit(a, {
        label: `Splash (${self.info.name})`,
        home: 'others',
        perHit: times,
        derive: (p) => {
          const s = newAttack({ kind: 'splash', label: 'Splash', base: p.base * m, reach: 'area' });
          s.damage = (p.damage + p.onHitDamage) * m;
          announce(ctx, s, self);
          forward(ctx, s, chain, self, 1);
          return s;
        },
      });
    },
  },
  ruptusome: {
    notes: 'Shrapnel flies away from the struck enemy, so it only adds multi-target damage; each shard is assumed to find another enemy half the time. Shard count changed after the demo.',
    modifyAttack(ctx, self, a, chain, times) {
      const c = ctx.charge(self);
      const m = 0.5 + c * (0.3 + 0.1 * self.r);
      const n = 2 + self.r;
      spawnOnHit(a, {
        label: `Shrapnel (${self.info.name})`,
        home: 'others',
        perHit: times * n * 0.5,
        derive: (p) => {
          const s = newAttack({ kind: 'shrapnel', label: 'Shrapnel', base: p.base * m });
          s.damage = (p.damage + p.onHitDamage) * m;
          s.bullet = true;
          announce(ctx, s, self);
          forward(ctx, s, chain, self, 1);
          return s;
        },
      });
    },
  },
  'galvanic-infuser': {
    notes: 'Proc chance and damage from the April 2026 patch. Arcs go to a different enemy, so this is multi-target only.',
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
          announce(ctx, l, self);
          forward(ctx, l, chain, self, 1);
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
      const m = 0.25 + 0.1 * self.r + c * (0.2 + 0.05 * self.r);
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
    notes: 'Freezing deals no damage; chainable on the attacks that freeze.',
    modifyAttack(ctx, self, a, chain, times) {
      const c = ctx.charge(self);
      forward(ctx, a, chain, self, times * Math.min(1, 0.05 + c * (0.05 + 0.01 * self.r)));
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
  // Chainable effects with nothing to model for damage.
  elastosome: { notes: 'Bounces only add hits on other enemies; not modeled.' },
  extensor: { notes: 'Range only; not modeled.' },
  magnetosome: { notes: 'Pulls projectiles; not modeled.' },
  resilinoplast: { notes: 'Reflected enemy shots depend on enemy fire; not modeled.' },
  toxisome: { notes: 'Toxic trails depend on positioning; not modeled.' },
  'galvanic-weave': { notes: 'Arcs between attacks depend on positioning; not modeled.' },
  'sympathetic-detonator': { notes: 'Explodes attacks when you dash; not modeled.' },
  'golgi-apparatus': { notes: 'Delivering melee strikes through projectiles is not modeled yet.' },
};

// ---------------------------------------------------------------------------
// Weapon infusers (attack speed)

const weaponInfusers: Record<string, Behaviour> = {
  'resonant-cavity': {
    weaponModifier: true,
    notes: 'Attack speed per hit halved by the January 2026 patch. "Resonant stacks" sets how close to max stacks you stay; chainable at max.',
    modifyGun(ctx, self, gun, times) {
      const stacks = ctx.param('resonantStacks') * (20 + 6 * self.r);
      const bonus = (0.01 + 0.0025 * self.r) * stacks * times;
      gun.bonus += bonus;
      gun.trace.push({ source: self.info.name, text: `+${pct(bonus)} attack speed` });
    },
    modifyAttack(ctx, self, a, chain, times) {
      if (ctx.param('resonantStacks') >= 1) forward(ctx, a, chain, self, times);
    },
  },
  photoreceptor: {
    weaponModifier: true,
    notes: 'Auto-aim is not modeled; its Overcharge attack speed is.',
    modifyGun(ctx, self, gun, times) {
      const bonus = (0.3 + 0.2 * self.r) * ctx.charge(self) * times;
      if (!bonus) return;
      gun.bonus += bonus;
      gun.trace.push({ source: self.info.name, text: `+${pct(bonus)} attack speed (Overcharge)` });
    },
  },
  'glycogen-synthesizer': {
    weaponModifier: true,
    notes: 'Refunds the stamina cost of weapons whose attacks reach it, and restores stamina while Overcharged.',
    staminaRefund: (r, c) => (20 + 20 * r) * c,
    modifyAttack(ctx, _self, _a, chain) {
      ctx.refund(chain[0]);
    },
  },
};

// ---------------------------------------------------------------------------
// Mitochondria

const halfStep = (r: number) => Math.floor(r / 2);
const odd = (r: number) => r % 2;

const mitochondria: Record<string, Behaviour> = {
  'entrant-mitochondrion': {
    notes: 'Duration from the current wiki text (15s + 5s per rarity); Overcharge 1 at every rarity since April 2026.',
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
    notes: 'Duration from the current wiki text (5s at Common).',
    mito: {
      trigger: 'After dodging through an enemy projectile',
      charge: (r) => 1 + halfStep(r),
      duration: (r) => 5 + 2 * odd(r),
      uptime: (ctx, r) => exp(ctx.param('dodgeRate'), 5 + 2 * odd(r)),
    },
  },
  'metabolic-mitochondrion': {
    notes: 'Duration from the current wiki text (3s + 2s per rarity).',
    mito: {
      trigger: 'After taking a pickup',
      charge: (r) => 1 + halfStep(r),
      duration: (r) => 3 + 2 * r,
      uptime: (ctx, r) => exp(ctx.param('pickupRate'), 3 + 2 * r),
    },
  },
  'pristine-mitochondrion': {
    notes: 'Duration from the current wiki text (40s at Common).',
    mito: {
      trigger: 'After finishing a room without losing HP',
      charge: (r) => 1 + halfStep(r),
      duration: (r) => 40 + 15 * odd(r),
      uptime: (ctx, r) => ctx.param('perfectRooms') * Math.min(1, (40 + 15 * odd(r)) / ctx.param('roomLength')),
    },
  },
  'recuperative-mitochondrion': {
    notes: 'Builds up from hits of connected attacks; usually full while you keep hitting.',
    mito: { trigger: 'While connected attacks keep hitting', charge: () => 1, uptime: () => 0.8 },
  },
  'autophagic-mitochondrion': {
    mito: {
      trigger: 'When you activate it (costs 1 HP)',
      charge: (r) => 2 + halfStep(r),
      duration: (r) => 6 + 2 * odd(r),
      uptime: () => 0,
    },
  },
  vacuole: {
    mito: { trigger: 'When you release stored Overcharge', charge: () => 1, uptime: () => 0 },
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
  'kinetic-pseudopod': none('Pushes enemies away.'),
  cryopulse: none('Freezes enemies and erases projectiles.'),
  cryopseudopod: none('Freezes enemies.'),
  'apex-nidus': later('Minions follow their own AI (attack timing, chasing), which the calculator does not simulate.'),
  'mitotic-nidus': later('Minions follow their own AI, which the calculator does not simulate.'),
  'sentry-nidus': later('Minions follow their own AI, which the calculator does not simulate.'),
  'swarm-nidus': later('Minions follow their own AI, which the calculator does not simulate.'),
  nidublast: later('Shoots minions, which follow their own AI.'),
  'bacteriophage-launcher': later('Shoots multiplying minions, which follow their own AI.'),
  'symbiotic-pseudopod': later('Buffs minions, which are not simulated.'),
  pyroflagellum: later('Burning trail when dodging: depends on where enemies walk.'),
  'toxic-flagellum': later('Toxic trail: depends on where enemies walk.'),
  cryoflagellum: later('Freezes enemies when dodging.'),
  'galvanic-flagellum': later('Arcs when dashing: depends on how often you dash (full-game organelle, numbers unknown).'),
  'ballistic-flagellum': later('Fires backwards while sprinting (full-game organelle, numbers unknown).'),
  'projectile-surge': later('Fires a ring of shots from connected weapons: how many hit depends on positioning.'),
  'necrolytic-igniter': later('Explodes the remains of dead enemies: depends on kills.'),
};

export const behaviours: Record<string, Behaviour> = { ...weapons, ...infusers, ...weaponInfusers, ...mitochondria, ...others };

export const EMPTY_BEHAVIOUR: Behaviour = {};

export function behaviourFor(id: string): Behaviour {
  return behaviours[id] ?? EMPTY_BEHAVIOUR;
}

/** True when the calculator knows what the organelle does to damage. */
export function isModeled(id: string): boolean {
  const b = behaviours[id];
  return !!b && !!(b.weapon || b.mito || b.modifyAttack || b.modifyGun || b.staminaRefund || b.conduit || b.noDps);
}

export type { Attack, Ctx, Item };
