// Core model for simulating one attack through a chain of organelles.
//
// The game creates an attack (a bullet, slash, beam...), then every organelle
// connected to the weapon gets to modify it. Some of those organelles are
// "chainable": they pass the attack (or something it spawned, like a burn) on
// to the organelles connected to *them*, and so on. Nothing is visited twice.
//
// We follow the same flow, but with expected values: a 30% chance to do
// something becomes 0.3 of it.

import type { Body } from '../body';
import type { GraftDef, OrganelleInfo, SlotState, TraitDef } from '../types';

export type AttackKind = 'bullet' | 'beam' | 'slash' | 'orb' | 'explosion' | 'burn' | 'splash' | 'shrapnel' | 'lightning';

/** How an attack reaches enemies other than the one you're aiming at. */
export type Reach =
  /** Hits one enemy. */
  | 'single'
  /** Passes through enemies in a line. */
  | 'line'
  /** Hits everything in an area. */
  | 'area';

export interface TraceLine {
  source: string;
  text: string;
}

export interface Deriver {
  label: string;
  /** Where the spawned attack lands: on the enemy that was hit, or on other enemies only. */
  home: 'same' | 'others';
  /** Expected number spawned per hit. */
  perHit: number;
  /** Builds the spawned attack from the parent's final state (already sent down the chain). */
  derive(parent: Attack): Attack;
}

export interface Attack {
  kind: AttackKind;
  label: string;
  base: number;
  damage: number;
  /** Expected copies per parent trigger. */
  copies: number;
  /** Chance each copy is aimed so it can hit the main target. */
  aim: number;
  /** Spread away from the aim line (split or triple shots): hits the main target only sometimes. */
  angled: boolean;
  /** Homes in on enemies, so angled copies still land. */
  homing: boolean;
  /** Hits each copy lands on its target (orb ticks). */
  hits: number;
  reach: Reach;
  /** Extra damage per hit added at the moment of impact (backstab, pierce bonus). */
  onHitDamage: number;
  onHit: Deriver[];
  /** Copies spawned by splitters: evaluated alongside this attack. */
  siblings: Attack[];
  /** Total damage dealt per point of damage (burn decays by half each second: 2). */
  dotFactor: number;
  bullet: boolean;
  melee: boolean;
  /** px/s, for effects that grow while an attack travels. 0 = instant. */
  speed: number;
  trace: TraceLine[];
}

export function newAttack(p: Partial<Attack> & Pick<Attack, 'kind' | 'label' | 'base'>): Attack {
  return {
    damage: p.base,
    copies: 1,
    aim: 1,
    angled: false,
    homing: false,
    hits: 1,
    reach: 'single',
    onHitDamage: 0,
    onHit: [],
    siblings: [],
    dotFactor: 1,
    bullet: false,
    melee: false,
    speed: 0,
    trace: [],
    ...p,
  };
}

/** Copy of an attack without its siblings (a duplicated bullet). */
export function cloneAttack(a: Attack): Attack {
  return { ...a, onHit: [...a.onHit], siblings: [], trace: [...a.trace] };
}

export function addDamage(a: Attack, share: number, source: string) {
  if (share === 0) return;
  a.damage += a.base * share;
  a.trace.push({ source, text: `${share >= 0 ? '+' : ''}${fmt(share * 100)}% of base damage` });
}

export const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

// ---------------------------------------------------------------------------
// Organelles placed in the build

export interface Item {
  slotId: string;
  pieceType: string;
  info: OrganelleInfo;
  /** Rarity step used in formulas: 0 Common ... 4 Mythic, plus trait tiers. */
  r: number;
  traits: TraitDef[];
  graft?: GraftDef;
  state: SlotState;
  behaviour: Behaviour;
}

export interface GunState {
  /** Sum of attack speed bonuses from weapon infusers: rate x (1 + bonus). */
  bonus: number;
  trace: TraceLine[];
  /** Seconds between this weapon's attacks, for organelles that care. */
  interval: number;
}

