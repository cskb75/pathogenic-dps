// Data schema for game content and saved builds.
//
// Everything the calculator knows about the game lives in data files that
// follow these types (see src/data). The engine never hard-codes an item.

import type { SlotKind, PieceShape } from './body';
import type { PieceInstance } from './geometry';

export type { SlotKind } from './body';

export const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * A number that may change with rarity: either one value for every rarity, or
 * a list ordered Common, Rare, Epic, Legendary, Mythic. A shorter list repeats
 * its last entry for the higher rarities.
 */
export type ByRarity = number | readonly number[];

export type StatKey =
  /** Damage per hit. */
  | 'damage'
  /** Attacks per second. For beams and streams, damage ticks per second. */
  | 'attackSpeed'
  /** Projectiles (or strikes) per attack. */
  | 'projectiles'
  /** Times each projectile hits the same target (multi-hit attacks). */
  | 'hits'
  /** Chance to crit, 0 to 1. Use `flat` modifiers: +10% crit chance is flat 0.1. */
  | 'critChance'
  /** Damage multiplier on a crit. */
  | 'critMultiplier'
  /** Extra enemies a projectile passes through. */
  | 'pierce'
  /** Extra enemies hit by forking or chaining. */
  | 'forks'
  /** Scales everything this organelle gives to others (infuser effects, mitochondrion output). Base 1. */
  | 'potency'
  /** Scales Overcharge this organelle produces (mitochondria) or receives (everything else). Base 1. */
  | 'overchargeStrength';

export const STAT_KEYS: StatKey[] = [
  'damage',
  'attackSpeed',
  'projectiles',
  'hits',
  'critChance',
  'critMultiplier',
  'pierce',
  'forks',
  'potency',
  'overchargeStrength',
];

/**
 * How a modifier combines, following the in-game tooltip notation:
 *   flat      "+5 damage"   added to the base value
 *   percent   "+25% damage" 0.25, summed with every other percent on the stat
 *   multiply  "x1.5 damage" 1.5, multiplied in separately
 * Final value = (base + flats) x (1 + sum of percents) x product of multipliers.
 */
export type ModifierOp = 'flat' | 'percent' | 'multiply';

export interface ModifierDef {
  stat: StatKey;
  op: ModifierOp;
  value: ByRarity;
  /** Only applies while this condition (see ConditionDef) is switched on. */
  when?: string;
  /** Multiplies the value by a build parameter, e.g. +3% attack speed per consecutive hit. */
  per?: { param: string; max?: number };
  /** Overcharge modifiers only: multiply by the number of Overcharge charges held. */
  perCharge?: boolean;
}

export type Category = 'weapon' | 'infuser' | 'mitochondrion' | 'consumer' | 'flagellum' | 'support';

/**
 * Chooses which organelles a grant applies to. Every listed field must match;
 * an empty filter matches everything. Organelles with an attack automatically
 * carry the tag "attack", plus their attack tags ("projectile", "beam", ...).
 */
export interface TargetFilter {
  categories?: Category[];
  /** Matches if the organelle has any of these tags. */
  tags?: string[];
  /** Matches organelles sitting in these piece types (e.g. "triangle"). */
  pieceTypes?: string[];
  slotKinds?: SlotKind[];
}

export interface OnHitDef {
  status: string;
  /** Chance per hit to apply, 0 to 1. */
  chance: ByRarity;
  /** Multiplies the status's damage. Default 1. */
  potency?: ByRarity;
}

/** An effect an organelle (or upgrade) gives to other organelles. */
export interface GrantDef {
  /** "connected": only directly connected organelles. "global": every matching organelle in the build. */
  scope: 'connected' | 'global';
  to: TargetFilter;
  modifiers?: ModifierDef[];
  onHit?: OnHitDef[];
  /** Only applies while this condition is switched on. */
  when?: string;
}

export type AttackTag = 'projectile' | 'beam' | 'melee' | 'area' | 'trail';

export interface AttackDef {
  tags: AttackTag[];
  damage: ByRarity;
  attackSpeed: ByRarity;
  projectiles?: ByRarity;
  hits?: ByRarity;
  critChance?: ByRarity;
  critMultiplier?: ByRarity;
  pierce?: ByRarity;
  forks?: ByRarity;
  /** Hits every enemy in range (for multi-target DPS). */
  area?: boolean;
  onHit?: OnHitDef[];
}

