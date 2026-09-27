// Types for game content and saved builds.
//
// Organelle *behaviour* (what each one does to attacks) lives in code under
// src/engine/sim, mirroring the game's own scripts. The data here describes
// the catalogue: names, slots, categories, rarities, traits, grafts, and the
// fight assumptions the player can tune.

import type { SlotKind, PieceShape } from './body';
import type { PieceInstance } from './geometry';

export type { SlotKind } from './body';

export const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Rarity = (typeof RARITIES)[number];

export type Category = 'weapon' | 'infuser' | 'mitochondrion' | 'flagellum' | 'active' | 'pseudopod' | 'minion' | 'support';

export interface OrganelleInfo {
  /** Stable id (wiki slug), used in saved builds. */
  id: string;
  name: string;
  slot: SlotKind;
  category: Category;
  /** Infusers: which attacks they touch. Weapons: melee or ranged. */
  subtype?: 'attack' | 'projectile' | 'weapon' | 'melee' | 'ranged';
  /** In-game description. */
  description: string;
  /** Internal id in the game files, when the organelle exists in the demo build. */
  demoId?: string;
}

export interface TraitDef {
  id: string;
  name: string;
  description: string;
  /** "+N stat boost": treated as N extra rarity steps in every rarity formula. */
  tiers: number;
  /** Only works while Overcharged. */
  requiresCharge?: boolean;
}

export interface GraftDef {
  id: 'volatile' | 'conductive' | 'omni';
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
  /** Shown as a percentage in the UI. */
  percent?: boolean;
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
  /** Extra damage (as a share of base damage) for weapons on these piece types, per stack. */
  pieceDamage?: { pieceTypes: string[]; bonus: number };
  /** Numbers not confirmed from the game files yet. */
  unverified?: boolean;
}

/**
 * What a mutation (or a plasmid) does to damage. Values are per stack; the
 * game adds most of them as a share of base damage to every attack.
 */
export interface RunEffects {
  /** Share of base damage added to every attack. */
  damage?: number;
  /** Share of base damage added to melee attacks. */
  meleeDamage?: number;
  /** Attack speed bonus (adds with weapon infusers). */
  attackSpeed?: number;
  /** Share of base damage per core held. */
  perCore?: number;
  /** Share of base damage per empty internal slot. */
  perEmptyInternal?: number;
  /** Share of base damage per active mitochondrion. */
  perActiveMito?: number;
  /** Share of base damage per boss beaten this run. */
  perBoss?: number;
  /** +bonus, minus perWeapon for each weapon equipped, never below floor. */
  focused?: { bonus: number; perWeapon: number; floor: number };
  /** Weapons on one half of the body gain, the other half lose. */
  chirality?: { side: 'left' | 'right'; bonus: number; penalty: number };
  /** Applies while at or below this HP. */
  lowHp?: { maxHp: number; damage: number; attackSpeed: number };
  /** Extra Overcharge strength for mitochondria (and Vesicles). */
  generatorStrength?: number;
  /** Extra stamina containers (100 stamina each). */
  staminaContainers?: number;
  /** Share of base damage per empty stamina container. */
  starvation?: number;
  /** Weapons stop costing stamina. */
  noStamina?: boolean;
}

export interface MutationDef {
  id: string;
  name: string;
  category: string;
  description: string;
  effects?: RunEffects;
  /** How the calculator treats it, shown in the UI. */
  notes?: string;
}

export interface PlasmidDef {
  id: string;
  name: string;
  description: string;
  effects?: RunEffects;
  /** Start the run with this mutation (counts as one stack of it). */
  mutation?: string;
  notes?: string;
}

export interface ClassDef {
  id: string;
  name: string;
  description: string;
  corePiece: string;
  pieceTypes: PieceTypeDef[];
  upgrades: UpgradeDef[];
  plasmids: PlasmidDef[];
}

export interface GameData {
  /** Where the numbers come from. */
  dataSource: string;
  rarities: { id: Rarity; name: string; color: string }[];
  organelles: OrganelleInfo[];
  traits: TraitDef[];
  grafts: GraftDef[];
  params: ParamDef[];
  mutations: MutationDef[];
  classes: ClassDef[];
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
  /** Mitochondria: overrides the estimated trigger uptime (0 to 1). */
  uptime?: number;
  /** Leave this weapon out of the DPS total (e.g. it can't aim at the target). */
  excluded?: boolean;
}

export type CustomKind = 'damage' | 'damageMult' | 'attackSpeed' | 'overchargeStrength';

/** A free-form bonus for things the calculator doesn't cover yet (plasmids, mutations...). */
export interface CustomModifier {
  id: string;
  label: string;
  kind: CustomKind;
  /** damage / attackSpeed / overchargeStrength: +0.25 = +25%. damageMult: 1.5 = x1.5. */
  value: number;
}

export interface Build {
  version: 2;
  name: string;
  classId: string;
  pieces: PieceInstance[];
  slots: Record<string, SlotState>;
  upgrades: Record<string, number>;
  /** Mutations picked this run (DNA upgrades): id -> times picked. */
  mutations: Record<string, number>;
  /** Plasmids bought: id -> number of nodes. */
  plasmids: Record<string, number>;
  params: Record<string, number>;
  /** Number of enemies in range, for multi-target DPS. */
  targets: number;
  custom: CustomModifier[];
}
