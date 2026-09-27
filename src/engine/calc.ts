// The DPS calculator.
//
// For every weapon we build its attack, let connected organelles modify it
// (following chains the way the game does, see sim/model.ts), and turn the
// result into damage per second.
//
// Mitochondria are either active or not at any moment. We evaluate every
// on/off combination, weighted by each one's uptime, and average. That keeps
// thresholds exact (the Rotary Extruder only fires with ~1 Overcharge).

import { buildBody, buildPlanBody, type Body, type PieceShape } from './body';
import { behaviourFor, isModeled } from './sim/behaviours';
import {
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
  kind: 'attack' | 'gun' | 'overcharge';
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

export function bodyFor(build: Build, data: GameData): Body {
  const cls = findClass(data, build.classId);
  if (cls.body.kind === 'evolving') {
    const path = evolutionPath(build, data);
    return buildPlanBody(path[path.length - 1]);
  }
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
    hp: build.params.hp ?? cls.hp,
    bossesBeaten: Math.max(0, param('bossesBeaten')),
    weapons: [...items.values()].filter((i) => i.info.category === 'weapon' || i.behaviour.weapon).length,
    emptyInternal: body.slots.filter((sl) => sl.kind === 'internal' && !items.has(sl.id)).length,
  });
  warnings.push(...run.warnings);
  const maxStamina = Math.max(1, param('maxStamina') + run.extraStamina);
  /** Whether an organelle's slot is in a part of the body (measured from the body's centre, front up). */
  const inZone = (item: Item, side: ZoneEffect['side'], threshold: number) => {
    const p = body.slotById.get(item.slotId)?.position ?? { x: 0, y: 0 };
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
  const strength = (item: Item) =>
    (item.graft?.id === 'conductive' ? 0.4 : 0) + overchargeBonus + (item.behaviour.mito || item.behaviour.conduit ? generatorBonus(item) : 0);
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
    for (const item of items.values()) charges.set(item, incoming(item));
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
  const damageMult = custom('damageMult').reduce((p, c) => p * c.value, 1);
  const speedShares: Share[] = [...run.attackSpeed, { source: 'Extra bonuses', share: custom('attackSpeed').reduce((s, c) => s + c.value, 0) }].filter(
    (b) => Math.abs(b.share) > 1e-9,
  );
  const weaponItems = [...items.values()].filter((i) => i.behaviour.weapon);

  interface WeaponEval {
    single: number;
    multi: number;
    rate: number;
    stamina: number;
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
    const bonuses = (a: Attack, emitter: Item): Share[] => {
      const out = [...fixedShares];
      if (a.melee) out.push(...run.meleeDamage);
      for (const z of run.zones) {
        if (z.meleeOnly && !a.melee) continue;
        const share = inZone(emitter, z.side, z.threshold) ? z.damage : inZone(emitter, OPPOSITE[z.side], z.threshold) ? z.opposite : 0;
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
      works: (i) => !i.traits.some((t) => t.requiresCharge) || (charges.get(i) ?? 0) > 0,
      link: (from, to, kind) => {
        if (recordLinks) linkSet.set(`${kind}:${from.slotId}>${to.slotId}`, { from: from.slotId, to: to.slotId, kind });
      },
      bonuses,
      gun: null,
      refund: (w) => refunded.add(w),
      budget: { left: CHAIN_BUDGET, exhausted: false },
    };

    const results = new Map<Item, WeaponEval>();
    for (const w of weaponItems) {
      const prof = w.behaviour.weapon!;
      const c = ctx.charge(w);
      const zero: WeaponEval = { single: 0, multi: 0, rate: 0, stamina: 0, nodes: [], gunTrace: [], charge: c };
      if (!ctx.works(w) || (prof.minCharge && c < prof.minCharge)) {
        results.set(w, zero);
        continue;
      }
      const gun: GunState = { bonus: 0, trace: [], interval: 0 };
      const selfTimed = !!(prof.energyCost || prof.rate);
      let rate = 0;
      let comboMult = 1;
      if (prof.energyCost) {
        // Actives build energy from Overcharge and fire when full.
        const cost = prof.energyCost(w.r) * Math.max(0.1, 1 - activeCostCut(w));
        rate = c / cost;
        gun.trace.push({ source: w.info.name, text: `uses ${fmt(cost)} Overcharge-seconds per activation` });
      } else if (prof.rate) {
        rate = prof.rate(ctx, w.r, c);
      }
      if (selfTimed && rate <= 0) {
        results.set(w, zero);
        continue;
      }
      // Attack speed: weapon infusers add up, Overcharge multiplies.
      for (const b of selfTimed ? [] : speedShares) {
        gun.bonus += b.share;
        gun.trace.push({ source: b.source, text: `${b.share >= 0 ? '+' : ''}${Math.round(b.share * 100)}% attack speed` });
      }
      for (const n of selfTimed ? [] : neighbours(w)) {
        if (n.behaviour.modifyGun && ctx.works(n)) {
          const before = gun.trace.length;
          n.behaviour.modifyGun(ctx, n, gun, 1);
          if (gun.trace.length > before) ctx.link(n, w, 'gun');
        }
      }
      const chargeSpeed = selfTimed ? 0 : (prof.chargeAttackSpeed ?? 0.3) * c;
      if (chargeSpeed) gun.trace.push({ source: 'Overcharge', text: `x${(1 + chargeSpeed).toFixed(2)} attack speed` });
      let interval = prof.interval(w.r) / ((1 + chargeSpeed) * (1 + gun.bonus));
      if (prof.spinUp) interval = Math.max(1 / 60, interval - prof.spinUp * Math.max(0, 1 - 0.1 * w.r));
      if (prof.extraDelay) interval += prof.extraDelay;
      if (!selfTimed) rate = 1 / interval;
      if (prof.combo) {
        // Hits 1 and 2 normal, hit 3 deals 3x and comes 0.4s later.
        rate = 3 / (3 * interval + 0.4);
        comboMult = 5 / 3;
        gun.trace.push({ source: w.info.name, text: 'every 3rd strike deals 3x damage, 0.4s later' });
      }
      gun.interval = 1 / rate;
      ctx.gun = gun;
      ctx.budget = { left: CHAIN_BUDGET, exhausted: false };

      const shots = prof.shots ? prof.shots(w.r, c) : 1;
      const base = prof.base * (prof.damageMult ? prof.damageMult(w.r) : 1 + 0.4 * w.r);
      const root: Attack = newAttack({
        kind: prof.kind,
        label: `${w.info.name}${shots !== 1 ? ` x${Number(shots.toFixed(2))}` : ''}`,
        base,
        copies: shots,
        aim: prof.aimParam ? param(prof.aimParam) : 1,
        hits: prof.hits ? prof.hits(ctx) : 1,
        reach: prof.reach,
        bullet: prof.kind === 'bullet',
        melee: prof.kind === 'slash',
        speed: prof.speed ?? 0,
      });
      if (prof.damage) {
        // The organelle sets the damage itself; bonuses still scale off the attack's own base damage.
        root.base = prof.base;
        root.damage = prof.damage(w.r);
        root.trace.push({ source: w.info.name, text: `${fmt(root.damage)} damage (bonuses use its base damage, ${prof.base})` });
      } else {
        root.trace.push({ source: w.info.name, text: `${prof.base} base x${(base / prof.base).toFixed(2)} rarity = ${base.toFixed(1)}` });
      }
      announce(ctx, root, w);
      applyModifiers(ctx, root, [w], neighbours(w), 1);

      let attack = root;
      if (prof.explodes) {
        // The shell hands its damage to the explosion, which also re-runs on-hit effects.
        const level = Math.max(1, param('level'));
        const scale = 1 + (level - 1) * EXPLOSION_LEVEL_SCALING;
        attack = { ...root, kind: 'explosion', label: `${w.info.name} explosion`, reach: 'area', damage: root.damage * scale, onHitDamage: 0 };
        attack.onHit = root.onHit.map((d) => ({ ...d, perHit: d.perHit * 2 }));
        attack.trace = [...root.trace, ...(scale !== 1 ? [{ source: 'Level', text: `x${scale.toFixed(2)} explosion damage` }] : [])];
      }
      if (comboMult !== 1) {
        attack.damage *= comboMult;
        attack.onHitDamage *= comboMult;
      }
      const nodes = evaluateRoot(ctx, attack, param('angledHit'));
      const single = nodes.reduce((s, n) => s + n.single, 0) * rate * damageMult;
      const multi = nodes.reduce((s, n) => s + n.multi, 0) * rate * damageMult;
      if (ctx.budget.exhausted) chainsCut.add(w.info.name);
      results.set(w, { single, multi, rate, stamina: run.noStamina ? 0 : prof.stamina * rate, nodes, gunTrace: gun.trace, charge: c });
      ctx.gun = null;
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
  const avg = new Map<Item, { single: number; multi: number; rate: number; stamina: number; charge: number }>();
  const chargeAvg = new Map<Item, number>();
  let dutyAvg = 0;
  for (const { activity, p } of states) {
    const { results, duty, charges } = evaluateState(activity, false);
    dutyAvg += p * duty;
    for (const [item, c] of charges) chargeAvg.set(item, (chargeAvg.get(item) ?? 0) + p * c);
    for (const [w, r] of results) {
      const a = avg.get(w) ?? { single: 0, multi: 0, rate: 0, stamina: 0, charge: 0 };
      a.single += p * r.single * duty;
      a.multi += p * r.multi * duty;
      a.rate += p * r.rate * duty;
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
    return { label, dps: r.single * s.duty, multiDps: r.multi * s.duty, attacksPerSecond: r.rate * s.duty, charge: r.charge, gunTrace: r.gunTrace, nodes: r.nodes };
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
    if (item.traits.some((t) => t.requiresCharge) && (chargeAvg.get(item) ?? 0) === 0) notes.push('Excitable: needs Overcharge to work.');
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