export interface Ctx {
  param(id: string): number;
  targets: number;
  /** Overcharge held by an organelle in the current state. */
  charge(item: Item): number;
  neighbours(item: Item): Item[];
  /** Whether the organelle is doing anything (Excitable needs Overcharge). */
  works(item: Item): boolean;
  /** Records that an effect travelled from one slot to another, for the editor's arrows. */
  link(from: Item, to: Item, kind: 'attack' | 'gun' | 'overcharge'): void;
  /** Shares of base damage the game adds to an attack as it's fired (mutations, plasmids, custom bonuses). */
  bonuses(a: Attack, emitter: Item): { source: string; share: number }[];
  gun: GunState | null;
  /** Marks a weapon's stamina as refunded (Glycogen Synthesizer). */
  refund(weapon: Item): void;
  /** Modifier applications left before we stop following chains (dense Vesicle webs explode combinatorially). */
  budget: { left: number; exhausted: boolean };
}

export interface WeaponProfile {
  kind: AttackKind;
  /** Damage of one projectile / slash before rarity. */
  base: number;
  /** Damage multiplier by rarity. Default 1 + 0.4 x rarity. */
  damageMult?: (r: number) => number;
  /** Seconds between attacks at this rarity. */
  interval: (r: number) => number;
  /** Attack speed gained per point of Overcharge. Default 0.3. */
  chargeAttackSpeed?: number;
  /** Stamina per attack. */
  stamina: number;
  /** Projectiles per attack at this rarity and charge. Default 1. */
  shots?: (r: number, charge: number) => number;
  reach: Reach;
  /** Param id giving the chance each projectile can hit the main target. */
  aimParam?: string;
  /** Hits per projectile on its target (lingering orbs). */
  hits?: (ctx: Ctx) => number;
  /** px/s. */
  speed?: number;
  /** Explodes: the explosion deals the shell's full damage in an area and scales with level. */
  explodes?: boolean;
  /** Only fires with at least this much Overcharge. */
  minCharge?: number;
  /** Random extra delay per attack, averaged. */
  extraDelay?: number;
  /** Every third attack deals 3x damage but comes 0.4s later. */
  combo?: boolean;
  /** Spins up: consecutive attacks come up to this much sooner. */
  spinUp?: number;
}

export interface MitoProfile {
  /** Overcharge provided while active. */
  charge: (r: number) => number;
  /** Seconds it stays active after triggering. */
  duration?: (r: number) => number;
  trigger: string;
  /** Estimated share of the fight it's active, from the fight assumptions. */
  uptime: (ctx: Pick<Ctx, 'param'>, r: number) => number;
}

