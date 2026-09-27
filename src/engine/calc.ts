// The DPS engine.
//
// Model (averages + toggles):
//   * Every stat is (base + flats) x (1 + sum of percents) x product of multipliers.
//   * Infusers and other "connected" effects reach only the organelles directly
//     connected to them. An effect that targets infusers (e.g. +30% potency)
//     makes that infuser's own effects stronger, which is how chains work.
//   * Mitochondria give Overcharge to directly connected organelles. Each has
//     an uptime (share of the fight its trigger is active). An organelle's
//     damage is averaged over its time spent Overcharged vs not.
//   * Random effects (crits, on-hit chances) are averaged; conditions are
//     on/off toggles and parameters are numbers set by the user.

import { buildBody, type Body, type PieceShape, type Slot } from './body';
import type {
  Build,
  ByRarity,
  ClassDef,
  CustomTarget,
  GameData,
  GrantDef,
  GraftDef,
  ModifierDef,
  ModifierOp,
  OrganelleDef,
  OrganelleInstance,
  SlotState,
  StatKey,
  TargetFilter,
  TraitDef,
} from './types';
import { RARITIES, STAT_KEYS } from './types';

export interface Contribution {
  source: string;
  op: ModifierOp;
  value: number;
}

export interface StatLine {
  base: number;
  contributions: Contribution[];
  value: number;
}

export type Stats = Record<StatKey, StatLine>;

export interface StatusLine {
  status: string;
  name: string;
  applicationsPerSecond: number;
  /** Average stacks kept on the target (for refresh-only statuses, the share of time it is up). */
  stacks: number;
  dps: number;
  sources: string[];
}

export interface StateResult {
  stats: Stats;
  /** Average damage per hit, crits included. */
  hitDamage: number;
  hitsPerSecond: number;
  directDps: number;
  statuses: StatusLine[];
  /** Single-target DPS. */
  dps: number;
  /** Enemies each hit reaches, given the build's target count. */
  targetsHit: number;
  multiTargetDps: number;
}

export interface OverchargeSupply {
  /** Share of the fight with at least one active mitochondrion connected. */
  uptime: number;
  /** Average charges held while Overcharged. */
  charges: number;
  sources: { slotId: string; name: string; uptime: number; charges: number }[];
}

export interface AttackResult {
  normal: StateResult | null;
  charged: StateResult | null;
  /** Single-target DPS averaged over Overcharge uptime. */
  dps: number;
  multiTargetDps: number;
  excluded: boolean;
}

export interface ItemResult {
  slotId: string;
  def: OrganelleDef;
  instance: OrganelleInstance;
  requiresOvercharge: boolean;
  overcharge: OverchargeSupply;
  /** Organelles that give effects to others: how strong those effects are. */
  potency?: { normal: number; charged: number; average: number };
  /** Mitochondria: Overcharge charges given to each connected organelle. */
  mitoOutput?: { uptime: number; charges: number };
  attack?: AttackResult;
  notes: string[];
}

export interface Interaction {
  from: string;
  to: string;
  kind: 'grant' | 'overcharge';
}

export interface CalcResult {
  body: Body;
  items: Map<string, ItemResult>;
  /** Organelles with an attack, highest DPS first. */
  sources: ItemResult[];
  totalDps: number;
  totalMultiTargetDps: number;
  interactions: Interaction[];
  warnings: string[];
}

interface Item {
  slot: Slot;
  state: SlotState;
  def: OrganelleDef;
  inst: OrganelleInstance;
  rarity: number;
  traits: TraitDef[];
  graft?: GraftDef;
  tags: Set<string>;
  requiresOvercharge: boolean;
}

interface GlobalGrant {
  grant: GrantDef;
  label: string;
  rarity: number;
  scale: () => number;
}

const CUSTOM_FILTERS: Record<CustomTarget, TargetFilter> = {
  attacks: { tags: ['attack'] },
  projectiles: { tags: ['projectile'] },
  weapons: { categories: ['weapon'] },
  everything: {},
};

const FALLBACK_SHAPE: PieceShape = { sides: 4, centerSlot: 'internal', edgeSlot: 'external' };

