// What a seed offers, worked out the way the game rolls it.
//
// Level-up cards (editor.gd): hash(seed + "mut" + level) ranks the mutation
// pool; a reroll uses hash(seed + "reroll" + rerolls so far + "mut" + level)
// and leaves out the cards it replaces.
//
// Rewards (bodypart_reward.gd): every pedestal gets a number from its floor's
// reward stream, hash(seed + "rewards" + floor), and ranks the pool with it;
// the best one no sibling pedestal shows wins. Rooms take their numbers from
// the stream in the order the floor is built (level_generator.gd and
// level_config.gd): every normal room (one each), the boss, the shop, the item
// rooms, then the special and secret rooms. Inside a room, pedestals draw as
// they enter the tree, before anything draws in _ready.
//
// Ranking (utils.gd, pick_weighted_stable_top_n): each item i gets
// log(u) / weight, with u the first randf() of hash(str(seed) + "_" + str(i)),
// highest first. An item's place doesn't depend on the others' weights, and
// locked items just drop out.

import { GodotRng, godotHash, roundi } from './godot';
import {
  PREFIXES,
  RARITIES,
  TAG,
  findMutation,
  findOrganelle,
  mutationFactor,
  organelleFactor,
  seeded,
  withTag,
  type ChoiceDraw,
  type Draw,
  type PickDraw,
  type PoolContext,
  type SeededFloor,
  type SeededMutation,
  type SeededOrganelle,
  type SeededRoom,
  type ShopDraw,
  type Unlocks,
} from './pools';

export type RewardItem = { type: 'organelle'; item: SeededOrganelle } | { type: 'mutation'; item: SeededMutation };

/** A rolled organelle (or mutation) on a pedestal. */
export interface Reward {
  /** The pedestal's own seed. */
  seed: number;
  pick: RewardItem;
  /** Organelles: 0 common to 3 legendary. */
  rarity: number;
  /** Prefixes rolled (the app's trait ids). */
  traits: string[];
}

export const sameReward = (a: RewardItem, b: RewardItem) => a.type === b.type && a.item.key === b.item.key;

/** pick_weighted_stable_top_n: the items in the order the game ranks them. */
export function stableOrder<T>(items: T[], weights: number[], parentSeed: number, unlocked: (item: T) => boolean = () => true): T[] {
  const scored: [number, T][] = [];
  items.forEach((item, i) => {
    if (!unlocked(item)) return;
    const w = weights[i];
    if (!(w > 0)) return;
    let u = new GodotRng(godotHash(`${parentSeed}_${i}`)).randf();
    if (u <= 0) u = 1e-12;
    scored.push([Math.log(u) / w, item]);
  });
  return scored.sort((a, b) => b[0] - a[0]).map(([, item]) => item);
}

export const isValidSeed = (seed: string) => seed.length === 8 && [...seed].every((c) => seeded.alphabet.includes(c));
/** Tidies typed text into a seed: capitals, no spaces, only the characters seeds use. */
export const normalizeSeed = (text: string) =>
  [...text.toUpperCase()].filter((c) => seeded.alphabet.includes(c)).join('').slice(0, 8);

// ---------------------------------------------------------------------------
// Level-ups

/** The level-ups at which evolving pathogens pick an evolution instead of a mutation. */
export const EVOLUTION_LEVELS = [2, 6, 10];

export interface MutationRoll {
  /** The four cards, left to right. */
  cards: SeededMutation[];
  /** Every mutation that could show up, best-ranked first (the cards are the first four). */
  ranked: SeededMutation[];
}

/**
 * The cards at a level-up. `rerolls` is how many rerolls you've used this run
 * before this one, and `shown` the cards being rerolled away.
 */
export function mutationRoll(seed: string, level: number, ctx: PoolContext, reroll?: { count: number; shown: string[] }): MutationRoll {
  const parent = godotHash(reroll ? `${seed}reroll${reroll.count}mut${level}` : `${seed}mut${level}`);
  const pool = seeded.mutations;
  const exclude = new Set(reroll?.shown ?? []);
  const weigh = (list: SeededMutation[]) => list.map((m) => m.weight * mutationFactor(m, ctx));
  const candidates = exclude.size ? pool.filter((m) => !exclude.has(m.key)) : pool;
  let ranked = stableOrder(candidates, weigh(candidates), parent);
  // Leaving out the shown cards starved the pool: repeats beat empty cards.
  if (ranked.length < 4 && candidates.length < pool.length) ranked = stableOrder(pool, weigh(pool), parent);
  return { cards: ranked.slice(0, 4), ranked };
}

/**
 * The organelle a "random" mutation gives (Gain a random weapon, mitochondrion
 * or modifier): seeded by how many mutations you have, counting it.
 */
