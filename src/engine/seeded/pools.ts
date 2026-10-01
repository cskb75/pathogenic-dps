// The game's reward pools and how your build changes their weights, from
// src/data/seeded.json (tools/extract/seeded.py).
//
// Every mutation and organelle has a base weight, and some scripts scale it by
// what you have (modify_drop_rate): an organelle already in your body is 25%
// more likely, Overcharge mutations need an active organelle, and so on.

import raw from '../../data/seeded.json';
import { findClass, fullHp } from '../calc';
import { mutationStacks } from '../run';
import type { Build, GameData } from '../types';

export interface SeededMutation {
  /** The resource's file name in the game (armor_mutation). */
  key: string;
  name: string;
  weight: number;
  /** Weight as an organelle reward (0: never one). */
  reward: number;
  unlock: boolean;
  /** The script that scales its weight, if any. */
  rule: string | null;
}

export interface SeededOrganelle {
  key: string;
  name: string;
  weight: number;
  tags: number[];
  /** Extra weight in the devil room. */
  devil: number;
  noPrefixes: boolean;
  excitable: boolean;
  onlyCommon: boolean;
  /** Has to be unlocked first (by a stat in your save). */
  unlock: boolean;
  needsEnergy: boolean;
  active: boolean;
  lash: boolean;
  tentacle: boolean;
  burn: boolean;
  freeze: boolean;
  hormesis: boolean;
  rule?: string;
  boost?: number;
}

/** A pedestal that rolls its organelle when it enters the tree (bodypart_reward.gd). */
export interface PickDraw {
  kind: 'pick';
  path: string;
  itemType: number;
  pool: { key: string; mutation: boolean }[] | null;
  mutations: boolean;
  rarity: [number, number];
  unique: string[];
  chooseOne: boolean;
  devil: boolean;
}

/** Something for sale: its price is rolled from the stream (shop_item.gd). */
export interface ShopDraw {
  kind: 'shop';
  path: string;
  cost: number;
  sale: boolean;
  blood: boolean;
  skipScaling: boolean;
  /** Scripts of what it sells: bodypart_reward, dna_pickup, health_pickup, armor_pickup. */
  contents: string[];
}

/** One to three pedestals, rolled when the room hands out its rewards (bodypart_reward_3_choice.gd). */
export interface ChoiceDraw {
  kind: 'choice';
  path: string;
  /** Which of its three spots are used. */
  shown: boolean[];
  money: boolean;
}

/** A normal room's end-of-room drops (reward.gd). */
export interface DropDraw {
  kind: 'drop';
  path: string;
}

export type Draw = PickDraw | ShopDraw | ChoiceDraw | DropDraw;

export interface SeededRoom {
  key: string;
  weight: number;
  draws: Draw[];
}

export interface SeededFloor {
  level: number;
  key: string;
  name: string;
  /** Normal rooms, each drawing once. */
  rooms: number;
  layout: string;
  roomDraws: number[];
  start: number;
  bosses: { key: string; draws: Draw[] }[];
  tiers?: number[];
  hub?: string[];
}

export interface SeededData {
  alphabet: string;
  mutations: SeededMutation[];
  organelles: SeededOrganelle[];
  players: Record<string, { kind: string; maxStamina: number; dodgeCd: number; dodgeInvul: number }>;
  floors: SeededFloor[];
  shop: Draw[];
  heartShop: Draw[];
  itemRooms: SeededRoom[];
  special: SeededRoom[];
  secret: SeededRoom[];
  rules: {
    prefixChance: number;
    maxDodgeUptime: number;
    invulAdd: number;
    cdMult: number;
    staminaAdd: number;
    shopDiscount: number;
    betterDrops: number;
    betterDropsPlasmid: number;
    betterDropsPerFloor: number;
  };
}

export const seeded = raw as SeededData;

/** G.BodypartTags. */
export const TAG = {
  EnergyGenerator: 0,
  Weapon: 2,
  AttackModifier: 3,
  Internal: 6,
  External: 7,
  Any: 8,
  Active: 9,
  ShootsBullets: 13,
  Upgrade: 14,
  MeleeWeapon: 17,
  CreatesLightning: 19,
  SpawnsMinions: 20,
} as const;

