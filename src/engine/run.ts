// Run effects: the mutations picked this run, the plasmids bought, and the run
// state (cores held, HP, bosses beaten), turned into the bonuses the
// calculator applies.
//
// In the game, damage mutations hook the "attack fired" signals and add a
// share of the attack's base damage, so they stack additively with each other
// and with infusers. Each stack of a mutation is its own hook.

import type { Build, ClassDef, GameData, RunEffects, ZoneEffect } from './types';

/** Where a mutation stack came from. */
export interface RunSource {
  id: string;
  name: string;
  kind: 'mutation' | 'plasmid';
  /** Stacks (mutations) or nodes (plasmids). */
  count: number;
  effects: RunEffects;
  notes?: string;
}

/** A share of base damage (or attack speed) and what it's from. */
export interface Share {
  source: string;
  share: number;
}

/** A line in the run summary. */
export interface RunLine {
  source: string;
  text: string;
  /** Picked but doesn't change DPS (or isn't modeled). */
  inactive?: boolean;
}

export interface RunState {
  cores: number;
  hp: number;
  bossesBeaten: number;
  /** Weapons equipped (anything the game counts as a gun), mirrored copies included. */
  weapons: number;
  emptyInternal: number;
  /** Pseudopods reaching for enemies. */
  pseudopods: number;
  /** Thrust from flagella. */
  thrust: number;
  /** Share of the fight the target is frozen. */
  frozenTime: number;
  /** Hits each minion takes per second. */
  minionHitRate: number;
}

export interface RunModel {
  sources: RunSource[];
  /** Added to every attack. */
  damage: Share[];
  /** Added to melee attacks. */
  meleeDamage: Share[];
  /** Effects for one part of the body, already multiplied by stacks. */
  zones: (ZoneEffect & { source: string })[];
  /** Per active mitochondrion. */
  perActiveMito: Share[];
  /** Per 100 stamina missing. */
  starvation: Share[];
  attackSpeed: Share[];
  /** Extra Overcharge strength for mitochondria and Vesicles. */
  generatorStrength: number;
  /** Share less Overcharge that actives need. */
  activeCost: number;
  /** Extra Overcharge strength for actives. */
  activeCharge: number;
  /** Overcharge actives get on their own. */
  activeFlatCharge: number;
  /** Multiplies all damage. */
  damageMultiplier: number;
  /** Stamina added to the pool. */
  extraStamina: number;
  noStamina: boolean;
  /** Multiplies the chance lightning splits. */
  lightningSplit: number;
  /** Splashes released by each minion when it's hit, per stack. */
  minionHitSplash: { source: string; damage: number }[];
  summary: RunLine[];
  warnings: string[];
}