export function mutationGift(seed: string, key: string, mutationCount: number, ctx: PoolContext, unlocks: Unlocks): SeededOrganelle | null {
  const notConduit = (o: SeededOrganelle) => o.key !== 'conduit';
  const internal = (o: SeededOrganelle) => o.tags.includes(TAG.Internal);
  let list: SeededOrganelle[];
  if (key === 'random_weapon_mutation') list = withTag(TAG.Weapon).filter(notConduit);
  else if (key === 'random_modifier_mutation') list = withTag(TAG.AttackModifier).filter((o) => internal(o) && notConduit(o));
  else if (key === 'random_mitochondrion_mutation')
    list = withTag(TAG.EnergyGenerator).filter((o) => internal(o) && notConduit(o) && o.key !== 'charge_active' && organelleFactor(o, ctx, unlocks) > 0);
  else return null;
  if (!list.length) return null;
  // Utils.pick_random_unlocked
  const sub = new GodotRng(new GodotRng(godotHash(`${seed}_mutation_${mutationCount}`)).randi());
  const pick = list[sub.randiRange(0, list.length - 1)];
  const open = (o: SeededOrganelle) => !o.unlock || !unlocks.locked.includes(o.key);
  if (open(pick)) return pick;
  const unlocked = list.filter(open);
  return unlocked.length ? unlocked[sub.randiRange(0, unlocked.length - 1)] : pick;
}

// ---------------------------------------------------------------------------
// Rewards

/** A pedestal's pool and weights (pick_bodypart and _build_pool_with_modifications). */
export function rewardPool(draw: Pick<PickDraw, 'itemType' | 'pool' | 'mutations' | 'devil'>, ctx: PoolContext, unlocks: Unlocks): { items: RewardItem[]; weights: number[] } {
  let items: RewardItem[];
  let weights: number[];
  if (draw.pool) {
    // A fixed pool keeps its own weights.
    items = draw.pool
      .map((p): RewardItem | null => {
        const m = p.mutation ? findMutation(p.key) : undefined;
        const o = p.mutation ? undefined : findOrganelle(p.key);
        return m ? { type: 'mutation', item: m } : o ? { type: 'organelle', item: o } : null;
      })
      .filter((r): r is RewardItem => !!r);
    weights = items.map((r) => r.item.weight);
  } else {
    const build = (tag: number) => {
      const list: RewardItem[] = withTag(tag).map((o) => ({ type: 'organelle', item: o }));
      if (draw.mutations && tag === TAG.Any)
        for (const m of seeded.mutations) if (m.reward > 0) list.push({ type: 'mutation', item: m });
      const w = list.map((r) =>
        r.type === 'organelle' ? r.item.weight * organelleFactor(r.item, ctx, unlocks) : r.item.reward * mutationFactor(r.item, ctx),
      );
      return { list, w };
    };
    let built = build(draw.itemType);
    if (!built.w.some((w) => w > 0)) built = build(TAG.Any);
    items = built.list;
    weights = built.w;
  }
  if (draw.devil) weights = weights.map((w, i) => (items[i].type === 'organelle' ? w + (items[i].item as SeededOrganelle).devil : w));
  if (!(weights.reduce((a, b) => a + b, 0) > 0)) weights = items.map(() => 1);
  return { items, weights };
}

export const isUnlocked = (unlocks: Unlocks) => (r: RewardItem) => r.type !== 'organelle' || !r.item.unlock || !unlocks.locked.includes(r.item.key);

/** The pool in the order a pedestal with this seed ranks it. */
export function rankedRewards(seed: number, draw: Pick<PickDraw, 'itemType' | 'pool' | 'mutations' | 'devil'>, ctx: PoolContext, unlocks: Unlocks): RewardItem[] {
  const { items, weights } = rewardPool(draw, ctx, unlocks);
  return stableOrder(items, weights, seed, isUnlocked(unlocks));
}

export interface RarityOptions {
  /** Brain rewards are always legendary. */
  forced?: number;
  /** Chances of the rarity upgrades you have (Adaptive Pressure plasmids, then Better Drops mutations), in order. */
  upgrades: number[];
  prefixes: boolean;
}

/** spawn_bodypart: rarity, prefixes and rarity upgrades, each from its own seed. */
export function rollRarity(seed: number, pick: RewardItem, range: [number, number], opts: RarityOptions): { rarity: number; traits: string[] } {
  if (pick.type !== 'organelle') return { rarity: 0, traits: [] };
  const o = pick.item;
  const rng = new GodotRng(godotHash(`${seed}rarity`));
  let rarity = opts.forced ?? rng.randiRange(range[0], range[1]);
  if (o.onlyCommon) rarity = 0;
  const traits: string[] = [];
  if (!o.noPrefixes && opts.prefixes)
    for (const prefix of PREFIXES) if (rng.randf() < seeded.rules.prefixChance && (prefix !== 'excitable' || o.excitable)) traits.push(prefix);
  if (opts.forced === undefined) {
    const up = new GodotRng(godotHash(`${seed}rarity_upgrade`));
    for (const chance of opts.upgrades) if (up.randf() < chance && rarity < 3 && !o.onlyCommon) rarity += 1;
  }
  return { rarity, traits };
}