export interface Behaviour {
  weapon?: WeaponProfile;
  mito?: MitoProfile;
  /** Vesicle: passes attacks, weapon effects and Overcharge on. */
  conduit?: boolean;
  /** Changes weapon speed (weapon infusers). */
  weaponModifier?: boolean;
  /** Acts a physics frame later on bullets and beams (splitters), after the other modifiers. */
  deferred?: boolean;
  /** Refunds the stamina of connected weapons (Glycogen Synthesizer). */
  staminaRefund?: (r: number, charge: number) => number;
  modifyAttack?(ctx: Ctx, self: Item, a: Attack, chain: Item[], times: number): void;
  modifyGun?(ctx: Ctx, self: Item, gun: GunState, times: number): void;
  /** How faithfully this organelle is modeled, shown in the UI. */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Passing attacks down the chain

/**
 * Lets every organelle in `receivers` (except those already in the chain)
 * modify the attack. Splitters go last, as they wait a frame in game.
 */
export function applyModifiers(ctx: Ctx, a: Attack, chain: Item[], receivers: Item[], times: number) {
  if (times <= 0 || chain.length > 24) return;
  const live = receivers.filter((r) => !chain.includes(r) && r.behaviour.modifyAttack && ctx.works(r));
  const from = chain[chain.length - 1];
  for (const deferred of [false, true]) {
    for (const m of live) {
      if (!!m.behaviour.deferred !== deferred) continue;
      if (ctx.budget.left-- <= 0) {
        ctx.budget.exhausted = true;
        return;
      }
      ctx.link(from, m, 'attack');
      m.behaviour.modifyAttack!(ctx, m, a, chain, times);
    }
  }
}

/** A chainable organelle passing an attack on to its own connections. */
export function forward(ctx: Ctx, a: Attack, chain: Item[], self: Item, times: number) {
  applyModifiers(ctx, a, [...chain, self], ctx.neighbours(self), times);
}

/** Registers an effect that spawns attacks on hit. */
export function spawnOnHit(a: Attack, d: Deriver) {
  a.onHit.push(d);
}

/** Volatile-slot and run bonuses the game applies to attacks it announces. */
export function announce(ctx: Ctx, a: Attack, emitter: Item) {
  if (emitter.graft?.id === 'volatile') addDamage(a, 0.4, 'Volatile slot');
  for (const b of ctx.bonuses(a, emitter)) addDamage(a, b.share, b.source);
}

// ---------------------------------------------------------------------------
// Turning an attack tree into damage

export interface AttackNode {
  label: string;
  kind: AttackKind;
  base: number;
  damagePerHit: number;
  /** Expected hits on the main target per trigger. */
  hitsOnTarget: number;
  /** Expected hits on other enemies per trigger. */
  hitsOnOthers: number;
  /** Damage per trigger on the main target, including spawned attacks. */
  single: number;
  /** Damage per trigger on all enemies, including spawned attacks. */
  multi: number;
  trace: TraceLine[];
  children: AttackNode[];
}

/**
 * Damage from one attack. `atMain` / `atOthers`: expected instances of this
 * attack landing on the main target / on other enemies.
 */
export function evaluate(ctx: Ctx, a: Attack, atMain: number, atOthers: number, angledHit: number): AttackNode {
  const others = Math.max(0, ctx.targets - 1);
  const spreads = a.reach !== 'single';
  const hitsOnTarget = atMain * a.hits;
  // Aimed at the main target: area/line attacks also reach the others.
  // Landing elsewhere: a single-target attack hits one other enemy, an area one hits all the others.
  const hitsOnOthers = atMain * a.hits * (spreads ? others : 0) + atOthers * a.hits * (spreads ? Math.max(1, others) : 1);
  const perHit = a.damage + a.onHitDamage;
  const node: AttackNode = {
    label: a.label,
    kind: a.kind,
    base: a.base,
    damagePerHit: perHit,
    hitsOnTarget,
    hitsOnOthers,
    single: hitsOnTarget * perHit * a.dotFactor,
    multi: (hitsOnTarget + hitsOnOthers) * perHit * a.dotFactor,
    trace: a.trace,
    children: [],
  };
  for (const d of a.onHit) {
    const child = d.derive(a);
    let childMain = 0;
    let childOthers = 0;
    if (d.home === 'same') {
      childMain = hitsOnTarget * d.perHit;
      childOthers = hitsOnOthers * d.perHit;
    } else if (others > 0) {
      childOthers = (hitsOnTarget + hitsOnOthers) * d.perHit;
    }
    if (childMain + childOthers <= 0) continue;
    const c = evaluate(ctx, child, childMain, childOthers, angledHit);
    c.label = d.label;
    node.children.push(c);
    node.single += c.single;
    node.multi += c.multi;
  }
  return node;
}

/** Evaluates a root attack and its split copies as seen from the weapon. */
export function evaluateRoot(ctx: Ctx, a: Attack, angledHit: number): AttackNode[] {
  const aimed = (x: Attack) => x.copies * x.aim * (x.angled && !x.homing ? angledHit : 1);
  const main = evaluate(ctx, a, aimed(a), 0, angledHit);
  const out = [main];
  for (const s of a.siblings) out.push(...evaluateRoot(ctx, s, angledHit));
  return out;
}

export type { Body };