/** Mutation stacks: picked this run plus those granted by plasmids. */
export function mutationStacks(build: Build, cls: ClassDef): Map<string, number> {
  const stacks = new Map<string, number>();
  for (const [id, n] of Object.entries(build.mutations)) if (n > 0) stacks.set(id, n);
  for (const p of cls.plasmids) {
    const n = build.plasmids[p.id] ?? 0;
    if (p.mutation && n > 0) stacks.set(p.mutation, (stacks.get(p.mutation) ?? 0) + n);
  }
  return stacks;
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Number((x * 100).toFixed(1))}%`;

export function runModel(build: Build, data: GameData, cls: ClassDef, state: RunState): RunModel {
  const model: RunModel = {
    sources: [],
    damage: [],
    meleeDamage: [],
    zones: [],
    perActiveMito: [],
    starvation: [],
    attackSpeed: [],
    generatorStrength: 0,
    activeCost: 0,
    activeCharge: 0,
    activeFlatCharge: 0,
    damageMultiplier: 1,
    extraStamina: 0,
    noStamina: false,
    lightningSplit: 1,
    minionHitSplash: [],
    summary: [],
    warnings: [],
  };
  const mutations = new Map(data.mutations.map((m) => [m.id, m]));

  for (const [id, count] of mutationStacks(build, cls)) {
    const m = mutations.get(id);
    if (!m) {
      model.warnings.push(`Unknown mutation "${id}"`);
      continue;
    }
    model.sources.push({ id, name: m.name, kind: 'mutation', count, effects: m.effects ?? {}, notes: m.notes });
  }
  for (const p of cls.plasmids) {
    const count = build.plasmids[p.id] ?? 0;
    if (count > 0 && p.effects) model.sources.push({ id: p.id, name: p.name, kind: 'plasmid', count, effects: p.effects });
  }
  for (const id of Object.keys(build.plasmids)) {
    if (!cls.plasmids.some((p) => p.id === id)) model.warnings.push(`Unknown plasmid "${id}"`);
  }

  for (const s of model.sources) {
    const e = s.effects;
    const n = s.count;
    const name = n > 1 ? `${s.name} x${n}` : s.name;
    const lines: string[] = [];
    const idle: string[] = [];
    const damage = (share: number, why?: string) => {
      model.damage.push({ source: s.name, share });
      lines.push(`${pct(share)} damage${why ? ` (${why})` : ''}`);
    };
    if (e.damage) damage(e.damage * n);
    if (e.perCore) damage(e.perCore * n * state.cores, `${state.cores} cores`);
    if (e.perEmptyInternal) damage(e.perEmptyInternal * n * state.emptyInternal, `${state.emptyInternal} empty internal slots`);
    if (e.perBoss) damage(e.perBoss * n * state.bossesBeaten, `${state.bossesBeaten} bosses beaten`);
    if (e.perPseudopod) {
      if (state.pseudopods) damage(e.perPseudopod * n * state.pseudopods, `${state.pseudopods} pseudopod${state.pseudopods === 1 ? '' : 's'}`);
      else idle.push('no pseudopods');
    }
    if (e.perThrust) {
      if (state.thrust) damage(e.perThrust * n * state.thrust, `${state.thrust} thrust`);
      else idle.push('no flagella');
    }
    if (e.damageMultiplier !== undefined) {
      model.damageMultiplier *= e.damageMultiplier ** n;
      lines.push(`x${(e.damageMultiplier ** n).toFixed(2)} damage`);
    }
    if (e.focused) {
      // Each stack adds its own bonus, floored separately.
      const f = e.focused;
      damage(n * Math.max(f.floor, f.bonus - f.perWeapon * state.weapons), `${state.weapons} weapons`);
    }
    if (e.lowHp) {
      if (state.hp <= e.lowHp.maxHp) {
        damage(e.lowHp.damage * n, `at ${state.hp} HP`);
        model.attackSpeed.push({ source: s.name, share: e.lowHp.attackSpeed * n });
        lines.push(`${pct(e.lowHp.attackSpeed * n)} attack speed`);
      } else {
        idle.push(`no effect above ${e.lowHp.maxHp} HP`);
      }
    }
    if (e.meleeDamage) {
      model.meleeDamage.push({ source: s.name, share: e.meleeDamage * n });
      lines.push(`${pct(e.meleeDamage * n)} melee damage`);
    }
    if (e.zone) {
      const z = e.zone;
      const scaled = {
        ...z,
        source: s.name,
        damage: (z.damage ?? 0) * n,
        opposite: (z.opposite ?? 0) * n,
        generatorStrength: (z.generatorStrength ?? 0) * n,
        activeCost: (z.activeCost ?? 0) * n,
        activeCharge: (z.activeCharge ?? 0) * n,
      };
      model.zones.push(scaled);
      const where = { left: 'on the left', right: 'on the right', top: 'in front', bottom: 'at the back' };
      const other = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;
      const what = z.meleeOnly ? 'melee attacks' : 'damage';
      if (scaled.damage) lines.push(`${pct(scaled.damage)} ${what} ${where[z.side]}`);
      if (scaled.opposite) lines.push(`${pct(scaled.opposite)} ${what} ${where[other[z.side]]}`);
      if (scaled.generatorStrength) lines.push(`${pct(scaled.generatorStrength)} Overcharge strength for mitochondria ${where[z.side]}`);
      if (scaled.activeCost) lines.push(`actives ${where[z.side]} need ${pct(scaled.activeCost).replace('+', '')} less Overcharge`);
      if (scaled.activeCharge) lines.push(`actives ${where[z.side]} charge ${pct(scaled.activeCharge).replace('+', '')} faster`);
    }
    if (e.perActiveMito) {
      model.perActiveMito.push({ source: s.name, share: e.perActiveMito * n });
      lines.push(`${pct(e.perActiveMito * n)} damage per active mitochondrion`);
    }
    if (e.starvation) {
      model.starvation.push({ source: s.name, share: e.starvation * n });
      lines.push(`${pct(e.starvation * n)} damage per empty stamina container`);
    }
    if (e.attackSpeed) {
      model.attackSpeed.push({ source: s.name, share: e.attackSpeed * n });
      lines.push(`${pct(e.attackSpeed * n)} attack speed`);
    }
    if (e.generatorStrength) {
      model.generatorStrength += e.generatorStrength * n;
      lines.push(`${pct(e.generatorStrength * n)} Overcharge strength from mitochondria`);
    }
    if (e.activeCost) {
      model.activeCost += e.activeCost * n;
      lines.push(`actives need ${pct(e.activeCost * n).replace('+', '')} less Overcharge`);
    }
    if (e.activeCharge) {
      model.activeCharge += e.activeCharge * n;
      lines.push(`actives charge ${pct(e.activeCharge * n).replace('+', '')} faster`);
    }
    if (e.activeFlatCharge) {
      model.activeFlatCharge += e.activeFlatCharge * n;
      lines.push(`actives get ${Number((e.activeFlatCharge * n).toFixed(2))} Overcharge on their own`);
    }
    if (e.staminaContainers) {
      model.extraStamina += 100 * e.staminaContainers * n;
      lines.push(`+${e.staminaContainers * n} stamina container${e.staminaContainers * n === 1 ? '' : 's'}`);
    }
    if (e.noStamina) {
      model.noStamina = true;
      lines.push('weapons cost no stamina');
    }
    if (e.vsFrozen) {
      if (state.frozenTime > 0) damage(e.vsFrozen * n * state.frozenTime, `on hits while frozen, ${pct(state.frozenTime).replace('+', '')} of the time`);
      else idle.push('set "Target frozen" to count it');
    }
    if (e.lightningSplit) {
      model.lightningSplit *= e.lightningSplit ** n;
      lines.push(`x${(e.lightningSplit ** n).toFixed(2)} lightning split chance (more hits on other enemies)`);
    }
    if (e.minionHitSplash) {
      model.minionHitSplash.push({ source: s.name, damage: e.minionHitSplash * n });
      if (state.minionHitRate > 0) lines.push(`a ${e.minionHitSplash * n} damage splash each time a minion is hit`);
      else idle.push('set "Hits taken per minion" to count it');
    }
    const text = [...lines, ...idle].join(', ') || s.notes || 'no effect on DPS';
    model.summary.push({ source: name, text, inactive: lines.length === 0 });
  }
  return model;
}