export const rarityId = (r: number) => RARITIES[Math.max(0, Math.min(3, r))];

/** A pedestal: its seed, what it offers and what it already rerolled away. */
export interface Pedestal {
  draw: Pick<PickDraw, 'itemType' | 'pool' | 'mutations' | 'devil' | 'rarity'>;
  seed: number;
  reward: Reward | null;
  rerolledAway: RewardItem[];
  /** Bought or taken: no longer there to block or be rerolled. */
  gone?: boolean;
}

export interface RollContext {
  ctx: PoolContext;
  unlocks: Unlocks;
  rarity: RarityOptions;
}

/** pick_bodypart: the best-ranked item no sibling shows or has rerolled away. */
export function fillPedestal(p: Pedestal, siblings: Pedestal[], roll: RollContext): Pedestal {
  const ranked = rankedRewards(p.seed, p.draw, roll.ctx, roll.unlocks);
  const blocked = (r: RewardItem) =>
    p.rerolledAway.some((x) => sameReward(x, r)) ||
    siblings.some((s) => s !== p && !s.gone && ((s.reward && sameReward(s.reward.pick, r)) || s.rerolledAway.some((x) => sameReward(x, r))));
  const pick = ranked.find((r) => !blocked(r)) ?? ranked[0];
  if (!pick) return { ...p, reward: null };
  return { ...p, reward: { seed: p.seed, pick, ...rollRarity(p.seed, pick, p.draw.rarity, roll.rarity) } };
}

/** reroll(): a fresh seed from the old one, never offering what it showed before. */
export function rerollPedestal(p: Pedestal): Pedestal {
  return { ...p, seed: godotHash(`${p.seed}reroll`), rerolledAway: p.reward ? [...p.rerolledAway, p.reward.pick] : p.rerolledAway, reward: null };
}

/** bodypart_reward_3_choice: the room's number seeds up to three pedestals, each unique from the ones before. */
export function rollChoice(seed: number, draw: ChoiceDraw, roll: RollContext, shown: boolean[] = draw.shown): Reward[] {
  const rng = new GodotRng(seed);
  const pedestals: Pedestal[] = [];
  for (const on of shown) {
    if (!on) continue;
    pedestals.push({ draw: { itemType: TAG.Any, pool: null, mutations: true, devil: false, rarity: [0, 0] }, seed: rng.randi(), reward: null, rerolledAway: [] });
  }
  const done: Pedestal[] = [];
  for (const p of pedestals) done.push(fillPedestal(p, done, roll));
  return done.map((p) => p.reward).filter((r): r is Reward => !!r);
}

/** Whether a perfect boss fight opens a devil room (the boss room's choice, after its rewards). */
export function devilPortal(seed: number, draw: ChoiceDraw): boolean {
  const rng = new GodotRng(seed);
  for (const on of draw.shown) if (on) rng.randi();
  return rng.randf() > 0.5;
}

// ---------------------------------------------------------------------------
// Shops

export interface Price {
  cost: number;
  /** Before your discount. */
  full: number;
  /** Before the sale halved it. */
  original: number;
  sale: boolean;
}

/** shop_item.gd: the price, scaled by floor, maybe on sale, then your discount. */
export function shopPrice(seed: number, draw: ShopDraw, floor: number, discount: number): Price {
  const rng = new GodotRng(seed);
  let cost = draw.cost;
  let sale = false;
  if (!draw.skipScaling) {
    cost = draw.blood ? roundi(cost * rng.randfRange(1, 1.3)) : roundi(cost * ((floor - 1) / 4 + 1) * rng.randfRange(1, 1.3));
    if (draw.sale && rng.randiRange(0, 6) === 0) {
      sale = true;
    }
  }
  const original = cost;
  if (sale) cost = Math.max(1, Math.ceil(cost / 2));
  const full = cost;
  if (!draw.blood && discount > 0) cost = Math.max(1, roundi(full * (1 - discount)));
  return { cost, full, original, sale };
}

/** The shop's reroll machine: 4 more each time, with your discount. */
export function shopRerollPrice(timesUsed: number, discount: number): number {
  const price = 4 * (timesUsed + 1);
  return discount > 0 ? Math.max(1, roundi(price * (1 - discount))) : price;
}