export function atRarity(value: ByRarity, rarity: number): number {
  if (typeof value === 'number') return value;
  if (value.length === 0) return 0;
  return value[Math.min(rarity, value.length - 1)];
}

/** Applies a scale (potency, stacks, charges...) to a modifier value. */
export function scaleValue(op: ModifierOp, value: number, scale: number): number {
  return op === 'multiply' ? 1 + (value - 1) * scale : value * scale;
}

export function finalValue(line: Pick<StatLine, 'base' | 'contributions'>): number {
  let flat = 0;
  let percent = 0;
  let multiply = 1;
  for (const c of line.contributions) {
    if (c.op === 'flat') flat += c.value;
    else if (c.op === 'percent') percent += c.value;
    else multiply *= c.value;
  }
  return (line.base + flat) * (1 + percent) * multiply;
}

export function matchesFilter(filter: TargetFilter, target: { category: string; tags: Set<string>; pieceType: string; slotKind: string }) {
  if (filter.categories && !filter.categories.includes(target.category as never)) return false;
  if (filter.tags && !filter.tags.some((t) => target.tags.has(t))) return false;
  if (filter.pieceTypes && !filter.pieceTypes.includes(target.pieceType)) return false;
  if (filter.slotKinds && !filter.slotKinds.includes(target.slotKind as never)) return false;
  return true;
}

export function findClass(data: GameData, classId: string): ClassDef {
  return data.classes.find((c) => c.id === classId) ?? data.classes[0];
}

export function bodyFor(build: Build, data: GameData): Body {
  const cls = findClass(data, build.classId);
  const shapes = new Map(cls.pieceTypes.map((p) => [p.id, p]));
  return buildBody(build.pieces, (t) => shapes.get(t) ?? FALLBACK_SHAPE);
}

