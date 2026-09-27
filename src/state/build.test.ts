import { describe, expect, it } from 'vitest';
import { gameData } from '../data';
import { calculate } from '../engine/calc';
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
    const build = emptyBuild(gameData);
    const tampered = { ...build, slots: { 'core.c': { organelle: { id: 'ossificator', rarity: 'ultra', traits: 'x' }, uptime: 7 } } };
    const parsed = decodeBuild(encodeBuild(tampered as never), gameData)!;
    expect(parsed.slots['core.c']).toEqual({ organelle: { id: 'ossificator', rarity: 'common', traits: [] }, uptime: 1 });
  });

  it('drops malformed or duplicate pieces from links', () => {
    const build = emptyBuild(gameData);
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

  it('adds pieces with fresh ids and drops slots covered by them', () => {
    let build = emptyBuild(gameData);
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
});