export interface MitochondrionDef {
  /** What makes it fire, as shown in game. */
  trigger: string;
  /** Default guess at the share of a fight the trigger is active (0 to 1). Editable per build. */
  defaultUptime: number;
  /** Overcharge charges given to each connected organelle while active. */
  charges: ByRarity;
}

export interface OverchargeDef {
  /** The organelle's Overcharge tooltip line. */
  description: string;
  /** Applied to this organelle while it is Overcharged. */
  modifiers: ModifierDef[];
}

export interface OrganelleDef {
  id: string;
  name: string;
  /** Which kind of slot it goes in. */
  slot: SlotKind;
  category: Category;
  tags?: string[];
  description: string;
  attack?: AttackDef;
  /** Modifiers on the organelle itself (e.g. its own potency). */
  modifiers?: ModifierDef[];
  grants?: GrantDef[];
  mitochondrion?: MitochondrionDef;
  overcharge?: OverchargeDef;
  /** Does nothing unless Overcharged. */
  requiresOvercharge?: boolean;
  /** True until the numbers have been checked against the game. */
  placeholder?: boolean;
}

export interface TraitDef {
  id: string;
  name: string;
  description: string;
  /** Applied when the organelle has an attack (usually a damage bonus). */
  attackModifiers: ModifierDef[];
  /** Applied when it does not (usually a potency bonus). */
  otherModifiers: ModifierDef[];
  requiresOvercharge?: boolean;
  /** Organelle ids that can never have this trait. */
  excludes?: string[];
  placeholder?: boolean;
}

export interface GraftDef {
  id: string;
  name: string;
  description: string;
  /** Overrides which organelle kinds the slot accepts (Omni accepts both). */
  accepts?: SlotKind[];
  /** Applied to the organelle in the grafted slot. */
  modifiers: ModifierDef[];
  placeholder?: boolean;
}

export interface StatusDef {
  id: string;
  name: string;
  description: string;
  /** Damage per second per stack: dpsFlat + dpsFromHit x (damage of the hit that applied it). */
  dpsFlat: number;
  dpsFromHit: number;
  /** Seconds. */
  duration: number;
  /** 1 means re-applying only refreshes the duration. */
  maxStacks: number;
  placeholder?: boolean;
}

export interface ConditionDef {
  id: string;
  name: string;
  description: string;
}

export interface ParamDef {
  id: string;
  name: string;
  description: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface PieceTypeDef extends PieceShape {
  id: string;
  name: string;
  /** False for the core, which every build starts with. */
  addable: boolean;
}

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  maxStacks: number;
  /** Values are multiplied by the number of stacks taken. */
  grants: GrantDef[];
  placeholder?: boolean;
}

export interface ClassDef {
  id: string;
  name: string;
  description: string;
  corePiece: string;
  pieceTypes: PieceTypeDef[];
  upgrades: UpgradeDef[];
  /** Always-on class effects. */
  passives: GrantDef[];
}

export interface GameData {
  /** Game version these numbers were taken from. */
  gameVersion: string;
  rarities: { id: Rarity; name: string; color: string }[];
  organelles: OrganelleDef[];
  traits: TraitDef[];
  grafts: GraftDef[];
  statuses: StatusDef[];
  conditions: ConditionDef[];
  params: ParamDef[];
  classes: ClassDef[];
  constants: {
    /** Crit damage multiplier when an attack doesn't set its own. */
    baseCritMultiplier: number;
  };
}

// ---------------------------------------------------------------------------
// Saved builds

export interface OrganelleInstance {
  id: string;
  rarity: Rarity;
  traits: string[];
}

export interface SlotState {
  organelle?: OrganelleInstance;
  graft?: string;
  /** Mitochondria: overrides the default trigger uptime (0 to 1). */
  uptime?: number;
  /** Leave this organelle out of the DPS total (e.g. it faces away from the target). */
  excluded?: boolean;
}

export type CustomTarget = 'attacks' | 'projectiles' | 'weapons' | 'everything';

/** A free-form bonus for things the data doesn't cover yet (plasmids, events...). */
export interface CustomModifier {
  id: string;
  label: string;
  target: CustomTarget;
  stat: StatKey;
  op: ModifierOp;
  value: number;
}

export interface Build {
  version: 1;
  name: string;
  classId: string;
  pieces: PieceInstance[];
  slots: Record<string, SlotState>;
  upgrades: Record<string, number>;
  conditions: Record<string, boolean>;
  params: Record<string, number>;
  /** Number of enemies in range, for multi-target DPS. */
  targets: number;
  custom: CustomModifier[];
}
