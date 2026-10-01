import { describe, expect, it } from 'vitest';
import { gameData } from '../../data';
import { emptyBuild } from '../../state/build';
import { godotHash } from './godot';
import {
  floorStream,
  isValidSeed,
  mutationGift,
  mutationRoll,
  normalizeSeed,
  rollChoice,
  roomPedestals,
  sameReward,
  shopPrice,
  shopState,
  stableOrder,
  type RollContext,
} from './offers';
import { TAG, defaultUnlocks, ids, mutationFactor, poolContext, seeded, type ChoiceDraw, type PoolContext, type ShopDraw } from './pools';

const SEED = 'ABCD3467';
const ctx = poolContext(emptyBuild(gameData, 'bacterium'), gameData);
const roll: RollContext = { ctx, unlocks: defaultUnlocks, rarity: { upgrades: [], prefixes: true } };
const itemDraw = seeded.itemRooms[0].draws[0] as ChoiceDraw;

describe('seeded data', () => {
  it('maps every mutation and almost every organelle to the app', () => {
    const map = ids(gameData);
    expect(seeded.mutations.filter((m) => !map.mutationApp.has(m.key))).toEqual([]);
    // Only the improvements (Enhancer and the slot conversions) aren't organelles in the app.
    expect(seeded.organelles.filter((o) => !map.organelleApp.has(o.key)).every((o) => o.tags.includes(TAG.Upgrade))).toBe(true);
  });

  it('knows every floor and the rooms that hand out organelles', () => {
    expect(seeded.floors.map((f) => f.rooms)).toEqual([6, 5, 8, 11, 9, 15, 16]);
    expect(seeded.floors.every((f) => f.roomDraws.length === 1 && f.roomDraws[0] === 1)).toBe(true);
    expect(seeded.shop.map((d) => d.kind)).toEqual(['pick', 'pick', 'pick', 'shop', 'shop', 'shop', 'shop', 'shop']);
    expect(seeded.heartShop.filter((d) => d.kind === 'shop')).toHaveLength(14);
    expect(seeded.itemRooms.map((r) => (r.draws[0] as ChoiceDraw).shown.filter(Boolean).length)).toEqual([3, 1, 2]);
  });
});

describe('seeds', () => {
  it('accepts only the pause menu alphabet', () => {
    expect(isValidSeed('ABCD3467')).toBe(true);
    expect(isValidSeed('ABCD1234')).toBe(false);
    expect(normalizeSeed(' abcd-3467x ')).toBe('ABCD3467');
  });
});

describe('ranking', () => {
  it('ranks by log(u)/weight: heavier items move up, zero weights and locked items drop out without moving the rest', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const base = stableOrder(items, [1, 1, 1, 1, 1], 12345);
    expect([...base].sort()).toEqual(items);
    expect(stableOrder(items, [1, 1, 0, 1, 1], 12345)).toEqual(base.filter((x) => x !== 'c'));
    expect(stableOrder(items, [1, 1, 1, 1, 1], 12345, (x) => x !== 'b')).toEqual(base.filter((x) => x !== 'b'));
    const last = base.at(-1)!;
    const heavy = stableOrder(items, items.map((x) => (x === last ? 1000 : 1)), 12345);
    expect(heavy[0]).toBe(last);
  });
});

describe('level-ups', () => {
  it('rolls four different cards from hash(seed + "mut" + level)', () => {
    const a = mutationRoll(SEED, 1, ctx);
    expect(a.cards).toHaveLength(4);
    expect(new Set(a.cards.map((m) => m.key)).size).toBe(4);
    expect(mutationRoll(SEED, 1, ctx).cards).toEqual(a.cards);
    expect(mutationRoll(SEED, 3, ctx).cards).not.toEqual(a.cards);
    // Cards that need something you don't have are never offered.
    expect(a.ranked.every((m) => mutationFactor(m, ctx) > 0)).toBe(true);
  });

  it('rerolls never show the cards they replace, and count rerolls across the run', () => {
    const first = mutationRoll(SEED, 4, ctx);
    const shown = first.cards.map((m) => m.key);
    const r0 = mutationRoll(SEED, 4, ctx, { count: 0, shown });
    const r1 = mutationRoll(SEED, 4, ctx, { count: 1, shown });
    expect(r0.cards.some((m) => shown.includes(m.key))).toBe(false);
    expect(r0.cards).not.toEqual(r1.cards);
  });

  it('weighs pathogen-only cards for their pathogen only', () => {
    const nanobot = poolContext(emptyBuild(gameData, 'nanobot'), gameData);
    const spore = poolContext(emptyBuild(gameData, 'fungal-spore'), gameData);
    const ext = seeded.mutations.find((m) => m.key === 'nanobot_body_extension')!;
    const slot = seeded.mutations.find((m) => m.key === 'damage_slot_mutation')!;
    expect(mutationFactor(ext, nanobot)).toBe(1);
    expect(mutationFactor(ext, ctx)).toBe(0);
    expect(mutationFactor(slot, spore)).toBe(0);
    expect(mutationFactor(slot, ctx)).toBe(1);
  });

  it('names the organelle a "random organelle" mutation gives', () => {
    const gift = mutationGift(SEED, 'random_weapon_mutation', 3, ctx, defaultUnlocks);
    expect(gift?.tags).toContain(TAG.Weapon);
    expect(mutationGift(SEED, 'random_weapon_mutation', 3, ctx, defaultUnlocks)).toBe(gift);
    expect(mutationGift(SEED, 'armor_mutation', 3, ctx, defaultUnlocks)).toBeNull();
  });
});

