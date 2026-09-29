// The DPS calculator.
//
// For every weapon we build its attack, let connected organelles modify it
// (following chains the way the game does, see sim/model.ts), and turn the
// result into damage per second.
//
// Mitochondria are either active or not at any moment. We evaluate every
// on/off combination, weighted by each one's uptime, and average. That keeps
// thresholds exact (the Rotary Extruder only fires with ~1 Overcharge).

import { buildAmoebaBody } from './amoeba';
import { buildBody, buildPlanBody, type Body, type PieceShape } from './body';
import { behaviourFor, isModeled } from './sim/behaviours';
import {
  addDamage,
  announce,
  applyModifiers,
  fmt,
  evaluateRoot,
  newAttack,
  type Attack,
  type AttackNode,
  type Ctx,
  type GunState,
  type Item,
  type TraceLine,
  type WeaponProfile,
} from './sim/model';
import { runModel, type RunLine, type Share } from './run';
import type { BodyPlan, Build, ClassDef, GameData, OrganelleInfo, OrganelleInstance, SlotState, ZoneEffect } from './types';
import { RARITIES } from './types';

export type { AttackNode, TraceLine } from './sim/model';
export type { RunLine } from './run';

const FALLBACK_SHAPE: PieceShape = { sides: 4, centerSlot: 'internal', edgeSlot: 'external' };
const MAX_ENUMERATED_MITOS = 10;
/** Modifier applications per weapon per Overcharge state before we stop following chains. */
const CHAIN_BUDGET = 4000;
const STAMINA_REGEN = 190;
const STAMINA_DELAY = 1;
/** Explosions scale with the level to keep up with enemy health. */
const EXPLOSION_LEVEL_SCALING = 0.75;
const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;
const TICK = 1 / 60;
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** How long a cooldown really takes: the game checks it once per physics tick. */
const tick = (seconds: number) => Math.max(1, Math.ceil(seconds / TICK - 1e-6)) * TICK;
/** Excitable organelles only work at this much Overcharge. */
const EXCITABLE_CHARGE = 0.9;
/** Flagellum thrust (Additive Momentum): round(power x rarity multiplier / 30). */
const FLAGELLUM_POWER: Record<string, number> = { flagellum: 150, pyroflagellum: 75, cryoflagellum: 75, 'toxic-flagellum': 75, 'ballistic-flagellum': 75, 'galvanic-flagellum': 90 };
function thrustOf(item: Item): number {
  const power = FLAGELLUM_POWER[item.info.id];
  if (!power) return 0;
  // Only the plain Flagellum gets stronger with rarity.
  const mult = item.info.id === 'flagellum' ? 1 + 0.6 * item.r : 1;
  // Godot rounds halves away from zero.
  return Math.round((power * mult) / 30 + 1e-9);
}

export interface StateView {
  label: string;
  dps: number;
  multiDps: number;
  attacksPerSecond: number;
  charge: number;
  gunTrace: TraceLine[];
  nodes: AttackNode[];
}

export interface WeaponResult {
  slotId: string;
  info: OrganelleInfo;
  instance: OrganelleInstance;
  /** Single-target DPS averaged over Overcharge states and stamina. */
  dps: number;
  multiDps: number;
  attacksPerSecond: number;
  staminaPerSecond: number;
  /** Breakdowns with no mitochondria active and with all of them active. */
  idle: StateView;
  charged: StateView | null;
  notes: string[];
  excluded: boolean;
}

export interface MitoResult {
  uptime: number;
  estimated: number;
  overridden: boolean;
  charge: number;
  duration?: number;
  trigger: string;
}

export interface ItemResult {
  slotId: string;
  info: OrganelleInfo;
  instance: OrganelleInstance;
  modeled: boolean;
  notes: string[];
  /** Average Overcharge held. */
  charge: number;
  mito?: MitoResult;
  weapon?: WeaponResult;
}

export interface Link {
  from: string;
  to: string;
  /** `fires`: an organelle that fires the weapon itself (Projectile Surge, Golgi Apparatus). */
  kind: 'attack' | 'gun' | 'overcharge' | 'fires';
}

export interface CalcResult {
  body: Body;
  items: Map<string, ItemResult>;
  weapons: WeaponResult[];
  totalDps: number;
  totalMultiDps: number;
  /** Share of time you can keep firing before stamina runs out (averaged). */
  staminaDuty: number;
  maxStamina: number;
  /** What each mutation and plasmid is doing. */
  run: RunLine[];
  links: Link[];
  warnings: string[];
}

export function findClass(data: GameData, classId: string): ClassDef {
  return data.classes.find((c) => c.id === classId) ?? data.classes[0];
}

/**
 * Evolving classes: the starting body, then each evolution picked so far.
 * The last one is the current body; bonuses from earlier ones carry over.
 */
export function evolutionPath(build: Build, data: GameData): BodyPlan[] {
  const cls = findClass(data, build.classId);
  if (cls.body.kind !== 'evolving') return [];
  const { start, tiers } = cls.body;
  const path = [data.bodies[start]];
  tiers.forEach((options, i) => {
    const pick = build.evolutions[i];
    if (pick && options.includes(pick) && data.bodies[pick]) path.push(data.bodies[pick]);
  });
  return path.filter((p) => !!p);
}

/** HP at full health: the pathogen's own plus what its evolutions added. */
export function fullHp(build: Build, data: GameData): number {
  return findClass(data, build.classId).hp + evolutionPath(build, data).reduce((s, p) => s + (p.bonusHp ?? 0), 0);
}

