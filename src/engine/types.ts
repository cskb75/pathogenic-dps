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

export interface ClassDef {
  id: string;
  name: string;
  description: string;
  corePiece: string;
  pieceTypes: PieceTypeDef[];
  upgrades: UpgradeDef[];
}

export interface GameData {
  /** Where the numbers come from. */
  dataSource: string;
  rarities: { id: Rarity; name: string; color: string }[];
  organelles: OrganelleInfo[];
  traits: TraitDef[];
  grafts: GraftDef[];
  params: ParamDef[];
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
  params: Record<string, number>;
  /** Number of enemies in range, for multi-target DPS. */
  targets: number;
  custom: CustomModifier[];
}
