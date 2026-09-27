import { describe, expect, it } from 'vitest';
import { calculate } from '../engine/calc';
import { validateData } from '../engine/validate';
import { RARITIES, type SlotState } from '../engine/types';
import { gameData } from './index';

describe('game data', () => {
  it('has no broken references', () => {
    expect(validateData(gameData)).toEqual([]);
  });

  it('can put every organelle in a slot at every rarity without warnings or NaN', () => {
    for (const o of gameData.organelles) {
      for (const rarity of RARITIES) {
        const slot = o.slot === 'internal' ? 'core.c' : 'core.e0';
        // Internals get a weapon next to them so their effects run.
        const other: Record<string, SlotState> = o.slot === 'internal' ? { 'core.e0': { organelle: { id: 'caustic-secretor', rarity, traits: [] } } } : {};
        const result = calculate(
          {
            version: 2,
            name: o.id,
            classId: 'nanobot',
            pieces: [{ id: 'core', type: 'core' }],
            slots: { ...other, [slot]: { organelle: { id: o.id, rarity, traits: [] } } },
            upgrades: {},
            mutations: {},
            plasmids: {},
            params: {},
            targets: 3,
            custom: [],
          },
          gameData,
        );
        expect(result.warnings, `${o.id} (${rarity})`).toEqual([]);
        expect(Number.isFinite(result.totalDps), `${o.id} (${rarity})`).toBe(true);
        expect(Number.isFinite(result.totalMultiDps), `${o.id} (${rarity})`).toBe(true);
      }
    }
  });
});