export function calculate(build: Build, data: GameData): CalcResult {
  const cls = findClass(data, build.classId);
  const body = bodyFor(build, data);
  const warnings: string[] = [];
  for (const e of body.errors) warnings.push(`Piece ${e.pieceId}: ${e.reason}`);

  const organelles = new Map(data.organelles.map((o) => [o.id, o]));
  const traits = new Map(data.traits.map((t) => [t.id, t]));
  const grafts = new Map(data.grafts.map((g) => [g.id, g]));
  const statuses = new Map(data.statuses.map((s) => [s.id, s]));
  const params = new Map(data.params.map((p) => [p.id, p]));

  const conditionOn = (id: string | undefined) => !id || build.conditions[id] === true;
  const paramValue = (id: string) => build.params[id] ?? params.get(id)?.default ?? 0;

  // --- Items: organelles actually sitting in valid slots -------------------
  const items = new Map<string, Item>();
  for (const slot of body.slots) {
    const state = build.slots[slot.id];
    if (!state?.organelle) continue;
    const def = organelles.get(state.organelle.id);
    if (!def) {
      warnings.push(`Unknown organelle "${state.organelle.id}" in slot ${slot.id}`);
      continue;
    }
    const graft = state.graft ? grafts.get(state.graft) : undefined;
    const accepts = graft?.accepts ?? [slot.kind];
    if (!accepts.includes(def.slot)) {
      warnings.push(`${def.name} is ${def.slot} but slot ${slot.id} only accepts ${accepts.join('/')}`);
      continue;
    }
    const itemTraits = state.organelle.traits
      .map((id) => traits.get(id))
      .filter((t): t is TraitDef => !!t && !t.excludes?.includes(def.id));
    const tags = new Set([...(def.tags ?? []), ...(def.attack ? ['attack', ...def.attack.tags] : [])]);
    items.set(slot.id, {
      slot,
      state,
      def,
      inst: state.organelle,
      rarity: Math.max(0, RARITIES.indexOf(state.organelle.rarity)),
      traits: itemTraits,
      graft,
      tags,
      requiresOvercharge: !!def.requiresOvercharge || itemTraits.some((t) => t.requiresOvercharge),
    });
  }

  const neighbours = (item: Item): Item[] =>
    (body.connections.get(item.slot.id) ?? []).map((id) => items.get(id)).filter((i): i is Item => !!i);

  const matches = (filter: TargetFilter, item: Item) =>
    matchesFilter(filter, { category: item.def.category, tags: item.tags, pieceType: item.slot.pieceType, slotKind: item.slot.kind });

  // --- Memoised, cycle-safe lookups ----------------------------------------
  const memo = new Map<string, unknown>();
  const inProgress = new Set<string>();
  function guarded<T>(key: string, fallback: T, fn: () => T): T {
    if (memo.has(key)) return memo.get(key) as T;
    if (inProgress.has(key)) return fallback; // a loop of effects feeding each other
    inProgress.add(key);
    try {
      const value = fn();
      memo.set(key, value);
      return value;
    } finally {
      inProgress.delete(key);
    }
  }

  // --- Global effects: class passives, upgrades, custom bonuses, global grants
  const globalGrants: GlobalGrant[] = [];
  for (const grant of cls.passives) globalGrants.push({ grant, label: cls.name, rarity: 0, scale: () => 1 });
  for (const up of cls.upgrades) {
    const stacks = Math.min(build.upgrades[up.id] ?? 0, up.maxStacks);
    if (stacks > 0) for (const grant of up.grants) globalGrants.push({ grant, label: up.name, rarity: 0, scale: () => stacks });
  }
  for (const c of build.custom) {
    globalGrants.push({
      grant: { scope: 'global', to: CUSTOM_FILTERS[c.target], modifiers: [{ stat: c.stat, op: c.op, value: c.value }] },
      label: c.label || 'Custom bonus',
      rarity: 0,
      scale: () => 1,
    });
  }
  for (const item of items.values()) {
    for (const grant of item.def.grants ?? []) {
      if (grant.scope === 'global') {
        globalGrants.push({ grant, label: item.def.name, rarity: item.rarity, scale: () => potencyOf(item).average });
      }
    }
  }

  function resolve(mod: ModifierDef, rarity: number, scale: number, charges = 0): number | null {
    if (!conditionOn(mod.when)) return null;
    let k = scale;
    if (mod.per) {
      const p = paramValue(mod.per.param);
      k *= mod.per.max === undefined ? p : Math.min(p, mod.per.max);
    }
    if (mod.perCharge) k *= charges;
    return scaleValue(mod.op, atRarity(mod.value, rarity), k);
  }

  function baseStats(item: Item): Stats {
    const a = item.def.attack;
    const r = item.rarity;
    const base: Record<StatKey, number> = {
      damage: a ? atRarity(a.damage, r) : 0,
      attackSpeed: a ? atRarity(a.attackSpeed, r) : 0,
      projectiles: a?.projectiles !== undefined ? atRarity(a.projectiles, r) : 1,
      hits: a?.hits !== undefined ? atRarity(a.hits, r) : 1,
      critChance: a?.critChance !== undefined ? atRarity(a.critChance, r) : 0,
      critMultiplier: a?.critMultiplier !== undefined ? atRarity(a.critMultiplier, r) : data.constants.baseCritMultiplier,
      pierce: a?.pierce !== undefined ? atRarity(a.pierce, r) : 0,
      forks: a?.forks !== undefined ? atRarity(a.forks, r) : 0,
      potency: 1,
      overchargeStrength: 1,
    };
    const stats = {} as Stats;
    for (const k of STAT_KEYS) stats[k] = { base: base[k], contributions: [], value: base[k] };
    return stats;
  }

  function computeStats(item: Item, charged: boolean, charges: number): Stats {
    const stats = baseStats(item);
    const push = (mod: ModifierDef, rarity: number, scale: number, source: string, c = 0) => {
      const value = resolve(mod, rarity, scale, c);
      if (value !== null) stats[mod.stat].contributions.push({ source, op: mod.op, value });
    };

    for (const m of item.def.modifiers ?? []) push(m, item.rarity, 1, item.def.name);
    for (const t of item.traits) {
      for (const m of item.def.attack ? t.attackModifiers : t.otherModifiers) push(m, item.rarity, 1, `${t.name} trait`);
    }
    for (const m of item.graft?.modifiers ?? []) push(m, 0, 1, `${item.graft!.name} slot`);
    for (const g of globalGrants) {
      if (!conditionOn(g.grant.when) || !matches(g.grant.to, item) || !g.grant.modifiers?.length) continue;
      const scale = g.scale();
      for (const m of g.grant.modifiers) push(m, g.rarity, scale, g.label);
    }
    for (const n of neighbours(item)) {
      for (const grant of n.def.grants ?? []) {
        if (grant.scope !== 'connected' || !conditionOn(grant.when) || !matches(grant.to, item) || !grant.modifiers?.length) continue;
        const scale = potencyOf(n).average;
        for (const m of grant.modifiers) push(m, n.rarity, scale, n.def.name);
      }
    }
    if (charged && item.def.overcharge) {
      const strength = finalValue(stats.overchargeStrength);
      for (const m of item.def.overcharge.modifiers) push(m, item.rarity, strength, 'Overcharge', charges);
    }
    for (const k of STAT_KEYS) stats[k].value = finalValue(stats[k]);
    return stats;
  }

  function mitoOutput(item: Item): { uptime: number; charges: number } {
    return guarded(`mito:${item.slot.id}`, { uptime: 0, charges: 0 }, () => {
      const m = item.def.mitochondrion!;
      if (item.requiresOvercharge) return { uptime: 0, charges: 0 }; // it can't Overcharge itself
      const uptime = Math.min(1, Math.max(0, item.state.uptime ?? m.defaultUptime));
      const stats = computeStats(item, false, 0);
      return { uptime, charges: atRarity(m.charges, item.rarity) * stats.potency.value * stats.overchargeStrength.value };
    });
  }

  function supplyOf(item: Item): OverchargeSupply {
    return guarded(`supply:${item.slot.id}`, { uptime: 0, charges: 0, sources: [] }, () => {
      if (item.def.mitochondrion) return { uptime: 0, charges: 0, sources: [] };
      const sources = neighbours(item)
        .filter((n) => n.def.mitochondrion)
        .map((n) => ({ slotId: n.slot.id, name: n.def.name, ...mitoOutput(n) }))
        .filter((s) => s.uptime > 0 && s.charges > 0);
      const uptime = 1 - sources.reduce((p, s) => p * (1 - s.uptime), 1);
      const expected = sources.reduce((sum, s) => sum + s.uptime * s.charges, 0);
      return { uptime, charges: uptime > 0 ? expected / uptime : 0, sources };
    });
  }

  function potencyOf(item: Item): { normal: number; charged: number; average: number } {
    return guarded(`potency:${item.slot.id}`, { normal: 1, charged: 1, average: 1 }, () => {
      const supply = supplyOf(item);
      const normal = item.requiresOvercharge ? 0 : computeStats(item, false, 0).potency.value;
      const charged = supply.uptime > 0 ? computeStats(item, true, supply.charges).potency.value : normal;
      return { normal, charged, average: supply.uptime * charged + (1 - supply.uptime) * normal };
    });
  }

  function evaluateAttack(item: Item, charged: boolean, charges: number): StateResult {
    const stats = computeStats(item, charged, charges);
    const v = (k: StatKey) => Math.max(0, stats[k].value);
    const critChance = Math.min(1, v('critChance'));
    const hitDamage = v('damage') * (1 + critChance * (v('critMultiplier') - 1));
    const hitsPerSecond = v('attackSpeed') * v('projectiles') * v('hits');
    const directDps = hitDamage * hitsPerSecond;

    // On-hit statuses from the attack itself, connected infusers and global grants.
    const onHits: { status: string; chance: number; potency: number; source: string }[] = [];
    const addOnHit = (list: GrantDef['onHit'], rarity: number, potencyScale: number, source: string) => {
      for (const o of list ?? []) {
        onHits.push({
          status: o.status,
          chance: Math.min(1, atRarity(o.chance, rarity)),
          potency: (o.potency === undefined ? 1 : atRarity(o.potency, rarity)) * potencyScale,
          source,
        });
      }
    };
    addOnHit(item.def.attack?.onHit, item.rarity, 1, item.def.name);
    for (const n of neighbours(item)) {
      for (const grant of n.def.grants ?? []) {
        if (grant.scope === 'connected' && conditionOn(grant.when) && matches(grant.to, item)) {
          addOnHit(grant.onHit, n.rarity, potencyOf(n).average, n.def.name);
        }
      }
    }
    for (const g of globalGrants) {
      if (conditionOn(g.grant.when) && matches(g.grant.to, item)) addOnHit(g.grant.onHit, g.rarity, g.scale(), g.label);
    }

    const statusLines: StatusLine[] = [];
    for (const id of new Set(onHits.map((o) => o.status))) {
      const def = statuses.get(id);
      const entries = onHits.filter((o) => o.status === id);
      if (!def) {
        warnings.push(`Unknown status "${id}" on ${item.def.name}`);
        continue;
      }
      const apps = entries.reduce((s, o) => s + hitsPerSecond * o.chance, 0);
      const potency = apps > 0 ? entries.reduce((s, o) => s + hitsPerSecond * o.chance * o.potency, 0) / apps : 0;
      const perStack = (def.dpsFlat + def.dpsFromHit * hitDamage) * potency;
      const stacks = Math.min(Math.max(1, def.maxStacks), apps * def.duration);
      statusLines.push({
        status: id,
        name: def.name,
        applicationsPerSecond: apps,
        stacks,
        dps: perStack * stacks,
        sources: [...new Set(entries.map((e) => e.source))],
      });
    }
    const statusDps = statusLines.reduce((s, l) => s + l.dps, 0);

    const targets = Math.max(1, Math.floor(build.targets));
    const isArea = !!item.def.attack?.area;
    const pierced = isArea ? targets : Math.min(targets, 1 + Math.floor(v('pierce')));
    const forked = Math.min(targets - pierced, Math.floor(v('forks')));
    const targetsHit = pierced + Math.max(0, forked);
    const dps = directDps + statusDps;

    return { stats, hitDamage, hitsPerSecond, directDps, statuses: statusLines, dps, targetsHit, multiTargetDps: dps * targetsHit };
  }

  // --- Results --------------------------------------------------------------
  const results = new Map<string, ItemResult>();
  for (const item of items.values()) {
    const supply = supplyOf(item);
    const notes: string[] = [];
    const result: ItemResult = {
      slotId: item.slot.id,
      def: item.def,
      instance: item.inst,
      requiresOvercharge: item.requiresOvercharge,
      overcharge: supply,
      notes,
    };
    if (item.def.grants?.length || item.def.mitochondrion) result.potency = potencyOf(item);
    if (item.def.mitochondrion) result.mitoOutput = mitoOutput(item);
    if (item.requiresOvercharge && supply.uptime === 0) notes.push('Needs Overcharge: connect a mitochondrion.');
    if (item.def.attack) {
      const normal = item.requiresOvercharge ? null : evaluateAttack(item, false, 0);
      const charged = supply.uptime > 0 ? evaluateAttack(item, true, supply.charges) : null;
      const u = charged ? supply.uptime : 0;
      const blend = (k: 'dps' | 'multiTargetDps') => u * (charged?.[k] ?? 0) + (1 - u) * (normal?.[k] ?? 0);
      result.attack = { normal, charged, dps: blend('dps'), multiTargetDps: blend('multiTargetDps'), excluded: !!item.state.excluded };
    }
    results.set(item.slot.id, result);
  }

  // Which connections actually do something, for highlighting in the editor.
  const interactions: Interaction[] = [];
  for (const item of items.values()) {
    for (const n of neighbours(item)) {
      const grants = (n.def.grants ?? []).some((g) => g.scope === 'connected' && conditionOn(g.when) && matches(g.to, item));
      if (grants) interactions.push({ from: n.slot.id, to: item.slot.id, kind: 'grant' });
      if (n.def.mitochondrion && !item.def.mitochondrion && (item.def.overcharge || item.requiresOvercharge)) {
        interactions.push({ from: n.slot.id, to: item.slot.id, kind: 'overcharge' });
      }
    }
  }

  const sources = [...results.values()].filter((r) => r.attack).sort((a, b) => b.attack!.dps - a.attack!.dps);
  const counted = sources.filter((s) => !s.attack!.excluded);
  return {
    body,
    items: results,
    sources,
    totalDps: counted.reduce((s, r) => s + r.attack!.dps, 0),
    totalMultiTargetDps: counted.reduce((s, r) => s + r.attack!.multiTargetDps, 0),
    interactions,
    warnings: [...new Set(warnings)],
  };
}
