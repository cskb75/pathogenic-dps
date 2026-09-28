// Types for game content and saved builds.
//
// Organelle *behaviour* (what each one does to attacks) lives in code under
// src/engine/sim, mirroring the game's own scripts. The data here describes
// the catalogue: names, slots, categories, rarities, traits, grafts, and the
// fight assumptions the player can tune.

import type { Growth } from './amoeba';
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
  /** Internal name in the game files. */
  gameId?: string;
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

/** Slot types some bodies have built in (the same effects as grafts). */
export type SpecialSlot = 'volatile' | 'conductive' | 'omni';

export interface PlanSlot {
  /** The game's slot name (ESlot1, ISlot2...): organelles keep their slot when you evolve. */
  id: string;
  kind: SlotKind;
  special?: SpecialSlot;
  /** Position in editor units (100 game pixels = 1), y pointing toward the tail. */
  x: number;
  y: number;
  /** Direction the slot faces, in radians. */
  r: number;
  /** Mirrored twin of this slot on the other side: always holds a copy of its organelle. */
  mirrorOf?: string;
}

/** A fixed body layout: a class's starting body or one of its evolutions. */
export interface BodyPlan {
  id: string;
  name: string;
  /** 0 for the starting body, then the evolution tier. */
  tier: number;
  slots: PlanSlot[];
  /** Connected slot pairs. */
  links: [string, string][];
  outline: [number, number][];
  /** Body art, drawn with its top-left corner at (x, y). Paths are relative to the site root. */
  sprite?: { src: string; x: number; y: number; w: number; h: number };
  /** Share of base damage added to every attack from then on. */
  bonusDamage?: number;
  bonusHp?: number;
  /** Stamina containers (100 stamina each) added. */
  bonusStamina?: number;
  description?: string;
}

/** Nanobot-style bodies: modules attached edge to edge. */
export interface ModularBody {
  kind: 'modular';
  corePiece: string;
  pieceTypes: PieceTypeDef[];
}

/** Bodies that grow blobs where you place them (the Amoeba). */
export interface FreeformBody {
  kind: 'freeform';
  /** Body plan id of the starting body. */
  start: string;
}

/** Bodies with fixed layouts that change when you evolve. */
export interface EvolvingBody {
  kind: 'evolving';
  /** Body plan ids. */
  start: string;
  /** Evolution choices at each level-up tier. */
  tiers: string[][];
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
  /** Organelles in one part of the body (Chirality, Dorsal Dominance...). */
  zone?: ZoneEffect;
  /** Applies while at or below this HP. */
  lowHp?: { maxHp: number; damage: number; attackSpeed: number };
  /** Extra Overcharge strength for mitochondria (and Vesicles). */
  generatorStrength?: number;
  /** Active organelles need this much less Overcharge to use (0.25 = 25% less). */
  activeCost?: number;
  /** Extra Overcharge strength for active organelles (0.35 = they charge 35% faster). */
  activeCharge?: number;
  /** Overcharge active organelles get on their own. */
  activeFlatCharge?: number;
  /** Share of base damage per pseudopod reaching for an enemy. */
  perPseudopod?: number;
  /** Share of base damage per point of thrust from flagella. */
  perThrust?: number;
  /** Multiplies all damage (Glycogen Funnel: 0.7). */
  damageMultiplier?: number;
  /** Extra stamina containers (100 stamina each). */
  staminaContainers?: number;
  /** Share of base damage per empty stamina container. */
  starvation?: number;
  /** Weapons stop costing stamina. */
  noStamina?: boolean;
}

/**
 * An effect for organelles in one part of the body, measured from the body's
 * centre with the front of the body up (the game uses the organelle's slot).
 */
export interface ZoneEffect {
  side: 'left' | 'right' | 'top' | 'bottom';
  /** How far from the centre line a slot must be to count (editor units: 0.15 = 15 game pixels). */
  threshold: number;
  /** Share of base damage for attacks from organelles in the zone. */
  damage?: number;
  /** Share of base damage for attacks from organelles on the opposite side. */
  opposite?: number;
  /** Only melee attacks. */
  meleeOnly?: boolean;
  /** Extra Overcharge strength for mitochondria in the zone. */
  generatorStrength?: number;
  /** Active organelles in the zone need this much less Overcharge. */
  activeCost?: number;
  /** Active organelles in the zone charge this much faster. */
  activeCharge?: number;
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

/** A node of a pathogen's plasmid tree. */
export interface PlasmidDef {
  id: string;
  name: string;
  description: string;
  effects?: RunEffects;
  /** Start the run with this mutation (counts as one stack of it). */
  mutation?: string;
  notes?: string;
  /** Position in the tree, in game pixels (y down). */
  x: number;
  y: number;
  /** Nodes this one unlocks. */
  links: string[];
  /** Icon path relative to the site root. */
  icon?: string;
  /** The tree's root: always owned. */
  root?: boolean;
}

export interface ClassDef {
  id: string;
  name: string;
  /** One-line summary shown in the class picker. */
  tagline: string;
  description: string;
  /** Max HP at the start of a run. */
  hp: number;
  /** Portrait image, relative to the site root. */
  portrait?: string;
  /** Where the class's data comes from. */
  source: string;
  body: ModularBody | EvolvingBody | FreeformBody;
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
  bodies: Record<string, BodyPlan>;
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
  /** Modular classes: the modules, in attachment order. */
  pieces: PieceInstance[];
  /** Evolving classes: the evolution picked at each tier ('' = not yet, or skipped). */
  evolutions: string[];
  /** Freeform classes (Amoeba): the blobs grown, in order. */
  growth?: Growth[];
  slots: Record<string, SlotState>;
  /** Mutations picked this run (DNA upgrades): id -> times picked. */
  mutations: Record<string, number>;
  /** Plasmids bought: id -> number of nodes. */
  plasmids: Record<string, number>;
  params: Record<string, number>;
  /** Number of enemies in range, for multi-target DPS. */
  targets: number;
  custom: CustomModifier[];
}
