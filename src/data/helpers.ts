// Shorthands for writing game data. They mirror tooltip notation:
//   pct('damage', 0.25)       "+25% damage"
//   mul('damage', 1.5)        "x1.5 damage"
//   flat('critChance', 0.1)   "+10% crit chance" (chances are flat)

import type { ByRarity, ModifierDef, StatKey, TargetFilter } from '../engine/types';

type Extra = Omit<ModifierDef, 'stat' | 'op' | 'value'>;

export const flat = (stat: StatKey, value: ByRarity, extra: Extra = {}): ModifierDef => ({ stat, op: 'flat', value, ...extra });
export const pct = (stat: StatKey, value: ByRarity, extra: Extra = {}): ModifierDef => ({ stat, op: 'percent', value, ...extra });
export const mul = (stat: StatKey, value: ByRarity, extra: Extra = {}): ModifierDef => ({ stat, op: 'multiply', value, ...extra });

/** Attack infusers: any attack from the connected organelle. */
export const ATTACKS: TargetFilter = { tags: ['attack'] };
/** Projectile infusers: only projectiles. */
export const PROJECTILES: TargetFilter = { tags: ['projectile'] };
/** Weapon infusers: only weapon organelles. */
export const WEAPONS: TargetFilter = { categories: ['weapon'] };
export const INFUSERS: TargetFilter = { categories: ['infuser'] };
export const EVERYTHING: TargetFilter = {};