describe('rewards', () => {
  it('fills item rooms from one number: the one- and two-item rooms show the start of the three', () => {
    const seed = godotHash('example');
    const three = rollChoice(seed, itemDraw, roll);
    expect(three).toHaveLength(3);
    expect(new Set(three.map((r) => `${r.pick.type}:${r.pick.item.key}`)).size).toBe(3);
    const one = rollChoice(seed, seeded.itemRooms[1].draws[0] as ChoiceDraw, roll);
    const two = rollChoice(seed, seeded.itemRooms[2].draws[0] as ChoiceDraw, roll);
    expect(one).toEqual(three.slice(0, 1));
    expect(two).toEqual(three.slice(0, 2));
  });

  it('skips organelles you have not unlocked', () => {
    const seed = godotHash('locks');
    const ranked = rollChoice(seed, itemDraw, roll);
    const lockable = ranked.find((r) => r.pick.type === 'organelle' && r.pick.item.unlock);
    const lockedCtx: RollContext = { ...roll, unlocks: { ...defaultUnlocks, locked: seeded.organelles.filter((o) => o.unlock).map((o) => o.key) } };
    const after = rollChoice(seed, itemDraw, lockedCtx);
    expect(after.some((r) => r.pick.type === 'organelle' && r.pick.item.unlock)).toBe(false);
    if (!lockable) expect(after).toEqual(ranked);
  });

  it('makes everything legendary on the Brain', () => {
    const brain = rollChoice(godotHash('brain'), itemDraw, { ...roll, rarity: { ...roll.rarity, forced: 3 } });
    expect(brain.filter((r) => r.pick.type === 'organelle').every((r) => r.rarity === 3)).toBe(true);
  });

  it('upgrades rarity with Better Drops chances, and only upward', () => {
    const plain = rollChoice(godotHash('up'), itemDraw, roll);
    const lucky = rollChoice(godotHash('up'), itemDraw, { ...roll, rarity: { ...roll.rarity, upgrades: [1, 1, 1, 1] } });
    lucky.forEach((r, i) => {
      if (r.pick.type !== 'organelle') return;
      expect(r.rarity).toBe(r.pick.item.onlyCommon ? 0 : 3);
      expect(r.rarity).toBeGreaterThanOrEqual(plain[i].rarity);
    });
  });
});

describe('floors and shops', () => {
  it('splits the reward stream: normal rooms, then the boss, the shop and two item rooms', () => {
    const skin = floorStream(SEED, 1);
    expect(skin.rooms).toHaveLength(6);
    expect(skin.boss?.seeds).toHaveLength(1);
    expect(skin.shop.seeds).toHaveLength(8);
    expect(skin.items).toHaveLength(2);
    // One more room shifts everything after the rooms along by one number.
    const shifted = floorStream(SEED, 1, { offset: 1 });
    expect(shifted.boss?.seeds[0]).toBe(skin.shop.seeds[0]);
    expect(floorStream(SEED, 7).boss).toBeUndefined();
    expect(floorStream(SEED, 6).shop.draws).toBe(seeded.heartShop);
  });

  it('stocks the shop with an internal organelle, a weapon and anything, all different', () => {
    for (let floor = 1; floor <= 5; floor++) {
      const peds = roomPedestals(floorStream(SEED, floor).shop, roll);
      const [internal, weapon, any] = peds.map((p) => p.reward!.pick);
      expect(internal.type === 'organelle' && internal.item.tags.includes(TAG.Internal)).toBe(true);
      expect(weapon.type === 'organelle' && weapon.item.tags.includes(TAG.Weapon)).toBe(true);
      expect(sameReward(internal, any) || sameReward(weapon, any) || sameReward(internal, weapon)).toBe(false);
    }
  });

  it('rerolls what is left in the shop, never re-offering what was there', () => {
    const room = floorStream(SEED, 2).shop;
    const before = shopState(room, 2, roll, roll, 0, []);
    const after = shopState(room, 2, roll, roll, 0, [{ buy: 0 }, 'reroll']);
    expect(after.pedestals[0].reward).toEqual(before.pedestals[0].reward);
    for (const i of [1, 2]) {
      const was = before.pedestals[i].reward!.pick;
      expect(sameReward(after.pedestals[i].reward!.pick, was)).toBe(false);
    }
    expect(after.stalls[0].bought).toBe(true);
    expect(after.rerollPrice).toBe(8);
  });

  it('prices shop items by floor, with sales and your discount', () => {
    const draw = seeded.shop.find((d): d is ShopDraw => d.kind === 'shop')!;
    for (let s = 0; s < 200; s++) {
      const p = shopPrice(s, draw, 3, 0);
      const scaled = draw.cost * 1.5;
      expect(p.original).toBeGreaterThanOrEqual(Math.round(scaled));
      expect(p.original).toBeLessThanOrEqual(Math.round(scaled * 1.3));
      expect(p.cost).toBe(p.sale ? Math.ceil(p.original / 2) : p.original);
      expect(shopPrice(s, draw, 3, 0.25).cost).toBe(Math.max(1, Math.round(p.cost * 0.75)));
    }
  });

  it('sees your body when it weighs rewards', () => {
    const lash = seeded.mutations.find((m) => m.rule === 'speed_damage_mutation')!;
    const withLash: PoolContext = { ...ctx, slots: ['lash'] };
    expect(mutationFactor(lash, ctx)).toBe(0);
    expect(mutationFactor(lash, withLash)).toBe(1);
  });
});
