// What the seeded run panel shows: the run log and your build, turned into the
// cards and rewards the seed offers.

import type { SeededRun } from '../../state/seededRun';
import { currentLevel, floorLog, rerollsBefore } from '../../state/seededRun';
import { evolutionOffer, findClass } from '../calc';
import { mutationStacks } from '../run';
import type { Build, GameData, OrganelleInstance } from '../types';
import { GodotRng } from './godot';
import {
  EVOLUTION_LEVELS,
  devilPortal,
  fillPedestal,
  floorStream,
  mutationGift,
  mutationRoll,
  rarityId,
  rollChoice,
  roomPedestals,
  shopState,
  type FloorStream,
  type Pedestal,
  type Reward,
  type RollContext,
  type ShopState,
} from './offers';
import { TAG, ids, poolContext, seeded, type ChoiceDraw, type PoolContext, type SeededMutation, type SeededOrganelle } from './pools';

/** A reward as the panel shows it. */
export interface RewardView {
  /** Where it is, for remembering it was taken: "boss:0", "item1:2"... */
  at: string;
  reward: Reward;
  name: string;
  /** The app's organelle or mutation id, when the app knows it. */
  appId?: string;
  taken: boolean;
}

export interface MutationCard {
  mutation: SeededMutation;
  appId?: string;
  /** "Gain a random weapon" and the like: the organelle it gives. */
  gift?: { organelle: SeededOrganelle; appId?: string };
}

export interface LevelView {
  level: number;
  /** Evolving pathogens pick an evolution at levels 2, 6 and 10 instead. */
  evolution?: { tier: number; guaranteed: string[]; pool: string[] };
  cards: MutationCard[];
  /** The next best mutations, for when the game showed something else. */
  more: MutationCard[];
  rerolls: number;
}

const BETTER_DROPS_PLASMID = /betterdropsprogressionplasmid/;

/** The rarity upgrades you have, in the order the game rolls them: plasmids (applied at the start), then Better Drops mutations. */
export function upgradeChances(build: Build, data: GameData, floor: number): number[] {
  const { rules } = seeded;
  const cls = findClass(data, build.classId);
  const out: number[] = [];
  for (const p of cls.plasmids) if ((build.plasmids[p.id] ?? 0) > 0 && BETTER_DROPS_PLASMID.test(p.id)) out.push(rules.betterDropsPerFloor * Math.max(0, floor - 1));
  const key = ids(data).mutationKey;
  let stacks = 0;
  for (const [id, n] of mutationStacks(build, cls)) if (key.get(id) === 'better_drops_mutation') stacks += n;
  for (let i = 0; i < stacks; i++) out.push(rules.betterDrops);
  return out;
}

export function rollContext(build: Build, data: GameData, run: SeededRun, floor: number, ctx: PoolContext = poolContext(build, data)): RollContext {
  return {
    ctx,
    unlocks: run.unlocks,
    // Every organelle on the Brain floor is legendary.
    rarity: { upgrades: upgradeChances(build, data, floor), prefixes: run.unlocks.prefixes, ...(floor === 7 ? { forced: 3 } : {}) },
  };
}

/** How many mutations the game counts you as having (picked, from plasmids, and evolutions). */
export function mutationCount(build: Build, data: GameData): number {
  let n = 0;
  for (const v of mutationStacks(build, findClass(data, build.classId)).values()) n += v;
  return n + build.evolutions.filter(Boolean).length;
}

export function levelView(run: SeededRun, build: Build, data: GameData): LevelView {
  const level = currentLevel(run);
  const cls = findClass(data, build.classId);
  const map = ids(data);
  const ctx = poolContext(build, data);
  const tier = EVOLUTION_LEVELS.indexOf(level);
  let evolution: LevelView['evolution'];
  if (cls.body.kind === 'evolving' && tier >= 0) {
    const offer = evolutionOffer(data, cls.body, build.evolutions, tier);
    evolution = { tier, guaranteed: offer.guaranteed, pool: offer.pool };
  }
  let roll = mutationRoll(run.seed, level, ctx);
  const before = rerollsBefore(run);
  for (let i = 0; i < run.rerolls; i++) roll = mutationRoll(run.seed, level, ctx, { count: before + i, shown: roll.cards.map((m) => m.key) });
  // A "random organelle" mutation counts itself among your mutations.
  const count = mutationCount(build, data) + 1;
  const card = (m: SeededMutation): MutationCard => {
    const gift = mutationGift(run.seed, m.key, count, ctx, run.unlocks);
    return { mutation: m, appId: map.mutationApp.get(m.key), ...(gift ? { gift: { organelle: gift, appId: map.organelleApp.get(gift.key) } } : {}) };
  };
  return { level, evolution, cards: roll.cards.map(card), more: roll.ranked.slice(4, 12).map(card), rerolls: run.rerolls };
}

