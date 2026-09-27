import { describe, expect, it } from 'vitest';
import { calculate } from '../engine/calc';
import { validateData } from '../engine/validate';
import { RARITIES } from '../engine/types';
import { gameData } from './index';

describe('game data', () => {
  it('has no broken references', () => {
    expect(validateData(gameData)).toEqual([]);
  });

  it('can put every organelle in a slot and calculate without warnings', () => {
    for (const o of gameData.organelles) {
      for (const rarity of RARITIES) {
        const slot = o.slot === 'internal' ? 'core.c' : 'core.e0';
        const result = calculate(
          {
            version: 1,
            name: o.id,
            classId: 'nanobot',
            pieces: [{ id: 'core', type: 'core' }],
            slots: { [slot]: { organelle: { id: o.id, rarity, traits: gameData.traits.map((t) => t.id) } } },
            upgrades: {},
            conditions: {},
            params: {},
            targets: 3,
            custom: [],
          },
          gameData,
        );
        expect(result.warnings, `${o.id} (${rarity})`).toEqual([]);
        expect(Number.isFinite(result.totalDps)).toBe(true);
      }
    }
  });
});