/** Bodypart.Rarity, as the app's rarity ids. */
export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
/** G.PREFIXES in the order the game rolls them, as the app's trait ids. */
export const PREFIXES = ['eternal', 'ephemeral', 'excitable', 'cancerous'] as const;

const organelleByKey = new Map(seeded.organelles.map((o) => [o.key, o]));
const mutationByKey = new Map(seeded.mutations.map((m) => [m.key, m]));
export const findOrganelle = (key: string) => organelleByKey.get(key);
export const findMutation = (key: string) => mutationByKey.get(key);

/** The app's ids for the game's mutations and organelles. */
export interface Ids {
  mutationApp: Map<string, string>;
  mutationKey: Map<string, string>;
  organelleApp: Map<string, string>;
  organelleKey: Map<string, string>;
}

const idCache = new WeakMap<GameData, Ids>();
export function ids(data: GameData): Ids {
  let out = idCache.get(data);
  if (out) return out;
  const byName = new Map(data.mutations.map((m) => [m.name, m.id]));
  const mutationApp = new Map<string, string>();
  for (const m of seeded.mutations) {
    const id = byName.get(m.name);
    if (id) mutationApp.set(m.key, id);
  }
  const organelleApp = new Map<string, string>();
  for (const o of data.organelles) if (o.gameId) organelleApp.set(o.gameId, o.id);
  const flip = (m: Map<string, string>) => new Map([...m].map(([k, v]) => [v, k]));
  out = { mutationApp, mutationKey: flip(mutationApp), organelleApp, organelleKey: flip(organelleApp) };
  idCache.set(data, out);
  return out;
}

/** What the game looks at when it weighs a reward: your pathogen, body and mutations. */
export interface PoolContext {
  /** The player script: Player, PlayerStrafer, PlayerAmoeba or PlayerNanobot. */
  kind: string;
  /** Organelles in the body (game keys). */
  slots: string[];
  /** Mutation stacks by game key, including those from plasmids. */
  mutations: Record<string, number>;
  maxStamina: number;
  dodgeCd: number;
  dodgeInvul: number;
  /** Two or more HP missing (Full Heal is only offered then). */
  missingHp: boolean;
}

/** Things your save decides, which the seed can't know. */
export interface Unlocks {
  /** Organelles prefixes (Eternal, Ephemeral...) can roll on. */
  prefixes: boolean;
  /** Bosses beaten without a hit can open a devil room. */
  devilRoom: boolean;
  /** Organelles not unlocked yet (game keys): the game skips them. */
  locked: string[];
}

export const defaultUnlocks: Unlocks = { prefixes: true, devilRoom: true, locked: [] };

export function poolContext(build: Build, data: GameData): PoolContext {
  const cls = findClass(data, build.classId);
  const { mutationKey, organelleKey } = ids(data);
  const player = seeded.players[build.classId] ?? { kind: 'Player', maxStamina: 100, dodgeCd: 1.2, dodgeInvul: 0.3 };
  const mutations: Record<string, number> = {};
  for (const [id, n] of mutationStacks(build, cls)) {
    const key = mutationKey.get(id);
    if (key) mutations[key] = (mutations[key] ?? 0) + n;
  }
  const slots = Object.values(build.slots)
    .map((s) => (s.organelle ? organelleKey.get(s.organelle.id) : undefined))
    .filter((k): k is string => !!k);
  const { rules } = seeded;
  const hp = build.params.hp ?? fullHp(build, data);
  return {
    kind: player.kind,
    slots,
    mutations,
    maxStamina: player.maxStamina + rules.staminaAdd * (mutations.stamina_mutation ?? 0),
    dodgeCd: player.dodgeCd * rules.cdMult ** (mutations.dodge_cd_mutation ?? 0),
    dodgeInvul: player.dodgeInvul + rules.invulAdd * (mutations.dodge_invul_mutation ?? 0),
    missingHp: fullHp(build, data) - hp >= 2,
  };
}

const has = (ctx: PoolContext, test: (o: SeededOrganelle) => boolean) =>
  ctx.slots.some((k) => {
    const o = organelleByKey.get(k);
    return !!o && test(o);
  });
const tagged = (tag: number) => (o: SeededOrganelle) => o.tags.includes(tag);
/** bodypart_resource.is_combat_active(false). */
const combatActive = (o: SeededOrganelle) => o.tags.includes(TAG.Active) && !o.tags.includes(TAG.EnergyGenerator) && o.key !== 'reroll_active';
const owns = (ctx: PoolContext, key: string) => (ctx.mutations[key] ?? 0) > 0;