export interface ShopView {
  state: ShopState;
  stalls: { index: number; label: string; price: ShopState['stalls'][number]['price']; bought: boolean; reward?: RewardView }[];
}

export interface FloorView {
  level: number;
  name: string;
  stream: FloorStream;
  /** Normal rooms before the boss (after your offset). */
  rooms: number;
  boss?: { rewards: RewardView[]; devil: boolean };
  shop: ShopView;
  /** Each item room's three choices: a room shows the first one, two or all three. */
  items: RewardView[][];
  special?: { key: string; rewards: RewardView[] };
  secret?: { key: string; rewards: RewardView[][] };
  /** Brain rooms each drop a legendary organelle: these, in some order. */
  brain?: RewardView[];
}

const CONSUMABLES: Record<string, string> = { dna_pickup: 'DNA', health_pickup: 'Health', armor_pickup: 'Armor' };

export function floorView(run: SeededRun, build: Build, data: GameData, level: number): FloorView {
  const log = floorLog(run, level);
  const map = ids(data);
  const live = rollContext(build, data, run, level);
  const generated = log.context ? rollContext(build, data, run, level, log.context) : live;
  const stream = floorStream(run.seed, level, { offset: log.offset, special: log.special, secret: log.secret });
  const view = (at: string, reward: Reward): RewardView => ({
    at,
    reward,
    name: reward.pick.item.name,
    appId: reward.pick.type === 'organelle' ? map.organelleApp.get(reward.pick.item.key) : map.mutationApp.get(reward.pick.item.key),
    taken: log.taken.includes(at),
  });
  const views = (prefix: string, rewards: Reward[]) => rewards.map((r, i) => view(`${prefix}:${i}`, r));

  let boss: FloorView['boss'];
  if (stream.boss) {
    const i = stream.boss.draws.findIndex((d) => d.kind === 'choice');
    if (i >= 0) {
      const draw = stream.boss.draws[i] as ChoiceDraw;
      const seed = stream.boss.seeds[i];
      boss = { rewards: views('boss', rollChoice(seed, draw, live)), devil: devilPortal(seed, draw) };
    }
  }

  const discount = seeded.rules.shopDiscount * (live.ctx.mutations.shop_discount_mutation ?? 0);
  const state = shopState(stream.shop, level, generated, live, discount, log.shop);
  const shop: ShopView = {
    state,
    stalls: state.stalls.map((s, index) => {
      const pedestal = s.pedestal !== undefined ? state.pedestals[s.pedestal] : undefined;
      const consumable = s.draw.contents.filter((c) => CONSUMABLES[c]);
      const label = pedestal?.reward ? pedestal.reward.pick.item.name : consumable.length ? `${consumable.length > 1 ? `${consumable.length} ` : ''}${CONSUMABLES[consumable[0]]}` : 'Item';
      return { index, label, price: s.price, bought: s.bought, reward: pedestal?.reward ? view(`shop:${index}`, pedestal.reward) : undefined };
    }),
  };

  const itemDraw = seeded.itemRooms[0].draws[0] as ChoiceDraw;
  const items = stream.items.map((seed, i) => views(`item${i + 1}`, rollChoice(seed, itemDraw, live)));

  let special: FloorView['special'];
  if (stream.special && log.special) special = { key: log.special, rewards: views('special', roomPedestals(stream.special, live).map((p) => p.reward).filter((r): r is Reward => !!r)) };
  let secret: FloorView['secret'];
  if (stream.secret && log.secret) {
    const rooms = stream.secret.draws.map((d, i) => (d.kind === 'choice' ? views(`secret${i + 1}`, rollChoice(stream.secret!.seeds[i], d, live)) : [])).filter((r) => r.length);
    secret = { key: log.secret, rewards: rooms };
  }

  let brain: RewardView[] | undefined;
  if (level === 7) {
    // reward.gd: on the Brain, a normal room's first roll seeds a legendary organelle, never a mutation.
    brain = stream.rooms.map((roomSeed, i) => {
      const p: Pedestal = { draw: { itemType: TAG.Any, pool: null, mutations: false, devil: false, rarity: [0, 0] }, seed: new GodotRng(roomSeed).randi(), reward: null, rerolledAway: [] };
      const filled = fillPedestal(p, [], live);
      return filled.reward ? view(`brain:${i}`, filled.reward) : null;
    }).filter((r): r is RewardView => !!r);
  }

  return { level, name: stream.floor.name, stream, rooms: stream.rooms.length, boss, shop, items, special, secret, brain };
}

/** An organelle reward as the editor holds it. */
export function toInstance(r: RewardView): OrganelleInstance | null {
  if (r.reward.pick.type !== 'organelle' || !r.appId) return null;
  return { id: r.appId, rarity: rarityId(r.reward.rarity), traits: r.reward.traits };
}
