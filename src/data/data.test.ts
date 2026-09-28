import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculate } from '../engine/calc';
import { validateData } from '../engine/validate';
import { RARITIES, type SlotState } from '../engine/types';
import { gameData } from './index';
import organelleArt from './organelle_art.json';

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
            evolutions: [],
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

  it('fills every slot of every body plan without warnings', () => {
    for (const cls of gameData.classes) {
      if (cls.body.kind !== 'evolving') continue;
      const tiers = cls.body.tiers;
      // The starting body, then each evolution on its own tier.
      const paths: string[][] = [[], ...tiers.flatMap((options, t) => options.map((id) => [...Array(t).fill(''), id]))];
      for (const evolutions of paths) {
        const plan = gameData.bodies[evolutions.at(-1) || cls.body.start];
        const slots: Record<string, SlotState> = {};
        for (const s of plan.slots) {
          if (s.mirrorOf) continue;
          const id = s.kind === 'internal' ? 'oxysome' : 'caustic-secretor';
          slots[s.id] = { organelle: { id, rarity: 'rare', traits: [] } };
        }
        const result = calculate(
          { version: 2, name: plan.id, classId: cls.id, pieces: [], evolutions, slots, mutations: {}, plasmids: {}, params: {}, targets: 3, custom: [] },
          gameData,
        );
        expect(result.body.plan?.id, plan.id).toBe(plan.id);
        expect(result.warnings, plan.id).toEqual([]);
        expect(result.items.size, plan.id).toBe(plan.slots.length);
        expect(result.totalDps, plan.id).toBeGreaterThan(0);
      }
    }
  });

  it('knows how every organelle looks on the body, and ships its textures', () => {
    type Layer = { src?: string; points?: unknown };
    const looks = organelleArt.organelles as Record<string, { layers: Layer[] }>;
    const layers: Layer[] = [...Object.values(organelleArt.slots), ...Object.values(looks).flatMap((a) => a.layers)];
    for (const o of gameData.organelles) expect(looks[o.id]?.layers.length, o.id).toBeGreaterThan(0);
    for (const l of layers) {
      expect(l.src || l.points, JSON.stringify(l)).toBeTruthy();
      if (l.src) expect(existsSync(new URL(`../../public/${l.src}`, import.meta.url)), l.src).toBe(true);
    }
  });
});
