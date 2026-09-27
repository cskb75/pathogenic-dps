// Run effects: the mutations picked this run, the plasmids bought, and the run
// state (cores held, HP, bosses beaten), turned into the bonuses the
// calculator applies.
//
// In the game, damage mutations hook the "attack fired" signals and add a
// share of the attack's base damage, so they stack additively with each other
// and with infusers. Each stack of a mutation is its own hook.

import type { Build, ClassDef, GameData, RunEffects } from './types';

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
  /** Weapons equipped (anything the game counts as a gun). */
  weapons: number;
  emptyInternal: number;
}

export interface RunModel {
  sources: RunSource[];
  /** Added to every attack. */
  damage: Share[];
  /** Added to melee attacks. */
  meleeDamage: Share[];
  /** Weapons on one side of the body. */
  chirality: { source: string; side: 'left' | 'right'; bonus: number; penalty: number }[];
  /** Per active mitochondrion. */
  perActiveMito: Share[];
  /** Per 100 stamina missing. */
  starvation: Share[];
  attackSpeed: Share[];
  /** Extra Overcharge strength for mitochondria and Vesicles. */
  generatorStrength: number;
  /** Stamina added to the pool. */
  extraStamina: number;
  noStamina: boolean;
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
    chirality: [],
    perActiveMito: [],
    starvation: [],
    attackSpeed: [],
    generatorStrength: 0,
    extraStamina: 0,
    noStamina: false,
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
    if (e.chirality) {
      const c = e.chirality;
      model.chirality.push({ source: s.name, side: c.side, bonus: c.bonus * n, penalty: c.penalty * n });
      lines.push(`${pct(c.bonus * n)} damage for ${c.side} weapons, ${pct(c.penalty * n)} for ${c.side === 'left' ? 'right' : 'left'}`);
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
    if (e.staminaContainers) {
      model.extraStamina += 100 * e.staminaContainers * n;
      lines.push(`+${e.staminaContainers * n} stamina container${e.staminaContainers * n === 1 ? '' : 's'}`);
    }
    if (e.noStamina) {
      model.noStamina = true;
      lines.push('weapons cost no stamina');
    }
    const text = [...lines, ...idle].join(', ') || s.notes || 'no effect on DPS';
    model.summary.push({ source: name, text, inactive: lines.length === 0 });
  }
  return model;
}
