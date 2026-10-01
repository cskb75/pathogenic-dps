import { describe, expect, it } from 'vitest';
import { gameData } from '../data';
import { poolContext } from '../engine/seeded/pools';
import { floorView, levelView } from '../engine/seeded/predict';
import { emptyBuild, makeReducer } from './build';
import { currentLevel, parseRun, rerollsBefore, runReducer, type SeededRun } from './seededRun';

const reducer = makeReducer(gameData);
const build = emptyBuild(gameData, 'bacterium');
const context = poolContext(build, gameData);
const start = () => runReducer(null, { type: 'start', seed: 'ABCD3467', classId: 'bacterium', context })!;

describe('seeded run log', () => {
  it('starts only with a real seed', () => {
    expect(runReducer(null, { type: 'start', seed: 'ABCD1234', classId: 'bacterium', context })).toBeNull();
    const run = start();
    expect(run.floor).toBe(1);
    expect(run.floors[1].context).toEqual(context);
    expect(currentLevel(run)).toBe(1);
  });

  it('logs picks with the rerolls used, and counts rerolls across the run', () => {
    let run = start();
    run = runReducer(run, { type: 'reroll' })!;
    run = runReducer(run, { type: 'reroll' })!;
    run = runReducer(run, { type: 'pick', pick: { shown: ['a'], took: 'a' } })!;
    run = runReducer(run, { type: 'reroll' })!;
    expect(run.picks).toEqual([{ level: 1, rerolls: 2, shown: ['a'], took: 'a' }]);
    expect(rerollsBefore(run)).toBe(2);
    expect(run.rerolls).toBe(1);
    run = runReducer(run, { type: 'undoPick' })!;
    expect(run.picks).toEqual([]);
    expect(run.rerolls).toBe(2);
  });

  it('remembers the build a floor was made with, the first time you get there', () => {
    let run = start();
    const later = { ...context, slots: ['gun'] };
    run = runReducer(run, { type: 'enterFloor', floor: 2, context: later })!;
    run = runReducer(run, { type: 'enterFloor', floor: 2, context })!;
    expect(run.floor).toBe(2);
    expect(run.floors[2].context).toEqual(later);
  });

  it('logs shop actions and taken rewards per floor, with undo', () => {
    let run = start();
    run = runReducer(run, { type: 'shop', floor: 1, action: { buy: 1 } })!;
    run = runReducer(run, { type: 'shop', floor: 1, action: 'reroll' })!;
    run = runReducer(run, { type: 'undoShop', floor: 1 })!;
    run = runReducer(run, { type: 'toggleTaken', floor: 1, id: 'boss:2' })!;
    expect(run.floors[1].shop).toEqual([{ buy: 1 }]);
    expect(run.floors[1].taken).toEqual(['boss:2']);
    run = runReducer(run, { type: 'toggleTaken', floor: 1, id: 'boss:2' })!;
    expect(run.floors[1].taken).toEqual([]);
  });

  it('saves and loads, dropping anything malformed', () => {
    let run: SeededRun = start();
    run = runReducer(run, { type: 'pick', pick: { shown: ['x'], took: 'x' } })!;
    run = runReducer(run, { type: 'setRoom', floor: 3, room: 'special', key: 'challenge_room' })!;
    run = runReducer(run, { type: 'setUnlocks', patch: { prefixes: false, locked: ['conduit'] } })!;
    expect(parseRun(JSON.parse(JSON.stringify(run)))).toEqual(run);
    expect(parseRun({ ...run, seed: 'nope' })).toBeNull();
    const messy = parseRun({ ...run, floor: 99, floors: { 1: { offset: 'x', shop: ['reroll', { buy: 'y' }, 7] }, 12: {} } })!;
    expect(messy.floor).toBe(7);
    expect(messy.floors).toEqual({ 1: { offset: 0, context: undefined, shop: ['reroll'], taken: [] } });
  });

  it('turns the log and the build into cards and rewards', () => {
    let run = start();
    let b = build;
    const first = levelView(run, b, gameData);
    expect(first.cards).toHaveLength(4);
    expect(first.evolution).toBeUndefined();
    run = runReducer(run, { type: 'pick', pick: { shown: first.cards.map((c) => c.mutation.key), took: first.cards[0].mutation.key } })!;
    if (first.cards[0].appId) b = reducer(b, { type: 'setMutation', id: first.cards[0].appId, count: 1 });
    // Level 2 is an evolution for the Bacterium.
    const second = levelView(run, b, gameData);
    expect(second.evolution?.tier).toBe(0);
    const floor = floorView(run, b, gameData, 1);
    expect(floor.boss?.rewards).toHaveLength(3);
    expect(floor.shop.stalls).toHaveLength(5);
    expect(floor.items.map((r) => r.length)).toEqual([3, 3]);
    expect(floorView(run, b, gameData, 7).brain).toHaveLength(16);
  });
});