// ---------------------------------------------------------------------------
// Floors

/** A floor's reward stream: reward_rng, seeded once per floor. */
export function rewardStream(seed: string, floor: number): GodotRng {
  return new GodotRng(godotHash(`${seed}rewards${floor}`));
}

/** One room's draws from the stream, in order. */
export interface RoomSeeds {
  draws: Draw[];
  seeds: number[];
}

export interface FloorStream {
  floor: SeededFloor;
  /** Normal rooms' own seeds (Brain rooms each drop a legendary organelle from theirs). */
  rooms: number[];
  boss?: RoomSeeds;
  shop: RoomSeeds;
  items: number[];
  special?: RoomSeeds;
  secret?: RoomSeeds;
}

/**
 * Splits a floor's reward stream between its rooms. `offset` adds (or takes
 * away) normal rooms, for when the predictions are a room off.
 */
export function floorStream(seed: string, level: number, opts: { offset?: number; special?: string; secret?: string } = {}): FloorStream {
  const floor = seeded.floors[level - 1];
  const rng = rewardStream(seed, level);
  const take = (draws: Draw[]): RoomSeeds => ({ draws, seeds: draws.map(() => rng.randi()) });
  for (let i = 0; i < floor.start; i++) rng.randi();
  const heart = floor.layout === 'heart';
  const normal = Math.max(0, (heart ? (floor.tiers ?? []).reduce((a, b) => a + b, 0) : floor.rooms) + (opts.offset ?? 0));
  const rooms = Array.from({ length: normal }, () => rng.randi());
  if (heart) {
    // Six tiers of rooms, then the heart's shop as the hub (level_config_heart.gd).
    return { floor, rooms, shop: take(seeded.heartShop), items: [] };
  }
  const boss = take(floor.bosses[0]?.draws ?? []);
  const shop = take(seeded.shop);
  // Every item room draws once, whichever of the three it is.
  const items = [rng.randi(), rng.randi()];
  const room = (list: SeededRoom[], key?: string) => {
    const r = key ? list.find((x) => x.key === key) : undefined;
    return r ? take(r.draws) : undefined;
  };
  const special = level > 1 ? room(seeded.special, opts.special) : undefined;
  const secret = room(seeded.secret, opts.secret);
  return { floor, rooms, boss: boss.draws.length ? boss : undefined, shop, items, special, secret };
}

/** Pedestals of a room with pick draws (shops, special rooms), filled in order. */
export function roomPedestals(room: RoomSeeds, roll: RollContext): Pedestal[] {
  const pedestals: Pedestal[] = [];
  room.draws.forEach((d, i) => {
    if (d.kind === 'pick') pedestals.push({ draw: d, seed: room.seeds[i], reward: null, rerolledAway: [] });
  });
  // Each pedestal sees only the siblings that already picked (they enter the tree in order).
  const done: Pedestal[] = [];
  for (const p of pedestals) done.push(fillPedestal(p, done, roll));
  return done;
}

export type ShopAction = { buy: number } | 'reroll';

export interface ShopStall {
  draw: ShopDraw;
  price: Price;
  /** The pedestal it sells, if it sells an organelle. */
  pedestal?: number;
  bought: boolean;
}

export interface ShopState {
  pedestals: Pedestal[];
  stalls: ShopStall[];
  rerolls: number;
  rerollPrice: number;
}

/** The shop after your purchases and rerolls (shop_reroll_machine.gd rerolls every pedestal still there, in order). */
export function shopState(room: RoomSeeds, level: number, generated: RollContext, live: RollContext, discount: number, actions: ShopAction[]): ShopState {
  let pedestals = roomPedestals(room, generated);
  const stalls: ShopStall[] = [];
  let pedestal = 0;
  room.draws.forEach((d, i) => {
    if (d.kind !== 'shop') return;
    const sells = d.contents.includes('bodypart_reward');
    stalls.push({ draw: d, price: shopPrice(room.seeds[i], d, level, discount), pedestal: sells ? pedestal++ : undefined, bought: false });
  });
  let rerolls = 0;
  for (const a of actions) {
    if (a === 'reroll') {
      for (let i = 0; i < pedestals.length; i++) {
        if (pedestals[i].gone) continue;
        pedestals[i] = rerollPedestal(pedestals[i]);
        pedestals[i] = fillPedestal(pedestals[i], pedestals, live);
      }
      rerolls++;
    } else {
      const stall = stalls[a.buy];
      if (!stall) continue;
      stall.bought = true;
      if (stall.pedestal !== undefined) pedestals[stall.pedestal] = { ...pedestals[stall.pedestal], gone: true };
    }
  }
  return { pedestals, stalls, rerolls, rerollPrice: shopRerollPrice(rerolls, discount) };
}