/** A mutation's modify_drop_rate: what its weight is multiplied by. */
export function mutationFactor(m: SeededMutation, ctx: PoolContext): number {
  const { rules } = seeded;
  const yes = (b: boolean) => (b ? 1 : 0);
  switch (m.rule) {
    case null:
      return 1;
    case 'actives_energy_mutation':
      return yes(has(ctx, (o) => o.active));
    case 'auto_actives_mutation':
      return owns(ctx, m.key) ? 0 : yes(has(ctx, combatActive));
    case 'passive_overcharge_mutation':
      return yes(has(ctx, combatActive));
    case 'chemotactic_cascade_mutation':
      return yes(has(ctx, (o) => o.tentacle));
    case 'cryolysis_mutation':
      return yes(has(ctx, (o) => o.freeze));
    case 'pyrogenesis_mutation':
      return yes(has(ctx, (o) => o.burn));
    case 'hormesis_mutation':
      return yes(has(ctx, (o) => o.hormesis));
    case 'speed_damage_mutation':
      return yes(has(ctx, (o) => o.lash));
    case 'damage_slot_mutation':
    case 'energy_slot_mutation':
    case 'turret_slot_mutation':
    case 'turret_eslot_mutation':
      return yes(ctx.kind !== 'PlayerStrafer');
    case 'dodge_cd_mutation':
      return yes(!(ctx.dodgeInvul / (ctx.dodgeCd * rules.cdMult) > rules.maxDodgeUptime));
    case 'dodge_invul_mutation':
      return yes(!((ctx.dodgeInvul + rules.invulAdd) / ctx.dodgeCd > rules.maxDodgeUptime));
    case 'energy_generation_mutation':
    case 'respiratory_burst_mutation':
      return yes(has(ctx, tagged(TAG.EnergyGenerator)));
    case 'full_heal_mutation':
      return yes(ctx.missingHp);
    case 'galvanic_arborization_mutation':
      return yes(has(ctx, tagged(TAG.CreatesLightning)));
    case 'myofibrillar_hypertrophy_mutation':
      return yes(has(ctx, tagged(TAG.MeleeWeapon)));
    case 'nidal_degranulation_mutation':
      return yes(has(ctx, tagged(TAG.SpawnsMinions)));
    case 'no_stamina_mutation':
      return yes(!owns(ctx, m.key));
    case 'random_mitochondrion_mutation':
      return has(ctx, (o) => o.needsEnergy) && !has(ctx, tagged(TAG.EnergyGenerator)) ? 4 : 1;
    case 'stamina_mutation':
      return ctx.maxStamina <= 100 ? 2 : 1;
    case 'amoeba_evolution':
      return yes(ctx.kind === 'PlayerAmoeba');
    case 'nanobot_body_extension':
      return yes(ctx.kind === 'PlayerNanobot');
    default:
      return 1;
  }
}

/** An organelle's modify_drop_rate. */
export function organelleFactor(o: SeededOrganelle, ctx: PoolContext, unlocks: Unlocks): number {
  // bodypart_resource.gd: one you already have is a bit more likely.
  const base = ctx.slots.includes(o.key) ? 1.25 : 1;
  const melee = has(ctx, tagged(TAG.MeleeWeapon));
  switch (o.rule) {
    case undefined:
      return base;
    case 'symbiotic_pseudopod_resource':
      return has(ctx, tagged(TAG.SpawnsMinions)) ? 1 : 0;
    case 'slash_charge_resource':
      return melee ? base : 0;
    case 'range_extender_resource':
      return melee ? base * (o.boost ?? 1) : base;
    case 'melee_on_ranged_resource':
      return melee && has(ctx, tagged(TAG.ShootsBullets)) ? base : 0;
    case 'add_prefix_improvement_resource':
      return unlocks.prefixes ? 1 : 0;
    default:
      return base;
  }
}

/** Organelles with this tag, in the game's order (G.bodyparts_with_tag). */
export const withTag = (tag: number) => (tag === TAG.Any ? seeded.organelles : seeded.organelles.filter((o) => o.tags.includes(tag)));
