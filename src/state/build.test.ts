import { describe, expect, it } from 'vitest';
import { gameData } from '../data';
import { calculate } from '../engine/calc';
import { availableNodes } from './plasmidTree';
import { decodeBuild, emptyBuild, encodeBuild, exampleBuild, makeReducer } from './build';

const reducer = makeReducer(gameData);

describe('build state', () => {
  it('ships an example build that uses only valid slots and organelles', () => {
    const build = exampleBuild(gameData);
    const result = calculate(build, gameData);
    expect(result.warnings).toEqual([]);
    expect(result.items.size).toBe(Object.keys(build.slots).length);
    expect(result.totalDps).toBeGreaterThan(0);
  });

  it('round-trips a build through a share link', () => {
    const build = exampleBuild(gameData);
    expect(decodeBuild(encodeBuild(build), gameData)).toEqual(build);
  });

  it('rejects garbage links', () => {
    expect(decodeBuild('not-a-build', gameData)).toBeNull();
    expect(decodeBuild(encodeBuild({ nope: true } as never), gameData)).toBeNull();
  });

  it('sanitises malformed slot data from links', () => {
    const build = emptyBuild(gameData, 'nanobot');
    const tampered = { ...build, slots: { 'core.c': { organelle: { id: 'ossificator', rarity: 'ultra', traits: 'x' }, uptime: 7 } } };
    const parsed = decodeBuild(encodeBuild(tampered as never), gameData)!;
    expect(parsed.slots['core.c']).toEqual({ organelle: { id: 'ossificator', rarity: 'common', traits: [] }, uptime: 1 });
  });

  it('drops malformed or duplicate pieces from links', () => {
    const build = emptyBuild(gameData, 'nanobot');
    const tampered = {
      ...build,
      pieces: [
        { id: 'core', type: 'core' },
        { id: 'a', type: 'square', attach: { to: 'core', edge: '1' } },
        { id: 'b', type: 'square', attach: { to: 'core', edge: 1 } },
        { id: 'b', type: 'square', attach: { to: 'core', edge: 2 } },
      ],
    };
    const parsed = decodeBuild(encodeBuild(tampered as never), gameData)!;
    expect(parsed.pieces).toEqual([
      { id: 'core', type: 'core' },
      { id: 'b', type: 'square', attach: { to: 'core', edge: 1 } },
    ]);
  });

  it('migrates old version 1 links, dropping the made-up sample organelles', () => {
    const v1 = {
      version: 1,
      name: 'old',
      classId: 'nanobot',
      pieces: [{ id: 'core', type: 'core' }],
      slots: { 'core.c': { organelle: { id: 'sample-attack-infuser', rarity: 'rare', traits: [] } }, 'core.e0': { organelle: { id: 'caustic-secretor', rarity: 'rare', traits: [] } } },
      conditions: { targetBurning: true },
      custom: [{ id: 'x', label: 'old', target: 'attacks', stat: 'damage', op: 'percent', value: 0.1 }],
    };
    const parsed = decodeBuild(encodeBuild(v1 as never), gameData)!;
    expect(parsed.version).toBe(2);
    expect(Object.keys(parsed.slots)).toEqual(['core.e0']);
    expect(parsed.custom).toEqual([]);
  });

  it('adds pieces with fresh ids and drops slots covered by them', () => {
    let build = emptyBuild(gameData, 'nanobot');
    build = reducer(build, { type: 'setOrganelle', slotId: 'core.e1', organelle: { id: 'caustic-secretor', rarity: 'common', traits: [] } });
    build = reducer(build, { type: 'addPiece', pieceType: 'square', to: 'core', edge: 1 });
    expect(build.pieces.map((p) => p.id)).toEqual(['core', 'p1']);
    expect(build.slots['core.e1']).toBeUndefined();
  });

  it('removes a piece with its attachments and their slot settings, but never the core', () => {
    let build = exampleBuild(gameData);
    build = reducer(build, { type: 'removePiece', pieceId: 'p1' });
    expect(build.pieces.some((p) => p.id === 'p1')).toBe(false);
    expect(Object.keys(build.slots).some((id) => id.startsWith('p1.'))).toBe(false);
    expect(reducer(build, { type: 'removePiece', pieceId: 'core' })).toBe(build);
  });

  it('switches class with a fresh body, keeping run state but not plasmids', () => {
    let build = exampleBuild(gameData);
    build = reducer(build, { type: 'setMutation', id: 'corrosive-acid', count: 2 });
    build = reducer(build, { type: 'setPlasmid', id: 'nanobot-staminaplasmid', count: 1 });
    build = reducer(build, { type: 'setClass', classId: 'helminth' });
    expect(build.classId).toBe('helminth');
    expect(build.pieces).toEqual([]);
    expect(build.slots).toEqual({});
    expect(build.mutations).toEqual({ 'corrosive-acid': 2 });
    expect(build.plasmids).toEqual({});
    expect(calculate(build, gameData).body.plan?.id).toBe('helminth-start');
  });

  it('picks evolutions per tier, keeping organelles in slots with the same name', () => {
    let build = emptyBuild(gameData, 'bacterium');
    build = reducer(build, { type: 'setOrganelle', slotId: 'ESlot1', organelle: { id: 'caustic-secretor', rarity: 'common', traits: [] } });
    build = reducer(build, { type: 'setEvolution', tier: 2, id: 'bacterium-clostridium' });
    expect(build.evolutions).toEqual(['', '', 'bacterium-clostridium']);
    expect(calculate(build, gameData).body.plan?.id).toBe('bacterium-clostridium');
    expect(calculate(build, gameData).weapons.map((w) => w.slotId)).toEqual(['ESlot1']);
    build = reducer(build, { type: 'setEvolution', tier: 2, id: '' });
    expect(build.evolutions).toEqual([]);
  });

  it('round-trips an evolving build and drops bad evolutions from links', () => {
    let build = emptyBuild(gameData, 'fungal-spore');
    build = reducer(build, { type: 'setEvolution', tier: 0, id: 'fungal-spore-ascomycota' });
    build = reducer(build, { type: 'setOrganelle', slotId: 'ESlot1', organelle: { id: 'caustic-secretor', rarity: 'rare', traits: [] } });
    expect(decodeBuild(encodeBuild(build), gameData)).toEqual(build);
    const tampered = { ...build, evolutions: ['fungal-spore-aspergillus', 42] };
    expect(decodeBuild(encodeBuild(tampered as never), gameData)!.evolutions).toEqual([]);
  });

  it('counts mutation stacks and plasmid nodes, dropping them at zero', () => {
    let build = emptyBuild(gameData, 'nanobot');
    build = reducer(build, { type: 'setMutation', id: 'corrosive-acid', count: 2 });
    build = reducer(build, { type: 'setPlasmid', id: 'nanobot-staminaplasmid', count: 1 });
    expect(build.mutations).toEqual({ 'corrosive-acid': 2 });
    expect(build.plasmids).toEqual({ 'nanobot-staminaplasmid': 1 });
    build = reducer(build, { type: 'setMutation', id: 'corrosive-acid', count: 0 });
    expect(build.mutations).toEqual({});
    build = reducer(reducer(build, { type: 'setMutation', id: 'adrenaline', count: 1 }), { type: 'clearMutations' });
    expect(build.mutations).toEqual({});
    expect(build.plasmids).toEqual({ 'nanobot-staminaplasmid': 1 });
  });

  it('sanitises mutation and plasmid counts from links', () => {
    const tampered = {
      ...emptyBuild(gameData, 'nanobot'),
      mutations: { 'corrosive-acid': 2.6, adrenaline: -3, 'no-such-mutation': 1, 'fast-twitch-fibers': 1e9 },
      plasmids: { 'nanobot-staminaplasmid': 1, 'corrosive-acid': 1 },
    };
    const parsed = decodeBuild(encodeBuild(tampered as never), gameData)!;
    expect(parsed.mutations).toEqual({ 'corrosive-acid': 3, 'fast-twitch-fibers': 99 });
    // A node is owned once, together with the path to it from the root.
    expect(parsed.plasmids['nanobot-staminaplasmid']).toBe(1);
    expect(parsed.plasmids['corrosive-acid']).toBeUndefined();
    expect(Object.values(parsed.plasmids).every((n) => n === 1)).toBe(true);
  });

  it('owns plasmid nodes as in the game: with the path to them, and never cut off from the root', () => {
    const nodes = gameData.classes.find((c) => c.id === 'nanobot')!.plasmids;
    // A node next to the root, and one only reachable through it.
    const first = availableNodes(nodes, new Set());
    const next = nodes.find((n) => first.has(n.id) && [...availableNodes(nodes, new Set([n.id]))].some((id) => !first.has(id)))!;
    const far = nodes.find((n) => availableNodes(nodes, new Set([next.id])).has(n.id) && !first.has(n.id))!;
    let build = emptyBuild(gameData, 'nanobot');
    build = reducer(build, { type: 'togglePlasmid', id: far.id });
    expect(Object.keys(build.plasmids).sort()).toEqual([next.id, far.id].sort());
    build = reducer(build, { type: 'togglePlasmid', id: next.id });
    expect(build.plasmids).toEqual({});
  });
});