export function bodyFor(build: Build, data: GameData): Body {
  const cls = findClass(data, build.classId);
  if (cls.body.kind === 'evolving') {
    const path = evolutionPath(build, data);
    return buildPlanBody(path[path.length - 1]);
  }
  if (cls.body.kind === 'freeform') return buildAmoebaBody(data.bodies[cls.body.start], build.growth ?? []);
  const shapes = new Map(cls.body.pieceTypes.map((p) => [p.id, p]));
  return buildBody(build.pieces, (t) => shapes.get(t) ?? FALLBACK_SHAPE);
}

/**
 * What a slot holds. A mirrored slot always holds a copy of its twin's
 * organelle (with the twin's settings), but keeps its own graft.
 */
export function slotState(build: Build, body: Body, slotId: string): SlotState | undefined {
  const mirrorOf = body.slotById.get(slotId)?.mirrorOf;
  if (!mirrorOf) return build.slots[slotId];
  const source = build.slots[mirrorOf];
  const own = build.slots[slotId];
  if (!source && !own) return undefined;
  return { ...source, graft: own?.graft };
}

export function calculate(build: Build, data: GameData): CalcResult {
  const cls = findClass(data, build.classId);
  const body = bodyFor(build, data);
  const warnings: string[] = body.errors.map((e) => `Piece ${e.pieceId}: ${e.reason}`);
  const infos = new Map(data.organelles.map((o) => [o.id, o]));
  const traits = new Map(data.traits.map((t) => [t.id, t]));
  const grafts = new Map(data.grafts.map((g) => [g.id, g]));
  const params = new Map(data.params.map((p) => [p.id, p]));
  const param = (id: string) => build.params[id] ?? params.get(id)?.default ?? 0;
  const custom = (kind: string) => build.custom.filter((c) => c.kind === kind);

  // --- Organelles in valid slots ---------------------------------------------
  const items = new Map<string, Item>();
  for (const slot of body.slots) {
    const state = slotState(build, body, slot.id);
    if (!state?.organelle) continue;
    const info = infos.get(state.organelle.id);
    if (!info) {
      warnings.push(`Unknown organelle "${state.organelle.id}" in slot ${slot.id}`);
      continue;
    }
    // A graft replaces a special slot built into the body.
    const graftId = state.graft ?? slot.special;
    const graft = graftId ? grafts.get(graftId as 'volatile') : undefined;
    const accepts = graft?.id === 'omni' ? ['internal', 'external'] : [slot.kind];
    if (!accepts.includes(info.slot)) {
      warnings.push(`${info.name} is ${info.slot} but slot ${slot.id} is ${slot.kind}`);
      continue;
    }
    const itemTraits = state.organelle.traits.map((t) => traits.get(t)).filter((t) => !!t);
    const rarityIndex = Math.max(0, RARITIES.indexOf(state.organelle.rarity));
    items.set(slot.id, {
      slotId: slot.id,
      pieceType: slot.pieceType,
      info,
      r: rarityIndex + itemTraits.reduce((s, t) => s + t.tiers, 0),
      traits: itemTraits,
      graft,
      state,
      behaviour: behaviourFor(info.id),
    });
  }
  const neighbourMap = new Map<Item, Item[]>();
  for (const item of items.values()) {
    neighbourMap.set(item, (body.connections.get(item.slotId) ?? []).map((id) => items.get(id)).filter((i): i is Item => !!i));
  }
  const neighbours = (item: Item) => neighbourMap.get(item) ?? [];

  // --- Mutations, plasmids and run state -------------------------------------------
  const run = runModel(build, data, cls, {
    cores: Math.max(0, param('cores')),
    hp: build.params.hp ?? fullHp(build, data),
    bossesBeaten: Math.max(0, param('bossesBeaten')),
    // The game counts every gun on the body (mirrored copies too); actives and pseudopods aren't guns.
    weapons: [...items.values()].filter((i) => i.info.category === 'weapon').length,
    emptyInternal: body.slots.filter((sl) => sl.kind === 'internal' && !items.has(sl.id)).length,
    pseudopods: [...items.values()].filter(
      (i) => i.info.category === 'pseudopod' && (i.info.id !== 'symbiotic-pseudopod' || [...items.values()].some((m) => m.info.category === 'minion')),
    ).length,
    thrust: [...items.values()].reduce((s, i) => s + thrustOf(i), 0),
    frozenTime: Math.min(1, Math.max(0, param('frozenTime'))),
    minionHitRate: Math.max(0, param('minionHitRate')),
  });
  warnings.push(...run.warnings);
  const evolutionStamina = 100 * evolutionPath(build, data).reduce((s, p) => s + (p.bonusStamina ?? 0), 0);
  const maxStamina = Math.max(1, param('maxStamina') + run.extraStamina + evolutionStamina);
  /** Whether an organelle's slot is in a part of the body (measured from the body's centre, front up). */
  const inZone = (item: Item, side: ZoneEffect['side'], threshold: number) => {
    const at = body.slotById.get(item.slotId)?.position ?? body.frame.center;
    const { center, scale } = body.frame;
    const p = { x: (at.x - center.x) * scale, y: (at.y - center.y) * scale };
    const along = side === 'left' ? -p.x : side === 'right' ? p.x : side === 'top' ? -p.y : p.y;
    return along > threshold;
  };

  // --- Overcharge ----------------------------------------------------------------
  const overchargeBonus = custom('overchargeStrength').reduce((s, c) => s + c.value, 0);
  const activeCostCut = (item: Item) =>
    run.activeCost + run.zones.reduce((s, z) => (z.activeCost && inZone(item, z.side, z.threshold) ? s + z.activeCost : s), 0);
  const generatorBonus = (item: Item) =>
    run.generatorStrength +
    run.zones.reduce((s, z) => (z.generatorStrength && inZone(item, z.side, z.threshold) ? s + z.generatorStrength : s), 0);
  const isActive = (item: Item) => !!item.behaviour.weapon?.energyCost;
  const strength = (item: Item) =>
    (item.graft?.id === 'conductive' ? 0.4 : 0) +
    overchargeBonus +
    (item.behaviour.mito || item.behaviour.conduit ? generatorBonus(item) : 0) +
    (isActive(item) ? run.activeCharge + run.zones.reduce((s, z) => (z.activeCharge && inZone(item, z.side, z.threshold) ? s + z.activeCharge : s), 0) : 0);
  const mitos = [...items.values()].filter((i) => i.behaviour.mito);
  const mitoResults = new Map<Item, MitoResult>();
  for (const m of mitos) {
    const p = m.behaviour.mito!;
    const estimated = Math.min(1, Math.max(0, p.uptime({ param }, m.r)));
    const overridden = m.state.uptime !== undefined;
    mitoResults.set(m, {
      uptime: overridden ? Math.min(1, Math.max(0, m.state.uptime!)) : estimated,
      estimated,
      overridden,
      charge: p.charge(m.r),
      duration: p.duration?.(m.r),
      trigger: p.trigger,
    });
  }

  /** Overcharge held by every organelle when each mitochondrion is at `activity` (0..1). */
  function chargesFor(activity: Map<Item, number>): Map<Item, number> {
    const provided = new Map<Item, number>();
    for (const m of mitos) provided.set(m, (activity.get(m) ?? 0) * mitoResults.get(m)!.charge);
    const incoming = (x: Item) =>
      neighbours(x).reduce((s, n) => s + (provided.get(n) ?? 0) * (1 + strength(n) + strength(x)), 0);
    // Vesicles pass on up to what their non-Vesicle neighbours provide.
    const conduits = [...items.values()].filter((i) => i.behaviour.conduit);
    for (let pass = 0; pass < 2; pass++) {
      for (const v of conduits) {
        const cap = neighbours(v)
          .filter((n) => !n.behaviour.conduit)
          .reduce((s, n) => s + (provided.get(n) ?? 0), 0);
        provided.set(v, Math.min(cap, incoming(v)));
      }
    }
    const charges = new Map<Item, number>();
    // Basal Metabolism: actives also get some Overcharge of their own, which their own bonuses scale.
    for (const item of items.values()) charges.set(item, incoming(item) + (isActive(item) ? run.activeFlatCharge * (1 + strength(item)) : 0));
    return charges;
  }

  // Which on/off combinations to evaluate.
  const states: { activity: Map<Item, number>; p: number }[] = [];
  if (mitos.length <= MAX_ENUMERATED_MITOS) {
    for (let mask = 0; mask < 1 << mitos.length; mask++) {
      let p = 1;
      const activity = new Map<Item, number>();
      mitos.forEach((m, i) => {
        const on = (mask >> i) & 1;
        const u = mitoResults.get(m)!.uptime;
        p *= on ? u : 1 - u;
        activity.set(m, on);
      });
      if (p > 0) states.push({ activity, p });
    }
  } else {
    warnings.push(`More than ${MAX_ENUMERATED_MITOS} mitochondria: Overcharge is averaged instead of evaluated per combination.`);
    states.push({ activity: new Map(mitos.map((m) => [m, mitoResults.get(m)!.uptime])), p: 1 });
  }

  // --- Evaluating a state ----------------------------------------------------------
  const linkSet = new Map<string, Link>();
  const chainsCut = new Set<string>();
  const runDamage = run.damage.reduce((s, d) => s + d.share, 0);
  const evolutionDamage = evolutionPath(build, data).reduce((s, p) => s + (p.bonusDamage ?? 0), 0);
  const fixedShares: Share[] = [
    { source: 'Evolutions', share: evolutionDamage },
    { source: 'Mutations and plasmids', share: runDamage },
    { source: 'Extra bonuses', share: custom('damage').reduce((s, c) => s + c.value, 0) },
  ].filter((b) => Math.abs(b.share) > 1e-9);
  const damageMult = custom('damageMult').reduce((p, c) => p * c.value, 1) * run.damageMultiplier;
  const speedShares: Share[] = [...run.attackSpeed, { source: 'Extra bonuses', share: custom('attackSpeed').reduce((s, c) => s + c.value, 0) }].filter(
    (b) => Math.abs(b.share) > 1e-9,
  );
  const weaponItems = [...items.values()].filter((i) => i.behaviour.weapon);

  /** The attack as it lands: an explosive shell hands its damage to an explosion, which re-runs on-hit effects. */
  function landed(prof: WeaponProfile, root: Attack): Attack {
    if (!prof.explodes) return root;
    const level = Math.max(1, param('level'));
    const scale = 1 + (level - 1) * EXPLOSION_LEVEL_SCALING;
    const attack: Attack = { ...root, kind: 'explosion', label: `${root.label} explosion`, reach: 'area', damage: root.damage * scale, onHitDamage: 0 };
    attack.onHit = root.onHit.map((d) => ({ ...d, perHit: d.perHit * 2 }));
    attack.trace = [...root.trace, ...(scale !== 1 ? [{ source: 'Level', text: `x${scale.toFixed(2)} explosion damage` }] : [])];
    return attack;
  }

  interface WeaponEval {
    single: number;
    multi: number;
    rate: number;
    stamina: number;
    /** Fired with the attack button (guns, held beams), so it stops while stamina refills. Minions, passives and actives don't. */
    gated: boolean;
    nodes: AttackNode[];
    gunTrace: TraceLine[];
    charge: number;
  }

  function evaluateState(activity: Map<Item, number>, recordLinks: boolean) {
    const charges = chargesFor(activity);
    const activeMitos = mitos.reduce((s, m) => s + (activity.get(m) ?? 0), 0);
    if (recordLinks) {
      for (const m of mitos) {
        if (!activity.get(m)) continue;
        for (const n of neighbours(m)) {
          if (!n.behaviour.mito && isModeled(n.info.id)) linkSet.set(`overcharge:${m.slotId}>${n.slotId}`, { from: m.slotId, to: n.slotId, kind: 'overcharge' });
        }
      }
    }
    const first = fire(charges, activeMitos, 0, recordLinks);
    // Starvation Reflex: while firing, stamina drains from full to empty, so on average half of it is missing.
    const starving = run.starvation.length && first.use > 0 ? maxStamina / 2 / 100 : 0;
    const { results, use, refunded } = starving ? fire(charges, activeMitos, starving, false) : first;
    let duty = 1;
    if (param('staminaLimits') && use > 0) {
      const firing = maxStamina / use;
      duty = firing / (firing + STAMINA_DELAY + maxStamina / STAMINA_REGEN);
    }
    return { results, duty, charges, refunded };
  }

  /** Fires every weapon once in an Overcharge state. `starving`: hundreds of stamina missing. */
  function fire(charges: Map<Item, number>, activeMitos: number, starving: number, recordLinks: boolean) {
    const refunded = new Set<Item>();
    /** Golgi Apparatus: attacks reaching each one per second, and how many of those land on the target. */
    const triggers = new Map<Item, { rate: number; aimed: number }>();
    /** Bonuses the game adds to an attack it announces; `emitter` is the organelle it comes from, if any. */
    const bonuses = (a: Attack, emitter?: Item): Share[] => {
      const out = [...fixedShares];
      if (a.melee) out.push(...run.meleeDamage);
      for (const z of emitter ? run.zones : []) {
        if (z.meleeOnly && !a.melee) continue;
        const share = inZone(emitter!, z.side, z.threshold) ? z.damage : inZone(emitter!, OPPOSITE[z.side], z.threshold) ? z.opposite : 0;
        if (share) out.push({ source: z.source, share });
      }
      if (activeMitos) for (const b of run.perActiveMito) out.push({ source: b.source, share: b.share * activeMitos });
      if (starving) for (const b of run.starvation) out.push({ source: b.source, share: b.share * starving });
      return out;
    };
    const ctx: Ctx = {
      param,
      targets: Math.max(1, Math.floor(build.targets)),
      charge: (i) => charges.get(i) ?? 0,
      neighbours,
      works: (i) => !i.traits.some((t) => t.requiresCharge) || (charges.get(i) ?? 0) >= EXCITABLE_CHARGE - 1e-9,
      link: (from, to, kind) => {
        if (recordLinks) linkSet.set(`${kind}:${from.slotId}>${to.slotId}`, { from: from.slotId, to: to.slotId, kind });
      },
      bonuses,
      gun: null,
      refund: (w) => refunded.add(w),
      lightningSplit: run.lightningSplit,
      trigger: (golgi, perSecond, aim) => {
        const t = triggers.get(golgi) ?? { rate: 0, aimed: 0 };
        t.rate += perSecond;
        t.aimed += perSecond * aim;
        triggers.set(golgi, t);
      },
      budget: { left: CHAIN_BUDGET, exhausted: false },
    };

    /** Mitotic Nidus: its minion fires each connected weapon at a share of its base speed, without stamina. */
    function fireAsMinion(ctx: Ctx, nidus: Item): WeaponEval {
      const share = nidus.behaviour.minionGunner!(nidus.r);
      const guns = neighbours(nidus).filter((g) => g.info.category === 'weapon' && g.behaviour.weapon && !g.behaviour.weapon.rate && !g.behaviour.weapon.energyCost && ctx.works(g));
      const trace: TraceLine[] = [{ source: nidus.info.name, text: `fires ${guns.length ? guns.map((g) => g.info.name).join(', ') : 'nothing: connect weapons to it'} at ${pct(share)} speed` }];
      const nodes: AttackNode[] = [];
      let single = 0;
      let multi = 0;
      let rate = 0;
      for (const g of guns) {
        const prof = g.behaviour.weapon!;
        const cg = ctx.charge(g);
        // The minion tries to fire about every 0.05s once a weapon's own (rarity-only) cooldown has passed.
        const r = (1 / (prof.interval(g.r) / share + 0.025)) * param('minionEngagement');
        const shots = prof.shots ? prof.shots(g.r, cg) : 1;
        const mult = prof.damageMult ? prof.damageMult(g.r, cg) : 1 + 0.4 * g.r;
        const a = newAttack({
          kind: prof.kind,
          label: `${g.info.name} (minion)`,
          base: prof.base * mult,
          copies: shots,
          aim: prof.aimParam ? param(prof.aimParam) : 1,
          hits: prof.hits ? prof.hits(ctx, g.r, r) : 1,
          reach: prof.reach,
          bullet: prof.kind === 'bullet',
          melee: prof.kind === 'slash',
          speed: prof.speed ?? 0,
        });
        if (prof.damage) {
          a.base = prof.base;
          a.damage = prof.damage(g.r);
        }
        ctx.gun = { bonus: 0, mult: 1, trace: [], interval: 1 / r, weapon: g };
        ctx.budget = { left: CHAIN_BUDGET, exhausted: false };
        announce(ctx, a, g);
        applyModifiers(ctx, a, [g], neighbours(g), 1);
        applyModifiers(ctx, a, [nidus], neighbours(nidus), 1);
        prof.onFire?.(ctx, g, a, cg);
        ctx.link(g, nidus, 'attack');
        const n = evaluateRoot(ctx, a, param('angledHit'));
        nodes.push(...n);
        single += n.reduce((s, x) => s + x.single, 0) * r * damageMult;
        multi += n.reduce((s, x) => s + x.multi, 0) * r * damageMult;
        rate += r;
        ctx.gun = null;
      }
      return { single, multi, rate, stamina: 0, gated: false, nodes, gunTrace: trace, charge: ctx.charge(nidus) };
    }

    /**
     * Projectile Surge, Conal Burst: each use fires every connected weapon a
     * number of times from the organelle, through the weapon's infusers and
     * then the organelle's, with no stamina or cooldown.
     */
    function fireVolley(ctx: Ctx, burst: Item, uses: number, trace: TraceLine[]): WeaponEval {
      const v = burst.behaviour.volley!;
      const times = v.shots(burst.r);
      const share = param(v.aimParam);
      const guns = neighbours(burst).filter((g) => g.info.category === 'weapon' && g.behaviour.weapon && ctx.works(g));
      trace.push({
        source: burst.info.name,
        text: guns.length ? `fires ${guns.map((g) => g.info.name).join(', ')} ${times} times per use; ${pct(share)} of shots can reach the target` : 'fires nothing: connect weapons to it',
      });
      const nodes: AttackNode[] = [];
      let single = 0;
      let multi = 0;
      for (const g of guns) {
        const prof = g.behaviour.weapon!;
        const cg = ctx.charge(g);
        const shots = times * (prof.shots ? prof.shots(g.r, cg) : 1);
        const mult = prof.damageMult ? prof.damageMult(g.r, cg) : 1 + 0.4 * g.r;
        const aim = prof.aimParam ? param(prof.aimParam) : 1;
        ctx.gun = { bonus: 0, mult: 1, trace: [], interval: 1 / uses, weapon: g };
        ctx.budget = { left: CHAIN_BUDGET, exhausted: false };
        const a = newAttack({
          kind: prof.kind,
          label: `${g.info.name} x${fmt(shots)} (${burst.info.name})`,
          base: prof.base * mult,
          copies: shots,
          aim: aim * share,
          // Minions it spawns live twice as long.
          hits: (prof.hits ? prof.hits(ctx, g.r, uses) : 1) * (prof.minions ? 2 : 1),
          reach: prof.reach,
          scattered: true,
          bullet: prof.kind === 'bullet',
          melee: prof.kind === 'slash',
          speed: prof.speed ?? 0,
        });
        if (prof.damage) {
          a.base = prof.base;
          a.damage = prof.damage(g.r);
        }
        announce(ctx, a, g);
        applyModifiers(ctx, a, [g], neighbours(g), 1);
        applyModifiers(ctx, a, [burst], neighbours(burst), 1);
        prof.onFire?.(ctx, g, a, cg);
        // Homing shots find the target wherever they're fired.
        const home = (x: Attack) => {
          if (x.homing) x.aim = aim;
          x.siblings.forEach(home);
        };
        home(a);
        ctx.link(burst, g, 'fires');
        const n = evaluateRoot(ctx, landed(prof, a), param('angledHit'));
        nodes.push(...n);
        single += n.reduce((s, x) => s + x.single, 0) * uses * damageMult;
        multi += n.reduce((s, x) => s + x.multi, 0) * uses * damageMult;
        if (ctx.budget.exhausted) chainsCut.add(burst.info.name);
        ctx.gun = null;
      }
      return { single, multi, rate: uses, stamina: 0, gated: false, nodes, gunTrace: trace, charge: ctx.charge(burst) };
    }

    // Golgi Apparatus: connected melee weapons strike only when other attacks
    // reach it, so they're worked out after everything else.
    const controlledBy = new Map<Item, Item[]>();
    for (const g of items.values()) {
      if (!g.behaviour.golgi || !ctx.works(g)) continue;
      for (const n of neighbours(g)) {
        if (n.info.category === 'weapon' && n.info.subtype === 'melee' && n.behaviour.weapon) controlledBy.set(n, [...(controlledBy.get(n) ?? []), g]);
      }
    }
    /** Triggers per second each Golgi Apparatus has left to hand out. */
    const golgiLeft = new Map<Item, number>();

    const results = new Map<Item, WeaponEval>();
    for (const w of [...weaponItems.filter((x) => !controlledBy.has(x)), ...weaponItems.filter((x) => controlledBy.has(x))]) {
      const prof = w.behaviour.weapon!;
      const c = ctx.charge(w);
      const zero: WeaponEval = { single: 0, multi: 0, rate: 0, stamina: 0, gated: false, nodes: [], gunTrace: [], charge: c };
      if (w.behaviour.minionGunner) {
        results.set(w, ctx.works(w) ? fireAsMinion(ctx, w) : zero);
        continue;
      }
      if (!ctx.works(w) || (prof.minCharge && c < prof.minCharge)) {
        results.set(w, zero);
        continue;
      }
      const gun: GunState = { bonus: 0, mult: 1, trace: [], interval: 0, weapon: w };
      const selfTimed = !!(prof.energyCost || prof.rate);
      let rate = 0;
      let comboMult = 1;
      if (prof.energyCost) {
        // Actives build energy from Overcharge and fire when full.
        const cost = prof.energyCost(w.r) * Math.max(0.1, 1 - activeCostCut(w));
        rate = c / cost;
        gun.trace.push({ source: w.info.name, text: `uses ${fmt(cost)} Overcharge-seconds per activation` });
      } else if (prof.rate) {
        rate = prof.rate(ctx, w.r, c, w);
      }
      if (selfTimed && rate <= 0) {
        results.set(w, zero);
        continue;
      }
      if (w.behaviour.volley) {
        results.set(w, fireVolley(ctx, w, rate, gun.trace));
        continue;
      }
      const golgis = controlledBy.get(w);
      // Exocytotic Chamber: charges up instead of firing.
      const chamber = selfTimed || golgis ? undefined : neighbours(w).find((n) => n.behaviour.chargeCluster && ctx.works(n));
      // Attack speed: weapon infusers add up, Overcharge multiplies.
      for (const b of selfTimed || chamber ? [] : speedShares) {
        gun.bonus += b.share;
        gun.trace.push({ source: b.source, text: `${b.share >= 0 ? '+' : ''}${Math.round(b.share * 100)}% attack speed` });
      }
      for (const n of selfTimed || chamber ? [] : neighbours(w)) {
        if (n.behaviour.modifyGun && ctx.works(n)) {
          const before = gun.trace.length;
          n.behaviour.modifyGun(ctx, n, gun, 1);
          if (gun.trace.length > before) ctx.link(n, w, 'gun');
        }
      }
      const chargeSpeed = selfTimed || chamber ? 0 : (prof.chargeAttackSpeed ?? 0.3) * c;
      if (chargeSpeed) gun.trace.push({ source: 'Overcharge', text: `x${(1 + chargeSpeed).toFixed(2)} attack speed` });
      // The game checks each weapon once per physics tick (60 a second), so cooldowns round up to whole ticks.
      const cooldown = prof.interval(w.r) / ((1 + chargeSpeed) * (1 + gun.bonus) * gun.mult);
      let interval = tick(cooldown);
      if (prof.spinUp) interval = tick(cooldown - prof.spinUp * Math.max(0.1, 1 - 0.1 * w.r));
      if (prof.randomAdvance) {
        // The next attack comes a random 0..randomAdvance seconds sooner.
        const n = 40;
        let sum = 0;
        for (let i = 0; i < n; i++) sum += tick(cooldown - (prof.randomAdvance * (i + 0.5)) / n);
        interval = sum / n;
      }
      if (!selfTimed && Math.abs(interval - cooldown) > 1e-4) {
        gun.trace.push({ source: 'Physics ticks', text: `${fmt(cooldown * 1000)}ms cooldown fires every ${fmt(interval * 1000)}ms` });
      }
      if (!selfTimed) rate = 1 / interval;
      if (prof.combo) {
        // Hits 1 and 2 normal, hit 3 deals 3x and comes 0.4s later.
        rate = 3 / (2 * interval + tick(cooldown + 0.4));
        comboMult = 5 / 3;
        gun.trace.push({ source: w.info.name, text: 'every 3rd strike deals 3x damage, 0.4s later' });
      }
      // Golgi Apparatus: strike only when attacks reach it, as often as the cooldown allows.
      const strikes: { golgi: Item; rate: number; aim: number }[] = [];
      if (golgis) {
        let room = rate;
        for (const g of golgis) {
          const t = triggers.get(g) ?? { rate: 0, aimed: 0 };
          const left = golgiLeft.get(g) ?? t.rate;
          const take = Math.min(left, room);
          golgiLeft.set(g, left - take);
          room -= take;
          if (take > 0) strikes.push({ golgi: g, rate: take, aim: t.aimed / t.rate });
          ctx.link(g, w, 'fires');
        }
        const total = strikes.reduce((s, x) => s + x.rate, 0);
        gun.trace.push({ source: golgis[0].info.name, text: `strikes ${fmt(total)}/s, when other attacks reach it (its cooldown allows ${fmt(rate)}/s)` });
        rate = total;
        if (rate <= 0) {
          results.set(w, { ...zero, gunTrace: gun.trace });
          continue;
        }
      }
      gun.interval = 1 / rate;
      ctx.gun = gun;
      ctx.budget = { left: CHAIN_BUDGET, exhausted: false };

      const shots = prof.shots ? prof.shots(w.r, c) : 1;
      const mult = prof.damageMult ? prof.damageMult(w.r, c) : 1 + 0.4 * w.r;
      const base = prof.base * mult;
      const makeRoot = (copies: number, label: string) => {
        const a: Attack = newAttack({
          kind: prof.kind,
          label,
          base,
          copies,
          aim: prof.aimParam ? param(prof.aimParam) : 1,
          hits: prof.hits ? prof.hits(ctx, w.r, rate) : 1,
          reach: prof.reach,
          bullet: prof.kind === 'bullet',
          melee: prof.kind === 'slash',
          speed: prof.speed ?? 0,
        });
        if (prof.damage) {
          // The organelle sets the damage itself; bonuses still scale off the attack's own base damage.
          a.base = prof.base;
          a.damage = prof.damage(w.r);
          a.trace.push({ source: w.info.name, text: `${fmt(a.damage)} damage (bonuses use its base damage, ${prof.base})` });
        } else {
          a.trace.push({ source: w.info.name, text: `${prof.base} base x${mult.toFixed(2)} = ${fmt(base)}` });
        }
        return a;
      };

      let attacks: Attack[];
      let stamina = prof.stamina * rate;
      if (chamber) {
        const cc = chamber.behaviour.chargeCluster!;
        const cCh = ctx.charge(chamber);
        const cd = prof.interval(w.r);
        const perCall = prof.shots ? prof.shots(w.r, c) : 1;
        const baseShots = prof.shots ? prof.shots(w.r, 0) : 1;
        const total = cc.maxTime * ((base * baseShots) / cd) * cc.mult;
        const n = Math.min(15, Math.max(1, Math.floor((cc.maxTime / cd) * cc.burst(chamber.r) * 2)));
        // Charge to full, let go, fire the cluster, hold again.
        const cycle = cc.maxTime / (1 + cc.speedPerCharge * cCh) + 2 / 60;
        rate = 1 / cycle;
        gun.interval = cycle;
        stamina = (prof.stamina / cd) * ((cycle - 2 / 60) / cycle);
        gun.trace.push({ source: chamber.info.name, text: `charges ${fmt(cycle)}s, then fires ${n} shots worth ${fmt(total)} in all` });
        ctx.link(chamber, w, 'gun');
        const cluster = makeRoot(n, `${w.info.name} cluster x${n}`);
        applyModifiers(ctx, cluster, [w], neighbours(w), 1);
        // The chamber sets each shot's damage after the weapon's own infusers, then the game adds its bonuses.
        cluster.damage = total / n;
        cluster.trace.push({ source: chamber.info.name, text: `${fmt(total / n)} damage per shot, replacing infuser damage` });
        announce(ctx, cluster, w);
        applyModifiers(ctx, cluster, [w, chamber], neighbours(chamber), 1);
        attacks = [cluster];
        if (perCall > 1) {
          // Multi-projectile weapons fire their other projectiles as normal.
          const rest = makeRoot(n * (perCall - 1), `${w.info.name} other projectiles x${n * (perCall - 1)}`);
          announce(ctx, rest, w);
          applyModifiers(ctx, rest, [w], neighbours(w), 1);
          attacks.push(rest);
        }
      } else if (strikes.length) {
        // Each strike lands where the attack that set it off hit: on the target as often as that attack.
        attacks = strikes.map((s) => {
          const root = makeRoot((shots * s.rate) / rate, `${w.info.name} (${s.golgi.info.name})`);
          root.aim *= s.aim;
          announce(ctx, root, w);
          // Its own strikes don't set the Golgi Apparatus off again.
          applyModifiers(ctx, root, [w], neighbours(w).filter((n) => !golgis!.includes(n)), 1);
          addDamage(root, s.golgi.behaviour.golgi!.damage(s.golgi.r), s.golgi.info.name);
          applyModifiers(ctx, root, [w, s.golgi], neighbours(s.golgi), 1);
          return root;
        });
      } else {
        const root = makeRoot(shots, `${w.info.name}${shots !== 1 ? ` x${Number(shots.toFixed(2))}` : ''}`);
        announce(ctx, root, w);
        applyModifiers(ctx, root, [w], neighbours(w), 1);
        attacks = [root];
      }
      for (const a of attacks) prof.onFire?.(ctx, w, a, c);

      const nodes: AttackNode[] = [];
      for (const root of attacks) {
        const attack = landed(prof, root);
        if (comboMult !== 1) {
          attack.damage *= comboMult;
          attack.onHitDamage *= comboMult;
        }
        nodes.push(...evaluateRoot(ctx, attack, param('angledHit')));
      }
      const single = nodes.reduce((s, n) => s + n.single, 0) * rate * damageMult;
      const multi = nodes.reduce((s, n) => s + n.multi, 0) * rate * damageMult;
      if (ctx.budget.exhausted) chainsCut.add(w.info.name);
      results.set(w, { single, multi, rate, stamina: run.noStamina ? 0 : stamina, gated: !selfTimed || prof.stamina > 0, nodes, gunTrace: gun.trace, charge: c });
      ctx.gun = null;
    }

    // Symbiotic Pseudopod: each one buffs the minion nearest to it, so the buff is spread over all minions alive.
    const supporters = [...items.values()].filter((i) => i.behaviour.minionSupport && ctx.works(i));
    if (supporters.length) {
      const minionWeapons = weaponItems.filter((w) => w.behaviour.weapon!.minions && results.get(w)!.rate > 0);
      const alive = minionWeapons.reduce((s, w) => s + w.behaviour.weapon!.minions!(ctx, w.r, results.get(w)!.rate), 0);
      if (alive > 0) {
        const bonus = supporters.reduce((s, i) => s + i.behaviour.minionSupport!(i.r), 0) / supporters.length;
        const mult = 1 + bonus * Math.min(1, supporters.length / alive);
        for (const w of minionWeapons) {
          const r = results.get(w)!;
          r.single *= mult;
          r.multi *= mult;
          r.gunTrace.push({ source: supporters[0].info.name, text: `x${mult.toFixed(2)} minion damage (${fmt(alive)} minions share the buff)` });
          for (const s of supporters) ctx.link(s, w, 'attack');
        }
      }
    }

    // Nidal Degranulation: every minion releases a splash when it's hit, counted with the organelle that spawns it.
    const splash = run.minionHitSplash.reduce((s, x) => s + x.damage, 0);
    const minionHitRate = Math.max(0, param('minionHitRate'));
    if (splash > 0 && minionHitRate > 0) {
      for (const w of weaponItems) {
        const r = results.get(w)!;
        const minions = w.behaviour.weapon!.minions;
        if (!minions || r.rate <= 0) continue;
        const alive = minions(ctx, w.r, r.rate);
        const perSecond = alive * minionHitRate;
        const a = newAttack({ kind: 'splash', label: 'Degranulation splash', base: splash, reach: 'area' });
        for (const b of bonuses(a)) addDamage(a, b.share, b.source);
        const n = evaluateRoot(ctx, a, param('angledHit'));
        r.nodes.push(...n);
        r.single += n.reduce((s, x) => s + x.single, 0) * perSecond * damageMult;
        r.multi += n.reduce((s, x) => s + x.multi, 0) * perSecond * damageMult;
        r.gunTrace.push({ source: run.minionHitSplash[0].source, text: `${fmt(perSecond)} splashes a second (${fmt(alive)} minions hit ${fmt(minionHitRate)} times a second each)` });
      }
    }

    // Stamina: all weapons fire together and share one pool.
    let use = 0;
    for (const w of weaponItems) {
      // Excluded weapons still fire (they just miss), so they still use stamina.
      if (refunded.has(w)) continue;
      use += results.get(w)!.stamina;
    }
    for (const g of items.values()) {
      if (g.behaviour.staminaRefund) use -= g.behaviour.staminaRefund(g.r, ctx.charge(g));
    }
    return { results, use, refunded };
  }

  // --- Averaging over states ----------------------------------------------------
  // Weapons you fire yourself can't fire while you sprint.
  const firing = 1 - Math.min(1, Math.max(0, param('sprintTime')));
  const avg = new Map<Item, { single: number; multi: number; rate: number; stamina: number; charge: number }>();
  const chargeAvg = new Map<Item, number>();
  let dutyAvg = 0;
  for (const { activity, p } of states) {
    const { results, duty, charges } = evaluateState(activity, false);
    dutyAvg += p * duty;
    for (const [item, c] of charges) chargeAvg.set(item, (chargeAvg.get(item) ?? 0) + p * c);
    for (const [w, r] of results) {
      const a = avg.get(w) ?? { single: 0, multi: 0, rate: 0, stamina: 0, charge: 0 };
      const d = r.gated ? duty * firing : 1;
      a.single += p * r.single * d;
      a.multi += p * r.multi * d;
      a.rate += p * r.rate * d;
      a.stamina += p * r.stamina;
      a.charge += p * r.charge;
      avg.set(w, a);
    }
  }

  // Breakdowns for the two extremes; links from the all-on state.
  const idleState = evaluateState(new Map(mitos.map((m) => [m, 0])), false);
  const hasCharge = mitos.length > 0;
  const chargedState = hasCharge ? evaluateState(new Map(mitos.map((m) => [m, 1])), true) : evaluateState(new Map(), true);

  const view = (label: string, s: ReturnType<typeof evaluateState>, w: Item): StateView => {
    const r = s.results.get(w)!;
    const d = r.gated ? s.duty * firing : 1;
    return { label, dps: r.single * d, multiDps: r.multi * d, attacksPerSecond: r.rate * d, charge: r.charge, gunTrace: r.gunTrace, nodes: r.nodes };
  };

  // --- Results ----------------------------------------------------------------
  const itemResults = new Map<string, ItemResult>();
  const weapons: WeaponResult[] = [];
  for (const item of items.values()) {
    const notes: string[] = [];
    if (item.behaviour.notes) notes.push(item.behaviour.notes);
    const modeled = isModeled(item.info.id);
    const result: ItemResult = {
      slotId: item.slotId,
      info: item.info,
      instance: item.state.organelle!,
      modeled,
      notes,
      charge: chargeAvg.get(item) ?? 0,
      mito: mitoResults.get(item),
    };
    if (item.traits.some((t) => t.requiresCharge) && (chargeAvg.get(item) ?? 0) < EXCITABLE_CHARGE) notes.push('Excitable: only works at 0.9 Overcharge or more.');
    if (item.behaviour.weapon) {
      const a = avg.get(item)!;
      const idle = view('No Overcharge', idleState, item);
      const charged = hasCharge ? view('All mitochondria active', chargedState, item) : null;
      const charges = charged && charged.charge > 0 ? charged : null;
      if (item.behaviour.weapon.minCharge && a.single === 0) notes.push('Needs Overcharge: put a mitochondrion (or a Vesicle fed by one) next to it.');
      const wr: WeaponResult = {
        slotId: item.slotId,
        info: item.info,
        instance: item.state.organelle!,
        dps: a.single,
        multiDps: a.multi,
        attacksPerSecond: a.rate,
        staminaPerSecond: a.stamina,
        idle,
        charged: charges,
        notes,
        excluded: !!item.state.excluded,
      };
      result.weapon = wr;
      weapons.push(wr);
    }
    itemResults.set(item.slotId, result);
  }
  weapons.sort((a, b) => b.dps - a.dps);
  const counted = weapons.filter((w) => !w.excluded);
  return {
    body,
    items: itemResults,
    weapons,
    totalDps: counted.reduce((s, w) => s + w.dps, 0),
    totalMultiDps: counted.reduce((s, w) => s + w.multiDps, 0),
    staminaDuty: dutyAvg,
    maxStamina,
    run: run.summary,
    links: [...linkSet.values()],
    warnings: [
      ...new Set([
        ...warnings,
        ...[...chainsCut].map((n) => `${n}: too many chain paths to follow them all; its DPS is an underestimate.`),
      ]),
    ],
  };
}
